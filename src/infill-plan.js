import { SpatialGrid } from './spatial-grid.js';

// Split the remaining large blocks across the whole city, including land beyond
// the initial district fabrics. Every insertion joins existing ground streets;
// a returned block is used where the map edge leaves no street on the far side.
export function addCityInfill({ districts, fabrics, roads, addRoad, terrainHeight, nearestOnSegment, clear }) {
  const index = new SpatialGrid([], 256);
  const addSegments = road => {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      if ([a, b].some(p => p.y - terrainHeight(p.x, p.z) >= .3)) continue;
      index.add({ a, b, road, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) });
    }
  };
  for (const road of roads) addSegments(road);
  const distanceToRoad = p => {
    let distance = Infinity;
    for (let radius = 256; radius <= 4096; radius *= 2) {
      for (const s of index.near(p.x, p.z, radius)) distance = Math.min(distance, nearestOnSegment(p.x, p.z, s.a, s.b).distance);
      if (distance < radius) break;
    }
    return distance;
  };
  const districtAt = p => districts.reduce((best, d) => {
    const score = ((p.x - d.x) / d.radiusX) ** 2 + ((p.z - d.z) / d.radiusZ) ** 2;
    return !best || score < best.score ? { district: d, score } : best;
  }, null).district;
  const crossing = (p, direction, s, reach = 4200) => {
    const ex = s.b.x - s.a.x, ez = s.b.z - s.a.z;
    const determinant = direction.x * ez - direction.z * ex;
    if (Math.abs(determinant) < 1e-8) return null;
    const cx = s.a.x - p.x, cz = s.a.z - p.z;
    const t = (cx * ez - cz * ex) / determinant, u = (cx * direction.z - cz * direction.x) / determinant;
    return t >= 2 && t <= reach && u >= 0 && u <= 1
      ? { x: p.x + direction.x * t, z: p.z + direction.z * t, elevation: 0, distance: t } : null;
  };
  const cast = (p, direction, minimum = 0, maximum = 4200) => {
    let best;
    for (const s of index.along(p, direction, maximum)) {
      const hit = crossing(p, direction, s, maximum);
      if (hit && hit.distance >= minimum && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  };
  const parallelClear = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length < 1) return false;
    const nearby = index.query(Math.min(a.x, b.x) - 80, Math.min(a.z, b.z) - 80, Math.max(a.x, b.x) + 80, Math.max(a.z, b.z) + 80);
    for (const s of nearby) {
      const ex = s.b.x - s.a.x, ez = s.b.z - s.a.z;
      if (Math.abs(dx * ex + dz * ez) / (length * Math.hypot(ex, ez)) < .94) continue;
      const count = Math.ceil(length / 20);
      for (let i = 0; i <= count; i++) {
        const t = i / count, hit = nearestOnSegment(a.x + dx * t, a.z + dz * t, s.a, s.b);
        if (hit.t > .001 && hit.t < .999 && hit.distance < 76) return false;
      }
    }
    return true;
  };
  // Chamfer bends into two gentle corners so road slabs and the outside driving
  // lane stay supported without a large miter or a square U-turn at the quay.
  const bevel = controls => {
    const result = [controls[0]];
    for (let i = 1; i < controls.length - 1; i++) {
      const a = controls[i - 1], p = controls[i], b = controls[i + 1];
      const before = Math.hypot(p.x - a.x, p.z - a.z), after = Math.hypot(b.x - p.x, b.z - p.z), size = Math.min(85, before * .22, after * .22);
      result.push({ x: p.x + (a.x - p.x) / before * size, z: p.z + (a.z - p.z) / before * size, elevation: 0 });
      result.push({ x: p.x + (b.x - p.x) / after * size, z: p.z + (b.z - p.z) / after * size, elevation: 0 });
    }
    result.push(controls.at(-1));
    return result;
  };
  const valid = controls => controls.slice(1).every((b, i) => clear(controls[i], b) && parallelClear(controls[i], b));
  const sites = [];
  for (let z = -5320; z <= 5320; z += 160) for (let x = -5320; x <= 5320; x += 160) {
    const p = { x, z, elevation: 0 };
    if (clear(p, { ...p, x: x + .01 })) sites.push({ ...p, distance: distanceToRoad(p), blocked: false });
  }
  let created = 0;
  const infillRoads = [];
  for (let pass = 0; pass < 600; pass++) {
    let site;
    for (const p of sites) if (!p.blocked && (!site || p.distance > site.distance)) site = p;
    if (!site || site.distance <= 185) break;
    const district = districtAt(site), fabric = fabrics[district.id];
    let controls;
    // Longitudinal and cross streets inherit the nearest neighborhood's angle.
    // Small alternative offsets preserve varied block sizes instead of imposing
    // a second citywide grid on top of the original local streets.
    for (const offset of [0, Math.PI / 2, -.12, Math.PI / 2 + .12]) {
      const angle = fabric.angle + offset, direction = { x: Math.cos(angle), z: Math.sin(angle) };
      const a = cast(site, direction), b = cast(site, { x: -direction.x, z: -direction.z });
      if (!a || !b || a.distance + b.distance > 6200) continue;
      const candidate = [a, site, b];
      if (valid(candidate)) { controls = candidate; break; }
    }
    if (!controls) {
      for (const offset of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const angle = fabric.angle + offset, back = { x: Math.cos(angle), z: Math.sin(angle) }, along = { x: -back.z, z: back.x };
        for (const width of [420, 660, 280]) {
          const a = { x: site.x - along.x * width / 2, z: site.z - along.z * width / 2, elevation: 0 };
          const b = { x: site.x + along.x * width / 2, z: site.z + along.z * width / 2, elevation: 0 };
          const start = cast(a, back), end = cast(b, back);
          if (!start || !end || start.distance > 2400 || end.distance > 2400) continue;
          const candidate = bevel([start, a, b, end]);
          if (valid(candidate)) { controls = candidate; break; }
        }
        if (controls) break;
      }
    }
    if (!controls) { site.blocked = true; continue; }
    const road = addRoad(`${district.id}-infill-${created++}`, `${district.name} Connecting Street`, controls, 10, 'local', { curved: false, district: district.id });
    addSegments(road);
    infillRoads.push(road);
    // Distances only decrease, so update the sample field against the new street
    // only instead of querying every existing road again after each insertion.
    for (const p of sites) {
      const before = p.distance;
      for (let i = 1; i < controls.length; i++) p.distance = Math.min(p.distance, nearestOnSegment(p.x, p.z, controls[i - 1], controls[i]).distance);
      if (p.distance < before - 50) p.blocked = false;
    }
  }

  // A distance-to-road field alone permits long, thin blocks between parallel
  // streets. Measure their actual junctions and add staggered cross streets so
  // infill has the same walkable block rhythm as the established neighborhoods.
  const spans = new Map(), attempted = new Set();
  const updateSpans = road => {
    let total = 0;
    const distances = [0], pieces = [];
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      pieces.push({ a, b, start: total, length });
      for (const other of index.query(Math.min(a.x, b.x) - .01, Math.min(a.z, b.z) - .01, Math.max(a.x, b.x) + .01, Math.max(a.z, b.z) + .01)) {
        if (other.road === road) continue;
        const ex = other.b.x - other.a.x, ez = other.b.z - other.a.z, determinant = dx * ez - dz * ex;
        if (Math.abs(determinant) < 1e-7) continue;
        const cx = other.a.x - a.x, cz = other.a.z - a.z;
        const t = (cx * ez - cz * ex) / determinant, u = (cx * dz - cz * dx) / determinant;
        if (t >= -.00001 && t <= 1.00001 && u >= -.00001 && u <= 1.00001) distances.push(total + Math.max(0, Math.min(1, t)) * length);
      }
      total += length;
    }
    distances.push(total); distances.sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < distances.length; i++) {
      const start = distances[i - 1], end = distances[i], length = end - start;
      if (length < 520) continue;
      const middle = (start + end) / 2, piece = pieces.find(p => p.start + p.length >= middle);
      const t = (middle - piece.start) / piece.length;
      const x = piece.a.x + (piece.b.x - piece.a.x) * t, z = piece.a.z + (piece.b.z - piece.a.z) * t;
      const key = `${road.id}:${Math.round(start)}:${Math.round(end)}`;
      if (!attempted.has(key)) gaps.push({ road, length, x, z, key, dx: (piece.b.x - piece.a.x) / piece.length, dz: (piece.b.z - piece.a.z) / piece.length });
    }
    spans.set(road, gaps);
  };
  for (const road of infillRoads) updateSpans(road);
  for (let pass = 0; pass < 350; pass++) {
    let gap;
    for (const gaps of spans.values()) for (const candidate of gaps) if (!gap || candidate.length > gap.length) gap = candidate;
    if (!gap) break;
    attempted.add(gap.key);
    const site = { x: gap.x, z: gap.z, elevation: 0 }, district = districtAt(site);
    let controls;
    for (const reach of [650, 350, 0]) {
      for (const angle of [0, .07, -.07]) {
        const direction = { x: -gap.dz * Math.cos(angle) - gap.dx * Math.sin(angle), z: gap.dx * Math.cos(angle) - gap.dz * Math.sin(angle) };
        const reverse = { x: -direction.x, z: -direction.z };
        const a = cast(site, direction, reach, 1200), b = cast(site, reverse, reach, 1200);
        const candidates = a && b ? [[a, site, b], [a, site], [site, b]] : a ? [[a, site]] : b ? [[site, b]] : [];
        for (const candidate of candidates) if (valid(candidate)) { controls = candidate; break; }
        if (controls) break;
      }
      if (controls) break;
    }
    if (!controls) { updateSpans(gap.road); continue; }
    const road = addRoad(`${district.id}-infill-${created++}`, `${district.name} Cross Street`, controls, 10, 'local', { curved: false, district: district.id });
    addSegments(road); infillRoads.push(road);
    // Only streets near this insertion can have gained an intersection.
    const touched = new Set([road]);
    for (let i = 1; i < controls.length; i++) {
      const a = controls[i - 1], b = controls[i];
      for (const s of index.query(Math.min(a.x, b.x) - 1, Math.min(a.z, b.z) - 1, Math.max(a.x, b.x) + 1, Math.max(a.z, b.z) + 1)) if (spans.has(s.road)) touched.add(s.road);
    }
    for (const street of touched) updateSpans(street);
  }
}
