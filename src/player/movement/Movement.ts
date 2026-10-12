import type { GliderConfig, LedgeBoostConfig, PlayerConfig } from '../../data/schemas';
import { emptyAir } from '../../world/airflow/Airflow';
import { clipVelocity, stepCharacter, type CharacterEnv, type CharacterState } from '../CharacterController';
import { beginClimb, probeClimbable, stepClimb } from './climb';
import { beginGlide, foldGlider, stepGlide, type GliderModifiers } from './glide';
import { beginLedge, detectLedge, stepLedge } from './ledge';
import { surfaceBelow } from './probe';
import { canUse, fallDamage, spend, spendRate, updateStamina } from './Stamina';

export interface MovementParams {
  player: PlayerConfig;
  ledge: LedgeBoostConfig;
  glider: GliderConfig;
  gliderMods: GliderModifiers;
  /** Accesibilidad: el Impulso de Borde solo si se mantiene saltar. */
  ledgeRequiresHold: boolean;
  gliderInput: 'toggle' | 'hold';
}

export interface MovementInput {
  /** Dirección deseada en mundo (relativa a cámara), módulo ≤ 1. */
  moveX: number;
  moveZ: number;
  /** Ejes crudos: derecha y adelante (-1..1), para escalar y planear. */
  right: number;
  forward: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  sprint: boolean;
  crouch: boolean;
  crouchPressed: boolean;
  walk: boolean;
  dodgePressed: boolean;
  /** "Interactuar" sin nada interactuable delante: agarrarse a la pared. */
  grabPressed: boolean;
  /** Orientación impuesta por el combate (apuntar, fijar, atacar). */
  faceYaw?: number;
  /** Embestida de un ataque (m/s hacia `faceYaw` o la orientación actual). */
  lunge?: number;
}

export interface LandingInfo {
  speed: number;
  drop: number;
  /** Daño en cuartos de corazón. */
  damage: number;
  rolled: boolean;
  water: boolean;
  fromGlide: boolean;
}

export interface MovementEvents {
  jumped: boolean;
  landed: LandingInfo | null;
  ledgeContact: boolean;
  ledgeBoost: { mantle: boolean } | null;
  ledgeExit: boolean;
  ledgeReleased: boolean;
  climbStart: boolean;
  climbJump: boolean;
  climbTopOut: boolean;
  gliderDeploy: boolean;
  gliderFold: 'input' | 'stamina' | 'ledge' | 'wall' | null;
  dodged: boolean;
  glideLand: { x: number; z: number; water: boolean } | null;
  exhausted: boolean;
  drowned: boolean;
  launched: boolean;
  splash: boolean;
}

function emptyEvents(): MovementEvents {
  return {
    jumped: false,
    landed: null,
    ledgeContact: false,
    ledgeBoost: null,
    ledgeExit: false,
    ledgeReleased: false,
    climbStart: false,
    climbJump: false,
    climbTopOut: false,
    gliderDeploy: false,
    gliderFold: null,
    dodged: false,
    glideLand: null,
    exhausted: false,
    drowned: false,
    launched: false,
    splash: false,
  };
}

const airTmp = emptyAir();

/**
 * Orquestador de movimiento (lógica pura): decide qué modo corre en este paso fijo
 * y encadena las transiciones (salto → borde → impulso → planeador → pared...).
 */
export function stepMovement(s: CharacterState, input: MovementInput, P: MovementParams, env: CharacterEnv, dt: number, maxHealthFragments: number): MovementEvents {
  const ev = emptyEvents();
  const pc = P.player;
  const body = pc.body;
  const st = pc.stamina;
  s.time += dt;
  s.stamina.spentThisStep = 0;
  s.rollTimer += dt;
  if (!s.grounded && (input.dodgePressed || input.crouchPressed)) s.rollTimer = 0;
  const wasExhausted = s.stamina.exhausted;
  const moving = input.moveX * input.moveX + input.moveZ * input.moveZ > 0.01;

  switch (s.mode) {
    case 'ledge': {
      const L = s.ledge;
      const back = moving ? (input.moveX * -L.nx + input.moveZ * -L.nz) / Math.hypot(input.moveX, input.moveZ) : 0;
      const r = stepLedge(s, { release: input.crouchPressed || input.dodgePressed || back < P.ledge.releaseBackInput }, P.ledge, dt);
      if (r.boosted) ev.ledgeBoost = { mantle: !L.paid };
      ev.ledgeExit = r.exited;
      ev.ledgeReleased = r.released;
      break;
    }

    case 'climb': {
      const r = stepClimb(s, { right: input.right, up: input.forward, jumpPressed: input.jumpPressed, dropPressed: input.crouchPressed }, pc.climb, st, body, env, dt);
      ev.climbJump = r.jumped;
      if (r.outcome === 'topout' && r.top) {
        const c = s.climb;
        beginLedge(
          s,
          { topY: r.top.topY, standX: r.top.standX, standZ: r.top.standZ, nx: c.nx, nz: c.nz, hitX: s.x - c.nx * (body.radius + 0.03), hitZ: s.z - c.nz * (body.radius + 0.03), material: c.material },
          true,
          true,
          body,
        );
        ev.climbTopOut = true;
      }
      break;
    }

    case 'glide':
      stepGlideMode(s, input, P, env, dt, ev);
      break;

    default:
      stepFreeMode(s, input, P, env, dt, ev, moving, maxHealthFragments);
  }

  // Sin recarga mientras se trepa, se planea o se nada (como en el diseño: hay que buscar dónde descansar).
  if (s.mode !== 'climb' && s.mode !== 'glide' && !(s.mode === 'swim' && moving)) updateStamina(s.stamina, dt, st);
  else s.stamina.sinceSpend = 0;
  if (!wasExhausted && s.stamina.exhausted) ev.exhausted = true;
  return ev;
}

function stepFreeMode(s: CharacterState, input: MovementInput, P: MovementParams, env: CharacterEnv, dt: number, ev: MovementEvents, moving: boolean, maxHealth: number): void {
  const pc = P.player;
  const body = pc.body;
  const st = pc.stamina;
  const wasGrounded = s.grounded;

  // Esquiva: ráfaga corta con invulnerabilidad (la resuelve el combate leyendo `dodgeT`).
  const dg = pc.combat.dodge;
  s.dodgeT += dt;
  if (input.dodgePressed && s.grounded && !s.sliding && !s.swimming && s.dodgeT > dg.seconds + dg.cooldown && spend(s.stamina, dg.stamina, 'dodge', st)) {
    const l = Math.hypot(input.moveX, input.moveZ);
    // Sin dirección: paso atrás.
    s.dodgeX = l > 0.1 ? input.moveX / l : -Math.sin(s.yaw);
    s.dodgeZ = l > 0.1 ? input.moveZ / l : -Math.cos(s.yaw);
    s.dodgeT = 0;
    ev.dodged = true;
  }
  let forcedVelocity: { x: number; z: number } | undefined;
  if (s.dodgeT < dg.seconds) {
    const k = s.dodgeT / dg.seconds;
    const v = dg.speed * (1 - 0.55 * k * k);
    forcedVelocity = { x: s.dodgeX * v, z: s.dodgeZ * v };
  } else if (input.lunge && input.lunge > 0 && s.grounded) {
    const yaw = input.faceYaw ?? s.yaw;
    forcedVelocity = { x: Math.sin(yaw) * input.lunge, z: Math.cos(yaw) * input.lunge };
  }

  // Sprint y natación consumen stamina.
  const wantsSprint = input.sprint && moving && s.grounded && !s.swimming && canUse(s.stamina);
  s.sprinting = wantsSprint && spendRate(s.stamina, st.costs.sprint, dt, 'sprint', st);
  if (s.swimming && moving) spendRate(s.stamina, st.costs.swim, dt, 'swim', st);

  const cev = stepCharacter(
    s,
    {
      moveX: input.moveX,
      moveZ: input.moveZ,
      jumpPressed: input.jumpPressed,
      jumpHeld: input.jumpHeld,
      crouch: input.crouch && !s.swimming,
      walk: input.walk,
      sprint: s.sprinting,
      dive: input.crouch && s.swimming,
      forcedVelocity,
      faceYaw: s.dodgeT < dg.seconds ? undefined : input.faceYaw,
    },
    pc.movement,
    body,
    env,
    dt,
  );
  ev.jumped = cev.jumped;

  // Chimeneas ancestrales: saltar dentro lanza hacia arriba.
  if (cev.jumped && env.airflowAt) {
    const a = env.airflowAt(s.x, s.y, s.z, airTmp);
    if (a.launch > 0) {
      s.vy = a.launch;
      s.jumpRising = false;
      ev.launched = true;
    }
  }

  if (!wasGrounded && s.grounded) {
    const rolled = s.rollTimer <= pc.fall.rollWindow;
    ev.landed = { speed: cev.landedSpeed, drop: cev.landedDrop, damage: fallDamage(cev.landedDrop, maxHealth, pc.fall, rolled), rolled, water: false, fromGlide: false };
  }
  if (cev.landedInWater) {
    ev.splash = true;
    ev.landed = { speed: cev.landedSpeed, drop: cev.landedDrop, damage: 0, rolled: false, water: true, fromGlide: false };
  }

  s.mode = s.swimming ? 'swim' : s.grounded ? 'ground' : 'air';

  // Dirección de intención: entrada del jugador o, si no hay, la velocidad / orientación.
  const hv = Math.hypot(s.vx, s.vz);
  const dirX = moving ? input.moveX : hv > 0.5 ? s.vx : Math.sin(s.yaw);
  const dirZ = moving ? input.moveZ : hv > 0.5 ? s.vz : Math.cos(s.yaw);

  // --- Impulso de Borde (en el aire o desde el agua), automático salvo accesibilidad.
  if ((s.mode === 'air' || s.mode === 'swim') && (moving || hv > 0.5) && !(P.ledgeRequiresHold && !input.jumpHeld)) {
    const cand = detectLedge(s, dirX, dirZ, P.ledge, body, env);
    if (cand) {
      const paid = spend(s.stamina, P.ledge.staminaCost, 'ledge', st);
      s.swimming = false;
      beginLedge(s, cand, paid, false, body);
      ev.ledgeContact = true;
      return;
    }
  }

  // --- Escalada.
  if (s.mode === 'air' && moving && canUse(s.stamina)) {
    const hit = probeClimbable(s, input.moveX, input.moveZ, 1.0, body.radius + 0.35, pc.climb, env);
    if (hit && -(input.moveX * hit.nx + input.moveZ * hit.nz) > 0.3) {
      beginClimb(s, hit, body);
      ev.climbStart = true;
      return;
    }
  }
  if (s.mode === 'ground' && canUse(s.stamina)) {
    let pushing = false;
    if (moving) {
      const low = probeClimbable(s, input.moveX, input.moveZ, 1.0, body.radius + 0.3, pc.climb, env);
      if (low && -(input.moveX * low.nx + input.moveZ * low.nz) / Math.hypot(input.moveX, input.moveZ) > 0.6) {
        // Solo paredes de verdad: los bloques bajos se saltan.
        pushing = probeClimbable(s, input.moveX, input.moveZ, pc.climb.minWallHeight + 0.1, body.radius + 0.6, pc.climb, env) !== null;
      }
    }
    s.pushTimer = pushing ? s.pushTimer + dt : 0;
    if (s.pushTimer >= pc.climb.startPushSeconds) {
      const hit = probeClimbable(s, input.moveX, input.moveZ, 1.0, body.radius + 0.3, pc.climb, env);
      if (hit) {
        s.pushTimer = 0;
        beginClimb(s, hit, body);
        ev.climbStart = true;
        return;
      }
    }
  }
  if (input.grabPressed && (s.mode === 'ground' || s.mode === 'air') && canUse(s.stamina)) {
    const hit = probeClimbable(s, Math.sin(s.yaw), Math.cos(s.yaw), 1.0, body.radius + 0.8, pc.climb, env);
    if (hit) {
      beginClimb(s, hit, body);
      ev.climbStart = true;
      return;
    }
  }

  // --- Planeador: pulsar de nuevo en el aire (o mantener, según accesibilidad).
  const wantsGlide = P.gliderInput === 'toggle' ? input.jumpPressed : input.jumpHeld && s.vy < 0;
  if (s.mode === 'air' && s.hasGlider && wantsGlide && !wasGrounded && !cev.jumped && canUse(s.stamina)) {
    const below = surfaceBelow(env, s.x, s.z, s.y + 0.05, P.glider.minDeployHeight + 0.05);
    const water = env.waterLevelAt(s.x, s.z);
    const tooLowForWater = water !== null && s.y - water < P.glider.minDeployHeight;
    if (!below && !tooLowForWater) {
      s.jumpBufferTimer = 0;
      beginGlide(s, P.glider);
      ev.gliderDeploy = true;
      return;
    }
  }

  // --- Agua: aire al bucear y hundirse agotado.
  if (s.swimming) {
    if (s.underwater) s.air -= dt;
    else s.air = Math.min(pc.swim.airSeconds, s.air + pc.swim.airRefillRate * dt);
    s.sinkTimer = s.stamina.exhausted ? s.sinkTimer + dt : 0;
    if (s.air <= 0 || s.sinkTimer >= pc.swim.drownSinkSeconds) ev.drowned = true;
  } else {
    s.air = Math.min(pc.swim.airSeconds, s.air + pc.swim.airRefillRate * dt);
    s.sinkTimer = 0;
  }

  // Última posición segura (para reaparecer tras ahogarse).
  if (s.grounded && !s.sliding && s.waterDepth < 0.05) {
    s.safeX = s.x;
    s.safeY = s.y;
    s.safeZ = s.z;
  }
}

function stepGlideMode(s: CharacterState, input: MovementInput, P: MovementParams, env: CharacterEnv, dt: number, ev: MovementEvents): void {
  const pc = P.player;
  const body = pc.body;
  const g = s.glide;

  // Agarrar un borde durante el planeo: cancela el planeo y activa el impulso (coste normal).
  const cand = detectLedge(s, Math.sin(g.heading), Math.cos(g.heading), P.ledge, body, env);
  if (cand && !(P.ledgeRequiresHold && !input.jumpHeld)) {
    const paid = spend(s.stamina, P.ledge.staminaCost, 'ledge', pc.stamina);
    beginLedge(s, cand, paid, false, body);
    ev.ledgeContact = true;
    ev.gliderFold = 'ledge';
    return;
  }

  const fold = P.gliderInput === 'toggle' ? input.jumpPressed : !input.jumpHeld;
  if (fold) {
    foldGlider(s);
    ev.gliderFold = 'input';
    return;
  }

  const r = stepGlide(s, { turn: input.right, pitch: input.forward }, P.glider, P.gliderMods, pc.stamina, env, dt);
  if (r.exhausted) {
    foldGlider(s);
    ev.gliderFold = 'stamina';
    return;
  }

  // Integración con colisiones.
  const dist = Math.hypot(s.vx, s.vz) * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.25));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    const px = s.x;
    const pz = s.z;
    s.x += s.vx * sdt;
    s.z += s.vz * sdt;
    let blockedNx = 0;
    let blockedNz = 0;
    let blocked = false;
    if (env.terrainHeight(s.x, s.z) > s.y + 0.3) {
      const n = env.terrainNormal(s.x, s.z);
      s.x = px;
      s.z = pz;
      blocked = true;
      blockedNx = n.x;
      blockedNz = n.z;
    }
    const push = env.colliders.pushOut(s, body.radius, body.height, 0.3);
    if (push.hit) {
      blocked = true;
      blockedNx = push.nx;
      blockedNz = push.nz;
    }
    if (blocked) {
      // Contra una pared escalable: se agarra. Si no, roza y pierde velocidad.
      const hit = probeClimbable(s, Math.sin(g.heading), Math.cos(g.heading), 1.0, body.radius + 0.5, pc.climb, env);
      if (hit && canUse(s.stamina)) {
        beginClimb(s, hit, body);
        ev.climbStart = true;
        ev.gliderFold = 'wall';
        return;
      }
      clipVelocity(s, blockedNx, blockedNz);
      g.speed = Math.min(g.speed, Math.hypot(s.vx, s.vz)) * 0.9;
    }
  }

  s.y += s.vy * dt;
  const terrainH = env.terrainHeight(s.x, s.z);
  const colTop = env.colliders.topAt(s.x, s.z, body.radius * 0.6, s.y + 0.4);
  const ground = Math.max(terrainH, colTop);
  const water = env.waterLevelAt(s.x, s.z);

  if (water !== null && water - ground > pc.movement.floatDepth && s.y <= water - 0.2) {
    // Al agua: se pliega sin daño ni coste.
    foldGlider(s);
    s.swimming = true;
    s.mode = 'swim';
    s.vy = 0;
    s.y = water - pc.movement.floatDepth;
    ev.glideLand = { x: s.x, z: s.z, water: true };
    ev.splash = true;
    ev.gliderFold = 'input';
    return;
  }
  if (s.y <= ground) {
    // Aterrizar planeando nunca hace daño.
    const speed = -s.vy;
    foldGlider(s);
    s.y = ground;
    s.vy = 0;
    s.vx *= 0.4;
    s.vz *= 0.4;
    s.mode = 'ground';
    s.grounded = true;
    s.airTime = 0;
    s.fallStartY = ground;
    ev.glideLand = { x: s.x, z: s.z, water: false };
    ev.landed = { speed, drop: 0, damage: 0, rolled: false, water: false, fromGlide: true };
    ev.gliderFold = 'input';
  }
}
