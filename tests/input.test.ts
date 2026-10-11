import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import type { GameEvents } from '../src/core/events';
import { InputManager, type BindingStorage } from '../src/core/input/InputManager';

function keyEvent(type: string, code: string, repeat = false): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code, repeat });
}

function memoryStorage(): BindingStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const config = { actions: { jump: ['Space'], move_left: ['KeyA', 'ArrowLeft'], move_right: ['KeyD'] } };

function setup(storage = memoryStorage()) {
  const target = new EventTarget();
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('input:action', ({ action, phase }) => events.push(`${action}:${phase}`));
  const input = new InputManager(target, config, bus, storage);
  return { target, bus, input, events, storage };
}

describe('InputManager', () => {
  it('traduce teclas a acciones con flancos', () => {
    const { target, input, events } = setup();
    target.dispatchEvent(keyEvent('keydown', 'Space'));
    expect(input.isDown('jump')).toBe(true);
    expect(input.wasPressed('jump')).toBe(true);
    input.endFrame();
    expect(input.wasPressed('jump')).toBe(false);
    target.dispatchEvent(keyEvent('keyup', 'Space'));
    expect(input.wasReleased('jump')).toBe(true);
    expect(events).toEqual(['jump:pressed', 'jump:released']);
  });

  it('ignora la autorrepetición y combina teclas de la misma acción', () => {
    const { target, input, events } = setup();
    target.dispatchEvent(keyEvent('keydown', 'KeyA'));
    target.dispatchEvent(keyEvent('keydown', 'KeyA', true));
    target.dispatchEvent(keyEvent('keydown', 'ArrowLeft'));
    target.dispatchEvent(keyEvent('keyup', 'KeyA'));
    expect(input.isDown('move_left')).toBe(true);
    expect(events).toEqual(['move_left:pressed']);
    expect(input.axis('move_left', 'move_right')).toBe(-1);
  });

  it('suelta todo al perder el foco', () => {
    const { target, input } = setup();
    target.dispatchEvent(keyEvent('keydown', 'KeyD'));
    target.dispatchEvent(new Event('blur'));
    expect(input.isDown('move_right')).toBe(false);
  });

  it('remapea, persiste y restaura bindings', () => {
    const storage = memoryStorage();
    const first = setup(storage);
    first.input.rebind('jump', ['KeyJ']);
    first.target.dispatchEvent(keyEvent('keydown', 'Space'));
    expect(first.input.isDown('jump')).toBe(false);

    const second = setup(storage);
    second.target.dispatchEvent(keyEvent('keydown', 'KeyJ'));
    expect(second.input.isDown('jump')).toBe(true);

    second.input.resetBindings();
    expect(second.input.getBindings().jump).toEqual(['Space']);
    expect(() => second.input.rebind('fly', ['KeyF'])).toThrow(/desconocida/);
  });

  it('mapea botones de ratón a MouseN', () => {
    const target = new EventTarget();
    const input = new InputManager(target, { actions: { attack: ['Mouse0'] } }, new EventBus<GameEvents>(), null);
    target.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0 }));
    expect(input.isDown('attack')).toBe(true);
  });
});

describe('InputManager: ratón', () => {
  const move = (dx: number, dy: number) => Object.assign(new Event('mousemove'), { movementX: dx, movementY: dy });

  it('acumula el movimiento solo con la mirada habilitada y descarta el primer evento y los picos', () => {
    const target = new EventTarget();
    let locked = false;
    const input = new InputManager(target, config, new EventBus<GameEvents>(), null, () => locked);
    target.dispatchEvent(move(10, 5));
    expect(input.consumeLook()).toEqual({ dx: 0, dy: 0 });
    locked = true;
    target.dispatchEvent(move(-400, 300)); // salto al bloquear el puntero
    target.dispatchEvent(move(12, -4));
    target.dispatchEvent(move(900, 0)); // pico anómalo
    target.dispatchEvent(move(3, 2));
    expect(input.consumeLook()).toEqual({ dx: 15, dy: -2 });
    expect(input.consumeLook()).toEqual({ dx: 0, dy: 0 });
  });

  it('cuenta pasos de rueda', () => {
    const target = new EventTarget();
    const input = new InputManager(target, config, new EventBus<GameEvents>(), null);
    target.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 120 }));
    target.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 53 }));
    expect(input.consumeWheel()).toBe(2);
  });
});
