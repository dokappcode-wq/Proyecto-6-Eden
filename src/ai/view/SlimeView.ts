import * as THREE from 'three';
import type { EnemyDef } from '../../data/schemas';
import type { Brain } from '../brain';
import { disposeTree, Overhead, type EnemyView } from './Overhead';

export const SLIME_DEATH_SECONDS = 0.45;
const eyeMat = new THREE.MeshBasicMaterial({ color: '#10241a' });

/**
 * Slime gelatinoso: cuerpo translúcido con núcleo (punto débil), ojos y squash & stretch.
 * Tóxico: burbujas violetas. Eléctrico: chispas y destellos cuando está cargado.
 * Gigante: varios núcleos dentro (se divide al morir).
 */
export class SlimeView implements EnemyView {
  readonly root = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly cores: THREE.Mesh[] = [];
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly extras: THREE.Mesh[] = [];
  private readonly extraMat: THREE.MeshBasicMaterial | null = null;
  private readonly overhead: Overhead;
  private t = Math.random() * 10;

  constructor(def: EnemyDef) {
    this.root.name = `enemy_${def.id}`;
    const r = def.radius;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.82, emissive: def.color, emissiveIntensity: 0.15 });
    const g = new THREE.SphereGeometry(r, 22, 16);
    g.translate(0, r, 0);
    this.body = new THREE.Mesh(g, this.bodyMat);
    this.body.scale.set(1, def.height / (r * 2), 1);
    this.body.castShadow = true;
    this.root.add(this.body);
    const coreMat = new THREE.MeshBasicMaterial({ color: def.variant === 'toxic' ? '#f3d8ff' : def.variant === 'electric' ? '#fffbe0' : '#e9ffd8' });
    const nCores = def.variant === 'giant' ? 3 : 1;
    for (let i = 0; i < nCores; i++) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(r * (nCores > 1 ? 0.18 : 0.32), 10, 8), coreMat);
      const a = (i / nCores) * Math.PI * 2;
      core.position.set(nCores > 1 ? Math.cos(a) * r * 0.35 : 0, r * 0.95, nCores > 1 ? Math.sin(a) * r * 0.35 : 0);
      this.body.add(core);
      this.cores.push(core);
    }
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.11, 8, 6), eyeMat);
      eye.position.set(side * r * 0.32, r * 1.25, r * 0.82);
      this.body.add(eye);
    }
    if (def.variant === 'toxic' || def.variant === 'electric') {
      this.extraMat = new THREE.MeshBasicMaterial({ color: def.variant === 'toxic' ? '#d79bff' : '#fff27a', transparent: true, opacity: 0.85 });
      const geo = def.variant === 'toxic' ? new THREE.SphereGeometry(r * 0.12, 8, 6) : new THREE.OctahedronGeometry(r * 0.12, 0);
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(geo, this.extraMat);
        this.root.add(m);
        this.extras.push(m);
      }
    }
    this.overhead = new Overhead(def.height, Math.max(0.9, r * 1.4), !def.boss);
    this.root.add(this.overhead.group);
  }

  update(b: Brain, def: EnemyDef, deadT: number, dt: number): void {
    this.t += dt;
    this.overhead.update(b, def, dt);
    const baseY = def.height / (def.radius * 2);
    if (deadT >= 0) {
      // Estallido al morir.
      const k = Math.min(1, deadT / SLIME_DEATH_SECONDS);
      this.body.scale.set(1 + k * 0.8, baseY * (1 - k * 0.7), 1 + k * 0.8);
      this.bodyMat.opacity = 0.82 * (1 - k);
      for (const e of this.extras) e.visible = false;
      return;
    }
    const wobble = Math.sin(this.t * 6) * 0.03;
    const stretch = b.grounded ? -b.squash : Math.min(0.3, Math.abs(b.vy) * 0.04);
    this.body.scale.set(1 - stretch * 0.5 + wobble, baseY * (1 + stretch) - wobble, 1 - stretch * 0.5 + wobble);
    const windup = b.attack?.phase === 'windup';
    let glow = windup ? 0.6 + 0.4 * Math.sin(this.t * 30) : 0.15;
    if (def.variant === 'electric' && b.charged) glow = 0.9 + 0.6 * Math.abs(Math.sin(this.t * 41));
    this.bodyMat.emissiveIntensity = glow;
    for (const c of this.cores) c.scale.setScalar(1 + Math.sin(this.t * 4 + c.position.x) * 0.08);
    // Burbujas tóxicas que suben / chispas que orbitan.
    this.extras.forEach((m, i) => {
      const r = def.radius;
      if (def.variant === 'toxic') {
        const ph = (this.t * 0.6 + i / this.extras.length) % 1;
        const a = i * 2.4;
        m.position.set(Math.cos(a) * r * 0.7, def.height * (0.2 + ph * 1.1), Math.sin(a) * r * 0.7);
        m.scale.setScalar(1 - ph * 0.6);
        m.visible = true;
      } else {
        const a = this.t * 6 + i * 1.26;
        m.position.set(Math.cos(a) * r * 1.15, def.height * 0.5 + Math.sin(this.t * 9 + i) * r * 0.4, Math.sin(a) * r * 1.15);
        m.visible = b.charged && Math.sin(this.t * 37 + i * 3) > -0.2;
      }
    });
  }

  dispose(): void {
    disposeTree(this.root);
    this.bodyMat.dispose();
    this.extraMat?.dispose();
    this.overhead.dispose();
  }
}
