import * as THREE from 'three';
import type { GameContext, System } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import type { TempleDef } from '../data/schemas';
import type { TempleCourseHandle } from '../world/temple/TempleCourse';
import type { ChunkManager } from '../world/terrain/ChunkManager';
import type { ValleyHandles } from '../world/valley/ValleyBuilder';
import type { CameraSystem } from './CameraSystem';
import type { EnvironmentSystem } from './EnvironmentSystem';
import type { Checkpoint, PlayerSystem } from './PlayerSystem';

export interface ValleyProgress {
  towerActivated: boolean;
  templeOpened: boolean;
  templeCompleted: boolean;
  hasGlider: boolean;
}

const TEMPLE_OPEN_SECONDS = 1.4;
const PORTAL_FADE = 0.45;

/**
 * Progreso del Valle de la Cápsula:
 * torre (activación) + templo (portal → prueba → planeador) → la salida del valle se abre
 * con una cinemática que revela el mundo. También gestiona la estancia dentro del templo.
 */
export class ValleyProgressSystem implements System {
  readonly name = 'valley-progress';
  readonly progress: ValleyProgress = { towerActivated: false, templeOpened: false, templeCompleted: false, hasGlider: false };
  private templeOpenT = -1;
  private transition: { t: number; to: 'temple' | 'valley' } | null = null;
  private inTemple = false;
  private gateRequested = false;
  private readonly valleyCheckpoint: Checkpoint;
  private readonly valleyKillY: number;

  constructor(
    private readonly playerEntity: Entity,
    private readonly valley: ValleyHandles,
    private readonly course: TempleCourseHandle,
    private readonly player: PlayerSystem,
    private readonly environment: EnvironmentSystem,
    private readonly camera: CameraSystem,
    private readonly chunks: ChunkManager,
    ctx: GameContext,
  ) {
    this.valleyCheckpoint = { ...player.checkpoint };
    this.valleyKillY = player.killY;
    ctx.bus.on('interact', ({ id, kind }) => {
      if (kind === 'tower' && id === valley.tower.id) this.activateTower(ctx);
      else if (kind === 'temple' && id === valley.temple.id) this.touchTemple(ctx);
      else if (kind === 'altar' && id === `${course.def.id}_reward`) this.takeReward(ctx);
      else if (kind === 'portal' && id === `${course.def.id}_exit`) this.startTransition(ctx, 'valley');
    });
    ctx.bus.on('valley:gate_opened', () => (this.gateRequested = true));
  }

  get isInTemple(): boolean {
    return this.inTemple;
  }

  /** Estado instantáneo al cargar/crear partida. */
  apply(ctx: GameContext, p: ValleyProgress, gateOpen: boolean): void {
    Object.assign(this.progress, p);
    this.valley.tower.prop.setActivated(p.towerActivated);
    this.valley.temple.prop.setOpen(p.templeOpened ? 1 : 0);
    this.valley.temple.prop.setCompleted(p.templeCompleted);
    this.valley.gate.prop.setRunes(p.towerActivated, p.templeCompleted);
    this.course.setRewardTaken(p.hasGlider);
    this.course.setExitVisible(p.hasGlider);
    this.player.setHasGlider(ctx, p.hasGlider);
    this.gateRequested = gateOpen;
    this.syncPrompts(ctx);
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;

    if (this.templeOpenT >= 0) {
      this.templeOpenT += dt;
      const k = Math.min(1, this.templeOpenT / TEMPLE_OPEN_SECONDS);
      this.valley.temple.prop.setOpen(k);
      if (k >= 1) {
        this.templeOpenT = -1;
        this.progress.templeOpened = true;
        this.syncPrompts(ctx);
      }
    }

    if (this.transition) {
      this.transition.t += dt;
      if (this.transition.t >= PORTAL_FADE) {
        const to = this.transition.to;
        this.transition = null;
        if (to === 'temple') this.enterTemple(ctx);
        else this.leaveTemple(ctx);
      }
      return;
    }

    // Dentro del templo: puntos de control al pisarlos.
    if (this.inTemple) {
      const t = ctx.world.require(this.playerEntity, 'transform');
      const ch = ctx.world.require(this.playerEntity, 'character');
      if (ch.grounded) {
        for (const c of this.course.checkpoints) {
          if (Math.abs(t.y - c.y) < 0.3 && Math.hypot(t.x - c.x, t.z - c.z) < c.radius) {
            this.player.checkpoint = { x: c.x, y: c.y, z: c.z, yaw: Math.PI };
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ torre

  private activateTower(ctx: GameContext): void {
    if (this.progress.towerActivated) return;
    this.progress.towerActivated = true;
    this.valley.tower.prop.setActivated(true);
    this.valley.gate.prop.setRunes(true, this.progress.templeCompleted);
    ctx.bus.emit('tower:activated', { id: this.valley.tower.id });
    this.syncPrompts(ctx);
    this.checkGate(ctx);
  }

  // ------------------------------------------------------------------ templo

  private touchTemple(ctx: GameContext): void {
    if (this.progress.templeCompleted) return;
    if (!this.progress.templeOpened) {
      if (this.templeOpenT < 0) this.templeOpenT = 0;
      return;
    }
    this.startTransition(ctx, 'temple');
  }

  private startTransition(ctx: GameContext, to: 'temple' | 'valley'): void {
    if (this.transition) return;
    this.transition = { t: 0, to };
    this.player.setLocked(ctx, 'portal', true);
    ctx.bus.emit('screen:fade', { to: 'black', seconds: PORTAL_FADE });
  }

  private enterTemple(ctx: GameContext): void {
    const def: TempleDef = this.course.def;
    const s = this.course.start;
    this.inTemple = true;
    this.environment.setInterior(def.atmosphere);
    this.player.killY = this.course.killY;
    this.player.checkpoint = { x: s.x, y: s.y, z: s.z, yaw: Math.PI };
    this.player.placeFree(ctx, s.x, s.y, s.z, Math.PI);
    this.player.setLocked(ctx, 'portal', false);
    ctx.bus.emit('temple:enter', { id: def.id });
    ctx.bus.emit('screen:fade', { to: 'clear', seconds: 0.7, text: `${def.name} · ${def.challengeName}` });
  }

  private takeReward(ctx: GameContext): void {
    if (this.progress.hasGlider) return;
    this.progress.hasGlider = true;
    this.player.setHasGlider(ctx, true);
    this.course.setRewardTaken(true);
    this.course.setExitVisible(true);
    ctx.bus.emit('player:obtained', { item: 'glider' });
  }

  private leaveTemple(ctx: GameContext): void {
    const f = this.valley.temple.frontWorld;
    this.inTemple = false;
    this.environment.setInterior(null);
    // Precarga del terreno del valle durante el fundido (sin huecos al aparecer).
    this.chunks.preload(f.x, f.z);
    this.player.killY = this.valleyKillY;
    this.player.checkpoint = { ...this.valleyCheckpoint };
    const yaw = Math.atan2(f.x - this.templeCenter.x, f.z - this.templeCenter.z);
    this.player.placeFree(ctx, f.x, f.y, f.z, yaw);
    this.player.setLocked(ctx, 'portal', false);
    if (!this.progress.templeCompleted) {
      this.progress.templeCompleted = true;
      this.valley.temple.prop.setCompleted(true);
      this.valley.gate.prop.setRunes(this.progress.towerActivated, true);
      ctx.bus.emit('temple:complete', { id: this.course.def.id });
    }
    ctx.bus.emit('temple:exit', { id: this.course.def.id });
    ctx.bus.emit('screen:fade', { to: 'clear', seconds: 0.7 });
    this.syncPrompts(ctx);
    this.checkGate(ctx);
  }

  private get templeCenter(): THREE.Vector3 {
    return this.valley.temple.prop.object.position;
  }

  // ------------------------------------------------------------------ salida del valle

  private checkGate(ctx: GameContext): void {
    if (this.gateRequested || !this.progress.towerActivated || !this.progress.templeCompleted) return;
    this.gateRequested = true;
    ctx.bus.emit('valley:gate_open_requested', { reason: 'torre+templo' });
    // Cinemática: el muro se hunde y, desde el borde del acantilado, se revela el mundo.
    const g = this.valley.gate.prop.object.position;
    this.camera.playCinematic(ctx, 'valley_exit', [
      {
        from: new THREE.Vector3(g.x + 14, g.y + 9, g.z - 40),
        to: new THREE.Vector3(g.x + 6, g.y + 7, g.z - 26),
        lookFrom: new THREE.Vector3(g.x, g.y + 8, g.z),
        lookTo: new THREE.Vector3(g.x, g.y + 4, g.z + 10),
        seconds: 4.2,
      },
      {
        from: new THREE.Vector3(g.x, g.y + 6, g.z + 40),
        to: new THREE.Vector3(g.x, g.y + 22, g.z + 75),
        lookFrom: new THREE.Vector3(g.x, g.y - 10, g.z + 200),
        lookTo: new THREE.Vector3(g.x + 60, g.y - 30, g.z + 900),
        seconds: 5,
        fov: 62,
      },
    ]);
  }

  private syncPrompts(ctx: GameContext): void {
    for (const e of ctx.world.query('interactable')) {
      const it = ctx.world.require(e, 'interactable');
      if (it.id === this.valley.tower.id) {
        it.prompt = this.progress.towerActivated ? 'Torre activada' : 'Activar torre';
        it.enabled = !this.progress.towerActivated;
      }
      if (it.id === this.valley.temple.id) {
        it.prompt = this.progress.templeOpened ? 'Entrar al portal' : 'Tocar la piedra';
        it.enabled = !this.progress.templeCompleted;
      }
    }
  }
}
