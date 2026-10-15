import type { GameContext } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import type { MapLayer } from '../data/schemas';
import type { MapMarker, MapSystem, Poi, PoiKind } from '../systems/MapSystem';

const CSS = /* css */ `
#mapui { position: fixed; inset: 0; z-index: 31; display: none; background: #07131c; color: #eaf7ff; font-family: 'Segoe UI', system-ui, sans-serif; user-select: none; }
#mapui.on { display: block; }
#mapui canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; }
#mapui header { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 8px; padding: 12px 20px; background: linear-gradient(rgba(4,12,18,.9), rgba(4,12,18,0)); }
#mapui header h2 { margin: 0 14px 0 0; font-weight: 500; letter-spacing: .1em; font-size: 17px; color: #8fe9ff; }
#mapui header button { background: rgba(31,214,255,.12); border: 1px solid rgba(31,214,255,.35); color: #eaf7ff; padding: 5px 12px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 13px; }
#mapui header button.sel { background: rgba(31,214,255,.4); }
#mapui header .region { margin-left: auto; font-size: 13px; opacity: .85; }
#mapui .legend { position: absolute; right: 16px; top: 60px; background: rgba(4,14,22,.82); border: 1px solid rgba(31,214,255,.25); border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.9; }
#mapui .legend b { display: block; color: #8fe9ff; font-weight: 500; letter-spacing: .08em; margin-bottom: 2px; }
#mapui .legend i { display: inline-block; width: 12px; height: 12px; margin-right: 8px; vertical-align: -2px; border-radius: 2px; }
#mapui .info { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); background: rgba(4,14,22,.9); border: 1px solid rgba(31,214,255,.35); border-radius: 8px; padding: 10px 14px; font-size: 13px; display: none; text-align: center; min-width: 240px; }
#mapui .info button { margin-top: 8px; background: rgba(31,214,255,.25); border: 1px solid rgba(31,214,255,.6); color: #eaf7ff; padding: 6px 14px; border-radius: 6px; cursor: pointer; font: inherit; }
#mapui .info button:disabled { opacity: .35; cursor: default; }
#mapui .info .why { color: #ffd23a; font-size: 12px; margin-top: 6px; }
#mapui .hint { position: absolute; left: 18px; bottom: 14px; font-size: 12px; opacity: .6; }
#mapui .stats { position: absolute; left: 18px; top: 60px; font-size: 12px; opacity: .8; }
`;

const LAYERS: [MapLayer, string][] = [
  ['sky', 'Cielo'],
  ['surface', 'Superficie'],
  ['underground', 'Subterráneo'],
];

const KIND_LABEL: Record<PoiKind, string> = {
  tower: 'Torre de reconocimiento',
  temple: 'Templo de retos',
  ruins: 'Ruinas',
  cave: 'Cueva',
  camp: 'Campamento goblin',
  island: 'Isla flotante',
  underground: 'Entrada subterránea',
  settlement: 'Asentamiento',
  station: 'Lugar ancestral',
};

export interface MapScreenDeps {
  map: MapSystem;
  playerEntity: Entity;
  canvas: HTMLCanvasElement;
  keyLabel: (action: string) => string;
}

/**
 * Mapa a pantalla completa (M): relieve del mundo, niebla de guerra, capas (cielo / superficie /
 * subterráneo), leyenda, puntos de interés, marcadores (clic) y viaje rápido a torres y templos.
 */
export class MapScreen {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly fogCanvas: HTMLCanvasElement;
  private readonly fogCtx: CanvasRenderingContext2D;
  private readonly fogImage: ImageData;
  private fogVersion = -1;
  private readonly info: HTMLDivElement;
  private readonly region: HTMLSpanElement;
  private readonly stats: HTMLDivElement;
  private readonly tabs: HTMLButtonElement[] = [];
  layer: MapLayer = 'surface';
  /** Centro de la vista (mundo) y escala (px por metro). */
  cx = 0;
  cz = 0;
  scale = 0.25;
  private selected: Poi | null = null;
  private why = '';
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private focus: { x: number; z: number; radius: number; t: number } | null = null;
  private raf = 0;
  private hover: { x: number; z: number } | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly d: MapScreenDeps,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'mapui';
    document.body.appendChild(this.root);
    this.canvas = document.createElement('canvas');
    this.root.appendChild(this.canvas);
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('Canvas 2D no disponible para el mapa');
    this.g = g;
    const res = d.map.fog.resolution;
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.fogCanvas.height = res;
    const fc = this.fogCanvas.getContext('2d');
    if (!fc) throw new Error('Canvas 2D no disponible para la niebla');
    this.fogCtx = fc;
    this.fogImage = fc.createImageData(res, res);

    const header = document.createElement('header');
    header.innerHTML = '<h2>MAPA DE EDEN</h2>';
    for (const [id, label] of LAYERS) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => {
        this.layer = id;
        this.selected = null;
        this.syncTabs();
      };
      header.appendChild(b);
      this.tabs.push(b);
    }
    this.region = document.createElement('span');
    this.region.className = 'region';
    header.appendChild(this.region);
    this.root.appendChild(header);

    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = `<b>LEYENDA</b>
      <div><i style="background:#1fd6ff"></i>Torre (activada)</div>
      <div><i style="border:2px solid #1fd6ff"></i>Torre (sin activar)</div>
      <div><i style="background:#ffb347;transform:rotate(45deg)"></i>Templo de retos</div>
      <div><i style="background:#a08060"></i>Ruinas / cuevas</div>
      <div><i style="background:#ff5b4b"></i>Campamento</div>
      <div><i style="background:#b48cff;border-radius:50%"></i>Entrada subterránea</div>
      <div><i style="background:#e8f6ff;border-radius:50%"></i>Isla flotante</div>
      <div><i style="background:#ffd23a;border-radius:50% 50% 0 50%"></i>Tu posición</div>
      <div><i style="background:#16384c"></i>Zona desconocida</div>`;
    this.root.appendChild(legend);
    this.stats = document.createElement('div');
    this.stats.className = 'stats';
    this.root.appendChild(this.stats);
    this.info = document.createElement('div');
    this.info.className = 'info';
    this.root.appendChild(this.info);
    const hint = document.createElement('div');
    hint.className = 'hint';
    this.root.appendChild(hint);
    hint.textContent = `Rueda: zoom · Arrastrar: mover · Clic: marcador (clic sobre él lo quita) · ${d.keyLabel('map')} o Esc: cerrar`;

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.toWorld(e.offsetX, e.offsetY);
      this.scale = Math.min(1, Math.max(this.minScale(), this.scale * Math.exp(-e.deltaY * 0.0015)));
      const after = this.toWorld(e.offsetX, e.offsetY);
      this.cx += before.x - after.x;
      this.cz += before.z - after.z;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false };
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.isOpen) return;
      const r = this.canvas.getBoundingClientRect();
      this.hover = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      this.cx = this.drag.cx - dx / this.scale;
      this.cz = this.drag.cz - dy / this.scale;
    });
    window.addEventListener('mouseup', (e) => {
      if (!this.drag) return;
      const moved = this.drag.moved;
      this.drag = null;
      if (moved || !this.isOpen) return;
      const r = this.canvas.getBoundingClientRect();
      this.click(e.clientX - r.left, e.clientY - r.top);
    });
    ctx.bus.on('input:action', ({ action, phase }) => {
      if (action !== 'map' || phase !== 'pressed') return;
      if (this.isOpen) this.close();
      else if (ctx.session.mode === 'play') this.open(null);
    });
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && (e.code === 'Escape' || (e.code === 'KeyM' && ctx.session.mode !== 'menu'))) this.close();
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains('on');
  }

  /** Abre el mapa (opcionalmente resaltando la zona recién escaneada). */
  open(focus: { x: number; z: number; radius: number } | null): void {
    const ctx = this.ctx;
    if (ctx.session.mode !== 'play') return;
    ctx.session.mode = 'menu';
    if (document.pointerLockElement) document.exitPointerLock();
    this.d.map.image.finish();
    const t = ctx.world.require(this.d.playerEntity, 'transform');
    this.cx = focus?.x ?? t.x;
    this.cz = focus?.z ?? t.z;
    this.layer = this.d.map.layerOf(t.x, t.y, t.z);
    this.root.classList.add('on');
    this.resize();
    this.scale = focus ? Math.min(this.canvas.width, this.canvas.height) / (focus.radius * 2.6) : Math.min(this.canvas.width, this.canvas.height) / 1600;
    this.scale = Math.max(this.minScale(), this.scale);
    this.focus = focus ? { ...focus, t: 0 } : null;
    this.selected = null;
    this.why = '';
    this.syncTabs();
    this.ctx.bus.emit('map:open', { open: true });
    const loop = () => {
      if (!this.isOpen) return;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.classList.remove('on');
    cancelAnimationFrame(this.raf);
    if (this.ctx.session.mode === 'menu') this.ctx.session.mode = 'play';
    this.ctx.bus.emit('map:open', { open: false });
    try {
      const r = this.d.canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      // Sin gesto de usuario: el HUD pide hacer clic.
    }
  }

  // ------------------------------------------------------------------ coordenadas

  private minScale(): number {
    return Math.min(this.canvas.width, this.canvas.height) / (this.d.map.fog.worldSize * 1.05);
  }

  private resize(): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  toScreen(x: number, z: number): { x: number; y: number } {
    return { x: this.canvas.width / 2 + (x - this.cx) * this.scale, y: this.canvas.height / 2 + (z - this.cz) * this.scale };
  }

  toWorld(sx: number, sy: number): { x: number; z: number } {
    return { x: this.cx + (sx - this.canvas.width / 2) / this.scale, z: this.cz + (sy - this.canvas.height / 2) / this.scale };
  }

  // ------------------------------------------------------------------ interacción

  private visiblePois(): Poi[] {
    // En la superficie también se ven (más tenues) las islas del cielo que hay encima.
    return this.d.map.pois.filter((p) => (p.layer === this.layer || (this.layer === 'surface' && p.layer === 'sky')) && this.d.map.poiVisible(p));
  }

  click(sx: number, sy: number): void {
    // ¿Un punto de interés?
    let best: Poi | null = null;
    let bestD = 14;
    for (const p of this.visiblePois()) {
      const s = this.toScreen(p.x, p.z);
      const dd = Math.hypot(s.x - sx, s.y - sy);
      if (dd < bestD) {
        best = p;
        bestD = dd;
      }
    }
    if (best) {
      this.selected = best;
      this.why = '';
      this.renderInfo();
      return;
    }
    // ¿Un marcador? Se quita. Si no, se pone uno.
    let mk: MapMarker | null = null;
    for (const m of this.d.map.markers) {
      const s = this.toScreen(m.x, m.z);
      if (Math.hypot(s.x - sx, s.y - sy) < 12) mk = m;
    }
    const w = this.toWorld(sx, sy);
    if (mk) this.d.map.removeMarker(mk);
    else this.d.map.addMarker(w.x, w.z);
    this.selected = null;
    this.renderInfo();
  }

  private renderInfo(): void {
    const p = this.selected;
    if (!p) {
      this.info.style.display = 'none';
      return;
    }
    const can = !!p.travel && (p.unlocked?.() ?? false);
    this.info.style.display = 'block';
    this.info.innerHTML = `<b>${p.name}</b><br><small>${KIND_LABEL[p.kind]}</small>`;
    if (p.travel) {
      const b = document.createElement('button');
      b.textContent = can ? 'Viajar aquí' : p.kind === 'tower' ? 'Actívala para viajar' : 'Visítalo para viajar';
      b.disabled = !can;
      b.onclick = () => {
        const reason = this.d.map.travel(this.ctx, p);
        if (reason) {
          this.why = reason;
          this.renderInfo();
        } else this.close();
      };
      this.info.appendChild(document.createElement('br'));
      this.info.appendChild(b);
    }
    if (this.why) {
      const w = document.createElement('div');
      w.className = 'why';
      w.textContent = this.why;
      this.info.appendChild(w);
    }
  }

  private syncTabs(): void {
    this.tabs.forEach((b, i) => b.classList.toggle('sel', LAYERS[i][0] === this.layer));
    this.renderInfo();
  }

  // ------------------------------------------------------------------ dibujo

  private updateFog(): void {
    const fog = this.d.map.fog;
    if (fog.version === this.fogVersion) return;
    this.fogVersion = fog.version;
    const data = this.fogImage.data;
    for (let i = 0; i < fog.cells.length; i++) {
      const v = fog.cells[i];
      data[i * 4] = 18;
      data[i * 4 + 1] = 40;
      data[i * 4 + 2] = 56;
      data[i * 4 + 3] = 255 - v;
    }
    this.fogCtx.putImageData(this.fogImage, 0, 0);
  }

  draw(): void {
    this.resize();
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const map = this.d.map;
    const half = map.fog.worldSize / 2;
    g.fillStyle = '#07131c';
    g.fillRect(0, 0, W, H);
    const tl = this.toScreen(-half, -half);
    const size = map.fog.worldSize * this.scale;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.globalAlpha = this.layer === 'surface' ? 1 : this.layer === 'sky' ? 0.45 : 0.25;
    g.drawImage(map.image.canvas, tl.x, tl.y, size, size);
    g.globalAlpha = 1;
    if (this.layer === 'sky') {
      g.fillStyle = 'rgba(150,200,255,0.18)';
      g.fillRect(tl.x, tl.y, size, size);
    } else if (this.layer === 'underground') {
      g.fillStyle = 'rgba(14,8,30,0.7)';
      g.fillRect(tl.x, tl.y, size, size);
    }
    this.updateFog();
    g.drawImage(this.fogCanvas, tl.x, tl.y, size, size);

    // Rejilla suave (1 km).
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1;
    for (let k = -half; k <= half; k += 1000) {
      const a = this.toScreen(k, -half);
      const b = this.toScreen(-half, k);
      g.beginPath();
      g.moveTo(a.x, tl.y);
      g.lineTo(a.x, tl.y + size);
      g.moveTo(tl.x, b.y);
      g.lineTo(tl.x + size, b.y);
      g.stroke();
    }

    // Zona recién escaneada.
    if (this.focus) {
      this.focus.t += 1 / 60;
      const f = this.focus;
      const k = Math.min(1, f.t / 2.2);
      const s = this.toScreen(f.x, f.z);
      g.strokeStyle = `rgba(31,214,255,${0.9 * (1 - k)})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(s.x, s.y, f.radius * this.scale * (0.4 + 0.7 * k), 0, Math.PI * 2);
      g.stroke();
      if (k >= 1) this.focus = null;
    }

    // Nombres de región: en el centro de lo descubierto de cada región.
    g.textAlign = 'center';
    g.font = `500 ${Math.max(11, Math.min(18, this.scale * 40))}px Segoe UI, sans-serif`;
    for (const l of this.regionLabels()) {
      if (l.layer !== this.layer) continue;
      const s = this.toScreen(l.x, l.z);
      g.fillStyle = 'rgba(234,247,255,0.6)';
      g.fillText(l.name.toUpperCase(), s.x, s.y);
    }

    // Puntos de interés.
    for (const p of this.visiblePois()) this.drawPoi(p, p === this.selected);
    // Marcadores.
    for (const m of map.markers) {
      const s = this.toScreen(m.x, m.z);
      g.fillStyle = m.color;
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.arc(s.x, s.y - 12, 6, Math.PI * 0.75, Math.PI * 2.25);
      g.closePath();
      g.fill();
    }
    // Jugador.
    const t = this.ctx.world.require(this.d.playerEntity, 'transform');
    const s = this.toScreen(t.x, t.z);
    g.save();
    g.translate(s.x, s.y);
    g.rotate(-t.rotY + Math.PI);
    g.fillStyle = '#ffd23a';
    g.strokeStyle = '#2a1e00';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(7, 8);
    g.lineTo(0, 4);
    g.lineTo(-7, 8);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();

    // Cabecera: región bajo el cursor y progreso.
    const hv = this.hover;
    const regionName = hv ? (map.fog.at(hv.x, hv.z) > 0.3 ? map.regionAt(hv.x, hv.z, this.layer) : '???') : null;
    this.region.textContent = regionName ?? '';
    const active = map.towers.filter((x) => x.activated).length;
    this.stats.textContent = `Torres activadas: ${active}/${map.towers.length} · Mapa descubierto: ${(map.fog.fraction * 100).toFixed(1)} %`;
  }

  private labels: { name: string; layer: MapLayer; x: number; z: number }[] = [];
  private labelsVersion = -1;

  /** Centro de las celdas descubiertas de cada región (se recalcula al cambiar la niebla). */
  private regionLabels(): { name: string; layer: MapLayer; x: number; z: number }[] {
    const fog = this.d.map.fog;
    if (this.labelsVersion === fog.version) return this.labels;
    this.labelsVersion = fog.version;
    const res = fog.resolution;
    const cell = fog.cellSize;
    const half = fog.worldSize / 2;
    const acc = this.ctx.data.regions.regions.map((r) => ({ r, sx: 0, sz: 0, n: 0 }));
    for (let cz = 0; cz < res; cz += 2) {
      for (let cx = 0; cx < res; cx += 2) {
        if (fog.cells[cz * res + cx] < 128) continue;
        const x = (cx + 0.5) * cell - half;
        const z = (cz + 0.5) * cell - half;
        // Primera región de superficie que lo contiene (las más concretas van antes en los datos).
        const a = acc.find((q) => q.r.layer === 'surface' && x >= q.r.bounds[0] && x <= q.r.bounds[2] && z >= q.r.bounds[1] && z <= q.r.bounds[3]);
        if (!a) continue;
        a.sx += x;
        a.sz += z;
        a.n++;
      }
    }
    this.labels = acc.filter((a) => a.n > 6).map((a) => ({ name: a.r.name, layer: a.r.layer, x: a.sx / a.n, z: a.sz / a.n }));
    // Las capas de cielo y subterráneo rotulan sus regiones en su centro.
    for (const r of this.ctx.data.regions.regions) {
      if (r.layer === 'surface') continue;
      const x = Math.max(-half, Math.min(half, (r.bounds[0] + r.bounds[2]) / 2));
      const z = Math.max(-half, Math.min(half, (r.bounds[1] + r.bounds[3]) / 2));
      if (fog.at(x, z) > 0.5) this.labels.push({ name: r.name, layer: r.layer, x, z });
    }
    return this.labels;
  }

  private drawPoi(p: Poi, selected: boolean): void {
    const g = this.g;
    const s = this.toScreen(p.x, p.z);
    const unlocked = p.unlocked?.() ?? false;
    g.save();
    if (p.layer !== this.layer) g.globalAlpha = 0.55;
    g.translate(s.x, s.y);
    g.lineWidth = 2;
    switch (p.kind) {
      case 'tower':
        g.beginPath();
        g.moveTo(0, -12);
        g.lineTo(6, 8);
        g.lineTo(-6, 8);
        g.closePath();
        g.fillStyle = unlocked ? '#1fd6ff' : 'rgba(31,214,255,0.15)';
        g.strokeStyle = '#1fd6ff';
        g.fill();
        g.stroke();
        break;
      case 'temple':
        g.rotate(Math.PI / 4);
        g.fillStyle = unlocked ? '#ffb347' : 'rgba(255,179,71,0.35)';
        g.strokeStyle = '#1fd6ff';
        g.fillRect(-6, -6, 12, 12);
        g.strokeRect(-6, -6, 12, 12);
        break;
      case 'camp':
        g.fillStyle = '#ff5b4b';
        g.beginPath();
        g.moveTo(0, -8);
        g.lineTo(8, 6);
        g.lineTo(-8, 6);
        g.closePath();
        g.fill();
        break;
      case 'island':
        g.fillStyle = '#e8f6ff';
        g.beginPath();
        g.ellipse(0, 0, 10, 6, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#1fd6ff';
        g.stroke();
        break;
      case 'underground':
      case 'cave':
        g.fillStyle = p.kind === 'underground' ? '#b48cff' : '#6a5440';
        g.beginPath();
        g.arc(0, 0, 7, Math.PI, 0);
        g.lineTo(7, 6);
        g.lineTo(-7, 6);
        g.closePath();
        g.fill();
        break;
      case 'settlement':
        g.fillStyle = '#f2e3c2';
        g.fillRect(-6, -2, 12, 9);
        g.beginPath();
        g.moveTo(-8, -2);
        g.lineTo(0, -9);
        g.lineTo(8, -2);
        g.closePath();
        g.fill();
        break;
      default:
        g.fillStyle = p.kind === 'station' ? '#7ee3c0' : '#a08060';
        g.fillRect(-5, -5, 10, 10);
    }
    g.restore();
    if (selected || this.scale > 0.35) {
      g.fillStyle = selected ? '#ffd23a' : 'rgba(234,247,255,0.8)';
      g.font = `${selected ? 600 : 400} 12px Segoe UI, sans-serif`;
      g.textAlign = 'center';
      g.fillText(p.name, s.x, s.y + 22);
    }
  }
}
