import type { SlimeState } from '../../ai/slime';
import type { DefenseState } from '../../combat/defense';
import type { Equipment } from '../../combat/inventory';
import type { MeleeState } from '../../combat/melee';
import type { CharacterState } from '../../player/CharacterController';
import type { HealthState } from '../../player/movement/Stamina';

/**
 * Componentes = datos puros (sin referencias a Three.js ni al DOM),
 * para que la lógica sea serializable y testeable.
 */

export interface Transform {
  x: number;
  y: number;
  z: number;
  rotY: number;
  // Estado del paso fijo anterior; el render interpola entre prev y actual.
  prevX: number;
  prevY: number;
  prevZ: number;
  prevRotY: number;
}

export interface Name {
  value: string;
}

export type InteractableKind = 'capsule' | 'inscription' | 'temple' | 'portal' | 'altar' | 'tower' | 'pickup';

export interface Interactable {
  id: string;
  kind: InteractableKind;
  /** Texto del aviso ("Abrir cápsula", "Leer"...). */
  prompt: string;
  /** Radio horizontal de interacción (m). */
  radius: number;
  enabled: boolean;
  title?: string;
  text?: string;
}

/** capsule/exiting: tutorial inicial · free: jugable · locked: cinemática, portal o muerte. */
export type PlayerControl = 'capsule' | 'exiting' | 'free' | 'locked';

export interface Player {
  control: PlayerControl;
  /** Progreso (s) de la secuencia de salida de la cápsula. */
  scriptTime: number;
  /** Yaw de la cámara (lo escribe el sistema de cámara; define "adelante"). */
  cameraYaw: number;
  health: HealthState;
}

/** Estado de combate del jugador (equipo, ataque, defensa, arco, fijado, ráfaga...). */
export interface CombatState {
  equipment: Equipment;
  melee: MeleeState;
  defense: DefenseState;
  /** Tensando el arco (s). */
  drawT: number;
  aiming: boolean;
  plunging: boolean;
  /** Ráfaga tras esquiva perfecta: tiempo restante (s) y objetivo. */
  flurryT: number;
  flurryTarget: number | null;
  /** Parada de impacto restante (s, tiempo real). */
  hitstopT: number;
  lockTarget: number | null;
  wheelOpen: boolean;
  /** Objetivos ya golpeados por el barrido actual. */
  swingId: number;
  swingHits: number[];
  /** Modificadores que el sistema de combate pasa al movimiento en este paso. */
  moveMultiplier: number;
  faceYaw: number | null;
  lunge: number;
}

/** Enemigo vivo: definición + cerebro (estado de IA y física propia). */
export interface Enemy {
  defId: string;
  brain: SlimeState;
  spawnId: string;
  /** Tiempo desde la muerte (animación de desaparición); -1 si vive. */
  deadT: number;
}

/** Objeto en el suelo. */
export interface Pickup {
  item: string;
  count: number;
  /** Durabilidad restante (armas soltadas/lanzadas). */
  durability: number | null;
  /** Id del objeto colocado en el valle (para no reaparecer al cargar), o null. */
  sourceId: string | null;
  /** Se recoge al pasar por encima (munición y materiales). */
  auto: boolean;
  age: number;
}

/** Registro de todos los componentes. Cada fase amplía este mapa. */
export interface ComponentMap {
  transform: Transform;
  name: Name;
  interactable: Interactable;
  player: Player;
  character: CharacterState;
  combat: CombatState;
  enemy: Enemy;
  pickup: Pickup;
}

export type ComponentName = keyof ComponentMap;

export function createTransform(x = 0, y = 0, z = 0, rotY = 0): Transform {
  return { x, y, z, rotY, prevX: x, prevY: y, prevZ: z, prevRotY: rotY };
}

/** Teletransporte: fija también el estado previo para que el render no interpole el salto. */
export function teleportTransform(t: Transform, x: number, y: number, z: number, rotY = t.rotY): void {
  t.x = t.prevX = x;
  t.y = t.prevY = y;
  t.z = t.prevZ = z;
  t.rotY = t.prevRotY = rotY;
}
