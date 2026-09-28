// The original streets are drawn by city.js/world.js. Keep their centerlines
// available to terrain, junction paint and traffic without drawing a second layer.
export const CORE_STREETS = [-128, -64, 0, 64, 128];
export const REGIONAL_INNER_EDGE = 768;

export function streetPoint(u, v) {
  const fade = Math.min(1, Math.max(0, (Math.max(Math.abs(u), Math.abs(v)) - 816) / 650));
  // One continuous deformation keeps intersections joined and chunk borders seamless.
  return { x: u + fade * (60 * Math.sin(v / 430) + 18 * Math.sin(v / 170)), z: v + fade * 52 * Math.sin(u / 510) };
}

// Reserve the metropolitan streets that border the authored region before its
// buildings and trees are placed. These surfaces are rendered by Metropolis.
export const REGIONAL_GATEWAY_ROADS = [];
for (let s = -REGIONAL_INNER_EDGE; s <= REGIONAL_INNER_EDGE; s += 192) for (const horizontal of [false, true]) {
  const ranges = Math.abs(s) === REGIONAL_INNER_EDGE ? [[-864, 864]] : [[-864, -REGIONAL_INNER_EDGE], [REGIONAL_INNER_EDGE, 864]];
  for (const [start, end] of ranges) {
    const points = [];
    for (let t = start; t <= end; t += 48) points.push(horizontal ? streetPoint(t, s) : streetPoint(s, t));
    REGIONAL_GATEWAY_ROADS.push({ points, width: s % 768 === 0 ? 18 : 11 });
  }
}

export function samplePolyline(control, spacing = 6, closed = false) {
  const points = [], count = closed ? control.length : control.length - 1;
  for (let i = 0; i < count; i++) {
    const a = control[i], b = control[(i + 1) % control.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing));
    for (let j = 0; j < steps; j++) points.push({ x: a[0] + (b[0] - a[0]) * j / steps, z: a[1] + (b[1] - a[1]) * j / steps });
  }
  const last = closed ? control[0] : control.at(-1);
  points.push({ x: last[0], z: last[1] });
  return points;
}

const authored = (name, control) => ({ name, width: 15, points: samplePolyline(control), authored: true });
export const CORE_ROADS = [
  ...CORE_STREETS.flatMap(s => [
    authored('Old Quarter street', [[s, -145], [s, 145]]),
    authored('Old Quarter street', [[-145, s], [145, s]]),
  ]),
  ...[-192, 0, 192].flatMap(s => [
    authored('District avenue', [[s, s === 0 ? -230 : -275], [s, 275]]),
    authored('District avenue', [[-275, s], [s === 0 ? 210 : 275, s]]),
  ]),
];

export function nearestRoadPoint(point, roads) {
  let nearest = null;
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], dx = b.x - a.x, dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared)) : 0;
    const x = a.x + dx * t, z = a.z + dz * t, distance = Math.hypot(point.x - x, point.z - z);
    if (!nearest || distance < nearest.distance) nearest = { x, z, distance, road };
  }
  return nearest;
}
