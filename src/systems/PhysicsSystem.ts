import * as THREE from 'three';
import { inArc } from '../combat/damage';
import type { HitFx } from '../combat/HitFx';
import type { Projectile } from '../combat/projectiles';
import type { GameContext, System } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import type { MobilityConfig } from '../data/schemas';
import { applyImpulse, blastBodies, bodyHeight, collideBodies, createBody, segmentHitsBody, stepBody, type Body, type BodyEnv } from '../world/physics/Bodies';
import type { Collider, StaticColliders } from '../world/physics/StaticColliders';
import { makeRockGeometry, materials } from '../world/props/kit';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import type { CombatSystem } from './CombatSystem';
import type { ElementSystem } from './ElementSystem';
import type { EnemySystem } from './EnemySystem';
import type { PickupSystem } from './PickupSystem';
import type { PlayerSystem } from './PlayerSystem';

export interface PhysicsDeps {
  cfg: MobilityConfig;
  playerEntity: Entity;
  terrain: TerrainGenerator;
  colliders: StaticColliders;
  scene: THREE.Scene;
  fx: HitFx;
  combat: CombatSystem;
  elements: ElementSystem;
  enemies: EnemySystem;
  pickups: PickupSystem;
  player: PlayerSystem;
  gravity: number;
  killY: number;
  shake: (amount: number) => void;
}

interface BodyRuntime {
  body: Body;
  object: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  collider: Collider;
  flame: THREE.Object3D | null;
  /** Reaparece (los de la lista de datos); las bombas rúnicas no. */
  respawns: boolean;
}

interface Breakable {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  loot: string;
  object: THREE.Group;
  collider: Collider;
  broken: boolean;
}

const BARREL_FUSE = 2.2;
const CHAIN_FUSE = 0.18;
const RESPAWN_SECONDS = 75;
const tint = new THREE.Color();

/**
 * Física sistémica de objetos: cajas, bolas de hierro, rocas, barriles explosivos y bombas
 * rúnicas. Ruedan, flotan, se apilan, se empujan, chocan con enemigos y reaccionan a golpes,
 * flechas, fuego, viento y explosiones. También gestiona las rocas agrietadas.
 */
export class PhysicsSystem implements System {
  readonly name = 'physics';
  readonly group = new THREE.Group();
  private readonly list: BodyRuntime[] = [];
  private readonly breakables: Breakable[] = [];
  private nextId = 1;
  private lastSwing = -1;
  private readonly swingHits = new Set<number>();
  private readonly impulseArrow: THREE.Mesh;
  /** Objeto resaltado (objetivo de runa o garfio). */
  highlight: { body: Body; color: string } | null = null;
  private readonly env: BodyEnv;
  private current: BodyRuntime | null = null;
  private readonly pushPos = { x: 0, y: 0, z: 0 };

  constructor(private readonly d: PhysicsDeps) {
    this.group.name = 'physics';
    d.scene.add(this.group);
    const n = { x: 0, y: 1, z: 0 };
    this.env = {
      ground: (b, x, z, maxTop) => Math.max(d.terrain.height(x, z), d.colliders.topAt(x, z, b.def.radius * 0.6, maxTop, this.current?.collider)),
      water: (x, z) => d.elements.waterAt(x, z),
      push: (b) => {
        const p = this.pushPos;
        p.x = b.x;
        p.y = b.y;
        p.z = b.z;
        const r = d.colliders.pushOut(p, b.def.radius * 0.95, bodyHeight(b), 0.25, this.current?.collider);
        if (!r.hit) return null;
        b.x = p.x;
        b.z = p.z;
        return { nx: r.nx, nz: r.nz };
      },
      normal: (x, z) => d.terrain.normal(x, z, n),
    };
    this.impulseArrow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1, 10).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#ffd34a', transparent: true, opacity: 0.85, depthTest: false }));
    this.impulseArrow.renderOrder = 10;
    this.impulseArrow.visible = false;
    this.group.add(this.impulseArrow);
    d.combat.bodyTargets = {
      segment: (ax, ay, az, bx, by, bz) => {
        let best: { id: number; tHit: number } | null = null;
        for (const r of this.list) {
          if (!r.body.alive) continue;
          const t = segmentHitsBody(r.body, ax, ay, az, bx, by, bz);
          if (t !== null && (!best || t < best.tHit)) best = { id: -r.body.id, tHit: t };
        }
        return best;
      },
      hit: (_ctx, id, pr, x, y, z) => this.projectileHit(-id, pr, x, y, z),
    };
  }

  // ------------------------------------------------------------------ creación

  spawnAll(): void {
    for (const b of this.d.cfg.bodies) {
      const [x, z] = b.position;
      this.spawn(b.kind, x, this.d.terrain.height(x, z) + (b.yOffset ?? 0), z, true, b.yOffset ?? 0);
    }
    for (const br of this.d.cfg.breakables) this.addBreakable(br);
  }

  spawn(kind: string, x: number, y: number, z: number, respawns: boolean, yOffset = 0): Body {
    const def = this.d.cfg.bodyKinds[kind];
    if (!def) throw new Error(`Objeto físico "${kind}" no definido en mobility.json`);
    const body = createBody(this.nextId++, kind, def, x, y, z);
    body.homeYOffset = yOffset;
    const { object, mats, flame } = buildBodyMesh(kind, def.shape, def.radius, def.color, body.id);
    const h = bodyHeight(body);
    const collider: Collider =
      def.shape === 'sphere'
        ? this.d.colliders.addCylinder(x, z, def.radius * 0.8, y, y + h, def.metal ? 'metal' : 'stone')
        : this.d.colliders.addBox(x, y + h / 2, z, def.radius, h / 2, def.radius, 0, def.metal ? 'metal' : 'wood');
    this.group.add(object);
    this.list.push({ body, object, mats, collider, flame, respawns });
    return body;
  }

  private addBreakable(def: MobilityConfig['breakables'][number]): void {
    const [x, z] = def.position;
    const y = this.d.terrain.height(x, z);
    const object = new THREE.Group();
    const rock = new THREE.Mesh(makeRockGeometry(77 + this.breakables.length), materials.rock);
    rock.scale.set(def.radius, def.radius * 0.85, def.radius);
    rock.position.y = def.radius * 0.6;
    rock.castShadow = rock.receiveShadow = true;
    object.add(rock);
    // Grietas brillantes: delatan que se puede romper con explosivos.
    const crack = new THREE.MeshBasicMaterial({ color: '#ffb25a' });
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.06, def.radius * 1.1, 0.06), crack);
      const a = (i / 4) * Math.PI * 2 + 0.4;
      c.position.set(Math.cos(a) * def.radius * 0.86, def.radius * 0.65, Math.sin(a) * def.radius * 0.86);
      c.rotation.set(0.3 * (i % 2 ? 1 : -1), -a, 0.35);
      object.add(c);
    }
    object.position.set(x, y, z);
    this.group.add(object);
    const collider = this.d.colliders.addCylinder(x, z, def.radius * 0.85, y, y + def.radius * 1.5, 'stone');
    this.breakables.push({ id: def.id, x, y, z, radius: def.radius, loot: def.loot, object, collider, broken: false });
  }

  /** Rocas agrietadas ya destruidas (guardado). */
  get brokenIds(): string[] {
    return this.breakables.filter((b) => b.broken).map((b) => b.id);
  }

  restoreBroken(ids: Iterable<string>): void {
    const set = new Set(ids);
    for (const b of this.breakables) {
      const broken = set.has(b.id);
      if (broken === b.broken) continue;
      b.broken = broken;
      b.object.visible = !broken;
      if (broken) this.d.colliders.remove(b.collider);
      else this.d.colliders.add(b.collider);
    }
  }

  // ------------------------------------------------------------------ consultas

  get bodies(): Body[] {
    return this.list.map((r) => r.body);
  }

  /** Primer objeto que cruza el rayo (dirección normalizada), con la distancia. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, filter?: (b: Body) => boolean): { body: Body; t: number } | null {
    let best: { body: Body; t: number } | null = null;
    for (const r of this.list) {
      const b = r.body;
      if (!b.alive || (filter && !filter(b))) continue;
      const t = segmentHitsBody(b, ox, oy, oz, ox + dx * max, oy + dy * max, oz + dz * max);
      if (t !== null && (!best || t * max < best.t)) best = { body: b, t: t * max };
    }
    return best;
  }

  byId(id: number): Body | null {
    return this.list.find((r) => r.body.id === id)?.body ?? null;
  }

  // ------------------------------------------------------------------ acciones (runas, garfio, viento)

  stasis(b: Body, seconds: number): void {
    b.stasisT = seconds;
    b.vx = b.vy = b.vz = 0;
    b.ix = b.iy = b.iz = 0;
    b.held = false;
  }

  hold(b: Body, held: boolean): void {
    b.held = held;
    if (held) {
      b.stasisT = 0;
      b.grounded = false;
    }
  }

  /** Mueve un objeto sujeto (imán, garfio) hacia un punto con velocidad limitada. */
  steer(b: Body, tx: number, ty: number, tz: number, maxSpeed: number, dt: number): void {
    const r = this.list.find((x) => x.body === b);
    if (!r) return;
    let vx = (tx - b.x) * 6;
    let vy = (ty - b.y) * 6;
    let vz = (tz - b.z) * 6;
    const s = Math.hypot(vx, vy, vz);
    if (s > maxSpeed) {
      vx *= maxSpeed / s;
      vy *= maxSpeed / s;
      vz *= maxSpeed / s;
    }
    b.vx = vx;
    b.vy = vy;
    b.vz = vz;
    this.current = r;
    b.x += vx * dt;
    b.z += vz * dt;
    this.env.push(b);
    b.y = Math.max(b.y + vy * dt, this.env.ground(b, b.x, b.z, b.y + b.def.radius));
    this.current = null;
  }

  /** Enciende la mecha de un barril (fuego, antorcha, flecha de fuego). */
  ignite(b: Body, fuse = BARREL_FUSE): void {
    if (!b.def.explosive || !b.alive) return;
    if (b.fuse < 0 || b.fuse > fuse) b.fuse = fuse;
  }

  /**
   * Onda expansiva genérica. `fire`: barriles (daño y fuego) · `rune`: bomba rúnica ·
   * `wind`: ráfaga sin daño que empuja, lanza al jugador y apaga llamas.
   */
  explode(ctx: GameContext, x: number, y: number, z: number, radius: number, damage: number, kind: 'fire' | 'wind' | 'rune'): void {
    const wind = kind === 'wind';
    const force = wind ? this.d.cfg.windBomb.force : 16;
    for (const { body } of blastBodies(this.bodies, x, y, z, radius, force)) {
      if (!wind && body.def.explosive && body.fuse < 0) body.fuse = CHAIN_FUSE;
    }
    this.d.combat.explosion(ctx, x, y, z, radius, damage, wind ? 10 : 7, kind === 'fire' ? 'fire' : 'physical', !wind);
    if (!wind) {
      for (const br of this.breakables) {
        if (!br.broken && Math.hypot(br.x - x, br.y + br.radius * 0.6 - y, br.z - z) < radius + br.radius) this.breakRock(ctx, br);
      }
    }
    if (kind === 'fire') this.d.elements.igniteAt(ctx, x, y, z, 2.5);
    if (wind) this.d.elements.fire.extinguish(x, z, radius * 0.7);

    // Jugador: la ráfaga lo lanza (salto bomba de viento); el resto lo empuja la combate.
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const dist = Math.hypot(ch.x - x, ch.y + 0.9 - y, ch.z - z);
    if (wind && dist < radius) {
      const k = 1 - dist / radius;
      const lift = this.d.cfg.windBomb.playerLift * (0.55 + 0.45 * k);
      if (ch.mode === 'glide') ch.vy = Math.max(ch.vy, lift * 0.75);
      else if (ch.mode === 'ground' || ch.mode === 'air' || ch.mode === 'swim') {
        ch.vy = Math.max(ch.vy, lift);
        ch.grounded = false;
        ch.swimming = false;
        ch.mode = 'air';
        ch.jumpRising = false;
        ch.fallStartY = ch.y;
        const hx = ch.x - x;
        const hz = ch.z - z;
        const hl = Math.hypot(hx, hz) || 1;
        ch.vx += (hx / hl) * 4 * k;
        ch.vz += (hz / hl) * 4 * k;
      }
    }
    if (wind) {
      this.d.fx.ring(x, y, z, radius, '#d9fff4');
      this.d.fx.burst(x, y, z, 'parry', 14);
    } else {
      this.d.fx.ring(x, y, z, radius, kind === 'rune' ? '#7ff0ff' : '#ffb347');
      this.d.fx.burst(x, y, z, 'spark', 30);
      this.d.fx.burst(x, y, z, 'stone', 12);
    }
    this.d.shake(Math.max(0, (wind ? 0.35 : 0.9) * (1 - dist / (radius * 4))));
    ctx.bus.emit('world:explosion', { x, y, z, radius, kind });
  }

  /** Destruye un objeto (barril que estalla, bomba detonada). */
  destroy(b: Body): void {
    const r = this.list.find((x) => x.body === b);
    if (!r || !b.alive) return;
    b.alive = false;
    b.deadT = 0;
    b.held = false;
    b.stasisT = 0;
    r.object.visible = false;
    this.d.colliders.remove(r.collider);
    if (!r.respawns) {
      this.group.remove(r.object);
      this.list.splice(this.list.indexOf(r), 1);
    }
  }

  // ------------------------------------------------------------------ paso

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    const wdt = dt * ctx.time.worldScale;
    if (wdt <= 0) return;
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const pr = this.d.player.bodyRadius;

    for (const r of this.list) {
      const b = r.body;
      if (!b.alive) {
        b.deadT += wdt;
        if (r.respawns && b.deadT > RESPAWN_SECONDS && Math.hypot(ch.x - b.homeX, ch.z - b.homeZ) > 50) this.respawn(r);
        continue;
      }
      this.current = r;
      const res = stepBody(b, this.env, this.d.gravity, wdt);
      this.current = null;
      if (res.splashed) this.d.fx.burst(b.x, b.y + b.def.radius, b.z, 'gel', 8);
      if (res.impact > 8 && b.def.mass > 20) this.d.fx.burst(b.x, b.y, b.z, 'stone', 6);
      if (b.y < this.d.killY) {
        this.destroy(b);
        continue;
      }
      // Barriles: el fuego cercano prende la mecha.
      if (b.def.explosive) {
        if (b.fuse < 0 && this.d.elements.fire.burningNear(b.x, b.z, b.def.radius + 0.8) > 0) this.ignite(b);
        if (b.fuse >= 0) {
          b.fuse -= wdt;
          if (b.fuse <= 0) {
            this.destroy(b);
            this.explode(ctx, b.x, b.y + b.def.radius, b.z, 4.5, 6, 'fire');
            continue;
          }
        }
      }
    }
    // Choques entre objetos.
    for (let i = 0; i < this.list.length; i++) {
      for (let j = i + 1; j < this.list.length; j++) collideBodies(this.list[i].body, this.list[j].body);
    }

    // El jugador empuja lo ligero al andar contra ello.
    const intent = this.d.player.lastMove;
    for (const r of this.list) {
      const b = r.body;
      if (!b.alive || b.stasisT > 0 || b.held || b.def.mass > 45) continue;
      const dx = b.x - ch.x;
      const dz = b.z - ch.z;
      const dist = Math.hypot(dx, dz);
      if (dist > b.def.radius + pr + 0.12 || ch.y > b.y + bodyHeight(b) - 0.3 || ch.y + 1.6 < b.y) continue;
      const along = (intent.x * dx + intent.z * dz) / Math.max(dist, 1e-3);
      if (along > 0.3 && ch.grounded) {
        const push = 2.6 * (12 / Math.max(12, b.def.mass));
        b.vx += ((dx / dist) * push - b.vx) * Math.min(1, 8 * wdt);
        b.vz += ((dz / dist) * push - b.vz) * Math.min(1, 8 * wdt);
      }
    }

    this.meleeOnBodies(ctx, ch);
    this.crushes(ctx, ch);

    for (const r of this.list) {
      const b = r.body;
      if (!b.alive) continue;
      const h = bodyHeight(b);
      if (r.collider.kind === 'box') this.d.colliders.move(r.collider, b.x, b.y + h / 2, b.z);
      else this.d.colliders.move(r.collider, b.x, b.y, b.z);
    }
  }

  render(ctx: GameContext): void {
    const t = ctx.time.elapsed;
    let arrowFor: Body | null = null;
    for (const r of this.list) {
      const b = r.body;
      if (!b.alive) continue;
      r.object.position.set(b.x, b.y, b.z);
      if (b.def.shape === 'sphere') r.object.rotation.set(b.rollX, 0, b.rollZ);
      if (r.flame) {
        r.flame.visible = b.fuse >= 0;
        r.flame.scale.setScalar(0.8 + Math.sin(t * 30) * 0.2);
      }
      // Tinte: amarillo detenido, color del resaltado, rojo parpadeante con la mecha.
      let color: string | null = null;
      let k = 0;
      if (b.stasisT > 0) {
        color = '#ffd34a';
        k = b.stasisT < 2 ? 0.4 + 0.6 * Math.abs(Math.sin(t * 12)) : 0.9;
        if (Math.hypot(b.ix, b.iy, b.iz) > 1e-3) arrowFor = b;
      } else if (b.held) {
        color = '#ff6a5a';
        k = 0.8;
      } else if (this.highlight?.body === b) {
        color = this.highlight.color;
        k = 0.5 + 0.3 * Math.sin(t * 8);
      } else if (b.fuse >= 0) {
        color = '#ff4a2a';
        k = Math.abs(Math.sin(t * 16));
      } else if (b.kind === 'bomb') {
        color = '#1fd6ff';
        k = 0.6 + 0.4 * Math.sin(t * 6);
      }
      for (const m of r.mats) {
        if (color) m.emissive.copy(tint.set(color));
        m.emissiveIntensity = color ? k : 0;
      }
    }
    // Flecha de impulso acumulado del Sello Quieto.
    this.impulseArrow.visible = arrowFor !== null;
    if (arrowFor) {
      const b = arrowFor;
      const len = Math.min(4, 0.6 + Math.hypot(b.ix, b.iy, b.iz) / b.def.mass / 6);
      this.impulseArrow.position.set(b.x, b.y + b.def.radius, b.z);
      this.impulseArrow.scale.set(1, len, 1);
      this.impulseArrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(b.ix, b.iy, b.iz).normalize());
    }
  }

  // ------------------------------------------------------------------ internos

  private respawn(r: BodyRuntime): void {
    const b = r.body;
    const yOff = b.homeYOffset;
    Object.assign(b, createBody(b.id, b.kind, b.def, b.homeX, this.d.terrain.height(b.homeX, b.homeZ) + yOff, b.homeZ));
    b.homeYOffset = yOff;
    r.object.visible = true;
    this.d.colliders.add(r.collider);
  }

  private breakRock(ctx: GameContext, br: Breakable): void {
    br.broken = true;
    br.object.visible = false;
    this.d.colliders.remove(br.collider);
    this.d.fx.burst(br.x, br.y + br.radius * 0.6, br.z, 'stone', 30);
    this.d.pickups.dropLoot(ctx, br.loot, br.x, br.y + 0.4, br.z);
    ctx.bus.emit('breakable:destroyed', { id: br.id });
    ctx.bus.emit('hud:note', { text: 'La roca agrietada se ha hecho añicos', tone: 'good' });
  }

  /** Golpes cuerpo a cuerpo: empujan objetos (y cargan los detenidos en el tiempo). */
  private meleeOnBodies(ctx: GameContext, ch: { x: number; y: number; z: number; yaw: number }): void {
    const w = this.d.combat.meleeWindow;
    if (!w) return;
    if (w.swingId !== this.lastSwing) {
      this.lastSwing = w.swingId;
      this.swingHits.clear();
    }
    const stasisPower = this.d.cfg.runes.find((r) => r.id === 'stasis')?.power ?? 8;
    const dmg = this.d.combat.meleeDamage(ctx) * w.multiplier;
    const torch = this.d.elements.torchActive(ctx);
    for (const r of this.list) {
      const b = r.body;
      if (!b.alive || this.swingHits.has(b.id)) continue;
      const dy = b.y + b.def.radius - (ch.y + 1);
      if (dy < -1.6 || dy > 1.8 || !inArc(ch.x, ch.z, ch.yaw, b.x, b.z, b.def.radius, w.reach, w.arc)) continue;
      this.swingHits.add(b.id);
      const dx = b.x - ch.x;
      const dz = b.z - ch.z;
      const l = Math.hypot(dx, dz) || 1;
      const ux = dx / l;
      const uz = dz / l;
      if (b.stasisT > 0) {
        // Cada golpe suma velocidad al lanzamiento, sea cual sea el peso.
        const add = stasisPower * (0.6 + 0.06 * dmg);
        applyImpulse(b, ux * add * b.def.mass, add * 0.25 * b.def.mass, uz * add * b.def.mass);
        this.d.fx.burst(b.x, b.y + b.def.radius, b.z, 'parry', 8);
      } else {
        const imp = (2.5 + dmg * 0.3) * Math.min(b.def.mass, 15);
        applyImpulse(b, ux * imp, imp * 0.3, uz * imp);
        this.d.fx.burst(b.x, b.y + b.def.radius, b.z, b.def.metal ? 'spark' : 'wood', 6);
      }
      if (torch && b.def.explosive) this.ignite(b);
    }
  }

  /** Objetos rápidos dañan a quien golpean. */
  private crushes(ctx: GameContext, ch: { x: number; y: number; z: number }): void {
    for (const r of this.list) {
      const b = r.body;
      if (!b.alive || b.hitCooldown > 0 || b.stasisT > 0) continue;
      const speed = Math.hypot(b.vx, b.vy, b.vz);
      if (speed < 7) continue;
      const dmg = Math.min(20, Math.max(1, Math.round((speed * b.def.mass) / 55)));
      for (const e of ctx.world.query('enemy')) {
        const en = ctx.world.require(e, 'enemy');
        if (en.deadT >= 0) continue;
        const def = this.d.enemies.def(en.defId);
        const eb = en.brain;
        if (Math.hypot(eb.x - b.x, eb.z - b.z) > def.radius + b.def.radius || b.y > eb.y + def.height || b.y + bodyHeight(b) < eb.y) continue;
        const killed = this.d.enemies.hit(ctx, e, dmg, { fromX: b.x - b.vx, fromZ: b.z - b.vz, knockback: Math.min(10, speed * 0.5), stagger: true, stun: 0.3 });
        ctx.bus.emit('combat:hit', { x: eb.x, y: eb.y + def.height * 0.6, z: eb.z, damage: dmg, kind: 'heavy', sneak: false, weak: false, tags: def.tags });
        this.d.fx.burst(eb.x, eb.y + def.height * 0.6, eb.z, 'stone', 12);
        if (killed) this.d.combat.killFromWorld(ctx, e);
        b.hitCooldown = 0.4;
        b.vx *= 0.6;
        b.vz *= 0.6;
      }
      if (b.held || b.kind === 'bomb' || speed < 9 || b.hitCooldown > 0) continue;
      if (Math.hypot(ch.x - b.x, ch.z - b.z) < b.def.radius + 0.45 && ch.y < b.y + bodyHeight(b) && ch.y + 1.7 > b.y) {
        this.d.combat.hurtFromWorld(ctx, Math.min(8, Math.round(dmg / 2)), 'physical', b.x, b.z, 6);
        b.hitCooldown = 0.6;
      }
    }
  }

  private projectileHit(id: number, pr: Projectile, x: number, y: number, z: number): void {
    const b = this.byId(id);
    if (!b || !b.alive) return;
    const s = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
    const stasisPower = this.d.cfg.runes.find((r) => r.id === 'stasis')?.power ?? 8;
    const add = b.stasisT > 0 ? stasisPower * 0.8 * b.def.mass : 3 * Math.min(b.def.mass, 10);
    applyImpulse(b, (pr.vx / s) * add, (pr.vy / s) * add * 0.5 + (b.stasisT > 0 ? 0 : add * 0.2), (pr.vz / s) * add);
    this.d.fx.burst(x, y, z, b.def.metal ? 'spark' : 'wood', 6);
    if (pr.element === 'fire' && b.def.explosive) this.ignite(b, 0.35);
  }
}

// ------------------------------------------------------------------ aspecto

function buildBodyMesh(kind: string, shape: string, r: number, color: string, seed: number): { object: THREE.Group; mats: THREE.MeshStandardMaterial[]; flame: THREE.Object3D | null } {
  const object = new THREE.Group();
  const mats: THREE.MeshStandardMaterial[] = [];
  const mat = (c: string, rough: number, metal: number) => {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, emissive: '#000000' });
    mats.push(m);
    return m;
  };
  const add = (g: THREE.BufferGeometry, m: THREE.Material, y: number) => {
    const o = new THREE.Mesh(g, m);
    o.position.y = y;
    o.castShadow = o.receiveShadow = true;
    object.add(o);
    return o;
  };
  let flame: THREE.Object3D | null = null;
  if (shape === 'box') {
    const metal = kind.includes('metal');
    const main = mat(color, metal ? 0.5 : 0.9, metal ? 0.35 : 0);
    add(new THREE.BoxGeometry(r * 2, r * 2, r * 2), main, r);
    const band = mat(metal ? '#4a525c' : '#5a3f24', 0.7, metal ? 0.3 : 0);
    for (const s of [-1, 1]) {
      const b = add(new THREE.BoxGeometry(r * 2.06, r * 0.2, r * 2.06), band, r + s * r * 0.7);
      b.castShadow = false;
    }
  } else if (shape === 'barrel') {
    const h = r * 2.4;
    add(new THREE.CylinderGeometry(r, r * 0.92, h, 14), mat(color, 0.7, 0), h / 2);
    const band = mat('#3a2a1c', 0.8, 0.2);
    for (const k of [0.2, 0.8]) add(new THREE.CylinderGeometry(r * 1.03, r * 1.03, r * 0.16, 14), band, h * k);
    // Símbolo de peligro: rombo naranja.
    const sign = add(new THREE.OctahedronGeometry(r * 0.32, 0), new THREE.MeshBasicMaterial({ color: '#ffb347' }), h * 0.5);
    sign.position.z = r * 0.95;
    sign.scale.z = 0.3;
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 6), new THREE.MeshBasicMaterial({ color: '#ffb347' }));
    f.position.y = h + 0.25;
    f.visible = false;
    object.add(f);
    flame = f;
  } else if (kind === 'boulder') {
    const o = add(makeRockGeometry(500 + seed), mat(color, 0.95, 0), r);
    o.scale.setScalar(r);
  } else {
    const isBomb = kind === 'bomb';
    add(new THREE.IcosahedronGeometry(r, 2), mat(isBomb ? '#16323c' : color, isBomb ? 0.3 : 0.45, 0.35), r);
    if (isBomb) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, r * 0.08, 6, 24), new THREE.MeshBasicMaterial({ color: '#1fd6ff' }));
      ring.position.y = r;
      ring.rotation.x = Math.PI / 2;
      object.add(ring);
    }
  }
  return { object, mats, flame };
}
