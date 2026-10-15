import * as THREE from 'three';
import { stepProjectile, type Projectile, type ProjectileEvent, type ProjectileLook, type ProjectileWorld } from './projectiles';
import { buildWeaponModel } from './WeaponModels';

/** Proyectiles vivos y su aspecto (flechas en pool, armas lanzadas girando). */
export class ProjectileManager {
  readonly group = new THREE.Group();
  readonly list: Projectile[] = [];
  private readonly views = new Map<number, THREE.Object3D>();
  private readonly arrowPool: THREE.Group[] = [];
  private nextId = 1;
  /** Brillo en la punta de las flechas elementales. */
  private readonly glowMats: Record<string, THREE.MeshBasicMaterial> = {
    fire: new THREE.MeshBasicMaterial({ color: '#ff8a3a', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }),
    ice: new THREE.MeshBasicMaterial({ color: '#9fefff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }),
    shock: new THREE.MeshBasicMaterial({ color: '#fff27a', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }),
  };

  constructor() {
    this.group.name = 'projectiles';
    const shaft = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 5).rotateX(Math.PI / 2);
    const head = new THREE.ConeGeometry(0.03, 0.1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.45);
    const fletch = new THREE.BoxGeometry(0.06, 0.005, 0.12).translate(0, 0, -0.34);
    const wood = new THREE.MeshStandardMaterial({ color: '#c9b48a', roughness: 0.8 });
    const tip = new THREE.MeshStandardMaterial({ color: '#8d8a80', metalness: 0.5 });
    const feather = new THREE.MeshStandardMaterial({ color: '#e8e2d4' });
    const glowGeo = new THREE.SphereGeometry(0.09, 8, 6).translate(0, 0, 0.42);
    for (let i = 0; i < 40; i++) {
      const g = new THREE.Group();
      const glow = new THREE.Mesh(glowGeo, this.glowMats.fire);
      glow.name = 'glow';
      glow.visible = false;
      g.add(new THREE.Mesh(shaft, wood), new THREE.Mesh(head, tip), new THREE.Mesh(fletch, feather), glow);
      g.visible = false;
      this.group.add(g);
      this.arrowPool.push(g);
    }
  }

  spawn(p: Omit<Projectile, 'id' | 'age' | 'stuck' | 'alive' | 'reflected'>, model?: { kind: string; length: number; color: string }): Projectile {
    const proj: Projectile = { ...p, id: this.nextId++, age: 0, stuck: false, alive: true, reflected: false };
    this.list.push(proj);
    let view: THREE.Object3D | undefined;
    if (proj.kind === 'arrow') {
      view = this.arrowPool.find((g) => !g.visible);
      if (!view) {
        // Pool agotado: se recicla la flecha más antigua.
        const oldest = this.list.find((q) => q.kind === 'arrow' && this.views.has(q.id) && q !== proj);
        if (oldest) {
          view = this.views.get(oldest.id);
          this.views.delete(oldest.id);
          oldest.alive = false;
        }
      }
      if (view) {
        view.visible = true;
        const glow = view.getObjectByName('glow') as THREE.Mesh | undefined;
        if (glow) {
          const m = proj.element ? this.glowMats[proj.element] : undefined;
          glow.visible = m !== undefined;
          if (m) glow.material = m;
        }
      }
    } else if (proj.kind === 'missile') {
      view = this.missileView(proj.look ?? 'rock', proj.size ?? 0.2);
      this.group.add(view);
    } else if (model) {
      view = buildWeaponModel(model.kind, model.length, model.color).group;
      this.group.add(view);
    }
    if (view) this.views.set(proj.id, view);
    return proj;
  }

  private readonly missileGeo = {
    rock: new THREE.DodecahedronGeometry(1, 0),
    goo: new THREE.SphereGeometry(1, 10, 8),
    spark: new THREE.OctahedronGeometry(1, 0),
    fireball: new THREE.IcosahedronGeometry(1, 1),
    iceshard: new THREE.OctahedronGeometry(1, 0),
  };
  private readonly missileMat = {
    rock: new THREE.MeshStandardMaterial({ color: '#7d766b', roughness: 0.95, flatShading: true }),
    goo: new THREE.MeshStandardMaterial({ color: '#a45be0', emissive: '#5a1f8a', emissiveIntensity: 0.6, transparent: true, opacity: 0.85 }),
    spark: new THREE.MeshBasicMaterial({ color: '#fff27a' }),
    fireball: new THREE.MeshBasicMaterial({ color: '#ff8a3a', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }),
    iceshard: new THREE.MeshStandardMaterial({ color: '#cff4ff', emissive: '#4ab8e8', emissiveIntensity: 0.8, flatShading: true }),
  };

  /** Rocas, gelatina tóxica y chispas (las flechas enemigas usan el pool de flechas). */
  private missileView(look: ProjectileLook, size: number): THREE.Object3D {
    const key = look === 'arrow' ? 'rock' : look;
    const m = new THREE.Mesh(this.missileGeo[key], this.missileMat[key]);
    m.scale.setScalar(size);
    m.castShadow = true;
    return m;
  }

  /** Avanza todos los proyectiles; `onEvent` recibe cada impacto. */
  update(world: ProjectileWorld, dt: number, onEvent: (p: Projectile, e: ProjectileEvent) => void): void {
    for (const p of this.list) {
      const e = stepProjectile(p, world, dt);
      if (e) onEvent(p, e);
      const v = this.views.get(p.id);
      if (!v) continue;
      v.position.set(p.x, p.y, p.z);
      if (!p.stuck) {
        if (p.kind === 'arrow') {
          v.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
        } else if (p.kind === 'missile') {
          v.rotation.x += dt * 5;
          v.rotation.z += dt * 3;
        } else {
          v.rotation.x += dt * 18; // arma girando en el aire
          v.rotation.y = Math.atan2(p.vx, p.vz);
        }
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.alive) continue;
      const v = this.views.get(p.id);
      if (v) {
        if (p.kind === 'arrow') v.visible = false;
        else v.removeFromParent();
        this.views.delete(p.id);
      }
      this.list.splice(i, 1);
    }
  }
}
