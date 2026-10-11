import type { GameContext, System } from '../core/Game';
import { teleportTransform } from '../core/ecs/components';
import type { Entity } from '../core/ecs/World';
import { clamp, lerp, smoothstep } from '../core/math';
import type { PlayerConfig } from '../data/schemas';
import type { CameraController } from '../player/CameraController';
import { createCharacterState, moveMode, stepCharacter, type CharacterEnv } from '../player/CharacterController';
import type { DustPool, PlayerVisual } from '../player/PlayerVisual';
import type { CapsuleHandle } from '../world/valley/ValleyBuilder';

const HATCH_TIME = 0.6;
const HOP_START = 0.45;
const HOP_TIME = 0.6;

/**
 * Control del jugador: secuencia de salida de la cápsula, movimiento libre relativo a la
 * cámara, eventos de salto/aterrizaje y reaparición si cae fuera del mundo.
 */
export class PlayerSystem implements System {
  readonly name = 'player';

  constructor(
    readonly entity: Entity,
    private readonly cfg: PlayerConfig,
    private readonly env: CharacterEnv,
    private readonly camera: CameraController,
    private readonly capsule: CapsuleHandle,
    private readonly visual: PlayerVisual,
    private readonly dust: DustPool,
    private readonly seaLevel: number,
    ctx: GameContext,
  ) {
    ctx.bus.on('interact', ({ kind }) => {
      const p = ctx.world.require(entity, 'player');
      if (kind === 'capsule' && p.control === 'capsule') {
        p.control = 'exiting';
        p.scriptTime = 0;
      }
    });
  }

  /** Coloca al jugador sentado en la cápsula (partida nueva). */
  placeInCapsule(ctx: GameContext): void {
    const p = ctx.world.require(this.entity, 'player');
    p.control = 'capsule';
    p.scriptTime = 0;
    this.capsule.prop.setOpen(0);
    const s = this.capsule.seatWorld;
    this.teleport(ctx, s.x, s.y, s.z, this.capsule.rotY);
  }

  /** Coloca al jugador libre en un punto (continuar partida / reaparecer). */
  placeFree(ctx: GameContext, x: number, y: number, z: number, yaw: number): void {
    const p = ctx.world.require(this.entity, 'player');
    p.control = 'free';
    this.capsule.prop.setOpen(1);
    const ground = this.env.terrainHeight(x, z);
    this.teleport(ctx, x, Math.max(y, ground), z, yaw);
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    const { world, input, bus } = ctx;
    const p = world.require(this.entity, 'player');
    const ch = world.require(this.entity, 'character');
    const t = world.require(this.entity, 'transform');
    p.cameraYaw = this.camera.yaw;

    if (p.control === 'capsule') return;

    if (p.control === 'exiting') {
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
      if (k >= 1) {
        p.control = 'free';
        Object.assign(ch, createCharacterState(t.x, t.y, t.z, t.rotY));
        this.dust.burst(t.x, t.y, t.z, 8, 1.2);
        this.visual.land(0.5);
        bus.emit('capsule:exited', {});
      }
      ch.x = t.x;
      ch.y = t.y;
      ch.z = t.z;
      return;
    }

    // --- movimiento libre relativo a la cámara
    const f = this.camera.forward();
    const r = this.camera.right();
    const ix = input.axis('move_left', 'move_right');
    const iz = input.axis('move_back', 'move_forward');
    let mx = r.x * ix + f.x * iz;
    let mz = r.z * ix + f.z * iz;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }

    const ev = stepCharacter(
      ch,
      {
        moveX: mx,
        moveZ: mz,
        jumpPressed: input.wasPressed('jump'),
        jumpHeld: input.isDown('jump'),
        crouch: input.isDown('crouch'),
        walk: input.isDown('walk'),
      },
      this.cfg.movement,
      this.cfg.body,
      this.env,
      dt,
    );

    if (ev.jumped) {
      bus.emit('player:jumped', { x: ch.x, y: ch.y, z: ch.z });
      this.visual.jump();
      this.dust.burst(ch.x, ch.y, ch.z, 5, 0.8);
    }
    if (ev.landedSpeed > 3) {
      bus.emit('player:landed', { x: ch.x, y: ch.y, z: ch.z, speed: ev.landedSpeed, drop: ev.landedDrop });
      this.visual.land(ev.landedSpeed / 14);
      this.dust.burst(ch.x, ch.y, ch.z, Math.round(clamp(ev.landedSpeed, 4, 14)), clamp(ev.landedSpeed / 6, 0.8, 3));
    }

    t.x = ch.x;
    t.y = ch.y;
    t.z = ch.z;
    t.rotY = ch.yaw;

    if (ch.y < this.seaLevel - this.cfg.respawn.killDepthBelowSea || input.wasPressed('debug_respawn')) this.respawn(ctx);
  }

  render(ctx: GameContext): void {
    const p = ctx.world.require(this.entity, 'player');
    const ch = ctx.world.require(this.entity, 'character');
    const free = p.control === 'free';
    this.visual.animate(
      {
        speed: free ? Math.hypot(ch.vx, ch.vz) : 0,
        jogSpeed: this.cfg.movement.jogSpeed,
        grounded: free ? ch.grounded : p.control === 'capsule',
        floating: free && ch.floating,
        sliding: free && ch.sliding,
        crouch: free && ctx.input.isDown('crouch') && ch.grounded,
        vy: ch.vy,
        seated: p.control === 'capsule' || (p.control === 'exiting' && p.scriptTime < HOP_START),
      },
      ctx.time.frameDt,
    );
    this.dust.update(ctx.time.frameDt);
  }

  modeLabel(ctx: GameContext): string {
    const p = ctx.world.require(this.entity, 'player');
    return p.control === 'free' ? moveMode(ctx.world.require(this.entity, 'character')) : p.control;
  }

  private respawn(ctx: GameContext): void {
    const e = this.capsule.exitWorld;
    const yaw = this.capsule.rotY + Math.PI / 2;
    this.placeFree(ctx, e.x, e.y, e.z, yaw);
    this.camera.snapBehind(yaw, e);
    ctx.bus.emit('player:respawned', { x: e.x, y: e.y, z: e.z });
  }

  private teleport(ctx: GameContext, x: number, y: number, z: number, yaw: number): void {
    const t = ctx.world.require(this.entity, 'transform');
    teleportTransform(t, x, y, z, yaw);
    const ch = ctx.world.require(this.entity, 'character');
    Object.assign(ch, createCharacterState(x, y, z, yaw));
  }
}
