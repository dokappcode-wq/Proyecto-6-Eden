import * as THREE from 'three';
import type { WeatherType } from '../../data/schemas';

const RAIN = 5000;
const FLAKES = 3500;
const BOX = 46;
const HEIGHT = 30;

/**
 * Precipitación alrededor de la cámara: lluvia (trazos inclinados por el viento),
 * nieve (copos que flotan) y arena (partículas horizontales). Pool fijo; la intensidad
 * controla cuántas se dibujan.
 */
export class WeatherView {
  readonly group = new THREE.Group();
  private readonly rain: THREE.LineSegments;
  private readonly rainPos: Float32Array;
  private readonly flakes: THREE.Points;
  private readonly flakePos: Float32Array;
  private readonly flakeMat: THREE.PointsMaterial;
  private readonly seeds: Float32Array;
  private t = 0;

  constructor() {
    this.group.name = 'weather';
    this.rainPos = new Float32Array(RAIN * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#aab8c8', transparent: true, opacity: 0.45, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.flakePos = new Float32Array(FLAKES * 3);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.flakePos, 3));
    this.flakeMat = new THREE.PointsMaterial({ color: '#ffffff', size: 0.12, transparent: true, opacity: 0.9, depthWrite: false });
    this.flakes = new THREE.Points(fg, this.flakeMat);
    this.flakes.frustumCulled = false;
    this.seeds = new Float32Array(Math.max(RAIN, FLAKES) * 3);
    for (let i = 0; i < this.seeds.length; i++) this.seeds[i] = Math.random();
    this.group.add(this.rain, this.flakes);
  }

  update(cam: THREE.Vector3, type: WeatherType, intensity: number, windX: number, windZ: number, dt: number): void {
    this.t += dt;
    const raining = type === 'rain' || type === 'storm';
    const flaky = type === 'snow' || type === 'sandstorm';
    this.rain.visible = raining && intensity > 0.02;
    this.flakes.visible = flaky && intensity > 0.02;
    if (this.rain.visible) {
      const n = Math.floor(RAIN * intensity * (type === 'storm' ? 1 : 0.6));
      const fall = 26;
      const len = 0.9;
      for (let i = 0; i < n; i++) {
        const sx = this.seeds[i * 3];
        const sz = this.seeds[i * 3 + 1];
        const sy = this.seeds[i * 3 + 2];
        // Cada gota cae en bucle dentro de una caja centrada en la cámara.
        const y = HEIGHT - ((sy * HEIGHT + this.t * fall) % HEIGHT);
        const drift = (HEIGHT - y) / fall;
        const x = cam.x + wrap(sx * BOX + windX * drift - cam.x, BOX);
        const z = cam.z + wrap(sz * BOX + windZ * drift - cam.z, BOX);
        const o = i * 6;
        this.rainPos[o] = x;
        this.rainPos[o + 1] = cam.y - HEIGHT * 0.4 + y;
        this.rainPos[o + 2] = z;
        this.rainPos[o + 3] = x - windX * 0.03;
        this.rainPos[o + 4] = cam.y - HEIGHT * 0.4 + y + len;
        this.rainPos[o + 5] = z - windZ * 0.03;
      }
      this.rain.geometry.setDrawRange(0, n * 2);
      (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.flakes.visible) {
      const sand = type === 'sandstorm';
      const n = Math.floor(FLAKES * intensity);
      const fall = sand ? 1.5 : 2.2;
      this.flakeMat.color.set(sand ? '#d9a35f' : '#ffffff');
      this.flakeMat.size = sand ? 0.08 : 0.13;
      for (let i = 0; i < n; i++) {
        const sx = this.seeds[i * 3];
        const sz = this.seeds[i * 3 + 1];
        const sy = this.seeds[i * 3 + 2];
        const y = HEIGHT - ((sy * HEIGHT + this.t * fall) % HEIGHT);
        const sway = Math.sin(this.t * 1.3 + i) * (sand ? 0.2 : 0.6);
        const x = cam.x + wrap(sx * BOX + windX * this.t * (sand ? 1 : 0.35) + sway - cam.x, BOX);
        const z = cam.z + wrap(sz * BOX + windZ * this.t * (sand ? 1 : 0.35) - cam.z, BOX);
        this.flakePos[i * 3] = x;
        this.flakePos[i * 3 + 1] = cam.y - HEIGHT * (sand ? 0.15 : 0.4) + y * (sand ? 0.35 : 1);
        this.flakePos[i * 3 + 2] = z;
      }
      this.flakes.geometry.setDrawRange(0, n);
      (this.flakes.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}

/** Envuelve un desplazamiento a [-box/2, box/2). */
function wrap(v: number, box: number): number {
  return ((((v + box / 2) % box) + box) % box) - box / 2;
}
