import * as THREE from 'three';
import { ANCESTRAL_CYAN } from '../world/props/kit';

/**
 * Modelos procedurales de armas y escudos (sin assets). Convención: el mango está en el origen
 * y el arma apunta hacia +Y local; `tip` marca la punta (para estelas y efectos).
 * La silueta distingue cada categoría a simple vista.
 */
export interface WeaponModel {
  group: THREE.Group;
  tip: THREE.Object3D;
}

const cache = new Map<string, THREE.Material>();
function mat(color: string, opts: { metal?: number; rough?: number; emissive?: string } = {}): THREE.Material {
  const key = `${color}|${opts.metal ?? 0}|${opts.rough ?? 0.7}|${opts.emissive ?? ''}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: opts.metal ?? 0, roughness: opts.rough ?? 0.7, emissive: opts.emissive ?? '#000000', emissiveIntensity: opts.emissive ? 1.2 : 0 });
    cache.set(key, m);
  }
  return m;
}

function part(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export function buildWeaponModel(kind: string, length: number, color: string): WeaponModel {
  const group = new THREE.Group();
  const tip = new THREE.Object3D();
  const grip = mat('#4a3424', { rough: 0.9 });
  const metal = mat(color, { metal: 0.7, rough: 0.35 });
  const wood = mat(color, { rough: 0.9 });
  const L = length;
  switch (kind) {
    case 'sword': {
      part(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 6), grip, 0, 0, 0, group);
      part(new THREE.BoxGeometry(0.22, 0.04, 0.05), mat('#8a7a5a', { metal: 0.6 }), 0, 0.11, 0, group);
      part(new THREE.BoxGeometry(0.07, L * 0.8, 0.015), metal, 0, 0.13 + L * 0.4, 0, group);
      tip.position.y = 0.13 + L * 0.8;
      break;
    }
    case 'greatsword': {
      part(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 6), grip, 0, 0.05, 0, group);
      part(new THREE.BoxGeometry(0.38, 0.06, 0.07), metal, 0, 0.25, 0, group);
      part(new THREE.BoxGeometry(0.13, L * 0.82, 0.025), metal, 0, 0.28 + L * 0.41, 0, group);
      // Runa ancestral a lo largo de la hoja.
      part(new THREE.BoxGeometry(0.025, L * 0.6, 0.03), mat('#0b3a48', { emissive: '#1fd6ff' }), 0, 0.3 + L * 0.35, 0, group);
      tip.position.y = 0.28 + L * 0.82;
      break;
    }
    case 'daggers': {
      // Una daga; el personaje coloca la gemela en la otra mano.
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), grip, 0, 0, 0, group);
      part(new THREE.ConeGeometry(0.035, L, 4), metal, 0, 0.06 + L / 2, 0, group);
      tip.position.y = 0.06 + L;
      break;
    }
    case 'spear': {
      part(new THREE.CylinderGeometry(0.025, 0.03, L, 7), wood, 0, L * 0.35, 0, group);
      part(new THREE.ConeGeometry(0.06, 0.3, 5), mat('#8d8a80', { rough: 0.6 }), 0, L * 0.85 + 0.12, 0, group);
      tip.position.y = L * 0.85 + 0.27;
      break;
    }
    case 'axe': {
      part(new THREE.CylinderGeometry(0.03, 0.035, L, 7), mat('#6b4b30', { rough: 0.9 }), 0, L / 2 - 0.1, 0, group);
      const head = part(new THREE.BoxGeometry(0.3, 0.2, 0.04), metal, 0.13, L - 0.2, 0, group);
      head.rotation.z = 0.1;
      tip.position.set(0.28, L - 0.2, 0);
      break;
    }
    case 'hammer': {
      part(new THREE.CylinderGeometry(0.035, 0.04, L, 7), mat('#5b4532', { rough: 0.9 }), 0, L / 2 - 0.1, 0, group);
      part(new THREE.BoxGeometry(0.42, 0.28, 0.28), mat(color, { rough: 1 }), 0, L - 0.12, 0, group);
      tip.position.y = L;
      break;
    }
    case 'club': {
      const c = part(new THREE.CylinderGeometry(0.05, 0.035, L, 6), wood, 0, L / 2 - 0.08, 0, group);
      c.rotation.z = 0.05;
      part(new THREE.SphereGeometry(0.05, 6, 4), wood, 0.03, L * 0.6, 0, group);
      tip.position.y = L - 0.08;
      break;
    }
    case 'bow': {
      const arc = part(new THREE.TorusGeometry(L / 2, 0.022, 6, 24, Math.PI * 0.75), wood, 0, 0, 0, group);
      arc.rotation.z = Math.PI / 2 + Math.PI * 0.125;
      arc.position.x = -L * 0.22;
      const string = new THREE.Mesh(new THREE.BoxGeometry(0.006, L * 0.86, 0.006), mat('#efe6d2'));
      string.position.x = -L * 0.38;
      group.add(string);
      tip.position.y = L / 2;
      break;
    }
    default:
      // Puños: sin modelo.
      tip.position.y = 0.1;
  }
  group.add(tip);
  return { group, tip };
}

export function buildShieldModel(kind: 'round' | 'tower' | 'mirror', size: number, color: string): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'tower') {
    part(new THREE.BoxGeometry(size * 0.6, size, 0.06), mat(color, { metal: 0.6, rough: 0.45 }), 0, 0, 0, g);
    part(new THREE.BoxGeometry(size * 0.62, 0.05, 0.08), mat('#3d4246', { metal: 0.6 }), 0, size * 0.3, 0.01, g);
    part(new THREE.BoxGeometry(size * 0.62, 0.05, 0.08), mat('#3d4246', { metal: 0.6 }), 0, -size * 0.3, 0.01, g);
  } else if (kind === 'mirror') {
    part(new THREE.CylinderGeometry(size / 2, size / 2, 0.05, 24).rotateX(Math.PI / 2), mat(color, { metal: 1, rough: 0.08 }), 0, 0, 0, g);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(size / 2, 0.025, 6, 32), new THREE.MeshBasicMaterial({ color: ANCESTRAL_CYAN }));
    rim.position.z = 0.03;
    g.add(rim);
  } else {
    part(new THREE.CylinderGeometry(size / 2, size / 2, 0.06, 18).rotateX(Math.PI / 2), mat(color, { rough: 0.9 }), 0, 0, 0, g);
    part(new THREE.SphereGeometry(0.07, 8, 6), mat('#8a8f93', { metal: 0.7 }), 0, 0, 0.04, g);
  }
  return g;
}
