import * as THREE from 'three';
import { createRng } from '../../core/math';
import type { CampDef } from '../../data/schemas';
import type { StaticColliders } from '../physics/StaticColliders';
import { makeRockGeometry, materials } from '../props/kit';
import { buildRuin } from '../props/structures';
import type { TerrainGenerator } from '../terrain/TerrainGenerator';
import { addCollider } from '../valley/ValleyBuilder';

const cloth = new THREE.MeshStandardMaterial({ color: '#8a6a44', roughness: 1, side: THREE.DoubleSide, flatShading: true });
const wood = new THREE.MeshStandardMaterial({ color: '#6b4b2e', roughness: 0.95 });
const bone = new THREE.MeshStandardMaterial({ color: '#e3d8bc', roughness: 0.7 });
const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.85 });
const flameCore = new THREE.MeshBasicMaterial({ color: '#fff1a8' });
const metal = new THREE.MeshStandardMaterial({ color: '#8a8f94', metalness: 0.7, roughness: 0.4 });

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Lona en A: dos faldones inclinados y el fondo cerrado (la entrada queda abierta). */
function tentGeometry(w: number, hh: number, len: number): THREE.BufferGeometry {
  const L = len / 2;
  const W = w / 2;
  // prettier-ignore
  const v = [
    -W, 0, -L, 0, hh, -L, 0, hh, L,  -W, 0, -L, 0, hh, L, -W, 0, L,
    W, 0, -L, W, 0, L, 0, hh, L,  W, 0, -L, 0, hh, L, 0, hh, -L,
    -W, 0, -L, W, 0, -L, 0, hh, -L,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export interface ChestProp {
  object: THREE.Group;
  lid: THREE.Group;
  open: number;
  opening: boolean;
}

export interface EncounterProps {
  group: THREE.Group;
  chests: Map<string, ChestProp>;
  update: (time: number, dt: number, night: boolean) => void;
}

/**
 * Decorado de campamentos goblin (tiendas, hoguera con luz, cuerno, torre de vigía,
 * empalizadas, tótems y cofre) y de la arena del Coloso (anillo de pilares ancestrales).
 */
export function buildEncounterProps(camps: readonly CampDef[], arenas: readonly { position: [number, number]; radius: number }[], terrain: TerrainGenerator, colliders: StaticColliders): EncounterProps {
  const group = new THREE.Group();
  group.name = 'encounters';
  const chests = new Map<string, ChestProp>();
  const fires: { flames: THREE.Mesh[]; light: THREE.PointLight }[] = [];
  const h = (x: number, z: number) => terrain.height(x, z);

  for (const camp of camps) {
    const rng = createRng(camp.id.length * 131 + camp.center[0]);
    // Tiendas en A (tela sobre dos palos): se puede dormir debajo.
    for (const t of camp.tents) {
      const [x, z] = t.position;
      const tent = new THREE.Group();
      tent.position.set(x, h(x, z), z);
      tent.rotation.y = t.yaw;
      const w = 2.4;
      const len = 3.2;
      const hh = 1.9;
      tent.add(mesh(tentGeometry(w, hh, len), cloth));
      for (const zz of [-len / 2, len / 2]) tent.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, hh + 0.2, 5), wood, 0, (hh + 0.2) / 2, zz));
      tent.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, len + 0.3, 5).rotateX(Math.PI / 2), wood, 0, hh, 0));
      // Lecho de paja.
      tent.add(mesh(new THREE.BoxGeometry(1.2, 0.12, 2.2), new THREE.MeshStandardMaterial({ color: '#c7a85a', roughness: 1 }), 0, 0.06, 0));
      group.add(tent);
    }

    // Hoguera: piedras, troncos, llamas, asador y luz.
    {
      const [x, z] = camp.fire;
      const y = h(x, z);
      const fire = new THREE.Group();
      fire.position.set(x, y, z);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const st = mesh(makeRockGeometry(50 + i, 0), materials.rockDark, Math.cos(a) * 0.75, 0.1, Math.sin(a) * 0.75);
        st.scale.setScalar(0.2);
        fire.add(st);
      }
      for (let i = 0; i < 4; i++) {
        const log = mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 5).rotateZ(Math.PI / 2), wood, 0, 0.12, 0);
        log.rotation.y = (i / 4) * Math.PI;
        fire.add(log);
      }
      const flames: THREE.Mesh[] = [];
      for (let i = 0; i < 4; i++) {
        const f = mesh(new THREE.ConeGeometry(0.22 - i * 0.03, 0.8, 6), i === 3 ? flameCore : flameMat, (rng() - 0.5) * 0.2, 0.45, (rng() - 0.5) * 0.2);
        f.castShadow = false;
        fire.add(f);
        flames.push(f);
      }
      for (const s of [-1, 1]) {
        const post = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 5), wood, s * 0.9, 0.6, 0);
        post.rotation.z = s * 0.2;
        fire.add(post);
      }
      fire.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 2, 5).rotateZ(Math.PI / 2), wood, 0, 1.1, 0));
      fire.add(mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: '#8a3b22', roughness: 0.6 }), 0, 1.05, 0));
      const light = new THREE.PointLight('#ff9a4a', 0, 18, 1.6);
      light.position.set(0, 1.2, 0);
      fire.add(light);
      fires.push({ flames, light });
      group.add(fire);
    }

    // Cuerno de alarma en un poste.
    if (camp.horn) {
      const [x, z] = camp.horn;
      const y = h(x, z);
      const post = new THREE.Group();
      post.position.set(x, y, z);
      post.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 6), wood, 0, 1.3, 0));
      const horn = mesh(new THREE.ConeGeometry(0.16, 0.9, 8).rotateZ(Math.PI / 2), bone, 0.35, 2.1, 0);
      post.add(horn);
      post.add(mesh(new THREE.BoxGeometry(0.6, 0.06, 0.06), wood, 0.15, 2.3, 0));
      colliders.addCylinder(x, z, 0.15, y, y + 2.6, 'wood');
      group.add(post);
    }

    // Torre de vigía (madera escalable, plataforma con barandilla).
    if (camp.lookout) {
      const [x, z] = camp.lookout.position;
      const y = h(x, z);
      const H = camp.lookout.height;
      const tower = new THREE.Group();
      tower.position.set(x, y, z);
      const half = 1.2;
      for (const [px, pz] of [
        [-half, -half],
        [half, -half],
        [-half, half],
        [half, half],
      ]) {
        tower.add(mesh(new THREE.CylinderGeometry(0.12, 0.14, H + 1.2, 6), wood, px, (H + 1.2) / 2, pz));
        colliders.addCylinder(x + px, z + pz, 0.16, y - 0.5, y + H + 1.2, 'wood');
      }
      tower.add(mesh(new THREE.BoxGeometry(half * 2 + 0.6, 0.25, half * 2 + 0.6), wood, 0, H, 0));
      addCollider(colliders, { kind: 'box', x: 0, y: H, z: 0, hx: half + 0.3, hy: 0.125, hz: half + 0.3, material: 'wood' }, x, y, z, 0);
      for (const s of [-1, 1]) {
        tower.add(mesh(new THREE.BoxGeometry(half * 2 + 0.6, 0.08, 0.08), wood, 0, H + 0.9, s * (half + 0.25)));
        tower.add(mesh(new THREE.BoxGeometry(0.08, 0.08, half * 2 + 0.6), wood, s * (half + 0.25), H + 0.9, 0));
      }
      // Escalera.
      for (let k = 0.5; k < H; k += 0.45) tower.add(mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), wood, 0, k, half + 0.15));
      addCollider(colliders, { kind: 'box', x: 0, y: H / 2, z: half + 0.15, hx: 0.4, hy: H / 2, hz: 0.08, material: 'wood' }, x, y, z, 0);
      group.add(tower);
    }

    // Cofre del campamento (se abre al despejarlo).
    {
      const [x, z] = camp.chest.position;
      const y = h(x, z);
      const object = new THREE.Group();
      object.position.set(x, y, z);
      object.rotation.y = camp.chest.yaw;
      object.add(mesh(new THREE.BoxGeometry(1, 0.55, 0.65), wood, 0, 0.28, 0));
      for (const s of [-1, 1]) object.add(mesh(new THREE.BoxGeometry(0.06, 0.58, 0.68), metal, s * 0.4, 0.29, 0));
      const lid = new THREE.Group();
      lid.position.set(0, 0.55, -0.32);
      const lidMesh = mesh(new THREE.CylinderGeometry(0.33, 0.33, 1, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), wood, 0, 0, 0.32);
      lid.add(lidMesh);
      lid.add(mesh(new THREE.BoxGeometry(0.16, 0.18, 0.06), metal, 0, 0.05, 0.66));
      object.add(lid);
      addCollider(colliders, { kind: 'box', x: 0, y: 0.3, z: 0, hx: 0.5, hy: 0.3, hz: 0.33, material: 'wood' }, x, y, z, camp.chest.yaw);
      chests.set(camp.id, { object, lid, open: 0, opening: false });
      group.add(object);
    }

    // Empalizada de estacas afiladas y tótems de calaveras.
    const n = 10;
    for (let i = 0; i < n; i++) {
      if (i % 3 === 2) continue; // huecos para entrar
      const a = (i / n) * Math.PI * 2 + 0.2;
      const r = camp.radius * 0.95;
      const x = camp.center[0] + Math.cos(a) * r;
      const z = camp.center[1] + Math.sin(a) * r;
      const y = h(x, z);
      const stakes = new THREE.Group();
      stakes.position.set(x, y, z);
      stakes.rotation.y = -a;
      for (let k = -2; k <= 2; k++) {
        const st = mesh(new THREE.CylinderGeometry(0.01, 0.12, 1.8 + rng() * 0.5, 5), wood, 0, 0.9, k * 0.35);
        st.rotation.x = 0.25;
        stakes.add(st);
      }
      colliders.addCylinder(x, z, 0.8, y, y + 1.6, 'wood');
      group.add(stakes);
      if (i % 3 === 0) {
        const tx = camp.center[0] + Math.cos(a + 0.12) * (r - 1.5);
        const tz = camp.center[1] + Math.sin(a + 0.12) * (r - 1.5);
        const totem = new THREE.Group();
        totem.position.set(tx, h(tx, tz), tz);
        totem.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.2, 5), wood, 0, 1.1, 0));
        totem.add(mesh(new THREE.DodecahedronGeometry(0.18, 0), bone, 0, 2.3, 0));
        totem.add(mesh(new THREE.ConeGeometry(0.05, 0.3, 4), bone, 0.15, 2.45, 0));
        totem.add(mesh(new THREE.ConeGeometry(0.05, 0.3, 4), bone, -0.15, 2.45, 0));
        group.add(totem);
      }
    }
  }

  // Arenas de jefe: anillo de pilares ancestrales y arcos rotos.
  for (const arena of arenas) {
    const [cx, cz] = arena.position;
    const count = 14;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const x = cx + Math.cos(a) * arena.radius;
      const z = cz + Math.sin(a) * arena.radius;
      const broken = i % 4 === 1;
      const prop = buildRuin(i % 5 === 0 ? 'arch' : 'pillar', i % 5 === 0 ? [5, 6, 1.2] : [1.4, broken ? 3 : 7 + (i % 3), 1.4], true);
      const y = h(x, z) - 0.2;
      prop.object.position.set(x, y, z);
      prop.object.rotation.y = -a + Math.PI / 2;
      for (const c of prop.colliders) addCollider(colliders, c, x, y, z, -a + Math.PI / 2);
      group.add(prop.object);
    }
    // Losas del suelo de la arena.
    for (let i = 0; i < 18; i++) {
      const a = i * 2.39996;
      const r = 6 + (i % 6) * 5.5;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const slab = mesh(new THREE.BoxGeometry(3, 0.25, 3), materials.stoneDark, x, h(x, z) + 0.02, z);
      slab.rotation.y = a;
      group.add(slab);
    }
  }

  const update = (time: number, dt: number, night: boolean) => {
    for (const f of fires) {
      f.flames.forEach((m, i) => {
        const k = 0.8 + Math.sin(time * (9 + i * 3) + i) * 0.15 + Math.sin(time * 23 + i * 2) * 0.08;
        m.scale.set(1, k, 1);
        m.rotation.y = time * (1 + i);
      });
      // De noche la hoguera ilumina el campamento (y a quien se acerque).
      f.light.intensity = (night ? 30 : 6) * (0.85 + Math.sin(time * 17) * 0.1);
    }
    for (const c of chests.values()) {
      if (c.opening && c.open < 1) c.open = Math.min(1, c.open + dt * 1.5);
      c.lid.rotation.x = -c.open * 1.9;
    }
  };

  return { group, chests, update };
}
