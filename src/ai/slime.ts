import { calmStateFor, chooseAttack, setState, startAttack, stepAttack, tickCooldowns, turnToward, type Brain } from './brain';
import type { AIContext } from './context';
import { GRAVITY, canStep } from './locomotion';

/**
 * IA de los slimes (normal, tóxico, eléctrico y gigante): se mueven a saltitos,
 * se encogen antes de embestir (aviso), escupen veneno, descargan electricidad
 * o aplastan; el gigante se divide al morir (lo hace el EnemySystem).
 */
export function stepSlime(b: Brain, c: AIContext): void {
  const { def, dt, player: p } = c;
  const sl = def.slime;
  if (!sl) throw new Error(`${def.id}: falta la sección "slime"`);
  tickCooldowns(b, dt);
  b.squash *= Math.exp(-6 * dt);
  b.anim += dt;

  // Aura eléctrica: se carga periódicamente (golpearlo entonces con metal electrocuta).
  if (sl.aura) {
    b.auraT += dt;
    b.charged = b.auraT % sl.aura.period > sl.aura.period - sl.aura.duration || b.attack?.def.kind === 'discharge';
  }

  if (b.stunT > 0) {
    b.stunT -= dt;
    friction(b, 5, dt);
    physics(b, c);
    return;
  }

  // Ataque en curso.
  if (b.attack) {
    const a = b.attack;
    if (a.phase === 'windup') {
      turnToward(b, Math.atan2(p.x - b.x, p.z - b.z), 10, dt);
      a.yaw = b.yaw;
      b.squash = Math.max(b.squash, 0.45 * Math.min(1, a.t / Math.max(0.01, a.def.windup)));
      friction(b, 10, dt);
    }
    const st = stepAttack(b, dt);
    if (st.activated) {
      c.events.push({ type: 'attack_active', attack: a });
      if (a.def.kind === 'lunge') {
        const dx = p.x - b.x;
        const dz = p.z - b.z;
        const l = Math.hypot(dx, dz) || 1;
        b.vx = (dx / l) * a.def.speed;
        b.vz = (dz / l) * a.def.speed;
        b.vy = 5;
        b.grounded = false;
      } else if (a.def.kind === 'slam') {
        b.squash = 0.8;
        c.events.push({ type: 'impact', x: b.x, y: b.y, z: b.z, radius: a.def.radius });
      }
    }
    if (a.phase === 'recovery') friction(b, 8, dt);
    physics(b, c);
    return;
  }

  switch (b.state) {
    case 'sleep':
    case 'idle':
    case 'patrol': {
      if (Math.hypot(b.goalX - b.x, b.goalZ - b.z) < 0.6 || b.stateT > 6) {
        const a = c.rng() * Math.PI * 2;
        const r = c.rng() * 5;
        b.goalX = b.homeX + Math.cos(a) * r;
        b.goalZ = b.homeZ + Math.sin(a) * r;
        b.stateT = 0;
      }
      hopToward(b, c, b.goalX, b.goalZ, def.moveSpeed * 0.5, sl.hopInterval * 1.8);
      break;
    }
    case 'suspicious':
      // Mira hacia el ruido y se acerca despacio.
      turnToward(b, Math.atan2(b.lastX - b.x, b.lastZ - b.z), 6, dt);
      if (b.stateT > 0.6) hopToward(b, c, b.lastX, b.lastZ, def.moveSpeed * 0.5, sl.hopInterval * 1.4);
      else friction(b, 8, dt);
      break;
    case 'search':
      hopToward(b, c, b.lastX, b.lastZ, def.moveSpeed * 0.7, sl.hopInterval);
      break;
    case 'regroup':
    case 'flee':
      hopToward(b, c, b.homeX, b.homeZ, def.moveSpeed, sl.hopInterval);
      if (Math.hypot(b.homeX - b.x, b.homeZ - b.z) < 1.5) setState(b, calmStateFor(b));
      break;
    case 'combat': {
      if (!p.alive || c.dist > def.loseRadius) {
        setState(b, 'search');
        break;
      }
      if (b.grounded) {
        const a = chooseAttack(b, def, { dist: c.dist, targetAir: p.airborne && p.y - p.groundY > 2.5, unreachable: false, rng: c.rng });
        if (a) {
          b.vx = b.vz = 0;
          c.events.push({ type: 'attack_start', attack: startAttack(b, a, p.x, p.y, p.z) });
          break;
        }
      }
      hopToward(b, c, p.x, p.z, def.runSpeed, sl.hopInterval * 0.8);
      break;
    }
    case 'dead':
      break;
  }
  physics(b, c);
}

function friction(b: Brain, k: number, dt: number): void {
  if (!b.grounded) return;
  b.vx *= Math.exp(-k * dt);
  b.vz *= Math.exp(-k * dt);
}

/** Salto hacia un punto: espera en el suelo y luego bota. */
function hopToward(b: Brain, c: AIContext, tx: number, tz: number, speed: number, interval: number): void {
  const sl = c.def.slime;
  if (!sl || !b.grounded) return;
  b.hopTimer -= c.dt;
  if (b.hopTimer > 0) {
    friction(b, 10, c.dt);
    return;
  }
  const hx = tx - b.x;
  const hz = tz - b.z;
  const hl = Math.hypot(hx, hz);
  b.hopTimer = interval * (0.8 + c.rng() * 0.4);
  if (hl < 0.3) return;
  let dx = hx / hl;
  let dz = hz / hl;
  // Evita saltar contra una roca o al agua profunda.
  if (!canStep(b, dx, dz, 1, c.nav, c.body)) {
    const a = Math.atan2(dx, dz) + b.side * 1.2;
    dx = Math.sin(a);
    dz = Math.cos(a);
    if (!canStep(b, dx, dz, 1, c.nav, c.body)) {
      b.side = -b.side;
      return;
    }
  }
  b.yaw = Math.atan2(dx, dz);
  const air = (2 * Math.sqrt(2 * GRAVITY * sl.hopHeight)) / GRAVITY;
  const v = Math.min(speed, hl / air);
  b.vx = dx * v;
  b.vz = dz * v;
  b.vy = Math.sqrt(2 * GRAVITY * sl.hopHeight);
  b.grounded = false;
  b.squash = 0.35;
}

/** Física de botes: gravedad, suelo y colisiones. */
function physics(b: Brain, c: AIContext): void {
  const dt = c.dt;
  const nx = b.x + b.vx * dt;
  const nz = b.z + b.vz * dt;
  const g = c.nav.groundAt(nx, nz, b.y + 0.6);
  if (g > b.y + 0.6 && b.grounded) {
    b.vx = b.vz = 0;
  } else {
    b.x = nx;
    b.z = nz;
  }
  const ground = c.nav.groundAt(b.x, b.z, Math.max(b.y, b.y + b.vy * dt) + 0.6);
  if (!b.grounded) {
    b.vy -= GRAVITY * dt;
    b.y += b.vy * dt;
    if (b.y <= ground) {
      b.y = ground;
      b.vy = 0;
      b.grounded = true;
      b.squash = Math.max(b.squash, 0.3);
    }
  } else if (ground < b.y - 0.7) {
    b.grounded = false;
  } else {
    b.y = ground;
  }
  const pos = { x: b.x, y: b.y, z: b.z };
  c.nav.pushOut(pos, c.body.radius, c.body.height, 0.3);
  b.x = pos.x;
  b.z = pos.z;
  b.speed = Math.hypot(b.vx, b.vz);
}
