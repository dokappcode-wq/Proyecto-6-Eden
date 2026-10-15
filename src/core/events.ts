import type { EventBus } from './EventBus';
import type { InteractableKind } from './ecs/components';

export type ActionPhase = 'pressed' | 'released';
export type DamageCause = 'fall' | 'drown' | 'enemy' | 'poison' | 'shock' | 'fire' | 'cold' | 'heat' | 'bleed';

/** Catálogo de eventos del juego. Cada fase añade los suyos aquí. */
export interface GameEvents {
  'input:action': { action: string; phase: ActionPhase };
  'input:rebound': { action: string; codes: string[] };

  'session:start': { newGame: boolean };

  'player:jumped': { x: number; y: number; z: number };
  'player:landed': { x: number; y: number; z: number; speed: number; drop: number };
  'player:respawned': { x: number; y: number; z: number };
  'capsule:exited': Record<string, never>;
  'player:damaged': { amount: number; cause: DamageCause; remaining: number };
  'player:died': { cause: DamageCause };
  'player:healed': { remaining: number };
  'player:exhausted': Record<string, never>;
  'player:ledge': { phase: 'contact' | 'boost' | 'exit' | 'release'; x: number; y: number; z: number; mantle: boolean };
  'player:climb': { phase: 'start' | 'jump' | 'topout' };
  'player:glider': { phase: 'deploy' | 'fold'; reason: string };
  'player:glide_land': { x: number; z: number; water: boolean };
  'player:splash': { x: number; y: number; z: number };
  'player:launched': { x: number; y: number; z: number };
  'player:obtained': { item: 'glider' };
  'player:dodge': { perfect: boolean };

  'combat:hit': { x: number; y: number; z: number; damage: number; kind: string; sneak: boolean; weak: boolean; tags: string[] };
  'combat:defended': { result: 'dodged' | 'perfect' | 'blocked' | 'parried'; x: number; y: number; z: number };
  'combat:flurry': { active: boolean };
  'combat:weapon_warning': { name: string };
  'combat:weapon_broken': { name: string; x: number; y: number; z: number };
  'combat:equipped': { slot: 'melee' | 'bow' | 'shield'; name: string };
  'combat:no_arrows': Record<string, never>;
  'enemy:noticed': { entity: number };
  'enemy:alarm': { camp: string; name: string; horn: boolean };
  'enemy:reinforcements': { camp: string; count: number };
  'camp:cleared': { camp: string; name: string };
  'chest:opened': { id: string };
  'boss:engaged': { id: string; name: string; title: string };
  'boss:phase': { id: string; phase: number };
  'boss:defeated': { id: string; name: string; x: number; y: number; z: number };
  'player:status': { kind: 'poison' | 'shock' | 'burn' | 'freeze' | 'bleed'; active: boolean };
  'player:temperature': { band: 'freezing' | 'cold' | 'ok' | 'hot' | 'scorching'; celsius: number };
  'weather:changed': { biome: string; type: string };
  'weather:lightning_warning': Record<string, never>;
  'combat:arrow_type': { name: string; count: number };
  'food:buff': { name: string; active: boolean };
  'food:cooked': { name: string; dubious: boolean };
  'player:blessed': { kind: 'heart' | 'stamina' };
  'armor:upgraded': { name: string; level: number };
  'glider:upgraded': { name: string };
  'debug:teleport': { name: string };
  'enemy:defeated': { entity: number; enemy: string; family: string; x: number; y: number; z: number };
  'item:picked': { item: string; name: string; count: number };
  'item:inventory_full': { name: string };
  'pickup:gathered': { sourceId: string };

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

  // --- Fase 7: movilidad
  'world:explosion': { x: number; y: number; z: number; radius: number; kind: 'fire' | 'wind' | 'rune' };
  'mobility:ability': { ability: 'boots' | 'grapple' | 'wind_bomb' | 'surf' | 'jump_pad' | 'elevator'; phase: 'start' | 'end' };
  'rune:used': { rune: string; target: string };
  'rune:selected': { rune: string; name: string };
  'mount:tamed': { kind: string; name: string };
  'mount:thrown': { kind: string };
  'mount:ride': { kind: string; name: string; active: boolean };
  'raft:board': { id: string; active: boolean };
  'breakable:destroyed': { id: string };
  'hud:note': { text: string; tone: 'good' | 'bad' | 'info' };
}

export type GameEventBus = EventBus<GameEvents>;
