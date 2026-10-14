import { buildingEntrances } from '../world/building-design.js';
import { toWorld } from '../world/interior-physics.js';
import { levelY } from '../world/interior-plan.js';
import { traceResidentPath as trace } from './resident-path.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point = p => ({ x: p.x, y: p.y, z: p.z });
export const GUIDE_RANGE = 120;

/** Only real local destinations, with opaque IDs rather than model-written coordinates. */
export function residentDestinations(world, body) {
  const places = [], context = world.interiorContextAt?.(body.x, body.y, body.z);
  if (context?.inside) {
    const { plan, level } = context, y = levelY(plan, level);
    if (level === 0) for (const door of plan.entrances) places.push({ id: `exit:${door.id}`, name: 'Building exit', type: 'exit',
      ...toWorld(plan, door.x - door.nx, door.z - door.nz), y });
    const template = plan.templates[Math.min(level, plan.templates.length - 1)];
    for (const door of template.doors) if (door.kind === 'lift') {
      const landing = plan.core?.landing;
      const dx = landing ? (landing.x0 + landing.x1) / 2 - door.x : Math.cos(door.yaw);
      const dz = landing ? (landing.z0 + landing.z1) / 2 - door.z : -Math.sin(door.yaw);
      const length = Math.hypot(dx, dz) || 1;
      places.push({ id: 'lift', name: 'Elevator', type: 'elevator', ...toWorld(plan, door.x + dx / length, door.z + dz / length), y });
    }
  } else {
    for (const building of world.buildingsNear?.(body.x, body.z, GUIDE_RANGE) ?? []) {
      if (!building.sign?.title) continue;
      const frame = { origin: { x: building.x, z: building.z, yaw: building.yaw ?? 0 } };
      const entrances = buildingEntrances(building).map(door => {
        const at = toWorld(frame, door.x + door.nx * 1.4, door.z + door.nz * 1.4);
        return { ...at, y: world.masterPlan.terrainHeight(at.x, at.z) };
      }).sort((a, b) => distance(a, body) - distance(b, body));
      if (entrances[0]) places.push({ id: `building:${building.id}`, name: building.sign.title,
        type: building.sign.subtitle?.split(' / ')[0].toLowerCase() ?? building.type, ...entrances[0] });
    }
    for (const site of world.landmarks ?? []) if (site.station) {
      const district = world.districts?.find(d => d.id === site.district)?.name;
      places.push({ id: `station:${site.id}`, name: `${district ?? 'Local'} station`, type: 'tram station', ...point(site) });
    }
  }
  const sorted = places.map(place => ({ ...place, distance: Math.round(distance(place, body)) }))
    .filter(place => distance(place, body) <= GUIDE_RANGE && Math.abs(place.y - body.y) < 1.3)
    .sort((a, b) => a.distance - b.distance);
  const selected = sorted.slice(0, 12), station = sorted.find(place => place.type === 'tram station');
  if (station && !selected.includes(station)) selected[selected.length - 1] = station;
  return selected;
}

/** Bounded A* over walkable floor; every edge is swept through the live collision sampler. */
export function planResidentGuide(start, goal, navigation, { step = .75, budget = 5000 } = {}) {
  if (distance(start, goal) > GUIDE_RANGE || Math.abs(start.y - goal.y) > 1.3) return null;
  const straight = distance(start, goal) <= 25 && trace(start, goal, navigation);
  if (straight) return [point(start), straight];
  const heap = [], costs = new Map(), key = (i, j, y) => `${i},${j},${Math.round(y * 4)}`;
  const heuristic = p => distance(p, goal) + Math.abs(p.y - goal.y) * 2;
  function push(node) {
    let i = heap.length; heap.push(node);
    while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent].score <= node.score) break; heap[i] = heap[parent]; i = parent; }
    heap[i] = node;
  }
  function pop() {
    const first = heap[0], tail = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
        if (heap[child].score >= tail.score) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = tail;
    }
    return first;
  }
  const initial = { ...point(start), i: 0, j: 0, cost: 0, score: heuristic(start), parent: null };
  push(initial); costs.set(key(0, 0, start.y), 0);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let visited = 0; heap.length && visited < budget; visited++) {
    const node = pop();
    if (node.cost > costs.get(key(node.i, node.j, node.y))) continue;
    if (distance(node, goal) <= step * 2) {
      const last = trace(node, goal, navigation);
      if (last) {
        const route = [last];
        for (let at = node; at; at = at.parent) route.push(point(at));
        return route.reverse();
      }
    }
    for (const [di, dj] of directions) {
      const i = node.i + di, j = node.j + dj;
      const candidate = { x: start.x + i * step, y: node.y, z: start.z + j * step };
      if (distance(candidate, start) > GUIDE_RANGE || distance(candidate, goal) > GUIDE_RANGE) continue;
      const next = trace(node, candidate, navigation);
      if (!next || Math.abs(next.y - start.y) > 1.3) continue;
      const cost = node.cost + distance(node, next) + Math.abs(next.y - node.y) * 2, id = key(i, j, next.y);
      if (cost >= (costs.get(id) ?? Infinity)) continue;
      costs.set(id, cost); push({ ...next, i, j, cost, score: cost + heuristic(next), parent: node });
    }
  }
  return null;
}
