import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { seededRandom } from '../core/physics.js';
import { pointInConvex } from '../core/geometry.js';
import { RENDER_PROFILES } from '../core/quality.js';
import { toLocal } from './interior-physics.js';

// The night sky, moonlight and weather shared by every view of the city.
export const MOON_POSITION = Object.freeze({ x: -45, y: 85, z: 25 });

export function addSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(650, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vWorld; void main(){vWorld=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 vWorld; void main(){float h=normalize(vWorld).y; vec3 col=mix(vec3(.087,.13,.20),vec3(.016,.023,.055),smoothstep(0.,.72,h)); float glow=pow(max(0.,1.-abs(h-.07)),15.); col+=vec3(.065,.018,.07)*glow; gl_FragColor=vec4(col,1.);}`,
  })); scene.add(sky); return sky;
}

export function addWeather(scene) {
  const random = seededRandom(92311), positions = new Float32Array(1100 * 6), motesArray = new Float32Array(160 * 3);
  for (let i = 0; i < 1100; i++) {
    const x = random() * 90 - 45, y = random() * 37, z = random() * 90 - 45;
    positions.set([x, y, z, x - .055, y + .52, z], i * 6);
  }
  const rainGeometry = new THREE.BufferGeometry(); rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0x8db3ce, transparent: true, opacity: .16, depthWrite: false }));
  rain.frustumCulled = false; scene.add(rain);
  for (let i = 0; i < 160; i++) motesArray.set([random() * 100 - 50, random() * 9 + .3, random() * 100 - 50], i * 3);
  const motesGeometry = new THREE.BufferGeometry(); motesGeometry.setAttribute('position', new THREE.BufferAttribute(motesArray, 3));
  const motes = new THREE.Points(motesGeometry, new THREE.PointsMaterial({ color: 0xc3ffe4, size: .05, transparent: true, opacity: .4, depthWrite: false }));
  scene.add(motes); return { rain, motes };
}

export function createAtmosphere(scene, { renderer = null, quality = 'high' } = {}) {
  scene.fog = new THREE.FogExp2(0x1b2940, .0035);
  const sky = addSky(scene), { rain, motes } = addWeather(scene);
  const hemisphere = new THREE.HemisphereLight(0xb9d9fc, 0x3a3051, 1.7);
  const moon = new THREE.DirectionalLight(0xc5d8ff, 2.3); moon.position.set(MOON_POSITION.x, MOON_POSITION.y, MOON_POSITION.z);
  const rim = new THREE.DirectionalLight(0xb282c9, .7); rim.position.set(40, 20, -45);
  scene.add(hemisphere, moon, rim);
  let environment = null;
  if (renderer) {
    const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromScene(room, .025); scene.environment = environment.texture; scene.environmentIntensity = .24;
    room.dispose(); pmrem.dispose();
  }
  const atmosphere = {
    sky, rain, motes, moon, hemisphere, rim,
    setQuality(value, far = 720) {
      scene.fog.density = value === 'high' ? .0035 : .005;
      sky.scale.setScalar(far / 700);
      rain.geometry.setDrawRange(0, RENDER_PROFILES[value].rain * 2);
    },
    // Rain and motes follow the focus; both stay outside the occupied building.
    update({ camera, focus, interior = null, dt = 0 }) {
      sky.position.copy(camera.position);
      const positions = rain.geometry.attributes.position;
      for (let i = 0; i < rain.geometry.drawRange.count; i += 2) {
        let y = positions.getY(i) - dt * 15; if (y < 0) y = 37;
        positions.setY(i, y); positions.setY(i + 1, y + .52);
      }
      positions.needsUpdate = true; rain.position.set(focus.x, focus.y, focus.z); motes.position.set(focus.x, focus.y, focus.z); motes.rotation.y += dt * .012;
      const plan = interior?.plan, local = plan && toLocal(plan, camera.position.x, camera.position.z);
      rain.visible = motes.visible = !(plan && camera.position.y < plan.top && pointInConvex(plan.outline, local.x, local.z));
    },
    dispose() {
      for (const object of [sky, rain, motes, hemisphere, moon, rim]) { scene.remove(object); object.geometry?.dispose(); object.material?.dispose(); }
      environment?.dispose(); scene.fog = null;
    },
  };
  atmosphere.setQuality(quality);
  return atmosphere;
}
