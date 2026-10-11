import * as THREE from 'three';
import type { TerrainConfig, ValleyConfig } from '../../data/schemas';

/**
 * Superficies de agua: ríos (cinta a lo largo de la polilínea), lagos, mar y cascadas.
 * Todo es geometría procedural + texturas generadas en canvas (sin assets externos).
 */
export class WaterBodies {
  readonly group = new THREE.Group();
  private readonly flowing: THREE.Texture[] = [];
  private readonly still: THREE.Texture[] = [];
  private readonly falls: THREE.Texture[] = [];
  private readonly foam: THREE.Sprite[] = [];
  private readonly sea: THREE.Mesh;

  constructor(terrain: TerrainConfig, valley: ValleyConfig) {
    this.group.name = 'water';
    const normals = createWaterNormalMap(256);

    for (const river of terrain.rivers) {
      const tex = normals.clone();
      tex.needsUpdate = true;
      tex.repeat.set(1, 1);
      this.flowing.push(tex);
      const mesh = new THREE.Mesh(buildRibbon(river.points, river.width + river.bankWidth * 2, river.waterLevel), waterMaterial(tex, '#2f8fa8', 0.82));
      mesh.name = `river_${river.id}`;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    for (const lake of terrain.lakes) {
      const tex = normals.clone();
      tex.needsUpdate = true;
      tex.repeat.set(lake.radius / 12, lake.radius / 12);
      this.still.push(tex);
      const g = new THREE.CircleGeometry(lake.radius + 12, 48).rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(g, waterMaterial(tex, '#2a7f9c', 0.86));
      mesh.position.set(lake.center[0], lake.waterLevel, lake.center[1]);
      mesh.name = `lake_${lake.id}`;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    const seaTex = normals.clone();
    seaTex.needsUpdate = true;
    seaTex.repeat.set(400, 400);
    this.still.push(seaTex);
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000).rotateX(-Math.PI / 2), waterMaterial(seaTex, '#1f6488', 0.92));
    this.sea.position.y = terrain.seaLevel;
    this.sea.name = 'sea';
    this.group.add(this.sea);

    const fallTex = createWaterfallTexture();
    for (const wf of valley.waterfalls) this.addWaterfall(wf.top, wf.bottom, wf.width, fallTex);
  }

  /** Cascada como cinta inclinada entre `top` y `bottom`, con espuma en la base. */
  addWaterfall(top: readonly number[], bottom: readonly number[], width: number, sharedTex?: THREE.Texture): void {
    const tex = (sharedTex ?? createWaterfallTexture()).clone();
    tex.needsUpdate = true;
    const t = new THREE.Vector3(top[0], top[1], top[2]);
    const b = new THREE.Vector3(bottom[0], bottom[1], bottom[2]);
    const length = t.distanceTo(b);
    tex.repeat.set(width / 6, length / 14);
    this.falls.push(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide, color: '#dff6ff' });
    const g = new THREE.PlaneGeometry(width, length, 1, 8);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.copy(t).add(b).multiplyScalar(0.5);
    // Plano orientado: eje Y local a lo largo de la caída, normal mirando "hacia fuera" (horizontal).
    const down = b.clone().sub(t).normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(down).normalize();
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    const normal = side.clone().cross(down).normalize().negate();
    const m = new THREE.Matrix4().makeBasis(side, down.clone().negate(), normal);
    mesh.quaternion.setFromRotationMatrix(m);
    const outward = normal.clone();
    mesh.position.addScaledVector(outward, 0.6);
    mesh.renderOrder = 2;
    mesh.name = 'waterfall';
    this.group.add(mesh);

    const foamTex = createFoamTexture();
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: foamTex, transparent: true, opacity: 0.6, depthWrite: false, color: '#ffffff' }));
      s.position.copy(b).addScaledVector(side, (i - 2.5) * (width / 6)).addScaledVector(outward, 1.5);
      s.position.y = b.y + 0.6;
      s.scale.setScalar(4);
      s.userData.phase = i * 1.3;
      s.userData.baseY = s.position.y;
      this.foam.push(s);
      this.group.add(s);
    }
  }

  update(time: number, focusX: number, focusZ: number): void {
    for (const t of this.flowing) t.offset.y = -time * 0.35;
    for (const t of this.still) {
      t.offset.x = time * 0.012;
      t.offset.y = time * 0.008;
    }
    for (const t of this.falls) t.offset.y = time * 1.6;
    for (const s of this.foam) {
      const p = s.userData.phase as number;
      const k = 0.5 + 0.5 * Math.sin(time * 2.2 + p);
      s.scale.setScalar(3.4 + k * 1.8);
      s.material.opacity = 0.35 + k * 0.35;
      s.position.y = (s.userData.baseY as number) + k * 0.6;
    }
    // El mar sigue al jugador (malla finita, apariencia infinita).
    this.sea.position.x = Math.round(focusX / 64) * 64;
    this.sea.position.z = Math.round(focusZ / 64) * 64;
  }
}

function waterMaterial(normalMap: THREE.Texture, color: string, opacity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.12,
    metalness: 0.15,
    transparent: true,
    opacity,
    normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    depthWrite: false,
  });
}

/** Cinta a lo largo de una polilínea con uniones en inglete; UV.y = metros recorridos / 8. */
export function buildRibbon(points: readonly (readonly [number, number])[], width: number, y: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = new THREE.Vector2(points[i][0], points[i][1]);
    const b = new THREE.Vector2(points[i + 1][0], points[i + 1][1]);
    const segs = Math.max(1, Math.ceil(a.distanceTo(b) / 4));
    for (let s = 0; s < segs; s++) pts.push(a.clone().lerp(b, s / segs));
  }
  const last = points[points.length - 1];
  pts.push(new THREE.Vector2(last[0], last[1]));

  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dir = next.clone().sub(prev).normalize();
    const nrm = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(width / 2);
    if (i > 0) dist += pts[i].distanceTo(pts[i - 1]);
    pos.push(pts[i].x + nrm.x, y, pts[i].y + nrm.y, pts[i].x - nrm.x, y, pts[i].y - nrm.y);
    uv.push(0, dist / 8, width / 8, dist / 8);
    if (i < pts.length - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Asegura normales hacia arriba independientemente del sentido de la polilínea.
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  if (n.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

/** Mapa de normales enlosable a partir de una suma de senos con frecuencias enteras. */
function createWaterNormalMap(size: number): THREE.Texture {
  const waves = [
    [3, 1, 0.0, 1.0],
    [-2, 4, 1.7, 0.7],
    [5, -3, 0.4, 0.45],
    [-7, -5, 2.9, 0.3],
    [11, 6, 4.1, 0.18],
  ];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const [kx, ky, ph, a] of waves) {
        const arg = (2 * Math.PI * (kx * x + ky * y)) / size + ph;
        const c = Math.cos(arg) * a;
        dx += c * kx;
        dy += c * ky;
      }
      const s = 0.05;
      const nx = -dx * s;
      const ny = -dy * s;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (y * size + x) * 4;
      data[i] = (nx * inv * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      data[i + 2] = (inv * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function createWaterfallTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  const grad = ctx.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(160,220,240,0.55)');
  grad.addColorStop(0.5, 'rgba(210,245,255,0.8)');
  grad.addColorStop(1, 'rgba(160,220,240,0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 70; i++) {
    const x = (i * 37) % 64;
    const y = (i * 91) % 256;
    ctx.fillStyle = `rgba(255,255,255,${0.25 + ((i * 13) % 10) / 20})`;
    ctx.fillRect(x, y, 1 + (i % 3), 20 + ((i * 7) % 50));
    ctx.fillRect(x, y - 256, 1 + (i % 3), 20 + ((i * 7) % 50));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let foamTexture: THREE.Texture | null = null;
function createFoamTexture(): THREE.Texture {
  if (foamTexture) return foamTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  foamTexture = new THREE.CanvasTexture(c);
  foamTexture.colorSpace = THREE.SRGBColorSpace;
  return foamTexture;
}
