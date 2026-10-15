import airflowJson from './definitions/airflow.json';
import dayNightJson from './definitions/daynight.json';
import armorJson from './definitions/armor.json';
import biomesJson from './definitions/biomes.json';
import gatheringJson from './definitions/gathering.json';
import progressionJson from './definitions/progression.json';
import recipesJson from './definitions/recipes.json';
import elementsJson from './definitions/elements.json';
import enemiesJson from './definitions/enemies.json';
import encountersJson from './definitions/encounters.json';
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
  biomesConfigSchema,
  armorConfigSchema,
  recipesConfigSchema,
  progressionConfigSchema,
  gatheringConfigSchema,
  STAT_KEYS,
  FOOD_EFFECTS,
  elementsConfigSchema,
  WEATHER_TYPES,
  BIOME_IDS,
  encountersConfigSchema,
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
  type BiomesConfig,
  type ArmorConfig,
  type RecipesConfig,
  type ProgressionConfig,
  type GatheringConfig,
  type ElementsConfig,
  type EncountersConfig,
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
  encounters: EncountersConfig;
  biomes: BiomesConfig;
  armor: ArmorConfig;
  recipes: RecipesConfig;
  progression: ProgressionConfig;
  gathering: GatheringConfig;
  elements: ElementsConfig;
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
  encounters: unknown;
  biomes: unknown;
  armor: unknown;
  recipes: unknown;
  progression: unknown;
  gathering: unknown;
  elements: unknown;
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
  encounters: encountersJson,
  biomes: biomesJson,
  armor: armorJson,
  recipes: recipesJson,
  progression: progressionJson,
  gathering: gatheringJson,
  elements: elementsJson,
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
    encounters: parse(encountersConfigSchema, raw.encounters, 'encounters.json'),
    biomes: parse(biomesConfigSchema, raw.biomes, 'biomes.json'),
    armor: parse(armorConfigSchema, raw.armor, 'armor.json'),
    recipes: parse(recipesConfigSchema, raw.recipes, 'recipes.json'),
    progression: parse(progressionConfigSchema, raw.progression, 'progression.json'),
    gathering: parse(gatheringConfigSchema, raw.gathering, 'gathering.json'),
    elements: parse(elementsConfigSchema, raw.elements, 'elements.json'),
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
  const armorIds = new Set([...d.armor.sets.flatMap((st) => st.pieces.map((p) => p.id)), ...d.armor.accessories.map((p) => p.id)]);
  const anyItem = (id: string) => weaponIds.has(id) || shieldIds.has(id) || itemIds.has(id) || armorIds.has(id);
  if (!weaponIds.has('fists')) issues.push({ path: 'weapons.weapons', message: 'falta el arma "fists" (manos desnudas)' });
  d.weapons.weapons.forEach((w, i) => {
    if (w.category === 'bow' && !w.bow) issues.push({ path: `weapons.weapons[${i}].bow`, message: 'un arco necesita la sección "bow"' });
    if (w.category !== 'bow' && w.category !== 'fists' && w.combo.length !== 3) issues.push({ path: `weapons.weapons[${i}].combo`, message: 'el combo ligero debe tener 3 golpes' });
  });
  d.valley.pickups.forEach((p, i) => {
    if (!anyItem(p.item)) issues.push({ path: `valley.pickups[${i}].item`, message: `"${p.item}" no existe en weapons/items` });
  });
  d.valley.enemySpawns.forEach((sp, i) => {
    if (!enemyIds.has(sp.enemy)) issues.push({ path: `valley.enemySpawns[${i}].enemy`, message: `enemigo "${sp.enemy}" no definido` });
  });
  d.enemies.enemies.forEach((e, i) => {
    if (!(e.loot in d.loot.tables)) issues.push({ path: `enemies[${i}].loot`, message: `tabla de botín "${e.loot}" no definida` });
    const fam = { slime: e.slime, goblin: e.goblin, golem: e.golem } as const;
    for (const [f, sec] of Object.entries(fam)) {
      if (e.family === f && !sec) issues.push({ path: `enemies[${i}].${f}`, message: `un enemigo de la familia ${f} necesita la sección "${f}"` });
    }
    if (e.variant === 'hawk' && !e.hawk) issues.push({ path: `enemies[${i}].hawk`, message: 'un halcón necesita la sección "hawk"' });
    if (e.goblin?.drop && !weaponIds.has(e.goblin.drop)) issues.push({ path: `enemies[${i}].goblin.drop`, message: `arma "${e.goblin.drop}" no definida` });
    if (e.slime?.splitInto && !enemyIds.has(e.slime.splitInto.enemy)) issues.push({ path: `enemies[${i}].slime.splitInto`, message: `enemigo "${e.slime.splitInto.enemy}" no definido` });
    e.attacks.forEach((a, j) => {
      const at = `enemies[${i}].attacks[${j}]`;
      if (a.maxRange < a.minRange) issues.push({ path: at, message: 'maxRange < minRange' });
      if (a.kind === 'projectile' && !a.projectile) issues.push({ path: at, message: 'un ataque "projectile" necesita la sección "projectile"' });
      if (a.kind === 'summon' && (!a.summon || !enemyIds.has(a.summon))) issues.push({ path: at, message: 'un ataque "summon" necesita un enemigo "summon" válido' });
      if ((a.kind === 'slam' || a.kind === 'discharge' || a.kind === 'dive' || a.kind === 'rockfall' || a.kind === 'shockwave') && a.radius <= 0) issues.push({ path: at, message: `"${a.kind}" necesita radius > 0` });
    });
  });
  const en = d.encounters;
  const enemyRef = (id: string, path: string) => {
    if (!enemyIds.has(id)) issues.push({ path, message: `enemigo "${id}" no definido` });
  };
  en.camps.forEach((c, i) => {
    c.members.forEach((m, j) => enemyRef(m.enemy, `encounters.camps[${i}].members[${j}].enemy`));
    c.reinforcements?.members.forEach((m, j) => enemyRef(m, `encounters.camps[${i}].reinforcements.members[${j}]`));
    if (!(c.chest.loot in d.loot.tables)) issues.push({ path: `encounters.camps[${i}].chest.loot`, message: `tabla "${c.chest.loot}" no definida` });
    if (c.members.some((m) => m.role === 'lookout') && !c.lookout) issues.push({ path: `encounters.camps[${i}].lookout`, message: 'hay un vigía pero no torre de vigía' });
    if (c.members.some((m) => m.role === 'patrol') && c.patrol.length < 2) issues.push({ path: `encounters.camps[${i}].patrol`, message: 'una patrulla necesita al menos 2 puntos' });
  });
  en.groups.forEach((g, i) => enemyRef(g.enemy, `encounters.groups[${i}].enemy`));
  en.pickups.forEach((p, i) => {
    if (!anyItem(p.item)) issues.push({ path: `encounters.pickups[${i}].item`, message: `"${p.item}" no existe en weapons/items` });
  });
  // Biomas: los 8, con pesos de tiempo conocidos.
  const biomeSeen = new Set(d.biomes.biomes.map((b) => b.id));
  for (const id of BIOME_IDS) if (!biomeSeen.has(id)) issues.push({ path: 'biomes', message: `falta el bioma "${id}"` });
  d.biomes.biomes.forEach((b, i) => {
    for (const w of Object.keys(b.weather)) if (!(WEATHER_TYPES as readonly string[]).includes(w)) issues.push({ path: `biomes[${i}].weather.${w}`, message: 'tiempo desconocido' });
    if (Object.values(b.weather).reduce((a, x) => a + x, 0) <= 0) issues.push({ path: `biomes[${i}].weather`, message: 'al menos un tiempo con peso > 0' });
  });
  for (const w of Object.keys(d.elements.temperature.weather)) if (!(WEATHER_TYPES as readonly string[]).includes(w)) issues.push({ path: `elements.temperature.weather.${w}`, message: 'tiempo desconocido' });
  if (d.elements.weather.maxSeconds < d.elements.weather.minSeconds) issues.push({ path: 'elements.weather', message: 'maxSeconds < minSeconds' });
  // Armaduras, recetas, progresión y recolección.
  const statKeys = new Set<string>(STAT_KEYS);
  const seenArmor = new Set<string>();
  const checkPiece = (p: { id: string; effects: Record<string, number> }, path: string) => {
    if (seenArmor.has(p.id)) issues.push({ path, message: `pieza duplicada "${p.id}"` });
    seenArmor.add(p.id);
    for (const k of Object.keys(p.effects)) if (!statKeys.has(k)) issues.push({ path: `${path}.effects.${k}`, message: 'efecto desconocido' });
  };
  d.armor.sets.forEach((st, i) => {
    st.pieces.forEach((p, j) => checkPiece(p, `armor.sets[${i}].pieces[${j}]`));
    st.bonus.forEach((b, j) => {
      for (const k of Object.keys(b.effects)) if (!statKeys.has(k)) issues.push({ path: `armor.sets[${i}].bonus[${j}].${k}`, message: 'efecto desconocido' });
      if (b.pieces > st.pieces.length) issues.push({ path: `armor.sets[${i}].bonus[${j}]`, message: 'más piezas que el set' });
    });
    st.upgradeItems.forEach((it, j) => {
      if (!itemIds.has(it)) issues.push({ path: `armor.sets[${i}].upgradeItems[${j}]`, message: `objeto "${it}" no definido` });
    });
  });
  d.armor.accessories.forEach((p, j) => {
    checkPiece(p, `armor.accessories[${j}]`);
    if (p.slot !== 'cape' && p.slot !== 'charm') issues.push({ path: `armor.accessories[${j}].slot`, message: 'los accesorios van en capa o tótem' });
  });
  for (const k of Object.keys(d.recipes.effects)) if (!(FOOD_EFFECTS as readonly string[]).includes(k)) issues.push({ path: `recipes.effects.${k}`, message: 'efecto desconocido' });
  for (const k of FOOD_EFFECTS) if (!(k in d.recipes.effects)) issues.push({ path: 'recipes.effects', message: `falta el efecto "${k}"` });
  d.progression.startingArmor.forEach((id, i) => {
    if (!armorIds.has(id)) issues.push({ path: `progression.startingArmor[${i}]`, message: `pieza "${id}" no definida` });
  });
  const gliderIds = new Set(d.glider.upgrades.map((u) => u.id));
  for (const [id, costs] of Object.entries(d.progression.gliderUpgradeCosts)) {
    if (!gliderIds.has(id)) issues.push({ path: `progression.gliderUpgradeCosts.${id}`, message: 'mejora del planeador inexistente' });
    costs.forEach((c, i) => {
      if (!itemIds.has(c.item)) issues.push({ path: `progression.gliderUpgradeCosts.${id}[${i}]`, message: `objeto "${c.item}" no definido` });
    });
  }
  d.gathering.rules.forEach((r, i) => {
    if (!d.items.items.find((it) => it.id === r.item)?.food) issues.push({ path: `gathering.rules[${i}].item`, message: `"${r.item}" no es un ingrediente` });
  });
  d.weapons.weapons.forEach((w, i) => {
    if (w.category === 'staff' && !w.staff) issues.push({ path: `weapons.weapons[${i}].staff`, message: 'un bastón necesita la sección "staff"' });
  });
  en.bosses.forEach((b, i) => {
    enemyRef(b.enemy, `encounters.bosses[${i}].enemy`);
    if (!d.enemies.enemies.find((e) => e.id === b.enemy)?.boss) issues.push({ path: `encounters.bosses[${i}].enemy`, message: 'el enemigo no tiene sección "boss"' });
    if (!(b.reward in d.loot.tables)) issues.push({ path: `encounters.bosses[${i}].reward`, message: `tabla "${b.reward}" no definida` });
  });
  en.roosts.forEach((r, i) => {
    enemyRef(r.enemy, `encounters.roosts[${i}].enemy`);
    if (!d.enemies.enemies.find((e) => e.id === r.enemy)?.hawk) issues.push({ path: `encounters.roosts[${i}].enemy`, message: 'solo aves (sección "hawk") pueden anidar' });
  });
  for (const [table, rows] of Object.entries(d.loot.tables)) {
    rows.forEach((r, i) => {
      if (!anyItem(r.item)) issues.push({ path: `loot_tables.${table}[${i}].item`, message: `objeto "${r.item}" no definido` });
      if (r.max < r.min) issues.push({ path: `loot_tables.${table}[${i}]`, message: 'max < min' });
    });
  }

  if (issues.length > 0) throw new DataValidationError('coherencia entre datos', issues);
}
