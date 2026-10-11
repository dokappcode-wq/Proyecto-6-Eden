import { describe, expect, it } from 'vitest';
import { DataValidationError, parse, v } from '../src/data/schema';
import { loadGameData } from '../src/data';

const schema = v.object({
  speed: v.number({ min: 0, max: 10 }),
  name: v.string({ minLength: 1 }),
  mode: v.oneOf(['a', 'b'] as const),
  tags: v.array(v.string()),
  extra: v.optional(v.boolean()),
});

describe('schema', () => {
  it('acepta datos válidos', () => {
    const value = parse(schema, { speed: 5, name: 'x', mode: 'a', tags: ['t'] }, 'test.json');
    expect(value.speed).toBe(5);
    expect(value.extra).toBeUndefined();
  });

  it('recoge todos los errores con su ruta', () => {
    try {
      parse(schema, { speed: 50, mode: 'z', tags: ['ok', 3], typo: 1 }, 'test.json');
      throw new Error('debería haber fallado');
    } catch (err) {
      expect(err).toBeInstanceOf(DataValidationError);
      const paths = (err as DataValidationError).issues.map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(['speed', 'name', 'mode', 'tags[1]', 'typo']));
      expect((err as Error).message).toContain('test.json');
      expect((err as Error).message).toContain('entre 0 y 10');
    }
  });

  it('los JSON del juego validan contra sus esquemas', () => {
    const data = loadGameData();
    expect(data.game.loop.fixedStepHz).toBeGreaterThan(0);
    expect(data.input.actions.debug_toggle).toContain('F3');
    expect(data.valley.inscriptions.length).toBeGreaterThan(0);
    expect(data.tutorial.steps).toHaveLength(8);
  });
});
