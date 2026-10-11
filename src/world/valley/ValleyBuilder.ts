import * as THREE from 'three';
import { createTransform } from '../../core/ecs/components';
import type { World } from '../../core/ecs/World';
import type { ValleyConfig } from '../../data/schemas';
import { buildRocks, buildTrees } from '../props/kit';
import {
  buildCapsule,
  buildFloatingIsland,
  buildGate,
  buildInscriptionStone,
  buildRuin,
  buildTemple,
  buildTower,
  buildWreck,
  type CapsuleProp,
  type GateProp,
  type LocalCollider,
  type PropResult,
  type TempleProp,
  type TowerProp,
} from '../props/structures';
import type { Collider, StaticColliders } from '../physics/StaticColliders';
import type { TerrainGenerator } from '../terrain/TerrainGenerator';

export interface CapsuleHandle {
  prop: CapsuleProp;
  /** Posición/rotación del prop en el mundo. */
  origin: THREE.Vector3;
  rotY: number;
  seatWorld: THREE.Vector3;
  exitWorld: THREE.Vector3;
}

export interface GateHandle {
  prop: GateProp;
  colliders: Collider[];
}

export interface TowerHandle {
  id: string;
  prop: TowerProp;
  activationWorld: THREE.Vector3;
}

export interface TempleHandle {
  id: string;
  prop: TempleProp;
  frontWorld: THREE.Vector3;
  /** Yaw para quedar mirando hacia fuera de la piedra al salir. */
  frontYaw: number;
}

export interface ValleyHandles {
  group: THREE.Group;
  capsule: CapsuleHandle;
  gate: GateHandle;
  tower: TowerHandle;
  temple: TempleHandle;
  towerTop: THREE.Vector3;
  /** Animaciones ambientales de los props. */
  updaters: Array<(time: number, dt: number) => void>;
}

/**
 * Construye el Valle de la Cápsula a partir de valley.json: coloca cada prop sobre el terreno,
 * registra sus colisionadores y crea las entidades interactuables.
 */
export function buildValley(cfg: ValleyConfig, terrain: TerrainGenerator, colliders: StaticColliders, world: World): ValleyHandles {
  const group = new THREE.Group();
  group.name = 'valley';
  const updaters: ValleyHandles['updaters'] = [];

  const place = (prop: PropResult, x: number, z: number, rotY: number, yOverride?: number): Collider[] => {
    const y = yOverride ?? terrain.height(x, z);
    prop.object.position.set(x, y, z);
    prop.object.rotation.y = rotY;
    group.add(prop.object);
    if (prop.update) updaters.push(prop.update);
    return prop.colliders.map((c) => addCollider(colliders, c, x, y, z, rotY));
  };

  // --- cápsula
  const cap = buildCapsule();
  const [cx, cz] = cfg.capsule.position;
  place(cap, cx, cz, cfg.capsule.rotationY);
  cap.object.updateMatrixWorld(true);
  const capsule: CapsuleHandle = {
    prop: cap,
    origin: cap.object.position.clone(),
    rotY: cfg.capsule.rotationY,
    seatWorld: cap.object.localToWorld(cap.seat.clone()),
    exitWorld: cap.object.localToWorld(cap.exit.clone()),
  };
  capsule.exitWorld.y = terrain.height(capsule.exitWorld.x, capsule.exitWorld.z);
  const capEntity = world.createEntity();
  world.add(capEntity, 'name', { value: 'capsule' });
  world.add(capEntity, 'transform', createTransform(capsule.origin.x, capsule.origin.y, capsule.origin.z));
  world.add(capEntity, 'interactable', { id: 'capsule', kind: 'capsule', prompt: 'Abrir cápsula', radius: 3.4, enabled: true });

  // --- restos de la nave
  cfg.wreckage.forEach((w, i) => place(buildWreck(w.kind, w.scale, 900 + i), w.position[0], w.position[1], w.rotationY));

  // --- torre y templo
  const tower = buildTower(cfg.tower.height, cfg.tower.beamHeight);
  place(tower, cfg.tower.position[0], cfg.tower.position[1], cfg.tower.rotationY);
  tower.object.updateMatrixWorld(true);
  const towerTop = tower.object.position.clone().add(new THREE.Vector3(0, cfg.tower.height, 0));
  const activationWorld = tower.object.localToWorld(tower.activation.clone());
  const towerEntity = world.createEntity();
  world.add(towerEntity, 'name', { value: cfg.tower.id });
  world.add(towerEntity, 'transform', createTransform(activationWorld.x, activationWorld.y, activationWorld.z));
  world.add(towerEntity, 'interactable', { id: cfg.tower.id, kind: 'tower', prompt: 'Activar torre', radius: 2.2, enabled: true });

  const temple = buildTemple();
  place(temple, cfg.temple.position[0], cfg.temple.position[1], cfg.temple.rotationY);
  temple.object.updateMatrixWorld(true);
  const frontWorld = temple.object.localToWorld(temple.front.clone());
  frontWorld.y = terrain.height(frontWorld.x, frontWorld.z);
  const templeDoor = temple.object.localToWorld(new THREE.Vector3(0, 0, 3.2));
  const templeEntity = world.createEntity();
  world.add(templeEntity, 'name', { value: cfg.temple.id });
  world.add(templeEntity, 'transform', createTransform(templeDoor.x, templeDoor.y, templeDoor.z));
  world.add(templeEntity, 'interactable', { id: cfg.temple.id, kind: 'temple', prompt: 'Tocar la piedra', radius: 2.8, enabled: true });

  // --- muro sellado de la salida
  const gateProp = buildGate(cfg.gate.width, cfg.gate.height, cfg.gate.depth);
  const gateColliders = place(gateProp, cfg.gate.position[0], cfg.gate.position[1], cfg.gate.rotationY);

  // --- ruinas
  for (const r of cfg.ruins) {
    const [x, z] = r.position;
    const ground = terrain.height(x, z);
    let size = r.size;
    let baseY = ground + (r.yOffset ?? 0) - 0.5; // 0.5 m enterrado: sin huecos en pendientes
    if (r.topAbsolute !== undefined) {
      baseY = Math.min(ground, r.topAbsolute - 1) - 0.5;
      size = [r.size[0], r.topAbsolute - baseY, r.size[2]];
    } else {
      size = [r.size[0], r.size[1] + 0.5, r.size[2]];
    }
    place(buildRuin(r.kind, size, r.runes ?? false), x, z, r.rotationY, baseY);
  }

  // --- inscripciones (interactuables)
  for (const ins of cfg.inscriptions) {
    const [x, z] = ins.position;
    const y = terrain.height(x, z) + ins.yOffset;
    place(buildInscriptionStone(ins.style ?? 'stele'), x, z, ins.rotationY, y);
    const e = world.createEntity();
    world.add(e, 'name', { value: ins.id });
    world.add(e, 'transform', createTransform(x, y, z));
    world.add(e, 'interactable', {
      id: ins.id,
      kind: 'inscription',
      prompt: ins.style === 'terminal' ? 'Consultar registro' : 'Leer',
      radius: 2.6,
      enabled: true,
      title: ins.title,
      text: ins.text,
    });
  }

  // --- vegetación y rocas hechas a mano
  group.add(
    buildTrees(
      cfg.trees.map((t, i) => ({
        x: t.position[0],
        y: terrain.height(t.position[0], t.position[1]) - 0.2,
        z: t.position[1],
        scale: t.scale,
        rotY: i * 2.39,
        kind: t.kind,
      })),
    ),
  );
  for (const t of cfg.trees) colliders.addCylinder(t.position[0], t.position[1], 0.35 * t.scale, terrain.height(t.position[0], t.position[1]) - 1, terrain.height(t.position[0], t.position[1]) + 3 * t.scale, 'wood');

  const rocks = cfg.rocks.map((r) => ({ x: r.position[0], y: terrain.height(r.position[0], r.position[1]) - 0.3 * r.scale, z: r.position[1], scale: r.scale, rotY: r.rotationY }));
  group.add(buildRocks(rocks));
  for (const r of rocks) colliders.addCylinder(r.x, r.z, 0.95 * r.scale, r.y - 1, r.y + 0.35 * r.scale + 0.75 * r.scale, 'rock');

  // --- islas flotantes (decorado lejano, sin colisión en la Fase 1)
  cfg.floatingIslands.forEach((isl, i) => {
    const p = buildFloatingIsland(isl.radius, isl.waterfall, 3000 + i);
    p.object.position.set(isl.position[0], isl.position[1], isl.position[2]);
    group.add(p.object);
  });

  return {
    group,
    capsule,
    gate: { prop: gateProp, colliders: gateColliders },
    tower: { id: cfg.tower.id, prop: tower, activationWorld },
    temple: { id: cfg.temple.id, prop: temple, frontWorld, frontYaw: cfg.temple.rotationY },
    towerTop,
    updaters,
  };
}

function addCollider(colliders: StaticColliders, c: LocalCollider, x: number, y: number, z: number, rotY: number): Collider {
  // Local -> mundo con la rotación Y del prop (misma convención que Three.js).
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const wx = x + cos * c.x + sin * c.z;
  const wz = z - sin * c.x + cos * c.z;
  if (c.kind === 'box') return colliders.addBox(wx, y + c.y, wz, c.hx, c.hy, c.hz, rotY + (c.rotY ?? 0), c.material);
  return colliders.addCylinder(wx, wz, c.radius, y + c.yMin, y + c.yMax, c.material);
}
