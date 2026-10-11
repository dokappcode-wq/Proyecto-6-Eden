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
      kind: v.oneOf(['block', 'pillar', 'arch', 'wall', 'slab'] as const),
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
