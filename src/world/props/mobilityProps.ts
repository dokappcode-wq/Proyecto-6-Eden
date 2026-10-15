import * as THREE from 'three';
import { createRng } from '../../core/math';
import { ANCESTRAL_CYAN, makeRockGeometry, materials } from './kit';

/**
 * Piezas ancestrales de movilidad: anclas del garfio, pads de salto, elevadores,
 * columnas, islas flotantes y cofres. Solo aspecto: los colisionadores los pone el sistema.
 */

const glow = new THREE.MeshBasicMaterial({ color: ANCESTRAL_CYAN });
const ringMat = new THREE.MeshStandardMaterial({ color: '#2a3a40', emissive: '#7ee3c0', emissiveIntensity: 1.2, roughness: 0.4, metalness: 0.5 });
const grass = new THREE.MeshStandardMaterial({ color: '#5f9a3c', roughness: 0.95, flatShading: true });
/** Roca de las islas: algo de emisión para que la cara inferior (siempre en sombra) no quede negra. */
const islandRock = new THREE.MeshStandardMaterial({ color: '#8a8174', emissive: '#3a342c', emissiveIntensity: 0.9, roughness: 0.95, flatShading: true });
const wood = new THREE.MeshStandardMaterial({ color: '#6b4b2e', roughness: 0.95 });
const gold = new THREE.MeshStandardMaterial({ color: '#d8b04a', roughness: 0.35, metalness: 0.8 });
export const iceMaterial = new THREE.MeshStandardMaterial({ color: '#bfeaff', emissive: '#4fb7e6', emissiveIntensity: 0.25, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.85 });

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Ancla del garfio. Con piedra (`perch`): losa flotante con anilla encima; sin ella: piedra con anilla colgando. */
export function buildAnchor(perch: boolean, seed: number): { object: THREE.Group; ring: THREE.Mesh } {
  const g = new THREE.Group();
  const ring = mesh(new THREE.TorusGeometry(0.45, 0.09, 8, 20), ringMat);
  if (perch) {
    const slab = mesh(new THREE.BoxGeometry(2.6, 0.8, 2.6), materials.ancestral, 0, -0.4, 0);
    g.add(slab);
    const under = mesh(makeRockGeometry(300 + seed), materials.rockDark, 0, -1.2, 0);
    under.scale.set(1.3, 1.1, 1.3);
    g.add(under);
    for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(2.62, 0.06, 0.1), glow, 0, -0.1, s * 1.28));
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 6), materials.hullDark, 0, 0.25, 0));
    ring.position.y = 0.95;
  } else {
    const rock = mesh(makeRockGeometry(400 + seed), materials.ancestral, 0, 1.2, 0);
    rock.scale.set(1.2, 0.8, 1.2);
    g.add(rock);
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), materials.hullDark, 0, 0.5, 0));
    ring.position.y = 0;
  }
  g.add(ring);
  return { object: g, ring };
}

/** Pad de salto: disco ancestral con runa que late. */
export function buildPad(radius: number): { object: THREE.Group; rune: THREE.Mesh } {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(radius + 0.35, radius + 0.55, 0.35, 20), materials.stoneDark, 0, 0.17, 0));
  const rune = mesh(new THREE.CircleGeometry(radius, 24).rotateX(-Math.PI / 2), materials.rune, 0, 0.36, 0);
  g.add(rune);
  const arrow = mesh(new THREE.ConeGeometry(radius * 0.4, 0.5, 4), glow, 0, 0.5, 0);
  arrow.castShadow = false;
  g.add(arrow);
  return { object: g, rune };
}

/** Elevador: plataforma con borde cian entre cuatro postes que suben hasta la parada superior. */
export function buildElevator(half: number, height: number): { frame: THREE.Group; platform: THREE.Group } {
  const frame = new THREE.Group();
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    frame.add(mesh(new THREE.BoxGeometry(0.4, height + 3, 0.4), materials.stone, sx * (half + 0.4), (height + 3) / 2, sz * (half + 0.4)));
    const line = mesh(new THREE.BoxGeometry(0.08, height + 3, 0.08), glow, sx * (half + 0.18), (height + 3) / 2, sz * (half + 0.18));
    line.castShadow = false;
    frame.add(line);
  }
  frame.add(mesh(new THREE.BoxGeometry(half * 2 + 1.2, 0.5, half * 2 + 1.2), materials.ancestral, 0, height + 3.25, 0));
  const platform = new THREE.Group();
  platform.add(mesh(new THREE.BoxGeometry(half * 2, 0.5, half * 2), materials.stoneDark, 0, -0.25, 0));
  const edge = mesh(new THREE.BoxGeometry(half * 2 + 0.05, 0.06, half * 2 + 0.05), glow, 0, -0.02, 0);
  edge.castShadow = false;
  platform.add(edge);
  platform.add(mesh(new THREE.CircleGeometry(half * 0.5, 16).rotateX(-Math.PI / 2), materials.rune, 0, 0.01, 0));
  return { frame, platform };
}

/** Columna ancestral alta (se sube con un pad de salto). */
export function buildPillar(height: number, radius: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(radius, radius * 1.15, height, 10), materials.stone, 0, height / 2, 0));
  for (const k of [0.3, 0.65, 0.98]) g.add(mesh(new THREE.TorusGeometry(radius * 1.02, 0.07, 6, 24).rotateX(Math.PI / 2), glow, 0, height * k, 0));
  return g;
}

/** Cofre ancestral con tapa articulada. */
export function buildChest(): { object: THREE.Group; lid: THREE.Group } {
  const object = new THREE.Group();
  object.add(mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), wood, 0, 0.3, 0));
  object.add(mesh(new THREE.BoxGeometry(1.14, 0.08, 0.74), gold, 0, 0.58, 0));
  const lid = new THREE.Group();
  lid.position.set(0, 0.6, -0.35);
  lid.add(mesh(new THREE.BoxGeometry(1.1, 0.25, 0.7), wood, 0, 0.12, 0.35));
  lid.add(mesh(new THREE.BoxGeometry(0.16, 0.18, 0.06), gold, 0, 0.05, 0.71));
  object.add(lid);
  return { object, lid };
}

/**
 * Isla flotante: cono de roca invertido con hierba arriba, ruinas y árboles.
 * El origen del grupo es el centro de la superficie superior.
 */
export function buildIsland(radius: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const rng = createRng(seed);
  const cone = mesh(new THREE.ConeGeometry(radius, radius * 1.8, 14, 3).rotateX(Math.PI), islandRock, 0, -radius * 0.9 - 1.2, 0);
  g.add(cone);
  g.add(mesh(new THREE.CylinderGeometry(radius, radius * 0.98, 1.4, 20), materials.rockDark, 0, -0.7, 0));
  g.add(mesh(new THREE.CylinderGeometry(radius - 0.4, radius - 0.2, 0.3, 20), grass, 0, -0.1, 0));
  // Rocas colgantes bajo el cono.
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const r = radius * (0.2 + rng() * 0.5);
    const rock = mesh(makeRockGeometry(600 + i), islandRock, Math.cos(a) * r, -radius * (0.6 + rng() * 0.7), Math.sin(a) * r);
    rock.scale.setScalar(1 + rng() * 2);
    g.add(rock);
  }
  // Ruinas: arco y columnas rotas con runas.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const h = 1.5 + rng() * 3;
    g.add(mesh(new THREE.CylinderGeometry(0.45, 0.55, h, 8), materials.stone, Math.cos(a) * radius * 0.7, h / 2, Math.sin(a) * radius * 0.7));
  }
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    const r = radius * (0.25 + rng() * 0.4);
    const tree = new THREE.Group();
    tree.add(mesh(new THREE.CylinderGeometry(0.2, 0.3, 2.6, 6), materials.bark, 0, 1.3, 0));
    tree.add(mesh(new THREE.IcosahedronGeometry(1.6, 0), materials.leaves, 0, 3.4, 0));
    tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.add(tree);
  }
  g.add(mesh(new THREE.TorusGeometry(radius * 0.98, 0.12, 6, 40).rotateX(Math.PI / 2), glow, 0, -0.9, 0));
  return g;
}

/** Bomba de viento lanzada: semilla verde pálida con dos aros que giran. */
export function buildWindBomb(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.IcosahedronGeometry(0.22, 1), new THREE.MeshStandardMaterial({ color: '#c8f7e4', emissive: '#7ee3c0', emissiveIntensity: 0.8 })));
  for (const r of [0, Math.PI / 2]) {
    const t = mesh(new THREE.TorusGeometry(0.34, 0.03, 6, 16), new THREE.MeshBasicMaterial({ color: '#e8fff7' }));
    t.rotation.x = r;
    g.add(t);
  }
  return g;
}
