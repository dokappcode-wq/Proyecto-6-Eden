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

export type ShapeKind = 'box' | 'sphere' | 'cylinder';

export interface Renderable {
  shape: ShapeKind;
  size: [number, number, number];
  color: string;
  emissive?: string;
}

export interface Spin {
  /** Radianes por segundo sobre el eje Y. */
  speed: number;
}

export interface Name {
  value: string;
}

/** Registro de todos los componentes. Cada fase amplía este mapa. */
export interface ComponentMap {
  transform: Transform;
  renderable: Renderable;
  spin: Spin;
  name: Name;
}

export type ComponentName = keyof ComponentMap;

export function createTransform(x = 0, y = 0, z = 0, rotY = 0): Transform {
  return { x, y, z, rotY, prevX: x, prevY: y, prevZ: z, prevRotY: rotY };
}
