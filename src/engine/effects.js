import * as THREE from 'three';

// Short-lived combat and feedback effects: tracers, sparks, the damage flash
// and the hit marker. Any mode can use them; they never outlive half a second.
export function createEffects(scene) {
  const live = [];
  let time = 0, damageUntil = 0, hitUntil = 0;
  const flash = document.getElementById('damage-flash'), marker = document.getElementById('hitmarker');
  return {
    tracer(start, end, color = 0xeeffab, ttl = .065) {
      const geometry = new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]);
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: .95, depthWrite: false });
      const mesh = new THREE.Line(geometry, material); scene.add(mesh); live.push({ mesh, life: ttl, max: ttl });
    },
    sparks(position, color, count = 9) {
      const geometry = new THREE.BufferGeometry(), vertices = new Float32Array(count * 3), velocities = [];
      for (let i = 0; i < count; i++) {
        vertices.set([position.x, position.y, position.z], i * 3);
        velocities.push(new THREE.Vector3((Math.random() - .5) * 10, Math.random() * 6, (Math.random() - .5) * 10));
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      const mesh = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: .09, transparent: true, depthWrite: false }));
      scene.add(mesh); live.push({ mesh, life: .5, max: .5, velocities });
    },
    // Shards across a pane, thrown along its normal (away from whoever broke it) and falling.
    shatter(pane, direction, count = 46) {
      const geometry = new THREE.BufferGeometry(), vertices = new Float32Array(count * 3), velocities = [];
      const side = Math.sign(direction.x * pane.normal.x + direction.z * pane.normal.z) || -1, tx = -pane.normal.z, tz = pane.normal.x;
      for (let i = 0; i < count; i++) {
        const along = (Math.random() - .5) * pane.width, up = (Math.random() - .5) * pane.height;
        vertices.set([pane.x + tx * along, pane.y + up, pane.z + tz * along], i * 3);
        const out = side * (1 + Math.random() * 3.5), drift = (Math.random() - .5) * 2.4;
        velocities.push(new THREE.Vector3(pane.normal.x * out + tx * drift, Math.random() * 2.2 - .4, pane.normal.z * out + tz * drift));
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      const mesh = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xd2ecf4, size: .07, transparent: true, depthWrite: false }));
      scene.add(mesh); live.push({ mesh, life: 1.1, max: 1.1, velocities });
    },
    damageFlash(duration = .19) { damageUntil = time + duration; },
    hitMarker(duration = .13) { hitUntil = time + duration; },
    update(dt, now) {
      time = now;
      for (let i = live.length - 1; i >= 0; i--) {
        const effect = live[i]; effect.life -= dt;
        if (effect.life <= 0) { scene.remove(effect.mesh); effect.mesh.geometry.dispose(); effect.mesh.material.dispose(); live.splice(i, 1); continue; }
        effect.mesh.material.opacity = effect.life / effect.max;
        if (effect.velocities) {
          const attribute = effect.mesh.geometry.attributes.position;
          effect.velocities.forEach((velocity, j) => {
            velocity.y -= dt * 12;
            attribute.setXYZ(j, attribute.getX(j) + velocity.x * dt, attribute.getY(j) + velocity.y * dt, attribute.getZ(j) + velocity.z * dt);
          });
          attribute.needsUpdate = true;
        }
      }
      if (flash) flash.style.opacity = time < damageUntil ? '.35' : '0';
      if (marker) marker.style.opacity = time < hitUntil ? '1' : '0';
    },
    clear() { for (const effect of live.splice(0)) { scene.remove(effect.mesh); effect.mesh.geometry.dispose(); effect.mesh.material.dispose(); } damageUntil = hitUntil = 0; },
  };
}
