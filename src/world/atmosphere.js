import * as THREE from 'three';

export function addSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(650, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vWorld; void main(){vWorld=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 vWorld; void main(){float h=normalize(vWorld).y; vec3 col=mix(vec3(.087,.13,.20),vec3(.016,.023,.055),smoothstep(0.,.72,h)); float glow=pow(max(0.,1.-abs(h-.07)),15.); col+=vec3(.065,.018,.07)*glow; gl_FragColor=vec4(col,1.);}`,
  })); scene.add(sky); return sky;
}
