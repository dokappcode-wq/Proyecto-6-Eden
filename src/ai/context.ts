import type { EnemyDef } from '../data/schemas';
import type { ActiveAttack } from './brain';
import type { Body, NavEnv } from './locomotion';

/** El jugador visto por la IA. */
export interface PlayerView {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Altura del suelo bajo el jugador. */
  groundY: number;
  /** En el aire (salto, caída) o planeando. */
  airborne: boolean;
  gliding: boolean;
  alive: boolean;
  inWater: boolean;
}

/** Lo que el campamento le dice a cada miembro. */
export interface GroupView {
  alarm: boolean;
  /** Este miembro es quien debe ir a tocar el cuerno. */
  hornCaller: boolean;
  hornX: number;
  hornZ: number;
  /** Puede tomar un turno de ataque (máx. N atacando a la vez). */
  canTakeToken: boolean;
  regroupX: number;
  regroupZ: number;
}

export type AIEvent =
  | { type: 'attack_start'; attack: ActiveAttack }
  | { type: 'attack_active'; attack: ActiveAttack }
  | { type: 'horn' }
  | { type: 'phase'; phase: number }
  | { type: 'woke' }
  | { type: 'impact'; x: number; y: number; z: number; radius: number };

export interface AIContext {
  dt: number;
  def: EnemyDef;
  player: PlayerView;
  /** Distancia horizontal al jugador. */
  dist: number;
  nav: NavEnv;
  body: Body;
  rng: () => number;
  group: GroupView | null;
  events: AIEvent[];
  /** Peligro cercano del que huir (llamas). */
  hazard: { x: number; z: number } | null;
}

/** Distancia horizontal entre el cerebro y un punto. */
export function flatDist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az);
}
