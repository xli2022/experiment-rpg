// Static collision metadata stays resident even when its visual chunk is unloaded.
export class SpatialGrid {
  constructor(boxes = [], cellSize = 48) {
    this.cellSize = cellSize; this.cells = new Map(); this.size = 0;
    for (const box of boxes) this.add(box);
  }
  add(box) {
    const s = this.cellSize;
    for (let x = Math.floor(box.minX / s); x <= Math.floor(box.maxX / s); x++) {
      for (let z = Math.floor(box.minZ / s); z <= Math.floor(box.maxZ / s); z++) {
        const key = `${x},${z}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(box);
      }
    }
    this.size++;
  }
  query(minX, minZ, maxX, maxZ) {
    const found = new Set(), s = this.cellSize;
    for (let x = Math.floor(minX / s); x <= Math.floor(maxX / s); x++) {
      for (let z = Math.floor(minZ / s); z <= Math.floor(maxZ / s); z++) {
        for (const b of this.cells.get(`${x},${z}`) ?? []) {
          if (b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ) found.add(b);
        }
      }
    }
    return [...found];
  }
  near(x, z, radius) { return this.query(x - radius, z - radius, x + radius, z + radius); }
  along(origin, direction, distance) {
    const x = origin.x + direction.x * distance, z = origin.z + direction.z * distance;
    return this.query(Math.min(origin.x, x) - .5, Math.min(origin.z, z) - .5, Math.max(origin.x, x) + .5, Math.max(origin.z, z) + .5);
  }
}
