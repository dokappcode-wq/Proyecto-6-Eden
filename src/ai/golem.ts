import { calmStateFor, chooseAttack, setState, startAttack, stepAttack, tickCooldowns, turnToward, type Brain } from './brain';
import type { AIContext } from './context';
import { standStill, walkToward } from './locomotion';

/** Segundos de rugido (invulnerable a tambaleos) al cambiar de fase el jefe. */
export const ROAR_SECONDS = 2.2;
/** Vida regenerada por segundo (fracción) por un jefe que vuelve a su arena. */
const BOSS_REGEN = 0.03;

/**
 * IA de golem: dormido como un montón de rocas hasta que se le acerca alguien,
 * lento y con golpes muy telegrafiados; un flechazo en el cristal lo pone de rodillas.
 * No persigue por bordes (no sube escalones altos). El Coloso (jefe) tiene 3 fases:
 * golpes → ondas y rocas lanzadas → furia con lluvia de rocas e invocaciones.
 */
export function stepGolem(b: Brain, c: AIContext): void {
  const { def, dt, player: p, nav, body } = c;
  const gd = def.golem;
  if (!gd) throw new Error(`${def.id}: falta la sección "golem"`);
  tickCooldowns(b, dt);
  b.squash *= Math.exp(-4 * dt);
  const boss = def.boss;

  // Despertar: se recompone durante unos segundos (vulnerable).
  if (b.wakeT >= 0) {
    b.wakeT -= dt;
    standStill(b, dt, nav, body);
    if (b.wakeT < 0) {
      b.activity = 'hold';
      c.events.push({ type: 'woke' });
    }
    return;
  }
  if (b.state === 'sleep') {
    standStill(b, dt, nav, body);
    return;
  }
  if (b.state === 'suspicious' && b.activity === 'dormant') {
    // Algo lo ha despertado: empieza a levantarse.
    b.wakeT = gd.wakeSeconds;
    return;
  }

  // Fases del jefe por umbrales de vida.
  if (boss) {
    const frac = b.hp / b.maxHp;
    const phase = frac <= boss.phases[1] ? 3 : frac <= boss.phases[0] ? 2 : 1;
    if (phase > b.phase) {
      b.phase = phase;
      b.roarT = ROAR_SECONDS;
      b.attack = null;
      b.kneel = false;
      b.stunT = 0;
      b.speedScale = phase === 3 ? boss.enrageSpeed : 1;
      c.events.push({ type: 'phase', phase });
      c.events.push({ type: 'impact', x: b.x, y: b.y, z: b.z, radius: def.radius * 3 });
    }
  }
  if (b.roarT > 0) {
    b.roarT -= dt;
    turnToward(b, Math.atan2(p.x - b.x, p.z - b.z), def.turnSpeed, dt);
    standStill(b, dt, nav, body);
    return;
  }

  if (b.stunT > 0) {
    b.stunT -= dt;
    if (b.stunT <= 0) b.kneel = false;
    standStill(b, dt, nav, body);
    return;
  }

  if (b.attack) {
    const a = b.attack;
    // Gira despacio mientras prepara: se puede rodear para escapar.
    if (a.phase === 'windup' && a.def.kind !== 'rockfall') {
      turnToward(b, Math.atan2(p.x - b.x, p.z - b.z), def.turnSpeed * 0.6, dt);
      a.yaw = b.yaw;
    }
    const st = stepAttack(b, dt);
    if (st.activated) {
      c.events.push({ type: 'attack_active', attack: a });
      if (a.def.kind === 'slam' || a.def.kind === 'shockwave') {
        const reach = a.def.kind === 'slam' ? a.def.reach : 0;
        c.events.push({ type: 'impact', x: b.x + Math.sin(a.yaw) * reach, y: b.y, z: b.z + Math.cos(a.yaw) * reach, radius: a.def.kind === 'slam' ? a.def.radius : def.radius * 1.5 });
        b.squash = 0.4;
      }
    }
    standStill(b, dt, nav, body);
    return;
  }

  const speed = def.moveSpeed * b.speedScale;
  switch (b.state) {
    case 'idle':
    case 'patrol':
      if (walkToward(b, b.homeX, b.homeZ, speed * 0.6, dt, nav, body, 0.6) < 1) {
        turnToward(b, b.homeYaw, def.turnSpeed * 0.5, dt);
        // Vuelve a quedarse inmóvil como una roca.
        if (gd.dormant && b.stateT > 2) {
          b.activity = 'dormant';
          setState(b, 'sleep');
          b.awareness = 0;
        }
      }
      if (boss) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * BOSS_REGEN * dt);
      return;
    case 'suspicious':
      turnToward(b, Math.atan2(b.lastX - b.x, b.lastZ - b.z), def.turnSpeed, dt);
      if (b.stateT > 1.2) walkToward(b, b.lastX, b.lastZ, speed * 0.7, dt, nav, body, 2);
      else standStill(b, dt, nav, body);
      return;
    case 'search':
      if (walkToward(b, b.lastX, b.lastZ, speed, dt, nav, body, 2) < 2.5) b.yaw += dt * 0.6;
      return;
    case 'regroup':
    case 'flee':
      if (walkToward(b, b.homeX, b.homeZ, speed, dt, nav, body, 1) < 2) {
        setState(b, calmStateFor({ ...b, activity: 'hold' }));
        b.awareness = 0;
      }
      if (boss) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * BOSS_REGEN * dt);
      return;
    case 'dead':
      return;
    case 'combat':
      break;
  }

  // El jefe no abandona su arena: si el jugador huye, vuelve al centro y se recupera.
  const leash = boss ? Math.hypot(p.x - b.homeX, p.z - b.homeZ) > boss.arenaRadius + 15 : c.dist > def.loseRadius;
  if (!p.alive || leash) {
    setState(b, 'regroup');
    return;
  }

  const targetAir = p.airborne && p.y - p.groundY > 2.5;
  // Los golems no persiguen por bordes: si el jugador está subido a algo alto, le lanzan rocas.
  const unreachable = !targetAir && p.groundY - b.y > 2;
  const a = chooseAttack(b, def, { dist: c.dist, targetAir, unreachable, rng: c.rng });
  if (a) {
    const att = startAttack(b, a, p.x, p.y + 0.9, p.z);
    if (a.kind === 'rockfall') {
      // Lluvia de rocas: una cae justo sobre el jugador y el resto alrededor.
      att.points.push([p.x, p.z]);
      for (let i = 1; i < a.count; i++) {
        const ang = c.rng() * Math.PI * 2;
        const r = 3 + c.rng() * 9;
        att.points.push([p.x + Math.cos(ang) * r, p.z + Math.sin(ang) * r]);
      }
    }
    c.events.push({ type: 'attack_start', attack: att });
    standStill(b, dt, nav, body);
    return;
  }
  const reach = Math.max(def.radius + 1, ...def.attacks.filter((x) => x.kind === 'swing' || x.kind === 'slam').map((x) => x.maxRange * 0.8));
  walkToward(b, p.x, p.z, speed, dt, nav, body, reach);
  turnToward(b, Math.atan2(p.x - b.x, p.z - b.z), def.turnSpeed, dt);
}

/** Flechazo (o golpe) en el cristal: de rodillas con el punto débil expuesto. */
export function crystalStagger(b: Brain, seconds: number): void {
  if (b.roarT > 0 || b.kneel) return;
  b.attack = null;
  b.kneel = true;
  b.stunT = seconds;
}

/** Posición del cristal (punto débil) en el mundo (igual que el visual, también de rodillas). */
export function crystalPosition(b: Brain, height: number, crystalHeight: number, side: 'front' | 'back' | 'top', radius: number): { x: number; y: number; z: number } {
  const zc = side === 'front' ? radius * 0.8 : side === 'back' ? -radius * 0.8 : 0;
  let y = height * crystalHeight;
  let z = zc;
  if (b.kneel) {
    // Inclinado hacia delante y hundido: el cristal queda a la altura de la espada.
    const tilt = 0.45;
    const s = height / 2.6;
    y = height * crystalHeight * Math.cos(tilt) - zc * Math.sin(tilt) - 0.55 * s;
    z = height * crystalHeight * Math.sin(tilt) + zc * Math.cos(tilt);
  }
  return { x: b.x + Math.sin(b.yaw) * z, y: b.y + y, z: b.z + Math.cos(b.yaw) * z };
}
