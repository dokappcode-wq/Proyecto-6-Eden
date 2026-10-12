import * as THREE from 'three';

interface Mark {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  /** Radio dinámico (ondas expansivas) o null para un área fija. */
  radius: (() => number) | null;
}

/**
 * Avisos de ataque en el suelo: un disco rojo que se llena durante la preparación
 * (golpe de área, descarga, lluvia de rocas) y anillos que avanzan con las ondas.
 */
export class Telegraphs {
  readonly group = new THREE.Group();
  private readonly marks: Mark[] = [];
  private readonly disc = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  private readonly ring = new THREE.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2);
  private readonly band = new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2);

  constructor() {
    this.group.name = 'telegraphs';
  }

  /** Área que se llena hasta el golpe (`seconds` = preparación). */
  area(x: number, y: number, z: number, radius: number, seconds: number, color = '#ff3a2a'): void {
    const fill = this.make(this.disc, color, 0.22);
    fill.position.set(x, y + 0.12, z);
    fill.scale.setScalar(0.01);
    const edge = this.make(this.ring, color, 0.7);
    edge.position.set(x, y + 0.13, z);
    edge.scale.setScalar(radius);
    this.marks.push({ mesh: fill, life: seconds, max: seconds, radius: () => radius }, { mesh: edge, life: seconds, max: seconds, radius: null });
  }

  /** Onda expansiva: anillo que sigue el radio real del ataque. */
  wave(x: number, y: number, z: number, seconds: number, radius: () => number, color = '#ffd27a'): void {
    const m = this.make(this.band, color, 0.85);
    m.position.set(x, y + 0.25, z);
    this.marks.push({ mesh: m, life: seconds, max: seconds, radius });
  }

  update(dt: number): void {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.life -= dt;
      const mat = m.mesh.material as THREE.MeshBasicMaterial;
      if (m.life <= 0) {
        m.mesh.removeFromParent();
        mat.dispose();
        this.marks.splice(i, 1);
        continue;
      }
      if (m.radius) {
        const geo = m.mesh.geometry;
        if (geo === this.disc) {
          // El disco crece hasta el borde: cuando lo toca, golpea.
          const k = 1 - m.life / m.max;
          m.mesh.scale.setScalar(Math.max(0.01, m.radius() * k));
          mat.opacity = 0.18 + 0.25 * k;
        } else {
          m.mesh.scale.setScalar(Math.max(0.01, m.radius()));
          mat.opacity = Math.min(0.85, m.life * 2);
        }
      } else {
        mat.opacity = 0.5 + 0.3 * Math.sin(m.life * 20);
      }
    }
  }

  clear(): void {
    for (const m of this.marks) {
      m.mesh.removeFromParent();
      (m.mesh.material as THREE.Material).dispose();
    }
    this.marks.length = 0;
  }

  private make(geo: THREE.BufferGeometry, color: string, opacity: number): THREE.Mesh {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.renderOrder = 3;
    this.group.add(m);
    return m;
  }
}
