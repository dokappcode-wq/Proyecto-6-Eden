import type { EventBus } from './EventBus';

export type ActionPhase = 'pressed' | 'released';

/** Catálogo de eventos del juego. Cada fase añade los suyos aquí. */
export interface GameEvents {
  'input:action': { action: string; phase: ActionPhase };
  'input:rebound': { action: string; codes: string[] };
  'world:loaded': { entityCount: number };
}

export type GameEventBus = EventBus<GameEvents>;
