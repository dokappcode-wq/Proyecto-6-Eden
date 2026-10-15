/**
 * Validador de esquemas mínimo y sin dependencias.
 * Recoge TODOS los errores con su ruta ("input.actions.jump[0]") para que
 * un JSON mal escrito se diagnostique de un vistazo.
 */

export interface Issue {
  path: string;
  message: string;
}

export interface Schema<T> {
  readonly description: string;
  check(value: unknown, path: string, issues: Issue[]): T | undefined;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;
type OptKeys<S> = { [K in keyof S]: S[K] extends { readonly optional: true } ? K : never }[keyof S];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
/** Objeto validado: los campos `optional` son opcionales también en el tipo. */
export type ObjectOut<S> = Simplify<{ [K in Exclude<keyof S, OptKeys<S>>]: Infer<S[K]> } & { [K in OptKeys<S>]?: Infer<S[K]> }>;

export class DataValidationError extends Error {
  constructor(
    readonly source: string,
    readonly issues: Issue[],
  ) {
    super(
      `Datos inválidos en "${source}" (${issues.length} error${issues.length === 1 ? '' : 'es'}):\n` +
        issues.map((i) => `  • ${i.path}: ${i.message}`).join('\n'),
    );
    this.name = 'DataValidationError';
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') return 'objeto';
  return String(value);
}

export const v = {
  number(opts: { min?: number; max?: number; integer?: boolean } = {}): Schema<number> {
    const range =
      opts.min !== undefined && opts.max !== undefined
        ? ` entre ${opts.min} y ${opts.max}`
        : opts.min !== undefined
          ? ` >= ${opts.min}`
          : opts.max !== undefined
            ? ` <= ${opts.max}`
            : '';
    const description = `${opts.integer ? 'entero' : 'número'}${range}`;
    return {
      description,
      check(value, path, issues) {
        const ok =
          typeof value === 'number' &&
          Number.isFinite(value) &&
          (!opts.integer || Number.isInteger(value)) &&
          (opts.min === undefined || value >= opts.min) &&
          (opts.max === undefined || value <= opts.max);
        if (!ok) {
          issues.push({ path, message: `se esperaba ${description}, llegó ${describe(value)}` });
          return undefined;
        }
        return value as number;
      },
    };
  },

  string(opts: { minLength?: number; pattern?: RegExp; hint?: string } = {}): Schema<string> {
    const description = opts.hint ?? 'texto';
    return {
      description,
      check(value, path, issues) {
        if (
          typeof value !== 'string' ||
          value.length < (opts.minLength ?? 0) ||
          (opts.pattern !== undefined && !opts.pattern.test(value))
        ) {
          issues.push({ path, message: `se esperaba ${description}, llegó ${describe(value)}` });
          return undefined;
        }
        return value;
      },
    };
  },

  boolean(): Schema<boolean> {
    return {
      description: 'booleano',
      check(value, path, issues) {
        if (typeof value !== 'boolean') {
          issues.push({ path, message: `se esperaba booleano, llegó ${describe(value)}` });
          return undefined;
        }
        return value;
      },
    };
  },

  oneOf<const T extends string>(options: readonly T[]): Schema<T> {
    const description = `uno de [${options.join(', ')}]`;
    return {
      description,
      check(value, path, issues) {
        if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
          issues.push({ path, message: `se esperaba ${description}, llegó ${describe(value)}` });
          return undefined;
        }
        return value as T;
      },
    };
  },

  array<T>(item: Schema<T>, opts: { minLength?: number; length?: number } = {}): Schema<T[]> {
    const description = `lista de ${item.description}`;
    return {
      description,
      check(value, path, issues) {
        if (!Array.isArray(value)) {
          issues.push({ path, message: `se esperaba ${description}, llegó ${describe(value)}` });
          return undefined;
        }
        if (opts.length !== undefined && value.length !== opts.length) {
          issues.push({ path, message: `se esperaban exactamente ${opts.length} elementos, hay ${value.length}` });
        } else if (opts.minLength !== undefined && value.length < opts.minLength) {
          issues.push({ path, message: `se esperaban al menos ${opts.minLength} elementos, hay ${value.length}` });
        }
        const before = issues.length;
        const out = value.map((el, i) => item.check(el, `${path}[${i}]`, issues));
        return issues.length === before ? (out as T[]) : undefined;
      },
    };
  },

  record<T>(item: Schema<T>): Schema<Record<string, T>> {
    const description = `objeto de ${item.description}`;
    return {
      description,
      check(value, path, issues) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          issues.push({ path, message: `se esperaba ${description}, llegó ${describe(value)}` });
          return undefined;
        }
        const before = issues.length;
        const out: Record<string, T> = {};
        for (const [k, el] of Object.entries(value)) {
          out[k] = item.check(el, path ? `${path}.${k}` : k, issues) as T;
        }
        return issues.length === before ? out : undefined;
      },
    };
  },

  object<S extends Record<string, Schema<unknown>>>(
    shape: S,
  ): Schema<ObjectOut<S>> {
    return {
      description: 'objeto',
      check(value, path, issues) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          issues.push({ path, message: `se esperaba objeto, llegó ${describe(value)}` });
          return undefined;
        }
        const src = value as Record<string, unknown>;
        const before = issues.length;
        const out: Record<string, unknown> = {};
        for (const [k, schema] of Object.entries(shape)) {
          const childPath = path ? `${path}.${k}` : k;
          if (!(k in src) && !(schema as OptionalSchema<unknown>).optional) {
            issues.push({ path: childPath, message: `falta el campo obligatorio (${schema.description})` });
            continue;
          }
          const result = schema.check(src[k], childPath, issues);
          if (result !== undefined) out[k] = result;
        }
        for (const k of Object.keys(src)) {
          if (!(k in shape)) issues.push({ path: path ? `${path}.${k}` : k, message: 'campo desconocido (¿errata?)' });
        }
        return issues.length === before ? (out as ObjectOut<S>) : undefined;
      },
    };
  },

  nullable<T>(inner: Schema<T>): Schema<T | null> {
    return {
      description: `${inner.description} o null`,
      check(value, path, issues) {
        return value === null ? null : (inner.check(value, path, issues) as T | null);
      },
    };
  },

  optional<T>(inner: Schema<T>): OptionalSchema<T> {
    const schema: OptionalSchema<T> = {
      description: `${inner.description} (opcional)`,
      optional: true,
      check(value, path, issues) {
        return value === undefined ? undefined : inner.check(value, path, issues);
      },
    };
    return schema;
  },
};

interface OptionalSchema<T> extends Schema<T | undefined> {
  readonly optional: true;
}

/** Valida y devuelve el valor tipado, o lanza DataValidationError con todos los fallos. */
export function parse<T>(schema: Schema<T>, value: unknown, source: string): T {
  const issues: Issue[] = [];
  const result = schema.check(value, '', issues);
  if (issues.length > 0 || result === undefined) {
    throw new DataValidationError(source, issues.length ? issues : [{ path: '(raíz)', message: 'valor vacío' }]);
  }
  return result;
}
