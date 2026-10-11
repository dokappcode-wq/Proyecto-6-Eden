import * as THREE from 'three';
import { createTransform } from '../../core/ecs/components';
import type { World } from '../../core/ecs/World';
import type { TempleDef } from '../../data/schemas';
import type { StaticColliders } from '../physics/StaticColliders';
import { ANCESTRAL_CYAN, materials } from '../props/kit';

export interface Checkpoint {
  x: number;
  y: number;
  z: number;
  /** Radio horizontal en el que se activa. */
  radius: number;
}

export interface TempleCourseHandle {
  def: TempleDef;
  group: THREE.Group;
  start: THREE.Vector3;
  checkpoints: Checkpoint[];
  killY: number;
  /** Muestra el portal de salida (tras recoger la recompensa). */
  setExitVisible(on: boolean): void;
  /** Oculta la recompensa del altar una vez recogida. */
  setRewardTaken(taken: boolean): void;
  update(time: number): void;
}

/**
 * Construye el escenario de un templo de retos desde temples.json: bloques (con colisión y
 * material), puntos de control, altar con la recompensa y portal de salida. Vive lejos del
 * mundo principal (instancia aparte): se entra y se sale por portal con un fundido.
 */
export function buildTempleCourse(def: TempleDef, colliders: StaticColliders, world: World): TempleCourseHandle {
  const [ox, oy, oz] = def.instanceOrigin;
  const group = new THREE.Group();
  group.name = `temple_course_${def.id}`;
  const checkpoints: Checkpoint[] = [];

  const glyphMat = materials.rune;
  for (const b of def.course) {
    const [x, y, z] = b.position;
    const [w, h, d] = b.size;
    const mat = b.material === 'stone' ? materials.stone : materials.ancestral;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(ox + x, oy + y, oz + z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    // Borde superior cian: guía visual ("azul brillante = importante/interactuable").
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.06, 0.06), glyphMat);
    rim.position.set(ox + x, oy + y + h / 2 - 0.03, oz + z + d / 2 + 0.01);
    group.add(rim);
    if (b.glyph) {
      for (const s of [-1, 1]) {
        const g = new THREE.Mesh(new THREE.BoxGeometry(0.08, Math.min(2.5, h * 0.4), 0.04), glyphMat);
        g.position.set(ox + x + s * w * 0.3, oy + y + h / 2 - Math.min(2.5, h * 0.4) / 2 - 0.4, oz + z + d / 2 + 0.02);
        group.add(g);
      }
    }
    colliders.addBox(ox + x, oy + y, oz + z, w / 2, h / 2, d / 2, 0, b.material);
    if (b.checkpoint) checkpoints.push({ x: ox + x, y: oy + y + h / 2, z: oz + z, radius: Math.max(w, d) / 2 });
  }

  const [sx, sy, sz] = def.start;
  const start = new THREE.Vector3(ox + sx, oy + sy, oz + sz);
  checkpoints.unshift({ x: start.x, y: start.y, z: start.z, radius: 3 });

  // Anillo de llegada.
  const arrival = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.07, 8, 40).rotateX(Math.PI / 2), materials.rune);
  arrival.position.set(start.x, start.y + 0.05, start.z);
  group.add(arrival);

  // Altar con la recompensa flotante.
  const [ax, ay, az] = def.altar;
  const altarPos = new THREE.Vector3(ox + ax, oy + ay, oz + az);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.1, 10), materials.ancestral);
  pedestal.position.copy(altarPos).add(new THREE.Vector3(0, 0.55, 0));
  pedestal.castShadow = true;
  group.add(pedestal);
  colliders.addCylinder(altarPos.x, altarPos.z, 0.9, altarPos.y - 0.2, altarPos.y + 1.1, 'ancestral');
  const reward = new THREE.Group();
  reward.position.copy(altarPos).add(new THREE.Vector3(0, 2, 0));
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8).rotateZ(Math.PI / 2), materials.ancestral);
  reward.add(bar);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 3).rotateZ((side * Math.PI) / 2), new THREE.MeshBasicMaterial({ color: ANCESTRAL_CYAN, transparent: true, opacity: 0.8 }));
    wing.position.x = side * 0.7;
    wing.scale.set(1, 1, 0.15);
    reward.add(wing);
  }
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 40), new THREE.MeshBasicMaterial({ color: ANCESTRAL_CYAN, transparent: true, opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  reward.add(halo);
  group.add(reward);

  // Portal de salida.
  const [ex, ey, ez] = def.exitPortal;
  const exitPos = new THREE.Vector3(ox + ex, oy + ey, oz + ez);
  const exitMat = new THREE.MeshBasicMaterial({ color: ANCESTRAL_CYAN, transparent: true, opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const exitPortal = new THREE.Group();
  exitPortal.position.copy(exitPos).add(new THREE.Vector3(0, 1.7, 0));
  exitPortal.add(new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.09, 8, 40), materials.rune));
  exitPortal.add(new THREE.Mesh(new THREE.CircleGeometry(1.15, 40), exitMat));
  exitPortal.visible = false;
  group.add(exitPortal);

  // Interactuables: inscripción de bienvenida, altar y salida.
  const addInteractable = (id: string, kind: 'inscription' | 'altar' | 'portal', p: THREE.Vector3, prompt: string, enabled: boolean, title?: string, text?: string) => {
    const e = world.createEntity();
    world.add(e, 'name', { value: id });
    world.add(e, 'transform', createTransform(p.x, p.y, p.z));
    world.add(e, 'interactable', { id, kind, prompt, radius: 2.4, enabled, title, text });
  };
  const note = start.clone().add(new THREE.Vector3(2.6, 0, -1.5));
  const stele = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.25), materials.stone);
  stele.position.copy(note).add(new THREE.Vector3(0, 0.7, 0));
  stele.rotation.y = -0.6;
  group.add(stele);
  addInteractable(`${def.id}_note`, 'inscription', note, 'Leer', true, def.name, `${def.challengeName}.\n${def.inscription}`);
  addInteractable(`${def.id}_reward`, 'altar', altarPos, 'Tomar', true);
  addInteractable(`${def.id}_exit`, 'portal', exitPos, 'Salir del templo', false);

  let rewardTaken = false;
  return {
    def,
    group,
    start,
    checkpoints,
    killY: oy - def.killDepth,
    setExitVisible(on: boolean) {
      exitPortal.visible = on;
      for (const e of world.query('interactable')) {
        const it = world.require(e, 'interactable');
        if (it.id === `${def.id}_exit`) it.enabled = on;
      }
    },
    setRewardTaken(taken: boolean) {
      rewardTaken = taken;
      reward.visible = !taken;
      for (const e of world.query('interactable')) {
        const it = world.require(e, 'interactable');
        if (it.id === `${def.id}_reward`) it.enabled = !taken;
      }
    },
    update(time: number) {
      if (!rewardTaken) {
        reward.rotation.y = time * 1.2;
        reward.position.y = altarPos.y + 2 + Math.sin(time * 2) * 0.15;
        halo.rotation.z = time;
      }
      exitMat.opacity = 0.45 + Math.sin(time * 3) * 0.15;
      arrival.rotation.z = time * 0.6;
    },
  };
}
