import type { World } from './ecs/World';
import type { GameEventBus } from './events';
import type { InputManager } from './input/InputManager';
import type { GameData } from '../data';

export interface TimeState {
  /** Duración del paso fijo de lógica (s). */
  readonly fixedDt: number;
  /** Tiempo de juego acumulado en pasos fijos (s). */
  elapsed: number;
  frame: number;
  fixedSteps: number;
  /** Pasos fijos ejecutados en el último frame de render. */
  stepsThisFrame: number;
  /** Duración del último frame de render (ms, sin recortar). */
  frameMs: number;
  /** Delta del último frame (s, recortado): para animaciones de render. */
  frameDt: number;
  /** FPS suavizados (media exponencial). */
  fps: number;
  /** Fracción [0,1) del siguiente paso fijo, para interpolar en el render. */
  alpha: number;
  /** Escala de tiempo del mundo (enemigos, proyectiles, partículas): tiempo bala, parada de impacto. */
  worldScale: number;
  /** Escala de tiempo del jugador (en la ráfaga el jugador va a velocidad normal). */
  playerScale: number;
}

export type SessionMode = 'loading' | 'title' | 'play';

export interface Session {
  mode: SessionMode;
}

export interface GameContext {
  readonly world: World;
  readonly bus: GameEventBus;
  readonly input: InputManager;
  readonly data: GameData;
  readonly time: TimeState;
  readonly session: Session;
}

/**
 * Sistema = lógica sin estado de entidad propio.
 * `fixedUpdate` corre a paso fijo (física, gameplay); `render` una vez por frame.
 */
export interface System {
  readonly name: string;
  fixedUpdate?(ctx: GameContext, dt: number): void;
  render?(ctx: GameContext, alpha: number): void;
}

/** Bucle de paso fijo con acumulador e interpolación (Gaffer on Games, "Fix Your Timestep"). */
export class Game {
  private readonly systems: System[] = [];
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  constructor(readonly ctx: GameContext) {}

  addSystem(system: System): this {
    if (this.systems.some((s) => s.name === system.name)) {
      throw new Error(`Sistema duplicado: ${system.name}`);
    }
    this.systems.push(system);
    return this;
  }

  getSystemNames(): string[] {
    return this.systems.map((s) => s.name);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.onFrame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Avanza el juego `frameSeconds` de tiempo real. Público para tests y herramientas. */
  tick(frameSeconds: number): void {
    const { time, data, input } = this.ctx;
    const loop = data.game.loop;
    time.frameMs = frameSeconds * 1000;
    time.frameDt = Math.min(frameSeconds, loop.maxFrameSeconds);
    if (frameSeconds > 0) {
      const instant = 1 / frameSeconds;
      time.fps = time.fps === 0 ? instant : time.fps + (instant - time.fps) * 0.1;
    }

    // Recorte: tras una pestaña en segundo plano o un tirón no queremos "ponernos al día" a lo bestia.
    this.accumulator += time.frameDt;

    let steps = 0;
    while (this.accumulator >= time.fixedDt && steps < loop.maxSubSteps) {
      for (const s of this.systems) s.fixedUpdate?.(this.ctx, time.fixedDt);
      // Cada pulsación se ve en UN solo paso fijo (si no, un frame con dos pasos la duplicaría).
      input.endFrame();
      this.accumulator -= time.fixedDt;
      time.elapsed += time.fixedDt;
      time.fixedSteps++;
      steps++;
    }
    // Espiral de la muerte: si ni con maxSubSteps alcanzamos, descartamos el retraso.
    if (steps === loop.maxSubSteps && this.accumulator >= time.fixedDt) this.accumulator = 0;

    time.stepsThisFrame = steps;
    time.alpha = this.accumulator / time.fixedDt;
    time.frame++;
    for (const s of this.systems) s.render?.(this.ctx, time.alpha);
  }

  private readonly onFrame = (now: number): void => {
    if (!this.running) return;
    const frameSeconds = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.tick(frameSeconds);
    this.rafId = requestAnimationFrame(this.onFrame);
  };
}

export function createTimeState(fixedStepHz: number): TimeState {
  return { fixedDt: 1 / fixedStepHz, elapsed: 0, frame: 0, fixedSteps: 0, stepsThisFrame: 0, frameMs: 0, frameDt: 0, fps: 0, alpha: 0, worldScale: 1, playerScale: 1 };
}
