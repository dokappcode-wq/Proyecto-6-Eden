import type { GameContext, System } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import { clamp } from '../core/math';

const CSS = /* css */ `
#phud { position: fixed; inset: 0; pointer-events: none; z-index: 6; font-family: 'Segoe UI', system-ui, sans-serif; color: #eaf7ff; }
#phud .hearts { position: absolute; top: 14px; left: 16px; display: flex; flex-wrap: wrap; gap: 4px; max-width: 280px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
#phud .hearts svg { width: 24px; height: 22px; }
#phud .hearts.hit { animation: phud-shake .35s; }
@keyframes phud-shake { 0%,100% { transform: none } 25% { transform: translateX(-4px) } 50% { transform: translateX(4px) } 75% { transform: translateX(-2px) } }
#phud .wheel { position: absolute; width: 46px; height: 46px; margin: -23px 0 0 -23px; transition: opacity .35s; }
#phud .wheel circle { fill: none; stroke-linecap: round; }
#phud .air { position: absolute; left: 50%; bottom: 96px; width: 180px; height: 6px; margin-left: -90px; border-radius: 3px; background: rgba(5,18,28,.6); overflow: hidden; display: none; }
#phud .air i { display: block; height: 100%; background: #8fe9ff; }
#phud .flight { position: absolute; right: 18px; bottom: 26px; padding: 8px 12px; border-radius: 8px; background: rgba(5,18,28,.55); font-size: 13px; line-height: 1.6; display: none; min-width: 150px; }
#phud .flight b { color: #8fe9ff; font-weight: 600; }
#phud .flight .arrow { display: inline-block; width: 16px; text-align: center; color: #bff4ff; }
#phud .flight .thermal { color: #1fd6ff; font-weight: 600; }
#phud .vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 50%, rgba(170,0,0,.55)); opacity: 0; transition: opacity .5s; }
#phud .vignette.on { opacity: 1; transition: none; }
#phud .banner { position: absolute; left: 50%; top: 30%; transform: translateX(-50%); text-align: center; opacity: 0; transition: opacity .6s; }
#phud .banner.on { opacity: 1; }
#phud .banner h3 { margin: 0; font-size: 30px; font-weight: 300; letter-spacing: .12em; text-shadow: 0 0 24px rgba(31,214,255,.8); }
#phud .banner p { margin: 8px 0 0; font-size: 15px; opacity: .9; }
#phud .banner kbd, #phud .flight kbd { display: inline-block; padding: 0 6px; border-radius: 4px; background: #eaf7ff; color: #06202c; font: 700 13px/18px system-ui; }
#phud .fade { position: absolute; inset: 0; background: #02070b; opacity: 0; display: flex; align-items: center; justify-content: center; font-size: 26px; letter-spacing: .2em; font-weight: 300; }
`;

export interface PlayerHudSources {
  /** Punto de pantalla (px) donde dibujar la rueda de stamina, o null si no se ve. */
  wheelAnchor(): { x: number; y: number } | null;
  /** Altura sobre el suelo y aire (para los indicadores de vuelo). */
  flight(): { height: number; windX: number; windZ: number; thermal: boolean; heading: number } | null;
  keyLabel(action: string): string;
  flightIndicators: boolean;
}

/**
 * HUD del jugador: corazones, rueda de stamina sobre el personaje (cian al planear, roja agotado),
 * aire al bucear, indicadores de vuelo (altura, viento, corriente), daño, avisos y fundidos.
 */
export class PlayerHud implements System {
  readonly name = 'player-hud';
  private readonly hearts: HTMLDivElement;
  private readonly wheel: HTMLDivElement;
  private readonly air: HTMLDivElement;
  private readonly airBar: HTMLElement;
  private readonly flightEl: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly fade: HTMLDivElement;
  private lastHearts = '';
  private wheelIdle = 0;
  private bannerTimer = 0;
  private fadeFrom = 0;
  private fadeTo = 0;
  private fadeT = 1;
  private fadeSeconds = 0.5;

  constructor(
    ctx: GameContext,
    private readonly playerEntity: Entity,
    private readonly src: PlayerHudSources,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const root = div(document.body, '');
    root.id = 'phud';
    this.vignette = div(root, 'vignette');
    this.hearts = div(root, 'hearts');
    this.wheel = div(root, 'wheel');
    this.air = div(root, 'air');
    this.airBar = document.createElement('i');
    this.air.appendChild(this.airBar);
    this.flightEl = div(root, 'flight');
    this.banner = div(root, 'banner');
    this.fade = div(root, 'fade');

    ctx.bus.on('player:damaged', () => {
      this.vignette.classList.add('on');
      this.hearts.classList.remove('hit');
      void this.hearts.offsetWidth;
      this.hearts.classList.add('hit');
      setTimeout(() => this.vignette.classList.remove('on'), 120);
    });
    ctx.bus.on('player:obtained', () =>
      this.showBanner('Planeador ancestral', `En el aire, pulsa <kbd>${this.src.keyLabel('glider')}</kbd> para desplegarlo · <kbd>W</kbd> picado · <kbd>S</kbd> frenar`),
    );
    ctx.bus.on('tower:activated', () => this.showBanner('Torre activada', 'Una de las runas del muro del sur se ha encendido'));
    ctx.bus.on('temple:complete', () => this.showBanner('Prueba superada', 'La piedra ancestral reconoce tu paso'));
    ctx.bus.on('screen:fade', ({ to, seconds, text }) => {
      this.fadeFrom = this.currentFade();
      this.fadeTo = to === 'black' ? 1 : 0;
      this.fadeSeconds = Math.max(0.01, seconds);
      this.fadeT = 0;
      this.fade.textContent = text ?? '';
    });
  }

  render(ctx: GameContext): void {
    const dt = ctx.time.frameDt;
    const play = ctx.session.mode === 'play';
    this.hearts.style.display = play ? 'flex' : 'none';

    // Fundido.
    if (this.fadeT < 1) {
      this.fadeT = Math.min(1, this.fadeT + dt / this.fadeSeconds);
      this.fade.style.opacity = String(this.currentFade());
      if (this.fadeT >= 1 && this.fadeTo === 0) setTimeout(() => (this.fade.textContent = ''), 1200);
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('on');
    }
    if (!play) {
      this.wheel.style.opacity = '0';
      this.flightEl.style.display = 'none';
      return;
    }

    const p = ctx.world.require(this.playerEntity, 'player');
    const ch = ctx.world.require(this.playerEntity, 'character');

    // Corazones (cuartos).
    const key = `${p.health.fragments}/${p.health.maxFragments}`;
    if (key !== this.lastHearts) {
      this.lastHearts = key;
      const n = Math.ceil(p.health.maxFragments / 4);
      let html = '';
      for (let i = 0; i < n; i++) html += heartSvg(clamp(p.health.fragments - i * 4, 0, 4));
      this.hearts.innerHTML = html;
    }

    // Rueda de stamina: visible al gastar, se oculta cuando lleva un rato llena.
    const st = ch.stamina;
    const full = st.current >= st.max - 0.01 && !st.exhausted;
    this.wheelIdle = full ? this.wheelIdle + dt : 0;
    const anchor = this.src.wheelAnchor();
    const show = anchor !== null && this.wheelIdle < 1.2 && p.control !== 'capsule';
    this.wheel.style.opacity = show ? '1' : '0';
    if (anchor) {
      this.wheel.style.left = `${anchor.x}px`;
      this.wheel.style.top = `${anchor.y}px`;
      const color = st.exhausted ? '#ff4b4b' : ch.mode === 'glide' || st.lastSource === 'glide' ? '#1fd6ff' : '#7ee36b';
      const k = st.current / st.max;
      const c = 2 * Math.PI * 17;
      this.wheel.innerHTML =
        `<svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="17" stroke="rgba(5,18,28,.55)" stroke-width="7"/>` +
        `<circle cx="23" cy="23" r="17" stroke="${color}" stroke-width="5" stroke-dasharray="${(k * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 23 23)"/></svg>`;
    }

    // Aire al bucear.
    const showAir = ch.swimming && (ch.underwater || ch.air < this.airMax(ctx) - 0.05);
    this.air.style.display = showAir ? 'block' : 'none';
    if (showAir) this.airBar.style.width = `${(ch.air / this.airMax(ctx)) * 100}%`;

    // Indicadores de vuelo.
    const f = ch.mode === 'glide' && this.src.flightIndicators ? this.src.flight() : null;
    this.flightEl.style.display = f ? 'block' : 'none';
    if (f) {
      const windSpeed = Math.hypot(f.windX, f.windZ);
      // Flecha relativa a la vista: 0° = de frente.
      const windDir = Math.atan2(f.windX, f.windZ) - f.heading;
      const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
      const idx = ((Math.round((-windDir / (Math.PI * 2)) * 8) % 8) + 8) % 8;
      this.flightEl.innerHTML =
        `<div>Altura <b>${f.height.toFixed(0)} m</b></div>` +
        `<div>Viento <span class="arrow">${windSpeed > 0.2 ? arrows[idx] : '·'}</span> <b>${windSpeed.toFixed(1)} m/s</b></div>` +
        (f.thermal ? `<div class="thermal">↑ Corriente ascendente</div>` : '');
    }
  }

  private airMax(ctx: GameContext): number {
    return ctx.data.player.swim.airSeconds;
  }

  private currentFade(): number {
    const k = this.fadeT * this.fadeT * (3 - 2 * this.fadeT);
    return this.fadeFrom + (this.fadeTo - this.fadeFrom) * k;
  }

  private showBanner(title: string, html: string): void {
    this.banner.innerHTML = `<h3>${title}</h3><p>${html}</p>`;
    this.banner.classList.add('on');
    this.bannerTimer = 5;
  }
}

function heartSvg(quarters: number): string {
  // Corazón con relleno por cuartos (recorte por ángulo).
  const fill = quarters / 4;
  const id = `h${Math.random().toString(36).slice(2, 8)}`;
  const angle = fill * 360;
  const rad = ((angle - 90) * Math.PI) / 180;
  const large = angle > 180 ? 1 : 0;
  const x = 12 + Math.cos(rad) * 30;
  const y = 11 + Math.sin(rad) * 30;
  const clip = fill >= 1 ? `<rect x="0" y="0" width="24" height="22"/>` : fill <= 0 ? '' : `<path d="M12 11 L12 -19 A30 30 0 ${large} 1 ${x.toFixed(1)} ${y.toFixed(1)} Z"/>`;
  const heart = 'M12 20 C4 14 1 10 1 6.5 C1 3.5 3.5 1 6.5 1 C8.6 1 10.6 2.2 12 4 C13.4 2.2 15.4 1 17.5 1 C20.5 1 23 3.5 23 6.5 C23 10 20 14 12 20 Z';
  return (
    `<svg viewBox="0 0 24 22"><defs><clipPath id="${id}">${clip}</clipPath></defs>` +
    `<path d="${heart}" fill="rgba(5,18,28,.55)" stroke="#f6d7d7" stroke-width="1.2"/>` +
    `<path d="${heart}" fill="#ff5b6e" clip-path="url(#${id})"/></svg>`
  );
}

function div(parent: HTMLElement, className: string): HTMLDivElement {
  const d = document.createElement('div');
  if (className) d.className = className;
  parent.appendChild(d);
  return d;
}
