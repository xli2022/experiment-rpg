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
