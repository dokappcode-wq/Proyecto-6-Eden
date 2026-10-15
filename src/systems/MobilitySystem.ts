import * as THREE from 'three';
import { equipped, addItem, type Catalog } from '../combat/inventory';
import type { HitFx } from '../combat/HitFx';
import type { GameContext, System } from '../core/Game';
import { createTransform } from '../core/ecs/components';
import type { Entity } from '../core/ecs/World';
import type { MobilityConfig, PlayerConfig, RuneDef, RuneId, StaminaConfig } from '../data/schemas';
import { raymarchTerrain, type CameraController } from '../player/CameraController';
import type { CharacterState } from '../player/CharacterController';
import { bootsJump, createBoots, onGliderFold, updateBoots, type BootsState } from '../player/mobility/boots';
import { createRope, releaseVelocity, stepRope, type RopeState } from '../player/mobility/rope';
import { stepSurf, surfFriction } from '../player/mobility/surf';
import { foldGlider } from '../player/movement/glide';
import { spend } from '../player/movement/Stamina';
import type { Body } from '../world/physics/Bodies';
import type { Collider, StaticColliders } from '../world/physics/StaticColliders';
import { buildAnchor, buildChest, buildElevator, buildIsland, buildPad, buildPillar, buildWindBomb, iceMaterial } from '../world/props/mobilityProps';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import type { CombatSystem } from './CombatSystem';
import type { ElementSystem } from './ElementSystem';
import type { EnemySystem } from './EnemySystem';
import type { PhysicsSystem } from './PhysicsSystem';
import type { PickupSystem } from './PickupSystem';
import type { DriverInput, MovementDriver, PlayerSystem } from './PlayerSystem';

export interface MobilityDeps {
  cfg: MobilityConfig;
  player: PlayerConfig;
  stamina: StaminaConfig;
  playerEntity: Entity;
  playerSystem: PlayerSystem;
  physics: PhysicsSystem;
  elements: ElementSystem;
  enemies: EnemySystem;
  combat: CombatSystem;
  pickups: PickupSystem;
  catalog: Catalog;
  terrain: TerrainGenerator;
  colliders: StaticColliders;
  scene: THREE.Scene;
  fx: HitFx;
  camera: CameraController;
  threeCamera: THREE.PerspectiveCamera;
  /** Corrientes de aire (los rayos ancestrales centran al planeador). */
  thermals: () => ReadonlyArray<{ kind: string; x: number; z: number; baseY: number; radius: number; height: number }>;
}

interface AnchorRt {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Punto donde se engancha la cuerda. */
  ry: number;
  perch: boolean;
  ring: THREE.Mesh;
}

interface ElevatorRt {
  def: MobilityConfig['elevators'][number];
  x: number;
  z: number;
  bottom: number;
  top: number;
  y: number;
  state: 'bottom' | 'up' | 'top' | 'down';
  waitT: number;
  collider: Collider;
  platform: THREE.Group;
}

interface PadRt {
  def: MobilityConfig['jumpPads'][number];
  x: number;
  y: number;
  z: number;
  rune: THREE.Mesh;
  pulse: number;
}

interface IcePillar {
  x: number;
  z: number;
  top: number;
  life: number;
  collider: Collider;
  mesh: THREE.Mesh;
}

interface WindBomb {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  fuse: number;
  object: THREE.Group;
}

interface IslandChest {
  id: string;
  entity: Entity;
  lid: THREE.Group;
  x: number;
  y: number;
  z: number;
  loot: string;
  open: number;
  opened: boolean;
}

export type GrappleTarget = { kind: 'anchor'; anchor: AnchorRt } | { kind: 'body'; body: Body };

const PILLAR_HEIGHT = 3.6;
const WIND_GRAVITY = 16;

/**
 * Movilidad avanzada: Garfio de Raíz, Botas de Céfiro, Semilla de Vendaval, surf con escudo,
 * runas (Sello Quieto, Pilar Glacial, Tirón Férreo, Chispa Remota) y plataformas ancestrales
 * (pads de salto, elevadores, anclas, columnas e islas flotantes).
 */
export class MobilitySystem implements System {
  readonly name = 'mobility';
  readonly group = new THREE.Group();
  readonly boots: BootsState;
  runeIndex = 0;
  readonly runeCooldown: Record<RuneId, number> = { stasis: 0, frost: 0, magnet: 0, bomb: 0 };
  windCooldown = 0;
  grappleTarget: GrappleTarget | null = null;
  private grappleCooldown = 0;
  private pulling: Body | null = null;
  magnetBody: Body | null = null;
  private magnetDist = 6;
  bombBody: Body | null = null;
  private readonly pillars: IcePillar[] = [];
  private readonly windBombs: WindBomb[] = [];
  private readonly anchors: AnchorRt[] = [];
  private readonly elevators: ElevatorRt[] = [];
  private readonly pads: PadRt[] = [];
  private readonly chests: IslandChest[] = [];
  private readonly rope: THREE.Line;
  private readonly beam: THREE.Line;
  private readonly board: THREE.Mesh;
  private readonly grapple: GrappleDriver;
  private readonly surf: SurfDriver;
  private readonly camPos = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly beams: ReturnType<MobilityDeps['thermals']>;

  constructor(
    private readonly d: MobilityDeps,
    ctx: GameContext,
  ) {
    this.group.name = 'mobility';
    d.scene.add(this.group);
    this.boots = createBoots(d.cfg.boots);
    this.beams = d.thermals().filter((t) => t.kind === 'ancestral_vent');
    this.grapple = new GrappleDriver(this, d);
    this.surf = new SurfDriver(this, d);
    const lineMat = (c: string) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.95 });
    const lineGeo = () => new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.rope = new THREE.Line(lineGeo(), lineMat('#7ee3c0'));
    this.beam = new THREE.Line(lineGeo(), lineMat('#ff6a5a'));
    this.rope.frustumCulled = this.beam.frustumCulled = false;
    this.rope.visible = this.beam.visible = false;
    this.board = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 16), new THREE.MeshStandardMaterial({ color: '#8a6a44', roughness: 0.6, metalness: 0.3 }));
    this.board.scale.set(1, 1, 1.5);
    this.board.visible = false;
    this.group.add(this.rope, this.beam, this.board);
    this.buildWorld(ctx);

    ctx.bus.on('interact', ({ id, kind }) => {
      if (kind === 'chest' && id.startsWith('chest:mob:')) this.openChest(ctx, id.slice(10));
    });
    ctx.bus.on('input:action', ({ action, phase }) => {
      if (phase !== 'pressed' || ctx.session.mode !== 'play') return;
      if (action === 'debug_mobility') this.grantAll(ctx);
    });
    ctx.bus.on('player:died', () => this.releaseAll());
    ctx.bus.on('player:respawned', () => this.releaseAll());
  }

  // ------------------------------------------------------------------ mundo

  private buildWorld(ctx: GameContext): void {
    const { cfg, terrain, colliders } = this.d;
    let seed = 0;
    for (const a of cfg.anchors) {
      const [x, z] = a.position;
      const { object, ring } = buildAnchor(a.perch, seed++);
      object.position.set(x, a.y, z);
      this.group.add(object);
      if (a.perch) colliders.addBox(x, a.y - 0.4, z, 1.3, 0.4, 1.3, 0, 'stone');
      this.anchors.push({ id: a.id, x, y: a.y, z, ry: a.perch ? a.y + 0.95 : a.y, perch: a.perch, ring });
    }
    for (const p of cfg.jumpPads) {
      const [x, z] = p.position;
      const y = terrain.height(x, z) + 0.36;
      const { object, rune } = buildPad(p.radius);
      object.position.set(x, y - 0.36, z);
      this.group.add(object);
      colliders.addCylinder(x, z, p.radius + 0.45, y - 1, y, 'stone');
      this.pads.push({ def: p, x, y, z, rune, pulse: 0 });
    }
    for (const p of cfg.pillars) {
      const [x, z] = p.position;
      const y = terrain.height(x, z);
      const g = buildPillar(p.height + 0.5, p.radius);
      g.position.set(x, y - 0.5, z);
      this.group.add(g);
      colliders.addCylinder(x, z, p.radius, y - 0.5, y + p.height, 'stone');
    }
    for (const e of cfg.elevators) {
      const [x, z] = e.position;
      const bottom = terrain.height(x, z) + 0.25;
      const { frame, platform } = buildElevator(e.half, e.top - bottom);
      frame.position.set(x, bottom, z);
      this.group.add(frame, platform);
      // Postes como colisionadores (para no atravesarlos).
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        colliders.addCylinder(x + sx * (e.half + 0.4), z + sz * (e.half + 0.4), 0.28, bottom, e.top + 3.5, 'stone');
      const collider = colliders.addBox(x, bottom - 0.25, z, e.half, 0.25, e.half, 0, 'stone');
      this.elevators.push({ def: e, x, z, bottom, top: e.top, y: bottom, state: 'bottom', waitT: 0, collider, platform });
    }
    for (const isl of cfg.islands) {
      const [x, z] = isl.position;
      const g = buildIsland(isl.radius, 900 + seed++);
      g.position.set(x, isl.top, z);
      this.group.add(g);
      colliders.addCylinder(x, z, isl.radius * 0.97, isl.top - 1.4, isl.top, 'stone');
      colliders.addCylinder(x, z, isl.radius * 0.6, isl.top - isl.radius * 1.2, isl.top - 1.4, 'rock');
      // Cofre en el centro de la isla.
      const { object, lid } = buildChest();
      object.position.set(x + 2, isl.top, z);
      this.group.add(object);
      colliders.addBox(x + 2, isl.top + 0.3, z, 0.55, 0.3, 0.35, 0, 'wood');
      const e = ctx.world.createEntity();
      ctx.world.add(e, 'name', { value: `chest_${isl.id}` });
      ctx.world.add(e, 'transform', createTransform(x + 2, isl.top, z));
      ctx.world.add(e, 'interactable', { id: `chest:mob:${isl.id}`, kind: 'chest', prompt: 'Abrir cofre', radius: 2, enabled: true });
      this.chests.push({ id: isl.id, entity: e, lid, x: x + 2, y: isl.top, z, loot: isl.chestLoot, open: 0, opened: false });
    }
  }

  // ------------------------------------------------------------------ estado / guardado

  has(ctx: GameContext, item: string): boolean {
    return (ctx.world.require(this.d.playerEntity, 'combat').equipment.items[item] ?? 0) > 0;
  }

  get openedChests(): string[] {
    return this.chests.filter((c) => c.opened).map((c) => c.id);
  }

  restoreChests(ctx: GameContext, opened: Iterable<string>): void {
    const set = new Set(opened);
    for (const c of this.chests) {
      c.opened = set.has(c.id);
      c.open = c.opened ? 1 : 0;
      const it = ctx.world.get(c.entity, 'interactable');
      if (it) it.enabled = !c.opened;
    }
  }

  get rune(): RuneDef {
    return this.d.cfg.runes[this.runeIndex];
  }

  /** Runas conseguidas (para el HUD). */
  ownedRunes(ctx: GameContext): RuneDef[] {
    return this.d.cfg.runes.filter((r) => this.has(ctx, r.item));
  }

  /** Posición del objetivo del garfio (marcador del HUD). */
  get grappleMarker(): { x: number; y: number; z: number } | null {
    const t = this.grappleTarget;
    if (!t) return null;
    if (t.kind === 'anchor') return { x: t.anchor.x, y: t.anchor.ry, z: t.anchor.z };
    return { x: t.body.x, y: t.body.y + t.body.def.radius, z: t.body.z };
  }

  get grappling(): boolean {
    return this.d.playerSystem.driver === this.grapple;
  }

  get surfing(): boolean {
    return this.d.playerSystem.driver === this.surf;
  }

  /** Depuración (F10): todas las herramientas y runas. */
  private grantAll(ctx: GameContext): void {
    const eq = ctx.world.require(this.d.playerEntity, 'combat').equipment;
    const { cfg } = this.d;
    for (const id of [cfg.grapple.item, cfg.boots.item, cfg.windBomb.item, ...cfg.runes.map((r) => r.item)]) if (!eq.items[id]) addItem(eq, id, 1, 1);
    ctx.bus.emit('hud:note', { text: 'Depuración: herramientas y runas desbloqueadas', tone: 'info' });
  }

  private releaseAll(): void {
    if (this.magnetBody) this.d.physics.hold(this.magnetBody, false);
    this.magnetBody = null;
    if (this.pulling) this.d.physics.hold(this.pulling, false);
    this.pulling = null;
  }

  // ------------------------------------------------------------------ paso

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    const { input, world } = ctx;
    const p = world.require(this.d.playerEntity, 'player');
    const ch = world.require(this.d.playerEntity, 'character');
    const free = p.control === 'free';
    const driver = this.d.playerSystem.driver;
    const wdt = dt * ctx.time.worldScale;
    const pressed = (a: string) => free && input.wasPressed(a);

    this.d.threeCamera.getWorldPosition(this.camPos);
    this.d.threeCamera.getWorldDirection(this.camDir);

    for (const k of Object.keys(this.runeCooldown) as RuneId[]) this.runeCooldown[k] = Math.max(0, this.runeCooldown[k] - dt);
    this.windCooldown = Math.max(0, this.windCooldown - dt);
    this.grappleCooldown = Math.max(0, this.grappleCooldown - dt);

    this.stepElevators(ctx, ch, wdt);
    if (ch.mode === 'glide') this.centerInBeam(ch, wdt);
    if (free && !driver) this.stepPads(ctx, ch);

    // --- Botas de Céfiro
    const supported = ch.grounded || ch.swimming || ch.mode === 'climb' || ch.mode === 'ledge' || (driver !== null && driver !== this.grapple);
    updateBoots(this.boots, supported, this.d.cfg.boots, dt);
    if (this.d.playerSystem.lastEvents?.gliderFold && ch.mode === 'air') onGliderFold(this.boots);
    if (pressed('boots') && this.has(ctx, this.d.cfg.boots.item) && !driver && (ch.mode === 'air' || ch.mode === 'glide')) this.useBoots(ctx, ch);

    // --- Garfio de Raíz
    const hasGrapple = this.has(ctx, this.d.cfg.grapple.item);
    this.grappleTarget = hasGrapple && free && (!driver || driver === this.grapple) && !this.pulling ? this.findGrappleTarget(ctx, ch) : null;
    if (pressed('grapple') && hasGrapple) {
      if (driver === this.grapple) this.grapple.release(ctx, ch, true);
      else if (this.pulling) this.stopPull();
      else if (!driver && this.grappleCooldown <= 0) this.fireGrapple(ctx, ch);
    }
    this.stepPull(ctx, ch, wdt);

    // --- Surf con escudo
    if (pressed('surf') && !driver && ch.grounded && !ch.swimming) this.startSurf(ctx, ch);

    // --- Semilla de Vendaval
    if (pressed('wind_bomb') && this.has(ctx, this.d.cfg.windBomb.item) && driver !== this.grapple) {
      if (this.windCooldown > 0) ctx.bus.emit('hud:note', { text: 'La semilla de vendaval aún se está recargando', tone: 'bad' });
      else this.throwWindBomb(ctx, ch, input.isDown('crouch'));
    }
    this.stepWindBombs(ctx, wdt);

    // --- Runas
    for (let i = 0; i < 4; i++) if (pressed(`rune_${i + 1}`)) this.selectRune(ctx, i);
    if (pressed('rune_use')) this.useRune(ctx, ch);
    this.stepMagnet(ctx, ch, wdt);
    this.stepPillars(wdt);
    if (this.bombBody && !this.bombBody.alive) this.bombBody = null;
    this.updateHighlight(ctx);

    for (const c of this.chests) if (c.opened && c.open < 1) c.open = Math.min(1, c.open + dt * 1.5);
  }

  render(ctx: GameContext): void {
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const t = ctx.time.elapsed;
    // Cuerda del garfio / tirón, rayo del imán.
    const hand = { x: ch.x, y: ch.y + 1.45, z: ch.z };
    const rp = this.grapple.ropePoint();
    const target = rp ?? (this.pulling ? { x: this.pulling.x, y: this.pulling.y + this.pulling.def.radius, z: this.pulling.z } : null);
    this.rope.visible = target !== null;
    if (target) setLine(this.rope, hand, target);
    const mb = this.magnetBody;
    this.beam.visible = mb !== null;
    if (mb) setLine(this.beam, hand, { x: mb.x, y: mb.y + mb.def.radius, z: mb.z });
    // Tabla del surf.
    this.board.visible = this.surfing;
    if (this.surfing) {
      this.board.position.set(ch.x, ch.y + 0.05, ch.z);
      this.board.rotation.set(0, ch.yaw, 0);
    }
    for (const a of this.anchors) {
      const hot = this.grappleTarget?.kind === 'anchor' && this.grappleTarget.anchor === a;
      a.ring.rotation.y = t * (hot ? 4 : 1);
      a.ring.scale.setScalar(hot ? 1.35 + Math.sin(t * 10) * 0.1 : 1);
    }
    for (const p of this.pads) {
      p.pulse = Math.max(0, p.pulse - ctx.time.frameDt * 2);
      p.rune.scale.setScalar(1 + p.pulse * 0.25 + Math.sin(t * 3) * 0.03);
    }
    for (const e of this.elevators) e.platform.position.set(e.x, e.y, e.z);
    for (const w of this.windBombs) {
      w.object.position.set(w.x, w.y, w.z);
      w.object.rotation.set(t * 6, t * 9, 0);
    }
    for (const c of this.chests) c.lid.rotation.x = -c.open * 1.9;
  }

  /**
   * Los rayos de ascenso ancestrales arrastran suavemente al planeador hacia su eje para que
   * suba en espiral hasta arriba; cerca de la cima dejan de hacerlo y se puede salir planeando.
   */
  private centerInBeam(ch: CharacterState, dt: number): void {
    for (const t of this.beams) {
      const dx = t.x - ch.x;
      const dz = t.z - ch.z;
      const dist = Math.hypot(dx, dz);
      const rel = ch.y - t.baseY;
      if (dist > t.radius * 1.15 || rel < 0 || rel > t.height * 0.92) continue;
      const k = Math.min(1, 2.6 * dt);
      ch.x += dx * k;
      ch.z += dz * k;
    }
  }

  // ------------------------------------------------------------------ botas

  private useBoots(ctx: GameContext, ch: CharacterState): void {
    const v = bootsJump(this.boots, ch.vy, this.d.cfg.boots);
    if (v === null) {
      ctx.bus.emit('hud:note', { text: 'Las botas necesitan tocar suelo para recargarse', tone: 'bad' });
      return;
    }
    if (!spend(ch.stamina, this.d.cfg.boots.stamina, 'boots', this.d.stamina)) {
      this.boots.charges++;
      return;
    }
    if (ch.mode === 'glide') foldGlider(ch);
    ch.mode = 'air';
    ch.vy = v;
    ch.jumpRising = false;
    ch.fallStartY = ch.y;
    ch.airTime = 0;
    this.d.fx.ring(ch.x, ch.y, ch.z, 1.6, '#bfe8ff');
    this.d.fx.burst(ch.x, ch.y, ch.z, 'parry', 8);
    ctx.bus.emit('mobility:ability', { ability: 'boots', phase: 'start' });
  }

  // ------------------------------------------------------------------ garfio

  private findGrappleTarget(ctx: GameContext, ch: CharacterState): GrappleTarget | null {
    const cfg = this.d.cfg.grapple;
    const cos = Math.cos((cfg.aimCone * Math.PI) / 180);
    const o = this.camPos;
    const f = this.camDir;
    let best: GrappleTarget | null = null;
    let bestScore = -Infinity;
    const consider = (x: number, y: number, z: number, t: GrappleTarget, margin = 1.6) => {
      const dp = Math.hypot(x - ch.x, y - (ch.y + 1.4), z - ch.z);
      if (dp > cfg.range || dp < 2) return;
      const dx = x - o.x;
      const dy = y - o.y;
      const dz = z - o.z;
      const dl = Math.hypot(dx, dy, dz);
      const c = (dx * f.x + dy * f.y + dz * f.z) / dl;
      if (c < cos) return;
      const score = c * 4 - dp / cfg.range;
      if (score <= bestScore) return;
      if (!this.clearLine(ch.x, ch.y + 1.4, ch.z, x, y, z, margin)) return;
      bestScore = score;
      best = t;
    };
    // La losa de las anclas con piedra no tapa su propia anilla.
    for (const a of this.anchors) consider(a.x, a.ry, a.z, { kind: 'anchor', anchor: a }, a.perch ? 3.4 : 1.6);
    for (const b of this.d.physics.bodies) if (b.alive && b.def.mass <= cfg.maxPullMass && !b.held && b.stasisT <= 0) consider(b.x, b.y + b.def.radius, b.z, { kind: 'body', body: b });
    void ctx;
    return best;
  }

  /** ¿Hay visión directa (sin terreno ni colisionadores) entre dos puntos? */
  private clearLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number, margin: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    const ux = dx / d;
    const uy = dy / d;
    const uz = dz / d;
    const max = d - margin;
    if (max <= 0) return true;
    const terrainHit = raymarchTerrain({ terrainHeight: (x, z) => this.d.terrain.height(x, z), raycastColliders: () => Infinity }, ax, ay, az, ux, uy, uz, max);
    if (terrainHit < max) return false;
    return this.d.colliders.raycast(ax, ay, az, ux, uy, uz, max) >= max;
  }

  private fireGrapple(ctx: GameContext, ch: CharacterState): void {
    const t = this.grappleTarget;
    if (!t) {
      ctx.bus.emit('hud:note', { text: 'No hay ningún ancla al alcance', tone: 'bad' });
      return;
    }
    this.grappleCooldown = this.d.cfg.grapple.cooldown;
    if (t.kind === 'body') {
      this.pulling = t.body;
      this.d.physics.hold(t.body, true);
      ctx.bus.emit('mobility:ability', { ability: 'grapple', phase: 'start' });
      return;
    }
    if (ch.mode === 'glide') foldGlider(ch);
    this.grapple.begin(ctx, ch, t.anchor);
  }

  private stepPull(ctx: GameContext, ch: CharacterState, dt: number): void {
    const b = this.pulling;
    if (!b) return;
    if (!b.alive) {
      this.pulling = null;
      return;
    }
    const dx = ch.x - b.x;
    const dz = ch.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.4 + b.def.radius) {
      this.stopPull();
      return;
    }
    const k = (d - 1.8) / d;
    this.d.physics.steer(b, b.x + dx * k, Math.max(b.y, ch.y + 0.2), b.z + dz * k, this.d.cfg.grapple.pullSpeed, dt);
    void ctx;
  }

  private stopPull(): void {
    if (!this.pulling) return;
    this.d.physics.hold(this.pulling, false);
    this.pulling.vx *= 0.3;
    this.pulling.vz *= 0.3;
    this.pulling = null;
  }

  // ------------------------------------------------------------------ surf

  private startSurf(ctx: GameContext, ch: CharacterState): void {
    const c = ctx.world.require(this.d.playerEntity, 'combat');
    const sh = equipped(c.equipment, 'shield');
    if (!sh) {
      ctx.bus.emit('hud:note', { text: 'Necesitas un escudo equipado para deslizarte', tone: 'bad' });
      return;
    }
    this.surf.begin(ctx, ch, this.d.catalog.shield(sh.id).surfSpeed);
  }

  // ------------------------------------------------------------------ semilla de vendaval

  private throwWindBomb(ctx: GameContext, ch: CharacterState, atFeet: boolean): void {
    const cfg = this.d.cfg.windBomb;
    this.windCooldown = cfg.cooldown;
    const object = buildWindBomb();
    this.group.add(object);
    const f = this.camDir;
    const fl = Math.hypot(f.x, f.z) || 1;
    if (atFeet) {
      this.windBombs.push({ x: ch.x, y: ch.y + 0.3, z: ch.z, vx: 0, vy: 0, vz: 0, t: 0, fuse: 0.45, object });
    } else {
      const sx = ch.x + (f.x / fl) * 0.6;
      const sz = ch.z + (f.z / fl) * 0.6;
      this.windBombs.push({ x: sx, y: ch.y + 1.4, z: sz, vx: f.x * cfg.throwSpeed + ch.vx * 0.5, vy: f.y * cfg.throwSpeed + 3.5, vz: f.z * cfg.throwSpeed + ch.vz * 0.5, t: 0, fuse: cfg.fuse, object });
    }
    ctx.bus.emit('mobility:ability', { ability: 'wind_bomb', phase: 'start' });
  }

  private stepWindBombs(ctx: GameContext, dt: number): void {
    for (let i = this.windBombs.length - 1; i >= 0; i--) {
      const w = this.windBombs[i];
      w.t += dt;
      const ax = w.x;
      const ay = w.y;
      const az = w.z;
      w.vy -= WIND_GRAVITY * dt;
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      w.z += w.vz * dt;
      let hit = w.t >= w.fuse;
      const ground = this.d.terrain.height(w.x, w.z);
      const water = this.d.elements.waterAt(w.x, w.z);
      if (w.y <= ground + 0.2 || (water !== null && w.y <= water)) {
        w.y = Math.max(w.y, Math.max(ground, water ?? -Infinity) + 0.2);
        hit = true;
      }
      const seg = Math.hypot(w.x - ax, w.y - ay, w.z - az);
      if (!hit && seg > 1e-4 && this.d.colliders.raycast(ax, ay, az, (w.x - ax) / seg, (w.y - ay) / seg, (w.z - az) / seg, seg) <= seg) hit = true;
      if (!hit && w.t > 0.15) {
        for (const b of this.d.physics.bodies) if (b.alive && Math.hypot(b.x - w.x, b.y + b.def.radius - w.y, b.z - w.z) < b.def.radius + 0.4) hit = true;
        for (const e of ctx.world.query('enemy')) {
          const br = ctx.world.require(e, 'enemy').brain;
          if (Math.hypot(br.x - w.x, br.z - w.z) < 1.2 && w.y > br.y && w.y < br.y + 2.5) hit = true;
        }
      }
      if (hit) {
        this.group.remove(w.object);
        this.windBombs.splice(i, 1);
        this.d.physics.explode(ctx, w.x, w.y, w.z, this.d.cfg.windBomb.radius, 0, 'wind');
      }
    }
  }

  // ------------------------------------------------------------------ runas

  private selectRune(ctx: GameContext, i: number): void {
    const r = this.d.cfg.runes[i];
    if (!r) return;
    if (!this.has(ctx, r.item)) {
      ctx.bus.emit('hud:note', { text: 'Aún no tienes esa runa', tone: 'bad' });
      return;
    }
    if (this.runeIndex !== i && this.magnetBody) this.dropMagnet();
    this.runeIndex = i;
    ctx.bus.emit('rune:selected', { rune: r.id, name: r.name });
  }

  private useRune(ctx: GameContext, ch: CharacterState): void {
    const r = this.rune;
    if (!this.has(ctx, r.item)) {
      const owned = this.ownedRunes(ctx);
      if (owned.length === 0) {
        ctx.bus.emit('hud:note', { text: 'No tienes ninguna runa', tone: 'bad' });
        return;
      }
      this.runeIndex = this.d.cfg.runes.indexOf(owned[0]);
      this.useRune(ctx, ch);
      return;
    }
    // La bomba y el imán se apagan con la misma tecla aunque estén en recarga.
    if (r.id === 'magnet' && this.magnetBody) {
      this.dropMagnet();
      return;
    }
    if (r.id === 'bomb' && this.bombBody?.alive) {
      const b = this.bombBody;
      this.d.physics.destroy(b);
      this.d.physics.explode(ctx, b.x, b.y + b.def.radius, b.z, r.radius, r.power, 'rune');
      this.bombBody = null;
      this.runeCooldown.bomb = r.cooldown;
      ctx.bus.emit('rune:used', { rune: 'bomb', target: 'detonate' });
      return;
    }
    if (this.runeCooldown[r.id] > 0) {
      ctx.bus.emit('hud:note', { text: `${r.name} se está recargando (${Math.ceil(this.runeCooldown[r.id])} s)`, tone: 'bad' });
      return;
    }
    switch (r.id) {
      case 'stasis':
        this.castStasis(ctx, r);
        break;
      case 'frost':
        this.castFrost(ctx, r, ch);
        break;
      case 'magnet':
        this.castMagnet(ctx, r);
        break;
      case 'bomb':
        this.placeBomb(ctx, ch);
        break;
    }
  }

  private aimBody(range: number, filter: (b: Body) => boolean): { body: Body; t: number } | null {
    const o = this.camPos;
    const f = this.camDir;
    return this.d.physics.raycast(o.x, o.y, o.z, f.x, f.y, f.z, range + this.d.camera.currentDistance, filter);
  }

  private castStasis(ctx: GameContext, r: RuneDef): void {
    const hit = this.aimBody(r.range, (b) => !b.held && b.kind !== 'bomb');
    // También detiene enemigos (no jefes) por un instante.
    const o = this.camPos;
    const f = this.camDir;
    let enemy: { e: Entity; t: number } | null = null;
    for (const e of ctx.world.query('enemy')) {
      const en = ctx.world.require(e, 'enemy');
      if (en.deadT >= 0) continue;
      const def = this.d.enemies.def(en.defId);
      if (def.boss) continue;
      const b = en.brain;
      const cx = b.x - o.x;
      const cy = b.y + def.height * 0.5 - o.y;
      const cz = b.z - o.z;
      const t = cx * f.x + cy * f.y + cz * f.z;
      if (t < 0 || t > r.range + this.d.camera.currentDistance) continue;
      const miss = Math.hypot(cx - f.x * t, cy - f.y * t, cz - f.z * t);
      if (miss < Math.max(def.radius, def.height * 0.5) + 0.3 && (!enemy || t < enemy.t)) enemy = { e, t };
    }
    if (enemy && (!hit || enemy.t < hit.t)) {
      const b = ctx.world.require(enemy.e, 'enemy').brain;
      b.stunT = Math.max(b.stunT, r.seconds * 0.5);
      b.attack = null;
      this.d.fx.ring(b.x, b.y + 1, b.z, 1.6, '#ffd34a');
      this.runeCooldown.stasis = r.cooldown * 0.6;
      ctx.bus.emit('rune:used', { rune: 'stasis', target: 'enemy' });
      return;
    }
    if (!hit) {
      ctx.bus.emit('hud:note', { text: 'Apunta a un objeto para detenerlo', tone: 'bad' });
      return;
    }
    this.d.physics.stasis(hit.body, r.seconds);
    this.d.fx.ring(hit.body.x, hit.body.y + hit.body.def.radius, hit.body.z, hit.body.def.radius * 2, '#ffd34a');
    this.runeCooldown.stasis = r.cooldown;
    ctx.bus.emit('rune:used', { rune: 'stasis', target: hit.body.kind });
  }

  private castFrost(ctx: GameContext, r: RuneDef, ch: CharacterState): void {
    const o = this.camPos;
    const f = this.camDir;
    const max = r.range + this.d.camera.currentDistance;
    // Un pilar existente en la mira se rompe.
    for (let i = 0; i < this.pillars.length; i++) {
      const p = this.pillars[i];
      const hitT = this.d.colliders.raycastHit(o.x, o.y, o.z, f.x, f.y, f.z, max);
      if (hitT && Math.abs(o.x + f.x * hitT.t - p.x) < r.radius + 0.2 && Math.abs(o.z + f.z * hitT.t - p.z) < r.radius + 0.2) {
        this.removePillar(i, true);
        return;
      }
    }
    let point: { x: number; y: number; z: number } | null = null;
    for (let t = 1; t <= max; t += 0.5) {
      const x = o.x + f.x * t;
      const y = o.y + f.y * t;
      const z = o.z + f.z * t;
      if (y < this.d.terrain.height(x, z)) break;
      const w = this.d.elements.waterAt(x, z);
      if (w !== null && y <= w) {
        point = { x, y: w, z };
        break;
      }
    }
    if (!point) {
      ctx.bus.emit('hud:note', { text: 'El Pilar Glacial solo se alza sobre el agua', tone: 'bad' });
      return;
    }
    if (this.pillars.length >= r.max) this.removePillar(0, true);
    const ground = this.d.terrain.height(point.x, point.z);
    const top = point.y + PILLAR_HEIGHT;
    const bottom = Math.min(point.y - 0.5, ground);
    const h = top - bottom;
    const collider = this.d.colliders.addBox(point.x, bottom + h / 2, point.z, r.radius, h / 2, r.radius, 0, 'ice');
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(r.radius * 2, h, r.radius * 2), iceMaterial);
    mesh.position.set(point.x, bottom + h / 2, point.z);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    this.pillars.push({ x: point.x, z: point.z, top, life: r.seconds, collider, mesh });
    // Lo que esté encima sube con el pilar.
    if (Math.abs(ch.x - point.x) < r.radius + 0.3 && Math.abs(ch.z - point.z) < r.radius + 0.3 && ch.y < top) {
      ch.y = top;
      ch.vy = 0;
      ch.swimming = false;
      ch.grounded = true;
      ch.mode = 'ground';
    }
    for (const b of this.d.physics.bodies) if (Math.abs(b.x - point.x) < r.radius && Math.abs(b.z - point.z) < r.radius && b.y < top) b.y = top;
    this.d.fx.burst(point.x, point.y + 1, point.z, 'parry', 16);
    this.runeCooldown.frost = r.cooldown;
    ctx.bus.emit('rune:used', { rune: 'frost', target: 'water' });
  }

  private removePillar(i: number, fx: boolean): void {
    const p = this.pillars[i];
    this.d.colliders.remove(p.collider);
    this.group.remove(p.mesh);
    p.mesh.geometry.dispose();
    if (fx) this.d.fx.burst(p.x, p.top - 1, p.z, 'parry', 18);
    this.pillars.splice(i, 1);
  }

  private stepPillars(dt: number): void {
    for (let i = this.pillars.length - 1; i >= 0; i--) {
      const p = this.pillars[i];
      // El fuego cercano los derrite deprisa.
      p.life -= dt * (this.d.elements.fire.burningNear(p.x, p.z, 3) > 0 ? 20 : 1);
      if (p.life <= 0) this.removePillar(i, true);
    }
  }

  private castMagnet(ctx: GameContext, r: RuneDef): void {
    const hit = this.aimBody(r.range, (b) => b.def.metal);
    if (!hit) {
      ctx.bus.emit('hud:note', { text: 'Apunta a un objeto metálico', tone: 'bad' });
      return;
    }
    this.magnetBody = hit.body;
    this.magnetDist = Math.max(3, hit.t);
    this.d.physics.hold(hit.body, true);
    ctx.bus.emit('rune:used', { rune: 'magnet', target: hit.body.kind });
  }

  private stepMagnet(ctx: GameContext, ch: CharacterState, dt: number): void {
    const b = this.magnetBody;
    if (!b) return;
    const r = this.d.cfg.runes.find((x) => x.id === 'magnet');
    if (!b.alive || !r || Math.hypot(b.x - ch.x, b.z - ch.z) > r.range * 1.25) {
      this.dropMagnet();
      return;
    }
    // Acercar/alejar: andar hacia atrás y hacia delante mientras se sujeta con "agacharse" pulsado.
    if (ctx.input.isDown('crouch')) this.magnetDist = Math.max(3, Math.min(r.range, this.magnetDist + ctx.input.axis('move_back', 'move_forward') * 6 * dt));
    const o = this.camPos;
    const f = this.camDir;
    this.d.physics.steer(b, o.x + f.x * this.magnetDist, o.y + f.y * this.magnetDist - b.def.radius, o.z + f.z * this.magnetDist, r.power, dt);
  }

  private dropMagnet(): void {
    if (this.magnetBody) this.d.physics.hold(this.magnetBody, false);
    this.magnetBody = null;
  }

  private placeBomb(ctx: GameContext, ch: CharacterState): void {
    const fx = Math.sin(ch.yaw);
    const fz = Math.cos(ch.yaw);
    const b = this.d.physics.spawn('bomb', ch.x + fx * 1.1, ch.y + 1.1, ch.z + fz * 1.1, false);
    b.vx = fx * 4.5 + ch.vx * 0.5;
    b.vy = 3;
    b.vz = fz * 4.5 + ch.vz * 0.5;
    this.bombBody = b;
    ctx.bus.emit('rune:used', { rune: 'bomb', target: 'place' });
  }

  private updateHighlight(ctx: GameContext): void {
    const r = this.rune;
    let hl: { body: Body; color: string } | null = null;
    if (this.grappleTarget?.kind === 'body') hl = { body: this.grappleTarget.body, color: '#7ee3c0' };
    else if (this.has(ctx, r.item) && !this.magnetBody) {
      if (r.id === 'stasis' && this.runeCooldown.stasis <= 0) {
        const h = this.aimBody(r.range, (b) => !b.held && b.kind !== 'bomb' && b.stasisT <= 0);
        if (h) hl = { body: h.body, color: '#ffd34a' };
      } else if (r.id === 'magnet') {
        const h = this.aimBody(r.range, (b) => b.def.metal);
        if (h) hl = { body: h.body, color: '#ff6a5a' };
      }
    }
    this.d.physics.highlight = hl;
  }

  // ------------------------------------------------------------------ plataformas

  private stepPads(ctx: GameContext, ch: CharacterState): void {
    for (const p of this.pads) {
      // Los objetos encima también salen disparados.
      for (const b of this.d.physics.bodies) {
        if (b.alive && b.grounded && Math.hypot(b.x - p.x, b.z - p.z) < p.def.radius && Math.abs(b.y - p.y) < 0.4) {
          b.vy = p.def.launch * 0.8;
          b.grounded = false;
        }
      }
      if (!ch.grounded || Math.hypot(ch.x - p.x, ch.z - p.z) > p.def.radius || Math.abs(ch.y - p.y) > 0.5) continue;
      ch.vy = p.def.launch;
      ch.grounded = false;
      ch.mode = 'air';
      ch.jumpRising = false;
      ch.fallStartY = ch.y;
      if (p.def.target) {
        // Empuje horizontal para caer sobre el objetivo en la bajada.
        const [tx, tz] = p.def.target;
        const flight = ((2 * p.def.launch) / this.d.player.movement.gravity) * 0.82;
        ch.vx = (tx - p.x) / flight;
        ch.vz = (tz - p.z) / flight;
      }
      p.pulse = 1;
      this.d.fx.ring(p.x, p.y, p.z, p.def.radius * 1.6, '#1fd6ff');
      ctx.bus.emit('mobility:ability', { ability: 'jump_pad', phase: 'start' });
      ctx.bus.emit('player:launched', { x: ch.x, y: ch.y, z: ch.z });
    }
  }

  private stepElevators(ctx: GameContext, ch: CharacterState, dt: number): void {
    for (const e of this.elevators) {
      const h = e.def.half;
      const onTop = Math.abs(ch.x - e.x) < h && Math.abs(ch.z - e.z) < h && Math.abs(ch.y - e.y) < 0.3 && ch.grounded;
      const nearBase = Math.hypot(ch.x - e.x, ch.z - e.z) < h + 4 && Math.abs(ch.y - e.bottom) < 2;
      const prev = e.y;
      switch (e.state) {
        case 'bottom':
          e.waitT = onTop ? e.waitT + dt : 0;
          if (e.waitT > 0.6) {
            e.state = 'up';
            ctx.bus.emit('mobility:ability', { ability: 'elevator', phase: 'start' });
          }
          break;
        case 'up':
          e.y = Math.min(e.top, e.y + e.def.speed * dt);
          if (e.y >= e.top) {
            e.state = 'top';
            e.waitT = 0;
          }
          break;
        case 'top':
          e.waitT = onTop ? 0 : e.waitT + dt;
          // Se le llama desde abajo, o vuelve sola si nadie la usa.
          if (e.waitT > e.def.wait && (nearBase || e.waitT > e.def.wait * 6)) e.state = 'down';
          break;
        case 'down':
          e.y = Math.max(e.bottom, e.y - e.def.speed * dt);
          if (e.y <= e.bottom) {
            e.state = 'bottom';
            e.waitT = 0;
          }
          break;
      }
      const dy = e.y - prev;
      this.d.colliders.move(e.collider, e.x, e.y - 0.25, e.z);
      if (dy !== 0 && onTop) {
        ch.y += dy;
        ch.fallStartY = ch.y;
      }
      for (const b of this.d.physics.bodies) if (b.alive && Math.abs(b.x - e.x) < h && Math.abs(b.z - e.z) < h && Math.abs(b.y - prev) < 0.3) b.y += dy;
    }
  }

  // ------------------------------------------------------------------ cofres de las islas

  private openChest(ctx: GameContext, id: string): void {
    const c = this.chests.find((x) => x.id === id);
    if (!c || c.opened) return;
    c.opened = true;
    const it = ctx.world.get(c.entity, 'interactable');
    if (it) it.enabled = false;
    this.d.pickups.dropLoot(ctx, c.loot, c.x, c.y + 0.9, c.z + 0.8);
    this.d.fx.burst(c.x, c.y + 0.8, c.z, 'parry', 16);
    ctx.bus.emit('chest:opened', { id: `mob:${id}` });
  }
}

function setLine(line: THREE.Line, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): void {
  const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  attr.setXYZ(0, a.x, a.y, a.z);
  attr.setXYZ(1, b.x, b.y, b.z);
  attr.needsUpdate = true;
}

// ------------------------------------------------------------------ conductores

/** Garfio: vuela hacia el ancla y, al llegar o al saltar, se columpia. */
class GrappleDriver implements MovementDriver {
  readonly id = 'garfio';
  readonly pose = 'hang' as const;
  private rope: RopeState | null = null;
  private justSwung = false;

  constructor(
    private readonly m: MobilitySystem,
    private readonly d: MobilityDeps,
  ) {}

  ropePoint(): { x: number; y: number; z: number } | null {
    return this.rope ? { x: this.rope.ax, y: this.rope.ay, z: this.rope.az } : null;
  }

  begin(ctx: GameContext, ch: CharacterState, a: AnchorRt): void {
    this.rope = createRope(a.x, a.ry, a.z, ch, a.perch ? a.y : null);
    this.justSwung = false;
    ch.mode = 'air';
    ch.grounded = false;
    ch.swimming = false;
    ctx.bus.emit('mobility:ability', { ability: 'grapple', phase: 'start' });
    this.d.playerSystem.setDriver(ctx, this);
    void this.m;
  }

  step(ctx: GameContext, ch: CharacterState, input: DriverInput, dt: number): void {
    const rope = this.rope;
    if (!rope) {
      this.d.playerSystem.clearDriver(this);
      return;
    }
    const f = this.d.camera.forward();
    const r = this.d.camera.right();
    const wasReel = rope.phase === 'reel';
    if (rope.phase === 'swing' && input.jumpPressed && !this.justSwung) {
      this.release(ctx, ch, true);
      return;
    }
    if (input.crouchPressed) {
      this.release(ctx, ch, false);
      return;
    }
    const res = stepRope(rope, ch, { right: input.right, forward: input.forward, fx: f.x, fz: f.z, rx: r.x, rz: r.z, swing: wasReel && input.jumpPressed }, this.d.cfg.grapple, this.d.player.movement.gravity, dt);
    this.justSwung = wasReel && rope.phase === 'swing';
    if (res === 'arrived') {
      if (rope.perch) {
        // Aterriza sobre la piedra flotante.
        this.finish(ctx, ch, true);
        ch.y = rope.ty;
        ch.vx = ch.vz = ch.vy = 0;
        return;
      }
      rope.phase = 'swing';
    }
    // Colisiones con el escenario (recogiendo hacia una piedra, solo el terreno: se aterriza encima).
    const terrainY = this.d.terrain.height(ch.x, ch.z);
    const ground = rope.perch && rope.phase === 'reel' ? terrainY : Math.max(terrainY, this.d.colliders.topAt(ch.x, ch.z, 0.2, ch.y + 0.3));
    if (ch.y <= ground) {
      ch.y = ground;
      if (rope.phase === 'swing' || wasReel) {
        this.finish(ctx, ch, true);
        return;
      }
    }
    if (rope.phase === 'swing') {
      const push = this.d.colliders.pushOut(ch, this.d.player.body.radius, this.d.player.body.height, 0.2);
      if (push.hit) {
        const dot = ch.vx * push.nx + ch.vz * push.nz;
        if (dot < 0) {
          ch.vx -= dot * push.nx;
          ch.vz -= dot * push.nz;
        }
      }
    }
    const hv = Math.hypot(ch.vx, ch.vz);
    if (hv > 0.5) ch.yaw = Math.atan2(ch.vx, ch.vz);
    ch.mode = 'air';
    ch.grounded = false;
    ch.fallStartY = ch.y;
  }

  /** Soltarse: con impulso (saltar) o dejándose caer. */
  release(ctx: GameContext, ch: CharacterState, boost: boolean): void {
    if (this.rope && boost) {
      const v = releaseVelocity(ch, this.rope.phase === 'swing' ? this.d.cfg.grapple.releaseBoost : 2);
      ch.vx = v.vx;
      ch.vy = v.vy;
      ch.vz = v.vz;
    }
    this.finish(ctx, ch, false);
  }

  private finish(ctx: GameContext, ch: CharacterState, grounded: boolean): void {
    this.rope = null;
    ch.mode = grounded ? 'ground' : 'air';
    ch.grounded = grounded;
    ch.fallStartY = ch.y;
    ch.airTime = 0;
    ch.jumpRising = false;
    if (grounded) ch.vx = ch.vy = ch.vz = 0;
    this.d.playerSystem.clearDriver(this);
    ctx.bus.emit('mobility:ability', { ability: 'grapple', phase: 'end' });
  }

  cancel(): void {
    this.rope = null;
  }
}

/** Surf con escudo: la pendiente acelera, el material frena; saltar o agacharse termina. */
class SurfDriver implements MovementDriver {
  readonly id = 'surf';
  readonly pose = 'surf' as const;
  private speedMul = 1;
  private slowT = 0;
  private wearT = 0;
  private airborne = false;

  constructor(
    private readonly m: MobilitySystem,
    private readonly d: MobilityDeps,
  ) {}

  begin(ctx: GameContext, ch: CharacterState, speedMul: number): void {
    this.speedMul = speedMul;
    this.slowT = 0;
    this.wearT = 0;
    this.airborne = false;
    const s = Math.hypot(ch.vx, ch.vz);
    if (s < 4) {
      ch.vx = Math.sin(ch.yaw) * 4;
      ch.vz = Math.cos(ch.yaw) * 4;
    }
    ch.vy = 3;
    ch.y += 0.05;
    this.airborne = true;
    this.d.playerSystem.setDriver(ctx, this);
    ctx.bus.emit('mobility:ability', { ability: 'surf', phase: 'start' });
    void this.m;
  }

  step(ctx: GameContext, ch: CharacterState, input: DriverInput, dt: number): void {
    const cfg = this.d.cfg.surf;
    const g = this.d.player.movement.gravity;
    if (input.jumpPressed && !this.airborne) {
      this.end(ctx, ch);
      ch.vy = Math.sqrt(2 * g * this.d.player.movement.jumpHeight);
      ch.mode = 'air';
      ch.grounded = false;
      return;
    }
    if (input.crouchPressed || input.dodgePressed) {
      this.end(ctx, ch);
      return;
    }
    const n = this.d.terrain.normal(ch.x, ch.z);
    const mat = this.d.terrain.materialAt(ch.x, ch.z, n.y);
    const speed = this.airborne ? Math.hypot(ch.vx, ch.vz) : stepSurf(ch, input.right, n, surfFriction(cfg, mat), this.speedMul, cfg, g, dt);
    if (this.airborne && Math.abs(input.right) > 0.1) {
      const turn = input.right * cfg.steer * 0.4 * dt;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const vx = ch.vx * c - ch.vz * s;
      ch.vz = ch.vx * s + ch.vz * c;
      ch.vx = vx;
    }
    // Movimiento horizontal con colisiones: chocar de frente termina el surf.
    const px = ch.x;
    const pz = ch.z;
    ch.x += ch.vx * dt;
    ch.z += ch.vz * dt;
    const hNew = this.d.terrain.height(ch.x, ch.z);
    if (hNew > ch.y + 0.7) {
      ch.x = px;
      ch.z = pz;
      ch.vx *= 0.2;
      ch.vz *= 0.2;
      this.end(ctx, ch);
      return;
    }
    const push = this.d.colliders.pushOut(ch, this.d.player.body.radius, this.d.player.body.height, 0.35);
    if (push.hit && speed > 6) {
      this.end(ctx, ch);
      return;
    }
    // Vertical: pegado a la pendiente, o volando si el suelo se aleja (saltos en cambios de rasante).
    const ground = Math.max(hNew, this.d.colliders.topAt(ch.x, ch.z, 0.3, ch.y + 0.4));
    if (this.airborne) {
      ch.vy -= g * dt;
      ch.y += ch.vy * dt;
      if (ch.y <= ground) {
        ch.y = ground;
        ch.vy = 0;
        this.airborne = false;
      }
    } else if (ch.y - ground > 0.45) {
      this.airborne = true;
      ch.vy = 0;
    } else {
      ch.y = ground;
    }
    // Agua: se acaba el surf (a nadar).
    const w = this.d.elements.waterAt(ch.x, ch.z);
    if (w !== null && w - ground > 0.5 && ch.y < w) {
      this.end(ctx, ch);
      return;
    }
    if (speed > 0.6) ch.yaw = Math.atan2(ch.vx, ch.vz);
    ch.mode = this.airborne ? 'air' : 'ground';
    ch.grounded = !this.airborne;
    ch.fallStartY = ch.y;
    this.slowT = speed < cfg.minSpeed && !this.airborne ? this.slowT + dt : 0;
    if (this.slowT > 0.7) {
      this.end(ctx, ch);
      return;
    }
    this.wearT += dt;
    if (this.wearT >= cfg.wearSeconds) {
      this.wearT = 0;
      if (!this.d.combat.wearShield(ctx)) this.end(ctx, ch);
    }
  }

  private end(ctx: GameContext, ch: CharacterState): void {
    ch.mode = this.airborne ? 'air' : 'ground';
    ch.grounded = !this.airborne;
    ch.fallStartY = ch.y;
    this.d.playerSystem.clearDriver(this);
    ctx.bus.emit('mobility:ability', { ability: 'surf', phase: 'end' });
  }

  cancel(): void {
    this.airborne = false;
  }
}
