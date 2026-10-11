import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus';

interface Events {
  ping: { n: number };
  other: string;
}

describe('EventBus', () => {
  it('entrega el payload a los suscriptores del evento correcto', () => {
    const bus = new EventBus<Events>();
    const ping = vi.fn();
    const other = vi.fn();
    bus.on('ping', ping);
    bus.on('other', other);
    bus.emit('ping', { n: 3 });
    expect(ping).toHaveBeenCalledWith({ n: 3 });
    expect(other).not.toHaveBeenCalled();
  });

  it('on() devuelve una función para desuscribirse', () => {
    const bus = new EventBus<Events>();
    const fn = vi.fn();
    const off = bus.on('ping', fn);
    off();
    bus.emit('ping', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('once() solo se dispara una vez', () => {
    const bus = new EventBus<Events>();
    const fn = vi.fn();
    bus.once('ping', fn);
    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('tolera desuscripciones durante la emisión', () => {
    const bus = new EventBus<Events>();
    const calls: string[] = [];
    const offB = bus.on('other', () => calls.push('b'));
    bus.on('other', () => {
      calls.push('a');
      offB();
    });
    bus.emit('other', 'x');
    bus.emit('other', 'y');
    expect(calls).toEqual(['b', 'a', 'a']);
  });
});
