import * as THREE from 'three';
import type { GameContext, System } from '../core/Game';
import type { Renderer } from '../core/Renderer';
import type { Collider, StaticColliders } from '../world/physics/StaticColliders';

/**
 * Overlay de depuración (F3). Se refresca cada `debug.refreshMs` para no
 * tocar el DOM en cada frame. Cada fase añade líneas vía `addProvider`.
 * Con el overlay visible también dibuja los colisionadores cercanos (hitboxes).
 */
export class DebugOverlay implements System {
  readonly name = 'debug-overlay';
  private readonly el: HTMLDivElement;
  private visible: boolean;
  private lastRefresh = -Infinity;
  private readonly providers: Array<{ label: string; fn: (ctx: GameContext) => string }> = [];
  private readonly recentEvents: string[] = [];
  private readonly hitboxes: HitboxView;
  private readonly rays = new RayView();

  constructor(
    ctx: GameContext,
    private readonly renderer: Renderer,
    colliders: StaticColliders,
    private readonly focus: () => { x: number; y: number; z: number },
    parent: HTMLElement = document.body,
  ) {
    this.visible = ctx.data.game.debug.startVisible;
    this.hitboxes = new HitboxView(colliders);
    renderer.scene.add(this.hitboxes.group, this.rays.lines);
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '52px',
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
    });
    ctx.bus.on('player:jumped', () => this.logEvent('salto'));
    ctx.bus.on('player:landed', ({ speed, drop }) => this.logEvent(`aterrizaje ${speed.toFixed(1)} m/s (${drop.toFixed(1)} m)`));
    ctx.bus.on('interact', ({ id }) => this.logEvent(`interact:${id}`));
    ctx.bus.on('tutorial:step_completed', ({ id }) => this.logEvent(`tutorial:${id}`));
    ctx.bus.on('input:rebound', ({ action, codes }) => this.logEvent(`rebind ${action} → ${codes.join(',')}`));
    ctx.bus.on('valley:gate_opened', () => this.logEvent('salida abierta'));
    ctx.bus.on('player:ledge', ({ phase, mantle }) => this.logEvent(`borde:${phase}${mantle ? ' (mantle)' : ''}`));
    ctx.bus.on('player:glider', ({ phase, reason }) => this.logEvent(`planeador:${phase}${reason ? ` (${reason})` : ''}`));
    ctx.bus.on('player:climb', ({ phase }) => this.logEvent(`trepar:${phase}`));
    ctx.bus.on('player:damaged', ({ amount, cause }) => this.logEvent(`daño ${amount}/4 (${cause})`));
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Empieza un nuevo lote de rayos (cada paso de física). */
  beginRays(): void {
    this.rays.begin();
  }

  /** Registra un rayo de sondeo (verde = impacto, rojo = libre). Solo con el overlay visible. */
  ray(ax: number, ay: number, az: number, bx: number, by: number, bz: number, hit: boolean): void {
    if (this.visible) this.rays.add(ax, ay, az, bx, by, bz, hit);
  }

  addProvider(label: string, fn: (ctx: GameContext) => string): void {
    this.providers.push({ label, fn });
  }

  render(ctx: GameContext): void {
    if (!this.visible) return;
    this.rays.flush();
    const now = performance.now();
    if (now - this.lastRefresh < ctx.data.game.debug.refreshMs) return;
    this.lastRefresh = now;
    this.hitboxes.update(this.focus());

    const { time, world, input } = ctx;
    const lines = [
      `EDEN debug (F3) · T acelera el tiempo · F6 abre la salida · F7 viaja a un encuentro · F8 reaparecer`,
      `FPS ${time.fps.toFixed(0).padStart(3)}  frame ${time.frameMs.toFixed(2)} ms  pasos/frame ${time.stepsThisFrame}`,
      `entidades ${world.entityCount}  draw calls ${this.renderer.drawCalls}  tris ${(this.renderer.triangles / 1000).toFixed(0)}k`,
      ...this.providers.map((p) => `${p.label}: ${p.fn(ctx)}`),
      `acciones [${input.activeActions().join(', ')}]`,
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
    this.hitboxes.group.visible = this.visible;
    this.rays.lines.visible = this.visible;
  }
}

/** Wireframes de los colisionadores cercanos (pool fijo, sin crear geometría por frame). */
class HitboxView {
  readonly group = new THREE.Group();
  private readonly boxes: THREE.Mesh[] = [];
  private readonly cylinders: THREE.Mesh[] = [];
  private readonly found: Collider[] = [];

  constructor(private readonly colliders: StaticColliders) {
    this.group.name = 'debug-hitboxes';
    const mat = new THREE.MeshBasicMaterial({ color: '#ff3df0', wireframe: true, depthTest: false, transparent: true, opacity: 0.6 });
    const boxGeo = new THREE.BoxGeometry(2, 2, 2);
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
    for (let i = 0; i < 64; i++) {
      const b = new THREE.Mesh(boxGeo, mat);
      const c = new THREE.Mesh(cylGeo, mat);
      b.visible = c.visible = false;
      b.renderOrder = c.renderOrder = 999;
      this.boxes.push(b);
      this.cylinders.push(c);
      this.group.add(b, c);
    }
  }

  update(p: { x: number; y: number; z: number }): void {
    const r = 30;
    this.colliders.query(p.x - r, p.z - r, p.x + r, p.z + r, this.found);
    let bi = 0;
    let ci = 0;
    for (const c of this.found) {
      if (c.kind === 'box' && bi < this.boxes.length) {
        const m = this.boxes[bi++];
        m.position.set(c.x, c.y, c.z);
        m.scale.set(c.hx, c.hy, c.hz);
        m.rotation.y = Math.atan2(c.sin, c.cos);
        m.visible = true;
      } else if (c.kind === 'cylinder' && ci < this.cylinders.length) {
        const m = this.cylinders[ci++];
        m.position.set(c.x, (c.yMin + c.yMax) / 2, c.z);
        m.scale.set(c.radius, c.yMax - c.yMin, c.radius);
        m.visible = true;
      }
    }
    for (let i = bi; i < this.boxes.length; i++) this.boxes[i].visible = false;
    for (let i = ci; i < this.cylinders.length; i++) this.cylinders[i].visible = false;
  }
}

/** Rayos de sondeo del último paso de física (máx. 48). */
class RayView {
  readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private count = 0;
  private readonly max = 48;
  private dirty = false;

  constructor() {
    this.pos = new Float32Array(this.max * 6);
    this.col = new Float32Array(this.max * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1000;
    this.lines.name = 'debug-rays';
  }

  begin(): void {
    this.count = 0;
    this.dirty = true;
  }

  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, hit: boolean): void {
    if (this.count >= this.max) return;
    const i = this.count * 6;
    this.pos.set([ax, ay, az, bx, by, bz], i);
    const c = hit ? [0.3, 1, 0.45] : [1, 0.3, 0.3];
    this.col.set([...c, ...c], i);
    this.count++;
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.lines.geometry.setDrawRange(0, this.count * 2);
    this.lines.geometry.getAttribute('position').needsUpdate = true;
    this.lines.geometry.getAttribute('color').needsUpdate = true;
  }
}
