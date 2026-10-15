import * as THREE from 'three';
import { equipped, type Catalog } from '../combat/inventory';
import type { HitFx } from '../combat/HitFx';
import type { GameContext, System } from '../core/Game';
import type { Entity } from '../core/ecs/World';
import { createRng } from '../core/math';
import type { Element, ElementsConfig } from '../data/schemas';
import { ElementView } from '../world/elements/ElementView';
import { FireField } from '../world/elements/FireField';
import { IceField } from '../world/elements/IceField';
import type { Airflow } from '../world/airflow/Airflow';
import type { Collider, StaticColliders } from '../world/physics/StaticColliders';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import type { EnemySystem } from './EnemySystem';

/** Ganchos hacia el combate del jugador (daño con elemento y estados). */
export interface PlayerHooks {
  hurt(ctx: GameContext, damage: number, element: Element, fromX: number, fromZ: number, knockback: number): void;
  status(ctx: GameContext, kind: 'burn' | 'freeze'): void;
  dropWeapon(ctx: GameContext, id: string, x: number, y: number, z: number): void;
}

export interface ElementDeps {
  cfg: ElementsConfig;
  playerEntity: Entity;
  terrain: TerrainGenerator;
  colliders: StaticColliders;
  enemies: EnemySystem;
  catalog: Catalog;
  fx: HitFx;
  airflow: Airflow;
  scene: THREE.Scene;
  /** Lluvia 0..1 y viento (m/s) en la posición del jugador. */
  rain: () => number;
  wind: () => { x: number; z: number };
  /** Hogueras fijas (campamentos): reencienden la antorcha y dan calor. */
  campfires: [number, number][];
}

/**
 * Sistemas elementales del mundo: el fuego se propaga por la hierba (a favor del viento),
 * genera corrientes térmicas y quema; el hielo congela agua (plataformas) y enemigos;
 * la electricidad aturde y se propaga por el agua; los rayos de tormenta caen (y buscan el metal).
 */
export class ElementSystem implements System {
  readonly name = 'elements';
  readonly fire: FireField;
  readonly ice: IceField;
  readonly view: ElementView;
  /** La antorcha equipada está encendida. */
  torchLit = true;
  hooks: PlayerHooks | null = null;
  private readonly iceColliders = new Map<number, Collider>();
  private readonly torchLight = new THREE.PointLight('#ffb35a', 0, 14, 1.8);
  private readonly rng = createRng(4242);
  private readonly normal = { x: 0, y: 1, z: 0 };

  constructor(private readonly d: ElementDeps) {
    const t = d.terrain;
    this.fire = new FireField(
      d.cfg.fire,
      (x, z) => {
        const h = t.height(x, z);
        const w = t.waterLevelAt(x, z);
        if (w !== null && w > h - 0.1) return false;
        t.normal(x, z, this.normal);
        return t.materialAt(x, z, this.normal.y) === 'grass';
      },
      (x, z) => t.height(x, z),
    );
    this.ice = new IceField(d.cfg.ice);
    this.view = new ElementView(d.cfg.fire.maxCells);
    d.scene.add(this.view.group, this.torchLight);
    // El incendio es una corriente térmica para el planeador.
    d.airflow.addSource((x, y, z) => this.fire.liftAt(x, y, z));
    d.enemies.fireNear = (x, z, r) => this.fire.nearest(x, z, r);
  }

  /** ¿Hay agua en este punto? Devuelve su nivel o null. */
  waterAt(x: number, z: number): number | null {
    const w = this.d.terrain.waterLevelAt(x, z);
    return w !== null && w > this.d.terrain.height(x, z) + 0.2 ? w : null;
  }

  // ------------------------------------------------------------------ efectos (proyectiles, bastones, antorcha, rayos)

  /** Aplica un elemento en un punto del mundo (impacto de flecha o bastón). */
  applyAt(ctx: GameContext, element: Element, x: number, y: number, z: number, radius: number): void {
    switch (element) {
      case 'fire':
        this.igniteAt(ctx, x, y, z, radius);
        break;
      case 'ice':
        this.freezeAt(ctx, x, y, z, radius);
        break;
      case 'shock':
        this.shockAt(ctx, x, y, z, radius);
        break;
      default:
        break;
    }
  }

  igniteAt(ctx: GameContext, x: number, y: number, z: number, radius: number): void {
    const water = this.waterAt(x, z);
    if (water !== null && y < water + 0.5) {
      this.d.fx.burst(x, water, z, 'gel', 6); // chisporroteo al tocar el agua
      return;
    }
    this.ice.melt(x, z, Math.max(1, radius));
    const n = radius > 0 ? this.fire.igniteArea(x, z, radius, this.d.rain()) : this.fire.ignite(x, z, this.d.rain()) ? 1 : 0;
    this.d.fx.burst(x, y + 0.3, z, 'spark', n > 0 ? 10 : 4);
    if (radius > 0) this.affectEnemies(ctx, x, y, z, radius, 'fire');
  }

  freezeAt(ctx: GameContext, x: number, y: number, z: number, radius: number): void {
    this.fire.extinguish(x, z, Math.max(2, radius + 1));
    const water = this.waterAt(x, z);
    if (water !== null && Math.abs(y - water) < 2) {
      // Hielo + agua = plataforma.
      const p = this.ice.freeze(x, z, water, Math.max(this.d.cfg.ice.platformRadius, radius));
      if (!this.iceColliders.has(p.id)) {
        const r = p.radius * 0.82;
        this.iceColliders.set(p.id, this.d.colliders.addBox(p.x, p.y, p.z, r, 0.3, r, 0, 'ice'));
        this.view.addIce(p);
      }
    }
    this.d.fx.burst(x, y + 0.3, z, 'parry', 12);
    this.affectEnemies(ctx, x, y, z, Math.max(1.2, radius), 'ice');
  }

  /** Descarga: aturde alrededor y, en el agua, se propaga mucho más lejos. */
  shockAt(ctx: GameContext, x: number, y: number, z: number, radius: number): void {
    const water = this.waterAt(x, z);
    const inWater = water !== null && y < water + 1.2;
    const r = inWater ? Math.max(radius, this.d.cfg.shock.waterRadius) : Math.max(1.2, radius);
    this.d.fx.burst(x, y + 0.3, z, 'spark', inWater ? 30 : 14);
    if (inWater) this.d.fx.ring(x, water ?? y, z, r, '#fff27a');
    for (const e of ctx.world.query('enemy')) {
      const en = ctx.world.require(e, 'enemy');
      if (en.deadT >= 0) continue;
      const b = en.brain;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d > r || Math.abs(b.y - y) > 3) continue;
      if (inWater && !this.d.enemies.inWater(b) && d > Math.max(1.2, radius)) continue;
      this.hitEnemy(ctx, e, 'shock', this.d.cfg.shock.damage);
    }
    // El jugador en el agua cerca de una descarga también la sufre.
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    if (inWater && (ch.swimming || ch.waterDepth > 0.3) && Math.hypot(ch.x - x, ch.z - z) < r) this.hooks?.hurt(ctx, this.d.cfg.shock.damage, 'shock', x, z, 3);
  }

  /** Rayo de tormenta en (x,z): daña, aturde y quema alrededor. */
  strikeLightning(ctx: GameContext, x: number, z: number): void {
    const y = Math.max(this.d.terrain.height(x, z), this.d.colliders.topAt(x, z, 0.5, 1e4));
    const L = this.d.cfg.lightning;
    this.view.bolt(x, y, z, this.rng);
    this.d.fx.burst(x, y + 0.5, z, 'spark', 30);
    this.d.fx.ring(x, y, z, L.radius * 1.6, '#eef6ff');
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    if (Math.hypot(ch.x - x, ch.z - z) < L.radius && Math.abs(ch.y - y) < 4) this.hooks?.hurt(ctx, L.damage, 'shock', x, z, 9);
    this.affectEnemies(ctx, x, y, z, L.radius, 'shock', L.damage * 2);
    this.fire.igniteArea(x, z, 2, this.d.rain() * 0.5);
    const water = this.waterAt(x, z);
    if (water !== null) this.shockAt(ctx, x, water, z, this.d.cfg.shock.waterRadius);
  }

  private affectEnemies(ctx: GameContext, x: number, y: number, z: number, radius: number, element: Element, damage = 0): void {
    for (const e of ctx.world.query('enemy')) {
      const en = ctx.world.require(e, 'enemy');
      if (en.deadT >= 0) continue;
      const b = en.brain;
      if (Math.hypot(b.x - x, b.z - z) > radius + this.d.enemies.def(en.defId).radius || Math.abs(b.y - y) > 4) continue;
      this.hitEnemy(ctx, e, element, damage);
    }
  }

  private hitEnemy(ctx: GameContext, e: Entity, element: Element, damage: number): void {
    const en = ctx.world.require(e, 'enemy');
    const b = en.brain;
    if (damage > 0) {
      const killed = this.d.enemies.hit(ctx, e, damage, { fromX: b.x, fromZ: b.z, knockback: 0, stagger: true, stun: 0 });
      if (killed) {
        this.d.enemies.killHandler?.(ctx, e);
        return;
      }
    }
    const r = this.d.enemies.elementHit(ctx, e, element);
    if (r.dropWeapon) this.hooks?.dropWeapon(ctx, r.dropWeapon, b.x, b.y + 1, b.z);
  }

  // ------------------------------------------------------------------ paso

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    const wdt = dt * ctx.time.worldScale;
    if (wdt <= 0) return;
    const wind = this.d.wind();
    const rain = this.d.rain();
    for (const c of this.fire.step(wdt, wind.x, wind.z, rain, this.rng)) if (this.rng() < 0.15) this.d.fx.burst(c.x, c.y + 0.6, c.z, 'spark', 2);
    for (const p of this.ice.step(wdt, (x, z) => this.fire.burningNear(x, z, 3))) {
      const col = this.iceColliders.get(p.id);
      if (col) this.d.colliders.remove(col);
      this.iceColliders.delete(p.id);
      this.view.removeIce(p.id);
      this.d.fx.burst(p.x, p.y + 0.2, p.z, 'parry', 6);
    }
    for (const p of this.ice.platforms) this.view.updateIce(p, this.d.cfg.ice.meltSeconds);

    // El jugador pisando llamas se quema.
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    const ground = this.d.terrain.height(ch.x, ch.z);
    if (ch.y - ground < 1.2 && ch.mode !== 'glide' && this.fire.isBurning(ch.x, ch.z)) this.hooks?.status(ctx, 'burn');

    // Enemigos dentro del fuego.
    for (const e of ctx.world.query('enemy')) {
      const en = ctx.world.require(e, 'enemy');
      if (en.deadT >= 0 || en.brain.burnT > 0 || en.brain.kind === 'hawk') continue;
      if (this.fire.isBurning(en.brain.x, en.brain.z)) this.d.enemies.elementHit(ctx, e, 'fire');
    }

    // Antorcha: se apaga con lluvia o agua y se reaviva junto a cualquier fuego.
    const c = ctx.world.require(this.d.playerEntity, 'combat');
    const m = equipped(c.equipment, 'melee');
    const holdingTorch = m !== null && this.d.catalog.weapon(m.id).tags.includes('torch');
    if (holdingTorch) {
      if (rain > 0.3 || ch.swimming || ch.waterDepth > 0.8) this.torchLit = false;
      else if (!this.torchLit && (this.fire.burningNear(ch.x, ch.z, 2.5) > 0 || this.d.campfires.some(([fx, fz]) => Math.hypot(ch.x - fx, ch.z - fz) < 2.6))) this.torchLit = true;
    }
    this.torchLight.intensity = holdingTorch && this.torchLit ? 9 : 0;
    this.torchLight.position.set(ch.x, ch.y + 1.7, ch.z);
  }

  render(ctx: GameContext): void {
    this.view.update(this.fire, ctx.time.elapsed, ctx.time.frameDt * ctx.time.worldScale);
  }

  /** ¿El arma cuerpo a cuerpo equipada es una antorcha encendida? */
  torchActive(ctx: GameContext): boolean {
    const c = ctx.world.require(this.d.playerEntity, 'combat');
    const m = equipped(c.equipment, 'melee');
    return m !== null && this.d.catalog.weapon(m.id).tags.includes('torch') && this.torchLit;
  }

  /** Calor cerca del jugador (°C extra): llamas, hogueras y antorcha. */
  warmthAt(ctx: GameContext, x: number, z: number): number {
    const T = this.d.cfg.temperature;
    let w = 0;
    if (this.fire.burningNear(x, z, T.fireRadius) > 0) w = T.fireWarmth;
    for (const [fx, fz] of this.d.campfires) {
      const d = Math.hypot(x - fx, z - fz);
      if (d < T.fireRadius) w = Math.max(w, T.fireWarmth * (1 - d / T.fireRadius) + 4);
    }
    if (this.torchActive(ctx)) w = Math.max(w, T.fireWarmth * 0.6);
    return w;
  }

  clear(): void {
    this.fire.clear();
    for (const p of this.ice.platforms) {
      const col = this.iceColliders.get(p.id);
      if (col) this.d.colliders.remove(col);
      this.view.removeIce(p.id);
    }
    this.ice.platforms.length = 0;
    this.iceColliders.clear();
  }
}
