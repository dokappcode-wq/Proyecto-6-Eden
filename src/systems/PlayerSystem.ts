import type { GameContext, System } from '../core/Game';
import type { DamageCause } from '../core/events';
import { teleportTransform } from '../core/ecs/components';
import type { Entity } from '../core/ecs/World';
import { clamp, lerp, smoothstep } from '../core/math';
import type { PlayerConfig } from '../data/schemas';
import type { CameraController } from '../player/CameraController';
import { createCharacterState, type CharacterEnv, type CharacterState } from '../player/CharacterController';
import { glideStateLabel } from '../player/movement/glide';
import { stepMovement, type MovementEvents, type MovementParams } from '../player/movement/Movement';
import { createHealth, damage } from '../player/movement/Stamina';
import type { CombatPose, DustPool, PlayerVisual } from '../player/PlayerVisual';
import type { CapsuleHandle } from '../world/valley/ValleyBuilder';

const HATCH_TIME = 0.6;
const HOP_START = 0.45;
const HOP_TIME = 0.6;
/** Texto de la pantalla de muerte según la causa. */
const DEATH_TEXT: Record<DamageCause, string> = {
  drown: 'Te has ahogado',
  enemy: 'Has sido derrotado',
  fall: 'Has caído',
  poison: 'El veneno ha podido contigo',
  shock: 'Una descarga te ha derribado',
  fire: 'Las llamas te han consumido',
  cold: 'Te has congelado',
  heat: 'El calor ha podido contigo',
  bleed: 'Te has desangrado',
};
const DEATH_FADE = 1.1;
const DEATH_HOLD = 1.6;

export interface Checkpoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Control del jugador: secuencia de la cápsula, movimiento completo (suelo, escalada,
 * Impulso de Borde, planeador, natación), salud, daño de caída, ahogarse y reaparición.
 */
export class PlayerSystem implements System {
  readonly name = 'player';
  /** Punto de reaparición actual (cápsula, punto de control de un templo...). */
  checkpoint: Checkpoint;
  /** Por debajo de esta altura se reaparece en el punto de control. */
  killY: number;
  /** ≥ 0 mientras dura la secuencia de muerte (fundido y reaparición). */
  private deathTimer = -1;
  private lockReasons = new Set<string>();
  lastEvents: MovementEvents | null = null;
  /** Pose de combate para la animación (la aporta el sistema de combate). */
  combatPose: () => CombatPose | null = () => null;

  constructor(
    readonly entity: Entity,
    private readonly cfg: PlayerConfig,
    private readonly params: MovementParams,
    private readonly env: CharacterEnv,
    private readonly camera: CameraController,
    private readonly capsule: CapsuleHandle,
    private readonly visual: PlayerVisual,
    private readonly dust: DustPool,
    seaLevel: number,
    private readonly hasInteractFocus: () => boolean,
    ctx: GameContext,
  ) {
    const e = capsule.exitWorld;
    this.checkpoint = { x: e.x, y: e.y, z: e.z, yaw: capsule.rotY + Math.PI / 2 };
    this.killY = seaLevel - cfg.respawn.killDepthBelowSea;
    ctx.bus.on('interact', ({ kind }) => {
      const p = ctx.world.require(entity, 'player');
      if (kind === 'capsule' && p.control === 'capsule') {
        p.control = 'exiting';
        p.scriptTime = 0;
      }
    });
    ctx.bus.on('camera:cinematic', ({ id, active }) => this.setLocked(ctx, `cinematic:${id}`, active));
  }

  get bodyRadius(): number {
    return this.cfg.body.radius;
  }

  /** Bloquea/desbloquea el control por un motivo (cinemáticas, portales). */
  setLocked(ctx: GameContext, reason: string, locked: boolean): void {
    const p = ctx.world.require(this.entity, 'player');
    if (locked) this.lockReasons.add(reason);
    else this.lockReasons.delete(reason);
    if (p.control === 'capsule' || p.control === 'exiting') return;
    p.control = this.lockReasons.size > 0 || this.deathTimer >= 0 ? 'locked' : 'free';
    if (p.control === 'locked') {
      const ch = ctx.world.require(this.entity, 'character');
      ch.vx = ch.vz = 0;
    }
  }

  /** Coloca al jugador sentado en la cápsula (partida nueva). */
  placeInCapsule(ctx: GameContext): void {
    const p = ctx.world.require(this.entity, 'player');
    p.control = 'capsule';
    p.scriptTime = 0;
    p.health = createHealth(this.cfg.health.startHearts, this.cfg.health.fragmentsPerHeart);
    this.capsule.prop.setOpen(0);
    const s = this.capsule.seatWorld;
    this.resetCharacter(ctx, s.x, s.y, s.z, this.capsule.rotY, false);
  }

  /** Coloca al jugador libre en un punto (continuar partida / reaparecer / teletransporte). */
  placeFree(ctx: GameContext, x: number, y: number, z: number, yaw: number): void {
    const p = ctx.world.require(this.entity, 'player');
    p.control = this.lockReasons.size > 0 ? 'locked' : 'free';
    this.capsule.prop.setOpen(1);
    const ground = this.env.terrainHeight(x, z);
    const ch = ctx.world.require(this.entity, 'character');
    this.resetCharacter(ctx, x, Math.max(y, ground), z, yaw, ch.hasGlider);
    this.camera.snapBehind(yaw, { x, y, z });
  }

  setHasGlider(ctx: GameContext, value: boolean): void {
    ctx.world.require(this.entity, 'character').hasGlider = value;
    this.visual.setGliderEquipped(value);
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    const { world, input } = ctx;
    const p = world.require(this.entity, 'player');
    const ch = world.require(this.entity, 'character');
    const t = world.require(this.entity, 'transform');
    p.cameraYaw = this.camera.yaw;

    if (this.deathTimer >= 0) {
      this.deathTimer += dt;
      if (this.deathTimer >= DEATH_FADE + DEATH_HOLD) this.finishRespawn(ctx);
      return;
    }
    if (p.control === 'capsule') return;
    if (p.control === 'exiting') {
      this.stepCapsuleExit(ctx, dt);
      return;
    }

    // Escala de tiempo del jugador (tiempo bala al apuntar en el aire, parada de impacto).
    const pdt = dt * ctx.time.playerScale;
    if (pdt <= 0) return;
    const combat = world.get(this.entity, 'combat');
    const locked = p.control === 'locked' || (combat?.wheelOpen ?? false);
    const moveMul = combat?.moveMultiplier ?? 1;
    const f = this.camera.forward();
    const r = this.camera.right();
    const ix = locked ? 0 : input.axis('move_left', 'move_right');
    const iz = locked ? 0 : input.axis('move_back', 'move_forward');
    let mx = r.x * ix + f.x * iz;
    let mz = r.z * ix + f.z * iz;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    mx *= moveMul;
    mz *= moveMul;
    const pressed = (a: string) => !locked && input.wasPressed(a);
    const down = (a: string) => !locked && input.isDown(a);

    const ev = stepMovement(
      ch,
      {
        moveX: mx,
        moveZ: mz,
        right: ix,
        forward: iz,
        jumpPressed: pressed('jump'),
        jumpHeld: down('jump'),
        sprint: down('sprint'),
        crouch: down('crouch'),
        crouchPressed: pressed('crouch'),
        walk: down('walk'),
        dodgePressed: pressed('dodge'),
        grabPressed: pressed('interact') && !this.hasInteractFocus(),
        faceYaw: combat?.faceYaw ?? undefined,
        lunge: combat?.lunge ?? 0,
      },
      this.params,
      this.env,
      pdt,
      p.health.maxFragments,
    );
    this.lastEvents = ev;
    this.dispatch(ctx, ev, ch);

    t.x = ch.x;
    t.y = ch.y;
    t.z = ch.z;
    t.rotY = ch.yaw;

    if (ch.y < this.killY || input.wasPressed('debug_respawn')) this.respawnAtCheckpoint(ctx);
  }

  render(ctx: GameContext): void {
    const p = ctx.world.require(this.entity, 'player');
    const ch = ctx.world.require(this.entity, 'character');
    const free = p.control === 'free' || p.control === 'locked';
    this.visual.animate(
      {
        mode: free ? ch.mode : 'ground',
        speed: free ? Math.hypot(ch.vx, ch.vz) : 0,
        jogSpeed: this.cfg.movement.jogSpeed,
        sprinting: ch.sprinting,
        sliding: free && ch.sliding,
        crouch: free && ctx.input.isDown('crouch') && ch.grounded,
        vy: ch.vy,
        seated: p.control === 'capsule' || (p.control === 'exiting' && p.scriptTime < HOP_START),
        climbMoving: ch.mode === 'climb' && (Math.abs(ctx.input.axis('move_left', 'move_right')) + Math.abs(ctx.input.axis('move_back', 'move_forward')) > 0),
        ledgePhase: ch.mode === 'ledge' ? ch.ledge.phase : null,
        glideBank: ch.glide.bank,
        glideDive: ch.glide.dive,
        glideDeploy: ch.mode === 'glide' ? clamp(1 + ch.glide.deployT / this.params.glider.deploySeconds, 0, 1) : 0,
        underwater: ch.underwater,
        combat: free ? this.combatPose() : null,
      },
      ctx.time.frameDt,
    );
    this.dust.update(ctx.time.frameDt);
  }

  modeLabel(ctx: GameContext): string {
    const p = ctx.world.require(this.entity, 'player');
    if (p.control !== 'free') return p.control;
    const ch = ctx.world.require(this.entity, 'character');
    if (ch.mode === 'ground' && ch.sliding) return 'deslizando';
    return ch.mode;
  }

  ledgeLabel(ctx: GameContext): string {
    const ch = ctx.world.require(this.entity, 'character');
    if (ch.mode === 'ledge') return ch.ledge.phase === 'contact' ? 'Contacto' : ch.ledge.phase === 'boost' ? 'Impulso' : 'Mantle';
    if (ctx.time.elapsed - ch.lastLedgeEnd < 0.2 && ch.lastLedgeEnd > 0) return 'Salida';
    return ch.mode === 'air' || ch.mode === 'glide' || ch.mode === 'swim' ? 'Detectando' : '—';
  }

  glideLabel(ctx: GameContext): string {
    return glideStateLabel(ctx.world.require(this.entity, 'character'));
  }

  // ------------------------------------------------------------------ internos

  private dispatch(ctx: GameContext, ev: MovementEvents, ch: CharacterState): void {
    const { bus } = ctx;
    const p = ctx.world.require(this.entity, 'player');
    const pos = { x: ch.x, y: ch.y, z: ch.z };
    if (ev.jumped) {
      bus.emit('player:jumped', pos);
      this.visual.jump();
      this.dust.burst(ch.x, ch.y, ch.z, 5, 0.8);
    }
    if (ev.launched) {
      bus.emit('player:launched', pos);
      this.camera.addShake(0.25);
      this.camera.kickFov(8);
    }
    if (ev.landed && !ev.landed.water) {
      const l = ev.landed;
      if (l.speed > 3) {
        bus.emit('player:landed', { ...pos, speed: l.speed, drop: l.drop });
        this.visual.land(l.rolled ? 0.2 : l.speed / 14);
        if (l.rolled) this.visual.roll();
        this.dust.burst(ch.x, ch.y, ch.z, Math.round(clamp(l.speed, 4, 14)), clamp(l.speed / 6, 0.8, 3));
      }
      // El ataque en picado aterriza a propósito: sin daño de caída.
      if (l.damage > 0 && !ctx.world.get(this.entity, 'combat')?.plunging) {
        this.camera.addShake(clamp(l.damage / 6, 0.3, 1));
        this.hurt(ctx, l.damage, 'fall');
      }
    }
    if (ev.splash) {
      bus.emit('player:splash', pos);
      this.dust.burst(ch.x, ch.y + 0.2, ch.z, 10, 1.6);
    }
    if (ev.ledgeContact) {
      bus.emit('player:ledge', { phase: 'contact', ...pos, mantle: false });
      this.camera.addShake(0.12);
      this.dust.burst(ch.ledge.cx - ch.ledge.nx * 0.3, ch.ledge.ty - 0.1, ch.ledge.cz - ch.ledge.nz * 0.3, 6, 0.7);
    }
    if (ev.ledgeBoost) {
      bus.emit('player:ledge', { phase: 'boost', ...pos, mantle: ev.ledgeBoost.mantle });
      if (!ev.ledgeBoost.mantle) {
        this.camera.kickFov(6);
        this.camera.addShake(0.15);
      }
    }
    if (ev.ledgeExit) bus.emit('player:ledge', { phase: 'exit', ...pos, mantle: false });
    if (ev.ledgeReleased) bus.emit('player:ledge', { phase: 'release', ...pos, mantle: false });
    if (ev.climbStart) bus.emit('player:climb', { phase: 'start' });
    if (ev.climbJump) bus.emit('player:climb', { phase: 'jump' });
    if (ev.climbTopOut) bus.emit('player:climb', { phase: 'topout' });
    if (ev.gliderDeploy) {
      bus.emit('player:glider', { phase: 'deploy', reason: '' });
      this.camera.addShake(0.08);
    }
    if (ev.gliderFold) bus.emit('player:glider', { phase: 'fold', reason: ev.gliderFold });
    if (ev.dodged) {
      bus.emit('player:dodge', { perfect: false });
      this.dust.burst(ch.x, ch.y, ch.z, 4, 0.6);
    }
    if (ev.glideLand) bus.emit('player:glide_land', ev.glideLand);
    if (ev.exhausted) bus.emit('player:exhausted', {});
    if (ev.drowned && this.deathTimer < 0) {
      const dead = damage(p.health, this.cfg.health.drownDamageFragments);
      bus.emit('player:damaged', { amount: this.cfg.health.drownDamageFragments, cause: 'drown', remaining: p.health.fragments });
      if (dead) this.die(ctx, 'drown');
      else {
        // Reaparece en la última orilla segura.
        this.placeFree(ctx, ch.safeX, ch.safeY, ch.safeZ, ch.yaw);
        bus.emit('screen:fade', { to: 'clear', seconds: 0.6 });
      }
    }
  }

  /** Daño externo (enemigos): devuelve true si muere. */
  /** Ajuste del daño recibido (defensa de la armadura); lo conecta la progresión. */
  damageFilter: ((amount: number, cause: DamageCause) => number) | null = null;

  damagePlayer(ctx: GameContext, amount: number, cause: DamageCause): boolean {
    if (this.deathTimer >= 0) return false;
    if (this.damageFilter) amount = this.damageFilter(amount, cause);
    if (amount <= 0) return false;
    this.camera.addShake(clamp(amount / 6, 0.25, 0.8));
    return this.hurt(ctx, amount, cause);
  }

  private hurt(ctx: GameContext, amount: number, cause: DamageCause): boolean {
    const p = ctx.world.require(this.entity, 'player');
    const dead = damage(p.health, amount);
    ctx.bus.emit('player:damaged', { amount, cause, remaining: p.health.fragments });
    if (dead) this.die(ctx, cause);
    return dead;
  }

  private die(ctx: GameContext, cause: DamageCause): void {
    this.deathTimer = 0;
    ctx.world.require(this.entity, 'player').control = 'locked';
    ctx.bus.emit('player:died', { cause });
    ctx.bus.emit('screen:fade', { to: 'black', seconds: DEATH_FADE, text: DEATH_TEXT[cause] });
  }

  private finishRespawn(ctx: GameContext): void {
    this.deathTimer = -1;
    const p = ctx.world.require(this.entity, 'player');
    p.health.fragments = p.health.maxFragments;
    const c = this.checkpoint;
    this.placeFree(ctx, c.x, c.y, c.z, c.yaw);
    ctx.bus.emit('player:healed', { remaining: p.health.fragments });
    ctx.bus.emit('player:respawned', { x: c.x, y: c.y, z: c.z });
    ctx.bus.emit('screen:fade', { to: 'clear', seconds: 0.8 });
  }

  private respawnAtCheckpoint(ctx: GameContext): void {
    const c = this.checkpoint;
    this.placeFree(ctx, c.x, c.y, c.z, c.yaw);
    ctx.bus.emit('player:respawned', { x: c.x, y: c.y, z: c.z });
    ctx.bus.emit('screen:fade', { to: 'clear', seconds: 0.5 });
  }

  private stepCapsuleExit(ctx: GameContext, dt: number): void {
    const p = ctx.world.require(this.entity, 'player');
    const ch = ctx.world.require(this.entity, 'character');
    const t = ctx.world.require(this.entity, 'transform');
    p.scriptTime += dt;
    this.capsule.prop.setOpen(clamp(p.scriptTime / HATCH_TIME, 0, 1));
    const k = clamp((p.scriptTime - HOP_START) / HOP_TIME, 0, 1);
    if (k > 0) {
      const s = this.capsule.seatWorld;
      const e = this.capsule.exitWorld;
      const ek = smoothstep(0, 1, k);
      t.x = lerp(s.x, e.x, ek);
      t.z = lerp(s.z, e.z, ek);
      t.y = lerp(s.y, e.y, ek) + Math.sin(k * Math.PI) * 1.1;
      t.rotY = Math.atan2(e.x - s.x, e.z - s.z);
    }
    ch.x = t.x;
    ch.y = t.y;
    ch.z = t.z;
    if (k >= 1) {
      p.control = this.lockReasons.size > 0 ? 'locked' : 'free';
      this.resetCharacter(ctx, t.x, t.y, t.z, t.rotY, ch.hasGlider);
      this.dust.burst(t.x, t.y, t.z, 8, 1.2);
      this.visual.land(0.5);
      ctx.bus.emit('capsule:exited', {});
    }
  }

  /** Nuevo estado físico conservando lo que no depende de la posición (planeador, stamina máx.). */
  private resetCharacter(ctx: GameContext, x: number, y: number, z: number, yaw: number, hasGlider: boolean): void {
    const t = ctx.world.require(this.entity, 'transform');
    teleportTransform(t, x, y, z, yaw);
    const ch = ctx.world.require(this.entity, 'character');
    const maxStamina = ch.stamina.max;
    Object.assign(ch, createCharacterState(x, y, z, yaw, maxStamina, this.cfg.swim.airSeconds));
    ch.hasGlider = hasGlider;
  }
}
