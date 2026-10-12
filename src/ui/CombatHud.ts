import type { Catalog } from '../combat/inventory';
import { equipped } from '../combat/inventory';
import type { GameContext, System } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import type { CombatSystem } from '../systems/CombatSystem';

const CSS = /* css */ `
#chud { position: fixed; inset: 0; pointer-events: none; z-index: 7; font-family: 'Segoe UI', system-ui, sans-serif; color: #eaf7ff; }
#chud .cross { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px; display: none; }
#chud .cross.on { display: block; }
#chud .gear { position: absolute; right: 18px; top: 16px; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; text-shadow: 0 1px 2px rgba(0,0,0,.8); }
#chud .slot { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 6px; background: rgba(5,18,28,.55); font-size: 13px; min-width: 150px; justify-content: space-between; }
#chud .slot .bar { width: 52px; height: 5px; border-radius: 3px; background: rgba(255,255,255,.18); overflow: hidden; }
#chud .slot .bar i { display: block; height: 100%; background: #9be8a0; }
#chud .slot.warn .bar i { background: #ff5b4b; animation: chud-blink .5s infinite alternate; }
#chud .slot.warn { box-shadow: 0 0 0 1px rgba(255,91,75,.6); }
@keyframes chud-blink { from { opacity: .35 } to { opacity: 1 } }
#chud .slot b { font-weight: 600; color: #8fe9ff; margin-right: 4px; font-size: 11px; letter-spacing: .08em; }
#chud .wheel { position: absolute; left: 50%; top: 50%; width: 360px; height: 360px; margin: -180px 0 0 -180px; border-radius: 50%; display: none;
  background: radial-gradient(circle, rgba(4,16,24,.25) 0, rgba(4,16,24,.78) 70%); border: 1px solid rgba(31,214,255,.4); }
#chud .wheel.on { display: block; }
#chud .wheel span { position: absolute; width: 96px; margin-left: -48px; text-align: center; font-size: 12px; line-height: 1.25; padding: 4px; border-radius: 6px; transform: translateY(-50%); }
#chud .wheel span.sel { background: rgba(31,214,255,.3); box-shadow: 0 0 12px rgba(31,214,255,.6); }
#chud .wheel span small { display: block; opacity: .7; font-size: 10px; }
#chud .wheel .center { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); text-align: center; font-size: 15px; width: 150px; }
#chud .lock { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border: 2px solid #ffd23a; border-radius: 50%; display: none; box-shadow: 0 0 10px rgba(255,210,58,.6); }
#chud .flurry { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 45%, rgba(40,150,255,.35)); opacity: 0; transition: opacity .2s; }
#chud .flurry.on { opacity: 1; }
#chud .notes { position: absolute; right: 18px; bottom: 120px; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
#chud .notes div { padding: 4px 10px; border-radius: 5px; background: rgba(5,18,28,.65); font-size: 13px; animation: chud-in .25s ease-out; }
#chud .notes div.bad { border-left: 3px solid #ff5b4b; }
#chud .notes div.good { border-left: 3px solid #7ee36b; }
@keyframes chud-in { from { transform: translateX(20px); opacity: 0 } to { transform: none; opacity: 1 } }
`;

/**
 * HUD de combate: mira con anillo de tensión del arco, equipo con durabilidad (parpadea al 25 %),
 * rueda de armas, marca del objetivo fijado, ráfaga y avisos (recogidas, roturas, sin flechas).
 */
export class CombatHud implements System {
  readonly name = 'combat-hud';
  private readonly cross: HTMLDivElement;
  private readonly gear: HTMLDivElement;
  private readonly wheel: HTMLDivElement;
  private readonly lock: HTMLDivElement;
  private readonly flurry: HTMLDivElement;
  private readonly notes: HTMLDivElement;
  private lastGear = '';
  private lastWheel = '';

  constructor(
    ctx: GameContext,
    private readonly playerEntity: Entity,
    private readonly combat: CombatSystem,
    private readonly catalog: Catalog,
    private readonly project: (x: number, y: number, z: number) => { x: number; y: number } | null,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = 'chud';
    document.body.appendChild(root);
    const mk = (cls: string) => {
      const d = document.createElement('div');
      d.className = cls;
      root.appendChild(d);
      return d;
    };
    this.flurry = mk('flurry');
    this.cross = mk('cross');
    this.gear = mk('gear');
    this.wheel = mk('wheel');
    this.lock = mk('lock');
    this.notes = mk('notes');

    ctx.bus.on('item:picked', ({ name, count }) => this.note(`+ ${count > 1 ? `${count} ` : ''}${name}`, 'good'));
    ctx.bus.on('item:inventory_full', ({ name }) => this.note(`Inventario lleno: no cabe ${name}`, 'bad'));
    ctx.bus.on('combat:weapon_warning', ({ name }) => this.note(`${name} está a punto de romperse`, 'bad'));
    ctx.bus.on('combat:weapon_broken', ({ name }) => this.note(`¡${name} se ha roto!`, 'bad'));
    ctx.bus.on('combat:no_arrows', () => this.note('No te quedan flechas', 'bad'));
    ctx.bus.on('combat:equipped', ({ name }) => this.note(`Equipado: ${name}`, 'good'));
    ctx.bus.on('combat:flurry', ({ active }) => this.flurry.classList.toggle('on', active));
    ctx.bus.on('combat:defended', ({ result }) => {
      if (result === 'parried') this.note('¡Parry!', 'good');
      if (result === 'perfect') this.note('¡Esquiva perfecta!', 'good');
    });
  }

  render(ctx: GameContext): void {
    const play = ctx.session.mode === 'play';
    this.gear.style.display = play ? 'flex' : 'none';
    if (!play) return;
    const c = ctx.world.require(this.playerEntity, 'combat');
    const eq = c.equipment;

    // Panel de equipo.
    const slot = (label: string, id: string | null, dur: number) => {
      if (!id) return '';
      const max = this.catalog.maxDurability(id);
      const k = max > 0 ? dur / max : 1;
      const warn = max > 0 && k <= 0.25;
      return `<div class="slot${warn ? ' warn' : ''}"><span><b>${label}</b>${this.catalog.name(id)}</span>${max > 0 ? `<span class="bar"><i style="width:${(k * 100).toFixed(0)}%"></i></span>` : ''}</div>`;
    };
    const m = equipped(eq, 'melee');
    const b = equipped(eq, 'bow');
    const s = equipped(eq, 'shield');
    const html =
      slot('ARMA', m ? m.id : 'fists', m?.durability ?? 0) +
      slot('ARCO', b?.id ?? null, b?.durability ?? 0) +
      slot('ESCUDO', s?.id ?? null, s?.durability ?? 0) +
      (b ? `<div class="slot"><span><b>FLECHAS</b>${eq.items.arrow ?? 0}</span></div>` : '');
    if (html !== this.lastGear) {
      this.lastGear = html;
      this.gear.innerHTML = html;
    }

    // Mira y tensión del arco.
    this.cross.classList.toggle('on', c.aiming);
    if (c.aiming) {
      const bow = this.combat.bowDef(c);
      const k = bow ? Math.min(1, c.drawT / (bow.bow?.drawTime ?? 1)) : 0;
      const circ = 2 * Math.PI * 16;
      this.cross.innerHTML =
        `<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="2" fill="#eaf7ff"/>` +
        `<circle cx="22" cy="22" r="16" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"/>` +
        `<circle cx="22" cy="22" r="16" fill="none" stroke="${k >= 1 ? '#1fd6ff' : '#eaf7ff'}" stroke-width="2.5" stroke-dasharray="${(k * circ).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 22 22)"/></svg>`;
    }

    // Rueda de armas.
    this.wheel.classList.toggle('on', c.wheelOpen);
    if (c.wheelOpen) {
      const entries = this.combat.wheelEntries;
      const key = `${this.combat.wheelIndex}|${entries.length}`;
      if (key !== this.lastWheel) {
        this.lastWheel = key;
        const n = entries.length;
        let h = '';
        entries.forEach((e, i) => {
          const a = (i / n) * Math.PI * 2;
          const x = 180 + Math.sin(a) * 128;
          const y = 180 - Math.cos(a) * 128;
          const dur = e.max > 0 ? `<small>${e.durability}/${e.max}</small>` : '';
          h += `<span class="${i === this.combat.wheelIndex ? 'sel' : ''}" style="left:${x}px;top:${y}px">${e.name}${dur}</span>`;
        });
        const sel = entries[this.combat.wheelIndex];
        h += `<div class="center">${sel ? sel.name : ''}<br><small>ratón o A/D · suelta para equipar</small></div>`;
        this.wheel.innerHTML = h;
      }
    } else {
      this.lastWheel = '';
    }

    // Marca del objetivo fijado.
    const lp = this.combat.lockPosition(ctx);
    const sp = lp ? this.project(lp.x, lp.y, lp.z) : null;
    this.lock.style.display = sp ? 'block' : 'none';
    if (sp) {
      this.lock.style.left = `${sp.x}px`;
      this.lock.style.top = `${sp.y}px`;
    }
  }

  private note(text: string, kind: 'good' | 'bad'): void {
    const d = document.createElement('div');
    d.className = kind;
    d.textContent = text;
    this.notes.appendChild(d);
    while (this.notes.children.length > 5) this.notes.firstChild?.remove();
    setTimeout(() => d.remove(), 3200);
  }
}
