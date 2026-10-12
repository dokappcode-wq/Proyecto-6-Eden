export type ProjectileKind = 'arrow' | 'thrown';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  owner: 'player' | 'enemy';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  damage: number;
  /** Arma lanzada: id e instancia (se deja caer al suelo tras el impacto). */
  weaponId?: string;
  weaponUid?: number;
  weaponDurability?: number;
  age: number;
  maxAge: number;
  /** Clavada en el escenario (ya no se mueve). */
  stuck: boolean;
  alive: boolean;
  /** Ya reflejada (un parry solo la devuelve una vez). */
  reflected: boolean;
}

export interface ProjectileWorld {
  /** Distancia al primer impacto contra el escenario a lo largo del segmento, o Infinity. */
  raycastScene(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number;
  /** Objetivo alcanzado por el segmento (centro y radio), o null. */
  hitTarget(p: Projectile, ax: number, ay: number, az: number, bx: number, by: number, bz: number): { id: number; tHit: number } | null;
}

export type ProjectileEvent = { type: 'scene'; x: number; y: number; z: number } | { type: 'target'; id: number; x: number; y: number; z: number } | { type: 'expire' };

/**
 * Integra un proyectil un paso (gravedad + barrido del segmento recorrido para no atravesar
 * objetivos a alta velocidad). Devuelve el evento de impacto si lo hubo.
 */
export function stepProjectile(p: Projectile, world: ProjectileWorld, dt: number): ProjectileEvent | null {
  if (!p.alive) return null;
  p.age += dt;
  if (p.age >= p.maxAge) {
    p.alive = false;
    return { type: 'expire' };
  }
  if (p.stuck) return null;

  p.vy -= p.gravity * dt;
  const ax = p.x;
  const ay = p.y;
  const az = p.z;
  const bx = ax + p.vx * dt;
  const by = ay + p.vy * dt;
  const bz = az + p.vz * dt;
  const len = Math.hypot(bx - ax, by - ay, bz - az);

  const target = world.hitTarget(p, ax, ay, az, bx, by, bz);
  const sceneT = len > 1e-6 ? world.raycastScene(ax, ay, az, (bx - ax) / len, (by - ay) / len, (bz - az) / len, len) / len : Infinity;

  if (target && target.tHit <= sceneT) {
    p.x = ax + (bx - ax) * target.tHit;
    p.y = ay + (by - ay) * target.tHit;
    p.z = az + (bz - az) * target.tHit;
    p.alive = false;
    return { type: 'target', id: target.id, x: p.x, y: p.y, z: p.z };
  }
  if (sceneT <= 1) {
    p.x = ax + (bx - ax) * sceneT;
    p.y = ay + (by - ay) * sceneT;
    p.z = az + (bz - az) * sceneT;
    p.stuck = true;
    p.vx = p.vy = p.vz = 0;
    // Las flechas quedan clavadas un rato; las armas lanzadas caen al suelo (las recoge el sistema).
    p.maxAge = p.kind === 'arrow' ? p.age + 6 : p.age;
    return { type: 'scene', x: p.x, y: p.y, z: p.z };
  }
  p.x = bx;
  p.y = by;
  p.z = bz;
  return null;
}

/** Parry / escudo espejo: devuelve el proyectil hacia quien lo lanzó, más rápido. */
export function reflectProjectile(p: Projectile, toward: { x: number; y: number; z: number }): void {
  const dx = toward.x - p.x;
  const dy = toward.y - p.y;
  const dz = toward.z - p.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  const speed = Math.hypot(p.vx, p.vy, p.vz) * 1.4;
  p.vx = (dx / d) * speed;
  p.vy = (dy / d) * speed + 1;
  p.vz = (dz / d) * speed;
  p.owner = p.owner === 'player' ? 'enemy' : 'player';
  p.reflected = true;
  p.damage *= 1.5;
}

/** Punto más cercano de un segmento a una esfera: parámetro t∈[0,1] del impacto o null. */
export function segmentSphere(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, r: number): number | null {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const fx = ax - cx;
  const fy = ay - cy;
  const fz = az - cz;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-12) return fx * fx + fy * fy + fz * fz <= r * r ? 0 : null;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - r * r;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
