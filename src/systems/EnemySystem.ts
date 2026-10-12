import * as THREE from 'three';
import { createSlime, stepSlime } from '../ai/slime';
import type { GameContext, System } from '../core/Game';
import { createTransform } from '../core/ecs/components';
import type { Entity } from '../core/ecs/World';
import { createRng } from '../core/math';
import type { EnemyDef, ValleyConfig } from '../data/schemas';
import type { StaticColliders } from '../world/physics/StaticColliders';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import type { RenderSystem } from './RenderSystem';

const DEATH_SECONDS = 0.45;

/**
 * Enemigos del mundo (Fase 3: slimes). Ejecuta la IA a la escala de tiempo del mundo
 * (tiempo bala, parada de impacto), mantiene su física y su aspecto.
 */
export class EnemySystem implements System {
  readonly name = 'enemies';
  private readonly defs = new Map<string, EnemyDef>();
  private readonly visuals = new Map<Entity, SlimeVisual>();
  private readonly rng = createRng(1337);

  constructor(
    enemies: readonly EnemyDef[],
    private readonly playerEntity: Entity,
    private readonly terrain: TerrainGenerator,
    private readonly colliders: StaticColliders,
    private readonly renderSystem: RenderSystem,
    private readonly camera: THREE.Camera,
  ) {
    for (const e of enemies) this.defs.set(e.id, e);
  }

  def(id: string): EnemyDef {
    const d = this.defs.get(id);
    if (!d) throw new Error(`Enemigo desconocido: ${id}`);
    return d;
  }

  /** Coloca los enemigos de valley.json (al empezar o cargar partida). */
  spawnAll(ctx: GameContext, spawns: ValleyConfig['enemySpawns']): void {
    for (const e of ctx.world.query('enemy')) this.despawn(ctx, e);
    for (const sp of spawns) {
      const def = this.def(sp.enemy);
      for (let i = 0; i < sp.count; i++) {
        const a = (i / sp.count) * Math.PI * 2 + this.rng();
        const r = sp.radius * Math.sqrt(this.rng());
        const x = sp.position[0] + Math.cos(a) * r;
        const z = sp.position[1] + Math.sin(a) * r;
        this.spawn(ctx, def, x, z, sp.id);
      }
    }
  }

  spawn(ctx: GameContext, def: EnemyDef, x: number, z: number, spawnId: string): Entity {
    const y = this.groundAt(x, z, 1000);
    const e = ctx.world.createEntity();
    const brain = createSlime(def, x, y, z, this.rng());
    ctx.world.add(e, 'name', { value: def.id });
    ctx.world.add(e, 'transform', createTransform(x, y, z, brain.yaw));
    ctx.world.add(e, 'enemy', { defId: def.id, brain, spawnId, deadT: -1 });
    const v = new SlimeVisual(def);
    this.visuals.set(e, v);
    this.renderSystem.attach(e, v.root);
    return e;
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    const wdt = dt * ctx.time.worldScale;
    if (wdt <= 0) return;
    const { world } = ctx;
    const pt = world.require(this.playerEntity, 'transform');
    const p = world.require(this.playerEntity, 'player');
    const ch = world.require(this.playerEntity, 'character');
    // Agachado se detecta desde la mitad de distancia (la Fase 4 completa la percepción).
    const crouching = ctx.input.isDown('crouch') && ch.grounded;
    const perception = { x: pt.x, y: pt.y, z: pt.z, detectFactor: crouching ? 0.5 : 1, alive: p.control === 'free' && p.health.fragments > 0 };

    const list = world.query('enemy', 'transform');
    for (const e of list) {
      const en = world.require(e, 'enemy');
      const def = this.def(en.defId);
      const b = en.brain;
      if (en.deadT >= 0) {
        en.deadT += wdt;
        if (en.deadT >= DEATH_SECONDS) this.despawn(ctx, e);
        continue;
      }
      const ev = stepSlime(b, def, perception, (x, z) => this.groundAt(x, z, b.y + 1), this.rng, wdt);
      if (ev.noticed) ctx.bus.emit('enemy:noticed', { entity: e });
      if (b.mode === 'dead') en.deadT = 0;
    }

    // Separación entre enemigos (no se apilan).
    for (let i = 0; i < list.length; i++) {
      const a = world.get(list[i], 'enemy');
      if (!a || a.deadT >= 0) continue;
      for (let j = i + 1; j < list.length; j++) {
        const c = world.get(list[j], 'enemy');
        if (!c || c.deadT >= 0) continue;
        const dx = c.brain.x - a.brain.x;
        const dz = c.brain.z - a.brain.z;
        const d = Math.hypot(dx, dz);
        const min = this.def(a.defId).radius + this.def(c.defId).radius;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          a.brain.x -= (dx / d) * push;
          a.brain.z -= (dz / d) * push;
          c.brain.x += (dx / d) * push;
          c.brain.z += (dz / d) * push;
        }
      }
    }

    for (const e of world.query('enemy', 'transform')) {
      const b = world.require(e, 'enemy').brain;
      const t = world.require(e, 'transform');
      t.x = b.x;
      t.y = b.y;
      t.z = b.z;
      t.rotY = b.yaw;
    }
  }

  render(ctx: GameContext): void {
    const dt = ctx.time.frameDt * ctx.time.worldScale;
    for (const [e, v] of this.visuals) {
      const en = ctx.world.get(e, 'enemy');
      if (!en) continue;
      v.update(en.brain, this.def(en.defId), en.deadT, dt, this.camera);
    }
  }

  /** Altura del suelo para un enemigo (terreno o la cara superior de un colisionador). */
  groundAt(x: number, z: number, fromY: number): number {
    return Math.max(this.terrain.height(x, z), this.colliders.topAt(x, z, 0.3, fromY));
  }

  private despawn(ctx: GameContext, e: Entity): void {
    const v = this.visuals.get(e);
    if (v) {
      v.root.removeFromParent();
      v.dispose();
      this.visuals.delete(e);
    }
    ctx.world.destroyEntity(e);
  }
}

const eyeMat = new THREE.MeshBasicMaterial({ color: '#10241a' });
const barBg = new THREE.MeshBasicMaterial({ color: '#1a0d0d', transparent: true, opacity: 0.75, depthTest: false });

/** Slime gelatinoso: cuerpo translúcido con núcleo, ojos, squash & stretch y barra de vida. */
class SlimeVisual {
  readonly root = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly core: THREE.Mesh;
  private readonly bar = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly fillMat = new THREE.MeshBasicMaterial({ color: '#ff5b6e', depthTest: false });
  private readonly alert: THREE.Mesh;
  private t = Math.random() * 10;

  constructor(def: EnemyDef) {
    this.root.name = `enemy_${def.id}`;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.82, emissive: def.color, emissiveIntensity: 0.15 });
    const g = new THREE.SphereGeometry(def.radius, 20, 14);
    g.translate(0, def.radius, 0);
    this.body = new THREE.Mesh(g, this.bodyMat);
    this.body.scale.set(1, def.height / (def.radius * 2), 1);
    this.body.castShadow = true;
    this.root.add(this.body);
    this.core = new THREE.Mesh(new THREE.SphereGeometry(def.radius * 0.32, 10, 8), new THREE.MeshBasicMaterial({ color: '#e9ffd8' }));
    this.core.position.y = def.radius * 0.95;
    this.body.add(this.core);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(def.radius * 0.11, 8, 6), eyeMat);
      eye.position.set(side * def.radius * 0.32, def.radius * 1.25, def.radius * 0.82);
      this.body.add(eye);
    }
    // Barra de vida (oculta hasta recibir daño).
    const w = 0.9;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.1), barBg);
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.1).translate(w / 2, 0, 0), this.fillMat);
    this.fill.position.set(-w / 2, 0, 0.001);
    this.bar.add(bg, this.fill);
    this.bar.position.y = def.height + 0.45;
    this.bar.renderOrder = 10;
    this.bar.visible = false;
    this.root.add(this.bar);
    // "!" al detectar al jugador.
    this.alert = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.42), new THREE.MeshBasicMaterial({ color: '#ffd23a', depthTest: false }));
    this.alert.position.y = def.height + 0.75;
    this.alert.visible = false;
    this.root.add(this.alert);
  }

  update(b: { mode: string; squash: number; hp: number; sinceDamage: number; grounded: boolean; vy: number; t: number }, def: EnemyDef, deadT: number, dt: number, camera: THREE.Camera): void {
    this.t += dt;
    const baseY = def.height / (def.radius * 2);
    if (deadT >= 0) {
      // Estallido al morir.
      const k = Math.min(1, deadT / DEATH_SECONDS);
      this.body.scale.set(1 + k * 0.8, baseY * (1 - k * 0.7), 1 + k * 0.8);
      this.bodyMat.opacity = 0.82 * (1 - k);
      this.bar.visible = false;
      this.alert.visible = false;
      return;
    }
    const wobble = Math.sin(this.t * 6) * 0.03;
    const stretch = b.grounded ? -b.squash : Math.min(0.3, Math.abs(b.vy) * 0.04);
    this.body.scale.set(1 - stretch * 0.5 + wobble, baseY * (1 + stretch) - wobble, 1 - stretch * 0.5 + wobble);
    this.bodyMat.emissiveIntensity = b.mode === 'windup' ? 0.6 + 0.4 * Math.sin(this.t * 30) : 0.15;
    this.core.scale.setScalar(1 + Math.sin(this.t * 4) * 0.08);
    this.alert.visible = b.mode === 'alert';
    this.bar.visible = b.hp < def.hp && b.sinceDamage < 8;
    if (this.bar.visible) {
      this.fill.scale.x = Math.max(0, b.hp / def.hp);
      // Siempre de cara a la cámara.
      this.bar.quaternion.copy(camera.quaternion);
      this.bar.quaternion.premultiply(this.root.quaternion.clone().invert());
    }
    if (this.alert.visible) {
      this.alert.quaternion.copy(camera.quaternion);
      this.alert.quaternion.premultiply(this.root.quaternion.clone().invert());
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.bodyMat.dispose();
    this.fillMat.dispose();
  }
}
