import type { ComponentMap, ComponentName } from './components';

export type Entity = number;

/**
 * ECS ligero: entidades como ids numéricos y un almacén (Map) por tipo de componente.
 * Las consultas recorren el almacén más pequeño de los pedidos.
 */
export class World {
  private nextId: Entity = 1;
  private readonly alive = new Set<Entity>();
  private readonly stores = new Map<ComponentName, Map<Entity, unknown>>();

  createEntity(): Entity {
    const id = this.nextId++;
    this.alive.add(id);
    return id;
  }

  destroyEntity(entity: Entity): void {
    if (!this.alive.delete(entity)) return;
    for (const store of this.stores.values()) store.delete(entity);
  }

  isAlive(entity: Entity): boolean {
    return this.alive.has(entity);
  }

  get entityCount(): number {
    return this.alive.size;
  }

  add<K extends ComponentName>(entity: Entity, name: K, data: ComponentMap[K]): ComponentMap[K] {
    if (!this.alive.has(entity)) throw new Error(`World.add: la entidad ${entity} no existe`);
    this.store(name).set(entity, data);
    return data;
  }

  get<K extends ComponentName>(entity: Entity, name: K): ComponentMap[K] | undefined {
    return this.stores.get(name)?.get(entity) as ComponentMap[K] | undefined;
  }

  /** Como `get`, pero lanza si falta: úsalo tras `query`, donde la existencia está garantizada. */
  require<K extends ComponentName>(entity: Entity, name: K): ComponentMap[K] {
    const c = this.get(entity, name);
    if (c === undefined) throw new Error(`Entidad ${entity} sin componente "${name}"`);
    return c;
  }

  has(entity: Entity, name: ComponentName): boolean {
    return this.stores.get(name)?.has(entity) ?? false;
  }

  remove(entity: Entity, name: ComponentName): void {
    this.stores.get(name)?.delete(entity);
  }

  /** Entidades que tienen TODOS los componentes indicados. Devuelve una copia segura de mutar. */
  query(...names: ComponentName[]): Entity[] {
    if (names.length === 0) return [...this.alive];
    const stores = names.map((n) => this.stores.get(n));
    if (stores.some((s) => s === undefined || s.size === 0)) return [];
    const sorted = (stores as Map<Entity, unknown>[]).sort((a, b) => a.size - b.size);
    const [smallest, ...rest] = sorted;
    const result: Entity[] = [];
    for (const entity of smallest.keys()) {
      if (rest.every((s) => s.has(entity))) result.push(entity);
    }
    return result;
  }

  private store(name: ComponentName): Map<Entity, unknown> {
    let s = this.stores.get(name);
    if (!s) {
      s = new Map();
      this.stores.set(name, s);
    }
    return s;
  }
}
