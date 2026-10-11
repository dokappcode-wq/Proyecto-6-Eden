import type { CharacterState } from '../../player/CharacterController';

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

export type InteractableKind = 'capsule' | 'inscription';

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

export type PlayerControl = 'capsule' | 'exiting' | 'free';

export interface Player {
  control: PlayerControl;
  /** Progreso (s) de la secuencia de salida de la cápsula. */
  scriptTime: number;
  /** Yaw de la cámara (lo escribe el sistema de cámara; define "adelante"). */
  cameraYaw: number;
}

/** Registro de todos los componentes. Cada fase amplía este mapa. */
export interface ComponentMap {
  transform: Transform;
  name: Name;
  interactable: Interactable;
  player: Player;
  character: CharacterState;
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
