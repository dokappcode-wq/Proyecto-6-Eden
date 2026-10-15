import { v, type Infer, type Schema } from './schema';

const color = v.string({ pattern: /^#[0-9a-fA-F]{6}$/, hint: 'color "#rrggbb"' });

function tuple2(): Schema<[number, number]> {
  return v.array(v.number(), { length: 2 }) as Schema<[number, number]>;
}
function tuple3(): Schema<[number, number, number]> {
  return v.array(v.number(), { length: 3 }) as Schema<[number, number, number]>;
}
const vec2 = tuple2();
const vec3 = tuple3();
const polyline = v.array(vec2, { minLength: 2 });

// ---------------------------------------------------------------- game.json
export const gameConfigSchema = v.object({
  title: v.string({ minLength: 1 }),
  /** Fase de contenido activa: el tutorial solo activa pasos con `phase` <= este valor. */
  contentPhase: v.number({ min: 0, max: 11, integer: true }),
  loop: v.object({
    fixedStepHz: v.number({ min: 20, max: 240, integer: true }),
    maxSubSteps: v.number({ min: 1, max: 20, integer: true }),
    maxFrameSeconds: v.number({ min: 0.05, max: 1 }),
  }),
  render: v.object({
    maxPixelRatio: v.number({ min: 0.5, max: 3 }),
    shadows: v.boolean(),
    shadowMapSize: v.number({ min: 256, max: 8192, integer: true }),
    shadowRadius: v.number({ min: 10, max: 400 }),
    cameraNear: v.number({ min: 0.01 }),
    cameraFar: v.number({ min: 100 }),
  }),
  debug: v.object({
    startVisible: v.boolean(),
    refreshMs: v.number({ min: 16, max: 2000 }),
    timeScaleFast: v.number({ min: 1, max: 1000 }),
  }),
});

// ---------------------------------------------------------------- input.json
/** Teclado: KeyboardEvent.code ("KeyW", "Space", "F3"...). Ratón: "Mouse0".."Mouse4". */
export const inputConfigSchema = v.object({
  actions: v.record(
    v.array(v.string({ pattern: /^(Mouse[0-4]|[A-Za-z0-9]+)$/, hint: 'código de tecla o MouseN' }), { minLength: 1 }),
  ),
});

// ---------------------------------------------------------------- player.json
export const playerConfigSchema = v.object({
  body: v.object({ radius: v.number({ min: 0.1, max: 2 }), height: v.number({ min: 0.5, max: 4 }), eyeHeight: v.number({ min: 0.3 }) }),
  movement: v.object({
    walkSpeed: v.number({ min: 0 }),
    jogSpeed: v.number({ min: 0 }),
    crouchSpeed: v.number({ min: 0 }),
    groundAccel: v.number({ min: 0 }),
    groundDecel: v.number({ min: 0 }),
    airAccel: v.number({ min: 0 }),
    turnSharpness: v.number({ min: 0 }),
    gravity: v.number({ min: 0 }),
    jumpHeight: v.number({ min: 0 }),
    jumpCutMultiplier: v.number({ min: 0, max: 1 }),
    coyoteTime: v.number({ min: 0, max: 1 }),
    jumpBuffer: v.number({ min: 0, max: 1 }),
    maxSlopeDeg: v.number({ min: 1, max: 89 }),
    slideAccel: v.number({ min: 0 }),
    stepHeight: v.number({ min: 0, max: 2 }),
    groundSnap: v.number({ min: 0, max: 2 }),
    maxFallSpeed: v.number({ min: 1 }),
    waterSpeedMultiplier: v.number({ min: 0, max: 1 }),
    wadeDepth: v.number({ min: 0 }),
    floatDepth: v.number({ min: 0 }),
    sprintSpeed: v.number({ min: 0 }),
    swimSpeed: v.number({ min: 0 }),
    diveSpeed: v.number({ min: 0 }),
    sinkSpeed: v.number({ min: 0 }),
  }),
  stamina: v.object({
    base: v.number({ min: 1 }),
    maxRings: v.number({ min: 1, max: 5, integer: true }),
    perRing: v.number({ min: 1 }),
    recoverRate: v.number({ min: 0 }),
    recoverDelay: v.number({ min: 0 }),
    exhaustedLockout: v.number({ min: 0 }),
    exhaustedRecoverFraction: v.number({ min: 0, max: 1 }),
    costs: v.object({
      sprint: v.number({ min: 0 }),
      climb: v.number({ min: 0 }),
      climbSlipperyMultiplier: v.number({ min: 1 }),
      swim: v.number({ min: 0 }),
      climbJump: v.number({ min: 0 }),
      dodge: v.number({ min: 0 }),
      heavyAttack: v.number({ min: 0 }),
      bowCharge: v.number({ min: 0 }),
      bowChargeGliding: v.number({ min: 0 }),
    }),
  }),
  climb: v.object({
    speed: v.number({ min: 0.1 }),
    jumpDistance: v.number({ min: 0 }),
    jumpSeconds: v.number({ min: 0.05 }),
    startPushSeconds: v.number({ min: 0 }),
    minWallHeight: v.number({ min: 0 }),
    maxSurfaceNy: v.number({ min: 0, max: 1 }),
    standNy: v.number({ min: 0, max: 1 }),
    probeDistance: v.number({ min: 0.1 }),
    slipperySlideSpeed: v.number({ min: 0 }),
    backflipSpeed: v.number({ min: 0 }),
  }),
  swim: v.object({
    airSeconds: v.number({ min: 1 }),
    airRefillRate: v.number({ min: 0 }),
    drownSinkSeconds: v.number({ min: 0.1 }),
    currentInfluence: v.number({ min: 0 }),
  }),
  fall: v.object({
    damageThreshold: v.number({ min: 0 }),
    lethalHeight: v.number({ min: 1 }),
    rollWindow: v.number({ min: 0 }),
    rollDamageMultiplier: v.number({ min: 0, max: 1 }),
  }),
  combat: v.object({
    dodge: v.object({
      speed: v.number({ min: 0 }),
      seconds: v.number({ min: 0.05 }),
      iframes: v.number({ min: 0 }),
      perfectWindow: v.number({ min: 0 }),
      perfectReach: v.number({ min: 0 }),
      cooldown: v.number({ min: 0 }),
      stamina: v.number({ min: 0 }),
    }),
    flurry: v.object({ seconds: v.number({ min: 0 }), worldScale: v.number({ min: 0.01, max: 1 }), strikeInterval: v.number({ min: 0.02 }) }),
    hitstop: v.object({ light: v.number({ min: 0 }), heavy: v.number({ min: 0 }), break: v.number({ min: 0 }) }),
    bulletTime: v.object({ airScale: v.number({ min: 0.05, max: 1 }), glideScale: v.number({ min: 0.05, max: 1 }) }),
    plunge: v.object({ minHeight: v.number({ min: 0 }), speed: v.number({ min: 1 }), radius: v.number({ min: 0.5 }), damageMultiplier: v.number({ min: 1 }) }),
    stomp: v.object({ damage: v.number({ min: 0 }), bounce: v.number({ min: 0 }) }),
    sneakMultiplier: v.number({ min: 1 }),
    throwMultiplier: v.number({ min: 0 }),
    breakDamageMultiplier: v.number({ min: 1 }),
    durabilityWarning: v.number({ min: 0, max: 1 }),
    attackMoveMultiplier: v.number({ min: 0, max: 1 }),
    lockOnRange: v.number({ min: 1 }),
    aimCamera: v.object({ distance: v.number({ min: 0.5 }), shoulder: v.number(), fov: v.number({ min: 20, max: 120 }) }),
    inventory: v.object({ weapons: v.number({ min: 1, integer: true }), bows: v.number({ min: 1, integer: true }), shields: v.number({ min: 1, integer: true }) }),
    status: v.object({
      poison: v.object({ seconds: v.number({ min: 0 }), tickSeconds: v.number({ min: 0.1 }), damagePerTick: v.number({ min: 0, integer: true }) }),
      shock: v.object({ seconds: v.number({ min: 0 }), dropsWeapon: v.boolean(), waterMultiplier: v.number({ min: 1 }) }),
    }),
    /** Radio de ruido (m) que oyen los enemigos según lo que hace el jugador. */
    noise: v.object({
      walk: v.number({ min: 0 }),
      jog: v.number({ min: 0 }),
      sprint: v.number({ min: 0 }),
      crouch: v.number({ min: 0 }),
      land: v.number({ min: 0 }),
      attack: v.number({ min: 0 }),
      hit: v.number({ min: 0 }),
      swim: v.number({ min: 0 }),
    }),
    /** Multiplicador de visibilidad en el aire y planeando. */
    airVisibility: v.number({ min: 1 }),
  }),
  health: v.object({
    startHearts: v.number({ min: 1, integer: true }),
    maxHearts: v.number({ min: 1, integer: true }),
    fragmentsPerHeart: v.number({ min: 1, integer: true }),
    drownDamageFragments: v.number({ min: 0, integer: true }),
  }),
  camera: v.object({
    distance: v.number({ min: 0.5 }),
    minDistance: v.number({ min: 0.5 }),
    maxDistance: v.number({ min: 1 }),
    pivotHeight: v.number(),
    shoulderOffset: v.number(),
    minPitchDeg: v.number({ min: -89, max: 0 }),
    maxPitchDeg: v.number({ min: 0, max: 89 }),
    startPitchDeg: v.number({ min: -89, max: 89 }),
    sensitivity: v.number({ min: 0 }),
    followSharpness: v.number({ min: 0 }),
    zoomSharpness: v.number({ min: 0 }),
    collisionPadding: v.number({ min: 0 }),
    recoverSharpness: v.number({ min: 0 }),
    fovBase: v.number({ min: 30, max: 120 }),
    fovSpeedBonus: v.number({ min: 0, max: 40 }),
    zoomStep: v.number({ min: 0 }),
    autoAlignDelay: v.number({ min: 0 }),
    autoAlignSharpness: v.number({ min: 0 }),
    glideDistanceBonus: v.number({ min: 0 }),
    glideAlignSharpness: v.number({ min: 0 }),
  }),
  respawn: v.object({ killDepthBelowSea: v.number({ min: 0 }) }),
});

// ---------------------------------------------------------------- daynight.json
const dayKeyframe = v.object({
  hour: v.number({ min: 0, max: 24 }),
  zenith: color,
  horizon: color,
  light: color,
  lightIntensity: v.number({ min: 0 }),
  ambientSky: color,
  ambientGround: color,
  ambientIntensity: v.number({ min: 0 }),
  fog: color,
  stars: v.number({ min: 0, max: 1 }),
});

export const dayNightConfigSchema = v.object({
  dayLengthSeconds: v.number({ min: 10 }),
  startHour: v.number({ min: 0, max: 24 }),
  sunTiltDeg: v.number({ min: 0, max: 80 }),
  keyframes: v.array(dayKeyframe, { minLength: 2 }),
});

// ---------------------------------------------------------------- terrain.json
const riverSchema = v.object({
  id: v.string({ minLength: 1 }),
  width: v.number({ min: 0.5 }),
  depth: v.number({ min: 0.1 }),
  waterLevel: v.number(),
  bankWidth: v.number({ min: 0 }),
  /** Velocidad de la corriente (m/s) a lo largo de la polilínea. */
  current: v.number({ min: 0 }),
  points: polyline,
});

const lakeSchema = v.object({
  id: v.string({ minLength: 1 }),
  center: vec2,
  radius: v.number({ min: 1 }),
  waterLevel: v.number(),
  depth: v.number({ min: 0.1 }),
});

export const terrainConfigSchema = v.object({
  seed: v.number({ integer: true }),
  worldSize: v.number({ min: 512 }),
  seaLevel: v.number(),
  physicsGrid: v.number({ min: 0.25, max: 16 }),
  fogDensity: v.number({ min: 0, max: 0.05 }),
  snowLine: v.number(),
  chunk: v.object({
    size: v.number({ min: 16, max: 1024 }),
    lodDistances: v.array(v.number({ min: 1 }), { length: 3 }),
    lodResolutions: v.array(v.number({ min: 2, max: 256, integer: true }), { length: 3 }),
    buildBudgetMs: v.number({ min: 0.5, max: 50 }),
    lookAheadSeconds: v.number({ min: 0, max: 10 }),
    unloadMargin: v.number({ min: 0 }),
    skirtDepth: v.number({ min: 0 }),
    vegetationDistance: v.number({ min: 0 }),
  }),
  far: v.object({ resolution: v.number({ min: 8 }), extent: v.number({ min: 512 }), drop: v.number({ min: 0 }) }),
  continent: v.object({ radius: v.number({ min: 100 }), coastNoise: v.number({ min: 0, max: 1 }), seaFloor: v.number() }),
  plains: v.object({ height: v.number(), amplitude: v.number({ min: 0 }), scale: v.number({ min: 0 }) }),
  mountains: v.object({ startZ: v.number(), fullZ: v.number(), height: v.number({ min: 0 }), scale: v.number({ min: 0 }) }),
  desert: v.object({
    startX: v.number(),
    fullX: v.number(),
    height: v.number(),
    duneAmplitude: v.number({ min: 0 }),
    duneScale: v.number({ min: 0 }),
  }),
  forest: v.object({ startX: v.number(), fullX: v.number(), height: v.number(), amplitude: v.number({ min: 0 }), scale: v.number({ min: 0 }) }),
  /** Archipiélago (oeste/suroeste): centro y radio de la zona de islas. */
  archipelago: v.optional(v.object({ center: vec2, radius: v.number({ min: 1 }) })),
  valley: v.object({
    center: vec2,
    floorHeight: v.number(),
    floorNoise: v.number({ min: 0 }),
    innerRadius: v.number({ min: 10 }),
    wallRadius: v.number({ min: 10 }),
    wallTop: v.number(),
    wallNoise: v.number({ min: 0 }),
    edgeNoise: v.number({ min: 0 }),
    outerStart: v.number({ min: 10 }),
    outerEnd: v.number({ min: 10 }),
    corridor: v.object({ halfWidth: v.number({ min: 1 }), blend: v.number({ min: 0.1 }), startZ: v.number() }),
    mounds: v.array(v.object({ center: vec2, radius: v.number({ min: 1 }), height: v.number() })),
  }),
  rivers: v.array(riverSchema),
  lakes: v.array(lakeSchema),
  paths: v.array(v.object({ width: v.number({ min: 0.2 }), points: polyline })),
  palette: v.object({
    grass: color,
    grassDry: color,
    grassLush: color,
    dirt: color,
    rock: color,
    rockDark: color,
    sand: color,
    snow: color,
    seaFloor: color,
    desert: color,
    forest: color,
    riverBed: color,
  }),
});

// ---------------------------------------------------------------- valley.json
const placed = { position: vec2, rotationY: v.number() };

export const valleyConfigSchema = v.object({
  capsule: v.object(placed),
  wreckage: v.array(v.object({ kind: v.oneOf(['panel', 'wing', 'engine', 'debris'] as const), ...placed, scale: v.number({ min: 0.1 }) })),
  tower: v.object({ id: v.string({ minLength: 1 }), ...placed, height: v.number({ min: 5 }), beamHeight: v.number({ min: 0 }) }),
  temple: v.object({ id: v.string({ minLength: 1 }), ...placed }),
  gate: v.object({ ...placed, width: v.number({ min: 1 }), height: v.number({ min: 1 }), depth: v.number({ min: 0.5 }) }),
  ruins: v.array(
    v.object({
      kind: v.oneOf(['block', 'pillar', 'arch', 'wall', 'slab', 'rockface'] as const),
      ...placed,
      size: vec3,
      /** Desplazamiento vertical de la base respecto al terreno. */
      yOffset: v.optional(v.number()),
      /** Si se indica, la cara superior queda a esta altura absoluta (piedras de río). */
      topAbsolute: v.optional(v.number()),
      runes: v.optional(v.boolean()),
    }),
  ),
  inscriptions: v.array(
    v.object({
      id: v.string({ minLength: 1 }),
      ...placed,
      yOffset: v.number(),
      style: v.optional(v.oneOf(['stele', 'terminal'] as const)),
      title: v.string({ minLength: 1 }),
      text: v.string({ minLength: 1 }),
    }),
  ),
  trees: v.array(v.object({ position: vec2, scale: v.number({ min: 0.1 }), kind: v.oneOf(['pine', 'broadleaf'] as const) })),
  rocks: v.array(v.object({ ...placed, scale: v.number({ min: 0.1 }) })),
  waterfalls: v.array(v.object({ top: vec3, bottom: vec3, width: v.number({ min: 0.5 }) })),
  floatingIslands: v.array(v.object({ position: vec3, radius: v.number({ min: 5 }), waterfall: v.boolean() })),
  pickups: v.array(v.object({ id: v.string({ minLength: 1 }), item: v.string({ minLength: 1 }), count: v.number({ min: 1, integer: true }), position: vec2, yOffset: v.number() })),
  enemySpawns: v.array(v.object({ id: v.string({ minLength: 1 }), enemy: v.string({ minLength: 1 }), position: vec2, count: v.number({ min: 1, integer: true }), radius: v.number({ min: 0 }) })),
});

// ---------------------------------------------------------------- ledge_boost.json
export const ledgeBoostConfigSchema = v.object({
  reachMin: v.number({ min: 0 }),
  reachMax: v.number({ min: 0.5 }),
  maxTopSlopeDeg: v.number({ min: 0, max: 89 }),
  maxApproachAngleDeg: v.number({ min: 0, max: 90 }),
  maxUpwardSpeed: v.number({ min: 0 }),
  maxDownwardSpeed: v.number({ min: 0 }),
  chestHeight: v.number({ min: 0 }),
  probeDistance: v.number({ min: 0.05 }),
  inwardOffset: v.number({ min: 0.05 }),
  contactSeconds: v.number({ min: 0 }),
  boostSeconds: v.number({ min: 0.05 }),
  mantleSeconds: v.number({ min: 0.05 }),
  exitSpeedFraction: v.number({ min: 0, max: 1 }),
  staminaCost: v.number({ min: 0 }),
  chainMinSeconds: v.number({ min: 0 }),
  chainMaxHeight: v.number({ min: 0 }),
  releaseBackInput: v.number({ min: -1, max: 0 }),
  grabbableMaterials: v.array(v.string({ minLength: 1 })),
});

// ---------------------------------------------------------------- glider.json
export const gliderConfigSchema = v.object({
  minDeployHeight: v.number({ min: 0 }),
  deploySeconds: v.number({ min: 0, max: 1 }),
  forwardSpeed: v.number({ min: 0 }),
  fallSpeed: v.number({ min: 0 }),
  turnRate: v.number({ min: 0 }),
  bankMaxRad: v.number({ min: 0, max: 1.5 }),
  accel: v.number({ min: 0 }),
  staminaPerSecond: v.number({ min: 0 }),
  dive: v.object({ speed: v.number({ min: 0 }), fallSpeed: v.number({ min: 0 }), accel: v.number({ min: 0 }) }),
  flare: v.object({ speed: v.number({ min: 0 }), fallSpeed: v.number({ min: 0 }), decel: v.number({ min: 0 }) }),
  pullUpLiftFactor: v.number({ min: 0 }),
  maxPullUpLift: v.number({ min: 0 }),
  verticalResponse: v.number({ min: 0.1 }),
  windInfluence: v.number({ min: 0 }),
  thermal: v.object({ staminaFree: v.boolean() }),
  upgrades: v.array(
    v.object({
      id: v.string({ minLength: 1 }),
      name: v.string({ minLength: 1 }),
      staminaMultiplier: v.number({ min: 0 }),
      fallMultiplier: v.number({ min: 0 }),
      windMultiplier: v.number({ min: 0 }),
    }),
  ),
});

// ---------------------------------------------------------------- airflow.json
export const airflowConfigSchema = v.object({
  globalWind: v.object({ direction: vec2, strength: v.number({ min: 0 }) }),
  windZones: v.array(
    v.object({
      id: v.string({ minLength: 1 }),
      center: vec2,
      radius: v.number({ min: 1 }),
      direction: vec2,
      strength: v.number({ min: 0 }),
      maxHeight: v.number(),
    }),
  ),
  thermals: v.array(
    v.object({
      id: v.string({ minLength: 1 }),
      kind: v.oneOf(['ancestral_vent', 'warm_air'] as const),
      position: vec2,
      radius: v.number({ min: 0.5 }),
      height: v.number({ min: 1 }),
      lift: v.number({ min: 0 }),
      /** Impulso vertical al saltar dentro (0 = no lanza). */
      launch: v.number({ min: 0 }),
    }),
  ),
});

// ---------------------------------------------------------------- materials.json
export const materialsConfigSchema = v.record(v.object({ climbable: v.boolean(), grabbable: v.boolean(), slippery: v.boolean() }));

// ---------------------------------------------------------------- settings.json
export const settingsConfigSchema = v.object({
  accessibility: v.object({
    ledgeBoostRequiresHold: v.boolean(),
    gliderInput: v.oneOf(['toggle', 'hold'] as const),
    flightIndicators: v.boolean(),
  }),
});

// ---------------------------------------------------------------- temples.json
export const templesConfigSchema = v.object({
  temples: v.array(
    v.object({
      id: v.string({ minLength: 1 }),
      name: v.string({ minLength: 1 }),
      challenge: v.number({ min: 1, max: 10, integer: true }),
      challengeName: v.string({ minLength: 1 }),
      biome: v.string({ minLength: 1 }),
      difficulty: v.number({ min: 1, max: 5, integer: true }),
      reward: v.oneOf(['glider', 'heart_fragment', 'stamina_fragment'] as const),
      instanceOrigin: vec3,
      atmosphere: v.object({
        zenith: color,
        horizon: color,
        fog: color,
        fogDensity: v.number({ min: 0 }),
        ambient: color,
        light: color,
      }),
      killDepth: v.number({ min: 1 }),
      start: vec3,
      course: v.array(
        v.object({
          position: vec3,
          size: vec3,
          material: v.string({ minLength: 1 }),
          checkpoint: v.optional(v.boolean()),
          glyph: v.optional(v.boolean()),
        }),
        { minLength: 1 },
      ),
      altar: vec3,
      exitPortal: vec3,
      inscription: v.string({ minLength: 1 }),
    }),
  ),
});

// ---------------------------------------------------------------- weapons.json
/** Elementos de daño: físico, veneno, electricidad, fuego, hielo y sangrado. */
export const ELEMENTS = ['physical', 'poison', 'shock', 'fire', 'ice', 'bleed'] as const;
export const WEAPON_CATEGORIES = ['fists', 'club', 'sword', 'greatsword', 'daggers', 'spear', 'axe', 'hammer', 'bow', 'staff'] as const;
export const SPECIALS = ['none', 'leap_thrust', 'spin_360', 'backstab_x4', 'line_charge', 'shield_break', 'shockwave', 'triple_arrow'] as const;
const RARITIES = ['common', 'fine', 'rare', 'legendary'] as const;

const comboHitSchema = v.object({
  windup: v.number({ min: 0 }),
  active: v.number({ min: 0.01 }),
  recovery: v.number({ min: 0 }),
  damage: v.number({ min: 0 }),
  knockback: v.number({ min: 0 }),
});

const weaponSchema = v.object({
  id: v.string({ minLength: 1 }),
  name: v.string({ minLength: 1 }),
  category: v.oneOf(WEAPON_CATEGORIES),
  rarity: v.oneOf(RARITIES),
  damage: v.number({ min: 0 }),
  /** 0 = irrompible (puños). */
  durability: v.number({ min: 0, integer: true }),
  reach: v.number({ min: 0 }),
  /** Arco de golpe en grados. */
  arc: v.number({ min: 0, max: 360 }),
  combo: v.array(comboHitSchema),
  heavy: v.object({ stamina: v.number({ min: 0 }), chargeTime: v.number({ min: 0 }), damageMultiplier: v.number({ min: 0 }), special: v.oneOf(SPECIALS) }),
  throwable: v.boolean(),
  tags: v.array(v.string({ minLength: 1 })),
  bow: v.optional(v.object({ drawTime: v.number({ min: 0.05 }), arrowSpeed: v.number({ min: 1 }), minSpeedFraction: v.number({ min: 0, max: 1 }), multishotSpread: v.number({ min: 0 }) })),
  /** Elemento que aplica cada golpe (antorcha = fuego). */
  element: v.optional(v.oneOf(ELEMENTS)),
  /** Bastón elemental: dispara su elemento al atacar. */
  staff: v.optional(v.object({ element: v.oneOf(ELEMENTS), speed: v.number({ min: 1 }), cooldown: v.number({ min: 0.05 }), damage: v.number({ min: 0 }), radius: v.number({ min: 0 }) })),
  model: v.object({ kind: v.string({ minLength: 1 }), length: v.number({ min: 0 }), color }),
});

const shieldSchema = v.object({
  id: v.string({ minLength: 1 }),
  name: v.string({ minLength: 1 }),
  rarity: v.oneOf(RARITIES),
  guard: v.number({ min: 0 }),
  durability: v.number({ min: 1, integer: true }),
  parryWindow: v.number({ min: 0, max: 1 }),
  guardArc: v.number({ min: 0, max: 360 }),
  moveMultiplier: v.number({ min: 0, max: 1 }),
  reflectsWhileGuarding: v.boolean(),
  surfSpeed: v.number({ min: 0 }),
  tags: v.array(v.string({ minLength: 1 })),
  model: v.object({ kind: v.oneOf(['round', 'tower', 'mirror'] as const), size: v.number({ min: 0.1 }), color }),
});

export const weaponsConfigSchema = v.object({ weapons: v.array(weaponSchema, { minLength: 1 }), shields: v.array(shieldSchema) });

// ---------------------------------------------------------------- enemies.json
export const ENEMY_FAMILIES = ['golem', 'goblin', 'slime', 'fauna', 'automaton', 'biome_special'] as const;

export const ATTACK_KINDS = ['lunge', 'swing', 'thrust', 'slam', 'shockwave', 'projectile', 'dive', 'discharge', 'rockfall', 'summon'] as const;
export const PROJECTILE_LOOKS = ['arrow', 'rock', 'goo', 'spark', 'fireball', 'iceshard'] as const;

const attackSchema = v.object({
  id: v.string({ minLength: 1 }),
  kind: v.oneOf(ATTACK_KINDS),
  /** Rango (distancia horizontal al jugador) en el que se elige este ataque. */
  minRange: v.number({ min: 0 }),
  maxRange: v.number({ min: 0 }),
  windup: v.number({ min: 0 }),
  active: v.number({ min: 0.01 }),
  recovery: v.number({ min: 0 }),
  cooldown: v.number({ min: 0 }),
  /** Daño en fragmentos de corazón. */
  damage: v.number({ min: 0, integer: true }),
  knockback: v.number({ min: 0 }),
  element: v.oneOf(ELEMENTS),
  /** Alcance del golpe (swing/thrust/lunge) o desplazamiento del centro (slam). */
  reach: v.number({ min: 0 }),
  /** Arco en grados (swing/thrust). */
  arc: v.number({ min: 0, max: 360 }),
  /** Radio del área (slam, discharge, dive, rockfall). */
  radius: v.number({ min: 0 }),
  /** Velocidad (embestida, onda, proyectil, picado). */
  speed: v.number({ min: 0 }),
  weight: v.number({ min: 0 }),
  /** Fase mínima del jefe para usarlo (1 si no es jefe). */
  phase: v.number({ min: 1, max: 3, integer: true }),
  /** Solo contra un jugador en el aire / planeando. */
  airOnly: v.boolean(),
  /** Muestra marca de aviso en el suelo durante la preparación. */
  telegraph: v.boolean(),
  /** Número de proyectiles, rocas o invocados. */
  count: v.number({ min: 1, integer: true }),
  projectile: v.optional(v.object({ look: v.oneOf(PROJECTILE_LOOKS), gravity: v.number({ min: 0 }), size: v.number({ min: 0.02 }), lead: v.boolean() })),
  summon: v.optional(v.string({ minLength: 1 })),
});

const sensesSchema = v.object({
  /** Distancia de visión de día (m). */
  sight: v.number({ min: 0 }),
  /** Cono de visión (grados). */
  fov: v.number({ min: 0, max: 360 }),
  /** Multiplicador del radio de ruido del jugador. */
  hearing: v.number({ min: 0 }),
  /** Radio en el que nota al jugador aunque no lo vea (de pie). */
  nearSense: v.number({ min: 0 }),
  /** Segundos para pasar de tranquilo a combate viendo al jugador a media distancia. */
  notice: v.number({ min: 0.05 }),
  /** Segundos sin verlo antes de pasar a búsqueda. */
  forget: v.number({ min: 0 }),
  /** Segundos que busca antes de volver a su rutina. */
  search: v.number({ min: 0 }),
});

const enemySchema = v.object({
  id: v.string({ minLength: 1 }),
  name: v.string({ minLength: 1 }),
  family: v.oneOf(ENEMY_FAMILIES),
  variant: v.string({ minLength: 1 }),
  hp: v.number({ min: 1 }),
  moveSpeed: v.number({ min: 0 }),
  runSpeed: v.number({ min: 0 }),
  turnSpeed: v.number({ min: 0 }),
  senses: sensesSchema,
  loseRadius: v.number({ min: 0 }),
  attacks: v.array(attackSchema, { minLength: 1 }),
  radius: v.number({ min: 0.1 }),
  height: v.number({ min: 0.1 }),
  weakPointBonus: v.number({ min: 1 }),
  stunTime: v.number({ min: 0 }),
  /** Daño de un solo golpe que lo hace tambalearse (interrumpe su ataque). */
  poise: v.number({ min: 0 }),
  knockbackResist: v.number({ min: 0, max: 1 }),
  tags: v.array(v.string({ minLength: 1 })),
  color,
  loot: v.string({ minLength: 1 }),
  stompable: v.boolean(),
  slime: v.optional(
    v.object({
      hopInterval: v.number({ min: 0.05 }),
      hopHeight: v.number({ min: 0 }),
      splitInto: v.optional(v.object({ enemy: v.string({ minLength: 1 }), count: v.number({ min: 1, integer: true }) })),
      /** Aura eléctrica: periodo y duración de la carga (s). */
      aura: v.optional(v.object({ period: v.number({ min: 0.5 }), duration: v.number({ min: 0.1 }) })),
    }),
  ),
  goblin: v.optional(
    v.object({
      weapon: v.object({ kind: v.string({ minLength: 1 }), length: v.number({ min: 0 }), color }),
      /** Distancia que intenta mantener en combate [mín, máx]. */
      keepRange: vec2,
      /** Fracción de vida por debajo de la cual puede huir. */
      fleeHp: v.number({ min: 0, max: 1 }),
      /** Arma que suelta al morir (además del botín). */
      drop: v.optional(v.string({ minLength: 1 })),
      dropChance: v.number({ min: 0, max: 1 }),
    }),
  ),
  golem: v.optional(
    v.object({
      /** Altura del cristal (fracción de la altura) y si está en el pecho o en la espalda. */
      crystalHeight: v.number({ min: 0, max: 1.2 }),
      crystalSide: v.oneOf(['front', 'back', 'top'] as const),
      crystalRadius: v.number({ min: 0.05 }),
      /** Segundos de rodillas tras un flechazo en el cristal. */
      crystalStun: v.number({ min: 0 }),
      /** Empieza dormido como un montón de rocas. */
      dormant: v.boolean(),
      wakeSeconds: v.number({ min: 0 }),
    }),
  ),
  hawk: v.optional(
    v.object({
      altitude: v.number({ min: 2 }),
      circleRadius: v.number({ min: 2 }),
      flySpeed: v.number({ min: 1 }),
      /** Altura mínima del jugador sobre el suelo para considerarlo presa. */
      preyHeight: v.number({ min: 0 }),
      huntRadius: v.number({ min: 1 }),
    }),
  ),
  boss: v.optional(
    v.object({
      title: v.string({ minLength: 1 }),
      /** Umbrales de vida (fracción) que abren la fase 2 y 3. */
      phases: v.array(v.number({ min: 0, max: 1 }), { length: 2 }),
      arenaRadius: v.number({ min: 5 }),
      enrageSpeed: v.number({ min: 1 }),
    }),
  ),
});

export const enemiesConfigSchema = v.object({ enemies: v.array(enemySchema, { minLength: 1 }) });

// ---------------------------------------------------------------- items.json / loot_tables.json
export const FOOD_MODELS = ['fruit', 'mushroom', 'flower', 'herb', 'meat', 'critter', 'part'] as const;
export const FOOD_EFFECTS = ['hearty', 'stamina', 'endurance', 'cold', 'heat', 'attack', 'defense', 'stealth', 'speed', 'shock'] as const;

export const itemsConfigSchema = v.object({
  items: v.array(
    v.object({
      id: v.string({ minLength: 1 }),
      name: v.string({ minLength: 1 }),
      category: v.oneOf(['ammo', 'material', 'ingredient', 'key'] as const),
      stack: v.number({ min: 1, integer: true }),
      color,
      /** Flechas elementales. */
      element: v.optional(v.oneOf(ELEMENTS)),
      /** Ingredientes (y partes de monstruo para elixires). */
      food: v.optional(
        v.object({
          /** Fragmentos de corazón que cura crudo. */
          heal: v.number({ min: 0 }),
          tags: v.array(v.string({ minLength: 1 })),
          model: v.oneOf(FOOD_MODELS),
          effect: v.optional(v.oneOf(FOOD_EFFECTS)),
          potency: v.number({ min: 0 }),
          seconds: v.number({ min: 0 }),
        }),
      ),
    }),
  ),
});

export const lootTablesConfigSchema = v.object({
  tables: v.record(v.array(v.object({ item: v.string({ minLength: 1 }), chance: v.number({ min: 0, max: 1 }), min: v.number({ min: 0, integer: true }), max: v.number({ min: 0, integer: true }) }))),
});

// ---------------------------------------------------------------- encounters.json
export const CAMP_ROLES = ['leader', 'guard', 'cook', 'sleeper', 'lookout', 'patrol'] as const;

const campSchema = v.object({
  id: v.string({ minLength: 1 }),
  name: v.string({ minLength: 1 }),
  center: vec2,
  radius: v.number({ min: 4 }),
  fire: vec2,
  horn: v.optional(vec2),
  regroup: vec2,
  tents: v.array(v.object({ position: vec2, yaw: v.number() })),
  lookout: v.optional(v.object({ position: vec2, height: v.number({ min: 1 }) })),
  chest: v.object({ position: vec2, yaw: v.number(), loot: v.string({ minLength: 1 }) }),
  members: v.array(
    v.object({
      enemy: v.string({ minLength: 1 }),
      role: v.oneOf(CAMP_ROLES),
      position: vec2,
      /** Punto de guardia (mira hacia fuera del campamento). */
      post: v.optional(vec2),
    }),
    { minLength: 1 },
  ),
  patrol: v.array(vec2),
  reinforcements: v.optional(v.object({ from: vec2, members: v.array(v.string({ minLength: 1 }), { minLength: 1 }) })),
});

export const encountersConfigSchema = v.object({
  schedule: v.object({
    sleepFrom: v.number({ min: 0, max: 24 }),
    sleepTo: v.number({ min: 0, max: 24 }),
    meals: v.array(vec2),
    /** Radio iluminado por la hoguera de noche (m). */
    fireLightRadius: v.number({ min: 0 }),
  }),
  camps: v.array(campSchema),
  groups: v.array(
    v.object({
      id: v.string({ minLength: 1 }),
      enemy: v.string({ minLength: 1 }),
      position: vec2,
      count: v.number({ min: 1, integer: true }),
      radius: v.number({ min: 0 }),
      route: v.array(vec2),
    }),
  ),
  bosses: v.array(
    v.object({
      id: v.string({ minLength: 1 }),
      enemy: v.string({ minLength: 1 }),
      position: vec2,
      yaw: v.number(),
      reward: v.string({ minLength: 1 }),
    }),
  ),
  roosts: v.array(v.object({ id: v.string({ minLength: 1 }), enemy: v.string({ minLength: 1 }), center: vec2, count: v.number({ min: 1, integer: true }) })),
  /** Objetos colocados en el mundo (fuera del valle). */
  pickups: v.array(v.object({ id: v.string({ minLength: 1 }), item: v.string({ minLength: 1 }), count: v.number({ min: 1, integer: true }), position: vec2, yOffset: v.number() })),
  /** Puntos de teletransporte de depuración (F7). */
  teleports: v.array(v.object({ name: v.string({ minLength: 1 }), position: vec2 })),
});

// ---------------------------------------------------------------- biomes.json
export const BIOME_IDS = ['archipelago', 'sea', 'desert', 'plains', 'forest', 'mountains', 'sky', 'underground'] as const;
export const WEATHER_TYPES = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'sandstorm', 'fog'] as const;

export const biomesConfigSchema = v.object({
  biomes: v.array(
    v.object({
      id: v.oneOf(BIOME_IDS),
      name: v.string({ minLength: 1 }),
      palette: v.array(color, { minLength: 3 }),
      /** Temperatura de día y de noche (°C) al nivel de referencia. */
      temperature: v.object({ day: v.number(), night: v.number() }),
      /** Pesos de cada tiempo atmosférico. */
      weather: v.record(v.number({ min: 0 })),
      /** Viento base (m/s) y racheado. */
      wind: v.number({ min: 0 }),
      music: v.string({ minLength: 1 }),
      ambience: v.string({ minLength: 1 }),
    }),
    { minLength: 1 },
  ),
});

// ---------------------------------------------------------------- elements.json
export const elementsConfigSchema = v.object({
  fire: v.object({
    cellSize: v.number({ min: 0.5 }),
    /** Probabilidad por segundo de prender cada vecino (sin viento). */
    spreadChance: v.number({ min: 0, max: 1 }),
    /** Sesgo del viento: multiplica la propagación a favor del viento. */
    windBias: v.number({ min: 0 }),
    burnSeconds: v.number({ min: 0.5 }),
    /** Tiempo hasta que la hierba quemada vuelve a crecer. */
    regrowSeconds: v.number({ min: 1 }),
    /** Intensidad de lluvia a partir de la cual el fuego se apaga. */
    rainExtinguish: v.number({ min: 0, max: 1 }),
    maxCells: v.number({ min: 10, integer: true }),
    /** Fragmentos de corazón por segundo dentro de las llamas. */
    damagePerSecond: v.number({ min: 0 }),
    /** Corriente térmica: ascenso por celda ardiendo (m/s), máximo y altura. */
    liftPerCell: v.number({ min: 0 }),
    maxLift: v.number({ min: 0 }),
    thermalHeight: v.number({ min: 1 }),
    thermalRadius: v.number({ min: 1 }),
  }),
  ice: v.object({
    platformRadius: v.number({ min: 0.5 }),
    meltSeconds: v.number({ min: 1 }),
    freezeSeconds: v.number({ min: 0.1 }),
    shatterMultiplier: v.number({ min: 1 }),
  }),
  shock: v.object({ waterRadius: v.number({ min: 0 }), stunSeconds: v.number({ min: 0 }), damage: v.number({ min: 0, integer: true }) }),
  burn: v.object({ seconds: v.number({ min: 0 }), tickSeconds: v.number({ min: 0.1 }), damagePerTick: v.number({ min: 0, integer: true }) }),
  bleed: v.object({ seconds: v.number({ min: 0 }), tickSeconds: v.number({ min: 0.1 }), damagePerTick: v.number({ min: 0, integer: true }) }),
  freeze: v.object({ seconds: v.number({ min: 0 }) }),
  lightning: v.object({
    minInterval: v.number({ min: 1 }),
    maxInterval: v.number({ min: 1 }),
    warnSeconds: v.number({ min: 0.1 }),
    damage: v.number({ min: 0, integer: true }),
    radius: v.number({ min: 0.5 }),
    /** Probabilidad de que el rayo busque al jugador si lleva metal. */
    metalAttraction: v.number({ min: 0, max: 1 }),
  }),
  temperature: v.object({
    /** Rango cómodo (°C): fuera de él, daño periódico. */
    cold: v.number(),
    hot: v.number(),
    /** Umbral extremo: el daño se acelera. */
    freezing: v.number(),
    scorching: v.number(),
    damageInterval: v.number({ min: 0.5 }),
    /** °C que se pierden por metro de altitud sobre `referenceHeight`. */
    lapseRate: v.number({ min: 0 }),
    referenceHeight: v.number(),
    /** Calor de una hoguera o fuego cercano (°C) y su radio. */
    fireWarmth: v.number({ min: 0 }),
    fireRadius: v.number({ min: 0 }),
    /** Ajuste por tiempo atmosférico (°C). */
    weather: v.record(v.number()),
  }),
  weather: v.object({ minSeconds: v.number({ min: 5 }), maxSeconds: v.number({ min: 5 }), transitionSeconds: v.number({ min: 0.5 }) }),
});

// ---------------------------------------------------------------- armor.json
export const ARMOR_SLOTS = ['head', 'torso', 'legs', 'boots', 'cape', 'charm'] as const;
/** Efectos de equipo y comida (sumables). */
export const STAT_KEYS = [
  'defense', 'climbSpeed', 'climbStamina', 'climbJump', 'ledgeCost', 'ledgeFree', 'chainUnlimited', 'glideStamina', 'glideFall', 'glideWind', 'freeGlide',
  'coldResist', 'heatResist', 'stealth', 'bowDamage', 'glideBowCost', 'poisonResist', 'shockResist', 'insulated', 'swimSpeed', 'swimStamina', 'breath',
  'stunResist', 'darkVision', 'light', 'perfectWindow', 'iceGrip', 'sandSpeed', 'attack', 'speed',
] as const;

const armorPieceSchema = v.object({
  id: v.string({ minLength: 1 }),
  slot: v.oneOf(ARMOR_SLOTS),
  name: v.string({ minLength: 1 }),
  defense: v.number({ min: 0 }),
  effects: v.record(v.number()),
  model: v.object({ kind: v.string({ minLength: 1 }), color }),
});

export const armorConfigSchema = v.object({
  slots: v.array(v.oneOf(ARMOR_SLOTS), { length: 6 }),
  /** Niveles de mejora en las fuentes. */
  levels: v.number({ min: 1, max: 6, integer: true }),
  sets: v.array(
    v.object({
      id: v.string({ minLength: 1 }),
      name: v.string({ minLength: 1 }),
      description: v.string({ minLength: 1 }),
      rarity: v.oneOf(RARITIES),
      /** Materiales para mejorarlo (principal y secundario). */
      upgradeItems: v.array(v.string({ minLength: 1 }), { length: 2 }),
      pieces: v.array(armorPieceSchema, { minLength: 1 }),
      /** Bonificación por número de piezas puestas. */
      bonus: v.array(v.object({ pieces: v.number({ min: 2, max: 6, integer: true }), effects: v.record(v.number()) })),
    }),
    { minLength: 10 },
  ),
  accessories: v.array(armorPieceSchema),
});

// ---------------------------------------------------------------- recipes.json
export const recipesConfigSchema = v.object({
  cooking: v.object({
    healMultiplier: v.number({ min: 1 }),
    maxSeconds: v.number({ min: 1 }),
    secondsPerIngredient: v.number({ min: 0 }),
    monsterSeconds: v.number({ min: 0 }),
    potencyPerLevel: v.number({ min: 0.5 }),
    maxIngredients: v.number({ min: 1, max: 10, integer: true }),
    dubiousHeal: v.number({ min: 0 }),
  }),
  effects: v.record(v.object({ name: v.string({ minLength: 1 }), kind: v.oneOf(['instant', 'timed'] as const), per: v.number({ min: 0 }) })),
  recipes: v.array(v.object({ id: v.string({ minLength: 1 }), name: v.string({ minLength: 1 }), requires: v.array(v.string({ minLength: 1 })), allow: v.array(v.string({ minLength: 1 })) }), { minLength: 1 }),
});

// ---------------------------------------------------------------- progression.json
export const ALTAR_KINDS = ['offering', 'fountain', 'workshop', 'cooking'] as const;
const cost = v.array(v.object({ item: v.string({ minLength: 1 }), count: v.number({ min: 1, integer: true }) }));

export const progressionConfigSchema = v.object({
  offering: v.object({ orbsPerBlessing: v.number({ min: 1, integer: true }), staminaPerBlessing: v.number({ min: 1 }) }),
  /** Semillas por cada hueco extra de armas/arcos/escudos. */
  seedSlotCosts: v.array(v.number({ min: 1, integer: true }), { minLength: 1 }),
  altars: v.array(v.object({ id: v.string({ minLength: 1 }), kind: v.oneOf(ALTAR_KINDS), name: v.string({ minLength: 1 }), position: vec2 })),
  /** Semillas escondidas: [x, z, altura sobre el suelo]. */
  seeds: v.array(vec3),
  gliderUpgradeCosts: v.record(cost),
  gliderTints: v.array(v.object({ id: v.string({ minLength: 1 }), name: v.string({ minLength: 1 }), color, cost: v.number({ min: 0, integer: true }) }), { minLength: 1 }),
  startingArmor: v.array(v.string({ minLength: 1 })),
});

// ---------------------------------------------------------------- gathering.json
export const gatheringConfigSchema = v.object({
  cellSize: v.number({ min: 8 }),
  /** Celdas alrededor del jugador con plantas (radio en celdas). */
  radius: v.number({ min: 1, max: 6, integer: true }),
  regrowDays: v.number({ min: 0 }),
  rules: v.array(v.object({ item: v.string({ minLength: 1 }), biomes: v.array(v.oneOf(BIOME_IDS), { minLength: 1 }), perCell: v.number({ min: 0 }) })),
});

// ---------------------------------------------------------------- tutorial.json
export const TRIGGER_KINDS = ['interact', 'reach', 'read', 'climb', 'defeat', 'temple', 'glide_land'] as const;

const tutorialStepSchema = v.object({
  id: v.string({ minLength: 1 }),
  order: v.number({ min: 1, integer: true }),
  phase: v.number({ min: 0, max: 11, integer: true }),
  title: v.string({ minLength: 1 }),
  /** Texto con marcadores {accion} que se sustituyen por la tecla asignada. */
  hint: v.string({ minLength: 1 }),
  trigger: v.object({
    kind: v.oneOf(TRIGGER_KINDS),
    target: v.optional(v.string()),
    position: v.optional(vec2),
    radius: v.optional(v.number({ min: 0.1 })),
    minHeightAboveTerrain: v.optional(v.number()),
    count: v.optional(v.number({ min: 1, integer: true })),
  }),
});

export const tutorialConfigSchema = v.object({
  freeRoamHint: v.string({ minLength: 1 }),
  steps: v.array(tutorialStepSchema, { minLength: 1 }),
});

export type GameConfig = Infer<typeof gameConfigSchema>;
export type InputConfig = Infer<typeof inputConfigSchema>;
export type PlayerConfig = Infer<typeof playerConfigSchema>;
export type MovementConfig = PlayerConfig['movement'];
export type CameraConfig = PlayerConfig['camera'];
export type DayNightConfig = Infer<typeof dayNightConfigSchema>;
export type DayKeyframe = Infer<typeof dayKeyframe>;
export type TerrainConfig = Infer<typeof terrainConfigSchema>;
export type RiverConfig = Infer<typeof riverSchema>;
export type LakeConfig = Infer<typeof lakeSchema>;
export type ValleyConfig = Infer<typeof valleyConfigSchema>;
export type TutorialConfig = Infer<typeof tutorialConfigSchema>;
export type TutorialStep = Infer<typeof tutorialStepSchema>;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];
export type StaminaConfig = PlayerConfig['stamina'];
export type ClimbConfig = PlayerConfig['climb'];
export type LedgeBoostConfig = Infer<typeof ledgeBoostConfigSchema>;
export type GliderConfig = Infer<typeof gliderConfigSchema>;
export type GliderUpgrade = GliderConfig['upgrades'][number];
export type AirflowConfig = Infer<typeof airflowConfigSchema>;
export type MaterialsConfig = Infer<typeof materialsConfigSchema>;
export type MaterialDef = MaterialsConfig[string];
export type SettingsConfig = Infer<typeof settingsConfigSchema>;
export type TemplesConfig = Infer<typeof templesConfigSchema>;
export type TempleDef = TemplesConfig['temples'][number];
export type CombatConfig = PlayerConfig['combat'];
export type WeaponsConfig = Infer<typeof weaponsConfigSchema>;
export type WeaponDef = Infer<typeof weaponSchema>;
export type ShieldDef = Infer<typeof shieldSchema>;
export type ComboHit = Infer<typeof comboHitSchema>;
export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number];
export type WeaponSpecial = (typeof SPECIALS)[number];
export type EnemiesConfig = Infer<typeof enemiesConfigSchema>;
export type EnemyDef = Infer<typeof enemySchema>;
export type ItemsConfig = Infer<typeof itemsConfigSchema>;
export type LootTablesConfig = Infer<typeof lootTablesConfigSchema>;
export type AttackDef = Infer<typeof attackSchema>;
export type AttackKind = (typeof ATTACK_KINDS)[number];
export type Element = (typeof ELEMENTS)[number];
export type SensesDef = Infer<typeof sensesSchema>;
export type EncountersConfig = Infer<typeof encountersConfigSchema>;
export type CampDef = Infer<typeof campSchema>;
export type CampRole = (typeof CAMP_ROLES)[number];
export type BiomesConfig = Infer<typeof biomesConfigSchema>;
export type BiomeDef = BiomesConfig['biomes'][number];
export type BiomeId = (typeof BIOME_IDS)[number];
export type WeatherType = (typeof WEATHER_TYPES)[number];
export type ElementsConfig = Infer<typeof elementsConfigSchema>;
export type ArmorConfig = Infer<typeof armorConfigSchema>;
export type ArmorPiece = Infer<typeof armorPieceSchema>;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];
export type StatKey = (typeof STAT_KEYS)[number];
export type RecipesConfig = Infer<typeof recipesConfigSchema>;
export type FoodEffect = (typeof FOOD_EFFECTS)[number];
export type ProgressionConfig = Infer<typeof progressionConfigSchema>;
export type AltarKind = (typeof ALTAR_KINDS)[number];
export type GatheringConfig = Infer<typeof gatheringConfigSchema>;
export type ItemDef = ItemsConfig['items'][number];
