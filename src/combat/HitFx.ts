import * as THREE from 'three';

interface Particle {
  s: THREE.Sprite;
  life: number;
  max: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  gravity: number;
}

/**
 * Partículas de combate en pool fijo: chispas, salpicaduras de gel, astillas y anillos de onda.
 * El color depende del material golpeado; el tiempo sigue la escala del mundo (se congelan en la parada de impacto).
 */
export class HitFx {
  readonly group = new THREE.Group();
  private readonly parts: Particle[] = [];
  private readonly rings: { m: THREE.Mesh; life: number; max: number; radius: number }[] = [];
  private next = 0;
  private nextRing = 0;

  constructor(size = 120) {
    this.group.name = 'hit-fx';
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < size; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.visible = false;
      this.group.add(s);
      this.parts.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 0.2, gravity: 0 });
    }
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      );
      m.visible = false;
      this.group.add(m);
      this.rings.push({ m, life: 0, max: 1, radius: 1 });
    }
  }

  /** Estallido de partículas. `kind` decide color y comportamiento. */
  burst(x: number, y: number, z: number, kind: 'gel' | 'spark' | 'wood' | 'stone' | 'parry' | 'break' | 'flurry', count = 12): void {
    const colors: Record<string, string> = {
      gel: '#8cf06f',
      spark: '#ffe2a0',
      wood: '#c79a62',
      stone: '#d6cfc2',
      parry: '#9ff3ff',
      break: '#ffffff',
      flurry: '#7fd8ff',
    };
    const col = new THREE.Color(colors[kind]);
    const speed = kind === 'break' ? 7 : kind === 'parry' ? 6 : 4;
    for (let i = 0; i < count; i++) {
      const p = this.parts[this.next];
      this.next = (this.next + 1) % this.parts.length;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.8 + 0.2;
      const v = speed * (0.5 + Math.random() * 0.7);
      p.vx = Math.cos(a) * v * (1 - up * 0.5);
      p.vz = Math.sin(a) * v * (1 - up * 0.5);
      p.vy = up * v;
      p.gravity = kind === 'gel' || kind === 'wood' || kind === 'stone' ? 14 : 4;
      p.max = 0.3 + Math.random() * (kind === 'break' ? 0.5 : 0.3);
      p.life = p.max;
      p.size = kind === 'gel' ? 0.22 : 0.14;
      p.s.position.set(x, y, z);
      p.s.material.color.copy(col);
      p.s.visible = true;
    }
  }

  /** Anillo de onda expansiva (ataque en picado, martillo, parry). */
  ring(x: number, y: number, z: number, radius: number, color = '#ffffff'): void {
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    r.m.position.set(x, y + 0.1, z);
    (r.m.material as THREE.MeshBasicMaterial).color.set(color);
    r.max = 0.45;
    r.life = r.max;
    r.radius = radius;
    r.m.visible = true;
  }

  update(dt: number): void {
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      const k = p.life / p.max;
      p.s.scale.setScalar(p.size * (0.5 + k));
      p.s.material.opacity = k;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const k = 1 - Math.max(0, r.life) / r.max;
      r.m.scale.setScalar(0.3 + k * r.radius);
      (r.m.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
      if (r.life <= 0) r.m.visible = false;
    }
  }
}
