import type { GameContext, System } from '../core/Game';

const CSS = /* css */ `
#hud { position: fixed; inset: 0; pointer-events: none; font-family: 'Segoe UI', system-ui, sans-serif; color: #eaf7ff; z-index: 5; user-select: none; }
#hud .compass { position: absolute; top: 14px; left: 50%; width: min(420px, calc(100vw - 32px)); height: 30px; transform: translateX(-50%);
  overflow: hidden; border-radius: 15px; background: linear-gradient(90deg, transparent, rgba(5,18,28,.55) 18%, rgba(5,18,28,.55) 82%, transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent); mask-image: linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent); }
#hud .compass-strip { position: absolute; top: 0; left: 50%; height: 100%; }
#hud .compass-strip span { position: absolute; top: 6px; transform: translateX(-50%); font-size: 13px; letter-spacing: .05em; opacity: .75; }
#hud .compass-strip span.major { font-weight: 700; font-size: 15px; opacity: 1; top: 4px; }
#hud .compass-strip i { position: absolute; top: 22px; width: 1px; height: 6px; background: rgba(234,247,255,.5); }
#hud .compass-center { position: absolute; left: 50%; bottom: 0; width: 2px; height: 8px; background: #1fd6ff; transform: translateX(-50%); }
#hud .compass-marker { position: absolute; top: 9px; width: 10px; height: 10px; margin-left: -5px; transform: rotate(45deg); background: #1fd6ff; box-shadow: 0 0 8px #1fd6ff; }
#hud .prompt { position: absolute; left: 50%; bottom: 23%; transform: translateX(-50%); padding: 6px 14px; border-radius: 20px;
  background: rgba(5,18,28,.7); border: 1px solid rgba(31,214,255,.5); font-size: 15px; opacity: 0; transition: opacity .15s; white-space: nowrap; }
#hud .prompt.on { opacity: 1; }
#hud kbd, #screen kbd { display: inline-block; min-width: 18px; padding: 1px 6px; margin-right: 8px; border-radius: 4px; background: #eaf7ff; color: #06202c; font: 700 13px/18px system-ui; text-align: center; }
#hud .hint { position: absolute; left: 50%; bottom: 32px; transform: translateX(-50%); max-width: min(620px, calc(100vw - 32px)); text-align: center;
  font-size: 15px; line-height: 1.4; text-shadow: 0 1px 3px rgba(0,0,0,.8); opacity: 0; transition: opacity .6s; }
#hud .hint.on { opacity: .95; }
#hud .hint b { display: block; font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: #8fe9ff; margin-bottom: 2px; }
#hud .toast { position: absolute; left: 50%; top: 60px; transform: translate(-50%, -8px); padding: 8px 18px; border-radius: 6px; font-size: 15px;
  background: rgba(5,18,28,.75); border-left: 3px solid #1fd6ff; opacity: 0; transition: opacity .35s, transform .35s; }
#hud .toast.on { opacity: 1; transform: translate(-50%, 0); }
#hud .panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(520px, calc(100vw - 32px)); padding: 22px 26px;
  border-radius: 10px; background: rgba(4,16,24,.88); border: 1px solid rgba(31,214,255,.55); box-shadow: 0 0 40px rgba(31,214,255,.18); display: none; }
#hud .panel.on { display: block; }
#hud .panel h2 { margin: 0 0 10px; font-size: 18px; color: #8fe9ff; font-weight: 600; letter-spacing: .04em; }
#hud .panel p { margin: 0 0 8px; font-size: 15px; line-height: 1.55; }
#hud .panel small { display: block; margin-top: 12px; opacity: .65; }
#hud .lock { position: absolute; left: 50%; top: 42%; transform: translateX(-50%); padding: 8px 16px; border-radius: 6px; background: rgba(5,18,28,.7); font-size: 14px; display: none; }
#hud .lock.on { display: block; }
#hud .fade { position: absolute; inset: 0; background: #02070b; opacity: 1; transition: opacity 1.2s; }
#hud .fade.off { opacity: 0; }
#screen { position: fixed; inset: 0; z-index: 20; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px;
  font-family: 'Segoe UI', system-ui, sans-serif; color: #eaf7ff; background: radial-gradient(ellipse at center, rgba(2,10,16,.15), rgba(2,10,16,.75)); }
#screen h1 { margin: 0; font-size: clamp(36px, 7vw, 76px); font-weight: 300; letter-spacing: .32em; text-indent: .32em; text-shadow: 0 0 30px rgba(31,214,255,.6); }
#screen h1 + p { margin: -10px 0 18px; letter-spacing: .5em; text-indent: .5em; font-size: 14px; color: #8fe9ff; text-transform: uppercase; }
#screen button { pointer-events: auto; min-width: 220px; padding: 12px 24px; border-radius: 26px; border: 1px solid rgba(31,214,255,.7);
  background: rgba(4,16,24,.6); color: #eaf7ff; font-size: 16px; letter-spacing: .08em; cursor: pointer; transition: background .2s, box-shadow .2s; }
#screen button:hover, #screen button:focus-visible { background: rgba(31,214,255,.22); box-shadow: 0 0 20px rgba(31,214,255,.4); outline: none; }
#screen .note { font-size: 13px; opacity: .7; max-width: 520px; text-align: center; line-height: 1.5; padding: 0 16px; }
#screen.hidden { display: none; }
`;

export interface CompassMarker {
  x: number;
  z: number;
  /** Color del rombo (cian por defecto). */
  color?: string;
}

/**
 * HUD en DOM: brújula con marcadores, aviso de interacción, pista del tutorial,
 * notificaciones, panel de lectura, pantalla de título y aviso de "clic para mirar".
 */
export class Hud implements System {
  readonly name = 'hud';
  private readonly root: HTMLDivElement;
  private readonly strip: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly lock: HTMLDivElement;
  private readonly fade: HTMLDivElement;
  private readonly screen: HTMLDivElement;
  private readonly markers: { marker: CompassMarker; el: HTMLElement }[] = [];
  private toastTimer = 0;
  private hintTimer = 0;
  private readonly pxPerDeg = 2.2;

  constructor(
    ctx: GameContext,
    private readonly getHeading: () => number,
    private readonly getPosition: () => { x: number; z: number },
    private readonly isPointerLocked: () => boolean,
    private readonly keyLabel: (action: string) => string,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = el('div', document.body, '', 'hud');
    const compass = el('div', this.root, 'compass');
    this.strip = el('div', compass, 'compass-strip');
    el('div', compass, 'compass-center');
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    for (let rep = -1; rep <= 1; rep++) {
      for (let deg = 0; deg < 360; deg += 15) {
        const x = (deg + rep * 360) * this.pxPerDeg;
        if (deg % 45 === 0) {
          const s = el('span', this.strip, deg % 90 === 0 ? 'major' : '');
          s.textContent = labels[deg / 45];
          s.style.left = `${x}px`;
        } else {
          const t = el('i', this.strip);
          t.style.left = `${x}px`;
        }
      }
    }
    this.prompt = el('div', this.root, 'prompt');
    this.hint = el('div', this.root, 'hint');
    this.toast = el('div', this.root, 'toast');
    this.panel = el('div', this.root, 'panel');
    this.lock = el('div', this.root, 'lock');
    this.lock.textContent = 'Haz clic para controlar la cámara';
    this.fade = el('div', this.root, 'fade');
    this.screen = el('div', document.body, '', 'screen');
    this.showLoading();

    ctx.bus.on('interaction:focus', (f) => {
      if (f) this.prompt.innerHTML = `<kbd>${esc(this.keyLabel('interact'))}</kbd>${esc(f.prompt)}`;
      this.prompt.classList.toggle('on', f !== null);
    });
    ctx.bus.on('tutorial:hint', ({ title, text }) => {
      this.hint.innerHTML = title ? `<b>${esc(title)}</b>${esc(text)}` : esc(text);
      this.hint.classList.add('on');
      // La pista libre se retira sola: el entorno debe guiar, no el texto.
      this.hintTimer = title ? 0 : 14;
    });
    ctx.bus.on('tutorial:step_completed', ({ title }) => this.showToast(`✓ ${title}`));
    ctx.bus.on('game:saved', () => this.showToast('Partida guardada'));
    ctx.bus.on('valley:gate_opened', () => this.showToast('La salida del valle se ha abierto'));
    ctx.bus.on('player:respawned', () => this.showToast('Has vuelto a la cápsula'));
    ctx.bus.on('inscription:open', ({ title, text }) => {
      this.panel.innerHTML =
        `<h2>${esc(title)}</h2>` + text.split('\n').map((l) => `<p>${esc(l)}</p>`).join('') + `<small><kbd>${esc(this.keyLabel('interact'))}</kbd>Cerrar</small>`;
      this.panel.classList.add('on');
    });
    ctx.bus.on('inscription:close', () => this.panel.classList.remove('on'));
  }

  addMarker(marker: CompassMarker): void {
    const e = el('div', this.strip.parentElement as HTMLElement, 'compass-marker');
    if (marker.color) {
      e.style.background = marker.color;
      e.style.boxShadow = `0 0 8px ${marker.color}`;
    }
    this.markers.push({ marker, el: e });
  }

  removeMarker(marker: CompassMarker): void {
    const i = this.markers.findIndex((m) => m.marker === marker);
    if (i < 0) return;
    this.markers[i].el.remove();
    this.markers.splice(i, 1);
  }

  showLoading(): void {
    this.screen.classList.remove('hidden');
    this.screen.innerHTML = `<h1>EDEN</h1><p>The Lost World</p><div class="note">Generando el mundo…</div>`;
  }

  /** Pantalla de título; resuelve con la elección del jugador. */
  showTitle(canContinue: boolean): Promise<'new' | 'continue'> {
    this.screen.classList.remove('hidden');
    this.screen.innerHTML = `<h1>EDEN</h1><p>The Lost World</p>`;
    this.fadeOut();
    return new Promise((resolve) => {
      const make = (label: string, value: 'new' | 'continue') => {
        const b = el('button', this.screen) as unknown as HTMLButtonElement;
        b.textContent = label;
        b.addEventListener('click', () => resolve(value), { once: true });
        return b;
      };
      const first = canContinue ? make('Continuar', 'continue') : null;
      const fresh = make('Nueva partida', 'new');
      const note = el('div', this.screen, 'note');
      note.innerHTML =
        `Mover <kbd>${['move_forward', 'move_left', 'move_back', 'move_right'].map((a) => esc(this.keyLabel(a))).join('')}</kbd> · ` +
        `Saltar <kbd>${esc(this.keyLabel('jump'))}</kbd> · Interactuar <kbd>${esc(this.keyLabel('interact'))}</kbd> · ` +
        `Andar <kbd>${esc(this.keyLabel('walk'))}</kbd> · Agacharse <kbd>${esc(this.keyLabel('crouch'))}</kbd> · Debug <kbd>F3</kbd>`;
      (first ?? fresh).focus();
    });
  }

  hideScreen(): void {
    this.screen.classList.add('hidden');
  }

  fadeOut(): void {
    this.fade.classList.add('off');
  }

  render(ctx: GameContext): void {
    const dt = ctx.time.frameDt;
    const heading = this.getHeading();
    this.strip.style.transform = `translateX(${-heading * this.pxPerDeg}px)`;

    const pos = this.getPosition();
    const width = (this.strip.parentElement as HTMLElement).clientWidth;
    for (const m of this.markers) {
      const bearing = (Math.atan2(m.marker.x - pos.x, -(m.marker.z - pos.z)) * 180) / Math.PI;
      let rel = bearing - heading;
      rel = ((((rel + 180) % 360) + 360) % 360) - 180;
      const x = width / 2 + rel * this.pxPerDeg;
      m.el.style.left = `${x}px`;
      m.el.style.display = Math.abs(rel) < 85 ? 'block' : 'none';
    }

    this.lock.classList.toggle('on', ctx.session.mode === 'play' && !this.isPointerLocked());

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('on');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hint.classList.remove('on');
    }
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('on');
    this.toastTimer = 2.6;
  }
}

function el(tag: string, parent: HTMLElement, className = '', id = ''): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  if (className) e.className = className;
  if (id) e.id = id;
  parent.appendChild(e);
  return e;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
