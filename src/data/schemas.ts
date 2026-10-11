import { v, type Infer } from './schema';

const color = v.string({ pattern: /^#[0-9a-fA-F]{6}$/, hint: 'color "#rrggbb"' });
const vec3 = v.array(v.number(), { length: 3 });

/** game.json: parámetros globales del bucle y del render. */
export const gameConfigSchema = v.object({
  title: v.string({ minLength: 1 }),
  loop: v.object({
    fixedStepHz: v.number({ min: 20, max: 240, integer: true }),
    maxSubSteps: v.number({ min: 1, max: 20, integer: true }),
    maxFrameSeconds: v.number({ min: 0.05, max: 1 }),
  }),
  render: v.object({
    clearColor: color,
    fogColor: color,
    fogNear: v.number({ min: 0 }),
    fogFar: v.number({ min: 1 }),
    maxPixelRatio: v.number({ min: 0.5, max: 3 }),
    shadows: v.boolean(),
  }),
  camera: v.object({
    fov: v.number({ min: 30, max: 120 }),
    near: v.number({ min: 0.01 }),
    far: v.number({ min: 10 }),
    position: vec3,
    lookAt: vec3,
  }),
  debug: v.object({
    startVisible: v.boolean(),
    refreshMs: v.number({ min: 16, max: 2000 }),
  }),
});

/**
 * input.json: acción -> lista de códigos.
 * Teclado: KeyboardEvent.code ("KeyW", "Space", "F3"...). Ratón: "Mouse0".."Mouse4".
 */
export const inputConfigSchema = v.object({
  actions: v.record(
    v.array(v.string({ pattern: /^(Mouse[0-4]|[A-Za-z0-9]+)$/, hint: 'código de tecla o MouseN' }), {
      minLength: 1,
    }),
  ),
});

const entityDefSchema = v.object({
  name: v.string({ minLength: 1 }),
  position: vec3,
  rotationY: v.optional(v.number()),
  renderable: v.optional(
    v.object({
      shape: v.oneOf(['box', 'sphere', 'cylinder'] as const),
      size: vec3,
      color,
      emissive: v.optional(color),
    }),
  ),
  spin: v.optional(v.object({ speed: v.number() })),
});

/** world.json: escena declarativa (en Fase 0, la escena de prueba). */
export const worldConfigSchema = v.object({
  ground: v.object({ size: v.number({ min: 1 }), color }),
  sun: v.object({ color, intensity: v.number({ min: 0 }), direction: vec3 }),
  ambient: v.object({ skyColor: color, groundColor: color, intensity: v.number({ min: 0 }) }),
  entities: v.array(entityDefSchema),
});

export type GameConfig = Infer<typeof gameConfigSchema>;
export type InputConfig = Infer<typeof inputConfigSchema>;
export type WorldConfig = Infer<typeof worldConfigSchema>;
export type EntityDef = Infer<typeof entityDefSchema>;
