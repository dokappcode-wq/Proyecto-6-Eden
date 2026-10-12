import { wrapAngle } from '../core/math';
import type { EnemyDef } from '../data/schemas';

export type SlimeMode = 'idle' | 'alert' | 'chase' | 'windup' | 'lunge' | 'recover' | 'stunned' | 'dead';

export interface SlimeState {
  mode: SlimeMode;
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  grounded: boolean;
  hp: number;
  /** Ha detectado al jugador (si no, recibe golpes críticos por sigilo). */
  aware: boolean;
  hopTimer: number;
  homeX: number;
  homeZ: number;
  wanderX: number;
  wanderZ: number;
  /** El ataque actual ya golpeó (un impacto por embestida). */
  attackHit: boolean;
  /** Tiempo desde el último daño recibido (para la barra de vida). */
  sinceDamage: number;
  /** Squash visual (impulso). */
  squash: number;
}

export interface SlimePerception {
  x: number;
  y: number;
  z: number;
  /** Multiplicador del radio de detección (agachado < 1). */
  detectFactor: number;
  alive: boolean;
}

export interface SlimeStepEvents {
  noticed: boolean;
  attackStarted: boolean;
  /** La embestida está activa y puede golpear este paso. */
  attackActive: boolean;
  landed: boolean;
}

const GRAVITY = 25;

export function createSlime(def: EnemyDef, x: number, y: number, z: number, seed: number): SlimeState {
  return {
    mode: 'idle',
    t: 0,
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: seed * Math.PI * 2,
    grounded: true,
    hp: def.hp,
    aware: false,
    hopTimer: seed * def.hopInterval * 2,
    homeX: x,
    homeZ: z,
    wanderX: x,
    wanderZ: z,
    attackHit: false,
    sinceDamage: 999,
    squash: 0,
  };
}

/**
 * IA del slime normal (máquina de estados simple; la Fase 4 añade percepción completa):
 * deambula a saltitos → detecta (!) → persigue saltando → se encoge (aviso) → embiste → se recupera.
 * Incluye su propia física de saltos sobre el suelo dado por `groundAt`.
 */
export function stepSlime(s: SlimeState, def: EnemyDef, p: SlimePerception, groundAt: (x: number, z: number) => number, rng: () => number, dt: number): SlimeStepEvents {
  const ev: SlimeStepEvents = { noticed: false, attackStarted: false, attackActive: false, landed: false };
  s.t += dt;
  s.sinceDamage += dt;
  s.squash *= Math.exp(-6 * dt);
  if (s.mode === 'dead') return ev;

  const dx = p.x - s.x;
  const dz = p.z - s.z;
  const dist = Math.hypot(dx, dz);
  // Ve de frente; por detrás solo «oye» a poca distancia (permite los ataques por sorpresa).
  const facing = dist < 1e-3 ? 1 : (dx * Math.sin(s.yaw) + dz * Math.cos(s.yaw)) / dist;
  const inView = facing >= Math.cos(((def.viewAngle / 2) * Math.PI) / 180);
  const range = def.aggroRadius * p.detectFactor * (inView ? 1 : def.rearSense);
  const sees = p.alive && dist < range && Math.abs(p.y - s.y) < 6;

  const hopToward = (tx: number, tz: number, speed: number, interval: number) => {
    if (!s.grounded) return;
    s.hopTimer -= dt;
    if (s.hopTimer > 0) {
      s.vx *= Math.exp(-10 * dt);
      s.vz *= Math.exp(-10 * dt);
      return;
    }
    const hx = tx - s.x;
    const hz = tz - s.z;
    const hl = Math.hypot(hx, hz);
    s.hopTimer = interval * (0.8 + rng() * 0.4);
    if (hl < 0.3) return;
    s.yaw = Math.atan2(hx, hz);
    const air = (2 * Math.sqrt(2 * GRAVITY * def.hopHeight)) / GRAVITY;
    const v = Math.min(speed, hl / air);
    s.vx = (hx / hl) * v;
    s.vz = (hz / hl) * v;
    s.vy = Math.sqrt(2 * GRAVITY * def.hopHeight);
    s.grounded = false;
    s.squash = 0.35;
  };

  switch (s.mode) {
    case 'idle':
      if (sees) {
        s.mode = 'alert';
        s.t = 0;
        s.aware = true;
        ev.noticed = true;
        break;
      }
      if (Math.hypot(s.wanderX - s.x, s.wanderZ - s.z) < 0.6 || s.t > 6) {
        const a = rng() * Math.PI * 2;
        const r = rng() * 5;
        s.wanderX = s.homeX + Math.cos(a) * r;
        s.wanderZ = s.homeZ + Math.sin(a) * r;
        s.t = 0;
      }
      hopToward(s.wanderX, s.wanderZ, def.moveSpeed * 0.5, def.hopInterval * 1.8);
      break;
    case 'alert':
      s.yaw = s.yaw + wrapAngle(Math.atan2(dx, dz) - s.yaw) * Math.min(1, dt * 10);
      if (s.t > 0.5) {
        s.mode = 'chase';
        s.t = 0;
      }
      break;
    case 'chase':
      if (!p.alive || dist > def.loseRadius) {
        s.mode = 'idle';
        s.t = 0;
        s.aware = false;
        break;
      }
      if (dist <= def.attackRange && s.grounded) {
        s.mode = 'windup';
        s.t = 0;
        s.vx = s.vz = 0;
        ev.attackStarted = true;
        break;
      }
      hopToward(p.x, p.z, def.moveSpeed, def.hopInterval);
      break;
    case 'windup':
      s.yaw = Math.atan2(dx, dz);
      s.squash = Math.max(s.squash, 0.45 * Math.min(1, s.t / def.attackWindup));
      if (s.t >= def.attackWindup) {
        const l = dist || 1;
        s.vx = (dx / l) * def.lungeSpeed;
        s.vz = (dz / l) * def.lungeSpeed;
        s.vy = 5;
        s.grounded = false;
        s.mode = 'lunge';
        s.t = 0;
        s.attackHit = false;
      }
      break;
    case 'lunge':
      ev.attackActive = !s.attackHit && s.t < def.lungeTime;
      if (s.grounded && s.t > 0.1) {
        s.mode = 'recover';
        s.t = 0;
      }
      break;
    case 'recover':
      s.vx *= Math.exp(-8 * dt);
      s.vz *= Math.exp(-8 * dt);
      if (s.t >= def.attackCooldown) {
        s.mode = 'chase';
        s.t = 0;
      }
      break;
    case 'stunned':
      s.vx *= Math.exp(-5 * dt);
      s.vz *= Math.exp(-5 * dt);
      if (s.t >= def.stunTime) {
        s.mode = 'chase';
        s.t = 0;
        s.aware = true;
      }
      break;
  }

  // Física: gravedad y suelo.
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  const g = groundAt(s.x, s.z);
  if (!s.grounded) {
    s.vy -= GRAVITY * dt;
    s.y += s.vy * dt;
    if (s.y <= g) {
      s.y = g;
      s.vy = 0;
      s.grounded = true;
      s.squash = Math.max(s.squash, 0.3);
      ev.landed = true;
    }
  } else {
    s.y = g;
  }
  return ev;
}

/** Aplica un golpe: daño, retroceso y aturdimiento breve. Devuelve true si muere. */
export function hitSlime(s: SlimeState, def: EnemyDef, damage: number, fromX: number, fromZ: number, knockback: number, stun: number): boolean {
  if (s.mode === 'dead') return false;
  s.hp -= damage;
  s.sinceDamage = 0;
  s.aware = true;
  s.squash = 0.6;
  const dx = s.x - fromX;
  const dz = s.z - fromZ;
  const l = Math.hypot(dx, dz) || 1;
  const k = knockback * (1 - def.knockbackResist);
  s.vx = (dx / l) * k;
  s.vz = (dz / l) * k;
  s.vy = Math.min(4, 1 + k * 0.4);
  s.grounded = false;
  if (s.hp <= 0) {
    s.mode = 'dead';
    s.t = 0;
    return true;
  }
  s.mode = 'stunned';
  s.t = Math.max(0, def.stunTime - stun);
  return false;
}
