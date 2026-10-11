import type { TriggerKind, TutorialConfig, TutorialStep } from '../../data/schemas';

/** Hecho del juego que puede completar un paso del tutorial. */
export type TutorialFact =
  | { kind: 'interact'; target: string }
  | { kind: 'read'; id: string }
  | { kind: 'position'; x: number; z: number; heightAboveTerrain: number }
  | { kind: 'climb' }
  | { kind: 'defeat'; target: string }
  | { kind: 'temple'; target: string }
  | { kind: 'glide_land'; target: string };

/**
 * Progreso del tutorial (lógica pura). Solo se activan los pasos cuya `phase`
 * ya está implementada (`contentPhase`); el resto se ignora hasta su fase.
 * Los pasos se pueden completar en cualquier orden, pero la pista muestra el
 * primero pendiente: el entorno guía, no obliga.
 */
export class TutorialTracker {
  private readonly completed = new Set<string>();
  private readonly counters = new Map<string, number>();
  private readonly readIds = new Set<string>();
  readonly activeSteps: TutorialStep[];

  constructor(
    private readonly cfg: TutorialConfig,
    contentPhase: number,
    completedIds: Iterable<string> = [],
  ) {
    this.activeSteps = [...cfg.steps].filter((s) => s.phase <= contentPhase).sort((a, b) => a.order - b.order);
    for (const id of completedIds) if (this.activeSteps.some((s) => s.id === id)) this.completed.add(id);
  }

  /** Procesa un hecho y devuelve los pasos que se acaban de completar. */
  report(fact: TutorialFact): TutorialStep[] {
    if (fact.kind === 'read') {
      if (this.readIds.has(fact.id)) return [];
      this.readIds.add(fact.id);
    }
    const done: TutorialStep[] = [];
    for (const step of this.activeSteps) {
      if (this.completed.has(step.id)) continue;
      if (!this.isBlockedByOrder(step) && this.matches(step, fact)) {
        this.completed.add(step.id);
        done.push(step);
      }
    }
    return done;
  }

  isCompleted(id: string): boolean {
    return this.completed.has(id);
  }

  completedIds(): string[] {
    return [...this.completed];
  }

  /** Paso pendiente actual (o null si se completaron todos los activos). */
  current(): TutorialStep | null {
    return this.activeSteps.find((s) => !this.completed.has(s.id)) ?? null;
  }

  get freeRoamHint(): string {
    return this.cfg.freeRoamHint;
  }

  progress(): { done: number; total: number } {
    return { done: this.completed.size, total: this.activeSteps.length };
  }

  /**
   * "Salir de la cápsula" debe ocurrir antes que nada: el resto de pasos se bloquean
   * hasta completar el primero activo.
   */
  private isBlockedByOrder(step: TutorialStep): boolean {
    const first = this.activeSteps[0];
    return first !== undefined && step !== first && !this.completed.has(first.id);
  }

  private matches(step: TutorialStep, fact: TutorialFact): boolean {
    const t = step.trigger;
    const kind: TriggerKind = t.kind;
    switch (kind) {
      case 'interact':
        return fact.kind === 'interact' && fact.target === t.target;
      case 'reach': {
        if (fact.kind !== 'position' || !t.position || !t.radius) return false;
        const inside = Math.hypot(fact.x - t.position[0], fact.z - t.position[1]) <= t.radius;
        return inside && fact.heightAboveTerrain >= (t.minHeightAboveTerrain ?? -Infinity);
      }
      case 'read':
        return fact.kind === 'read' && this.readIds.size >= (t.count ?? 1);
      case 'climb':
        return fact.kind === 'climb' && this.bump(step.id) >= (t.count ?? 1);
      case 'defeat':
        return fact.kind === 'defeat' && fact.target === t.target && this.bump(step.id) >= (t.count ?? 1);
      case 'temple':
        return fact.kind === 'temple' && fact.target === t.target;
      case 'glide_land':
        return fact.kind === 'glide_land' && fact.target === t.target;
    }
  }

  private bump(id: string): number {
    const n = (this.counters.get(id) ?? 0) + 1;
    this.counters.set(id, n);
    return n;
  }
}
