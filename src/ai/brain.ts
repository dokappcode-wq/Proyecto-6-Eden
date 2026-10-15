import { wrapAngle } from '../core/math';
import type { AttackDef, CampRole, EnemyDef } from '../data/schemas';
import { HEARING_CAP, type SenseResult } from './perception';

/**
 * Estados de la IA (máquina de estados común a todas las familias):
 * Dormido / Quieto / Patrulla (tranquilos) → Alerta (?) → Combate (!) → Búsqueda → Reagrupar,
 * y Huida cuando cae el líder o la moral.
 */
export type AIState = 'sleep' | 'idle' | 'patrol' | 'suspicious' | 'combat' | 'search' | 'flee' | 'regroup' | 'dead';

/** Qué hace un enemigo tranquilo (lo decide su rutina o su campamento). */
export type Activity = 'wander' | 'guard' | 'patrol' | 'cook' | 'sleep' | 'lookout' | 'horn' | 'dormant' | 'circle' | 'hold';

export type BrainKind = 'slime' | 'goblin' | 'golem' | 'hawk';

export interface ActiveAttack {
  def: AttackDef;
  phase: 'windup' | 'active' | 'recovery';
  t: number;
  /** Ya alcanzó al jugador (un impacto por ataque). */
  hit: boolean;
  /** Orientación y punto objetivo fijados al empezar (slam, rockfall...). */
  yaw: number;
  x: number;
  y: number;
  z: number;
  /** Puntos de impacto (lluvia de rocas). */
  points: [number, number][];
}

export interface Brain {
  kind: BrainKind;
  state: AIState;
  stateT: number;
  activity: Activity;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  grounded: boolean;
  hp: number;
  maxHp: number;
  /** Medidor de alerta 0..1 (≥ 0.3 sospecha, 1 combate). */
  awareness: number;
  /** Ve al jugador en este paso. */
  sees: boolean;
  /** Última posición conocida del jugador. */
  lastX: number;
  lastY: number;
  lastZ: number;
  /** Segundos sin ver al jugador en combate. */
  lostT: number;
  /** Ha detectado al jugador (si no, recibe golpes críticos por sigilo). */
  aware: boolean;
  homeX: number;
  homeY: number;
  homeZ: number;
  homeYaw: number;
  /** Destino de la rutina tranquila y orientación al llegar. */
  goalX: number;
  goalZ: number;
  goalYaw: number;
  route: [number, number][];
  routeIndex: number;
  waitT: number;
  attack: ActiveAttack | null;
  cooldowns: Record<string, number>;
  /** Aturdido (no actúa). */
  stunT: number;
  /** Ardiendo (s restantes) y congelado (s restantes; el siguiente golpe lo hace añicos). */
  burnT: number;
  frozenT: number;
  /** De rodillas con el cristal expuesto (golems). */
  kneel: boolean;
  sinceDamage: number;
  squash: number;
  /** Reloj de animación (avanza con su velocidad). */
  anim: number;
  /** Velocidad horizontal actual (para animar). */
  speed: number;
  /** Lado preferido al rodear obstáculos o al flanquear (±1). */
  side: number;
  // --- familia
  hopTimer: number;
  /** Carga del aura eléctrica (s). */
  auraT: number;
  charged: boolean;
  /** Golem despertándose (s restantes; < 0 = no). */
  wakeT: number;
  /** Fase de jefe (1..3) y rugido de cambio de fase. */
  phase: number;
  roarT: number;
  speedScale: number;
  /** Ángulo de vuelo en círculo (aves). */
  circleA: number;
  /** Turno de ataque en grupo (como mucho N atacando a la vez). */
  token: boolean;
  fleeT: number;
  fleeRolled: boolean;
  /** Ya ha soltado su arma por una descarga. */
  disarmed: boolean;
  // --- grupo
  group: string | null;
  role: CampRole | null;
  /** Índice de miembro en su campamento (tienda, sitio junto al fuego, puesto). */
  slot: number;
  /** Tiempo hasta reaccionar a la alarma del grupo (reacción escalonada). */
  alarmDelay: number;
}

export function brainKind(def: EnemyDef): BrainKind {
  if (def.hawk) return 'hawk';
  if (def.family === 'goblin') return 'goblin';
  if (def.family === 'golem') return 'golem';
  return 'slime';
}

export function createBrain(def: EnemyDef, x: number, y: number, z: number, yaw: number, seed: number): Brain {
  const kind = brainKind(def);
  const dormant = def.golem?.dormant ?? false;
  return {
    kind,
    state: dormant ? 'sleep' : 'idle',
    stateT: 0,
    activity: dormant ? 'dormant' : kind === 'hawk' ? 'circle' : 'wander',
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw,
    grounded: kind !== 'hawk',
    hp: def.hp,
    maxHp: def.hp,
    awareness: 0,
    sees: false,
    lastX: x,
    lastY: y,
    lastZ: z,
    lostT: 0,
    aware: false,
    homeX: x,
    homeY: y,
    homeZ: z,
    homeYaw: yaw,
    goalX: x,
    goalZ: z,
    goalYaw: yaw,
    route: [],
    routeIndex: 0,
    waitT: seed * 3,
    attack: null,
    cooldowns: {},
    stunT: 0,
    burnT: 0,
    frozenT: 0,
    kneel: false,
    sinceDamage: 999,
    squash: 0,
    anim: seed * 10,
    speed: 0,
    side: seed < 0.5 ? -1 : 1,
    hopTimer: seed * (def.slime?.hopInterval ?? 1) * 2,
    auraT: seed * (def.slime?.aura?.period ?? 1),
    charged: false,
    wakeT: -1,
    phase: 1,
    roarT: 0,
    speedScale: 1,
    circleA: seed * Math.PI * 2,
    token: false,
    fleeT: 0,
    fleeRolled: false,
    disarmed: false,
    group: null,
    role: null,
    slot: 0,
    alarmDelay: 0,
  };
}

export function isCalm(s: AIState): boolean {
  return s === 'sleep' || s === 'idle' || s === 'patrol';
}

/** Estado tranquilo que corresponde a su actividad. */
export function calmStateFor(b: Brain): AIState {
  if (b.activity === 'sleep' || b.activity === 'dormant') return 'sleep';
  if (b.activity === 'patrol' || b.activity === 'circle') return 'patrol';
  return 'idle';
}

export function setState(b: Brain, s: AIState): void {
  if (b.state === s) return;
  b.state = s;
  b.stateT = 0;
  b.aware = s === 'combat' || s === 'search' || s === 'flee' || s === 'regroup';
  if (s !== 'combat') b.token = false;
}

export function enterCombat(b: Brain, x: number, y: number, z: number): void {
  b.awareness = 1;
  b.lostT = 0;
  b.lastX = x;
  b.lastY = y;
  b.lastZ = z;
  if (b.state !== 'combat' && b.state !== 'dead') setState(b, 'combat');
}

export type AwarenessEvent = 'woke' | 'suspicious' | 'noticed' | 'lost' | 'calm' | null;

const DECAY = 0.2;
const SUSPICIOUS = 0.3;
const WAKE = 0.5;

/**
 * Actualiza el medidor de alerta con lo percibido y aplica las transiciones de estado.
 * `px,py,pz` es la posición real del jugador (solo se recuerda si se le percibe).
 */
export function updateAwareness(b: Brain, def: EnemyDef, r: SenseResult, px: number, py: number, pz: number, dt: number): AwarenessEvent {
  if (b.state === 'dead') return null;
  b.stateT += dt;
  b.sees = r.sees;
  const gain = r.sight + r.hearing;

  if (b.state === 'combat') {
    if (r.sees) {
      b.lostT = 0;
      b.awareness = 1;
      b.lastX = px;
      b.lastY = py;
      b.lastZ = pz;
    } else {
      b.lostT += dt;
      // Lo oye: sabe más o menos dónde está.
      if (r.hearing > 0) {
        b.lastX = px;
        b.lastZ = pz;
      }
      if (b.lostT > def.senses.forget) {
        setState(b, 'search');
        b.awareness = 0.6;
        return 'lost';
      }
    }
    return null;
  }
  if (b.state === 'flee') return null;

  if (gain > 0) {
    const cap = r.sight > 0 ? 1 : HEARING_CAP;
    if (b.awareness < cap) b.awareness = Math.min(cap, b.awareness + gain * dt);
    b.lastX = px;
    b.lastY = py;
    b.lastZ = pz;
  } else {
    b.awareness = Math.max(0, b.awareness - DECAY * (b.state === 'suspicious' ? 0.6 : 1) * dt);
  }

  if (b.awareness >= 1) {
    enterCombat(b, b.lastX, b.lastY, b.lastZ);
    return 'noticed';
  }
  if (b.state === 'sleep') {
    if (b.awareness >= WAKE) {
      setState(b, 'suspicious');
      return 'woke';
    }
    return null;
  }
  if (isCalm(b.state) && b.awareness >= SUSPICIOUS) {
    setState(b, 'suspicious');
    return 'suspicious';
  }
  if (b.state === 'suspicious' && b.awareness <= 0) {
    setState(b, calmStateFor(b));
    return 'calm';
  }
  if (b.state === 'search' && b.stateT > def.senses.search) {
    setState(b, 'regroup');
    return null;
  }
  return null;
}

// ------------------------------------------------------------------ ataques

export interface AttackChoice {
  dist: number;
  /** El jugador está en el aire / planeando. */
  targetAir: boolean;
  /** No puede alcanzarlo a pie (sobre una roca, en una cornisa). */
  unreachable: boolean;
  rng: () => number;
}

/** Elige un ataque disponible (rango, enfriamiento, fase) al azar ponderado. */
export function chooseAttack(b: Brain, def: EnemyDef, c: AttackChoice): AttackDef | null {
  let total = 0;
  const pool: { a: AttackDef; w: number }[] = [];
  for (const a of def.attacks) {
    if ((b.cooldowns[a.id] ?? 0) > 0) continue;
    if (c.dist < a.minRange || c.dist > a.maxRange) continue;
    if (a.phase > b.phase) continue;
    if (a.airOnly && !c.targetAir) continue;
    const ranged = a.kind === 'projectile' || a.kind === 'rockfall' || a.kind === 'summon' || a.kind === 'dive';
    // Contra un objetivo inalcanzable solo sirven los ataques a distancia.
    if ((c.unreachable || c.targetAir) && !ranged) continue;
    // Peso 0 = solo cuando no hay otra forma de alcanzarlo (p. ej., tirar piedras).
    const w = a.weight > 0 ? a.weight : c.unreachable || c.targetAir ? 1 : 0;
    if (w <= 0) continue;
    pool.push({ a, w });
    total += w;
  }
  if (pool.length === 0) return null;
  let r = c.rng() * total;
  for (const p of pool) {
    r -= p.w;
    if (r <= 0) return p.a;
  }
  return pool[pool.length - 1].a;
}

export function startAttack(b: Brain, a: AttackDef, tx: number, ty: number, tz: number): ActiveAttack {
  const yaw = Math.atan2(tx - b.x, tz - b.z);
  b.attack = { def: a, phase: 'windup', t: 0, hit: false, yaw, x: tx, y: ty, z: tz, points: [] };
  b.yaw = yaw;
  return b.attack;
}

export interface AttackStep {
  /** Acaba de entrar en la fase activa. */
  activated: boolean;
  /** Ha terminado (se aplica el enfriamiento). */
  finished: boolean;
}

/** Avanza la línea de tiempo del ataque: preparación → activo → recuperación. */
export function stepAttack(b: Brain, dt: number): AttackStep {
  const res: AttackStep = { activated: false, finished: false };
  const a = b.attack;
  if (!a) return res;
  a.t += dt * b.speedScale;
  if (a.phase === 'windup' && a.t >= a.def.windup) {
    a.phase = 'active';
    a.t = 0;
    res.activated = true;
  } else if (a.phase === 'active' && a.t >= a.def.active) {
    a.phase = 'recovery';
    a.t = 0;
  } else if (a.phase === 'recovery' && a.t >= a.def.recovery) {
    b.cooldowns[a.def.id] = a.def.cooldown;
    b.attack = null;
    res.finished = true;
  }
  return res;
}

export function tickCooldowns(b: Brain, dt: number): void {
  for (const k in b.cooldowns) b.cooldowns[k] = Math.max(0, b.cooldowns[k] - dt);
}

/** Interrumpe el ataque en curso (tambaleo, parry) y aplica su enfriamiento. */
export function cancelAttack(b: Brain): void {
  if (!b.attack) return;
  b.cooldowns[b.attack.def.id] = b.attack.def.cooldown;
  b.attack = null;
}

export interface HitOptions {
  fromX: number;
  fromZ: number;
  knockback: number;
  /** Fuerza el tambaleo aunque el daño no supere su aplomo. */
  stagger: boolean;
  /** Segundos de aturdimiento extra (parry, picado...). */
  stun: number;
}

/** Aplica daño a un enemigo: vida, alerta, retroceso y tambaleo. Devuelve true si muere. */
export function applyHit(b: Brain, def: EnemyDef, damage: number, o: HitOptions): boolean {
  if (b.state === 'dead') return false;
  b.hp -= damage;
  b.sinceDamage = 0;
  b.squash = 0.6;
  if (b.state === 'sleep' && b.wakeT < 0 && def.golem) b.wakeT = def.golem.wakeSeconds * 0.4;
  enterCombat(b, o.fromX, b.y, o.fromZ);
  const dx = b.x - o.fromX;
  const dz = b.z - o.fromZ;
  const l = Math.hypot(dx, dz) || 1;
  const k = o.knockback * (1 - def.knockbackResist);
  if (k > 0.2) {
    b.vx = (dx / l) * k;
    b.vz = (dz / l) * k;
    if (b.kind !== 'hawk' && k > 1.5) {
      b.vy = Math.min(4, 1 + k * 0.35);
      b.grounded = false;
    }
  }
  if (b.hp <= 0) {
    b.hp = 0;
    setState(b, 'dead');
    b.attack = null;
    return true;
  }
  if (o.stagger || damage >= def.poise) {
    cancelAttack(b);
    b.stunT = Math.max(b.stunT, Math.min(def.stunTime, 0.25 + damage * 0.05) + o.stun);
  }
  return false;
}

/** Gira hacia un ángulo con velocidad limitada. */
export function turnToward(b: Brain, yaw: number, rate: number, dt: number): void {
  const d = wrapAngle(yaw - b.yaw);
  const step = rate * dt;
  b.yaw = wrapAngle(b.yaw + (Math.abs(d) <= step ? d : Math.sign(d) * step));
}

/**
 * Predicción de impacto: dónde estará el objetivo cuando llegue un proyectil de
 * velocidad `speed` (los arqueros goblin adelantan el tiro a un jugador planeando).
 */
export function leadTarget(sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, vx: number, vy: number, vz: number, speed: number): { x: number; y: number; z: number; t: number } {
  let t = Math.hypot(tx - sx, ty - sy, tz - sz) / Math.max(1, speed);
  for (let i = 0; i < 3; i++) {
    const px = tx + vx * t;
    const py = ty + vy * t;
    const pz = tz + vz * t;
    t = Math.hypot(px - sx, py - sy, pz - sz) / Math.max(1, speed);
  }
  return { x: tx + vx * t, y: ty + vy * t, z: tz + vz * t, t };
}

/** Velocidad de lanzamiento balística para llegar a (tx,ty,tz) en `t` segundos con gravedad `g`. */
export function ballistic(sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, t: number, g: number): { vx: number; vy: number; vz: number } {
  const tt = Math.max(0.05, t);
  return { vx: (tx - sx) / tt, vy: (ty - sy + 0.5 * g * tt * tt) / tt, vz: (tz - sz) / tt };
}
