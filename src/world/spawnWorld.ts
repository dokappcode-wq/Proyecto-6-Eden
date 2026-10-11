import { createTransform } from '../core/ecs/components';
import type { Entity, World } from '../core/ecs/World';
import type { GameEventBus } from '../core/events';
import type { EntityDef, WorldConfig } from '../data/schemas';

/** Crea una entidad a partir de su definición de datos. */
export function spawnEntity(world: World, def: EntityDef): Entity {
  const e = world.createEntity();
  world.add(e, 'name', { value: def.name });
  world.add(e, 'transform', createTransform(def.position[0], def.position[1], def.position[2], def.rotationY ?? 0));
  if (def.renderable) {
    world.add(e, 'renderable', {
      shape: def.renderable.shape,
      size: [def.renderable.size[0], def.renderable.size[1], def.renderable.size[2]],
      color: def.renderable.color,
      emissive: def.renderable.emissive,
    });
  }
  if (def.spin) world.add(e, 'spin', { speed: def.spin.speed });
  return e;
}

/** Puebla el mundo con las entidades declaradas en world.json. */
export function spawnWorld(world: World, config: WorldConfig, bus: GameEventBus): Entity[] {
  const entities = config.entities.map((def) => spawnEntity(world, def));
  bus.emit('world:loaded', { entityCount: entities.length });
  return entities;
}
