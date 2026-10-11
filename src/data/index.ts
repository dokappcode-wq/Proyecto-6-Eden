import gameJson from './definitions/game.json';
import inputJson from './definitions/input.json';
import worldJson from './definitions/world.json';
import { parse } from './schema';
import {
  gameConfigSchema,
  inputConfigSchema,
  worldConfigSchema,
  type GameConfig,
  type InputConfig,
  type WorldConfig,
} from './schemas';

export interface GameData {
  game: GameConfig;
  input: InputConfig;
  world: WorldConfig;
}

/**
 * Carga y valida todos los datos. Los JSON se empaquetan con Vite (sin fetch),
 * así que un error de datos aparece al arrancar, antes del primer frame.
 */
export function loadGameData(): GameData {
  return {
    game: parse(gameConfigSchema, gameJson, 'game.json'),
    input: parse(inputConfigSchema, inputJson, 'input.json'),
    world: parse(worldConfigSchema, worldJson, 'world.json'),
  };
}
