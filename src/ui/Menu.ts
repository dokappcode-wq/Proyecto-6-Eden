import { equip, effectiveLimits, removeGear, toggleArmor, type Catalog } from '../combat/inventory';
import type { GameContext } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import type { AltarKind, CombatConfig, StatKey } from '../data/schemas';
import { cook } from '../items/cooking';
import type { PickupSystem } from '../systems/PickupSystem';
import type { ProgressionSystem } from '../systems/ProgressionSystem';

const CSS = /* css */ `
#menu { position: fixed; inset: 0; z-index: 30; display: none; background: radial-gradient(ellipse at center, rgba(6,20,30,.86), rgba(2,8,14,.95)); color: #eaf7ff; font-family: 'Segoe UI', system-ui, sans-serif; }
#menu.on { display: flex; flex-direction: column; }
#menu header { display: flex; align-items: center; gap: 6px; padding: 14px 24px 6px; flex-wrap: wrap; }
#menu header h2 { margin: 0 18px 0 0; font-weight: 500; letter-spacing: .08em; font-size: 18px; color: #8fe9ff; }
#menu header button, #menu .btn { background: rgba(31,214,255,.12); border: 1px solid rgba(31,214,255,.35); color: #eaf7ff; padding: 6px 12px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 13px; }
#menu header button.sel { background: rgba(31,214,255,.38); }
#menu .btn:disabled { opacity: .35; cursor: default; }
#menu .body { flex: 1; display: flex; gap: 18px; padding: 10px 24px 18px; min-height: 0; }
#menu .grid { flex: 1; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; align-content: start; }
#menu .card { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 8px 10px; cursor: pointer; font-size: 13px; min-height: 52px; position: relative; }
#menu .card:hover { border-color: rgba(31,214,255,.6); }
#menu .card.on { border-color: #ffd23a; box-shadow: 0 0 10px rgba(255,210,58,.35); }
#menu .card small { display: block; opacity: .7; font-size: 11px; margin-top: 3px; }
#menu .card .dot { position: absolute; right: 8px; top: 8px; width: 10px; height: 10px; border-radius: 50%; }
#menu .side { width: 300px; overflow: auto; font-size: 13px; line-height: 1.5; }
#menu .side h3 { margin: 10px 0 4px; font-size: 13px; letter-spacing: .1em; color: #8fe9ff; font-weight: 500; }
#menu .msg { min-height: 20px; color: #ffd23a; padding: 0 24px; font-size: 13px; }
#menu .row { display: flex; gap: 8px; align-items: center; margin: 6px 0; flex-wrap: wrap; }
#menu .pot { display: flex; gap: 6px; min-height: 40px; align-items: center; flex-wrap: wrap; }
#menu .pot span { background: rgba(255,210,58,.15); border: 1px solid rgba(255,210,58,.4); border-radius: 6px; padding: 4px 8px; cursor: pointer; }
#menu .hint { opacity: .6; font-size: 12px; padding: 0 24px 12px; }
`;

const STAT_LABEL: Partial<Record<StatKey, string>> = {
  defense: 'Defensa', climbSpeed: 'Velocidad de escalada', climbStamina: 'Ahorro al escalar', climbJump: 'Ahorro en saltos de escalada', ledgeCost: 'Ahorro del Impulso de Borde',
  ledgeFree: 'Impulso de Borde gratis', chainUnlimited: 'Cadena de bordes ilimitada', glideStamina: 'Ahorro del planeador', glideFall: 'Caída del planeador', glideWind: 'Resistencia al viento',
  freeGlide: 'Segundos de planeo gratis', coldResist: 'Resistencia al frío (°C)', heatResist: 'Resistencia al calor (°C)', stealth: 'Sigilo', bowDamage: 'Daño con arco',
  glideBowCost: 'Ahorro al disparar planeando', poisonResist: 'Resistencia al veneno', shockResist: 'Resistencia eléctrica', insulated: 'Aislado de rayos', swimSpeed: 'Velocidad nadando',
  swimStamina: 'Ahorro al nadar', breath: 'Aire extra (s)', stunResist: 'Resistencia al aturdimiento', darkVision: 'Visión en la oscuridad', light: 'Luz propia', perfectWindow: 'Esquiva perfecta más larga (s)',
  iceGrip: 'Agarre en hielo', sandSpeed: 'Velocidad en la arena', attack: 'Fuerza', speed: 'Velocidad',
};

type Mode = 'inventory' | AltarKind;
type Tab = 'melee' | 'bow' | 'shield' | 'armor' | 'food' | 'material' | 'key';
const TABS: [Tab, string][] = [
  ['melee', 'Armas'],
  ['bow', 'Arcos'],
  ['shield', 'Escudos'],
  ['armor', 'Armadura'],
  ['food', 'Comida'],
  ['material', 'Materiales'],
  ['key', 'Objetos clave'],
];

export interface MenuDeps {
  playerEntity: Entity;
  catalog: Catalog;
  progression: ProgressionSystem;
  pickups: PickupSystem;
  limits: CombatConfig['inventory'];
  canvas: HTMLCanvasElement;
}

/**
 * Menús con la partida en pausa: inventario por categorías (equipar, comer, soltar),
 * cocina (hasta 5 ingredientes), estatua de la ofrenda, fuente (mejorar armaduras)
 * y taller del planeador (mejoras, tintes y huecos extra con semillas).
 */
export class Menu {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly tabs: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly msg: HTMLDivElement;
  private mode: Mode = 'inventory';
  private tab: Tab = 'melee';
  private pot: string[] = [];
  private ctx: GameContext;

  constructor(
    ctx: GameContext,
    private readonly d: MenuDeps,
  ) {
    this.ctx = ctx;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'menu';
    const header = document.createElement('header');
    this.title = document.createElement('h2');
    this.tabs = document.createElement('div');
    this.tabs.style.display = 'flex';
    this.tabs.style.gap = '6px';
    this.tabs.style.flexWrap = 'wrap';
    header.append(this.title, this.tabs);
    this.msg = document.createElement('div');
    this.msg.className = 'msg';
    this.body = document.createElement('div');
    this.body.className = 'body';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Clic: usar/equipar · clic derecho: soltar arma · I o Esc: cerrar';
    this.root.append(header, this.msg, this.body, hint);
    document.body.appendChild(this.root);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    ctx.bus.on('input:action', ({ action, phase }) => {
      if (action !== 'inventory' || phase !== 'pressed') return;
      if (ctx.session.mode === 'menu') this.close();
      else if (ctx.session.mode === 'play') this.open('inventory');
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && ctx.session.mode === 'menu') this.close();
    });
    d.progression.openStation = (kind) => this.open(kind);
  }

  get isOpen(): boolean {
    return this.ctx.session.mode === 'menu';
  }

  open(mode: Mode): void {
    const ctx = this.ctx;
    if (ctx.session.mode !== 'play') return;
    this.mode = mode;
    this.pot = [];
    this.msg.textContent = '';
    ctx.session.mode = 'menu';
    if (document.pointerLockElement) document.exitPointerLock();
    this.root.classList.add('on');
    this.render();
  }

  close(): void {
    this.root.classList.remove('on');
    if (this.ctx.session.mode === 'menu') this.ctx.session.mode = 'play';
    try {
      const r = this.d.canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      // Sin gesto de usuario: el HUD pide hacer clic.
    }
  }

  private get eq() {
    return this.ctx.world.require(this.d.playerEntity, 'combat').equipment;
  }

  private say(text: string): void {
    this.msg.textContent = text;
  }

  private render(): void {
    const titles: Record<Mode, string> = { inventory: 'Inventario', cooking: 'Cocina', offering: 'Estatua de la Ofrenda', fountain: 'Fuente de las Raíces', workshop: 'Taller del Planeador' };
    this.title.textContent = titles[this.mode];
    this.tabs.innerHTML = '';
    if (this.mode === 'inventory') {
      for (const [t, label] of TABS) {
        const b = document.createElement('button');
        b.textContent = label;
        if (t === this.tab) b.className = 'sel';
        b.onclick = () => {
          this.tab = t;
          this.render();
        };
        this.tabs.appendChild(b);
      }
    }
    const close = document.createElement('button');
    close.textContent = 'Cerrar';
    close.onclick = () => this.close();
    this.tabs.appendChild(close);
    this.body.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'grid';
    const side = document.createElement('div');
    side.className = 'side';
    this.body.append(grid, side);
    switch (this.mode) {
      case 'inventory':
        this.renderInventory(grid);
        break;
      case 'cooking':
        this.renderCooking(grid, side);
        return;
      case 'offering':
        this.renderOffering(grid);
        break;
      case 'fountain':
        this.renderFountain(grid);
        break;
      case 'workshop':
        this.renderWorkshop(grid);
        break;
    }
    this.renderStats(side);
  }

  private card(grid: HTMLElement, name: string, sub: string, on: boolean, click: (() => void) | null, color?: string, rightClick?: () => void): void {
    const c = document.createElement('div');
    c.className = `card${on ? ' on' : ''}`;
    c.innerHTML = `${name}<small>${sub}</small>${color ? `<span class="dot" style="background:${color}"></span>` : ''}`;
    if (click) c.onclick = click;
    if (rightClick) c.oncontextmenu = (e) => {
      e.preventDefault();
      rightClick();
    };
    grid.appendChild(c);
  }

  private renderInventory(grid: HTMLElement): void {
    const eq = this.eq;
    const cat = this.d.catalog;
    const lim = effectiveLimits(eq, this.d.limits);
    const gear = (list: typeof eq.weapons, slot: 'melee' | 'bow' | 'shield', max: number) => {
      if (slot === 'melee') this.card(grid, 'Puños', 'Sin arma', eq.melee === null, () => this.equipGear('melee', null));
      for (const w of list) {
        const maxD = cat.maxDurability(w.id);
        this.card(grid, cat.name(w.id), maxD > 0 ? `Durabilidad ${w.durability}/${maxD}` : '', eq[slot] === w.uid, () => this.equipGear(slot, w.uid), undefined, () => this.dropGear(w.uid));
      }
      const info = document.createElement('div');
      info.style.gridColumn = '1 / -1';
      info.style.opacity = '0.6';
      info.textContent = `${list.length}/${max} huecos`;
      grid.appendChild(info);
    };
    switch (this.tab) {
      case 'melee':
        gear(eq.weapons, 'melee', lim.weapons);
        break;
      case 'bow':
        gear(eq.bows, 'bow', lim.bows);
        break;
      case 'shield':
        gear(eq.shields, 'shield', lim.shields);
        break;
      case 'armor':
        for (const a of eq.armor) {
          const p = cat.armor(a.id);
          const set = cat.setOf(a.id);
          const worn = eq.worn[p.slot] === a.uid;
          this.card(grid, `${p.name}${a.level > 0 ? ` ★${a.level}` : ''}`, `${set?.name ?? 'Accesorio'} · defensa ${this.d.progression.pieceDefense(a.id, a.level)}`, worn, () => {
            toggleArmor(eq, cat, a.uid);
            this.render();
          }, p.model.color);
        }
        if (eq.armor.length === 0) grid.textContent = 'No tienes armaduras.';
        break;
      case 'food': {
        for (const m of eq.meals) {
          this.card(grid, `${m.name} ×${m.count}`, `${m.heal > 0 ? `+${m.heal / 4} ♥ ` : ''}${m.effect ? `· ${m.effect === 'hearty' || m.effect === 'stamina' || m.effect === 'endurance' ? '' : `${Math.round(m.seconds)} s`}` : ''}`, false, () => this.eat({ meal: m.uid }));
        }
        for (const it of cat.allItems) {
          const n = eq.items[it.id] ?? 0;
          if (n <= 0 || !it.food || it.food.tags.includes('monster') || it.food.tags.includes('critter')) continue;
          this.card(grid, `${it.name} ×${n}`, `Crudo: +${it.food.heal / 4} ♥`, false, () => this.eat({ item: it.id }), it.color);
        }
        if (grid.children.length === 0) grid.textContent = 'No tienes comida. Recoge ingredientes y cocina en una olla.';
        break;
      }
      case 'material':
      case 'key':
        for (const it of cat.allItems) {
          const n = eq.items[it.id] ?? 0;
          if (n <= 0) continue;
          const isKey = it.category === 'key';
          if ((this.tab === 'key') !== isKey || (this.tab === 'material' && it.food && !it.food.tags.includes('monster') && !it.food.tags.includes('critter'))) continue;
          this.card(grid, it.name, `×${n}`, false, null, it.color);
        }
        if (grid.children.length === 0) grid.textContent = 'Nada por aquí.';
        break;
    }
  }

  private equipGear(slot: 'melee' | 'bow' | 'shield', uid: number | null): void {
    equip(this.eq, slot, uid);
    this.ctx.bus.emit('combat:equipped', { slot, name: uid === null ? 'Puños' : this.d.catalog.name(this.eq[slot === 'melee' ? 'weapons' : slot === 'bow' ? 'bows' : 'shields'].find((w) => w.uid === uid)?.id ?? '') });
    this.render();
  }

  private dropGear(uid: number): void {
    const inst = removeGear(this.eq, uid);
    if (!inst) return;
    const ch = this.ctx.world.require(this.d.playerEntity, 'character');
    this.d.pickups.drop(this.ctx, inst.id, 1, ch.x + Math.sin(ch.yaw) * 1.4, ch.y + 0.5, ch.z + Math.cos(ch.yaw) * 1.4, inst.durability);
    this.say(`Has soltado ${this.d.catalog.name(inst.id)}`);
    this.render();
  }

  private eat(what: { meal?: number; item?: string }): void {
    const r = this.d.progression.eatFromInventory(this.ctx, what);
    if (r) this.say(r);
    this.render();
  }

  private renderCooking(grid: HTMLElement, side: HTMLElement): void {
    const eq = this.eq;
    const cat = this.d.catalog;
    const max = this.ctx.data.recipes.cooking.maxIngredients;
    for (const it of cat.allItems) {
      const have = (eq.items[it.id] ?? 0) - this.pot.filter((p) => p === it.id).length;
      if (!it.food || (eq.items[it.id] ?? 0) <= 0) continue;
      this.card(grid, it.name, `×${have}${it.food.effect ? ` · ${this.ctx.data.recipes.effects[it.food.effect]?.name ?? ''}` : ''}`, false, have > 0 && this.pot.length < max ? () => {
        this.pot.push(it.id);
        this.render();
      } : null, it.color);
    }
    if (grid.children.length === 0) grid.textContent = 'No tienes ingredientes.';
    side.innerHTML = `<h3>OLLA (${this.pot.length}/${max})</h3>`;
    const pot = document.createElement('div');
    pot.className = 'pot';
    this.pot.forEach((id, i) => {
      const s = document.createElement('span');
      s.textContent = cat.name(id);
      s.title = 'Quitar';
      s.onclick = () => {
        this.pot.splice(i, 1);
        this.render();
      };
      pot.appendChild(s);
    });
    side.appendChild(pot);
    if (this.pot.length > 0) {
      const preview = cook(this.pot, (id) => cat.item(id), this.ctx.data.recipes);
      const p = document.createElement('div');
      p.innerHTML = `<h3>RESULTADO PREVISTO</h3>${preview.name}<br>${preview.heal > 0 ? `+${preview.heal / 4} ♥` : 'No cura'}${preview.effect ? `<br>${this.ctx.data.recipes.effects[preview.effect]?.name}${preview.seconds > 0 ? ` nivel ${preview.potency} · ${Math.round(preview.seconds)} s` : ''}` : ''}`;
      side.appendChild(p);
    }
    const row = document.createElement('div');
    row.className = 'row';
    const cookBtn = this.button('Cocinar', this.pot.length > 0, () => {
      const r = this.d.progression.cookMeal(this.ctx, this.pot);
      this.pot = [];
      this.say(r ? `Has cocinado: ${r.name}` : 'Te faltan ingredientes');
      this.render();
    });
    const clear = this.button('Vaciar', this.pot.length > 0, () => {
      this.pot = [];
      this.render();
    });
    row.append(cookBtn, clear);
    side.appendChild(row);
  }

  private renderOffering(grid: HTMLElement): void {
    const orbs = this.eq.items.ancestral_orb ?? 0;
    const need = this.ctx.data.progression.offering.orbsPerBlessing;
    const info = document.createElement('div');
    info.style.gridColumn = '1 / -1';
    info.innerHTML = `Orbes ancestrales: <b>${orbs}</b>. Ofrece ${need} para recibir una bendición.`;
    grid.appendChild(info);
    const row = document.createElement('div');
    row.className = 'row';
    row.style.gridColumn = '1 / -1';
    row.append(
      this.button('+1 corazón', orbs >= need, () => {
        this.say(this.d.progression.bless(this.ctx, 'heart') ? 'Tu vida máxima aumenta' : 'Ya tienes el máximo de corazones');
        this.render();
      }),
      this.button(`+${this.ctx.data.progression.offering.staminaPerBlessing} de vigor`, orbs >= need, () => {
        this.say(this.d.progression.bless(this.ctx, 'stamina') ? 'Tu vigor máximo aumenta' : 'Ya tienes el máximo de vigor');
        this.render();
      }),
    );
    grid.appendChild(row);
  }

  private renderFountain(grid: HTMLElement): void {
    const eq = this.eq;
    const cat = this.d.catalog;
    for (const a of eq.armor) {
      const cost = this.d.progression.nextUpgrade(a.id, a.level);
      const costTxt = cost ? cost.map((c) => `${cat.name(c.item)} ${eq.items[c.item] ?? 0}/${c.count}`).join(' · ') : 'Nivel máximo';
      const can = !!cost && this.d.progression.canPay(eq.items, cost);
      this.card(grid, `${cat.name(a.id)} ★${a.level}`, `Defensa ${this.d.progression.pieceDefense(a.id, a.level)} → ${cost ? this.d.progression.pieceDefense(a.id, a.level + 1) : '—'}<br>${costTxt}`, can, can ? () => {
        this.d.progression.upgradeArmor(this.ctx, a.uid);
        this.say(`${cat.name(a.id)} mejorada a ★${a.level}`);
        this.render();
      } : null);
    }
    if (eq.armor.length === 0) grid.textContent = 'No tienes armaduras que mejorar.';
  }

  private renderWorkshop(grid: HTMLElement): void {
    const eq = this.eq;
    const cat = this.d.catalog;
    const prog = this.d.progression;
    const data = this.ctx.data;
    for (const u of data.glider.upgrades) {
      const cost = data.progression.gliderUpgradeCosts[u.id] ?? [];
      const owned = prog.gliderUpgrades.includes(u.id);
      const can = !owned && prog.canPay(eq.items, cost);
      this.card(grid, u.name, owned ? 'Instalada' : cost.map((c) => `${cat.name(c.item)} ${eq.items[c.item] ?? 0}/${c.count}`).join(' · '), owned, can ? () => {
        prog.buyGliderUpgrade(this.ctx, u.id);
        this.say(`Planeador mejorado: ${u.name}`);
        this.render();
      } : null);
    }
    for (const t of data.progression.gliderTints) {
      this.card(grid, `Tinte: ${t.name}`, t.cost > 0 ? `${t.cost} semillas` : 'Gratis', prog.tint === t.id, () => {
        this.say(prog.setTint(this.ctx, t.id) ? `Planeador teñido: ${t.name}` : 'Te faltan semillas');
        this.render();
      }, t.color);
    }
    const cost = prog.nextSlotCost(this.ctx);
    const seeds = eq.items.forest_seed ?? 0;
    for (const [k, label] of [
      ['weapons', 'armas'],
      ['bows', 'arcos'],
      ['shields', 'escudos'],
    ] as const) {
      this.card(grid, `Hueco extra de ${label}`, cost === null ? 'Ya no hay más' : `${cost} semillas (tienes ${seeds})`, false, cost !== null && seeds >= cost ? () => {
        prog.buySlot(this.ctx, k);
        this.say(`Ahora puedes llevar más ${label}`);
        this.render();
      } : null);
    }
  }

  private renderStats(side: HTMLElement): void {
    const p = this.ctx.world.require(this.d.playerEntity, 'player');
    const ch = this.ctx.world.require(this.d.playerEntity, 'character');
    const prog = this.d.progression;
    const s = prog.stats;
    let html = `<h3>ESTADO</h3>Corazones ${(p.health.fragments / 4).toFixed(2)}/${p.health.maxFragments / 4}${p.health.extra > 0 ? ` (+${p.health.extra / 4} extra)` : ''}<br>Vigor ${Math.round(ch.stamina.max)}<br>Defensa ${Math.round(s.defense)}`;
    if (prog.buff) html += `<br>Comida: ${this.ctx.data.recipes.effects[prog.buff.effect]?.name} ${prog.buff.potency} (${Math.ceil(prog.buff.remaining)} s)`;
    if (prog.summary.sets.length) {
      html += '<h3>SETS</h3>';
      for (const st of prog.summary.sets) html += `${st.name} ${st.pieces}/${st.total}${st.active.length ? ` · bonus ${st.active.join(', ')} piezas` : ''}<br>`;
    }
    const lines = (Object.keys(STAT_LABEL) as StatKey[]).filter((k) => k !== 'defense' && Math.abs(s[k]) > 1e-6).map((k) => {
      const v = s[k];
      const pct = ['climbSpeed', 'climbStamina', 'climbJump', 'ledgeCost', 'glideStamina', 'glideFall', 'glideWind', 'stealth', 'bowDamage', 'glideBowCost', 'poisonResist', 'shockResist', 'swimSpeed', 'swimStamina', 'stunResist', 'darkVision', 'attack', 'speed', 'sandSpeed'].includes(k);
      const flag = ['ledgeFree', 'chainUnlimited', 'insulated', 'light', 'iceGrip'].includes(k);
      return `${STAT_LABEL[k]}${flag ? '' : `: ${pct ? `${v > 0 ? '+' : ''}${Math.round(v * 100)} %` : `${v > 0 ? '+' : ''}${Math.round(v * 100) / 100}`}`}`;
    });
    if (lines.length) html += `<h3>EFECTOS</h3>${lines.join('<br>')}`;
    side.innerHTML = html;
  }

  private button(label: string, enabled: boolean, click: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.disabled = !enabled;
    b.onclick = click;
    return b;
  }
}
