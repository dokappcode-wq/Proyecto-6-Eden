import type { GameContext, System } from '../core/Game';
import type { MobilityConfig } from '../data/schemas';
import type { MobilitySystem } from '../systems/MobilitySystem';
import type { MountSystem } from '../systems/MountSystem';

const CSS = /* css */ `
#mhud { position: fixed; inset: 0; pointer-events: none; z-index: 7; font-family: 'Segoe UI', system-ui, sans-serif; color: #eaf7ff; }
#mhud .runes { position: absolute; right: 18px; bottom: 18px; display: flex; gap: 5px; }
#mhud .rune { width: 54px; padding: 5px 4px; border-radius: 7px; background: rgba(5,18,28,.55); font-size: 10px; text-align: center; position: relative; overflow: hidden; border: 1px solid transparent; }
#mhud .rune b { display: block; font-size: 15px; color: #8fe9ff; }
#mhud .rune.sel { border-color: #1fd6ff; box-shadow: 0 0 10px rgba(31,214,255,.5); }
#mhud .rune.off { opacity: .3; }
#mhud .rune i { position: absolute; left: 0; bottom: 0; height: 3px; background: #ffd34a; }
#mhud .tools { position: absolute; right: 18px; bottom: 80px; display: flex; gap: 6px; font-size: 11px; }
#mhud .tools span { padding: 3px 8px; border-radius: 5px; background: rgba(5,18,28,.55); }
#mhud .tools span.cd { opacity: .45; }
#mhud .tools b { color: #8fe9ff; margin-right: 4px; }
#mhud .mark { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border: 2px solid #7ee3c0; transform: rotate(45deg); display: none; box-shadow: 0 0 8px rgba(126,227,192,.8); }
#mhud .ride { position: absolute; left: 50%; bottom: 150px; transform: translateX(-50%); padding: 6px 12px; border-radius: 8px; background: rgba(5,18,28,.6); font-size: 12px; text-align: center; display: none; min-width: 180px; }
#mhud .ride .pips { margin-top: 4px; letter-spacing: 3px; font-size: 14px; color: #ffd34a; }
#mhud .ride .tame { margin-top: 5px; height: 7px; border-radius: 4px; background: rgba(255,255,255,.15); overflow: hidden; }
#mhud .ride .tame i { display: block; height: 100%; background: linear-gradient(90deg,#ffb347,#7ee36b); }
`;

/** HUD de movilidad: runas (1-4), herramientas, objetivo del garfio y panel de montura/balsa. */
export class MobilityHud implements System {
  readonly name = 'mobility-hud';
  private readonly runes: HTMLDivElement;
  private readonly tools: HTMLDivElement;
  private readonly mark: HTMLDivElement;
  private readonly ride: HTMLDivElement;
  private last = '';
  private lastRide = '';

  constructor(
    private readonly cfg: MobilityConfig,
    private readonly mobility: MobilitySystem,
    private readonly mounts: MountSystem,
    private readonly project: (x: number, y: number, z: number) => { x: number; y: number } | null,
    private readonly keyLabel: (action: string) => string,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = 'mhud';
    document.body.appendChild(root);
    const mk = (cls: string) => {
      const d = document.createElement('div');
      d.className = cls;
      root.appendChild(d);
      return d;
    };
    this.runes = mk('runes');
    this.tools = mk('tools');
    this.mark = mk('mark');
    this.ride = mk('ride');
  }

  render(ctx: GameContext): void {
    const playing = ctx.session.mode === 'play';
    const m = this.mobility;
    // Runas y herramientas (solo lo conseguido).
    const owned = playing ? m.ownedRunes(ctx) : [];
    const has = (id: string) => playing && m.has(ctx, id);
    const tools: string[] = [];
    if (has(this.cfg.grapple.item)) tools.push(`<span><b>${this.keyLabel('grapple')}</b>Garfio</span>`);
    if (has(this.cfg.boots.item)) tools.push(`<span class="${m.boots.charges > 0 ? '' : 'cd'}"><b>${this.keyLabel('boots')}</b>Botas ${'●'.repeat(m.boots.charges)}</span>`);
    if (has(this.cfg.windBomb.item)) tools.push(`<span class="${m.windCooldown > 0 ? 'cd' : ''}"><b>${this.keyLabel('wind_bomb')}</b>Vendaval${m.windCooldown > 0 ? ` ${Math.ceil(m.windCooldown)}s` : ''}</span>`);
    if (playing) tools.push(`<span><b>${this.keyLabel('surf')}</b>Surf</span>`);
    const runeHtml = owned.length
      ? this.cfg.runes
          .map((r, i) => {
            const own = owned.includes(r);
            const cd = m.runeCooldown[r.id];
            const frac = r.cooldown > 0 ? cd / r.cooldown : 0;
            const active = (r.id === 'magnet' && m.magnetBody) || (r.id === 'bomb' && m.bombBody) ? ' ●' : '';
            return `<div class="rune ${i === m.runeIndex ? 'sel' : ''} ${own ? '' : 'off'}"><b>${i + 1}</b>${own ? r.name : '—'}${active}<i style="width:${(frac * 100).toFixed(0)}%"></i></div>`;
          })
          .join('') + `<div class="rune"><b>${this.keyLabel('rune_use')}</b>usar</div>`
      : '';
    const key = runeHtml + '|' + tools.join('');
    if (key !== this.last) {
      this.last = key;
      this.runes.innerHTML = runeHtml;
      this.tools.innerHTML = tools.join('');
    }

    // Marcador del garfio.
    const mk = playing ? m.grappleMarker : null;
    const p = mk ? this.project(mk.x, mk.y, mk.z) : null;
    this.mark.style.display = p ? 'block' : 'none';
    if (p) {
      this.mark.style.left = `${p.x}px`;
      this.mark.style.top = `${p.y}px`;
    }

    // Montura o balsa.
    let html = '';
    const mount = this.mounts.active;
    if (playing && mount) {
      const tame = this.mounts.taming;
      if (tame) html = `Domando: ${mount.name}<div class="tame"><i style="width:${Math.min(100, tame.progress * 100).toFixed(0)}%"></i></div><small>Pulsa ${this.keyLabel('interact')} para calmarlo</small>`;
      else html = `${mount.name}<div class="pips">${'◆'.repeat(mount.motion.spurs)}${'◇'.repeat(mount.def.spurs - mount.motion.spurs)}</div><small>${this.keyLabel('sprint')} espuela · ${this.keyLabel('crouch')} bajar</small>`;
    }
    const raft = playing ? this.mounts.activeRaft : null;
    if (raft) html = `Balsa · vela ${raft.s.sail ? 'izada' : 'arriada'}<br><small>${this.keyLabel('sprint')} vela · ${this.keyLabel('move_forward')} remar · ${this.keyLabel('jump')} saltar</small>`;
    if (html !== this.lastRide) {
      this.lastRide = html;
      this.ride.innerHTML = html;
      this.ride.style.display = html ? 'block' : 'none';
    }
  }
}
