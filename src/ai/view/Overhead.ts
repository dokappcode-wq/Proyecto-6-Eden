import * as THREE from 'three';
import type { EnemyDef } from '../../data/schemas';
import type { Brain } from '../brain';

const glyphCache = new Map<string, THREE.SpriteMaterial>();

/**
 * Icono sobre la cabeza: "?" que se llena con la alerta, "!" al detectar,
 * "?" naranja buscando y "Zz" durmiendo. Texturas cacheadas por estado.
 */
function glyph(key: string): THREE.SpriteMaterial {
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D no disponible');
  g.font = 'bold 50px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const draw = (text: string, color: string, fill = 1) => {
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(10,14,20,0.9)';
    g.strokeText(text, 32, 34);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillText(text, 32, 34);
    // Relleno de abajo arriba según la alerta acumulada.
    g.save();
    g.beginPath();
    g.rect(0, 64 - 8 - 48 * fill, 64, 64);
    g.clip();
    g.fillStyle = color;
    g.fillText(text, 32, 34);
    g.restore();
  };
  if (key === '!') draw('!', '#ff4b3a');
  else if (key === 'zz') {
    g.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    draw('Zz', '#bfe3ff');
  } else if (key === 'search') draw('?', '#ff9a3a');
  else draw('?', '#ffd23a', Number(key.slice(1)) / 10);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
  glyphCache.set(key, mat);
  return mat;
}

/** Icono de estado + barra de vida (solo si ha recibido daño), siempre de cara a la cámara. */
export class Overhead {
  readonly group = new THREE.Group();
  private readonly icon: THREE.Sprite;
  private readonly bar: THREE.Sprite;
  private readonly barCanvas = document.createElement('canvas');
  private readonly barTex: THREE.CanvasTexture;
  private lastFill = -1;
  private t = 0;

  constructor(
    private readonly height: number,
    barWidth: number,
    private readonly showBar: boolean,
  ) {
    this.icon = new THREE.Sprite(glyph('!'));
    this.icon.renderOrder = 11;
    this.icon.visible = false;
    this.group.add(this.icon);
    this.barCanvas.width = 64;
    this.barCanvas.height = 8;
    this.barTex = new THREE.CanvasTexture(this.barCanvas);
    this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, depthTest: false, transparent: true }));
    this.bar.scale.set(barWidth, barWidth / 8, 1);
    this.bar.position.y = height + 0.35;
    this.bar.renderOrder = 10;
    this.bar.visible = false;
    this.group.add(this.bar);
  }

  update(b: Brain, def: EnemyDef, dt: number): void {
    this.t += dt;
    let key: string | null = null;
    if (b.state === 'dead') key = null;
    else if (b.state === 'sleep' && b.activity !== 'dormant') key = 'zz';
    else if (b.state === 'suspicious' && b.wakeT < 0) key = `?${Math.max(1, Math.round(b.awareness * 10))}`;
    else if (b.state === 'search') key = 'search';
    else if (b.state === 'combat' && b.stateT < 1.6) key = '!';
    this.icon.visible = key !== null;
    if (key) {
      this.icon.material = glyph(key);
      const pop = key === '!' ? 1 + Math.max(0, 0.6 - b.stateT * 2) : 1;
      const s = 0.8 * pop;
      this.icon.scale.set(s, s, 1);
      this.icon.position.y = this.height + 0.85 + (key === 'zz' ? Math.sin(this.t * 1.5) * 0.12 : 0);
    }
    const show = this.showBar && b.state !== 'dead' && b.hp < b.maxHp && b.sinceDamage < 8;
    this.bar.visible = show;
    if (show) {
      const fill = Math.round((b.hp / b.maxHp) * 60);
      if (fill !== this.lastFill) {
        this.lastFill = fill;
        const g = this.barCanvas.getContext('2d');
        if (g) {
          g.clearRect(0, 0, 64, 8);
          g.fillStyle = 'rgba(20,8,8,0.8)';
          g.fillRect(0, 0, 64, 8);
          g.fillStyle = def.boss ? '#ffb43a' : '#ff5b6e';
          g.fillRect(2, 2, fill, 4);
          this.barTex.needsUpdate = true;
        }
      }
    }
  }

  dispose(): void {
    this.barTex.dispose();
    (this.bar.material as THREE.SpriteMaterial).dispose();
  }
}

/** Contrato común de los visuales de enemigos. */
export interface EnemyView {
  readonly root: THREE.Group;
  update(b: Brain, def: EnemyDef, deadT: number, dt: number): void;
  dispose(): void;
}

/** Libera geometrías propias (los materiales compartidos los gestiona cada vista). */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}
