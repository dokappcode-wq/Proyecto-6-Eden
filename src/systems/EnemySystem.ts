import * as THREE from 'three';
import { shockwaveRadius, slamCenter } from '../ai/attacks';
import {
  ballistic,
  calmStateFor,
  createBrain,
  enterCombat,
  isCalm,
  leadTarget,
  setState,
  updateAwareness,
  applyHit,
  type ActiveAttack,
  type Brain,
  type HitOptions,
} from '../ai/brain';
import { dayPhase, MAX_ATTACKERS, routineFor, type DayPhase } from '../ai/camp';
import type { AIContext, AIEvent, GroupView, PlayerView } from '../ai/context';
import { hearAlarm, stepGoblin } from '../ai/goblin';
import { crystalPosition, crystalStagger, stepGolem } from '../ai/golem';
import { stepHawk } from '../ai/hawk';
import type { Body, NavEnv } from '../ai/locomotion';
import { sense, type PerceptionEnv, type Stimulus } from '../ai/perception';
import { stepSlime } from '../ai/slime';
import { Telegraphs } from '../ai/view/Telegraphs';
import { createEnemyView, deathSeconds, type EnemyView } from '../ai/view';
import type { HitFx } from '../combat/HitFx';
import type { ProjectileManager } from '../combat/ProjectileManager';
import type { GameContext, System } from '../core/Game';
import { createTransform } from '../core/ecs/components';
import type { Entity } from '../core/ecs/World';
import { createRng } from '../core/math';
import type { CampDef, CampRole, CombatConfig, Element, ElementsConfig, EncountersConfig, EnemyDef, MovementConfig, ValleyConfig } from '../data/schemas';
import { raymarchTerrain } from '../player/CameraController';
import type { StaticColliders } from '../world/physics/StaticColliders';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import type { RenderSystem } from './RenderSystem';

/** Más allá de esta distancia los enemigos tranquilos no se simulan (quedan congelados). */
const ACTIVE_RADIUS = 240;
/** Más allá de esta distancia no se dibujan. */
const VIEW_RADIUS = 420;
/** Segundos que dura el aumento de ruido de un golpe o aterrizaje. */
const NOISE_DECAY = 0.45;

export interface EnemyDeps {
  defs: readonly EnemyDef[];
  encounters: EncountersConfig;
  playerEntity: Entity;
  terrain: TerrainGenerator;
  colliders: StaticColliders;
  renderSystem: RenderSystem;
  projectiles: ProjectileManager;
  fx: HitFx;
  scene: THREE.Scene;
  combat: CombatConfig;
  movement: MovementConfig;
  elements: ElementsConfig;
  /** Lluvia 0..1 en la posición del jugador (vista y oído peores). */
  rain: () => number;
  /** Luz ambiente 0 (noche) .. 1 (día). */
  skyLight: () => number;
  hour: () => number;
  /** Sacudida de cámara por impactos cercanos. */
  shake: (amount: number) => void;
}

interface CampRuntime {
  def: CampDef;
  members: Entity[];
  alarm: boolean;
  hornCaller: Entity | null;
  hornBlown: boolean;
  reinforcementsSent: boolean;
  leader: Entity | null;
  leaderDead: boolean;
  cleared: boolean;
  attackers: number;
  phase: DayPhase | null;
  /** Miembros que aún no han reaccionado a la alarma (reacción escalonada). */
  pending: Set<Entity>;
}

/**
 * Enemigos del mundo: percepción (vista con cono y oclusión, oído, noche, altura),
 * estados de IA, campamentos con rutinas y alarma, jefes, aves cazadoras,
 * ataques telegrafiados y proyectiles enemigos. La IA corre a la escala de tiempo del mundo.
 */
export class EnemySystem implements System {
  readonly name = 'enemies';
  readonly telegraphs = new Telegraphs();
  /** Jefes derrotados (no reaparecen; se guarda en la partida). */
  readonly defeatedBosses = new Set<string>();
  private readonly defs = new Map<string, EnemyDef>();
  private readonly views = new Map<Entity, EnemyView>();
  private readonly camps = new Map<string, CampRuntime>();
  private readonly roostGround = new Map<Entity, number>();
  private readonly bosses = new Map<Entity, { id: string; engaged: boolean }>();
  private readonly rng = createRng(1337);
  private readonly nav: NavEnv;
  /** Llama más cercana (los goblins huyen del fuego); la conecta el sistema de elementos. */
  fireNear: ((x: number, z: number, r: number) => { x: number; z: number } | null) | null = null;
  /** Muertes por el entorno (fuego, rayo): las resuelve el combate (botín, eventos). */
  killHandler: ((ctx: GameContext, e: Entity) => void) | null = null;
  private noiseBump = 0;
  private noiseT = 0;
  private readonly events: AIEvent[] = [];

  constructor(
    private readonly d: EnemyDeps,
    ctx: GameContext,
  ) {
    for (const e of d.defs) this.defs.set(e.id, e);
    d.scene.add(this.telegraphs.group);
    this.nav = {
      groundAt: (x, z, fromY) => this.groundAt(x, z, fromY),
      waterDepth: (x, z, g) => {
        const w = d.terrain.waterLevelAt(x, z);
        return w !== null ? Math.max(0, w - g) : 0;
      },
      blocked: (x, y, z, r, h) => d.colliders.overlaps(x, y, z, r, h),
      pushOut: (pos, r, h, step) => {
        d.colliders.pushOut(pos, r, h, step);
      },
    };
    // Ruido del jugador: aterrizajes y golpes se oyen lejos.
    ctx.bus.on('player:landed', ({ drop }) => this.bumpNoise(d.combat.noise.land * Math.min(1.5, Math.max(0.3, drop / 4))));
    ctx.bus.on('combat:hit', () => this.bumpNoise(d.combat.noise.hit));
  }

  def(id: string): EnemyDef {
    const d = this.defs.get(id);
    if (!d) throw new Error(`Enemigo desconocido: ${id}`);
    return d;
  }

  // ------------------------------------------------------------------ aparición

  /** Coloca todos los enemigos del valle y del mundo (al empezar o cargar partida). */
  spawnAll(ctx: GameContext, valleySpawns: ValleyConfig['enemySpawns'], defeatedBosses: Iterable<string>): void {
    for (const e of ctx.world.query('enemy')) this.despawn(ctx, e);
    this.camps.clear();
    this.bosses.clear();
    this.telegraphs.clear();
    this.defeatedBosses.clear();
    for (const id of defeatedBosses) this.defeatedBosses.add(id);
    const scatter = (id: string, enemy: string, [cx, cz]: [number, number], count: number, radius: number, route: [number, number][]) => {
      const def = this.def(enemy);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + this.rng();
        const r = radius * Math.sqrt(this.rng());
        const e = this.spawn(ctx, def, cx + Math.cos(a) * r, cz + Math.sin(a) * r, id);
        const b = ctx.world.require(e, 'enemy').brain;
        if (route.length >= 2) {
          b.route = route;
          b.routeIndex = i % route.length;
          b.activity = 'patrol';
          b.state = 'patrol';
        }
      }
    };
    for (const sp of valleySpawns) scatter(sp.id, sp.enemy, sp.position, sp.count, sp.radius, []);
    const enc = this.d.encounters;
    for (const g of enc.groups) scatter(g.id, g.enemy, g.position, g.count, g.radius, g.route);
    for (const camp of enc.camps) this.spawnCamp(ctx, camp);
    for (const boss of enc.bosses) {
      if (this.defeatedBosses.has(boss.id)) continue;
      const e = this.spawn(ctx, this.def(boss.enemy), boss.position[0], boss.position[1], boss.id, boss.yaw);
      this.bosses.set(e, { id: boss.id, engaged: false });
    }
    for (const roost of enc.roosts) {
      const def = this.def(roost.enemy);
      const ground = this.d.terrain.height(roost.center[0], roost.center[1]);
      for (let i = 0; i < roost.count; i++) {
        const e = this.spawn(ctx, def, roost.center[0], roost.center[1], roost.id);
        const b = ctx.world.require(e, 'enemy').brain;
        b.homeY = ground;
        b.y = ground + (def.hawk?.altitude ?? 30);
        b.circleA = (i / roost.count) * Math.PI * 2;
        this.roostGround.set(e, ground);
      }
    }
  }

  private spawnCamp(ctx: GameContext, camp: CampDef): void {
    const rt: CampRuntime = {
      def: camp,
      members: [],
      alarm: false,
      hornCaller: null,
      hornBlown: false,
      reinforcementsSent: false,
      leader: null,
      leaderDead: false,
      cleared: false,
      attackers: 0,
      phase: null,
      pending: new Set(),
    };
    this.camps.set(camp.id, rt);
    camp.members.forEach((m, i) => {
      const e = this.addMember(ctx, rt, m.enemy, m.role, i, m.position[0], m.position[1]);
      if (m.role === 'leader') rt.leader = e;
    });
  }

  private addMember(ctx: GameContext, rt: CampRuntime, enemy: string, role: CampRole, index: number, x: number, z: number): Entity {
    const def = this.def(enemy);
    // El vigía aparece sobre la plataforma de su torre.
    const lookoutTop = role === 'lookout' && rt.def.lookout ? this.groundAt(x, z, 1e4) : undefined;
    const e = this.spawn(ctx, def, x, z, rt.def.id, Math.atan2(x - rt.def.center[0], z - rt.def.center[1]), lookoutTop);
    const b = ctx.world.require(e, 'enemy').brain;
    b.group = rt.def.id;
    b.role = role;
    b.slot = index;
    if (role === 'patrol') b.route = rt.def.patrol;
    rt.members.push(e);
    return e;
  }

  spawn(ctx: GameContext, def: EnemyDef, x: number, z: number, spawnId: string, yaw = this.rng() * Math.PI * 2, y?: number): Entity {
    const gy = y ?? this.groundAt(x, z, this.d.terrain.height(x, z) + 2);
    const e = ctx.world.createEntity();
    const brain = createBrain(def, x, gy, z, yaw, this.rng());
    ctx.world.add(e, 'name', { value: def.id });
    ctx.world.add(e, 'transform', createTransform(x, gy, z, yaw));
    ctx.world.add(e, 'enemy', { defId: def.id, brain, spawnId, deadT: -1 });
    const v = createEnemyView(def);
    this.views.set(e, v);
    this.d.renderSystem.attach(e, v.root);
    return e;
  }

  // ------------------------------------------------------------------ paso fijo

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    const wdt = dt * ctx.time.worldScale;
    if (wdt <= 0) return;
    const { world } = ctx;
    this.noiseT = Math.max(0, this.noiseT - dt);
    const pv = this.playerView(ctx);
    const stim = this.stimulus(ctx, pv);
    const env: PerceptionEnv = { light: this.lightAt(pv.x, pv.z), rain: this.d.rain(), airVisibility: this.d.combat.airVisibility };
    const hour = this.d.hour();
    for (const rt of this.camps.values()) this.campUpkeep(ctx, rt, hour, wdt);

    for (const e of world.query('enemy', 'transform')) {
      const en = world.require(e, 'enemy');
      const def = this.def(en.defId);
      const b = en.brain;
      if (en.deadT >= 0) {
        en.deadT += wdt;
        if (b.kind === 'hawk') stepHawk(b, this.aiContext(def, b, pv, wdt, null), this.roostGround.get(e) ?? b.homeY);
        if (en.deadT >= deathSeconds(def)) this.despawn(ctx, e);
        continue;
      }
      const dist = Math.hypot(pv.x - b.x, pv.z - b.z);
      if (dist > ACTIVE_RADIUS && isCalm(b.state) && !this.bosses.has(e)) continue;
      if (this.tickElements(ctx, e, b, def, wdt)) continue;

      // Percepción.
      const hawkPrey = b.kind !== 'hawk' || (pv.airborne && pv.y - pv.groundY > (def.hawk?.preyHeight ?? 0) && Math.hypot(pv.x - b.homeX, pv.z - b.homeZ) < (def.hawk?.huntRadius ?? 0));
      const s: Stimulus = hawkPrey ? stim : { ...stim, alive: false };
      const obs = { x: b.x, y: b.y, z: b.z, yaw: b.yaw, eye: def.height * 0.85, asleep: b.state === 'sleep' };
      const r = sense(obs, def.senses, s, env, () => this.lineOfSight(b.x, b.y + def.height * 0.85, b.z, pv.x, pv.y + 1.2, pv.z));
      const aev = updateAwareness(b, def, r, pv.x, pv.y, pv.z, wdt);
      if (aev === 'noticed') this.onNoticed(ctx, e, b);

      // Comportamiento.
      const rt = b.group ? this.camps.get(b.group) ?? null : null;
      const ai = this.aiContext(def, b, pv, wdt, rt ? this.groupView(rt, e, b) : null);
      switch (b.kind) {
        case 'slime':
          stepSlime(b, ai);
          break;
        case 'goblin':
          stepGoblin(b, ai);
          break;
        case 'golem':
          stepGolem(b, ai);
          break;
        case 'hawk':
          stepHawk(b, ai, this.roostGround.get(e) ?? b.homeY);
          break;
      }
      this.handleEvents(ctx, e, b, def, pv, rt);
      this.updateBoss(ctx, e, b, def, pv);
    }

    this.separate(ctx);
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
    const pt = ctx.world.get(this.d.playerEntity, 'transform');
    this.telegraphs.update(dt);
    for (const [e, v] of this.views) {
      const en = ctx.world.get(e, 'enemy');
      if (!en) continue;
      const far = pt ? Math.hypot(en.brain.x - pt.x, en.brain.z - pt.z) > VIEW_RADIUS : false;
      v.root.visible = !far;
      if (!far) v.update(en.brain, this.def(en.defId), en.deadT, dt);
    }
  }

  // ------------------------------------------------------------------ daño y muerte (lo llama el combate)

  /** Aplica un golpe del jugador. Devuelve true si el enemigo muere. */
  hit(ctx: GameContext, e: Entity, damage: number, o: HitOptions): boolean {
    const en = ctx.world.require(e, 'enemy');
    const def = this.def(en.defId);
    const b = en.brain;
    const wasAware = b.aware;
    // Golpear a un enemigo congelado lo hace añicos (daño multiplicado).
    if (b.frozenT > 0 && damage > 0) {
      damage *= this.d.elements.ice.shatterMultiplier;
      b.frozenT = 0;
      b.stunT = Math.min(b.stunT, 0.3);
      this.d.fx.burst(b.x, b.y + def.height * 0.5, b.z, 'parry', 18);
    }
    // Los jefes no se tambalean salvo por el cristal.
    const killed = applyHit(b, def, damage, def.boss ? { ...o, stagger: false } : o);
    if (!wasAware && !killed) this.onNoticed(ctx, e, b);
    return killed;
  }

  /** Consecuencias de una muerte: división del slime gigante, huida del campamento, jefe. */
  onKilled(ctx: GameContext, e: Entity): void {
    const en = ctx.world.require(e, 'enemy');
    en.deadT = 0;
    const def = this.def(en.defId);
    const b = en.brain;
    b.attack = null;
    const split = def.slime?.splitInto;
    if (split) {
      const child = this.def(split.enemy);
      for (let i = 0; i < split.count; i++) {
        const a = (i / split.count) * Math.PI * 2;
        const c = this.spawn(ctx, child, b.x + Math.cos(a) * def.radius, b.z + Math.sin(a) * def.radius, `${en.spawnId}_split`);
        const cb = ctx.world.require(c, 'enemy').brain;
        cb.vx = Math.cos(a) * 4;
        cb.vz = Math.sin(a) * 4;
        cb.vy = 6;
        cb.grounded = false;
        cb.homeX = b.homeX;
        cb.homeZ = b.homeZ;
        enterCombat(cb, b.lastX, b.lastY, b.lastZ);
        cb.stunT = 0.6;
      }
    }
    const rt = b.group ? this.camps.get(b.group) : undefined;
    if (rt && rt.leader === e) {
      // Cae el líder: el resto huye y luego se reagrupa.
      rt.leaderDead = true;
      for (const m of rt.members) {
        const mb = ctx.world.get(m, 'enemy');
        if (!mb || mb.deadT >= 0 || m === e || mb.brain.role === 'lookout') continue;
        setState(mb.brain, 'flee');
        mb.brain.attack = null;
        mb.brain.fleeT = 5 + this.rng() * 3;
      }
    }
    const boss = this.bosses.get(e);
    if (boss) {
      this.defeatedBosses.add(boss.id);
      ctx.bus.emit('boss:defeated', { id: boss.id, name: def.name, x: b.x, y: b.y, z: b.z });
      this.bosses.delete(e);
    }
  }

  /**
   * Efecto de un elemento sobre un enemigo: arde (los goblins huyen presas del pánico),
   * se congela (el siguiente golpe lo hace añicos) o queda electrocutado (suelta el arma).
   * Devuelve el arma que suelta, si alguna.
   */
  elementHit(ctx: GameContext, e: Entity, element: Element): { dropWeapon: string | null } {
    const en = ctx.world.get(e, 'enemy');
    if (!en || en.deadT >= 0) return { dropWeapon: null };
    const def = this.def(en.defId);
    const b = en.brain;
    const el = this.d.elements;
    const rock = def.tags.includes('rock');
    const big = def.knockbackResist >= 0.9;
    let drop: string | null = null;
    switch (element) {
      case 'fire':
        if (b.frozenT > 0) {
          b.frozenT = 0;
          b.stunT = 0;
          break;
        }
        if (rock) break;
        b.burnT = el.burn.seconds * 1.5;
        if (b.kind === 'goblin' && b.state !== 'flee') {
          setState(b, 'flee');
          b.attack = null;
          b.fleeT = 2.5;
        }
        break;
      case 'ice':
        b.burnT = 0;
        if (big) break;
        b.frozenT = el.ice.freezeSeconds * (1 - def.knockbackResist * 0.6);
        b.stunT = Math.max(b.stunT, b.frozenT);
        b.attack = null;
        b.vx = b.vz = 0;
        break;
      case 'shock':
        if (def.tags.includes('electric')) break;
        b.stunT = Math.max(b.stunT, el.shock.stunSeconds * (1 - def.knockbackResist * 0.7));
        b.attack = null;
        if (b.kind === 'goblin' && def.goblin?.drop && !b.disarmed) {
          b.disarmed = true;
          drop = def.goblin.drop;
        }
        break;
      default:
        break;
    }
    if (!b.aware) this.onNoticed(ctx, e, b);
    enterCombat(b, b.lastX, b.lastY, b.lastZ);
    return { dropWeapon: drop };
  }

  /** Quemaduras y congelación con el paso del tiempo. Devuelve true si ha muerto. */
  private tickElements(ctx: GameContext, e: Entity, b: Brain, def: EnemyDef, dt: number): boolean {
    if (b.frozenT > 0) {
      b.frozenT = Math.max(0, b.frozenT - dt);
      b.stunT = Math.max(b.stunT, b.frozenT);
    }
    if (b.burnT <= 0) return false;
    const before = b.burnT;
    b.burnT = Math.max(0, b.burnT - dt * (1 + this.d.rain() * 3 + (this.inWater(b) ? 20 : 0)));
    // Un tic de daño por segundo.
    if (Math.floor(before) !== Math.floor(b.burnT)) {
      this.d.fx.burst(b.x, b.y + def.height * 0.6, b.z, 'spark', 5);
      if (applyHit(b, def, 3, { fromX: b.x, fromZ: b.z, knockback: 0, stagger: false, stun: 0 })) {
        this.killHandler?.(ctx, e);
        return true;
      }
    }
    return false;
  }

  /**
   * ¿El impacto en (x,y,z) da en su punto débil? Núcleo del slime, cabeza del goblin
   * o cristal del golem (un flechazo en el cristal lo pone de rodillas).
   */
  weakSpot(ctx: GameContext, e: Entity, x: number, y: number, z: number, ranged: boolean): boolean {
    const en = ctx.world.require(e, 'enemy');
    const def = this.def(en.defId);
    const b = en.brain;
    switch (b.kind) {
      case 'slime':
        return ranged && Math.abs(y - (b.y + def.height * 0.55)) < def.height * 0.18;
      case 'goblin':
        if (ranged && y > b.y + def.height * 0.78) {
          b.stunT = Math.max(b.stunT, 0.8);
          b.attack = null;
          return true;
        }
        return false;
      case 'golem': {
        const g = def.golem;
        if (!g) return false;
        if (!ranged) return b.kneel;
        const c = crystalPosition(b, def.height, g.crystalHeight, g.crystalSide, def.radius);
        if (Math.hypot(x - c.x, y - c.y, z - c.z) < g.crystalRadius * 1.8 + 0.25) {
          crystalStagger(b, g.crystalStun);
          return true;
        }
        return false;
      }
      default:
        return false;
    }
  }

  /** Slime eléctrico cargado: golpearlo con metal (o tocarlo) electrocuta. */
  isCharged(ctx: GameContext, e: Entity): boolean {
    const en = ctx.world.get(e, 'enemy');
    return !!en && en.deadT < 0 && en.brain.charged;
  }

  /** ¿El enemigo está dentro del agua? (las descargas se propagan más). */
  inWater(b: Brain): boolean {
    return this.nav.waterDepth(b.x, b.z, b.y) > 0.15;
  }

  /** Jefe en combate cerca del jugador (para la barra del HUD). */
  activeBoss(ctx: GameContext): { name: string; title: string; hp: number; maxHp: number; phase: number } | null {
    for (const [e, info] of this.bosses) {
      const en = ctx.world.get(e, 'enemy');
      if (!en || en.deadT >= 0 || !info.engaged) continue;
      const def = this.def(en.defId);
      return { name: def.name, title: def.boss?.title ?? '', hp: en.brain.hp, maxHp: en.brain.maxHp, phase: en.brain.phase };
    }
    return null;
  }

  /** Estado de cada campamento (para el guardado y el sistema de encuentros). */
  campStatus(id: string): { cleared: boolean; alarm: boolean } | null {
    const rt = this.camps.get(id);
    return rt ? { cleared: rt.cleared, alarm: rt.alarm } : null;
  }

  /** Altura del suelo para un enemigo (terreno o la cara superior de un colisionador). */
  groundAt(x: number, z: number, fromY: number): number {
    return Math.max(this.d.terrain.height(x, z), this.d.colliders.topAt(x, z, 0.3, fromY));
  }

  /** Línea de visión (terreno y colisionadores) entre dos puntos. */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return true;
    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    if (this.d.colliders.raycast(ax, ay, az, nx, ny, nz, len - 0.3) < len - 0.3) return false;
    const t = raymarchTerrain({ terrainHeight: (x, z) => this.d.terrain.height(x, z), raycastColliders: () => Infinity }, ax, ay, az, nx, ny, nz, len);
    return t >= len - 0.5;
  }

  /** Texto de depuración del enemigo más cercano y recuento por estado. */
  debugLabel(ctx: GameContext): string {
    const pt = ctx.world.require(this.d.playerEntity, 'transform');
    const byState: Record<string, number> = {};
    let near = '';
    let nd = Infinity;
    for (const e of ctx.world.query('enemy')) {
      const en = ctx.world.require(e, 'enemy');
      const b = en.brain;
      byState[b.state] = (byState[b.state] ?? 0) + 1;
      const d = Math.hypot(b.x - pt.x, b.z - pt.z);
      if (d < nd) {
        nd = d;
        near = `${en.defId} ${b.state}/${b.activity} alerta ${b.awareness.toFixed(2)}${b.sees ? ' (te ve)' : ''} hp ${Math.ceil(b.hp)}/${b.maxHp}${b.attack ? ` ${b.attack.def.id}:${b.attack.phase}` : ''} a ${d.toFixed(1)} m`;
      }
    }
    const states = Object.entries(byState)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ');
    const camps = [...this.camps.values()].map((c) => `${c.def.id}${c.cleared ? ' ✓' : c.alarm ? (c.hornBlown ? ' CUERNO' : ' ALARMA') : ''}`).join(' ');
    return `${states}\n  más cercano: ${near || '—'}\n  campamentos: ${camps}  ruido ${this.currentNoise(ctx).toFixed(1)} m`;
  }

  /** Conos de visión de los enemigos cercanos (overlay de depuración). */
  debugCones(ctx: GameContext, ray: (ax: number, ay: number, az: number, bx: number, by: number, bz: number, hit: boolean) => void): void {
    const pt = ctx.world.require(this.d.playerEntity, 'transform');
    for (const e of ctx.world.query('enemy')) {
      const en = ctx.world.require(e, 'enemy');
      const b = en.brain;
      if (en.deadT >= 0 || Math.hypot(b.x - pt.x, b.z - pt.z) > 60) continue;
      const def = this.def(en.defId);
      const eye = b.y + def.height * 0.85;
      const half = Math.min(Math.PI, ((def.senses.fov / 2) * Math.PI) / 180);
      const len = Math.min(def.senses.sight, 25);
      for (const s of [-1, 1]) ray(b.x, eye, b.z, b.x + Math.sin(b.yaw + s * half) * len, eye, b.z + Math.cos(b.yaw + s * half) * len, b.state === 'combat');
      if (b.sees) ray(b.x, eye, b.z, pt.x, pt.y + 1.2, pt.z, true);
    }
  }

  // ------------------------------------------------------------------ interno

  private bumpNoise(r: number): void {
    this.noiseBump = Math.max(this.noiseT > 0 ? this.noiseBump : 0, r);
    this.noiseT = NOISE_DECAY;
  }

  /** Radio del ruido que hace el jugador ahora mismo (m). */
  currentNoise(ctx: GameContext): number {
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const c = ctx.world.get(this.d.playerEntity, 'combat');
    const n = this.d.combat.noise;
    const m = this.d.movement;
    const speed = Math.hypot(ch.vx, ch.vz);
    let r = 0;
    if (ch.swimming) r = speed > 0.3 ? n.swim : 0;
    else if (ch.mode === 'glide') r = 0;
    else if (ch.grounded) {
      const crouching = ctx.input.isDown('crouch');
      if (speed < 0.3) r = 0;
      else if (crouching) r = n.crouch;
      else if (speed <= m.walkSpeed + 0.3) r = n.walk;
      else if (speed <= m.jogSpeed + 0.5) r = n.jog;
      else r = n.sprint;
    }
    if (c && c.melee.phase !== 'idle' && c.melee.phase !== 'charging') r = Math.max(r, n.attack);
    if (this.noiseT > 0) r = Math.max(r, this.noiseBump * (this.noiseT / NOISE_DECAY));
    return r;
  }

  private playerView(ctx: GameContext): PlayerView {
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const p = ctx.world.require(this.d.playerEntity, 'player');
    const groundY = Math.max(this.d.terrain.height(ch.x, ch.z), this.d.colliders.topAt(ch.x, ch.z, 0.3, ch.y + 0.1));
    return {
      x: ch.x,
      y: ch.y,
      z: ch.z,
      vx: ch.vx,
      vy: ch.vy,
      vz: ch.vz,
      groundY,
      airborne: ch.mode === 'air' || ch.mode === 'glide',
      gliding: ch.mode === 'glide',
      alive: p.control === 'free' && p.health.fragments > 0,
      inWater: ch.swimming || ch.waterDepth > 0.3,
    };
  }

  private stimulus(ctx: GameContext, pv: PlayerView): Stimulus {
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    return {
      x: pv.x,
      y: pv.y,
      z: pv.z,
      alive: pv.alive,
      crouching: ctx.input.isDown('crouch') && ch.grounded && !ch.swimming,
      airborne: pv.airborne && pv.y - pv.groundY > 1.2,
      speed: Math.hypot(ch.vx, ch.vz),
      noise: this.currentNoise(ctx),
    };
  }

  /** Luz en una posición: el cielo, o la hoguera de un campamento de noche. */
  private lightAt(x: number, z: number): number {
    let light = this.d.skyLight();
    if (light < 1) {
      const r = this.d.encounters.schedule.fireLightRadius;
      for (const rt of this.camps.values()) {
        const d = Math.hypot(x - rt.def.fire[0], z - rt.def.fire[1]);
        if (d < r) light = Math.max(light, 1 - (d / r) * 0.5);
      }
    }
    return light;
  }

  private aiContext(def: EnemyDef, b: Brain, pv: PlayerView, dt: number, group: GroupView | null): AIContext {
    this.events.length = 0;
    const body: Body = {
      radius: def.radius,
      height: def.height,
      // Los golems no suben escalones altos (no persiguen por bordes).
      maxStep: b.kind === 'golem' ? 0.5 : 0.7,
      maxWater: b.kind === 'slime' ? 0.6 : b.kind === 'golem' ? 1.2 : 0.5,
      turnSpeed: def.turnSpeed,
    };
    const hazard = this.fireNear && b.kind === 'goblin' ? this.fireNear(b.x, b.z, 4) : null;
    return { dt, def, player: pv, dist: Math.hypot(pv.x - b.x, pv.z - b.z), nav: this.nav, body, rng: this.rng, group, events: this.events, hazard };
  }

  private groupView(rt: CampRuntime, e: Entity, b: Brain): GroupView {
    const horn = rt.def.horn;
    return {
      alarm: rt.alarm,
      hornCaller: rt.hornCaller === e && !rt.hornBlown && !!horn,
      hornX: horn ? horn[0] : b.x,
      hornZ: horn ? horn[1] : b.z,
      canTakeToken: rt.attackers < MAX_ATTACKERS,
      regroupX: rt.def.regroup[0],
      regroupZ: rt.def.regroup[1],
    };
  }

  private onNoticed(ctx: GameContext, e: Entity, b: Brain): void {
    ctx.bus.emit('enemy:noticed', { entity: e });
    const rt = b.group ? this.camps.get(b.group) : undefined;
    if (rt && !rt.alarm && !rt.leaderDead) this.raiseAlarm(ctx, rt, e, b);
  }

  /** Alarma del campamento: alguien da la voz, otro corre al cuerno, el resto reacciona escalonado. */
  private raiseAlarm(ctx: GameContext, rt: CampRuntime, by: Entity, b: Brain): void {
    rt.alarm = true;
    ctx.bus.emit('enemy:alarm', { camp: rt.def.id, name: rt.def.name, horn: false });
    for (const m of rt.members) {
      const en = ctx.world.get(m, 'enemy');
      if (!en || en.deadT >= 0 || m === by) continue;
      const mb = en.brain;
      rt.pending.add(m);
      mb.alarmDelay = (mb.state === 'sleep' ? 1.5 : 0.3) + this.rng() * 0.9;
      mb.lastX = b.lastX;
      mb.lastY = b.lastY;
      mb.lastZ = b.lastZ;
    }
    rt.hornCaller = this.nearestToHorn(ctx, rt);
  }

  private campUpkeep(ctx: GameContext, rt: CampRuntime, hour: number, dt: number): void {
    const { world } = ctx;
    rt.members = rt.members.filter((m) => world.isAlive(m) && (world.get(m, 'enemy')?.deadT ?? 0) < 0);
    if (rt.members.length === 0) {
      if (!rt.cleared) {
        rt.cleared = true;
        ctx.bus.emit('camp:cleared', { camp: rt.def.id, name: rt.def.name });
      }
      return;
    }
    const phase = dayPhase(hour, this.d.encounters.schedule);
    rt.phase = phase;
    let attackers = 0;
    for (const m of rt.members) {
      const b = world.require(m, 'enemy').brain;
      if (b.token && b.state === 'combat') attackers++;
      // Reacción escalonada a la alarma.
      if (rt.pending.has(m)) {
        b.alarmDelay -= dt;
        if (b.alarmDelay <= 0) {
          rt.pending.delete(m);
          hearAlarm(b, b.lastX, b.lastY, b.lastZ);
        }
      }
      // Rutinas tranquilas según la hora.
      if (!isCalm(b.state) || b.role === null) continue;
      const r = routineFor(rt.def, b.role, b.slot, phase, [b.homeX, b.homeZ]);
      b.activity = r.activity;
      b.goalX = r.x;
      b.goalZ = r.z;
      b.goalYaw = r.yaw;
      if (b.role === 'patrol' && r.activity === 'patrol') b.route = rt.def.patrol;
      const want = calmStateFor(b);
      if (want === 'sleep' && b.state !== 'sleep') {
        // Se acuesta al llegar a la tienda.
        if (Math.hypot(b.x - r.x, b.z - r.z) < 1.2) setState(b, 'sleep');
      } else if (want !== 'sleep' && b.state === 'sleep') {
        setState(b, want);
      } else if (want !== 'sleep' && b.state !== want) {
        setState(b, want);
      }
    }
    rt.attackers = attackers;
    // Si cae quien iba al cuerno, otro toma el relevo.
    if (rt.alarm && rt.def.horn && !rt.hornBlown && (rt.hornCaller === null || !rt.members.includes(rt.hornCaller))) {
      rt.hornCaller = this.nearestToHorn(ctx, rt);
    }
    // Fin de la alarma: todos han vuelto a la calma.
    if (rt.alarm && rt.members.every((m) => isCalm(world.require(m, 'enemy').brain.state))) {
      rt.alarm = false;
      rt.hornCaller = null;
    }
  }

  private nearestToHorn(ctx: GameContext, rt: CampRuntime): Entity | null {
    const horn = rt.def.horn;
    if (!horn) return null;
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const m of rt.members) {
      const en = ctx.world.get(m, 'enemy');
      if (!en || en.deadT >= 0 || en.brain.role === 'lookout' || this.def(en.defId).variant === 'archer' || en.brain.state === 'flee') continue;
      const d = Math.hypot(en.brain.x - horn[0], en.brain.z - horn[1]);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  private handleEvents(ctx: GameContext, e: Entity, b: Brain, def: EnemyDef, pv: PlayerView, rt: CampRuntime | null): void {
    for (const ev of this.events) {
      switch (ev.type) {
        case 'attack_start':
          this.telegraph(b, def, ev.attack);
          break;
        case 'attack_active':
          this.activate(ctx, e, b, def, ev.attack, pv);
          break;
        case 'horn':
          if (rt) this.blowHorn(ctx, rt, pv);
          break;
        case 'phase':
          ctx.bus.emit('boss:phase', { id: this.bosses.get(e)?.id ?? def.id, phase: ev.phase });
          this.d.shake(0.6);
          break;
        case 'woke':
          this.d.fx.burst(b.x, b.y + def.height * 0.3, b.z, 'stone', 18);
          break;
        case 'impact': {
          this.d.fx.ring(ev.x, ev.y, ev.z, ev.radius, '#e8dcc6');
          this.d.fx.burst(ev.x, ev.y + 0.2, ev.z, b.kind === 'slime' ? 'gel' : 'stone', 14);
          const d = Math.hypot(pv.x - ev.x, pv.z - ev.z);
          if (d < 30) this.d.shake(Math.min(0.7, (def.height / 6) * (1 - d / 30) + 0.1));
          break;
        }
      }
    }
  }

  /** Avisos en el suelo durante la preparación de los golpes de área. */
  private telegraph(b: Brain, def: EnemyDef, a: ActiveAttack): void {
    if (!a.def.telegraph) return;
    const wind = a.def.windup / Math.max(0.1, b.speedScale);
    switch (a.def.kind) {
      case 'slam': {
        const c = slamCenter(b);
        this.d.fx.burst(c.x, b.y + 0.2, c.z, 'stone', 4);
        this.telegraphs.area(c.x, this.groundAt(c.x, c.z, b.y + 2), c.z, a.def.radius, wind);
        break;
      }
      case 'discharge':
        this.telegraphs.area(b.x, b.y, b.z, a.def.radius * (this.inWater(b) ? this.d.combat.status.shock.waterMultiplier : 1), wind, '#fff07a');
        break;
      case 'shockwave':
        this.telegraphs.area(b.x, b.y, b.z, def.radius * 1.6, wind, '#ffb43a');
        break;
      case 'rockfall':
        for (const [x, z] of a.points) this.telegraphs.area(x, this.groundAt(x, z, 1e4), z, a.def.radius, wind + 0.85);
        break;
      default:
        break;
    }
  }

  /** Efectos al activarse un ataque: proyectiles, rocas del cielo, invocaciones, ondas. */
  private activate(ctx: GameContext, e: Entity, b: Brain, def: EnemyDef, a: ActiveAttack, pv: PlayerView): void {
    const ad = a.def;
    if (ad.kind === 'shockwave') {
      this.telegraphs.wave(b.x, b.y, b.z, ad.active, () => shockwaveRadius(b));
      return;
    }
    if (ad.kind === 'projectile' && ad.projectile) {
      const pj = ad.projectile;
      for (let i = 0; i < ad.count; i++) {
        const sx = b.x + Math.sin(b.yaw) * (def.radius + 0.25);
        const sy = b.y + def.height * (b.kind === 'goblin' ? 0.8 : 0.75);
        const sz = b.z + Math.cos(b.yaw) * (def.radius + 0.25);
        let tx = pv.x;
        let ty = pv.y + 0.9;
        let tz = pv.z;
        if (pj.lead) {
          const l = leadTarget(sx, sy, sz, tx, ty, tz, pv.vx, pv.gliding ? pv.vy : 0, pv.vz, ad.speed);
          tx = l.x;
          ty = l.y;
          tz = l.z;
        }
        // Error de puntería (menor contra quien planea: lo priorizan).
        const err = pv.gliding ? 0.35 : 0.7;
        tx += (this.rng() - 0.5) * err;
        ty += (this.rng() - 0.5) * err * 0.5;
        tz += (this.rng() - 0.5) * err;
        const dist = Math.hypot(tx - sx, ty - sy, tz - sz);
        const t = dist / Math.max(1, ad.speed);
        const v = pj.gravity > 0 ? ballistic(sx, sy, sz, tx, ty, tz, t, pj.gravity) : { vx: ((tx - sx) / dist) * ad.speed, vy: ((ty - sy) / dist) * ad.speed, vz: ((tz - sz) / dist) * ad.speed };
        this.d.projectiles.spawn({
          kind: pj.look === 'arrow' ? 'arrow' : 'missile',
          owner: 'enemy',
          x: sx,
          y: sy,
          z: sz,
          vx: v.vx,
          vy: v.vy,
          vz: v.vz,
          gravity: pj.gravity,
          damage: ad.damage,
          maxAge: 6,
          element: ad.element,
          look: pj.look,
          size: pj.size,
          knockback: ad.knockback,
          splash: pj.look === 'rock' && pj.size >= 0.5 ? pj.size * 2 : undefined,
          source: e,
        });
      }
      return;
    }
    if (ad.kind === 'rockfall') {
      for (const [x, z] of a.points) {
        const g = this.groundAt(x, z, 1e4);
        this.d.projectiles.spawn({ kind: 'missile', owner: 'enemy', x, y: g + 20, z, vx: 0, vy: -18, vz: 0, gravity: 14, damage: ad.damage, maxAge: 4, element: 'physical', look: 'rock', size: 0.8, knockback: ad.knockback, splash: ad.radius, source: e });
      }
      return;
    }
    if (ad.kind === 'summon' && ad.summon) {
      const sd = this.def(ad.summon);
      for (let i = 0; i < ad.count; i++) {
        const ang = b.yaw + (i - (ad.count - 1) / 2) * 1.4;
        const c = this.spawn(ctx, sd, b.x + Math.sin(ang) * (def.radius + 3), b.z + Math.cos(ang) * (def.radius + 3), `${this.bosses.get(e)?.id ?? 'summon'}_add`);
        const cb = ctx.world.require(c, 'enemy').brain;
        cb.activity = 'hold';
        cb.wakeT = 0.8;
        enterCombat(cb, pv.x, pv.y, pv.z);
        this.d.fx.burst(cb.x, cb.y + 0.5, cb.z, 'stone', 16);
      }
    }
  }

  /** El cuerno suena: todo el campamento al ataque y llegan refuerzos. */
  private blowHorn(ctx: GameContext, rt: CampRuntime, pv: PlayerView): void {
    rt.hornBlown = true;
    rt.hornCaller = null;
    ctx.bus.emit('enemy:alarm', { camp: rt.def.id, name: rt.def.name, horn: true });
    const horn = rt.def.horn;
    if (horn) this.d.fx.ring(horn[0], this.groundAt(horn[0], horn[1], 1e4) + 1.5, horn[1], 12, '#ffd27a');
    for (const m of rt.members) {
      const en = ctx.world.get(m, 'enemy');
      if (en && en.deadT < 0) {
        rt.pending.delete(m);
        hearAlarm(en.brain, pv.x, pv.y, pv.z);
      }
    }
    const rf = rt.def.reinforcements;
    if (rf && !rt.reinforcementsSent) {
      rt.reinforcementsSent = true;
      rf.members.forEach((id, i) => {
        const x = rf.from[0] + (i - (rf.members.length - 1) / 2) * 2;
        const e = this.addMember(ctx, rt, id, 'cook', rt.def.members.length + i, x, rf.from[1]);
        hearAlarm(ctx.world.require(e, 'enemy').brain, pv.x, pv.y, pv.z);
      });
      ctx.bus.emit('enemy:reinforcements', { camp: rt.def.id, count: rf.members.length });
    }
  }

  private updateBoss(ctx: GameContext, e: Entity, b: Brain, def: EnemyDef, pv: PlayerView): void {
    const info = this.bosses.get(e);
    if (!info) return;
    // Entrar en la arena despierta al Coloso.
    if (b.state === 'sleep' && b.wakeT < 0 && def.boss && def.golem && Math.hypot(pv.x - b.homeX, pv.z - b.homeZ) < def.boss.arenaRadius * 0.6 && pv.alive) {
      b.wakeT = def.golem.wakeSeconds;
      enterCombat(b, pv.x, pv.y, pv.z);
    }
    if (b.state === 'combat' && b.wakeT < 0 && !info.engaged) {
      info.engaged = true;
      ctx.bus.emit('boss:engaged', { id: info.id, name: def.name, title: def.boss?.title ?? '' });
    } else if (isCalm(b.state) && info.engaged) {
      info.engaged = false;
    }
  }

  /** Los enemigos de suelo no se apilan. */
  private separate(ctx: GameContext): void {
    const list = ctx.world.query('enemy');
    for (let i = 0; i < list.length; i++) {
      const a = ctx.world.get(list[i], 'enemy');
      if (!a || a.deadT >= 0 || a.brain.kind === 'hawk') continue;
      const ra = this.def(a.defId).radius;
      for (let j = i + 1; j < list.length; j++) {
        const c = ctx.world.get(list[j], 'enemy');
        if (!c || c.deadT >= 0 || c.brain.kind === 'hawk') continue;
        const dx = c.brain.x - a.brain.x;
        const dz = c.brain.z - a.brain.z;
        if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
        const d = Math.hypot(dx, dz);
        const min = ra + this.def(c.defId).radius;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          a.brain.x -= (dx / d) * push;
          a.brain.z -= (dz / d) * push;
          c.brain.x += (dx / d) * push;
          c.brain.z += (dz / d) * push;
        }
      }
    }
  }

  private despawn(ctx: GameContext, e: Entity): void {
    const v = this.views.get(e);
    if (v) {
      v.root.removeFromParent();
      v.dispose();
      this.views.delete(e);
    }
    this.roostGround.delete(e);
    this.bosses.delete(e);
    ctx.world.destroyEntity(e);
  }
}
