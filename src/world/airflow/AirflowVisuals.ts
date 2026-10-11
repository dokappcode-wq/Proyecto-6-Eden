import * as THREE from 'three';
import { createRng } from '../../core/math';
import { ANCESTRAL_CYAN, materials } from '../props/kit';
import type { Airflow } from './Airflow';

/**
 * Corrientes visibles: columnas de partículas animadas en GPU (sin coste de CPU por partícula).
 * Chimeneas ancestrales en cian; aire caliente como destellos tenues.
 */
export class AirflowVisuals {
  readonly group = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];

  constructor(airflow: Airflow) {
    this.group.name = 'airflow';
    for (const t of airflow.thermalList) {
      const vent = t.kind === 'ancestral_vent';
      if (vent) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(t.radius, 0.35, 8, 40).rotateX(Math.PI / 2), materials.stoneDark);
        ring.position.set(t.x, t.baseY + 0.15, t.z);
        ring.receiveShadow = true;
        this.group.add(ring);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(t.radius * 0.92, 40).rotateX(-Math.PI / 2), materials.rune);
        disc.position.set(t.x, t.baseY + 0.08, t.z);
        this.group.add(disc);
      }
      this.group.add(this.column(t.x, t.baseY, t.z, t.radius, t.height, vent));
    }
  }

  update(time: number): void {
    for (const m of this.materials) m.uniforms.uTime.value = time;
  }

  private column(x: number, y: number, z: number, radius: number, height: number, vent: boolean): THREE.Points {
    const count = vent ? 260 : 120;
    const rng = createRng(Math.round(x * 13 + z * 7));
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) seeds.set([rng(), rng(), rng()], i * 3);
    const g = new THREE.BufferGeometry();
    // La posición real se calcula en el shader; el atributo position solo da el volumen para el culling.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), height);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: vent ? height : height * 0.6 },
        uRadius: { value: radius },
        uSpeed: { value: vent ? 9 : 3 },
        uColor: { value: vent ? ANCESTRAL_CYAN.clone() : new THREE.Color('#ffe2b8') },
        uAlpha: { value: vent ? 0.9 : 0.35 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 seed;
        uniform float uTime; uniform float uHeight; uniform float uRadius; uniform float uSpeed;
        varying float vFade;
        void main() {
          float h = mod(seed.x * uHeight + uTime * uSpeed * (0.6 + seed.y * 0.8), uHeight);
          float a = seed.z * 6.2831 + h * 0.15 + uTime * 0.6;
          float r = uRadius * sqrt(seed.y) * (1.0 - h / uHeight * 0.3);
          vec3 p = vec3(cos(a) * r, h, sin(a) * r);
          vFade = smoothstep(0.0, 0.08, h / uHeight) * (1.0 - smoothstep(0.7, 1.0, h / uHeight));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (2.0 + seed.y * 3.0) * (120.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; varying float vFade;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = 1.0 - smoothstep(0.2, 0.5, length(c));
          gl_FragColor = vec4(uColor, d * vFade * uAlpha);
        }`,
    });
    this.materials.push(mat);
    const pts = new THREE.Points(g, mat);
    pts.position.set(x, y, z);
    return pts;
  }
}
