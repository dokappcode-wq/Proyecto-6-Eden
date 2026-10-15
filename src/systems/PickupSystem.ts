import * as THREE from 'three';
import { addArmor, addGear, addItem, type Catalog } from '../combat/inventory';
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
  private readonly still = new Set<Entity>();

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
    // Las plantas no flotan ni giran: están en el suelo.
    if (sourceId?.startsWith('gather:')) this.still.add(e);
    const v = this.buildVisual(item);
    v.position.set(x, ground + (this.still.has(e) ? 0.22 : 0), z);
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
      if (this.still.has(e)) continue;
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
    } else if (kind === 'armor') {
      addArmor(combat.equipment, this.catalog, p.item);
      ctx.bus.emit('item:picked', { item: p.item, name, count: 1 });
    } else {
      const inst = addGear(combat.equipment, this.catalog, p.item, this.limits, p.durability ?? undefined);
      if (!inst) {
        ctx.bus.emit('item:inventory_full', { name });
        return;
      }
      ctx.bus.emit('item:picked', { item: p.item, name, count: 1 });
    }
    // Las plantas recolectables rebrotan (las gestiona su sistema); el resto no reaparece.
    if (p.sourceId?.startsWith('gather:')) ctx.bus.emit('pickup:gathered', { sourceId: p.sourceId });
    else if (p.sourceId) this.collected.add(p.sourceId);
    this.remove(ctx, e);
  }

  /** Retira un objeto del suelo sin recogerlo (la recolección descarga zonas lejanas). */
  despawn(ctx: GameContext, e: Entity): void {
    if (ctx.world.isAlive(e)) this.remove(ctx, e);
  }

  private remove(ctx: GameContext, e: Entity): void {
    const v = this.visuals.get(e);
    v?.removeFromParent();
    this.visuals.delete(e);
    this.still.delete(e);
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
    } else if (kind === 'armor') {
      const a = this.catalog.armor(item);
      const m = new THREE.MeshStandardMaterial({ color: a.model.color, roughness: 0.6 });
      const piece = new THREE.Mesh(a.slot === 'head' ? new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6) : a.slot === 'boots' ? new THREE.BoxGeometry(0.16, 0.18, 0.28) : a.slot === 'charm' ? new THREE.OctahedronGeometry(0.1, 0) : new THREE.BoxGeometry(0.42, 0.06, 0.34), m);
      piece.castShadow = true;
      root.add(piece);
    } else {
      const def = this.catalog.item(item);
      const color = def?.color ?? '#ffffff';
      const model = def?.food?.model;
      if (model && model !== 'part') {
        glow.visible = false;
        root.add(foodModel(model, color));
      } else {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 }));
        root.add(gem);
      }
    }
    return root;
  }
}

const stemMat = new THREE.MeshStandardMaterial({ color: '#e9e1c8', roughness: 0.8 });
const leafMat = new THREE.MeshStandardMaterial({ color: '#4f8e3c', roughness: 0.8, side: THREE.DoubleSide });

/** Aspecto de un ingrediente en el suelo (fruta, seta, flor, hierba, carne, bicho). */
function foodModel(model: string, color: string): THREE.Object3D {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  switch (model) {
    case 'mushroom':
      add(new THREE.CylinderGeometry(0.035, 0.045, 0.16, 6), stemMat, 0, -0.17, 0);
      add(new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, -0.1, 0);
      break;
    case 'flower':
      add(new THREE.CylinderGeometry(0.01, 0.012, 0.3, 4), leafMat, 0, -0.1, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(new THREE.SphereGeometry(0.045, 6, 4), m, Math.cos(a) * 0.05, 0.06, Math.sin(a) * 0.05);
      }
      break;
    case 'herb':
      for (let i = 0; i < 4; i++) {
        const leaf = add(new THREE.PlaneGeometry(0.06, 0.26), m, 0, -0.1, 0);
        leaf.rotation.y = (i / 4) * Math.PI;
        leaf.rotation.z = 0.2;
      }
      break;
    case 'meat':
      add(new THREE.CapsuleGeometry(0.07, 0.12, 4, 8).rotateZ(Math.PI / 2), m, 0, -0.15, 0);
      break;
    case 'critter':
      add(new THREE.SphereGeometry(0.05, 8, 6), m, 0, -0.17, 0).scale.set(1, 0.6, 1.6);
      break;
    default:
      add(new THREE.SphereGeometry(0.08, 10, 8), m, 0, -0.14, 0);
      add(new THREE.PlaneGeometry(0.06, 0.04), leafMat, 0.03, -0.05, 0);
  }
  return g;
}
