import * as THREE from 'three';
import type { AltarKind } from '../../data/schemas';
import { ANCESTRAL_CYAN, materials } from './kit';
import type { LocalCollider, PropResult } from './structures';

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

const water = new THREE.MeshStandardMaterial({ color: '#5fd0e8', emissive: '#1f8fbf', emissiveIntensity: 0.4, transparent: true, opacity: 0.8, roughness: 0.05 });
const wood = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.9 });
const iron = new THREE.MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.6, metalness: 0.6 });
const glow = new THREE.MeshBasicMaterial({ color: ANCESTRAL_CYAN });

/**
 * Lugares de progresión: estatua de la ofrenda (orbes → corazones o vigor), fuente de las
 * raíces (mejorar armaduras), taller del planeador y ollas para cocinar.
 */
export function buildAltar(kind: AltarKind): PropResult {
  const root = new THREE.Group();
  const colliders: LocalCollider[] = [];
  switch (kind) {
    case 'offering': {
      root.add(mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.4, 8), materials.stoneDark, 0, 0.2, 0));
      root.add(mesh(new THREE.CylinderGeometry(0.45, 0.6, 2.4, 8), materials.stone, 0, 1.6, 0));
      const head = mesh(new THREE.DodecahedronGeometry(0.5, 0), materials.ancestral, 0, 3.1, 0);
      root.add(head);
      for (const s of [-1, 1]) {
        const arm = mesh(new THREE.BoxGeometry(0.25, 1.2, 0.25), materials.stone, s * 0.6, 2.2, 0.2);
        arm.rotation.z = s * 0.6;
        root.add(arm);
      }
      root.add(mesh(new THREE.OctahedronGeometry(0.22, 0), glow, 0, 2.4, 0.55));
      colliders.push({ kind: 'cylinder', x: 0, z: 0, radius: 1.2, yMin: 0, yMax: 3.5, material: 'stone' });
      break;
    }
    case 'fountain': {
      root.add(mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.7, 12), materials.stone, 0, 0.35, 0));
      root.add(mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.1, 24), water, 0, 0.66, 0));
      root.add(mesh(new THREE.CylinderGeometry(0.3, 0.4, 1.8, 8), materials.stoneDark, 0, 1.2, 0));
      root.add(mesh(new THREE.SphereGeometry(0.45, 12, 8), water, 0, 2.2, 0));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const root2 = mesh(new THREE.TorusGeometry(0.8, 0.12, 6, 10, Math.PI), materials.bark, Math.cos(a) * 1.6, 0.9, Math.sin(a) * 1.6);
        root2.rotation.y = -a;
        root.add(root2);
      }
      colliders.push({ kind: 'cylinder', x: 0, z: 0, radius: 2.5, yMin: 0, yMax: 0.7, material: 'stone' });
      break;
    }
    case 'workshop': {
      root.add(mesh(new THREE.BoxGeometry(2.4, 0.12, 1.1), wood, 0, 0.95, 0));
      for (const [x, z] of [[-1.1, -0.45], [1.1, -0.45], [-1.1, 0.45], [1.1, 0.45]]) root.add(mesh(new THREE.BoxGeometry(0.1, 0.95, 0.1), wood, x, 0.47, z));
      // Planeador desplegado sobre el banco, con el borde cian.
      const sail = mesh(new THREE.ConeGeometry(1.1, 0.4, 3).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#efe6d2', side: THREE.DoubleSide }), 0, 1.25, 0);
      sail.scale.set(1.2, 1, 0.5);
      root.add(sail);
      root.add(mesh(new THREE.BoxGeometry(2.2, 0.03, 0.05), glow, 0, 1.28, 0.25));
      root.add(mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.6, 8), iron, 1.6, 0.3, 0.3));
      colliders.push({ kind: 'box', x: 0, y: 0.5, z: 0, hx: 1.2, hy: 0.5, hz: 0.55, material: 'wood' });
      break;
    }
    case 'cooking': {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        root.add(mesh(new THREE.DodecahedronGeometry(0.16, 0), materials.rockDark, Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55));
      }
      root.add(mesh(new THREE.CylinderGeometry(0.5, 0.38, 0.5, 12, 1, true), iron, 0, 0.55, 0));
      root.add(mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.04, 12), new THREE.MeshStandardMaterial({ color: '#c98a4a', roughness: 0.4 }), 0, 0.72, 0));
      const flame = mesh(new THREE.ConeGeometry(0.22, 0.35, 6), new THREE.MeshBasicMaterial({ color: '#ff9a3a' }), 0, 0.2, 0);
      flame.castShadow = false;
      root.add(flame);
      colliders.push({ kind: 'cylinder', x: 0, z: 0, radius: 0.55, yMin: 0, yMax: 0.8, material: 'stone' });
      break;
    }
  }
  return { object: root, colliders };
}
