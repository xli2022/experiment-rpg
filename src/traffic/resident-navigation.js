import { carCollider, supportHeight, overlapsHeight, circleHitsBox } from '../core/physics.js';
import { levelY } from '../world/interior-plan.js';
import { toLocal } from '../world/interior-physics.js';
import { residentDestinations, planResidentGuide } from './resident-guides.js';
import { RESIDENT_SIT } from '../core/resident-behaviors.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Physics stays available when a floor's meshes and routine population unload. */
export function createResidentNavigation({ world, people = () => [], cars = () => [], onFoot = () => true }) {
  const contextAt = p => world.interiorContextAt?.(p.x, p.y, p.z);
  function liftValid(from, to) {
    const a = contextAt(from), b = contextAt(to), lift = a?.inside && a.plan.core?.lift;
    if (!lift || !b?.inside || a.id !== b.id || a.level === b.level || distance(from, to) > .05) return false;
    if (Math.abs(from.y - levelY(a.plan, a.level)) > .12 || Math.abs(to.y - levelY(b.plan, b.level)) > .12) return false;
    const local = toLocal(a.plan, from.x, from.z);
    return local.x > lift.x0 + .3 && local.x < lift.x1 - .3 && local.z > lift.z0 + .3 && local.z < lift.z1 - .3;
  }
  return body => {
    const navigation = {
      mobile: true, area: contextAt(body)?.inside ? 'inside the building' : 'outside',
      crossing: body.edge?.kind === 'crossing', onFoot: onFoot(), liftValid,
      destinations: () => residentDestinations(world, body),
      // A place by ID, among those nearby now, or a place a plan bound earlier.
      guide(start, id) {
        const destination = typeof id === 'object' ? id : navigation.destinations().find(place => place.id === id);
        if (!destination) return null;
        const route = planResidentGuide(start, destination, navigation);
        return route && { destination, route };
      },
      visible() {
        const context = contextAt(body);
        return !context?.inside || !world.interiors || world.interiors.floors().some(f => f.plan.id === context.id && f.level === context.level);
      },
      sample: (from, to, arrival = false) => sample(from, to, arrival),
      // The same ground, walls and cars without the people: a way through
      // that people standing in it can be walked round.
      withoutPeople: { sample: (from, to, arrival = false) => sample(from, to, arrival, [], false) },
      // The only collision exception is the resident's own seat, on the short
      // path between its seated root and clear floor. It never applies to travel.
      sampleSeat(from, to, seat) {
        if ([from, to].some(p => distance(p, seat.origin) > 1.6 || Math.abs(p.y - seat.origin.y) > .15)) return null;
        return sample(from, to, false, seat.ignore);
      },
      seatExit() {
        if (body.pose !== 'sit' || !body.plan) return null;
        const template = body.plan.templates[Math.min(body.level, body.plan.templates.length - 1)];
        const piece = template.furniture.find(f => f.id === body.piece);
        if (!piece) return null;
        const origin = { x: body.x, y: body.y, z: body.z, yaw: body.yaw };
        const tag = `interior:${body.plan.id}:${body.level}`;
        const ignore = [`${tag}:${piece.id}`, ...(body.chair ? [`${tag}:chair:${body.spot}`] : [])];
        const seat = { origin, ignore, path: [] }, yaw = body.plan.origin.yaw + piece.yaw;
        // Leave through the open front of a sofa/bench, or behind a desk chair.
        // Side offsets allow a chair to clear nearby furniture without crossing it.
        for (const forward of [.65, .85, 1.05]) for (const side of [0, .4, -.4, .7, -.7]) {
          const target = { x: body.x + Math.sin(yaw) * forward + Math.cos(yaw) * side, y: body.y,
            z: body.z + Math.cos(yaw) * forward - Math.sin(yaw) * side };
          const clear = sample(target, target, true);
          if (!clear || Math.abs(clear.y - origin.y) > .1) continue;
          const steps = Math.ceil(distance(origin, target) / .1);
          let at = origin;
          for (let i = 1; i <= steps && at; i++) at = navigation.sampleSeat(at, {
            x: origin.x + (target.x - origin.x) * i / steps, y: origin.y, z: origin.z + (target.z - origin.z) * i / steps,
          }, seat);
          if (at) return { ...seat, path: [{ x: origin.x, y: origin.y, z: origin.z }, clear] };
        }
        return null;
      },
    };
    function sample(from, to, arrival = false, ignore = [], crowd = true) {
      if (Math.abs(to.x) > (world.limit ?? Infinity) - .4 || Math.abs(to.z) > (world.limit ?? Infinity) - .4 || world.isWater?.(to.x, to.z)) return null;
      const context = world.interiorContextAt?.(to.x, from.y, to.z);
      const spatial = world.spatialFor?.(context) ?? world.spatial;
      const boxes = (spatial?.near(to.x, to.z, 2) ?? []).filter(b => !ignore.includes(b.id));
      const y = supportHeight(to.x, to.z, boxes, from.y + .3, world.masterPlan.terrainHeight(to.x, to.z));
      if (Math.abs(y - from.y) > .35) return null;
      const radius = body.plan ? .28 : .32;
      if (boxes.some(b => !b.supportOnly && overlapsHeight(b, y) && circleHitsBox(to.x, to.z, radius, b))) return null;
      for (const car of cars()) if (Math.abs(car.y - y) < 2 && distance(car, to) < 6 && circleHitsBox(to.x, to.z, .5, carCollider(car))) return null;
      if (crowd) for (const other of people()) if (other !== body && Math.abs(other.y - y) < 1.5) {
        const gap = other.residentAction?.sitProgress ? RESIDENT_SIT.length / 2 + radius : .7;
        if (distance(other, to) < gap && (arrival || distance(other, to) < distance(other, from) - 1e-6)) return null;
      }
      return { x: to.x, y, z: to.z };
    }
    return navigation;
  };
}
