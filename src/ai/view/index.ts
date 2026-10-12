import type { EnemyDef } from '../../data/schemas';
import { brainKind } from '../brain';
import { GOBLIN_DEATH_SECONDS, GoblinView } from './GoblinView';
import { GOLEM_DEATH_SECONDS, GolemView } from './GolemView';
import { HAWK_DEATH_SECONDS, HawkView } from './HawkView';
import type { EnemyView } from './Overhead';
import { SLIME_DEATH_SECONDS, SlimeView } from './SlimeView';

export type { EnemyView } from './Overhead';

export function createEnemyView(def: EnemyDef): EnemyView {
  switch (brainKind(def)) {
    case 'goblin':
      return new GoblinView(def);
    case 'golem':
      return new GolemView(def);
    case 'hawk':
      return new HawkView(def);
    default:
      return new SlimeView(def);
  }
}

/** Duración de la animación de muerte antes de retirar el cuerpo. */
export function deathSeconds(def: EnemyDef): number {
  switch (brainKind(def)) {
    case 'goblin':
      return GOBLIN_DEATH_SECONDS;
    case 'golem':
      return GOLEM_DEATH_SECONDS;
    case 'hawk':
      return HAWK_DEATH_SECONDS;
    default:
      return SLIME_DEATH_SECONDS;
  }
}
