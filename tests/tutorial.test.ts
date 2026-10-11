import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { TutorialTracker } from '../src/systems/tutorial/TutorialTracker';

const data = loadGameData();

describe('TutorialTracker', () => {
  it('solo activa los pasos de fases ya implementadas', () => {
    const t = new TutorialTracker(data.tutorial, 1);
    expect(t.activeSteps.map((s) => s.id)).toEqual(['exit_capsule', 'move', 'jump', 'interact']);
    expect(new TutorialTracker(data.tutorial, 3).activeSteps).toHaveLength(8);
  });

  it('nada se completa antes de salir de la cápsula', () => {
    const t = new TutorialTracker(data.tutorial, 1);
    expect(t.report({ kind: 'position', x: -84, z: -58, heightAboveTerrain: 0 })).toHaveLength(0);
    expect(t.report({ kind: 'interact', target: 'capsule' }).map((s) => s.id)).toEqual(['exit_capsule']);
    expect(t.current()?.id).toBe('move');
  });

  it('"reach" respeta radio y altura mínima sobre el terreno', () => {
    const t = new TutorialTracker(data.tutorial, 1, ['exit_capsule', 'move']);
    expect(t.report({ kind: 'position', x: -65.4, z: -26.8, heightAboveTerrain: 0.5 })).toHaveLength(0);
    expect(t.report({ kind: 'position', x: -65.4, z: -26.8, heightAboveTerrain: 2.9 }).map((s) => s.id)).toEqual(['jump']);
  });

  it('"read" cuenta inscripciones distintas', () => {
    const t = new TutorialTracker(data.tutorial, 1, ['exit_capsule']);
    expect(t.report({ kind: 'read', id: 'a' })).toHaveLength(0);
    expect(t.report({ kind: 'read', id: 'a' })).toHaveLength(0);
    expect(t.report({ kind: 'read', id: 'b' }).map((s) => s.id)).toEqual(['interact']);
  });

  it('al completar todo queda la pista libre', () => {
    const t = new TutorialTracker(data.tutorial, 1, ['exit_capsule', 'move', 'jump', 'interact']);
    expect(t.current()).toBeNull();
    expect(t.freeRoamHint.length).toBeGreaterThan(0);
  });
});
