import * as THREE from 'three';
import { addGear, addItem, type Catalog } from '../combat/inventory';
import { buildShieldModel, buildWeaponModel } from '../combat/WeaponModels';
import type { GameContext, System } from '../core/Game';
import { createTransform } from '../core/ecs/components';
import type { Entity } from '../core/ecs/World';
import { createRng } from '../core/math';
import type { CombatConfig, LootTablesConfig, ValleyConfig } from '../data/schemas';
import { ANCESTRAL_CYAN } from '../world/props/kit';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';

const AUTO_RADIUS = 1.4;

/**
 * Objetos en el suelo: armas y escudos (se cogen con Interactuar), munición y materiales
 * (se recogen al pasar). Los colocados en el valle no reaparecen una vez recogidos.
 */
export class PickupSystem implements System {
  readonly name = 'pickups';
  /** Ids de objetos del valle ya recogidos (se guarda en la partida). */
  readonly collected = new Set<string>();
  private readonly visuals = new Map<Entity, THREE.Object3D>();
  private readonly group = new THREE.Group();
  private readonly rng = createRng(99);
  private time = 0;

  constructor(
    private readonly playerEntity: Entity,
    private readonly catalog: Catalog,
    private readonly loot: LootTablesConfig,
    private readonly limits: CombatConfig['inventory'],
    private readonly terrain: TerrainGenerator,
    private readonly groundAt: (x: number, z: number, fromY: number) => number,
    scene: THREE.Scene,
    ctx: GameContext,
  ) {
    this.group.name = 'pickups';
    scene.add(this.group);
    ctx.bus.on('interact', ({ id, kind }) => {
      if (kind !== 'pickup' || !id.startsWith('pickup:')) return;
      const e = Number(id.slice(7));
      if (ctx.world.isAlive(e)) this.collect(ctx, e);
    });
  }

  /** Coloca los objetos de valley.json que aún no se han recogido. */
  spawnValley(ctx: GameContext, pickups: ValleyConfig['pickups'], collected: Iterable<string>): void {
    for (const e of ctx.world.query('pickup')) this.remove(ctx, e);
    this.collected.clear();
    for (const id of collected) this.collected.add(id);
    for (const p of pickups) {
      if (this.collected.has(p.id)) continue;
      const x = p.position[0];
      const z = p.position[1];
      this.drop(ctx, p.item, p.count, x, this.terrain.height(x, z) + p.yOffset, z, null, p.id);
    }
  }

  /** Deja un objeto en el mundo (botín, arma lanzada, objeto colocado). */
  drop(ctx: GameContext, item: string, count: number, x: number, y: number, z: number, durability: number | null, sourceId: string | null = null): Entity {
    const kind = this.catalog.kindOf(item);
    if (kind === null) throw new Error(`Objeto desconocido: ${item}`);
    const e = ctx.world.createEntity();
    const ground = sourceId ? y : this.groundAt(x, z, y + 1);
    ctx.world.add(e, 'name', { value: `pickup_${item}` });
    ctx.world.add(e, 'transform', createTransform(x, ground, z));
    ctx.world.add(e, 'pickup', { item, count, durability, sourceId, auto: kind === 'item', age: 0 });
    if (kind !== 'item') {
      const name = this.catalog.name(item);
      ctx.world.add(e, 'interactable', { id: `pickup:${e}`, kind: 'pickup', prompt: `Coger ${name}`, radius: 1.8, enabled: true });
    }
    const v = this.buildVisual(item);
    v.position.set(x, ground, z);
    this.group.add(v);
    this.visuals.set(e, v);
    return e;
  }

  /** Tira el botín de un enemigo según su tabla. */
  dropLoot(ctx: GameContext, table: string, x: number, y: number, z: number): void {
    for (const row of this.loot.tables[table] ?? []) {
      if (this.rng() > row.chance) continue;
      const n = row.min + Math.floor(this.rng() * (row.max - row.min + 1));
      if (n <= 0) continue;
      const a = this.rng() * Math.PI * 2;
      this.drop(ctx, row.item, n, x + Math.cos(a) * 0.6, y + 0.3, z + Math.sin(a) * 0.6, null);
    }
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.session.mode !== 'play') return;
    const pt = ctx.world.require(this.playerEntity, 'transform');
    for (const e of ctx.world.query('pickup', 'transform')) {
      const p = ctx.world.require(e, 'pickup');
      p.age += dt;
      if (!p.auto || p.age < 0.5) continue;
      const t = ctx.world.require(e, 'transform');
      if (Math.hypot(t.x - pt.x, t.z - pt.z) < AUTO_RADIUS && Math.abs(t.y - pt.y) < 2) this.collect(ctx, e);
    }
  }

  render(ctx: GameContext): void {
    this.time += ctx.time.frameDt;
    for (const [e, v] of this.visuals) {
      const t = ctx.world.get(e, 'transform');
      if (!t) continue;
      v.rotation.y = this.time * 0.8 + e;
      v.position.y = t.y + 0.25 + Math.sin(this.time * 2 + e) * 0.06;
    }
  }

  private collect(ctx: GameContext, e: Entity): void {
    const p = ctx.world.require(e, 'pickup');
    const combat = ctx.world.require(this.playerEntity, 'combat');
    const kind = this.catalog.kindOf(p.item);
    const name = this.catalog.name(p.item);
    if (kind === 'item') {
      const def = this.catalog.item(p.item);
      const added = addItem(combat.equipment, p.item, p.count, def?.stack ?? 99);
      if (added <= 0) return;
      ctx.bus.emit('item:picked', { item: p.item, name, count: added });
    } else {
      const inst = addGear(combat.equipment, this.catalog, p.item, this.limits, p.durability ?? undefined);
      if (!inst) {
        ctx.bus.emit('item:inventory_full', { name });
        return;
      }
      ctx.bus.emit('item:picked', { item: p.item, name, count: 1 });
    }
    if (p.sourceId) this.collected.add(p.sourceId);
    this.remove(ctx, e);
  }

  private remove(ctx: GameContext, e: Entity): void {
    const v = this.visuals.get(e);
    v?.removeFromParent();
    this.visuals.delete(e);
    ctx.world.destroyEntity(e);
  }

  private buildVisual(item: string): THREE.Object3D {
    const kind = this.catalog.kindOf(item);
    const root = new THREE.Group();
    // Destello en el suelo: "aquí hay algo".
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.45, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: ANCESTRAL_CYAN, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    glow.position.y = -0.22;
    root.add(glow);
    if (kind === 'melee' || kind === 'bow') {
      const w = this.catalog.weapon(item);
      const m = buildWeaponModel(w.model.kind, w.model.length, w.model.color);
      m.group.rotation.z = Math.PI / 2;
      m.group.position.x = -w.model.length * 0.4;
      root.add(m.group);
    } else if (kind === 'shield') {
      const s = this.catalog.shield(item);
      const m = buildShieldModel(s.model.kind, s.model.size, s.model.color);
      m.rotation.x = -Math.PI / 2.4;
      root.add(m);
    } else {
      const def = this.catalog.item(item);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), new THREE.MeshStandardMaterial({ color: def?.color ?? '#ffffff', emissive: def?.color ?? '#ffffff', emissiveIntensity: 0.4 }));
      root.add(gem);
    }
    return root;
  }
}
