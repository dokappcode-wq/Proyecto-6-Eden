import type { EventBus } from './EventBus';
import type { InteractableKind } from './ecs/components';

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
  'player:damaged': { amount: number; cause: 'fall' | 'drown'; remaining: number };
  'player:died': { cause: 'fall' | 'drown' };
  'player:healed': { remaining: number };
  'player:exhausted': Record<string, never>;
  'player:ledge': { phase: 'contact' | 'boost' | 'exit' | 'release'; x: number; y: number; z: number; mantle: boolean };
  'player:climb': { phase: 'start' | 'jump' | 'topout' };
  'player:glider': { phase: 'deploy' | 'fold'; reason: string };
  'player:glide_land': { x: number; z: number; water: boolean };
  'player:splash': { x: number; y: number; z: number };
  'player:launched': { x: number; y: number; z: number };
  'player:obtained': { item: 'glider' };

  'interaction:focus': { id: string; prompt: string } | null;
  interact: { id: string; kind: InteractableKind };
  'inscription:open': { id: string; title: string; text: string };
  'inscription:close': Record<string, never>;

  'tutorial:hint': { title: string | null; text: string };
  'tutorial:step_completed': { id: string; title: string; order: number };

  'valley:gate_open_requested': { reason: string };
  'tower:activated': { id: string };
  'temple:enter': { id: string };
  'temple:complete': { id: string };
  'temple:exit': { id: string };
  'camera:cinematic': { id: string; active: boolean };
  'screen:fade': { to: 'black' | 'clear'; seconds: number; text?: string };
  'valley:gate_opened': Record<string, never>;

  'game:saved': { slot: string };
  'world:loaded': { chunks: number; colliders: number };
}

export type GameEventBus = EventBus<GameEvents>;
