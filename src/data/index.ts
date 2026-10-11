import dayNightJson from './definitions/daynight.json';
import gameJson from './definitions/game.json';
import inputJson from './definitions/input.json';
import playerJson from './definitions/player.json';
import terrainJson from './definitions/terrain.json';
import tutorialJson from './definitions/tutorial.json';
import valleyJson from './definitions/valley.json';
import { DataValidationError, parse, type Issue } from './schema';
import {
  dayNightConfigSchema,
  gameConfigSchema,
  inputConfigSchema,
  playerConfigSchema,
  terrainConfigSchema,
  tutorialConfigSchema,
  valleyConfigSchema,
  type DayNightConfig,
  type GameConfig,
  type InputConfig,
  type PlayerConfig,
  type TerrainConfig,
  type TutorialConfig,
  type ValleyConfig,
} from './schemas';

export interface GameData {
  game: GameConfig;
  input: InputConfig;
  player: PlayerConfig;
  dayNight: DayNightConfig;
  terrain: TerrainConfig;
  valley: ValleyConfig;
  tutorial: TutorialConfig;
}

/** Fuentes crudas (inyectables en tests para probar datos rotos). */
export interface RawGameData {
  game: unknown;
  input: unknown;
  player: unknown;
  dayNight: unknown;
  terrain: unknown;
  valley: unknown;
  tutorial: unknown;
}

export const BUNDLED_DATA: RawGameData = {
  game: gameJson,
  input: inputJson,
  player: playerJson,
  dayNight: dayNightJson,
  terrain: terrainJson,
  valley: valleyJson,
  tutorial: tutorialJson,
};

/**
 * Carga y valida todos los datos. Los JSON se empaquetan con Vite (sin fetch),
 * así que un error de datos aparece al arrancar, antes del primer frame.
 */
export function loadGameData(raw: RawGameData = BUNDLED_DATA): GameData {
  const data: GameData = {
    game: parse(gameConfigSchema, raw.game, 'game.json'),
    input: parse(inputConfigSchema, raw.input, 'input.json'),
    player: parse(playerConfigSchema, raw.player, 'player.json'),
    dayNight: parse(dayNightConfigSchema, raw.dayNight, 'daynight.json'),
    terrain: parse(terrainConfigSchema, raw.terrain, 'terrain.json'),
    valley: parse(valleyConfigSchema, raw.valley, 'valley.json'),
    tutorial: parse(tutorialConfigSchema, raw.tutorial, 'tutorial.json'),
  };
  checkConsistency(data);
  return data;
}

/** Reglas que cruzan campos o archivos y que un esquema por campo no puede expresar. */
function checkConsistency(d: GameData): void {
  const issues: Issue[] = [];
  const ascending = (arr: number[], path: string) => {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] <= arr[i - 1]) issues.push({ path, message: `debe ser estrictamente creciente: [${arr.join(', ')}]` });
    }
  };

  ascending(d.terrain.chunk.lodDistances, 'terrain.chunk.lodDistances');
  const vy = d.terrain.valley;
  ascending([vy.innerRadius, vy.wallRadius, vy.outerStart, vy.outerEnd], 'terrain.valley.(innerRadius < wallRadius < outerStart < outerEnd)');
  if (d.terrain.chunk.size % d.terrain.physicsGrid !== 0) {
    issues.push({ path: 'terrain.physicsGrid', message: 'debe dividir exactamente a chunk.size' });
  }
  const res0 = d.terrain.chunk.lodResolutions[0];
  if (Math.abs(d.terrain.chunk.size / res0 - d.terrain.physicsGrid) > 1e-6) {
    issues.push({ path: 'terrain.chunk.lodResolutions[0]', message: 'el LOD0 debe tener la resolución de physicsGrid (colisión = malla visible)' });
  }
  const m = d.player.movement;
  if (m.walkSpeed > m.jogSpeed) issues.push({ path: 'player.movement.walkSpeed', message: 'no puede superar jogSpeed' });
  const c = d.player.camera;
  if (!(c.minDistance <= c.distance && c.distance <= c.maxDistance)) {
    issues.push({ path: 'player.camera.distance', message: 'debe estar entre minDistance y maxDistance' });
  }
  ascending(d.dayNight.keyframes.map((k) => k.hour), 'daynight.keyframes[].hour');

  const ids = new Set<string>();
  d.tutorial.steps.forEach((s, i) => {
    if (ids.has(s.id)) issues.push({ path: `tutorial.steps[${i}].id`, message: `id duplicado "${s.id}"` });
    ids.add(s.id);
    if (s.trigger.kind === 'reach' && (!s.trigger.position || !s.trigger.radius)) {
      issues.push({ path: `tutorial.steps[${i}].trigger`, message: '"reach" necesita position y radius' });
    }
    for (const [, action] of s.hint.matchAll(/\{(\w+)\}/g)) {
      if (action !== 'move' && !(action in d.input.actions)) {
        issues.push({ path: `tutorial.steps[${i}].hint`, message: `marcador {${action}} no es una acción de input.json` });
      }
    }
  });
  ascending(d.tutorial.steps.map((s) => s.order), 'tutorial.steps[].order');

  if (issues.length > 0) throw new DataValidationError('coherencia entre datos', issues);
}
