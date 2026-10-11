import * as THREE from 'three';
import { createRng } from '../../core/math';
import type { SkyState } from './DayNight';

/**
 * Cúpula de cielo con degradado cénit/horizonte, disco solar con halo, luna y estrellas.
 * Sigue a la cámara y no recibe niebla.
 */
export class Sky {
  readonly group = new THREE.Group();
  private readonly uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uNight: { value: 0 },
  };
  private readonly stars: THREE.Points;

  constructor(radius = 4500) {
    this.group.name = 'sky';
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = max(d.y, 0.0);
            vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
            // Bajo el horizonte: oscurece hacia el "suelo" del cielo.
            col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, d.y));
            float s = max(dot(d, uSunDir), 0.0);
            col += uSunColor * (pow(s, 900.0) * 3.0 + pow(s, 18.0) * 0.35) * (1.0 - uNight);
            // Luna: opuesta al sol.
            float m = max(dot(d, -uSunDir), 0.0);
            col += vec3(0.75, 0.82, 1.0) * (pow(m, 1400.0) * 2.0 + pow(m, 60.0) * 0.08) * uNight;
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    const rng = createRng(77);
    const count = 1400;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rng() * 2 - 1;
      const th = rng() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.05;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * r * radius * 0.95, y * radius * 0.95, Math.sin(th) * r * radius * 0.95], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: '#dfe9ff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);
  }

  apply(state: SkyState, cameraPos: THREE.Vector3, time: number): void {
    this.group.position.copy(cameraPos);
    this.uniforms.uZenith.value.setRGB(...state.zenith, THREE.SRGBColorSpace);
    this.uniforms.uHorizon.value.setRGB(...state.horizon, THREE.SRGBColorSpace);
    this.uniforms.uSunColor.value.setRGB(...state.light, THREE.SRGBColorSpace);
    this.uniforms.uSunDir.value.set(state.sunDir.x, state.sunDir.y, state.sunDir.z);
    this.uniforms.uNight.value = state.stars;
    const mat = this.stars.material as THREE.PointsMaterial;
    mat.opacity = state.stars * (0.85 + Math.sin(time * 1.7) * 0.05);
    this.stars.visible = state.stars > 0.01;
    this.stars.rotation.y = time * 0.002;
  }
}
