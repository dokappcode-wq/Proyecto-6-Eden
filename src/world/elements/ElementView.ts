import * as THREE from 'three';
import type { FireField } from './FireField';
import type { IcePlatform } from './IceField';

const MAX_ASH = 800;

/**
 * Aspecto del fuego y el hielo: llamas instanciadas que parpadean, ceniza en la hierba
 * quemada, una luz que sigue al incendio, losas de hielo flotando y rayos.
 */
export class ElementView {
  readonly group = new THREE.Group();
  private readonly flames: THREE.InstancedMesh;
  private readonly cores: THREE.InstancedMesh;
  private readonly ash: THREE.InstancedMesh;
  private readonly light = new THREE.PointLight('#ff8a3a', 0, 26, 1.6);
  private readonly ice = new Map<number, THREE.Mesh>();
  private readonly iceGeo = new THREE.CylinderGeometry(1, 0.85, 0.6, 7);
  private readonly iceMat = new THREE.MeshStandardMaterial({ color: '#bfefff', emissive: '#3aa8d8', emissiveIntensity: 0.25, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.88, flatShading: true });
  private readonly bolts: { line: THREE.Line; life: number }[] = [];
  private readonly boltMat = new THREE.LineBasicMaterial({ color: '#eef6ff', transparent: true });
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();

  constructor(maxCells: number) {
    this.group.name = 'elements';
    const flameGeo = new THREE.ConeGeometry(0.55, 1.7, 6, 1, true).translate(0, 0.85, 0);
    this.flames = new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({ color: '#ff5a14', transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), maxCells);
    this.cores = new THREE.InstancedMesh(new THREE.ConeGeometry(0.3, 1, 5).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#ffc23a', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }), maxCells);
    this.ash = new THREE.InstancedMesh(new THREE.CircleGeometry(1.1, 7).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }), MAX_ASH);
    for (const im of [this.flames, this.cores, this.ash]) {
      im.count = 0;
      im.frustumCulled = false;
      this.group.add(im);
    }
    this.group.add(this.light);
  }

  update(fire: FireField, time: number, dt: number): void {
    let n = 0;
    let a = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const c of fire.cells.values()) {
      if (c.state === 'burning') {
        if (n >= this.flames.instanceMatrix.count) continue;
        const life = c.t;
        const grow = Math.min(1, life * 2.5);
        const flick = 0.75 + Math.sin(time * 13 + c.ix * 1.7 + c.iz * 2.3) * 0.2 + Math.sin(time * 29 + c.iz) * 0.08;
        // Cada celda con su tamaño y desfase (fuego irregular, no una rejilla de conos).
        const size = 0.7 + ((c.ix * 7 + c.iz * 13) % 5) * 0.12;
        const h = grow * flick * size;
        const jx = ((c.ix * 31 + c.iz * 17) % 7) * 0.12 - 0.36;
        const jz = ((c.ix * 13 + c.iz * 29) % 7) * 0.12 - 0.36;
        this.q.setFromAxisAngle(this.v.set(0, 1, 0), time * 0.8 + c.ix);
        this.m.compose(this.v.set(c.x + jx, c.y - 0.05, c.z + jz), this.q, this.sc.set(size, h, size));
        this.flames.setMatrixAt(n, this.m);
        this.m.compose(this.v.set(c.x + jx, c.y - 0.05, c.z + jz), this.q, this.sc.set(size, h * 1.1, size));
        this.cores.setMatrixAt(n, this.m);
        n++;
        cx += c.x;
        cy += c.y;
        cz += c.z;
      } else if (a < MAX_ASH) {
        this.q.setFromAxisAngle(this.v.set(0, 1, 0), c.ix * 1.7 + c.iz);
        this.m.compose(this.v.set(c.x, c.y + 0.04, c.z), this.q, this.sc.set(1, 1, 1));
        this.ash.setMatrixAt(a++, this.m);
      }
    }
    this.flames.count = n;
    this.cores.count = n;
    this.ash.count = a;
    this.flames.instanceMatrix.needsUpdate = true;
    this.cores.instanceMatrix.needsUpdate = true;
    this.ash.instanceMatrix.needsUpdate = true;
    if (n > 0) {
      this.light.position.set(cx / n, cy / n + 2, cz / n);
      this.light.intensity = Math.min(60, 8 + n * 1.5) * (0.85 + Math.sin(time * 17) * 0.1);
    } else {
      this.light.intensity = 0;
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      (b.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, b.life / 0.25);
      if (b.life <= 0) {
        b.line.removeFromParent();
        b.line.geometry.dispose();
        (b.line.material as THREE.Material).dispose();
        this.bolts.splice(i, 1);
      }
    }
  }

  addIce(p: IcePlatform): void {
    const mesh = new THREE.Mesh(this.iceGeo, this.iceMat);
    mesh.scale.set(p.radius, 1, p.radius);
    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.y = p.id * 1.3;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.group.add(mesh);
    this.ice.set(p.id, mesh);
  }

  /** El hielo se encoge al derretirse. */
  updateIce(p: IcePlatform, meltSeconds: number): void {
    const mesh = this.ice.get(p.id);
    if (!mesh) return;
    const k = Math.min(1, p.life / Math.min(6, meltSeconds));
    mesh.scale.set(p.radius * (0.4 + 0.6 * k), 0.4 + 0.6 * k, p.radius * (0.4 + 0.6 * k));
  }

  removeIce(id: number): void {
    const mesh = this.ice.get(id);
    if (!mesh) return;
    mesh.removeFromParent();
    this.ice.delete(id);
  }

  /** Rayo quebrado del cielo al suelo. */
  bolt(x: number, y: number, z: number, rng: () => number): void {
    const pts: THREE.Vector3[] = [];
    let px = x + (rng() - 0.5) * 20;
    let pz = z + (rng() - 0.5) * 20;
    const top = y + 140;
    for (let i = 0; i <= 14; i++) {
      const k = i / 14;
      pts.push(new THREE.Vector3(px, top - (top - y) * k, pz));
      px += (x - px) * 0.35 + (rng() - 0.5) * 6 * (1 - k);
      pz += (z - pz) * 0.35 + (rng() - 0.5) * 6 * (1 - k);
    }
    pts[pts.length - 1].set(x, y, z);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.boltMat.clone());
    line.frustumCulled = false;
    this.group.add(line);
    this.bolts.push({ line, life: 0.25 });
  }
}
