import type { GameEventBus } from '../events';
import type { InputConfig } from '../../data/schemas';

const STORAGE_KEY = 'eden.input.bindings.v1';

/** Mínimo que necesitamos de un almacenamiento tipo localStorage (inyectable en tests). */
export interface BindingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface KeyLikeEvent extends Event {
  code?: string;
  repeat?: boolean;
  button?: number;
}

/**
 * Input por ACCIONES, no por teclas: el juego pregunta `isDown('jump')`.
 * Los bindings vienen de input.json y el jugador puede remapearlos (se persisten).
 *
 * Los flancos (pressed/released) se acumulan hasta que un paso fijo los consume
 * (`endFrame`), para no perder pulsaciones cuando el render va más rápido que la lógica.
 */
export class InputManager {
  private readonly defaults: Record<string, string[]>;
  private bindings: Record<string, string[]>;
  private codeToActions = new Map<string, string[]>();
  private readonly downCodes = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private readonly detach: () => void;

  constructor(
    target: EventTarget,
    config: InputConfig,
    private readonly bus: GameEventBus,
    private readonly storage: BindingStorage | null = safeLocalStorage(),
  ) {
    this.defaults = cloneBindings(config.actions);
    this.bindings = { ...cloneBindings(config.actions), ...this.loadOverrides() };
    this.rebuildIndex();

    const onDown = (e: Event) => this.handleDown(e as KeyLikeEvent);
    const onUp = (e: Event) => this.handleUp(e as KeyLikeEvent);
    const onBlur = () => this.releaseAll();
    const onContextMenu = (e: Event) => e.preventDefault();
    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    target.addEventListener('mousedown', onDown);
    target.addEventListener('mouseup', onUp);
    target.addEventListener('blur', onBlur);
    target.addEventListener('contextmenu', onContextMenu);
    this.detach = () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('mousedown', onDown);
      target.removeEventListener('mouseup', onUp);
      target.removeEventListener('blur', onBlur);
      target.removeEventListener('contextmenu', onContextMenu);
    };
  }

  isDown(action: string): boolean {
    const codes = this.bindings[action];
    return codes !== undefined && codes.some((c) => this.downCodes.has(c));
  }

  wasPressed(action: string): boolean {
    return this.pressed.has(action);
  }

  wasReleased(action: string): boolean {
    return this.released.has(action);
  }

  /** -1, 0 o 1 según dos acciones opuestas (p. ej. move_left / move_right). */
  axis(negative: string, positive: string): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
  }

  activeActions(): string[] {
    return Object.keys(this.bindings).filter((a) => this.isDown(a));
  }

  getBindings(): Readonly<Record<string, readonly string[]>> {
    return this.bindings;
  }

  /** Remapea una acción y persiste el cambio. */
  rebind(action: string, codes: string[]): void {
    if (!(action in this.defaults)) throw new Error(`Acción desconocida: "${action}"`);
    if (codes.length === 0) throw new Error(`La acción "${action}" necesita al menos un código`);
    this.bindings[action] = [...codes];
    this.rebuildIndex();
    this.saveOverrides();
    this.bus.emit('input:rebound', { action, codes: [...codes] });
  }

  resetBindings(): void {
    this.bindings = cloneBindings(this.defaults);
    this.rebuildIndex();
    this.storage?.removeItem(STORAGE_KEY);
  }

  /** Llamado por el bucle tras consumir la entrada en al menos un paso fijo. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
  }

  dispose(): void {
    this.detach();
  }

  private handleDown(e: KeyLikeEvent): void {
    const code = eventCode(e);
    if (code === null || e.repeat) return;
    const actions = this.codeToActions.get(code);
    // Evita scroll con Espacio/flechas, F3 del navegador, etc., solo en teclas usadas.
    if (actions) e.preventDefault();
    if (this.downCodes.has(code)) return;
    const wasDown = actions?.map((a) => this.isDown(a)) ?? [];
    this.downCodes.add(code);
    actions?.forEach((action, i) => {
      if (wasDown[i]) return; // otra tecla de la misma acción ya estaba pulsada
      this.pressed.add(action);
      this.bus.emit('input:action', { action, phase: 'pressed' });
    });
  }

  private handleUp(e: KeyLikeEvent): void {
    const code = eventCode(e);
    if (code === null || !this.downCodes.delete(code)) return;
    for (const action of this.codeToActions.get(code) ?? []) {
      if (this.isDown(action)) continue;
      this.released.add(action);
      this.bus.emit('input:action', { action, phase: 'released' });
    }
  }

  private releaseAll(): void {
    for (const code of [...this.downCodes]) this.handleUp({ code } as KeyLikeEvent);
  }

  private rebuildIndex(): void {
    this.codeToActions = new Map();
    for (const [action, codes] of Object.entries(this.bindings)) {
      for (const code of codes) {
        const list = this.codeToActions.get(code) ?? [];
        list.push(action);
        this.codeToActions.set(code, list);
      }
    }
  }

  private loadOverrides(): Record<string, string[]> {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const out: Record<string, string[]> = {};
      for (const [action, codes] of Object.entries(parsed)) {
        // Ignora acciones que ya no existen o entradas corruptas.
        if (action in this.defaults && Array.isArray(codes) && codes.length > 0 && codes.every((c) => typeof c === 'string')) {
          out[action] = codes as string[];
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  private saveOverrides(): void {
    const overrides: Record<string, string[]> = {};
    for (const [action, codes] of Object.entries(this.bindings)) {
      if (codes.join('|') !== this.defaults[action]?.join('|')) overrides[action] = codes;
    }
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch {
      // Almacenamiento bloqueado (modo privado): el remapeo vale para esta sesión.
    }
  }
}

function eventCode(e: KeyLikeEvent): string | null {
  if (e.type === 'mousedown' || e.type === 'mouseup') {
    return typeof e.button === 'number' ? `Mouse${e.button}` : null;
  }
  return typeof e.code === 'string' && e.code.length > 0 ? e.code : null;
}

function cloneBindings(src: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(src).map(([k, codes]) => [k, [...codes]]));
}

function safeLocalStorage(): BindingStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
