import airflowJson from './definitions/airflow.json';
import dayNightJson from './definitions/daynight.json';
import enemiesJson from './definitions/enemies.json';
import gameJson from './definitions/game.json';
import gliderJson from './definitions/glider.json';
import inputJson from './definitions/input.json';
import itemsJson from './definitions/items.json';
import ledgeBoostJson from './definitions/ledge_boost.json';
import lootTablesJson from './definitions/loot_tables.json';
import materialsJson from './definitions/materials.json';
import playerJson from './definitions/player.json';
import settingsJson from './definitions/settings.json';
import templesJson from './definitions/temples.json';
import terrainJson from './definitions/terrain.json';
import tutorialJson from './definitions/tutorial.json';
import valleyJson from './definitions/valley.json';
import weaponsJson from './definitions/weapons.json';
import { DataValidationError, parse, type Issue } from './schema';
import {
  airflowConfigSchema,
  dayNightConfigSchema,
  enemiesConfigSchema,
  itemsConfigSchema,
  lootTablesConfigSchema,
  weaponsConfigSchema,
  gliderConfigSchema,
  ledgeBoostConfigSchema,
  materialsConfigSchema,
  settingsConfigSchema,
  templesConfigSchema,
  gameConfigSchema,
  inputConfigSchema,
  playerConfigSchema,
  terrainConfigSchema,
  tutorialConfigSchema,
  valleyConfigSchema,
  type AirflowConfig,
  type DayNightConfig,
  type EnemiesConfig,
  type ItemsConfig,
  type LootTablesConfig,
  type WeaponsConfig,
  type GliderConfig,
  type LedgeBoostConfig,
  type MaterialsConfig,
  type SettingsConfig,
  type TemplesConfig,
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
  ledgeBoost: LedgeBoostConfig;
  glider: GliderConfig;
  airflow: AirflowConfig;
  materials: MaterialsConfig;
  settings: SettingsConfig;
  temples: TemplesConfig;
  weapons: WeaponsConfig;
  enemies: EnemiesConfig;
  items: ItemsConfig;
  loot: LootTablesConfig;
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
  ledgeBoost: unknown;
  glider: unknown;
  airflow: unknown;
  materials: unknown;
  settings: unknown;
  temples: unknown;
  weapons: unknown;
  enemies: unknown;
  items: unknown;
  loot: unknown;
}

export const BUNDLED_DATA: RawGameData = {
  game: gameJson,
  input: inputJson,
  player: playerJson,
  dayNight: dayNightJson,
  terrain: terrainJson,
  valley: valleyJson,
  tutorial: tutorialJson,
  ledgeBoost: ledgeBoostJson,
  glider: gliderJson,
  airflow: airflowJson,
  materials: materialsJson,
  settings: settingsJson,
  temples: templesJson,
  weapons: weaponsJson,
  enemies: enemiesJson,
  items: itemsJson,
  loot: lootTablesJson,
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
    ledgeBoost: parse(ledgeBoostConfigSchema, raw.ledgeBoost, 'ledge_boost.json'),
    glider: parse(gliderConfigSchema, raw.glider, 'glider.json'),
    airflow: parse(airflowConfigSchema, raw.airflow, 'airflow.json'),
    materials: parse(materialsConfigSchema, raw.materials, 'materials.json'),
    settings: parse(settingsConfigSchema, raw.settings, 'settings.json'),
    temples: parse(templesConfigSchema, raw.temples, 'temples.json'),
    weapons: parse(weaponsConfigSchema, raw.weapons, 'weapons.json'),
    enemies: parse(enemiesConfigSchema, raw.enemies, 'enemies.json'),
    items: parse(itemsConfigSchema, raw.items, 'items.json'),
    loot: parse(lootTablesConfigSchema, raw.loot, 'loot_tables.json'),
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

  // Materiales referenciados deben existir.
  const mat = (m: string, path: string) => {
    if (!(m in d.materials)) issues.push({ path, message: `material "${m}" no definido en materials.json` });
  };
  d.ledgeBoost.grabbableMaterials.forEach((m, i) => mat(m, `ledge_boost.grabbableMaterials[${i}]`));
  for (const req of ['rock', 'stone', 'ancestral', 'wood', 'metal', 'ice', 'sand', 'grass', 'valley_wall']) mat(req, `materials (requerido por el terreno/props)`);
  d.temples.temples.forEach((t, ti) => t.course.forEach((c, ci) => mat(c.material, `temples[${ti}].course[${ci}].material`)));
  if (!d.temples.temples.some((t) => t.id === d.valley.temple.id)) {
    issues.push({ path: 'valley.temple.id', message: `no existe en temples.json: "${d.valley.temple.id}"` });
  }
  const lb = d.ledgeBoost;
  if (lb.reachMin >= lb.reachMax) issues.push({ path: 'ledge_boost.reachMin', message: 'debe ser menor que reachMax' });
  if (lb.contactSeconds + lb.boostSeconds > 0.4 + 1e-9) issues.push({ path: 'ledge_boost', message: 'contacto + impulso no puede superar 0.4 s (requisito de diseño)' });

  // Armas, enemigos, objetos y botín: referencias cruzadas.
  const weaponIds = new Set(d.weapons.weapons.map((w) => w.id));
  const shieldIds = new Set(d.weapons.shields.map((w) => w.id));
  const itemIds = new Set(d.items.items.map((i) => i.id));
  const enemyIds = new Set(d.enemies.enemies.map((e) => e.id));
  if (!weaponIds.has('fists')) issues.push({ path: 'weapons.weapons', message: 'falta el arma "fists" (manos desnudas)' });
  d.weapons.weapons.forEach((w, i) => {
    if (w.category === 'bow' && !w.bow) issues.push({ path: `weapons.weapons[${i}].bow`, message: 'un arco necesita la sección "bow"' });
    if (w.category !== 'bow' && w.category !== 'fists' && w.combo.length !== 3) issues.push({ path: `weapons.weapons[${i}].combo`, message: 'el combo ligero debe tener 3 golpes' });
  });
  d.valley.pickups.forEach((p, i) => {
    if (!weaponIds.has(p.item) && !shieldIds.has(p.item) && !itemIds.has(p.item)) issues.push({ path: `valley.pickups[${i}].item`, message: `"${p.item}" no existe en weapons/items` });
  });
  d.valley.enemySpawns.forEach((sp, i) => {
    if (!enemyIds.has(sp.enemy)) issues.push({ path: `valley.enemySpawns[${i}].enemy`, message: `enemigo "${sp.enemy}" no definido` });
  });
  d.enemies.enemies.forEach((e, i) => {
    if (!(e.loot in d.loot.tables)) issues.push({ path: `enemies[${i}].loot`, message: `tabla de botín "${e.loot}" no definida` });
  });
  for (const [table, rows] of Object.entries(d.loot.tables)) {
    rows.forEach((r, i) => {
      if (!itemIds.has(r.item)) issues.push({ path: `loot_tables.${table}[${i}].item`, message: `objeto "${r.item}" no definido` });
      if (r.max < r.min) issues.push({ path: `loot_tables.${table}[${i}]`, message: 'max < min' });
    });
  }

  if (issues.length > 0) throw new DataValidationError('coherencia entre datos', issues);
}
