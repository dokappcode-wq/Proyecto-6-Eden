import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { DayNightClock, formatHour } from '../src/world/sky/DayNight';

const cfg = loadGameData().dayNight;

describe('DayNightClock', () => {
  it('un día completo dura dayLengthSeconds', () => {
    const clock = new DayNightClock(cfg);
    const start = clock.hour;
    clock.advance(cfg.dayLengthSeconds);
    expect(clock.hour).toBeCloseTo(start, 6);
    expect(clock.day).toBe(1);
  });

  it('el sol está alto a mediodía y bajo el horizonte a medianoche', () => {
    const clock = new DayNightClock(cfg);
    clock.hour = 12;
    const noon = clock.sample();
    clock.hour = 0;
    const night = clock.sample();
    expect(noon.sunDir.y).toBeGreaterThan(0.7);
    expect(noon.isNight).toBe(false);
    expect(night.sunDir.y).toBeLessThan(-0.7);
    expect(night.isNight).toBe(true);
    expect(night.stars).toBeGreaterThan(noon.stars);
    expect(noon.lightIntensity).toBeGreaterThan(night.lightIntensity);
  });

  it('interpola con continuidad al pasar de 23:59 a 00:00', () => {
    const clock = new DayNightClock(cfg);
    clock.hour = 23.999;
    const a = clock.sample();
    clock.hour = 0;
    const b = clock.sample();
    expect(Math.abs(a.lightIntensity - b.lightIntensity)).toBeLessThan(0.01);
  });

  it('formatea la hora', () => {
    expect(formatHour(8.5)).toBe('08:30');
  });
});
