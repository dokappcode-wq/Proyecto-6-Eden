import { calmStateFor, chooseAttack, enterCombat, setState, startAttack, stepAttack, tickCooldowns, turnToward, type Brain } from './brain';
import type { AIContext } from './context';
import { circleAround, fleeFrom, integrate, standStill, walkToward } from './locomotion';

/** Segundos tocando el cuerno antes de que suene. */
export const HORN_SECONDS = 2;
/** Distancia de flanqueo de quien espera turno para atacar. */
const FLANK_RADIUS = 5.5;

/**
 * IA goblin: rutinas de campamento (guardia, patrulla, cocina, dormir, vigía),
 * investigación de ruidos, cuerno de alarma, turnos de ataque en grupo (los demás
 * flanquean), arqueros que mantienen la distancia y priorizan al jugador planeando,
 * piedras contra un jugador inalcanzable y huida cuando cae el líder o la moral.
 */
export function stepGoblin(b: Brain, c: AIContext): void {
  const { def, dt, player: p, nav, body } = c;
  const gb = def.goblin;
  if (!gb) throw new Error(`${def.id}: falta la sección "goblin"`);
  tickCooldowns(b, dt);
  b.squash *= Math.exp(-6 * dt);
  const walk = def.moveSpeed;
  const run = def.runSpeed;
  const archer = def.variant === 'archer';
  const onLookout = b.activity === 'lookout';

  if (b.stunT > 0) {
    b.stunT -= dt;
    standStill(b, dt, nav, body);
    return;
  }

  if (b.attack) {
    const a = b.attack;
    if (a.phase === 'windup') {
      turnToward(b, Math.atan2(p.x - b.x, p.z - b.z), def.turnSpeed * 1.5, dt);
      a.yaw = b.yaw;
    }
    const st = stepAttack(b, dt);
    // Tras golpear cede el turno: otro del grupo puede entrar.
    if (st.finished && a.def.kind !== 'projectile') b.token = false;
    if (st.activated) {
      c.events.push({ type: 'attack_active', attack: a });
      if (a.def.kind === 'lunge') {
        // Salto/carga hacia el jugador.
        b.vx = Math.sin(a.yaw) * a.def.speed;
        b.vz = Math.cos(a.yaw) * a.def.speed;
        b.vy = 4.5;
        b.grounded = false;
      } else if (a.def.kind === 'slam') {
        c.events.push({ type: 'impact', x: b.x + Math.sin(a.yaw) * a.def.reach, y: b.y, z: b.z + Math.cos(a.yaw) * a.def.reach, radius: a.def.radius });
      }
    }
    if (a.def.kind === 'lunge' && a.phase === 'active') integrate(b, dt, nav, body);
    else standStill(b, dt, nav, body);
    return;
  }

  switch (b.state) {
    case 'sleep':
      standStill(b, dt, nav, body);
      b.yaw = b.goalYaw;
      return;
    case 'idle':
    case 'patrol':
      calmRoutine(b, c);
      return;
    case 'suspicious': {
      // "¿Qué ha sido eso?": se para, mira y luego se acerca a investigar.
      turnToward(b, Math.atan2(b.lastX - b.x, b.lastZ - b.z), def.turnSpeed, dt);
      if (b.stateT > 0.9 && !onLookout) walkToward(b, b.lastX, b.lastZ, walk * 0.8, dt, nav, body, 1.5);
      else standStill(b, dt, nav, body);
      return;
    }
    case 'search': {
      if (onLookout) {
        b.yaw += Math.sin(b.stateT * 1.3) * dt;
        standStill(b, dt, nav, body);
        return;
      }
      const d = walkToward(b, b.lastX, b.lastZ, walk, dt, nav, body, 1);
      if (d < 1.5) b.yaw += Math.sin(b.stateT * 2) * dt * 1.5; // mira alrededor
      return;
    }
    case 'regroup': {
      const g = c.group;
      const tx = g ? g.regroupX : b.homeX;
      const tz = g ? g.regroupZ : b.homeZ;
      if (onLookout || walkToward(b, tx, tz, run * 0.8, dt, nav, body, 1.5) < 2) {
        setState(b, g ? 'search' : calmStateFor(b));
        b.lastX = b.homeX;
        b.lastZ = b.homeZ;
        if (!g) b.awareness = 0;
      }
      return;
    }
    case 'flee':
      b.fleeT -= dt;
      fleeFrom(b, p.x, p.z, run, dt, nav, body);
      if (b.fleeT <= 0) setState(b, 'regroup');
      return;
    case 'dead':
      return;
    case 'combat':
      break;
  }

  // --- combate
  if (!p.alive || c.dist > def.loseRadius) {
    setState(b, 'search');
    return;
  }
  // Moral: herido de gravedad puede huir (se decide una vez).
  if (!b.fleeRolled && gb.fleeHp > 0 && b.hp < b.maxHp * gb.fleeHp) {
    b.fleeRolled = true;
    if (c.rng() < 0.5) {
      setState(b, 'flee');
      b.fleeT = 5 + c.rng() * 3;
      return;
    }
  }

  // Cuerno: el elegido corre a darlo antes de pelear.
  const g = c.group;
  if (g?.hornCaller) {
    const d = walkToward(b, g.hornX, g.hornZ, run, dt, nav, body, 0.9);
    if (d < 1.4) {
      b.activity = 'horn';
      turnToward(b, Math.atan2(p.x - b.x, p.z - b.z), def.turnSpeed, dt);
      b.waitT += dt;
      if (b.waitT >= HORN_SECONDS) {
        b.waitT = 0;
        b.activity = 'hold';
        c.events.push({ type: 'horn' });
      }
    }
    return;
  }

  const targetAir = p.airborne && p.y - p.groundY > 1.5;
  // Inalcanzable a pie: el jugador está subido a algo alto (los goblins no escalan).
  const unreachable = !targetAir && p.groundY - b.y > 2.2 && c.dist < 14;
  const attack = chooseAttack(b, def, { dist: c.dist, targetAir, unreachable: unreachable || onLookout, rng: c.rng });
  const melee = attack && attack.kind !== 'projectile';
  const hasToken = b.token || (g ? g.canTakeToken : true);
  if (attack && (!melee || hasToken)) {
    if (melee) b.token = true;
    c.events.push({ type: 'attack_start', attack: startAttack(b, attack, p.x, p.y + 0.9, p.z) });
    standStill(b, dt, nav, body);
    return;
  }

  if (onLookout) {
    turnToward(b, Math.atan2(p.x - b.x, p.z - b.z), def.turnSpeed, dt);
    standStill(b, dt, nav, body);
    return;
  }

  const [keepMin, keepMax] = gb.keepRange;
  if (archer) {
    // Mantiene la distancia: retrocede si se acerca, se acerca si se aleja, y se mueve de lado.
    if (c.dist < keepMin) fleeFrom(b, p.x, p.z, walk * 1.2, dt, nav, body);
    else if (c.dist > keepMax) walkToward(b, p.x, p.z, run * 0.8, dt, nav, body, keepMax);
    else circleAround(b, p.x, p.z, c.dist, walk * 0.6, dt, nav, body);
    turnToward(b, Math.atan2(p.x - b.x, p.z - b.z), def.turnSpeed, dt);
    return;
  }
  if (unreachable) {
    // Espera abajo, rodeando, hasta poder tirar otra piedra.
    circleAround(b, p.x, p.z, 4, walk, dt, nav, body);
    return;
  }
  if (hasToken) {
    b.token = true;
    walkToward(b, p.x, p.z, run, dt, nav, body, keepMin);
    if (c.dist <= keepMax) turnToward(b, Math.atan2(p.x - b.x, p.z - b.z), def.turnSpeed, dt);
  } else {
    // Sin turno: flanquea a distancia, amenazando.
    circleAround(b, p.x, p.z, FLANK_RADIUS, walk, dt, nav, body);
  }
}

/** Rutina tranquila: ir a su puesto/hoguera/tienda o recorrer la patrulla. */
function calmRoutine(b: Brain, c: AIContext): void {
  const { def, dt, nav, body } = c;
  const walk = def.moveSpeed * 0.55;
  switch (b.activity) {
    case 'patrol': {
      if (b.route.length < 2) {
        standStill(b, dt, nav, body);
        return;
      }
      const [tx, tz] = b.route[b.routeIndex % b.route.length];
      if (b.waitT > 0) {
        b.waitT -= dt;
        standStill(b, dt, nav, body);
        b.yaw += Math.sin(b.waitT * 2) * dt;
        return;
      }
      if (walkToward(b, tx, tz, walk, dt, nav, body, 0.8) < 1.2) {
        b.routeIndex = (b.routeIndex + 1) % b.route.length;
        b.waitT = 1.5 + c.rng() * 2;
      }
      return;
    }
    case 'wander': {
      if (b.waitT > 0) {
        b.waitT -= dt;
        standStill(b, dt, nav, body);
        return;
      }
      if (walkToward(b, b.goalX, b.goalZ, walk, dt, nav, body, 0.6) < 1) {
        const a = c.rng() * Math.PI * 2;
        const r = 2 + c.rng() * 6;
        b.goalX = b.homeX + Math.cos(a) * r;
        b.goalZ = b.homeZ + Math.sin(a) * r;
        b.waitT = 2 + c.rng() * 4;
      }
      return;
    }
    default: {
      // guardia, cocina, vigía, sentado: ir al sitio y mirar hacia donde toca.
      const d = walkToward(b, b.goalX, b.goalZ, walk, dt, nav, body, 0.4);
      if (d < 0.8) {
        const sway = b.activity === 'guard' || b.activity === 'lookout' ? Math.sin(b.stateT * 0.5 + b.homeX) * 0.7 : 0;
        turnToward(b, b.goalYaw + sway, def.turnSpeed * 0.4, dt);
      }
    }
  }
}

/** Alarma del grupo: reacciona tras un pequeño retraso escalonado. */
export function hearAlarm(b: Brain, x: number, y: number, z: number): void {
  if (b.state === 'dead' || b.state === 'flee' || b.state === 'combat') return;
  enterCombat(b, x, y, z);
}
