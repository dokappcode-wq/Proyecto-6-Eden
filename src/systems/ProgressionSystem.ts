import * as THREE from 'three';
import { addArmor, addMeal, takeItem, wornArmor, type Catalog, type Meal } from '../combat/inventory';
import type { GameContext, System } from '../core/Game';
import { createTransform } from '../core/ecs/components';
import type { Entity } from '../core/ecs/World';
import type { DamageCause } from '../core/events';
import type { GameData } from '../data';
import type { AltarKind, BiomeId, LedgeBoostConfig, PlayerConfig } from '../data/schemas';
import { cook, rawFood, type CookResult } from '../items/cooking';
import { emptyStats, mitigate, pieceDefense, totalStats, upgradeCost, type ArmorSummary, type Buff, type Stats } from '../items/stats';
import { gliderModifiers, type GliderModifiers } from '../player/movement/glide';
import type { PlayerVisual } from '../player/PlayerVisual';
import type { PlayerSystem } from './PlayerSystem';
import { buildAltar } from '../world/props/altars';
import type { StaticColliders } from '../world/physics/StaticColliders';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import { addCollider } from '../world/valley/ValleyBuilder';

export interface ProgressionDeps {
  data: GameData;
  playerEntity: Entity;
  catalog: Catalog;
  /** Configuración efectiva que usa el movimiento y el combate (se modifica con el equipo). */
  effective: { player: PlayerConfig; ledge: LedgeBoostConfig; setGliderMods: (m: GliderModifiers) => void };
  terrain: TerrainGenerator;
  colliders: StaticColliders;
  scene: THREE.Scene;
  visual: PlayerVisual;
  biome: () => BiomeId;
  isDark: () => boolean;
  player: PlayerSystem;
}

export interface ProgressionSave {
  staminaMax: number;
  gliderUpgrades: string[];
  tint: string;
  buff: { effect: string; potency: number; remaining: number } | null;
}

/** Daños que la armadura amortigua. */
const ARMORED: ReadonlySet<DamageCause> = new Set(['enemy', 'fire', 'shock', 'bleed']);

/**
 * Progresión del jugador: estadísticas del equipo (armadura + sets + comida) aplicadas al
 * movimiento, el planeador y el combate; comida (curar, efectos), corazones y vigor ampliables
 * con orbes, mejoras de armadura en las fuentes, mejoras y tintes del planeador y huecos extra.
 */
export class ProgressionSystem implements System {
  readonly name = 'progression';
  stats: Stats = emptyStats();
  summary: ArmorSummary = { stats: emptyStats(), sets: [] };
  buff: Buff | null = null;
  gliderUpgrades: string[] = [];
  tint = 'classic';
  /** Abre un menú de estación (lo conecta el menú). */
  openStation: ((kind: AltarKind, name: string) => void) | null = null;
  private key = '';
  private readonly light = new THREE.PointLight('#ffe6b0', 0, 18, 1.6);

  constructor(
    private readonly d: ProgressionDeps,
    ctx: GameContext,
  ) {
    d.scene.add(this.light);
    // Estaciones: estatua de la ofrenda, fuente, taller y ollas.
    for (const a of d.data.progression.altars) {
      const [x, z] = a.position;
      const y = d.terrain.height(x, z);
      const prop = buildAltar(a.kind);
      prop.object.position.set(x, y, z);
      d.scene.add(prop.object);
      for (const c of prop.colliders) addCollider(d.colliders, c, x, y, z, 0);
      const e = ctx.world.createEntity();
      ctx.world.add(e, 'name', { value: a.id });
      ctx.world.add(e, 'transform', createTransform(x, y, z));
      const prompts: Record<AltarKind, string> = { offering: 'Hacer una ofrenda', fountain: 'Mejorar armadura', workshop: 'Usar el taller', cooking: 'Cocinar' };
      const prompt = prompts[a.kind];
      ctx.world.add(e, 'interactable', { id: `station:${a.kind}:${a.name}`, kind: 'station', prompt, radius: a.kind === 'fountain' ? 3.4 : 2.4, enabled: true });
    }
    ctx.bus.on('interact', ({ id, kind }) => {
      if (kind !== 'station') return;
      const [, k, name] = id.split(':');
      this.openStation?.(k as AltarKind, name);
    });
    // Corazón completo y vasija de vigor se aplican al recogerlos.
    ctx.bus.on('item:picked', ({ item }) => {
      if (item === 'heart_container' || item === 'stamina_vessel') {
        const eq = ctx.world.require(d.playerEntity, 'combat').equipment;
        if (takeItem(eq, item, 1)) this.bless(ctx, item === 'heart_container' ? 'heart' : 'stamina', false);
      }
    });
    d.player.damageFilter = (amount, cause) => (ARMORED.has(cause) ? mitigate(amount, this.stats.defense) : amount);
  }

  /** Equipo inicial de una partida nueva: la ropa de superviviente. */
  giveStartingArmor(ctx: GameContext): void {
    const eq = ctx.world.require(this.d.playerEntity, 'combat').equipment;
    for (const id of this.d.data.progression.startingArmor) addArmor(eq, this.d.catalog, id);
    this.key = '';
  }

  save(ctx: GameContext): ProgressionSave {
    return { staminaMax: ctx.world.require(this.d.playerEntity, 'character').stamina.max, gliderUpgrades: [...this.gliderUpgrades], tint: this.tint, buff: this.buff ? { ...this.buff } : null };
  }

  restore(ctx: GameContext, s: ProgressionSave | null): void {
    const st = ctx.world.require(this.d.playerEntity, 'character').stamina;
    st.max = s?.staminaMax ?? this.d.data.player.stamina.base;
    st.current = st.max;
    this.gliderUpgrades = s?.gliderUpgrades.filter((id) => this.d.data.glider.upgrades.some((u) => u.id === id)) ?? [];
    this.tint = s?.tint ?? 'classic';
    const b = s?.buff;
    this.buff = b && b.effect in this.d.data.recipes.effects ? (b as Buff) : null;
    this.key = '';
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    if (this.buff) {
      this.buff.remaining -= dt;
      if (this.buff.remaining <= 0) {
        ctx.bus.emit('food:buff', { name: '', active: false });
        this.buff = null;
      }
    }
    const eq = ctx.world.require(this.d.playerEntity, 'combat').equipment;
    const biome = this.d.biome();
    const key = `${wornArmor(eq).map((a) => `${a.id}:${a.level}`).join(',')}|${this.buff ? `${this.buff.effect}${this.buff.potency}` : ''}|${this.gliderUpgrades.join(',')}|${biome === 'desert'}|${this.tint}`;
    if (key !== this.key) {
      this.key = key;
      this.recompute(ctx, biome);
    }
    // Lámpara del casco: ilumina alrededor en la oscuridad.
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    this.light.intensity = this.stats.light > 0 && this.d.isDark() ? 14 : 0;
    this.light.position.set(ch.x, ch.y + 2.1, ch.z);
  }

  /** Recalcula estadísticas y las aplica a la configuración efectiva. */
  private recompute(ctx: GameContext, biome: BiomeId): void {
    const d = this.d;
    const eq = ctx.world.require(d.playerEntity, 'combat').equipment;
    this.summary = totalStats(eq, d.catalog, this.buff, d.data.recipes);
    const s = this.summary.stats;
    if (biome === 'desert') s.speed += s.sandSpeed;
    this.stats = s;
    const base = d.data.player;
    const P = d.effective.player;
    const red = (v: number) => Math.max(0.15, 1 - v);
    P.climb.speed = base.climb.speed * (1 + s.climbSpeed);
    P.stamina.costs.climb = base.stamina.costs.climb * red(s.climbStamina);
    P.stamina.costs.climbJump = base.stamina.costs.climbJump * red(s.climbJump);
    P.stamina.costs.swim = base.stamina.costs.swim * red(s.swimStamina);
    P.stamina.costs.bowChargeGliding = base.stamina.costs.bowChargeGliding * red(s.glideBowCost);
    P.swim.airSeconds = base.swim.airSeconds + s.breath;
    P.movement.swimSpeed = base.movement.swimSpeed * (1 + s.swimSpeed);
    P.movement.jogSpeed = base.movement.jogSpeed * (1 + s.speed);
    P.movement.walkSpeed = base.movement.walkSpeed * (1 + s.speed);
    P.movement.sprintSpeed = base.movement.sprintSpeed * (1 + s.speed);
    P.combat.dodge.perfectWindow = base.combat.dodge.perfectWindow + s.perfectWindow;
    d.effective.ledge.staminaCost = s.ledgeFree > 0 ? 0 : d.data.ledgeBoost.staminaCost * red(s.ledgeCost);
    const ups = d.data.glider.upgrades.filter((u) => this.gliderUpgrades.includes(u.id));
    const m = gliderModifiers(ups);
    d.effective.setGliderMods({
      staminaMultiplier: m.staminaMultiplier * red(s.glideStamina),
      fallMultiplier: m.fallMultiplier * (1 + s.glideFall),
      windMultiplier: m.windMultiplier * red(s.glideWind),
      freeSeconds: s.freeGlide,
    });
    // Aspecto: piezas puestas y tinte del planeador.
    const look: Record<string, { kind: string; color: string }> = {};
    for (const inst of wornArmor(eq)) {
      const p = d.catalog.armor(inst.id);
      look[p.slot] = p.model;
    }
    d.visual.setArmor(look);
    d.visual.setGliderTint(d.data.progression.gliderTints.find((t) => t.id === this.tint)?.color ?? '#efe6d2');
  }

  // ------------------------------------------------------------------ comida

  /** Comer un plato o un ingrediente crudo. */
  eat(ctx: GameContext, food: CookResult | Meal): string {
    const p = ctx.world.require(this.d.playerEntity, 'player');
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const h = p.health;
    h.fragments = Math.min(h.maxFragments, h.fragments + Math.round(food.heal));
    const fx = this.d.data.recipes.effects;
    let msg = food.heal > 0 ? `+${(food.heal / 4).toFixed(food.heal % 4 === 0 ? 0 : 2)} corazones` : '';
    if (food.effect) {
      const e = fx[food.effect];
      if (food.effect === 'hearty') {
        h.fragments = h.maxFragments;
        h.extra = Math.min(20 * 4, h.extra + Math.round(e.per * food.potency));
        msg = 'Corazones extra';
      } else if (food.effect === 'stamina') {
        ch.stamina.current = Math.min(ch.stamina.max, ch.stamina.current + e.per * food.potency);
        ch.stamina.exhausted = false;
        msg += ' · Energía';
      } else if (food.effect === 'endurance') {
        ch.stamina.current = ch.stamina.max;
        ch.stamina.bonus = Math.min(this.d.data.player.stamina.perRing * 2, ch.stamina.bonus + e.per * food.potency);
        ch.stamina.exhausted = false;
        msg += ' · Resistencia extra';
      } else if (food.seconds > 0) {
        this.buff = { effect: food.effect, potency: Math.max(1, Math.round(food.potency)), remaining: food.seconds };
        ctx.bus.emit('food:buff', { name: e.name, active: true });
        msg += ` · ${e.name} ${Math.max(1, Math.round(food.potency))} (${Math.round(food.seconds)} s)`;
      }
    }
    ctx.bus.emit('player:healed', { remaining: h.fragments });
    return msg.replace(/^ · /, '') || 'No ha pasado nada';
  }

  /** Comer del inventario: un plato (uid) o un ingrediente crudo (id). */
  eatFromInventory(ctx: GameContext, what: { meal?: number; item?: string }): string | null {
    const eq = ctx.world.require(this.d.playerEntity, 'combat').equipment;
    if (what.meal !== undefined) {
      const m = eq.meals.find((x) => x.uid === what.meal);
      if (!m) return null;
      m.count--;
      if (m.count <= 0) eq.meals.splice(eq.meals.indexOf(m), 1);
      return this.eat(ctx, m);
    }
    if (what.item) {
      const def = this.d.catalog.item(what.item);
      const raw = def ? rawFood(def, this.d.data.recipes) : null;
      if (!raw || !takeItem(eq, what.item, 1)) return null;
      return this.eat(ctx, raw);
    }
    return null;
  }

  /** Cocina con los ingredientes elegidos (los consume) y guarda el plato. */
  cookMeal(ctx: GameContext, ids: string[]): CookResult | null {
    const eq = ctx.world.require(this.d.playerEntity, 'combat').equipment;
    const need = new Map<string, number>();
    for (const id of ids) need.set(id, (need.get(id) ?? 0) + 1);
    for (const [id, n] of need) if ((eq.items[id] ?? 0) < n) return null;
    for (const [id, n] of need) takeItem(eq, id, n);
    const r = cook(ids, (id) => this.d.catalog.item(id), this.d.data.recipes);
    addMeal(eq, { recipe: r.recipe, name: r.name, heal: r.heal, effect: r.effect, potency: r.potency, seconds: r.seconds });
    ctx.bus.emit('food:cooked', { name: r.name, dubious: r.dubious });
    return r;
  }

  // ------------------------------------------------------------------ estaciones

  /** +1 corazón o +vigor (con orbes en la estatua, o por un objeto especial). */
  bless(ctx: GameContext, kind: 'heart' | 'stamina', pay = true): boolean {
    const d = this.d;
    const eq = ctx.world.require(d.playerEntity, 'combat').equipment;
    const p = ctx.world.require(d.playerEntity, 'player');
    const st = ctx.world.require(d.playerEntity, 'character').stamina;
    const cfg = d.data.progression.offering;
    const maxHearts = d.data.player.health.maxHearts * d.data.player.health.fragmentsPerHeart;
    const maxStamina = d.data.player.stamina.perRing * d.data.player.stamina.maxRings;
    if (kind === 'heart' && p.health.maxFragments >= maxHearts) return false;
    if (kind === 'stamina' && st.max >= maxStamina) return false;
    if (pay && !takeItem(eq, 'ancestral_orb', cfg.orbsPerBlessing)) return false;
    if (kind === 'heart') {
      p.health.maxFragments += d.data.player.health.fragmentsPerHeart;
      p.health.fragments = p.health.maxFragments;
    } else {
      st.max = Math.min(maxStamina, st.max + cfg.staminaPerBlessing);
      st.current = st.max;
    }
    ctx.bus.emit('player:blessed', { kind });
    return true;
  }

  /** Coste de la siguiente mejora de una pieza (null si está al máximo o es un accesorio). */
  nextUpgrade(id: string, level: number): { item: string; count: number }[] | null {
    const set = this.d.catalog.setOf(id);
    if (!set || level >= this.d.data.armor.levels) return null;
    return upgradeCost(set, level);
  }

  upgradeArmor(ctx: GameContext, uid: number): boolean {
    const eq = ctx.world.require(this.d.playerEntity, 'combat').equipment;
    const inst = eq.armor.find((a) => a.uid === uid);
    if (!inst) return false;
    const cost = this.nextUpgrade(inst.id, inst.level);
    if (!cost || !this.canPay(eq.items, cost)) return false;
    for (const c of cost) takeItem(eq, c.item, c.count);
    inst.level++;
    this.key = '';
    ctx.bus.emit('armor:upgraded', { name: this.d.catalog.name(inst.id), level: inst.level });
    return true;
  }

  pieceDefense(id: string, level: number): number {
    return pieceDefense(this.d.catalog.armor(id).defense, level);
  }

  buyGliderUpgrade(ctx: GameContext, id: string): boolean {
    const cost = this.d.data.progression.gliderUpgradeCosts[id];
    const eq = ctx.world.require(this.d.playerEntity, 'combat').equipment;
    if (!cost || this.gliderUpgrades.includes(id) || !this.canPay(eq.items, cost)) return false;
    for (const c of cost) takeItem(eq, c.item, c.count);
    this.gliderUpgrades.push(id);
    ctx.bus.emit('glider:upgraded', { name: this.d.data.glider.upgrades.find((u) => u.id === id)?.name ?? id });
    return true;
  }

  /** Tintes del planeador: se pagan con semillas (gratis si ya se compró antes uno igual). */
  setTint(ctx: GameContext, id: string): boolean {
    const t = this.d.data.progression.gliderTints.find((x) => x.id === id);
    const eq = ctx.world.require(this.d.playerEntity, 'combat').equipment;
    if (!t || id === this.tint) return false;
    if (t.cost > 0 && !takeItem(eq, 'forest_seed', t.cost)) return false;
    this.tint = id;
    return true;
  }

  /** Coste en semillas del siguiente hueco extra. */
  nextSlotCost(ctx: GameContext): number | null {
    const eq = ctx.world.require(this.d.playerEntity, 'combat').equipment;
    const bought = eq.slotBonus.weapons + eq.slotBonus.bows + eq.slotBonus.shields;
    return this.d.data.progression.seedSlotCosts[bought] ?? null;
  }

  buySlot(ctx: GameContext, kind: 'weapons' | 'bows' | 'shields'): boolean {
    const cost = this.nextSlotCost(ctx);
    const eq = ctx.world.require(this.d.playerEntity, 'combat').equipment;
    if (cost === null || !takeItem(eq, 'forest_seed', cost)) return false;
    eq.slotBonus[kind]++;
    return true;
  }

  canPay(items: Record<string, number>, cost: { item: string; count: number }[]): boolean {
    return cost.every((c) => (items[c.item] ?? 0) >= c.count);
  }
}
