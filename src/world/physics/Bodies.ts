import type { BodyKindDef } from '../../data/schemas';

/** Objeto físico del mundo (rocas, cajas, barriles, bombas rúnicas). `y` es la base. */
export interface Body {
  id: number;
  kind: string;
  def: BodyKindDef;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  /** Giro visual al rodar (rad) en X/Z. */
  rollX: number;
  rollZ: number;
  grounded: boolean;
  inWater: boolean;
  /** > 0 mientras está detenido en el tiempo (Sello Quieto). */
  stasisT: number;
  /** Impulso acumulado durante la detención (m/s·kg). */
  ix: number;
  iy: number;
  iz: number;
  /** Sujeto por el imán (lo mueve el sistema, sin gravedad). */
  held: boolean;
  alive: boolean;
  /** Mecha encendida (barriles): estalla al llegar a 0. */
  fuse: number;
  /** Punto de origen (reaparece aquí). */
  homeX: number;
  homeZ: number;
  homeYOffset: number;
  /** Segundos desde que se destruyó (reaparición). */
  deadT: number;
  /** Cooldown de daño por impacto contra enemigos. */
  hitCooldown: number;
}

export interface BodyEnv {
  /** Altura del suelo (terreno o colisionador) bajo el objeto, sin contar el propio. */
  ground(b: Body, x: number, z: number, y: number): number;
  /** Nivel del agua o null. */
  water(x: number, z: number): number | null;
  /** Empuja fuera de los colisionadores; devuelve la normal horizontal o null. */
  push(b: Body): { nx: number; nz: number } | null;
  /** Normal del terreno (para rodar por las pendientes). */
  normal(x: number, z: number): { x: number; y: number; z: number };
}

export interface BodyStepResult {
  /** Velocidad vertical del impacto contra el suelo (0 si no hubo). */
  impact: number;
  splashed: boolean;
}

export function createBody(id: number, kind: string, def: BodyKindDef, x: number, y: number, z: number): Body {
  return {
    id,
    kind,
    def,
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    rollX: 0,
    rollZ: 0,
    grounded: false,
    inWater: false,
    stasisT: 0,
    ix: 0,
    iy: 0,
    iz: 0,
    held: false,
    alive: true,
    fuse: -1,
    homeX: x,
    homeZ: z,
    homeYOffset: 0,
    deadT: 0,
    hitCooldown: 0,
  };
}

/** Altura del objeto (las esferas y cajas son tan altas como anchas; los barriles algo más). */
export function bodyHeight(b: Body): number {
  return b.def.shape === 'barrel' ? b.def.radius * 2.4 : b.def.radius * 2;
}

/**
 * Aplica un impulso (m/s·kg). Detenido en el tiempo, se acumula y se suelta al final
 * (como golpear un objeto congelado para cargarlo de energía).
 */
export function applyImpulse(b: Body, x: number, y: number, z: number): void {
  if (b.stasisT > 0) {
    b.ix += x;
    b.iy += y;
    b.iz += z;
    return;
  }
  const m = b.def.mass;
  b.vx += x / m;
  b.vy += y / m;
  b.vz += z / m;
  if (y > 0) b.grounded = false;
}

/** Termina la detención: el impulso acumulado sale de golpe (limitado). */
export function releaseStasis(b: Body, maxSpeed = 40): void {
  b.stasisT = 0;
  const m = b.def.mass;
  let vx = b.ix / m;
  let vy = b.iy / m;
  let vz = b.iz / m;
  const s = Math.hypot(vx, vy, vz);
  if (s > maxSpeed) {
    vx *= maxSpeed / s;
    vy *= maxSpeed / s;
    vz *= maxSpeed / s;
  }
  b.vx = vx;
  b.vy = vy;
  b.vz = vz;
  b.ix = b.iy = b.iz = 0;
  if (vy > 0) b.grounded = false;
}

const MAX_STEP = 0.3;

/**
 * Un paso de física de un objeto: gravedad, flotación, rozamiento, rodar por la pendiente
 * y colisiones con el escenario. Lógica pura.
 */
export function stepBody(b: Body, env: BodyEnv, gravity: number, dt: number): BodyStepResult {
  const res: BodyStepResult = { impact: 0, splashed: false };
  if (!b.alive) return res;
  b.hitCooldown = Math.max(0, b.hitCooldown - dt);
  if (b.stasisT > 0) {
    b.stasisT -= dt;
    if (b.stasisT <= 0) releaseStasis(b);
    return res;
  }
  if (b.held) return res;
  const d = b.def;
  const r = d.radius;

  // Agua: flota o se hunde despacio.
  const w = env.water(b.x, b.z);
  const submerged = w !== null ? Math.min(1, Math.max(0, (w - b.y) / (r * 2))) : 0;
  const wasInWater = b.inWater;
  b.inWater = submerged > 0.05;
  if (b.inWater && !wasInWater && b.vy < -3) res.splashed = true;
  if (!b.grounded) b.vy -= gravity * dt;
  if (b.inWater) {
    if (d.floats) b.vy += gravity * 2.2 * submerged * dt;
    const k = Math.exp(-(d.floats ? 2.5 : 1.6) * dt);
    b.vy *= k;
    b.vx *= Math.exp(-1.2 * dt);
    b.vz *= Math.exp(-1.2 * dt);
  }

  // En el suelo: rueda (esferas) o roza (cajas, barriles de pie).
  if (b.grounded && !b.inWater) {
    const n = env.normal(b.x, b.z);
    if (d.shape === 'sphere') {
      b.vx += n.x * gravity * 0.7 * dt;
      b.vz += n.z * gravity * 0.7 * dt;
    } else if (n.y < 0.8) {
      // Las cajas solo resbalan en pendientes fuertes.
      b.vx += n.x * gravity * 0.4 * dt;
      b.vz += n.z * gravity * 0.4 * dt;
    }
    const f = Math.exp(-d.friction * dt);
    b.vx *= f;
    b.vz *= f;
    if (Math.hypot(b.vx, b.vz) < 0.03) b.vx = b.vz = 0;
  }

  // Movimiento horizontal en subpasos con colisiones.
  const dist = Math.hypot(b.vx, b.vz) * dt;
  const steps = Math.max(1, Math.ceil(dist / MAX_STEP));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    const px = b.x;
    const pz = b.z;
    b.x += b.vx * sdt;
    b.z += b.vz * sdt;
    // Terreno demasiado alto delante: rebote.
    const g = env.ground(b, b.x, b.z, b.y + r);
    if (g > b.y + r * 0.9) {
      b.x = px;
      b.z = pz;
      const n = env.normal(px + b.vx * sdt * 2, pz + b.vz * sdt * 2);
      reflect(b, n.x, n.z, 0.3);
    }
    const hit = env.push(b);
    if (hit) reflect(b, hit.nx, hit.nz, 0.25);
  }
  if (d.shape === 'sphere') {
    b.rollX += (b.vz * dt) / r;
    b.rollZ -= (b.vx * dt) / r;
  }

  // Vertical.
  b.y += b.vy * dt;
  const ground = env.ground(b, b.x, b.z, b.y + r);
  if (b.y <= ground) {
    if (!b.grounded && b.vy < 0) res.impact = -b.vy;
    b.y = ground;
    if (b.vy < -4) {
      // Rebote suave en impactos fuertes.
      b.vy = -b.vy * (d.shape === 'sphere' ? 0.3 : 0.15);
      b.grounded = false;
    } else {
      b.vy = 0;
      b.grounded = true;
    }
  } else if (b.y > ground + 0.05) {
    b.grounded = false;
  }
  return res;
}

function reflect(b: Body, nx: number, nz: number, restitution: number): void {
  const l = Math.hypot(nx, nz);
  if (l < 1e-6) {
    b.vx = b.vz = 0;
    return;
  }
  const ux = nx / l;
  const uz = nz / l;
  const dot = b.vx * ux + b.vz * uz;
  if (dot < 0) {
    b.vx -= (1 + restitution) * dot * ux;
    b.vz -= (1 + restitution) * dot * uz;
  }
}

/**
 * Separa dos objetos que se solapan en horizontal y reparte la velocidad según su masa.
 * El apilado lo resuelven los colisionadores (cada objeto apoya en el de abajo).
 */
export function collideBodies(a: Body, b: Body): boolean {
  if (!a.alive || !b.alive) return false;
  const dy = b.y + b.def.radius - (a.y + a.def.radius);
  const min = a.def.radius + b.def.radius;
  if (Math.abs(dy) > min * 0.75) return false;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d >= min || d < 1e-6) return false;
  const nx = dx / d;
  const nz = dz / d;
  const pen = min - d;
  const pinnedA = a.stasisT > 0 || a.held;
  const pinnedB = b.stasisT > 0 || b.held;
  const fa = pinnedA ? 0 : pinnedB ? 1 : b.def.mass / (a.def.mass + b.def.mass);
  const fb = pinnedB ? 0 : 1 - fa;
  a.x -= nx * pen * fa;
  a.z -= nz * pen * fa;
  b.x += nx * pen * fb;
  b.z += nz * pen * fb;
  const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (rv < 0) {
    const ia = pinnedA ? 0 : 1 / a.def.mass;
    const ib = pinnedB ? 0 : 1 / b.def.mass;
    if (ia + ib > 0) {
      const j = (-1.3 * rv) / (ia + ib);
      a.vx -= j * ia * nx;
      a.vz -= j * ia * nz;
      b.vx += j * ib * nx;
      b.vz += j * ib * nz;
    }
  }
  return true;
}

/**
 * Onda expansiva: impulso radial (con algo de elevación) a los objetos dentro del radio.
 * Devuelve los objetos afectados con el factor de cercanía (1 en el centro).
 */
export function blastBodies(bodies: Iterable<Body>, x: number, y: number, z: number, radius: number, force: number): { body: Body; k: number }[] {
  const out: { body: Body; k: number }[] = [];
  for (const b of bodies) {
    if (!b.alive) continue;
    const by = b.y + b.def.radius;
    const dx = b.x - x;
    const dy = by - y;
    const dz = b.z - z;
    const d = Math.hypot(dx, dy, dz);
    if (d > radius + b.def.radius) continue;
    const k = Math.max(0, 1 - d / (radius + b.def.radius));
    const l = d > 1e-3 ? d : 1;
    const ux = d > 1e-3 ? dx / l : 0;
    const uz = d > 1e-3 ? dz / l : 0;
    const uy = Math.max(0.35, d > 1e-3 ? dy / l : 1);
    // Fuerza por unidad de masa (m/s) × masa ligera: los objetos pesados se mueven menos.
    const imp = force * k * Math.min(b.def.mass, 25);
    applyImpulse(b, ux * imp, uy * imp, uz * imp);
    out.push({ body: b, k });
  }
  return out;
}

/** Intersección segmento-esfera: fracción [0,1] del primer contacto o null. */
export function segmentHitsBody(b: Body, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number | null {
  const cx = b.x;
  const cy = b.y + b.def.radius;
  const cz = b.z;
  const r = b.def.radius * (b.def.shape === 'box' ? 1.15 : 1);
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const fx = ax - cx;
  const fy = ay - cy;
  const fz = az - cz;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-9) return null;
  const bq = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - r * r;
  if (c <= 0) return 0;
  const disc = bq * bq - 4 * a * c;
  if (disc < 0) return null;
  const t = (-bq - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
