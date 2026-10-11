import type { GameContext, System } from '../core/Game';
import type { Renderer } from '../core/Renderer';

/**
 * Overlay de depuración (F3). Se refresca cada `debug.refreshMs` para no
 * tocar el DOM en cada frame. Cada fase añade líneas vía `addProvider`.
 */
export class DebugOverlay implements System {
  readonly name = 'debug-overlay';
  private readonly el: HTMLDivElement;
  private visible: boolean;
  private lastRefresh = -Infinity;
  private readonly providers: Array<{ label: string; fn: (ctx: GameContext) => string }> = [];
  private readonly recentEvents: string[] = [];

  constructor(
    ctx: GameContext,
    private readonly renderer: Renderer,
    parent: HTMLElement = document.body,
  ) {
    this.visible = ctx.data.game.debug.startVisible;
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      padding: '8px 10px',
      background: 'rgba(5, 18, 28, 0.78)',
      border: '1px solid rgba(31, 214, 255, 0.45)',
      borderRadius: '6px',
      color: '#bff4ff',
      font: '12px/1.45 ui-monospace, Menlo, Consolas, monospace',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: '10',
      maxWidth: 'calc(100vw - 32px)',
      overflow: 'hidden',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.el);
    this.applyVisibility();

    ctx.bus.on('input:action', ({ action, phase }) => {
      if (action === 'debug_toggle' && phase === 'pressed') {
        this.visible = !this.visible;
        this.applyVisibility();
        this.lastRefresh = -Infinity;
      }
      if (phase === 'pressed') this.logEvent(`input:${action}`);
    });
    ctx.bus.on('input:rebound', ({ action, codes }) => this.logEvent(`rebind ${action} → ${codes.join(',')}`));
    ctx.bus.on('world:loaded', ({ entityCount }) => this.logEvent(`world:loaded (${entityCount})`));
  }

  addProvider(label: string, fn: (ctx: GameContext) => string): void {
    this.providers.push({ label, fn });
  }

  render(ctx: GameContext): void {
    if (!this.visible) return;
    const now = performance.now();
    if (now - this.lastRefresh < ctx.data.game.debug.refreshMs) return;
    this.lastRefresh = now;

    const { time, world, input } = ctx;
    const cam = this.renderer.camera.position;
    const lines = [
      `EDEN debug (F3)`,
      `FPS ${time.fps.toFixed(0).padStart(3)}  frame ${time.frameMs.toFixed(2)} ms  pasos/frame ${time.stepsThisFrame}`,
      `lógica ${(1 / time.fixedDt).toFixed(0)} Hz  t=${time.elapsed.toFixed(1)} s  α=${time.alpha.toFixed(2)}`,
      `entidades ${world.entityCount}  draw calls ${this.renderer.drawCalls}  tris ${this.renderer.triangles}`,
      `cámara ${cam.x.toFixed(1)}, ${cam.y.toFixed(1)}, ${cam.z.toFixed(1)}`,
      `acciones [${input.activeActions().join(', ')}]`,
      ...this.providers.map((p) => `${p.label}: ${p.fn(ctx)}`),
      `eventos: ${this.recentEvents.join(' · ') || '—'}`,
    ];
    this.el.textContent = lines.join('\n');
  }

  private logEvent(text: string): void {
    this.recentEvents.push(text);
    if (this.recentEvents.length > 4) this.recentEvents.shift();
  }

  private applyVisibility(): void {
    this.el.style.display = this.visible ? 'block' : 'none';
  }
}
