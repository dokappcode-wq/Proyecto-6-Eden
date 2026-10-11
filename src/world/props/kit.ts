import * as THREE from 'three';
import { createRng } from '../../core/math';

/**
 * Materiales y geometrías compartidos por todo el mundo (una sola instancia de cada uno).
 * Firma visual: lo ancestral brilla en cian.
 */
export const ANCESTRAL_CYAN = new THREE.Color('#1fd6ff');

export const materials = {
  stone: new THREE.MeshStandardMaterial({ color: '#a99d88', roughness: 0.92 }),
  stoneDark: new THREE.MeshStandardMaterial({ color: '#6f675c', roughness: 0.95 }),
  ancestral: new THREE.MeshStandardMaterial({ color: '#4a5560', roughness: 0.6, metalness: 0.3 }),
  rune: new THREE.MeshStandardMaterial({ color: '#0b3a48', emissive: ANCESTRAL_CYAN, emissiveIntensity: 1.6, roughness: 0.4 }),
  glow: new THREE.MeshBasicMaterial({ color: ANCESTRAL_CYAN }),
  hull: new THREE.MeshStandardMaterial({ color: '#d5dbe0', roughness: 0.38, metalness: 0.55 }),
  hullDark: new THREE.MeshStandardMaterial({ color: '#3c434b', roughness: 0.55, metalness: 0.6 }),
  scorched: new THREE.MeshStandardMaterial({ color: '#2c2a28', roughness: 1 }),
  warning: new THREE.MeshStandardMaterial({ color: '#e0892e', emissive: '#e0892e', emissiveIntensity: 0.25, roughness: 0.6 }),
  glass: new THREE.MeshStandardMaterial({ color: '#86d8ff', roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55 }),
  bark: new THREE.MeshStandardMaterial({ color: '#6a4a32', roughness: 1 }),
  leaves: new THREE.MeshStandardMaterial({ color: '#4f8e3c', roughness: 0.85, flatShading: true }),
  pine: new THREE.MeshStandardMaterial({ color: '#2f6b40', roughness: 0.9, flatShading: true }),
  rock: new THREE.MeshStandardMaterial({ color: '#857c70', roughness: 0.95, flatShading: true }),
  rockDark: new THREE.MeshStandardMaterial({ color: '#5f574d', roughness: 1, flatShading: true }),
  moss: new THREE.MeshStandardMaterial({ color: '#7ba352', roughness: 1, flatShading: true }),
};

const geo = {
  trunk: new THREE.CylinderGeometry(0.22, 0.34, 3, 7).translate(0, 1.5, 0),
  broadleaf: squash(new THREE.IcosahedronGeometry(2.2, 1), 1, 0.8, 1).translate(0, 4.2, 0),
  pineLow: new THREE.ConeGeometry(1.9, 3.6, 8).translate(0, 3.6, 0),
  pineHigh: new THREE.ConeGeometry(1.3, 3, 8).translate(0, 5.6, 0),
  rocks: [0, 1, 2].map((i) => makeRockGeometry(1000 + i)),
};

export interface TreeInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  kind: 'pine' | 'broadleaf';
}

export interface RockInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
}

/** Árboles instanciados (≤ 4 draw calls por grupo, sea cual sea el número de árboles). */
export function buildTrees(trees: readonly TreeInstance[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';
  if (trees.length === 0) return group;
  const broad = trees.filter((t) => t.kind === 'broadleaf');
  const pines = trees.filter((t) => t.kind === 'pine');
  group.add(instanced(geo.trunk, materials.bark, trees));
  if (broad.length) group.add(instanced(geo.broadleaf, materials.leaves, broad));
  if (pines.length) {
    group.add(instanced(geo.pineLow, materials.pine, pines));
    group.add(instanced(geo.pineHigh, materials.pine, pines));
  }
  return group;
}

/** Rocas instanciadas con 3 variantes de forma. */
export function buildRocks(rocks: readonly RockInstance[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'rocks';
  geo.rocks.forEach((g, i) => {
    const subset = rocks.filter((_, j) => j % geo.rocks.length === i);
    if (subset.length) group.add(instanced(g, materials.rock, subset, true));
  });
  return group;
}

/** Libera solo lo propio del grupo (las geometrías/materiales compartidos se conservan). */
export function disposeInstancedGroup(group: THREE.Group): void {
  group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) o.dispose();
  });
}

export function makeRockGeometry(seed: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(1, detail);
  const rng = createRng(seed);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  // Desplaza vértices coincidentes por igual (por posición) para no abrir grietas.
  const offsets = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = offsets.get(key);
    if (k === undefined) {
      k = 0.75 + rng() * 0.45;
      offsets.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k * 1.15, pos.getY(i) * k * 0.75, pos.getZ(i) * k);
  }
  g.translate(0, 0.35, 0);
  g.computeVertexNormals();
  return g;
}

function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: readonly { x: number; y: number; z: number; scale: number; rotY: number }[],
  tilt = false,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  items.forEach((it, i) => {
    e.set(tilt ? Math.sin(it.rotY * 3.1) * 0.2 : 0, it.rotY, tilt ? Math.cos(it.rotY * 2.3) * 0.15 : 0);
    q.setFromEuler(e);
    s.setScalar(it.scale);
    p.set(it.x, it.y, it.z);
    mesh.setMatrixAt(i, m.compose(p, q, s));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function squash(g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  g.scale(x, y, z);
  return g;
}
