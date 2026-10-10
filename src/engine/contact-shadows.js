import * as THREE from 'three';

const TEXTURE_SIZE = 32;

function softShadowTexture() {
  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let z = 0; z < TEXTURE_SIZE; z++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const dx = (x + .5) / TEXTURE_SIZE * 2 - 1;
      const dz = (z + .5) / TEXTURE_SIZE * 2 - 1;
      const falloff = Math.max(0, 1 - dx * dx - dz * dz);
      const offset = (z * TEXTURE_SIZE + x) * 4;
      data[offset + 3] = Math.round(255 * falloff * falloff);
    }
  }
  const texture = new THREE.DataTexture(data, TEXTURE_SIZE, TEXTURE_SIZE);
  texture.name = 'Soft contact shadow';
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// Moving actors use a single inexpensive draw that follows their current pose.
// These quads never enter the slower, periodically refreshed world shadow map.
export function createContactShadows(scene, { capacity = 128 } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096) {
    throw new RangeError('Contact-shadow capacity must be an integer from 1 to 4096.');
  }
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  opacity.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('shadowOpacity', opacity);
  const texture = softShadowTexture();
  const material = new THREE.ShaderMaterial({
    name: 'Actor contact shadow',
    uniforms: { shadowMap: { value: texture } },
    vertexShader: `
      attribute float shadowOpacity;
      varying vec2 vUv;
      varying float vOpacity;
      void main() {
        vUv = uv;
        vOpacity = shadowOpacity;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D shadowMap;
      varying vec2 vUv;
      varying float vOpacity;
      void main() {
        float alpha = texture2D(shadowMap, vUv).a * vOpacity * 0.38;
        gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'Actor contact shadows';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // The caller already restricts actors by visibility and distance. Avoid stale
  // aggregate bounds when an actor crosses a chunk boundary or teleports.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.count = 0;
  mesh.visible = false;
  scene.add(mesh);
  const transform = new THREE.Object3D();
  let disposed = false;

  return {
    mesh,
    update(items) {
      if (disposed) return;
      let count = 0;
      for (const item of items) {
        if (count === capacity) break;
        const { x, y, z, width, length, yaw = 0, pitch = 0, roll = 0, opacity: strength = 1 } = item;
        if (![x, y, z, width, length, yaw, pitch, roll, strength].every(Number.isFinite)
          || width <= 0 || length <= 0 || strength <= 0) continue;
        transform.position.set(x, y, z);
        transform.rotation.set(pitch, yaw, roll, 'YXZ');
        transform.scale.set(width, 1, length);
        transform.updateMatrix();
        mesh.setMatrixAt(count, transform.matrix);
        opacity.setX(count, Math.min(1, strength));
        count++;
      }
      mesh.count = count;
      mesh.visible = count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      opacity.needsUpdate = true;
    },
    snapshot() {
      return { count: mesh.count, capacity, drawCalls: mesh.visible ? 1 : 0,
        triangles: mesh.count * 2, textureSize: TEXTURE_SIZE };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.count = 0;
      mesh.visible = false;
      mesh.removeFromParent();
      mesh.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
