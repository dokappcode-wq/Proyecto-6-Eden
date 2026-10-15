import * as THREE from 'three';
import type { HitFx } from '../combat/HitFx';
import type { GameContext, System } from '../core/Game';
import { createTransform } from '../core/ecs/components';
import type { Entity } from '../core/ecs/World';
import { createRng, DEG2RAD, wrapAngle } from '../core/math';
import type { MobilityConfig, MountKind, MountKindDef, PlayerConfig, StaminaConfig } from '../data/schemas';
import type { CharacterState } from '../player/CharacterController';
import { createMotion, createTame, stepMotion, stepTaming, type MountMotion, type TameState } from '../player/mobility/mount';
import { stepRaft, type RaftState } from '../player/mobility/raft';
import { spendRate, updateStamina } from '../player/movement/Stamina';
import type { AirSample } from '../world/airflow/Airflow';
import { emptyAir } from '../world/airflow/Airflow';
import { MountView } from '../world/mounts/MountView';
import type { StaticColliders } from '../world/physics/StaticColliders';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import type { CombatSystem } from './CombatSystem';
import type { ElementSystem } from './ElementSystem';
import type { EnemySystem } from './EnemySystem';
import type { DriverInput, MovementDriver, PlayerSystem } from './PlayerSystem';

export interface MountDeps {
  cfg: MobilityConfig;
  player: PlayerConfig;
  stamina: StaminaConfig;
  playerEntity: Entity;
  playerSystem: PlayerSystem;
  terrain: TerrainGenerator;
  colliders: StaticColliders;
  elements: ElementSystem;
  enemies: EnemySystem;
  combat: CombatSystem;
  scene: THREE.Scene;
  fx: HitFx;
  airflow: (x: number, y: number, z: number, out: AirSample) => AirSample;
}

type MountState = 'wander' | 'idle' | 'flee' | 'come' | 'ridden' | 'taming';

interface Mount {
  id: string;
  kind: MountKind;
  def: MountKindDef;
  name: string;
  x: number;
  y: number;
  z: number;
  vy: number;
  motion: MountMotion;
  owned: boolean;
  herd: MobilityConfig['mounts']['herds'][number] | null;
  state: MountState;
  stateT: number;
  tx: number;
  tz: number;
  view: MountView;
  entity: Entity;
  buck: number;
}

interface Raft {
  id: string;
  s: RaftState;
  y: number;
  object: THREE.Group;
  sail: THREE.Mesh;
  entity: Entity;
}

export interface SavedMount {
  kind: string;
  name: string;
  x: number;
  z: number;
}

const air = emptyAir();

/**
 * Monturas (corcel veloz, ciervo resistente, bisonte tanque): manadas salvajes que huyen si
 * te ven, doma acercándose agachado y calmándolas, espuelas con recarga, silbido para llamar
 * a la tuya. Balsas de vela empujadas por el viento (y por la Semilla de Vendaval).
 */
export class MountSystem implements System {
  readonly name = 'mounts';
  readonly group = new THREE.Group();
  readonly mounts: Mount[] = [];
  readonly rafts: Raft[] = [];
  private nextId = 1;
  private readonly rng = createRng(4242);
  readonly ride: RideDriver;
  readonly raftDriver: RaftDriver;

  constructor(
    private readonly d: MountDeps,
    ctx: GameContext,
  ) {
    this.group.name = 'mounts';
    d.scene.add(this.group);
    this.ride = new RideDriver(this, d);
    this.raftDriver = new RaftDriver(this, d);
    for (const h of d.cfg.mounts.herds) {
      for (let i = 0; i < h.count; i++) {
        const a = (i / h.count) * Math.PI * 2 + this.rng();
        const r = h.radius * (0.3 + this.rng() * 0.5);
        this.addMount(ctx, h.kind, h.position[0] + Math.cos(a) * r, h.position[1] + Math.sin(a) * r, false, h);
      }
    }
    for (const r of d.cfg.rafts.list) this.addRaft(ctx, r.id, r.position[0], r.position[1]);

    ctx.bus.on('interact', ({ id, kind }) => {
      if (kind === 'mount') this.onMountInteract(ctx, id.slice(6));
      else if (kind === 'raft') this.boardRaft(ctx, id.slice(5));
    });
    ctx.bus.on('input:action', ({ action, phase }) => {
      if (action === 'whistle' && phase === 'pressed' && ctx.session.mode === 'play') this.whistle(ctx);
    });
    // La ráfaga de la Semilla de Vendaval empuja las balsas.
    ctx.bus.on('world:explosion', ({ x, z, radius, kind }) => {
      if (kind !== 'wind') return;
      for (const r of this.rafts) {
        const dx = r.s.x - x;
        const dz = r.s.z - z;
        const dist = Math.hypot(dx, dz);
        if (dist > radius * 1.8) continue;
        const k = 1 - dist / (radius * 1.8);
        r.s.vx += (dx / (dist || 1)) * d.cfg.windBomb.force * 0.3 * k;
        r.s.vz += (dz / (dist || 1)) * d.cfg.windBomb.force * 0.3 * k;
      }
    });
  }

  // ------------------------------------------------------------------ creación

  private addMount(ctx: GameContext, kind: MountKind, x: number, z: number, owned: boolean, herd: Mount['herd'], name?: string): Mount {
    const def = this.d.cfg.mounts.kinds[kind];
    const view = new MountView(kind, def);
    this.group.add(view.root);
    const id = `m${this.nextId++}`;
    const y = this.d.terrain.height(x, z);
    const e = ctx.world.createEntity();
    ctx.world.add(e, 'name', { value: `mount_${id}` });
    ctx.world.add(e, 'transform', createTransform(x, y, z));
    ctx.world.add(e, 'interactable', { id: `mount:${id}`, kind: 'mount', prompt: owned ? `Montar (${name ?? def.name})` : `Montar: domar ${def.name}`, radius: 3 * def.size, enabled: true });
    const m: Mount = { id, kind, def, name: name ?? def.name, x, y, z, vy: 0, motion: createMotion(def, this.rng() * Math.PI * 2), owned, herd, state: 'idle', stateT: this.rng() * 3, tx: x, tz: z, view, entity: e, buck: 0 };
    view.setSaddle(owned);
    this.mounts.push(m);
    return m;
  }

  private addRaft(ctx: GameContext, id: string, x: number, z: number): void {
    const object = new THREE.Group();
    const log = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.95 });
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 3.6, 8).rotateX(Math.PI / 2), log);
      l.position.set((i - 2) * 0.5, 0.12, 0);
      l.castShadow = l.receiveShadow = true;
      object.add(l);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 6), log);
    mast.position.set(0, 1.9, 0.5);
    object.add(mast);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.2), new THREE.MeshStandardMaterial({ color: '#efe6d2', side: THREE.DoubleSide, roughness: 0.9 }));
    sail.position.set(0, 2.2, 0.55);
    sail.castShadow = true;
    object.add(sail);
    const w = this.d.terrain.waterLevelAt(x, z) ?? this.d.terrain.height(x, z);
    this.group.add(object);
    const e = ctx.world.createEntity();
    ctx.world.add(e, 'name', { value: `raft_${id}` });
    ctx.world.add(e, 'transform', createTransform(x, w, z));
    ctx.world.add(e, 'interactable', { id: `raft:${id}`, kind: 'raft', prompt: 'Subir a la balsa', radius: 2.6, enabled: true });
    this.rafts.push({ id, s: { x, z, yaw: 0, vx: 0, vz: 0, sail: false }, y: w, object, sail, entity: e });
  }

  // ------------------------------------------------------------------ guardado

  saveOwned(): SavedMount[] {
    return this.mounts.filter((m) => m.owned).map((m) => ({ kind: m.kind, name: m.name, x: m.x, z: m.z }));
  }

  restoreOwned(ctx: GameContext, saved: readonly SavedMount[]): void {
    for (let i = this.mounts.length - 1; i >= 0; i--) {
      const m = this.mounts[i];
      if (!m.owned) continue;
      this.group.remove(m.view.root);
      ctx.world.destroyEntity(m.entity);
      this.mounts.splice(i, 1);
    }
    for (const s of saved) {
      if (!(s.kind in this.d.cfg.mounts.kinds)) continue;
      this.addMount(ctx, s.kind as MountKind, s.x, s.z, true, null, s.name);
    }
  }

  /** Montura que se está montando o domando (HUD). */
  get active(): Mount | null {
    return this.ride.mount;
  }

  get taming(): TameState | null {
    return this.ride.tame;
  }

  get activeRaft(): Raft | null {
    return this.raftDriver.raft;
  }

  // ------------------------------------------------------------------ interacción

  private onMountInteract(ctx: GameContext, id: string): void {
    const m = this.mounts.find((x) => x.id === id);
    if (!m || this.d.playerSystem.driver) return;
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    if (!ch.grounded && ch.mode !== 'air') return;
    this.ride.begin(ctx, ch, m, !m.owned);
  }

  private boardRaft(ctx: GameContext, id: string): void {
    const r = this.rafts.find((x) => x.id === id);
    if (!r || this.d.playerSystem.driver) return;
    this.raftDriver.begin(ctx, r);
  }

  private whistle(ctx: GameContext): void {
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    ctx.bus.emit('hud:note', { text: '♪ Silbas', tone: 'info' });
    // Los salvajes cercanos se asustan; la montura propia más cercana acude.
    let best: Mount | null = null;
    let bestD = this.d.cfg.mounts.whistleRange;
    for (const m of this.mounts) {
      const dist = Math.hypot(m.x - ch.x, m.z - ch.z);
      if (!m.owned) {
        if (dist < 25 && m.state !== 'ridden' && m.state !== 'taming') this.startFlee(m);
        continue;
      }
      if (m.state === 'ridden' || dist >= bestD) continue;
      best = m;
      bestD = dist;
    }
    if (best) {
      best.state = 'come';
      best.stateT = 0;
    }
  }

  tamed(ctx: GameContext, m: Mount): void {
    m.owned = true;
    m.herd = null;
    m.view.setSaddle(true);
    const it = ctx.world.get(m.entity, 'interactable');
    if (it) it.prompt = `Montar (${m.name})`;
    ctx.bus.emit('mount:tamed', { kind: m.kind, name: m.name });
    ctx.bus.emit('hud:note', { text: `¡${m.name} domado! Silba (J) para llamarlo`, tone: 'good' });
  }

  startFlee(m: Mount): void {
    m.state = 'flee';
    m.stateT = 4 + this.rng() * 2;
  }

  // ------------------------------------------------------------------ paso

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    const wdt = dt * ctx.time.worldScale;
    if (wdt <= 0) return;
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const sneaking = ctx.input.isDown('crouch') && ch.grounded;
    const mc = this.d.cfg.mounts;
    for (const m of this.mounts) {
      const dist = Math.hypot(m.x - ch.x, m.z - ch.z);
      if (m.state !== 'ridden' && m.state !== 'taming') {
        // Lejos del jugador, las manadas se quedan quietas (sin gasto).
        if (dist > 220) continue;
        if (!m.owned && m.state !== 'flee' && (dist < mc.sneakRadius ? !sneaking : dist < mc.alertRadius && !sneaking)) this.startFlee(m);
        this.think(m, ch, dist, wdt);
        this.moveMount(ctx, m, wdt);
      }
      const t = ctx.world.require(m.entity, 'transform');
      t.x = m.x;
      t.y = m.y;
      t.z = m.z;
      const it = ctx.world.get(m.entity, 'interactable');
      if (it) it.enabled = m.state !== 'ridden' && m.state !== 'taming' && m.state !== 'flee';
    }
    // Balsas vacías: deriva con el viento, sin vela.
    for (const r of this.rafts) {
      if (this.raftDriver.raft === r) continue;
      this.d.airflow(r.s.x, r.y + 2, r.s.z, air);
      stepRaft(r.s, { turn: 0, paddle: 0 }, air.windX * 0.3, air.windZ * 0.3, this.d.cfg.rafts, (x, z) => this.depthAt(x, z), wdt);
      const t = ctx.world.require(r.entity, 'transform');
      t.x = r.s.x;
      t.z = r.s.z;
      t.y = r.y;
    }
    for (const r of this.rafts) {
      const it = ctx.world.get(r.entity, 'interactable');
      if (it) it.enabled = this.raftDriver.raft !== r;
    }
  }

  render(ctx: GameContext): void {
    const dt = ctx.time.frameDt;
    const t = ctx.time.elapsed;
    for (const m of this.mounts) {
      m.view.root.position.set(m.x, m.y, m.z);
      m.view.root.rotation.y = m.motion.yaw;
      m.view.animate(m.motion.speed, m.buck, m.state === 'idle' && !m.owned, dt);
    }
    for (const r of this.rafts) {
      r.object.position.set(r.s.x, r.y + Math.sin(t * 1.3 + r.s.x) * 0.05, r.s.z);
      r.object.rotation.set(Math.sin(t * 1.1) * 0.02, r.s.yaw, Math.sin(t * 0.9 + 1) * 0.025);
      r.sail.visible = r.s.sail;
    }
  }

  depthAt(x: number, z: number): number {
    const w = this.d.terrain.waterLevelAt(x, z);
    if (w === null) return 0;
    return w - this.d.terrain.height(x, z);
  }

  private think(m: Mount, ch: CharacterState, dist: number, dt: number): void {
    m.stateT -= dt;
    const def = m.def;
    const mo = m.motion;
    let targetSpeed = 0;
    let targetYaw = mo.yaw;
    switch (m.state) {
      case 'flee': {
        targetYaw = Math.atan2(m.x - ch.x, m.z - ch.z);
        targetSpeed = def.speeds[3] * 0.85;
        if (m.stateT <= 0 && dist > this.d.cfg.mounts.alertRadius) {
          m.state = 'idle';
          m.stateT = 2;
        }
        break;
      }
      case 'come': {
        targetYaw = Math.atan2(ch.x - m.x, ch.z - m.z);
        targetSpeed = dist > 12 ? def.speeds[3] : dist > 4 ? def.speeds[1] : 0;
        if (dist < 3.5) {
          m.state = 'idle';
          m.stateT = 3;
        }
        break;
      }
      case 'wander': {
        targetYaw = Math.atan2(m.tx - m.x, m.tz - m.z);
        targetSpeed = def.speeds[0];
        if (Math.hypot(m.tx - m.x, m.tz - m.z) < 1.5 || m.stateT <= 0) {
          m.state = 'idle';
          m.stateT = 2 + this.rng() * 5;
        }
        break;
      }
      default: {
        if (m.stateT <= 0) {
          const h = m.herd;
          const cx = h ? h.position[0] : m.x;
          const cz = h ? h.position[1] : m.z;
          const r = (h?.radius ?? 6) * this.rng();
          const a = this.rng() * Math.PI * 2;
          m.tx = cx + Math.cos(a) * r;
          m.tz = cz + Math.sin(a) * r;
          m.state = m.owned ? 'idle' : 'wander';
          m.stateT = m.owned ? 4 : 8;
        }
      }
    }
    const dyaw = wrapAngle(targetYaw - mo.yaw);
    mo.yaw += Math.sign(dyaw) * Math.min(Math.abs(dyaw), def.turnRate * dt);
    mo.speed += Math.sign(targetSpeed - mo.speed) * Math.min(Math.abs(targetSpeed - mo.speed), 8 * dt);
  }

  /** Avanza una montura sobre el terreno: pendientes máximas, sin entrar en agua profunda. */
  moveMount(ctx: GameContext, m: Mount, dt: number): boolean {
    const mo = m.motion;
    const fx = Math.sin(mo.yaw);
    const fz = Math.cos(mo.yaw);
    let blocked = false;
    if (Math.abs(mo.speed) > 0.01) {
      const nx = m.x + fx * mo.speed * dt;
      const nz = m.z + fz * mo.speed * dt;
      const h0 = this.d.terrain.height(m.x, m.z);
      const h1 = this.d.terrain.height(nx, nz);
      const run = Math.hypot(nx - m.x, nz - m.z);
      const tooSteep = h1 - h0 > run * Math.tan(m.def.maxSlopeDeg * DEG2RAD) + 0.02 && m.y <= h0 + 0.1;
      const deep = this.depthAt(nx, nz) > 0.9;
      if (tooSteep || deep) {
        blocked = true;
        mo.speed *= 0.3;
      } else {
        m.x = nx;
        m.z = nz;
        const p = { x: m.x, y: m.y, z: m.z };
        const push = this.d.colliders.pushOut(p, 0.75 * m.def.size, 1.6 * m.def.size, 0.5);
        if (push.hit) {
          m.x = p.x;
          m.z = p.z;
          mo.speed *= 0.7;
        }
      }
    }
    const ground = Math.max(this.d.terrain.height(m.x, m.z), this.d.colliders.topAt(m.x, m.z, 0.5, m.y + 0.6));
    if (m.y > ground + 0.05 || m.vy > 0) {
      m.vy -= this.d.player.movement.gravity * dt;
      m.y += m.vy * dt;
      if (m.y <= ground) {
        m.y = ground;
        m.vy = 0;
      }
    } else {
      m.y = ground;
      m.vy = 0;
    }
    // El bisonte embiste a lo que se cruce.
    if (m.def.ram > 0 && mo.speed > 6) {
      for (const e of ctx.world.query('enemy')) {
        const en = ctx.world.require(e, 'enemy');
        if (en.deadT >= 0) continue;
        const def = this.d.enemies.def(en.defId);
        const b = en.brain;
        if (Math.hypot(b.x - (m.x + fx * 1.2), b.z - (m.z + fz * 1.2)) > def.radius + 1 || b.stunT > 0.2) continue;
        const killed = this.d.enemies.hit(ctx, e, m.def.ram, { fromX: m.x, fromZ: m.z, knockback: 8, stagger: true, stun: 0.6 });
        this.d.fx.burst(b.x, b.y + 1, b.z, 'stone', 12);
        if (killed) this.d.combat.killFromWorld(ctx, e);
      }
    }
    return blocked;
  }
}

// ------------------------------------------------------------------ conductores

/** Montar (o domar) una montura. */
class RideDriver implements MovementDriver {
  readonly id = 'montura';
  readonly pose = 'ride' as const;
  mount: Mount | null = null;
  tame: TameState | null = null;
  /** El primer paso ignora la entrada (la misma pulsación que montó). */
  private fresh = false;

  constructor(
    private readonly sys: MountSystem,
    private readonly d: MountDeps,
  ) {}

  begin(ctx: GameContext, ch: CharacterState, m: Mount, taming: boolean): void {
    this.mount = m;
    this.fresh = true;
    this.tame = taming ? createTame() : null;
    m.state = taming ? 'taming' : 'ridden';
    m.motion.speed = 0;
    this.d.playerSystem.setDriver(ctx, this);
    this.seat(ch);
    ctx.bus.emit('mount:ride', { kind: m.kind, name: m.name, active: true });
    if (taming) ctx.bus.emit('hud:note', { text: `¡Se resiste! Pulsa interactuar para calmarlo`, tone: 'info' });
  }

  step(ctx: GameContext, ch: CharacterState, input: DriverInput, dt: number): void {
    const m = this.mount;
    if (!m) {
      this.d.playerSystem.clearDriver(this);
      return;
    }
    if (this.fresh) {
      this.fresh = false;
      input = { ...input, interactPressed: false, crouchPressed: false, jumpPressed: false };
    }
    if (this.tame) {
      const r = stepTaming(this.tame, input.interactPressed, m.def.temper, this.d.cfg.mounts.taming, (amount) => spendRate(ch.stamina, amount / Math.max(dt, 1e-6), dt, 'tame', this.d.stamina), dt);
      m.buck = this.tame.buck;
      m.motion.yaw += Math.sin(this.tame.t * 3.3) * dt * 1.6 * (1 - this.tame.progress);
      if (r === 'tamed') {
        this.tame = null;
        m.buck = 0;
        m.state = 'ridden';
        this.sys.tamed(ctx, m);
      } else if (r === 'thrown') {
        this.throwOff(ctx, ch, m);
        return;
      }
      this.seat(ch);
      return;
    }
    if (input.crouchPressed || input.interactPressed) {
      this.dismount(ctx, ch, m);
      return;
    }
    if (input.jumpPressed && m.vy === 0 && m.def.jump > 0) {
      m.vy = m.def.jump;
      m.y += 0.05;
    }
    const spurred = stepMotion(m.motion, { forward: input.forward, right: input.right, spurPressed: input.sprintPressed }, m.def, dt);
    if (spurred) this.d.fx.burst(m.x, m.y + 0.2, m.z, 'stone', 6);
    if (input.sprintPressed && !spurred) ctx.bus.emit('hud:note', { text: 'Sin espuelas: espera a que se recupere', tone: 'bad' });
    this.sys.moveMount(ctx, m, dt);
    updateStamina(ch.stamina, dt, this.d.stamina);
    this.seat(ch);
  }

  private seat(ch: CharacterState): void {
    const m = this.mount;
    if (!m) return;
    ch.x = m.x;
    ch.z = m.z;
    ch.y = m.y + (MountView.seatHeight(m.kind) - 0.62) * m.def.size;
    ch.yaw = m.motion.yaw;
    ch.vx = Math.sin(m.motion.yaw) * m.motion.speed;
    ch.vz = Math.cos(m.motion.yaw) * m.motion.speed;
    ch.vy = 0;
    ch.mode = 'ground';
    ch.grounded = true;
    ch.swimming = false;
    ch.fallStartY = ch.y;
    ch.safeX = m.x;
    ch.safeY = m.y;
    ch.safeZ = m.z;
  }

  private dismount(ctx: GameContext, ch: CharacterState, m: Mount): void {
    const side = m.motion.yaw + Math.PI / 2;
    ch.x = m.x + Math.sin(side) * 1.3;
    ch.z = m.z + Math.cos(side) * 1.3;
    ch.y = Math.max(this.d.terrain.height(ch.x, ch.z), m.y);
    ch.vx = ch.vz = ch.vy = 0;
    this.end(ctx, m, 'idle');
  }

  private throwOff(ctx: GameContext, ch: CharacterState, m: Mount): void {
    const side = m.motion.yaw - Math.PI / 2;
    ch.x = m.x + Math.sin(side) * 1.5;
    ch.z = m.z + Math.cos(side) * 1.5;
    ch.y = m.y + 1.2;
    ch.vx = Math.sin(side) * 4;
    ch.vz = Math.cos(side) * 4;
    ch.vy = 5;
    ch.mode = 'air';
    ch.grounded = false;
    ch.fallStartY = ch.y;
    m.buck = 0;
    this.end(ctx, m, 'flee');
    ctx.bus.emit('mount:thrown', { kind: m.kind });
    ctx.bus.emit('hud:note', { text: 'Te ha tirado: te has quedado sin vigor', tone: 'bad' });
  }

  private end(ctx: GameContext, m: Mount, state: MountState): void {
    this.mount = null;
    this.tame = null;
    m.motion.speed = 0;
    if (state === 'flee') this.sys.startFlee(m);
    else {
      m.state = state;
      m.stateT = 3;
    }
    this.d.playerSystem.clearDriver(this);
    ctx.bus.emit('mount:ride', { kind: m.kind, name: m.name, active: false });
  }

  cancel(): void {
    const m = this.mount;
    if (m) {
      m.buck = 0;
      m.motion.speed = 0;
      m.state = m.owned ? 'idle' : 'flee';
      m.stateT = 3;
    }
    this.mount = null;
    this.tame = null;
  }
}

/** Navegar en balsa: girar, remar (vigor) y vela (esprintar la iza o arría). */
class RaftDriver implements MovementDriver {
  readonly id = 'balsa';
  readonly pose = 'raft' as const;
  raft: Raft | null = null;
  private fresh = false;

  constructor(
    private readonly sys: MountSystem,
    private readonly d: MountDeps,
  ) {}

  begin(ctx: GameContext, r: Raft): void {
    this.raft = r;
    this.fresh = true;
    r.s.sail = true;
    this.d.playerSystem.setDriver(ctx, this);
    ctx.bus.emit('raft:board', { id: r.id, active: true });
    ctx.bus.emit('hud:note', { text: 'Vela izada: el viento empuja. Esprintar la arría', tone: 'info' });
  }

  step(ctx: GameContext, ch: CharacterState, input: DriverInput, dt: number): void {
    const r = this.raft;
    if (!r) {
      this.d.playerSystem.clearDriver(this);
      return;
    }
    if (this.fresh) {
      this.fresh = false;
      input = { ...input, interactPressed: false };
    }
    if (input.sprintPressed) r.s.sail = !r.s.sail;
    if (input.jumpPressed || input.crouchPressed || input.interactPressed) {
      this.end(ctx, ch, input.jumpPressed);
      return;
    }
    let paddle = Math.max(0, input.forward);
    if (paddle > 0 && !spendRate(ch.stamina, this.d.cfg.rafts.paddleStamina, dt, 'paddle', this.d.stamina)) paddle = 0;
    this.d.airflow(r.s.x, r.y + 2, r.s.z, air);
    stepRaft(r.s, { turn: input.right, paddle }, air.windX, air.windZ, this.d.cfg.rafts, (x, z) => this.sys.depthAt(x, z), dt);
    if (paddle === 0) updateStamina(ch.stamina, dt, this.d.stamina);
    const t = ctx.world.require(r.entity, 'transform');
    t.x = r.s.x;
    t.z = r.s.z;
    const back = -0.9;
    ch.x = r.s.x + Math.sin(r.s.yaw) * back;
    ch.z = r.s.z + Math.cos(r.s.yaw) * back;
    ch.y = r.y + 0.36;
    ch.yaw = r.s.yaw;
    ch.vx = r.s.vx;
    ch.vz = r.s.vz;
    ch.vy = 0;
    ch.mode = 'ground';
    ch.grounded = true;
    ch.swimming = false;
    ch.fallStartY = ch.y;
  }

  private end(ctx: GameContext, ch: CharacterState, jump: boolean): void {
    const r = this.raft;
    this.raft = null;
    if (r) {
      r.s.sail = false;
      ctx.bus.emit('raft:board', { id: r.id, active: false });
    }
    if (jump) {
      ch.vy = Math.sqrt(2 * this.d.player.movement.gravity * this.d.player.movement.jumpHeight) * 1.1;
      ch.vx = Math.sin(ch.yaw) * 3;
      ch.vz = Math.cos(ch.yaw) * 3;
    }
    ch.mode = 'air';
    ch.grounded = false;
    this.d.playerSystem.clearDriver(this);
  }

  cancel(): void {
    if (this.raft) this.raft.s.sail = false;
    this.raft = null;
  }
}
