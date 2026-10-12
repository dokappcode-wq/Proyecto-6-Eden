import { wrapAngle } from '../core/math';
import { calmStateFor, chooseAttack, leadTarget, setState, startAttack, stepAttack, tickCooldowns, turnToward, type Brain } from './brain';
import type { AIContext } from './context';
import { GRAVITY } from './locomotion';

/** Altura sobre el jugador a la que acecha antes de lanzarse. */
const STALK_HEIGHT = 11;

/**
 * Ave cazadora de montaña: vuela en círculos sobre su nido e ignora a quien va a pie.
 * Si alguien planea cerca, lo acecha desde arriba, chilla (aviso) y se lanza en picado
 * apuntando a donde estará; al impactar pliega el planeador. Luego remonta y repite.
 */
export function stepHawk(b: Brain, c: AIContext, roostGround: number): void {
  const { def, dt, player: p } = c;
  const hk = def.hawk;
  if (!hk) throw new Error(`${def.id}: falta la sección "hawk"`);
  tickCooldowns(b, dt);
  b.anim += dt;

  if (b.state === 'dead') {
    // Cae en barrena.
    b.vy -= GRAVITY * 0.6 * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    const g = c.nav.groundAt(b.x, b.z, b.y + 1);
    if (b.y < g) {
      b.y = g;
      b.vx = b.vz = b.vy = 0;
    }
    return;
  }

  if (b.stunT > 0) {
    // Aturdido: aletea torpemente, perdiendo altura.
    b.stunT -= dt;
    fly(b, b.x + b.vx, b.y - 2, b.z + b.vz, hk.flySpeed * 0.5, 2, dt);
    keepAboveGround(b, c, 3);
    return;
  }

  if (b.attack) {
    const a = b.attack;
    const st = stepAttack(b, dt);
    if (a.phase === 'windup') {
      // Chillido: se cierne sobre la presa, de cara a ella.
      fly(b, p.x - Math.sin(b.yaw) * 6, p.y + STALK_HEIGHT, p.z - Math.cos(b.yaw) * 6, hk.flySpeed * 0.7, 3, dt);
      b.yaw = Math.atan2(p.x - b.x, p.z - b.z);
    } else if (a.phase === 'active' && !a.hit) {
      if (st.activated) c.events.push({ type: 'attack_active', attack: a });
      // Picado guiado hacia el punto de intercepción.
      const t = leadTarget(b.x, b.y, b.z, p.x, p.y + 0.9, p.z, p.vx, p.vy, p.vz, a.def.speed);
      fly(b, t.x, t.y, t.z, a.def.speed, 6, dt);
    } else {
      // Remonta tras el picado.
      const away = Math.atan2(b.x - p.x, b.z - p.z);
      fly(b, b.x + Math.sin(away) * 10, Math.max(p.y, roostGround) + hk.altitude * 0.6, b.z + Math.cos(away) * 10, hk.flySpeed * 1.2, 2.5, dt);
      if (a.phase === 'active') a.phase = 'recovery';
    }
    keepAboveGround(b, c, 1.2);
    return;
  }

  const prey = p.alive && p.airborne && p.y - p.groundY > hk.preyHeight && Math.hypot(p.x - b.homeX, p.z - b.homeZ) < hk.huntRadius;
  if (b.state === 'combat') {
    if (!prey) {
      b.lostT += dt;
      if (b.lostT > def.senses.forget) {
        setState(b, 'regroup');
        b.awareness = 0;
      }
    }
    const a = prey ? chooseAttack(b, def, { dist: Math.hypot(p.x - b.x, p.z - b.z), targetAir: true, unreachable: false, rng: c.rng }) : null;
    if (a) {
      c.events.push({ type: 'attack_start', attack: startAttack(b, a, p.x, p.y, p.z) });
      return;
    }
    // Acecha en círculos por encima de la presa.
    b.circleA += dt * 1.2;
    fly(b, p.x + Math.cos(b.circleA) * 9, p.y + STALK_HEIGHT, p.z + Math.sin(b.circleA) * 9, hk.flySpeed * 1.3, 2.2, dt);
    keepAboveGround(b, c, 3);
    return;
  }

  // Tranquilo (o volviendo): círculos sobre el nido.
  b.circleA += (hk.flySpeed / hk.circleRadius) * dt;
  const alt = roostGround + hk.altitude + Math.sin(b.circleA * 0.7 + b.homeX) * 4;
  fly(b, b.homeX + Math.cos(b.circleA) * hk.circleRadius, alt, b.homeZ + Math.sin(b.circleA) * hk.circleRadius, hk.flySpeed, 1.6, dt);
  keepAboveGround(b, c, 6);
  if (b.state === 'regroup' && Math.hypot(b.x - b.homeX, b.z - b.homeZ) < hk.circleRadius * 1.5) setState(b, calmStateFor(b));
  if (b.state === 'search' || b.state === 'suspicious') setState(b, 'patrol');
}

/** Vuelo con giro limitado (inercia de ave). */
function fly(b: Brain, tx: number, ty: number, tz: number, speed: number, agility: number, dt: number): void {
  const dx = tx - b.x;
  const dy = ty - b.y;
  const dz = tz - b.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  const k = 1 - Math.exp(-agility * dt);
  b.vx += ((dx / l) * speed - b.vx) * k;
  b.vy += ((dy / l) * speed - b.vy) * k;
  b.vz += ((dz / l) * speed - b.vz) * k;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  const h = Math.hypot(b.vx, b.vz);
  if (h > 0.5) turnToward(b, Math.atan2(b.vx, b.vz), 4, dt);
  b.speed = Math.hypot(b.vx, b.vy, b.vz);
}

function keepAboveGround(b: Brain, c: AIContext, clearance: number): void {
  const g = c.nav.groundAt(b.x, b.z, b.y + 50);
  if (b.y < g + clearance) {
    b.y = g + clearance;
    if (b.vy < 0) b.vy = 0;
  }
}

/** Inclinación de alas para el visual (radianes) a partir del giro. */
export function bankAngle(prevYaw: number, yaw: number, dt: number): number {
  return Math.max(-0.8, Math.min(0.8, (wrapAngle(yaw - prevYaw) / Math.max(dt, 1e-3)) * 0.35));
}
