import * as THREE from 'three';
import { attackReaches, isBlockable } from '../ai/attacks';
import { arrowSpeed, arrowsForShot, compensateDrop, drawFraction } from '../combat/bow';
import { computeDamage, inArc, type AttackKind } from '../combat/damage';
import { createDefense, resolveIncoming } from '../combat/defense';
import type { HitFx } from '../combat/HitFx';
import { equip, equipped, findGear, removeGear, takeItem, wear, type Catalog, type SlotKind } from '../combat/inventory';
import { createMelee, heavyProfile, stepMelee, type HitWindow } from '../combat/melee';
import type { ProjectileManager } from '../combat/ProjectileManager';
import { reflectProjectile, segmentSphere, type Projectile } from '../combat/projectiles';
import type { GameContext, System } from '../core/Game';
import type { CombatState } from '../core/ecs/components';
import type { Entity } from '../core/ecs/World';
import { wrapAngle } from '../core/math';
import type { AttackDef, CombatConfig, Element, ElementsConfig, EnemyDef, ShieldDef, StaminaConfig, WeaponDef } from '../data/schemas';
import { raymarchTerrain, type CameraController } from '../player/CameraController';
import { foldGlider } from '../player/movement/glide';
import { canUse, spend, spendRate } from '../player/movement/Stamina';
import type { CombatPose } from '../player/PlayerVisual';
import type { StaticColliders } from '../world/physics/StaticColliders';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import type { EnemySystem } from './EnemySystem';
import type { PickupSystem } from './PickupSystem';
import type { Stats } from '../items/stats';
import type { ElementSystem } from './ElementSystem';
import type { PlayerSystem } from './PlayerSystem';

export interface WheelEntry {
  slot: SlotKind;
  uid: number | null;
  name: string;
  durability: number;
  max: number;
}

export interface CombatDeps {
  playerEntity: Entity;
  cfg: CombatConfig;
  stamina: StaminaConfig;
  catalog: Catalog;
  player: PlayerSystem;
  enemies: EnemySystem;
  pickups: PickupSystem;
  camera: CameraController;
  threeCamera: THREE.PerspectiveCamera;
  colliders: StaticColliders;
  terrain: TerrainGenerator;
  fx: HitFx;
  projectiles: ProjectileManager;
  elementsCfg: ElementsConfig;
  /** Lluvia 0..1 donde está el jugador. */
  rain: () => number;
  /** Estadísticas del equipo y la comida (fuerza, arco, resistencias). */
  stats: () => Stats;
}

const WHEEL_SCALE = 0.08;
const THROW_RANGE = 18;
const ARROW_GRAVITY = 9.8;
/** Hasta esta distancia la flecha va donde apunta la mira (compensa la caída). */
const ARROW_ASSIST_RANGE = 45;
const FLURRY_DASH_RANGE = 7;

export function createCombatState(equipment: CombatState['equipment']): CombatState {
  return {
    equipment,
    melee: createMelee(),
    defense: createDefense(),
    drawT: 0,
    aiming: false,
    plunging: false,
    flurryT: 0,
    flurryTarget: null,
    hitstopT: 0,
    lockTarget: null,
    wheelOpen: false,
    swingId: -1,
    swingHits: [],
    moveMultiplier: 1,
    faceYaw: null,
    lunge: 0,
    poisonT: 0,
    poisonTick: 0,
    shockT: 0,
    burnT: 0,
    burnTick: 0,
    bleedT: 0,
    bleedTick: 0,
    freezeT: 0,
    arrowType: 'arrow',
    staffCd: 0,
  };
}

/**
 * Combate del jugador. Se registra como dos sistemas:
 * `pre` (antes del movimiento: entrada, ataques, arco, escudo, escalas de tiempo) y
 * `post` (después: impactos, ataques enemigos, proyectiles, pisotón y picado).
 */
export class CombatSystem {
  readonly pre: System;
  readonly post: System;
  wheelEntries: WheelEntry[] = [];
  wheelIndex = 0;
  private window: HitWindow | null = null;
  private attackYaw = 0;
  private lookX = 0;
  private lookY = 0;
  private readonly tmpDir = new THREE.Vector3();
  /** Sistemas elementales (fuego, hielo, electricidad); se conecta tras crearse. */
  elements: ElementSystem | null = null;
  private lastSwing = -1;

  constructor(
    private readonly d: CombatDeps,
    ctx: GameContext,
  ) {
    this.pre = { name: 'combat-pre', fixedUpdate: (c, dt) => this.stepPre(c, dt) };
    this.post = { name: 'combat-post', fixedUpdate: (c, dt) => this.stepPost(c, dt), render: (c) => this.d.fx.update(c.time.frameDt * c.time.worldScale) };
    d.player.combatPose = () => this.pose(ctx);
    ctx.bus.on('input:action', ({ action, phase }) => {
      if (action === 'lock_on' && phase === 'pressed' && ctx.session.mode === 'play') this.toggleLock(ctx);
    });
    // Reaparecer cura los estados alterados.
    ctx.bus.on('player:respawned', () => {
      const c = ctx.world.get(d.playerEntity, 'combat');
      if (!c) return;
      if (c.poisonT > 0) ctx.bus.emit('player:status', { kind: 'poison', active: false });
      c.poisonT = 0;
      c.shockT = 0;
    });
  }

  /** Movimiento de ratón mientras la rueda está abierta (la cámara no gira). */
  wheelLook(dx: number, dy: number): void {
    this.lookX += dx;
    this.lookY += dy;
    if (Math.hypot(this.lookX, this.lookY) > 40 && this.wheelEntries.length > 0) {
      const a = Math.atan2(this.lookX, -this.lookY);
      const n = this.wheelEntries.length;
      this.wheelIndex = (((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n);
    }
  }

  meleeDef(c: CombatState): WeaponDef {
    const m = equipped(c.equipment, 'melee');
    return this.d.catalog.weapon(m ? m.id : 'fists');
  }

  bowDef(c: CombatState): WeaponDef | null {
    const b = equipped(c.equipment, 'bow');
    return b ? this.d.catalog.weapon(b.id) : null;
  }

  shieldDef(c: CombatState): ShieldDef | null {
    const s = equipped(c.equipment, 'shield');
    return s ? this.d.catalog.shield(s.id) : null;
  }

  lockPosition(ctx: GameContext): { x: number; y: number; z: number } | null {
    const c = ctx.world.get(this.d.playerEntity, 'combat');
    if (!c || c.lockTarget === null) return null;
    const t = ctx.world.get(c.lockTarget, 'transform');
    return t ? { x: t.x, y: t.y + 0.6, z: t.z } : null;
  }

  // ------------------------------------------------------------------ PRE

  private stepPre(ctx: GameContext, dt: number): void {
    const { world, input, time } = ctx;
    time.worldScale = 1;
    time.playerScale = 1;
    if (ctx.session.mode !== 'play') return;
    const cfg = this.d.cfg;
    const c = world.require(this.d.playerEntity, 'combat');
    const ch = world.require(this.d.playerEntity, 'character');
    const p = world.require(this.d.playerEntity, 'player');
    c.hitstopT = Math.max(0, c.hitstopT - dt);
    if (c.flurryT > 0) {
      c.flurryT = Math.max(0, c.flurryT - dt);
      if (c.flurryT === 0) {
        c.flurryTarget = null;
        ctx.bus.emit('combat:flurry', { active: false });
      }
    }
    c.moveMultiplier = 1;
    c.faceYaw = null;
    c.lunge = 0;
    this.window = null;

    // --- estados alterados
    const st = cfg.status;
    if (c.poisonT > 0) {
      c.poisonT = Math.max(0, c.poisonT - dt);
      c.poisonTick -= dt;
      if (c.poisonTick <= 0 && p.control === 'free') {
        c.poisonTick = st.poison.tickSeconds;
        this.d.fx.burst(ch.x, ch.y + 1.2, ch.z, 'gel', 4);
        this.d.player.damagePlayer(ctx, st.poison.damagePerTick, 'poison');
      }
      if (c.poisonT === 0) ctx.bus.emit('player:status', { kind: 'poison', active: false });
    }
    if (c.shockT > 0) {
      c.shockT = Math.max(0, c.shockT - dt);
      if (c.shockT === 0) ctx.bus.emit('player:status', { kind: 'shock', active: false });
    }
    const el = this.d.elementsCfg;
    if (c.burnT > 0) {
      // El agua y la lluvia apagan las llamas.
      const douse = ch.swimming || ch.waterDepth > 0.4 ? 20 : 1 + this.d.rain() * 2;
      c.burnT = Math.max(0, c.burnT - dt * douse);
      c.burnTick -= dt;
      if (Math.random() < 0.5) this.d.fx.burst(ch.x, ch.y + 0.9, ch.z, 'spark', 1);
      if (c.burnTick <= 0 && c.burnT > 0 && p.control === 'free') {
        c.burnTick = el.burn.tickSeconds;
        this.d.player.damagePlayer(ctx, el.burn.damagePerTick, 'fire');
      }
      if (c.burnT === 0) ctx.bus.emit('player:status', { kind: 'burn', active: false });
    }
    if (c.bleedT > 0) {
      c.bleedT = Math.max(0, c.bleedT - dt);
      c.bleedTick -= dt;
      if (c.bleedTick <= 0 && p.control === 'free') {
        c.bleedTick = el.bleed.tickSeconds;
        this.d.fx.burst(ch.x, ch.y + 1, ch.z, 'break', 3);
        this.d.player.damagePlayer(ctx, el.bleed.damagePerTick, 'bleed');
      }
      if (c.bleedT === 0) ctx.bus.emit('player:status', { kind: 'bleed', active: false });
    }
    if (c.freezeT > 0) {
      // Forcejear (moverse) rompe el hielo antes.
      const struggle = ctx.input.axis('move_left', 'move_right') !== 0 || ctx.input.axis('move_back', 'move_forward') !== 0 ? 1.8 : 1;
      c.freezeT = Math.max(0, c.freezeT - dt * struggle * (1 + (this.elements?.warmthAt(ctx, ch.x, ch.z) ?? 0) / 10));
      if (c.freezeT === 0) {
        ctx.bus.emit('player:status', { kind: 'freeze', active: false });
        this.d.fx.burst(ch.x, ch.y + 1, ch.z, 'parry', 14);
      }
    }
    c.staffCd = Math.max(0, c.staffCd - dt);

    if (p.control !== 'free' || c.shockT > 0 || c.freezeT > 0) {
      // Electrocutado, congelado (o sin control): no puede atacar, apuntar ni moverse.
      if (c.shockT > 0 || c.freezeT > 0) {
        c.moveMultiplier = 0;
        c.melee = createMelee();
        if (c.shockT > 0 && Math.random() < 0.3) this.d.fx.burst(ch.x, ch.y + 1, ch.z, 'spark', 2);
      }
      c.aiming = false;
      c.defense.guarding = false;
      c.drawT = 0;
      c.wheelOpen = false;
      this.applyScales(ctx, c, ch.mode);
      return;
    }

    // --- rueda de armas (tiempo casi detenido)
    if (input.isDown('weapon_wheel')) {
      if (!c.wheelOpen) this.openWheel(c);
      if (input.wasPressed('move_left')) this.wheelIndex = (this.wheelIndex - 1 + this.wheelEntries.length) % this.wheelEntries.length;
      if (input.wasPressed('move_right')) this.wheelIndex = (this.wheelIndex + 1) % this.wheelEntries.length;
      c.moveMultiplier = 0;
      this.applyScales(ctx, c, ch.mode);
      return;
    }
    if (c.wheelOpen) this.closeWheel(ctx, c);

    const melee = this.meleeDef(c);
    const bow = this.bowDef(c);
    const shield = this.shieldDef(c);
    const free = ch.mode === 'ground' || ch.mode === 'air' || ch.mode === 'glide';
    const camYaw = this.d.camera.yaw + Math.PI; // orientación del modelo mirando hacia donde mira la cámara

    // --- apuntar con el arco / levantar el escudo
    const aimHeld = input.isDown('aim') && free;
    c.aiming = aimHeld && bow !== null;
    const guard = aimHeld && !c.aiming && shield !== null && ch.mode === 'ground' && c.melee.phase === 'idle';
    if (guard && !c.defense.guarding) c.defense.guardT = 0;
    else c.defense.guardT += dt;
    c.defense.guarding = guard;
    c.defense.dodgeT = ch.dodgeT;

    if (c.aiming && bow) {
      c.faceYaw = camYaw;
      if (ch.mode === 'ground') c.moveMultiplier = 0.45;
      // X cambia de flecha (normal, fuego, hielo, eléctrica) entre las que queden.
      if (input.wasPressed('cycle_arrow')) this.cycleArrow(ctx, c);
      if ((c.equipment.items[c.arrowType] ?? 0) <= 0) this.cycleArrow(ctx, c, true);
      const arrows = c.equipment.items[c.arrowType] ?? 0;
      if (input.isDown('attack') && arrows > 0) {
        const cost = ch.mode === 'glide' ? this.d.stamina.costs.bowChargeGliding : this.d.stamina.costs.bowCharge;
        // Tensar en el aire cuesta stamina (el tiempo bala no es gratis).
        if (ch.mode === 'ground' || spendRate(ch.stamina, cost, dt, 'bow', this.d.stamina)) c.drawT += dt;
        else c.drawT = 0;
      } else if (c.drawT > 0) {
        this.fireArrows(ctx, c, bow);
        c.drawT = 0;
      } else if (input.wasPressed('attack') && arrows <= 0) {
        ctx.bus.emit('combat:no_arrows', {});
      }
    } else {
      c.drawT = 0;
    }

    if (guard && shield) {
      c.faceYaw = c.lockTarget !== null ? this.yawTo(ctx, c.lockTarget) : camYaw;
      c.moveMultiplier = shield.moveMultiplier;
    }

    // --- ataque en picado (desde el aire o planeando)
    if (!c.aiming && !guard && input.wasPressed('attack') && (ch.mode === 'air' || ch.mode === 'glide') && !c.plunging) {
      const ground = this.d.enemies.groundAt(ch.x, ch.z, ch.y);
      if (ch.y - ground >= cfg.plunge.minHeight) {
        if (ch.mode === 'glide') foldGlider(ch);
        c.plunging = true;
        ch.mode = 'air';
      }
    }
    if (c.plunging) {
      ch.vx = 0;
      ch.vz = 0;
      ch.vy = -cfg.plunge.speed;
    } else if (!c.aiming && !guard && free && melee.staff) {
      // --- bastón elemental: dispara su elemento hacia la mira (también planeando)
      if (input.isDown('attack') && c.staffCd <= 0) {
        c.staffCd = melee.staff.cooldown;
        c.faceYaw = camYaw;
        this.fireStaff(ctx, c, melee);
      }
    } else if (!c.aiming && !guard && ch.mode !== 'glide' && free) {
      // --- cuerpo a cuerpo
      const wasIdle = c.melee.phase === 'idle';
      const r = stepMelee(
        c.melee,
        {
          pressed: input.wasPressed('attack'),
          held: input.isDown('attack'),
          airborne: ch.mode === 'air',
          flurry: c.flurryT > 0,
          staminaOk: ch.stamina.current >= melee.heavy.stamina && canUse(ch.stamina),
        },
        melee,
        cfg.attackMoveMultiplier,
        dt * time.playerScale,
      );
      if (r.started === 'heavy') spend(ch.stamina, melee.heavy.stamina, 'heavy', this.d.stamina);
      if (r.started && (wasIdle || r.started === 'heavy' || r.started === 'flurry')) this.attackYaw = this.chooseAttackYaw(ctx, c, ch.yaw);
      if (c.melee.phase !== 'idle') {
        c.faceYaw = this.attackYaw;
        c.moveMultiplier = r.moveMultiplier;
        c.lunge = r.lunge;
        this.window = r.window;
      }
      // Ráfaga: el jugador salta hacia el objetivo con cada golpe.
      if (r.started === 'flurry' && c.flurryTarget !== null) this.dashToward(ctx, c.flurryTarget, 1.2);
      // La antorcha encendida prende la hierba con cada golpe.
      if (r.window && r.window.swingId !== this.lastSwing && this.elements?.torchActive(ctx)) {
        this.lastSwing = r.window.swingId;
        const reach = melee.reach * 0.9;
        this.elements.igniteAt(ctx, ch.x + Math.sin(this.attackYaw) * reach, ch.y, ch.z + Math.cos(this.attackYaw) * reach, 0);
      }
    }

    // --- lanzar el arma equipada
    if (input.wasPressed('throw') && c.melee.phase === 'idle' && !c.aiming && (ch.mode === 'ground' || ch.mode === 'air')) this.throwWeapon(ctx, c);

    // --- fijado: mirar al objetivo
    if (c.lockTarget !== null && c.faceYaw === null && ch.mode === 'ground') c.faceYaw = this.yawTo(ctx, c.lockTarget);

    this.applyScales(ctx, c, ch.mode);
  }

  private applyScales(ctx: GameContext, c: CombatState, mode: string): void {
    const t = ctx.time;
    const bt = this.d.cfg.bulletTime;
    if (c.hitstopT > 0) {
      t.worldScale = 0;
      t.playerScale = 0;
    } else if (c.wheelOpen) {
      t.worldScale = WHEEL_SCALE;
      t.playerScale = WHEEL_SCALE;
    } else if (c.flurryT > 0) {
      t.worldScale = this.d.cfg.flurry.worldScale;
      t.playerScale = 1;
    } else if (c.aiming && (mode === 'air' || mode === 'glide')) {
      // Tiempo bala al apuntar en el aire (más suave planeando).
      const s = mode === 'glide' ? bt.glideScale : bt.airScale;
      t.worldScale = s;
      t.playerScale = s;
    }
  }

  // ------------------------------------------------------------------ POST

  private stepPost(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    const { world } = ctx;
    const cfg = this.d.cfg;
    const c = world.require(this.d.playerEntity, 'combat');
    const ch = world.require(this.d.playerEntity, 'character');
    const p = world.require(this.d.playerEntity, 'player');
    const wdt = dt * ctx.time.worldScale;
    // La esquiva puede haber empezado en este mismo paso (el movimiento corre entre pre y post).
    c.defense.dodgeT = ch.dodgeT;

    // Golpes cuerpo a cuerpo.
    const w = this.window;
    if (w) {
      if (w.swingId !== c.swingId) {
        c.swingId = w.swingId;
        c.swingHits = [];
      }
      const melee = this.meleeDef(c);
      let hitAny = false;
      for (const e of world.query('enemy')) {
        if (c.swingHits.includes(e)) continue;
        const en = world.require(e, 'enemy');
        if (en.deadT >= 0) continue;
        const b = en.brain;
        const def = this.d.enemies.def(en.defId);
        const dy = b.y - ch.y;
        if (dy < -1.6 || dy > 2.2) continue;
        const flurryHit = w.kind === 'flurry' && e === c.flurryTarget && Math.hypot(b.x - ch.x, b.z - ch.z) < FLURRY_DASH_RANGE;
        if (!flurryHit && !inArc(ch.x, ch.z, ch.yaw, b.x, b.z, def.radius, w.reach, w.arc)) continue;
        c.swingHits.push(e);
        hitAny = true;
        const weak = this.d.enemies.weakSpot(ctx, e, b.x, b.y, b.z, false);
        // Golpear un slime eléctrico cargado con metal (o a puño) electrocuta.
        if (this.d.enemies.isCharged(ctx, e) && (melee.tags.includes('metal') || melee.category === 'fists')) this.applyShock(ctx, c, 2, b.x, b.z);
        this.damageEnemy(ctx, c, e, def, melee, w.kind, w.multiplier, w.knockback, ch.x, ch.z, weak);
        // Armas con elemento (antorcha encendida = fuego).
        if (melee.element && (!melee.tags.includes('torch') || this.elements?.torchActive(ctx))) this.applyEnemyElement(ctx, e, melee.element);
      }
      if (hitAny) {
        if (w.kind === 'shockwave') this.d.fx.ring(ch.x, ch.y, ch.z, w.reach, '#e8dcc6');
        this.wearMelee(ctx, c, ch);
        c.hitstopT = Math.max(c.hitstopT, w.kind === 'heavy' || w.kind === 'shockwave' ? cfg.hitstop.heavy : cfg.hitstop.light);
        this.d.camera.addShake(w.kind === 'heavy' || w.kind === 'shockwave' ? 0.3 : 0.12);
      }
      if (w.kind === 'shockwave' && c.melee.subHits === 1 && !hitAny) this.d.fx.ring(ch.x, ch.y, ch.z, w.reach, '#e8dcc6');
    }

    // Aterrizaje del ataque en picado: onda de daño alrededor.
    if (c.plunging && (ch.grounded || ch.swimming || ch.mode === 'climb' || ch.mode === 'ledge')) {
      c.plunging = false;
      const melee = this.meleeDef(c);
      let hits = 0;
      for (const e of world.query('enemy')) {
        const en = world.require(e, 'enemy');
        if (en.deadT >= 0) continue;
        if (Math.hypot(en.brain.x - ch.x, en.brain.z - ch.z) > cfg.plunge.radius || Math.abs(en.brain.y - ch.y) > 2) continue;
        this.damageEnemy(ctx, c, e, this.d.enemies.def(en.defId), melee, 'plunge', 1, 8, ch.x, ch.z, false);
        hits++;
      }
      if (hits > 0) this.wearMelee(ctx, c, ch);
      this.d.fx.ring(ch.x, ch.y, ch.z, cfg.plunge.radius * 1.5, '#ffffff');
      this.d.fx.burst(ch.x, ch.y + 0.1, ch.z, 'stone', 16);
      this.d.camera.addShake(0.6);
      c.hitstopT = cfg.hitstop.heavy;
    }

    // Pisotón: caer sobre un slime lo daña y rebota.
    if (!c.plunging && ch.mode === 'air' && ch.vy < -2) {
      for (const e of world.query('enemy')) {
        const en = world.require(e, 'enemy');
        const def = this.d.enemies.def(en.defId);
        if (en.deadT >= 0 || !def.stompable) continue;
        const b = en.brain;
        const top = b.y + def.height;
        if (Math.hypot(b.x - ch.x, b.z - ch.z) < def.radius + 0.25 && ch.y > top - 0.5 && ch.y < top + 0.35) {
          const killed = this.d.enemies.hit(ctx, e, cfg.stomp.damage, { fromX: ch.x, fromZ: ch.z, knockback: 2, stagger: true, stun: 0.4 });
          ctx.bus.emit('combat:hit', { x: b.x, y: top, z: b.z, damage: cfg.stomp.damage, kind: 'stomp', sneak: false, weak: false, tags: def.tags });
          this.d.fx.burst(b.x, top, b.z, 'gel', 10);
          ch.vy = cfg.stomp.bounce;
          ch.fallStartY = ch.y;
          c.hitstopT = cfg.hitstop.light;
          if (killed) this.onKilled(ctx, e, def);
          if (this.d.enemies.isCharged(ctx, e)) this.applyShock(ctx, c, 2, b.x, b.z);
          break;
        }
      }
    }

    // Ataques enemigos sobre el jugador.
    const shield = this.shieldDef(c);
    const body = { x: ch.x, y: ch.y, z: ch.z, groundY: this.groundBelow(ch.x, ch.y, ch.z), radius: this.d.player.bodyRadius, height: 1.7 };
    for (const e of world.query('enemy')) {
      const en = world.require(e, 'enemy');
      if (en.deadT >= 0) continue;
      const b = en.brain;
      const def = this.d.enemies.def(en.defId);
      const a = b.attack;
      if (a && a.phase === 'active' && !a.hit && p.control === 'free') {
        // Las descargas eléctricas llegan más lejos por el agua.
        const water = a.def.element === 'shock' && ch.swimming && this.d.enemies.inWater(b) ? cfg.status.shock.waterMultiplier : 1;
        const reaches = attackReaches(b, def, body, 0, water);
        // Esquiva perfecta: basta con esquivar justo cuando el ataque iba a alcanzarte.
        const perfect = !reaches && c.defense.dodgeT <= cfg.dodge.perfectWindow && attackReaches(b, def, body, cfg.dodge.perfectReach, water);
        if (reaches || perfect) {
          a.hit = true;
          this.resolveEnemyAttack(ctx, c, e, def, a.def, shield);
          continue;
        }
      }
      if (b.kind === 'hawk') continue;
      const dx = ch.x - b.x;
      const dz = ch.z - b.z;
      const dist = Math.hypot(dx, dz);
      const reach = def.radius + this.d.player.bodyRadius;
      const vertical = ch.y < b.y + def.height && ch.y + 1.6 > b.y;
      if (dist < reach && vertical && dist > 1e-3 && ch.mode !== 'climb' && ch.mode !== 'ledge') {
        // Separación: el jugador no atraviesa a los enemigos.
        const push = reach - dist;
        ch.x += (dx / dist) * push;
        ch.z += (dz / dist) * push;
      }
    }

    // Proyectiles.
    this.d.projectiles.update(this.projectileWorld(ctx), wdt, (pr, ev) => {
      if (ev.type === 'target') this.onProjectileHit(ctx, c, pr, ev.id, ev.x, ev.y, ev.z);
      else if (ev.type === 'scene' && pr.kind === 'thrown') this.dropThrown(ctx, pr, ev.x, ev.y, ev.z);
      else if (ev.type === 'scene' && pr.kind === 'missile') this.missileImpact(ctx, c, pr, ev.x, ev.y, ev.z);
      else if (ev.type === 'scene') {
        this.d.fx.burst(ev.x, ev.y, ev.z, 'stone', 4);
        // Flecha elemental: fuego prende la hierba, hielo congela el agua, electricidad se propaga por ella.
        if (pr.element && pr.owner === 'player') this.elements?.applyAt(ctx, pr.element, ev.x, ev.y, ev.z, pr.element === 'fire' ? 1 : 0);
      }
    });

    // El objetivo fijado sigue siendo válido.
    if (c.lockTarget !== null) {
      const en = world.get(c.lockTarget, 'enemy');
      const t = world.get(c.lockTarget, 'transform');
      if (!en || en.deadT >= 0 || !t || Math.hypot(t.x - ch.x, t.z - ch.z) > cfg.lockOnRange * 1.4) c.lockTarget = null;
    }
  }

  // ------------------------------------------------------------------ resolución

  private resolveEnemyAttack(ctx: GameContext, c: CombatState, e: Entity, def: EnemyDef, attack: AttackDef, shield: ShieldDef | null): void {
    const cfg = this.d.cfg;
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const b = ctx.world.require(e, 'enemy').brain;
    let result = resolveIncoming(c.defense, b, { x: ch.x, z: ch.z, yaw: ch.yaw }, isBlockable(attack.kind) ? shield : null, cfg);
    // Un escudo de metal no para la electricidad.
    if (result === 'blocked' && attack.element === 'shock' && shield?.tags.includes('metal')) result = 'hit';
    const at = { x: (b.x + ch.x) / 2, y: ch.y + 1, z: (b.z + ch.z) / 2 };
    if (result === 'hit') {
      this.hurtPlayer(ctx, c, attack.damage, attack.element, attack.knockback, b.x, b.z, attack.kind === 'dive');
      this.d.fx.burst(at.x, at.y, at.z, def.tags.includes('gel') ? 'gel' : def.tags.includes('rock') ? 'stone' : 'spark', 8);
      return;
    }
    ctx.bus.emit('combat:defended', { result, ...at });
    if (result === 'perfect') {
      // Esquiva perfecta: cámara lenta y contraataque en ráfaga.
      c.flurryT = cfg.flurry.seconds;
      c.flurryTarget = e;
      ctx.bus.emit('combat:flurry', { active: true });
      ctx.bus.emit('player:dodge', { perfect: true });
      this.d.fx.burst(ch.x, ch.y + 1, ch.z, 'flurry', 14);
    } else if (result === 'blocked') {
      const sh = equipped(c.equipment, 'shield');
      // Los golpes muy fuertes rompen la guardia: algo de daño y más desgaste.
      const heavy = attack.knockback >= 10;
      if (sh) this.reportWear(ctx, sh.uid, wear(c.equipment, this.d.catalog, sh.uid, heavy ? 3 : 1, cfg.durabilityWarning), ch);
      if (heavy) this.hurtPlayer(ctx, c, Math.ceil(attack.damage * 0.25), 'physical', attack.knockback * 0.6, b.x, b.z, false);
      else if (b.attack) {
        b.attack.phase = 'recovery';
        b.attack.t = 0;
        b.vx = -b.vx * 0.5;
        b.vz = -b.vz * 0.5;
      }
      this.d.fx.burst(at.x, at.y, at.z, 'spark', 8);
      this.d.camera.addShake(heavy ? 0.4 : 0.15);
    } else if (result === 'parried') {
      // Parry: el atacante queda aturdido (los grandes apenas se tambalean) y sale despedido.
      this.d.enemies.hit(ctx, e, 0, { fromX: ch.x, fromZ: ch.z, knockback: 7, stagger: true, stun: def.stunTime * (1 - def.knockbackResist) * 1.5 });
      this.d.fx.burst(at.x, at.y, at.z, 'parry', 16);
      this.d.fx.ring(at.x, ch.y, at.z, 2, '#9ff3ff');
      c.hitstopT = cfg.hitstop.heavy;
    }
  }

  /** Daño al jugador con su elemento: empujón, veneno, descarga y plegado del planeador. */
  private hurtPlayer(ctx: GameContext, c: CombatState, damage: number, element: Element, knockback: number, fromX: number, fromZ: number, foldGliderOnHit: boolean): void {
    const cfg = this.d.cfg;
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const dir = Math.atan2(ch.x - fromX, ch.z - fromZ);
    const k = Math.min(14, knockback);
    if (ch.mode === 'glide') {
      if (foldGliderOnHit || k >= 6) foldGlider(ch);
    }
    if (ch.mode !== 'climb' && ch.mode !== 'ledge') {
      ch.vx = Math.sin(dir) * k;
      ch.vz = Math.cos(dir) * k;
      ch.vy = Math.max(ch.vy, 2 + k * 0.25);
      ch.grounded = false;
      if (ch.mode !== 'glide') ch.mode = 'air';
    }
    c.hitstopT = Math.max(c.hitstopT, cfg.hitstop.light);
    c.aiming = false;
    c.drawT = 0;
    const st = this.d.stats();
    if (element === 'poison' && st.poisonResist < 1) {
      if (c.poisonT <= 0) ctx.bus.emit('player:status', { kind: 'poison', active: true });
      c.poisonT = cfg.status.poison.seconds * (1 - st.poisonResist);
      c.poisonTick = cfg.status.poison.tickSeconds;
    }
    if (element === 'shock') {
      if (st.shockResist >= 1) damage = 0;
      else {
        damage = Math.round(damage * (1 - st.shockResist));
        this.applyShock(ctx, c, 0, fromX, fromZ);
      }
    }
    if (element === 'fire' || element === 'ice' || element === 'bleed') this.applyStatus(ctx, element === 'fire' ? 'burn' : element === 'ice' ? 'freeze' : 'bleed');
    const cause = element === 'poison' ? 'poison' : element === 'shock' ? 'shock' : element === 'fire' ? 'fire' : element === 'bleed' ? 'bleed' : 'enemy';
    if (damage > 0) this.d.player.damagePlayer(ctx, damage, cause);
  }

  /** Daño del entorno (rayo, descarga en el agua) con su elemento. */
  hurtFromWorld(ctx: GameContext, damage: number, element: Element, fromX: number, fromZ: number, knockback: number): void {
    const c = ctx.world.require(this.d.playerEntity, 'combat');
    if (ctx.world.require(this.d.playerEntity, 'player').control !== 'free') return;
    this.hurtPlayer(ctx, c, damage, element, knockback, fromX, fromZ, knockback >= 6);
  }

  /** Estados por elemento: ardiendo, congelado o sangrando. */
  applyStatus(ctx: GameContext, kind: 'burn' | 'freeze' | 'bleed'): void {
    const c = ctx.world.require(this.d.playerEntity, 'combat');
    const el = this.d.elementsCfg;
    if (kind === 'burn') {
      if (c.burnT <= 0) {
        ctx.bus.emit('player:status', { kind: 'burn', active: true });
        c.burnTick = 0.2;
      }
      c.burnT = el.burn.seconds;
      c.freezeT = 0;
    } else if (kind === 'freeze') {
      if (c.burnT > 0) {
        // El hielo apaga las llamas en lugar de congelar.
        c.burnT = 0;
        return;
      }
      if (c.freezeT <= 0) ctx.bus.emit('player:status', { kind: 'freeze', active: true });
      c.freezeT = el.freeze.seconds * (1 - Math.min(0.9, this.d.stats().stunResist));
      c.aiming = false;
      c.drawT = 0;
    } else {
      if (c.bleedT <= 0) {
        ctx.bus.emit('player:status', { kind: 'bleed', active: true });
        c.bleedTick = el.bleed.tickSeconds;
      }
      c.bleedT = el.bleed.seconds;
    }
  }

  /** Descarga eléctrica: queda paralizado un instante y suelta el arma. */
  private applyShock(ctx: GameContext, c: CombatState, damage: number, fromX: number, fromZ: number): void {
    const cfg = this.d.cfg.status.shock;
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const st = this.d.stats();
    // El equipo aislante anula las descargas; la armadura pesada acorta el aturdimiento.
    if (st.shockResist >= 1) return;
    if (c.shockT <= 0) ctx.bus.emit('player:status', { kind: 'shock', active: true });
    c.shockT = cfg.seconds * (1 - Math.min(0.9, st.stunResist + st.shockResist * 0.5));
    c.drawT = 0;
    c.aiming = false;
    this.d.fx.burst(ch.x, ch.y + 1, ch.z, 'spark', 16);
    if (cfg.dropsWeapon) {
      const inst = equipped(c.equipment, 'melee');
      if (inst) {
        removeGear(c.equipment, inst.uid);
        const a = Math.atan2(ch.x - fromX, ch.z - fromZ);
        this.d.pickups.drop(ctx, inst.id, 1, ch.x + Math.sin(a) * 1.2, ch.y + 0.5, ch.z + Math.cos(a) * 1.2, inst.durability);
        ctx.bus.emit('combat:equipped', { slot: 'melee', name: 'Puños' });
      }
    }
    if (damage > 0) this.d.player.damagePlayer(ctx, damage, 'shock');
  }

  /** Roca o gelatina enemiga que estalla contra el suelo (con área si es grande). */
  private missileImpact(ctx: GameContext, c: CombatState, pr: Projectile, x: number, y: number, z: number): void {
    // Proyectil del bastón (o devuelto): aplica su elemento en el área.
    if (pr.owner === 'player') {
      if (pr.element) this.elements?.applyAt(ctx, pr.element, x, y, z, pr.splash ?? 1);
      else this.d.fx.burst(x, y + 0.1, z, 'stone', 6);
      return;
    }
    this.d.fx.burst(x, y + 0.1, z, pr.look === 'goo' ? 'gel' : 'stone', pr.splash ? 16 : 6);
    if (pr.splash) {
      this.d.fx.ring(x, y, z, pr.splash, '#e8dcc6');
      const ch = ctx.world.require(this.d.playerEntity, 'character');
      const d = Math.hypot(ch.x - x, ch.z - z);
      if (d < pr.splash + this.d.player.bodyRadius && Math.abs(ch.y - y) < 2.5 && ctx.world.require(this.d.playerEntity, 'player').control === 'free' && c.defense.dodgeT > this.d.cfg.dodge.iframes) {
        this.hurtPlayer(ctx, c, Math.round(pr.damage), pr.element ?? 'physical', pr.knockback ?? 6, x, z, true);
      }
      if (d < 25) this.d.camera.addShake(0.35 * (1 - d / 25));
    }
  }

  private groundBelow(x: number, y: number, z: number): number {
    return Math.max(this.d.terrain.height(x, z), this.d.colliders.topAt(x, z, 0.3, y + 0.1));
  }

  private damageEnemy(ctx: GameContext, c: CombatState, e: Entity, def: EnemyDef, weapon: WeaponDef, kind: AttackKind, multiplier: number, knockback: number, fromX: number, fromZ: number, weak: boolean): void {
    const en = ctx.world.require(e, 'enemy');
    const b = en.brain;
    const inst = equipped(c.equipment, 'melee');
    const breaking = kind !== 'arrow' && kind !== 'thrown' && inst !== null && inst.durability <= 1 && weapon.durability > 0;
    const sneak = !b.aware;
    // La comida de fuerza sube el daño de cualquier ataque.
    const dmg = computeDamage(weapon, { kind, multiplier, sneak, weakPoint: weak, weakPointBonus: def.weakPointBonus, breaking, targetTags: def.tags }, this.d.cfg) * (1 + this.d.stats().attack);
    const heavy = kind === 'heavy' || kind === 'plunge' || kind === 'shockwave';
    const killed = this.d.enemies.hit(ctx, e, dmg, { fromX, fromZ, knockback: knockback * (sneak ? 1.5 : 1), stagger: heavy || weak, stun: 0.15 });
    const y = b.y + def.height * 0.6;
    ctx.bus.emit('combat:hit', { x: b.x, y, z: b.z, damage: dmg, kind, sneak, weak, tags: def.tags });
    this.d.fx.burst(b.x, y, b.z, this.fxKind(def), sneak || breaking || weak ? 18 : 10);
    if (weak && def.golem) this.d.fx.burst(b.x, y, b.z, 'parry', 10);
    if (killed) this.onKilled(ctx, e, def);
  }

  private fxKind(def: EnemyDef): 'gel' | 'stone' | 'spark' {
    return def.tags.includes('gel') ? 'gel' : def.tags.includes('rock') ? 'stone' : 'spark';
  }

  /** Muerte por el entorno (fuego, rayo): mismo botín y eventos que en combate. */
  killFromWorld(ctx: GameContext, e: Entity): void {
    const en = ctx.world.get(e, 'enemy');
    if (en) this.onKilled(ctx, e, this.d.enemies.def(en.defId));
  }

  private onKilled(ctx: GameContext, e: Entity, def: EnemyDef): void {
    const b = ctx.world.require(e, 'enemy').brain;
    ctx.bus.emit('enemy:defeated', { entity: e, enemy: def.id, family: def.family, x: b.x, y: b.y, z: b.z });
    this.d.fx.burst(b.x, b.y + def.height * 0.5, b.z, this.fxKind(def), 24);
    this.d.enemies.onKilled(ctx, e);
    const gy = this.groundBelow(b.x, b.y + 0.5, b.z);
    this.d.pickups.dropLoot(ctx, def.loot, b.x, Math.max(gy, b.kind === 'hawk' ? gy : b.y), b.z);
    // Los goblins sueltan su arma (gastada).
    const g = def.goblin;
    if (g?.drop && Math.random() < g.dropChance) {
      const max = this.d.catalog.maxDurability(g.drop);
      this.d.pickups.drop(ctx, g.drop, 1, b.x + 0.5, b.y + 0.4, b.z, Math.max(1, Math.round(max * (0.35 + Math.random() * 0.4))));
    }
    const c = ctx.world.require(this.d.playerEntity, 'combat');
    if (c.flurryTarget === e) c.flurryTarget = null;
    if (c.lockTarget === e) c.lockTarget = null;
  }

  private wearMelee(ctx: GameContext, c: CombatState, ch: { x: number; y: number; z: number }): void {
    const inst = equipped(c.equipment, 'melee');
    if (!inst) return;
    this.reportWear(ctx, inst.uid, wear(c.equipment, this.d.catalog, inst.uid, 1, this.d.cfg.durabilityWarning), ch, inst.id);
  }

  private reportWear(ctx: GameContext, uid: number, r: 'ok' | 'warning' | 'broken', at: { x: number; y: number; z: number }, id?: string): void {
    const c = ctx.world.require(this.d.playerEntity, 'combat');
    const name = this.d.catalog.name(id ?? findGear(c.equipment, uid)?.inst.id ?? '');
    if (r === 'warning') ctx.bus.emit('combat:weapon_warning', { name });
    if (r === 'broken') {
      ctx.bus.emit('combat:weapon_broken', { name, x: at.x, y: at.y + 1.2, z: at.z });
      this.d.fx.burst(at.x, at.y + 1.2, at.z, 'break', 26);
      this.d.fx.ring(at.x, at.y, at.z, 3, '#ffffff');
      c.hitstopT = Math.max(c.hitstopT, this.d.cfg.hitstop.break);
      this.d.camera.addShake(0.4);
    }
  }

  // ------------------------------------------------------------------ arco y lanzamientos

  /** Siguiente tipo de flecha con munición (o la normal si `fallback`). */
  private cycleArrow(ctx: GameContext, c: CombatState, fallback = false): void {
    const types = ['arrow', 'fire_arrow', 'ice_arrow', 'shock_arrow'].filter((id) => (c.equipment.items[id] ?? 0) > 0);
    if (types.length === 0) return;
    const i = types.indexOf(c.arrowType);
    const next = fallback && i < 0 ? types[0] : types[(i + 1) % types.length];
    if (next === c.arrowType) return;
    c.arrowType = next;
    ctx.bus.emit('combat:arrow_type', { name: this.d.catalog.name(next), count: c.equipment.items[next] ?? 0 });
  }

  /** Bastón elemental: proyectil de su elemento hacia el centro de la mira. */
  private fireStaff(ctx: GameContext, c: CombatState, staff: WeaponDef): void {
    const sd = staff.staff;
    if (!sd) return;
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const cam = this.d.threeCamera;
    const dir = cam.getWorldDirection(this.tmpDir);
    const max = 80;
    const aimDist = Math.min(this.sceneRaycast(cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, max), max, this.enemyRaycast(ctx, cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, max));
    const tx = cam.position.x + dir.x * aimDist;
    const ty = cam.position.y + dir.y * aimDist;
    const tz = cam.position.z + dir.z * aimDist;
    const yaw = this.d.camera.yaw + Math.PI;
    const sx = ch.x + Math.sin(yaw) * 0.7;
    const sy = ch.y + 1.5;
    const sz = ch.z + Math.cos(yaw) * 0.7;
    const l = Math.hypot(tx - sx, ty - sy, tz - sz) || 1;
    this.d.projectiles.spawn({
      kind: 'missile',
      owner: 'player',
      x: sx,
      y: sy,
      z: sz,
      vx: ((tx - sx) / l) * sd.speed,
      vy: ((ty - sy) / l) * sd.speed,
      vz: ((tz - sz) / l) * sd.speed,
      gravity: 0,
      damage: sd.damage,
      maxAge: 3,
      element: sd.element,
      look: sd.element === 'fire' ? 'fireball' : sd.element === 'ice' ? 'iceshard' : 'spark',
      size: 0.28,
      knockback: 3,
      splash: sd.radius,
      weaponId: staff.id,
    });
    this.d.fx.burst(sx, sy, sz, sd.element === 'ice' ? 'parry' : 'spark', 6);
    const inst = equipped(c.equipment, 'melee');
    if (inst) this.reportWear(ctx, inst.uid, wear(c.equipment, this.d.catalog, inst.uid, 1, this.d.cfg.durabilityWarning), ch, inst.id);
  }

  private fireArrows(ctx: GameContext, c: CombatState, bow: WeaponDef): void {
    const ammo = c.arrowType;
    if (!takeItem(c.equipment, ammo, 1)) return;
    const element = this.d.catalog.item(ammo)?.element;
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const cam = this.d.threeCamera;
    const dir = cam.getWorldDirection(this.tmpDir);
    // Punto de mira: lo primero que hay en el centro de la pantalla.
    const max = 150;
    const scene = this.sceneRaycast(cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, max);
    const aimDist = Math.min(scene, max, this.enemyRaycast(ctx, cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, max));
    const tx = cam.position.x + dir.x * aimDist;
    const ty = cam.position.y + dir.y * aimDist;
    const tz = cam.position.z + dir.z * aimDist;
    const sx = ch.x + Math.sin(ch.yaw) * 0.5;
    const sy = ch.y + 1.45;
    const sz = ch.z + Math.cos(ch.yaw) * 0.5;
    const l = Math.hypot(tx - sx, ty - sy, tz - sz) || 1;
    const aim = compensateDrop({ dx: (tx - sx) / l, dy: (ty - sy) / l, dz: (tz - sz) / l }, l, arrowSpeed(bow, c.drawT), ARROW_GRAVITY, ARROW_ASSIST_RANGE);
    for (const shot of arrowsForShot(bow, c.drawT, aim)) {
      this.d.projectiles.spawn({
        kind: 'arrow',
        owner: 'player',
        x: sx,
        y: sy,
        z: sz,
        vx: shot.dx * shot.speed,
        vy: shot.dy * shot.speed,
        vz: shot.dz * shot.speed,
        gravity: ARROW_GRAVITY,
        damage: bow.damage * (0.4 + 0.6 * drawFraction(bow, c.drawT)) * (1 + this.d.stats().bowDamage),
        maxAge: 8,
        element,
      });
    }
    const inst = equipped(c.equipment, 'bow');
    if (inst) this.reportWear(ctx, inst.uid, wear(c.equipment, this.d.catalog, inst.uid, 1, this.d.cfg.durabilityWarning), ch, inst.id);
  }

  private throwWeapon(ctx: GameContext, c: CombatState): void {
    const inst = equipped(c.equipment, 'melee');
    if (!inst) return;
    const def = this.d.catalog.weapon(inst.id);
    if (!def.throwable) return;
    removeGear(c.equipment, inst.uid);
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const speed = 22;
    const gravity = 14;
    const sx0 = ch.x;
    const sy = ch.y + 1.4;
    const sz0 = ch.z;
    // Apunta al objetivo fijado o al enemigo más cercano delante (trayectoria parabólica hasta su centro).
    let yaw = this.chooseAttackYaw(ctx, c, ch.yaw);
    const target = c.lockTarget ?? this.throwTarget(ctx, ch.x, ch.z, yaw);
    let vy = 3;
    const tt = target !== null ? ctx.world.get(target, 'enemy') : undefined;
    if (target !== null && tt) {
      const tb = tt.brain;
      const tdef = this.d.enemies.def(tt.defId);
      yaw = Math.atan2(tb.x - sx0, tb.z - sz0);
      const flight = Math.max(0.05, Math.hypot(tb.x - sx0, tb.z - sz0) / speed);
      vy = (tb.y + tdef.height * 0.5 - sy + 0.5 * gravity * flight * flight) / flight;
    }
    ch.yaw = yaw;
    this.d.projectiles.spawn(
      {
        kind: 'thrown',
        owner: 'player',
        x: sx0 + Math.sin(yaw) * 0.6,
        y: sy,
        z: sz0 + Math.cos(yaw) * 0.6,
        vx: Math.sin(yaw) * speed,
        vy,
        vz: Math.cos(yaw) * speed,
        gravity,
        damage: def.damage,
        weaponId: def.id,
        weaponUid: inst.uid,
        weaponDurability: inst.durability,
        maxAge: 4,
      },
      def.model,
    );
    ctx.bus.emit('combat:equipped', { slot: 'melee', name: 'Puños' });
  }

  private onProjectileHit(ctx: GameContext, c: CombatState, pr: Projectile, id: number, x: number, y: number, z: number): void {
    if (id === this.d.playerEntity) {
      // Proyectil enemigo contra el jugador: escudo (parry o espejo) lo devuelve.
      const ch = ctx.world.require(this.d.playerEntity, 'character');
      const shield = this.shieldDef(c);
      const from = { x: pr.x - pr.vx, z: pr.z - pr.vz };
      const result = resolveIncoming(c.defense, from, { x: ch.x, z: ch.z, yaw: ch.yaw }, shield, this.d.cfg);
      if (result === 'parried' || (result === 'blocked' && shield?.reflectsWhileGuarding)) {
        pr.alive = true;
        const src = pr.source !== undefined ? ctx.world.get(pr.source, 'transform') : undefined;
        reflectProjectile(pr, src ? { x: src.x, y: src.y + 1, z: src.z } : { x: from.x, y: pr.y, z: from.z });
        this.d.fx.burst(x, y, z, 'parry', 10);
        return;
      }
      if (result === 'blocked') {
        const sh = equipped(c.equipment, 'shield');
        if (sh) this.reportWear(ctx, sh.uid, wear(c.equipment, this.d.catalog, sh.uid, 1, this.d.cfg.durabilityWarning), ch);
        this.d.fx.burst(x, y, z, 'spark', 6);
        return;
      }
      if (result === 'hit') {
        this.hurtPlayer(ctx, c, Math.round(pr.damage), pr.element ?? 'physical', pr.knockback ?? 3, from.x, from.z, true);
        this.d.fx.burst(x, y, z, pr.look === 'goo' ? 'gel' : 'spark', 6);
      }
      return;
    }
    const en = ctx.world.get(id, 'enemy');
    if (!en || en.deadT >= 0) return;
    const def = this.d.enemies.def(en.defId);
    if (pr.kind === 'missile' && pr.weaponId) {
      // Bastón elemental: daño directo + su elemento en el área.
      const staff = this.d.catalog.weapon(pr.weaponId);
      this.damageEnemy(ctx, c, id, def, staff, 'arrow', pr.damage / Math.max(1, staff.damage), 3, pr.x - pr.vx * 0.05, pr.z - pr.vz * 0.05, false);
      if (pr.element) {
        this.applyEnemyElement(ctx, id, pr.element);
        this.elements?.applyAt(ctx, pr.element, x, y, z, pr.splash ?? 1);
      }
    } else if (pr.kind === 'arrow' || pr.kind === 'missile') {
      // Punto débil: núcleo del slime, cabeza del goblin, cristal del golem.
      const weak = this.d.enemies.weakSpot(ctx, id, x, y, z, true);
      const bow = this.bowDef(c) ?? this.d.catalog.weapon('short_bow');
      const k = pr.damage / bow.damage;
      this.damageEnemy(ctx, c, id, def, bow, 'arrow', k, 2, pr.x - pr.vx * 0.05, pr.z - pr.vz * 0.05, weak);
      if (pr.element) this.applyEnemyElement(ctx, id, pr.element);
    } else if (pr.weaponId) {
      const w = this.d.catalog.weapon(pr.weaponId);
      this.damageEnemy(ctx, c, id, def, w, 'thrown', 1, 5, pr.x - pr.vx * 0.05, pr.z - pr.vz * 0.05, this.d.enemies.weakSpot(ctx, id, x, y, z, true));
      this.dropThrown(ctx, pr, x, y, z);
    }
  }

  /** Elemento sobre un enemigo (si sigue vivo); suelta su arma si se electrocuta. */
  private applyEnemyElement(ctx: GameContext, e: Entity, element: Element): void {
    const en = ctx.world.get(e, 'enemy');
    if (!en || en.deadT >= 0) return;
    const r = this.d.enemies.elementHit(ctx, e, element);
    if (r.dropWeapon) this.dropWeapon(ctx, r.dropWeapon, en.brain.x, en.brain.y + 1, en.brain.z);
  }

  /** Deja caer un arma enemiga desgastada en el suelo. */
  dropWeapon(ctx: GameContext, id: string, x: number, y: number, z: number): void {
    const max = this.d.catalog.maxDurability(id);
    this.d.pickups.drop(ctx, id, 1, x + 0.6, y, z, Math.max(1, Math.round(max * (0.35 + Math.random() * 0.4))));
  }

  private dropThrown(ctx: GameContext, pr: Projectile, x: number, y: number, z: number): void {
    if (!pr.weaponId) return;
    const left = (pr.weaponDurability ?? 1) - 2;
    if (left <= 0) {
      ctx.bus.emit('combat:weapon_broken', { name: this.d.catalog.name(pr.weaponId), x, y, z });
      this.d.fx.burst(x, y, z, 'break', 20);
      return;
    }
    this.d.pickups.drop(ctx, pr.weaponId, 1, x, y, z, left);
  }

  private projectileWorld(ctx: GameContext) {
    return {
      raycastScene: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => Math.min(this.sceneRaycast(ox, oy, oz, dx, dy, dz, max), this.waterRaycast(ox, oy, oz, dx, dy, dz, max)),
      hitTarget: (p: Projectile, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
        let best: { id: number; tHit: number } | null = null;
        if (p.owner === 'player') {
          for (const e of ctx.world.query('enemy')) {
            const en = ctx.world.require(e, 'enemy');
            if (en.deadT >= 0) continue;
            const def = this.d.enemies.def(en.defId);
            const t = segmentSphere(ax, ay, az, bx, by, bz, en.brain.x, en.brain.y + def.height * 0.5, en.brain.z, Math.max(def.radius, def.height * 0.5) + 0.05);
            if (t !== null && (!best || t < best.tHit)) best = { id: e, tHit: t };
          }
        } else {
          const ch = ctx.world.require(this.d.playerEntity, 'character');
          const t = segmentSphere(ax, ay, az, bx, by, bz, ch.x, ch.y + 0.9, ch.z, 0.6 + (p.size ?? 0) * 0.6);
          if (t !== null) best = { id: this.d.playerEntity, tHit: t };
        }
        return best;
      },
    };
  }

  /** Distancia al primer enemigo vivo a lo largo del rayo (para que la mira «enganche» al blanco). */
  private enemyRaycast(ctx: GameContext, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    let best = Infinity;
    for (const e of ctx.world.query('enemy')) {
      const en = ctx.world.require(e, 'enemy');
      if (en.deadT >= 0) continue;
      const def = this.d.enemies.def(en.defId);
      const r = Math.max(def.radius, def.height * 0.5);
      const t = segmentSphere(ox, oy, oz, ox + dx * max, oy + dy * max, oz + dz * max, en.brain.x, en.brain.y + def.height * 0.5, en.brain.z, r);
      if (t !== null) best = Math.min(best, t * max);
    }
    return best;
  }

  /** Distancia a la superficie del agua a lo largo del segmento (las flechas se detienen en ella). */
  private waterRaycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    if (dy >= 0) return Infinity;
    const ex = ox + dx * max;
    const ez = oz + dz * max;
    const w = this.d.terrain.waterLevelAt(ex, ez) ?? this.d.terrain.waterLevelAt(ox, oz);
    if (w === null || oy < w) return Infinity;
    const t = (w - oy) / dy;
    if (t < 0 || t > max) return Infinity;
    const hx = ox + dx * t;
    const hz = oz + dz * t;
    return this.d.terrain.height(hx, hz) < w - 0.2 ? t : Infinity;
  }

  private sceneRaycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    const terrain = raymarchTerrain({ terrainHeight: (x, z) => this.d.terrain.height(x, z), raycastColliders: () => Infinity }, ox, oy, oz, dx, dy, dz, max);
    return Math.min(terrain, this.d.colliders.raycast(ox, oy, oz, dx, dy, dz, max));
  }

  // ------------------------------------------------------------------ apoyo

  private chooseAttackYaw(ctx: GameContext, c: CombatState, current: number): number {
    if (c.lockTarget !== null) return this.yawTo(ctx, c.lockTarget);
    const ix = ctx.input.axis('move_left', 'move_right');
    const iz = ctx.input.axis('move_back', 'move_forward');
    if (ix === 0 && iz === 0) {
      // Sin dirección: el enemigo más cercano delante (asistencia suave), si no, al frente.
      const ch = ctx.world.require(this.d.playerEntity, 'character');
      let best: Entity | null = null;
      let bestD = 4;
      for (const e of ctx.world.query('enemy')) {
        const b = ctx.world.require(e, 'enemy').brain;
        const d = Math.hypot(b.x - ch.x, b.z - ch.z);
        const ang = Math.abs(wrapAngle(Math.atan2(b.x - ch.x, b.z - ch.z) - current));
        if (d < bestD && ang < 1.2 && ctx.world.require(e, 'enemy').deadT < 0) {
          bestD = d;
          best = e;
        }
      }
      return best !== null ? this.yawTo(ctx, best) : current;
    }
    const f = this.d.camera.forward();
    const r = this.d.camera.right();
    return Math.atan2(r.x * ix + f.x * iz, r.z * ix + f.z * iz);
  }

  /** Enemigo vivo más cercano dentro de un cono estrecho delante (para lanzar armas). */
  private throwTarget(ctx: GameContext, x: number, z: number, yaw: number): Entity | null {
    let best: Entity | null = null;
    let bestD = THROW_RANGE;
    for (const e of ctx.world.query('enemy')) {
      const en = ctx.world.require(e, 'enemy');
      if (en.deadT >= 0) continue;
      const d = Math.hypot(en.brain.x - x, en.brain.z - z);
      const ang = Math.abs(wrapAngle(Math.atan2(en.brain.x - x, en.brain.z - z) - yaw));
      if (d < bestD && ang < 0.35) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private yawTo(ctx: GameContext, e: Entity): number {
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const t = ctx.world.get(e, 'transform');
    return t ? Math.atan2(t.x - ch.x, t.z - ch.z) : ch.yaw;
  }

  private dashToward(ctx: GameContext, e: Entity, keep: number): void {
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const t = ctx.world.get(e, 'transform');
    if (!t) return;
    const dx = t.x - ch.x;
    const dz = t.z - ch.z;
    const d = Math.hypot(dx, dz);
    if (d > keep && d < FLURRY_DASH_RANGE) {
      ch.x += (dx / d) * (d - keep);
      ch.z += (dz / d) * (d - keep);
    }
    ch.yaw = Math.atan2(dx, dz);
  }

  private toggleLock(ctx: GameContext): void {
    const c = ctx.world.get(this.d.playerEntity, 'combat');
    if (!c) return;
    if (c.lockTarget !== null) {
      c.lockTarget = null;
      return;
    }
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const camYaw = this.d.camera.yaw + Math.PI;
    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const e of ctx.world.query('enemy')) {
      const en = ctx.world.require(e, 'enemy');
      if (en.deadT >= 0) continue;
      const d = Math.hypot(en.brain.x - ch.x, en.brain.z - ch.z);
      if (d > this.d.cfg.lockOnRange) continue;
      const ang = Math.abs(wrapAngle(Math.atan2(en.brain.x - ch.x, en.brain.z - ch.z) - camYaw));
      const score = d + ang * 6;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    c.lockTarget = best;
  }

  private openWheel(c: CombatState): void {
    const eq = c.equipment;
    const entry = (slot: SlotKind, uid: number | null, id: string): WheelEntry => {
      const inst = uid !== null ? findGear(eq, uid)?.inst : null;
      return { slot, uid, name: this.d.catalog.name(id), durability: inst?.durability ?? 0, max: this.d.catalog.maxDurability(id) };
    };
    this.wheelEntries = [
      entry('melee', null, 'fists'),
      ...eq.weapons.map((w) => entry('melee', w.uid, w.id)),
      ...eq.bows.map((w) => entry('bow', w.uid, w.id)),
      ...eq.shields.map((w) => entry('shield', w.uid, w.id)),
    ];
    this.wheelIndex = Math.max(0, this.wheelEntries.findIndex((e) => e.slot === 'melee' && e.uid === eq.melee));
    this.lookX = 0;
    this.lookY = 0;
    c.wheelOpen = true;
    c.drawT = 0;
    c.aiming = false;
  }

  private closeWheel(ctx: GameContext, c: CombatState): void {
    c.wheelOpen = false;
    const e = this.wheelEntries[this.wheelIndex];
    if (!e) return;
    equip(c.equipment, e.slot, e.uid);
    ctx.bus.emit('combat:equipped', { slot: e.slot, name: e.name });
  }

  /** Pose para la animación del personaje. */
  private pose(ctx: GameContext): CombatPose | null {
    const c = ctx.world.get(this.d.playerEntity, 'combat');
    if (!c) return null;
    const melee = this.meleeDef(c);
    const m = c.melee;
    let dur = 1;
    if (m.phase === 'heavy') {
      const p = heavyProfile(melee.heavy.special);
      dur = p.windup + p.active + p.recovery;
    } else if (m.phase !== 'idle' && m.phase !== 'charging') {
      const hit = m.kind === 'air' || m.kind === 'flurry' ? { windup: 0.05, active: 0.16, recovery: 0.18 } : melee.combo[m.comboIndex] ?? melee.combo[0];
      dur = m.phase === 'windup' ? hit.windup : m.phase === 'active' ? hit.active : hit.recovery;
    }
    const bow = this.bowDef(c);
    return {
      phase: m.phase,
      k: Math.min(1, m.t / Math.max(dur, 1e-3)),
      kind: m.kind,
      comboIndex: m.comboIndex,
      special: melee.heavy.special,
      guarding: c.defense.guarding,
      aiming: c.aiming,
      draw: bow ? drawFraction(bow, c.drawT) : 0,
      charged: m.phase === 'charging' && m.chargeT >= melee.heavy.chargeTime,
      plunging: c.plunging,
    };
  }
}
