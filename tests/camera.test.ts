import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { CameraController } from '../src/player/CameraController';

const cfg = loadGameData().player.camera;
const flat = { terrainHeight: () => 0, raycastColliders: () => Infinity };
const frame = (over = {}) => ({ lookDX: 0, lookDY: 0, zoom: 0, target: { x: 0, y: 0, z: 0 }, speed: 0, moveYaw: 0, moving: false, ...over });

describe('CameraController', () => {
  it('se sitúa a la distancia configurada detrás del objetivo', () => {
    const c = new CameraController(cfg);
    c.update(frame(), flat, 1 / 60);
    const d = Math.hypot(c.position.x - c.lookAt.x, c.position.y - c.lookAt.y, c.position.z - c.lookAt.z);
    expect(d).toBeCloseTo(cfg.distance, 3);
    expect(c.position.z).toBeGreaterThan(0); // yaw 0: cámara al sur, mirando al norte
    expect(c.forward().z).toBeCloseTo(-1);
  });

  it('se acerca al instante si hay un obstáculo', () => {
    const c = new CameraController(cfg);
    c.update(frame(), flat, 1 / 60);
    c.update(frame(), { terrainHeight: () => 0, raycastColliders: () => 2 }, 1 / 60);
    expect(c.currentDistance).toBeLessThanOrEqual(2 - cfg.collisionPadding + 1e-6);
  });

  it('el ratón gira la cámara y el pitch está limitado', () => {
    const c = new CameraController(cfg);
    c.update(frame({ lookDX: 100 }), flat, 1 / 60);
    expect(c.yaw).toBeLessThan(0);
    c.update(frame({ lookDY: 100000 }), flat, 1 / 60);
    expect(c.pitch).toBeCloseTo((cfg.maxPitchDeg * Math.PI) / 180);
  });

  it('nunca queda bajo el terreno', () => {
    const c = new CameraController(cfg);
    c.update(frame({ lookDY: -100000 }), { terrainHeight: () => 1.2, raycastColliders: () => Infinity }, 1 / 60);
    expect(c.position.y).toBeGreaterThanOrEqual(1.2 + 0.35 - 1e-6);
  });
});
