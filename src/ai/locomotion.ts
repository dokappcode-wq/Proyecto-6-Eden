import type { Brain } from './brain';
import { turnToward } from './brain';

export const GRAVITY = 25;

/** Lo que la IA necesita saber del escenario para moverse (sin Three.js: testeable). */
export interface NavEnv {
  /** Altura del suelo (terreno o cara superior de un colisionador) que no esté por encima de `fromY`. */
  groundAt(x: number, z: number, fromY: number): number;
  /** Profundidad del agua sobre el suelo (0 si está seco). */
  waterDepth(x: number, z: number, groundY: number): number;
  /** ¿Un cilindro (pies, radio, altura) choca con algún colisionador? */
  blocked(x: number, y: number, z: number, radius: number, height: number): boolean;
  /** Saca un cilindro de los colisionadores. */
  pushOut(pos: { x: number; y: number; z: number }, radius: number, height: number, stepHeight: number): void;
}

export interface Body {
  radius: number;
  height: number;
  /** Escalón máximo que sube (los golems no persiguen por bordes). */
  maxStep: number;
  /** Profundidad de agua que acepta pisar. */
  maxWater: number;
  turnSpeed: number;
}

/** ¿Se puede avanzar en esa dirección? (sin pared, escalón asumible, sin agua profunda). */
export function canStep(b: Brain, dx: number, dz: number, look: number, env: NavEnv, body: Body): boolean {
  const px = b.x + dx * (look + body.radius);
  const pz = b.z + dz * (look + body.radius);
  const g = env.groundAt(px, pz, b.y + body.maxStep + 0.5);
  if (g > b.y + body.maxStep + look * 0.6) return false;
  if (g < b.y - 3.5) return false; // precipicio
  if (env.waterDepth(px, pz, g) > body.maxWater) return false;
  return !env.blocked(px, Math.max(g, b.y) + body.maxStep, pz, body.radius, body.height - body.maxStep);
}

const PROBES = [0, 0.55, -0.55, 1.1, -1.1, 1.7, -1.7, 2.4, -2.4];

/** Dirección libre más parecida a la deseada (rodea rocas y muros), o null. */
export function freeDirection(b: Brain, dx: number, dz: number, look: number, env: NavEnv, body: Body): [number, number] | null {
  const base = Math.atan2(dx, dz);
  for (const off of PROBES) {
    const a = base + off * b.side;
    const ddx = Math.sin(a);
    const ddz = Math.cos(a);
    if (canStep(b, ddx, ddz, look, env, body)) return [ddx, ddz];
  }
  // Atascado: la próxima vez prueba primero el otro lado.
  b.side = -b.side;
  return null;
}

/**
 * Camina hacia (tx,tz) a `speed` m/s con aceleración, evitación de obstáculos,
 * gravedad y ajuste al suelo. Devuelve la distancia restante.
 */
export function walkToward(b: Brain, tx: number, tz: number, speed: number, dt: number, env: NavEnv, body: Body, stopAt = 0.3, face = true): number {
  const dx = tx - b.x;
  const dz = tz - b.z;
  const dist = Math.hypot(dx, dz);
  let wantX = 0;
  let wantZ = 0;
  if (dist > stopAt && speed > 0) {
    const dir = freeDirection(b, dx / dist, dz / dist, Math.min(1.2, dist), env, body);
    if (dir) {
      const s = Math.min(speed, (dist - stopAt) * 3 + 0.4);
      wantX = dir[0] * s;
      wantZ = dir[1] * s;
    }
  }
  accelerate(b, wantX, wantZ, b.grounded ? 9 : 1.5, dt);
  if (face && Math.hypot(b.vx, b.vz) > 0.4) turnToward(b, Math.atan2(b.vx, b.vz), body.turnSpeed, dt);
  integrate(b, dt, env, body);
  return dist;
}

/** Se aleja de (fx,fz) buscando un camino libre. */
export function fleeFrom(b: Brain, fx: number, fz: number, speed: number, dt: number, env: NavEnv, body: Body): void {
  const dx = b.x - fx;
  const dz = b.z - fz;
  const d = Math.hypot(dx, dz) || 1;
  walkToward(b, b.x + (dx / d) * 8, b.z + (dz / d) * 8, speed, dt, env, body, 0.1);
}

/** Se desplaza lateralmente alrededor de (cx,cz) a la distancia `radius` (flanquear). */
export function circleAround(b: Brain, cx: number, cz: number, radius: number, speed: number, dt: number, env: NavEnv, body: Body): void {
  const a = Math.atan2(b.x - cx, b.z - cz) + (b.side * speed * dt) / Math.max(1, radius) * 4;
  walkToward(b, cx + Math.sin(a) * radius, cz + Math.cos(a) * radius, speed, dt, env, body, 0.2, false);
  turnToward(b, Math.atan2(cx - b.x, cz - b.z), body.turnSpeed, dt);
}

/** Frena y aplica física sin intención de moverse. */
export function standStill(b: Brain, dt: number, env: NavEnv, body: Body): void {
  accelerate(b, 0, 0, b.grounded ? 8 : 0.5, dt);
  integrate(b, dt, env, body);
}

export function accelerate(b: Brain, wantX: number, wantZ: number, sharp: number, dt: number): void {
  const k = 1 - Math.exp(-sharp * dt);
  b.vx += (wantX - b.vx) * k;
  b.vz += (wantZ - b.vz) * k;
}

/** Gravedad, suelo y colisiones (no sube escalones mayores que `maxStep`). */
export function integrate(b: Brain, dt: number, env: NavEnv, body: Body): void {
  const nx = b.x + b.vx * dt;
  const nz = b.z + b.vz * dt;
  const g = env.groundAt(nx, nz, b.y + body.maxStep + 0.3);
  if (b.grounded && g > b.y + body.maxStep) {
    // Pared o escalón demasiado alto: no avanza.
    b.vx = 0;
    b.vz = 0;
  } else {
    b.x = nx;
    b.z = nz;
  }
  const ground = env.groundAt(b.x, b.z, b.y + body.maxStep + 0.3);
  if (b.grounded) {
    if (ground < b.y - 0.7) {
      b.grounded = false;
      b.vy = 0;
    } else {
      b.y = ground;
      b.vy = 0;
    }
  }
  if (!b.grounded) {
    b.vy -= GRAVITY * dt;
    b.y += b.vy * dt;
    if (b.y <= ground) {
      b.y = ground;
      b.vy = 0;
      b.grounded = true;
      b.squash = Math.max(b.squash, 0.25);
    }
  }
  const pos = { x: b.x, y: b.y, z: b.z };
  env.pushOut(pos, body.radius, body.height, body.maxStep);
  b.x = pos.x;
  b.z = pos.z;
  b.speed = Math.hypot(b.vx, b.vz);
  b.anim += dt * (0.6 + b.speed);
}
