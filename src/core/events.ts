import type { EventBus } from './EventBus';

export type ActionPhase = 'pressed' | 'released';

/** Catálogo de eventos del juego. Cada fase añade los suyos aquí. */
export interface GameEvents {
  'input:action': { action: string; phase: ActionPhase };
  'input:rebound': { action: string; codes: string[] };

  'session:start': { newGame: boolean };

  'player:jumped': { x: number; y: number; z: number };
  'player:landed': { x: number; y: number; z: number; speed: number; drop: number };
  'player:respawned': { x: number; y: number; z: number };
  'capsule:exited': Record<string, never>;

  'interaction:focus': { id: string; prompt: string } | null;
  interact: { id: string; kind: 'capsule' | 'inscription' };
  'inscription:open': { id: string; title: string; text: string };
  'inscription:close': Record<string, never>;

  'tutorial:hint': { title: string | null; text: string };
  'tutorial:step_completed': { id: string; title: string; order: number };

  'valley:gate_open_requested': { reason: string };
  'valley:gate_opened': Record<string, never>;

  'game:saved': { slot: string };
  'world:loaded': { chunks: number; colliders: number };
}

export type GameEventBus = EventBus<GameEvents>;
