import * as THREE from 'three';
import { createRng } from '../../core/math';
import type { TowerVariant } from '../../data/schemas';
import { ANCESTRAL_CYAN, buildTrees, makeRockGeometry, materials } from './kit';

/** Colisionador en el espacio local del prop (el ValleyBuilder lo pasa a mundo). */
export type LocalCollider =
  | { kind: 'box'; x: number; y: number; z: number; hx: number; hy: number; hz: number; rotY?: number; material?: string }
  | { kind: 'cylinder'; x: number; z: number; radius: number; yMin: number; yMax: number; material?: string };

export interface PropResult {
  object: THREE.Object3D;
  colliders: LocalCollider[];
  /** Animación ambiental opcional (tiempo de juego, delta). */
  update?: (time: number, dt: number) => void;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

function box(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

// ------------------------------------------------------------------ cápsula de escape

export interface CapsuleProp extends PropResult {
  /** Asiento del jugador dentro de la cápsula (local). */
  seat: THREE.Vector3;
  /** Punto donde aterriza al salir (local). */
  exit: THREE.Vector3;
  /** 0 = cerrada, 1 = abierta. */
  setOpen(t: number): void;
}

export function buildCapsule(): CapsuleProp {
  const root = new THREE.Group();
  root.name = 'escape_capsule';
  const r = 1.15;
  const body = new THREE.Group();
  body.position.y = 0.95;
  body.rotation.set(-0.1, 0, 0.08);
  root.add(body);

  // Casco inferior (media cápsula) + interior oscuro.
  const hull = mesh(new THREE.CapsuleGeometry(r, 2.4, 6, 20).rotateX(Math.PI / 2), materials.hull);
  hull.scale.set(1, 0.92, 1);
  body.add(hull);
  const interiorMat = materials.hullDark.clone();
  interiorMat.side = THREE.DoubleSide;
  const interior = mesh(new THREE.CapsuleGeometry(r * 0.9, 2.2, 4, 16).rotateX(Math.PI / 2), interiorMat, 0, 0.12, 0, false);
  body.add(interior);

  // Franjas de aviso y luz de baliza (tecnología humana: naranja, no cian).
  for (const z of [-1.3, 1.3]) body.add(mesh(new THREE.TorusGeometry(r * 1.01, 0.07, 6, 28), materials.warning, 0, 0, z));
  const beaconMat = new THREE.MeshStandardMaterial({ color: '#ff8a3a', emissive: '#ff6a1a', emissiveIntensity: 2 });
  const beacon = mesh(new THREE.SphereGeometry(0.14, 12, 8), beaconMat, 0, 0.35, 2.35, false);
  body.add(beacon);
  body.add(mesh(new THREE.ConeGeometry(0.5, 0.9, 12).rotateX(-Math.PI / 2), materials.hullDark, 0, 0, -2.25));

  // Escotilla: arco superior abatible sobre una bisagra lateral.
  const arcStart = Math.PI + 0.35;
  const arcLen = Math.PI - 0.7;
  const hinge = new THREE.Group();
  const hingeX = Math.cos(arcStart + arcLen) * r * 1.02;
  const hingeY = -Math.sin(arcStart + arcLen) * r * 1.02;
  hinge.position.set(hingeX, hingeY, 0);
  const hatchGeo = new THREE.CylinderGeometry(r * 1.02, r * 1.02, 2.3, 20, 1, true, arcStart, arcLen).rotateX(Math.PI / 2);
  const glass = materials.glass.clone();
  glass.side = THREE.DoubleSide;
  const hatch = mesh(hatchGeo, glass, -hingeX, -hingeY, 0);
  hinge.add(hatch);
  const frame = mesh(new THREE.TorusGeometry(r * 1.02, 0.05, 6, 24, arcLen).rotateZ(-arcStart - arcLen + Math.PI * 2), materials.hullDark, -hingeX, -hingeY, 1.15);
  hinge.add(frame);
  body.add(hinge);

  // Marca de impacto en el suelo.
  const scorchMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(30,24,20,0.85)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const scorch = mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), scorchMat, 0, 0.08, -1.8, false);
  scorch.scale.set(1, 1, 1.9);
  root.add(scorch);

  let openT = 0;
  return {
    object: root,
    colliders: [{ kind: 'box', x: 0, y: 0.95, z: 0, hx: r, hy: 1.0, hz: 2.3, material: 'metal' }],
    seat: new THREE.Vector3(0, 0.55, 0.3),
    exit: new THREE.Vector3(2.7, 0, 0.6),
    setOpen(t: number) {
      openT = t;
      hinge.rotation.z = -1.95 * t;
    },
    update(time: number) {
      beaconMat.emissiveIntensity = 0.4 + (Math.sin(time * 4) > 0.6 ? 2.4 : 0) * (1 - openT * 0.5);
    },
  };
}

// ------------------------------------------------------------------ restos de la nave

export function buildWreck(kind: 'panel' | 'wing' | 'engine' | 'debris', scale: number, seed: number): PropResult {
  const root = new THREE.Group();
  root.name = `wreck_${kind}`;
  const rng = createRng(seed);
  const colliders: LocalCollider[] = [];
  const s = scale;

  if (kind === 'panel') {
    const p = mesh(box(3.2 * s, 0.18, 2.2 * s), materials.hull, 0, 0.5 * s, 0);
    p.rotation.set(0.5, 0, 0.25);
    root.add(p);
    root.add(mesh(box(0.25, 0.3, 2.2 * s), materials.warning, 1.4 * s, 0.75 * s, 0));
    colliders.push({ kind: 'box', x: 0, y: 0.5 * s, z: 0, hx: 1.5 * s, hy: 0.6 * s, hz: 1 * s, material: 'metal' });
  } else if (kind === 'wing') {
    const w = mesh(box(6 * s, 0.3, 2.4 * s), materials.hull, 0, 0.9 * s, 0);
    w.rotation.set(0.1, 0, 0.32);
    root.add(w);
    const tip = mesh(box(1.6 * s, 0.32, 1.2 * s), materials.hullDark, 2.8 * s, 1.85 * s, 0);
    tip.rotation.z = 0.32;
    root.add(tip);
    colliders.push({ kind: 'box', x: 0, y: 0.9 * s, z: 0, hx: 2.9 * s, hy: 1.0 * s, hz: 1.2 * s, material: 'metal' });
  } else if (kind === 'engine') {
    const e = mesh(new THREE.CylinderGeometry(1.1 * s, 1.3 * s, 3.4 * s, 16).rotateZ(Math.PI / 2), materials.hullDark, 0, 1.1 * s, 0);
    e.rotation.y = 0.2;
    root.add(e);
    const nozzleMat = materials.scorched.clone();
    nozzleMat.side = THREE.DoubleSide;
    const nozzle = mesh(new THREE.CylinderGeometry(1.3 * s, 0.8 * s, 1 * s, 16, 1, true).rotateZ(Math.PI / 2), nozzleMat, -2.1 * s, 1.1 * s, -0.4 * s);
    root.add(nozzle);
    const ember = new THREE.MeshStandardMaterial({ color: '#ff7a2a', emissive: '#ff5a10', emissiveIntensity: 1.2 });
    root.add(mesh(new THREE.CircleGeometry(0.75 * s, 16).rotateY(-Math.PI / 2), ember, -1.75 * s, 1.1 * s, -0.35 * s, false));
    colliders.push({ kind: 'cylinder', x: 0, z: 0, radius: 1.5 * s, yMin: 0, yMax: 2.3 * s, material: 'metal' });

    // Columna de humo que sale del motor.
    const smoke = createSmokeColumn(-2 * s, 1.4 * s, -0.4 * s);
    root.add(smoke.object);
    return {
      object: root,
      colliders,
      update: (time, dt) => {
        ember.emissiveIntensity = 0.9 + Math.sin(time * 7) * 0.25 + Math.sin(time * 13) * 0.15;
        smoke.update(dt);
      },
    };
  } else {
    for (let i = 0; i < 5; i++) {
      const d = mesh(box((0.4 + rng()) * s, (0.2 + rng() * 0.5) * s, (0.4 + rng()) * s), rng() > 0.4 ? materials.hull : materials.hullDark, (rng() - 0.5) * 3 * s, 0.2 * s, (rng() - 0.5) * 3 * s);
      d.rotation.set(rng() * 0.6, rng() * 3, rng() * 0.6);
      root.add(d);
    }
  }
  return { object: root, colliders };
}

/** Textura de mancha radial difuminada (marcas de impacto, sombras de contacto). */
function radialTexture(inner: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.45)'));
  g.addColorStop(1, inner.replace(/[\d.]+\)$/, '0)'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSmokeColumn(x: number, y: number, z: number): { object: THREE.Group; update: (dt: number) => void } {
  const group = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(70,70,74,0.75)');
  g.addColorStop(1, 'rgba(70,70,74,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const puffs: { s: THREE.Sprite; age: number }[] = [];
  const life = 6;
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    group.add(s);
    puffs.push({ s, age: (i / 10) * life });
  }
  const update = (dt: number) => {
    for (const p of puffs) {
      p.age = (p.age + dt) % life;
      const k = p.age / life;
      p.s.position.set(x + Math.sin(k * 5 + p.age) * 0.6 + k * 3, y + k * 14, z + k * 2);
      p.s.scale.setScalar(1.2 + k * 6);
      p.s.material.opacity = Math.sin(k * Math.PI) * 0.55;
    }
  };
  update(0);
  return { object: group, update };
}

// ------------------------------------------------------------------ torre de reconocimiento

export interface TowerProp extends PropResult {
  /** Plataforma de activación (local). */
  activation: THREE.Vector3;
  /** Activación: el haz se intensifica y una onda recorre el valle (el escaneo completo llega en la Fase 8). */
  setActivated(on: boolean): void;
}

/** Materiales de cada variante de torre (ruinas, hielo, volcánica, vegetal, subterránea). */
const TOWER_LOOKS: Record<TowerVariant, { base: THREE.Material; core: THREE.Material; pillar: THREE.Material; ledge: THREE.Material }> = {
  ruins: { base: materials.stoneDark, core: materials.ancestral, pillar: materials.stone, ledge: materials.stoneDark },
  ice: {
    base: new THREE.MeshStandardMaterial({ color: '#c9dbe6', roughness: 0.5 }),
    core: new THREE.MeshStandardMaterial({ color: '#7fb4d6', roughness: 0.2, metalness: 0.1, emissive: '#1d4f6e', emissiveIntensity: 0.4 }),
    pillar: new THREE.MeshStandardMaterial({ color: '#d9ecf6', roughness: 0.35 }),
    ledge: new THREE.MeshStandardMaterial({ color: '#eef6fb', roughness: 0.8 }),
  },
  volcanic: {
    base: new THREE.MeshStandardMaterial({ color: '#2e2a28', roughness: 0.95, flatShading: true }),
    core: new THREE.MeshStandardMaterial({ color: '#3a302c', roughness: 0.8, emissive: '#ff5a1a', emissiveIntensity: 0.12 }),
    pillar: new THREE.MeshStandardMaterial({ color: '#4a3f38', roughness: 0.95, flatShading: true }),
    ledge: new THREE.MeshStandardMaterial({ color: '#5c4d42', roughness: 0.95 }),
  },
  vegetal: { base: materials.stoneDark, core: materials.bark, pillar: new THREE.MeshStandardMaterial({ color: '#7a6a52', roughness: 0.95 }), ledge: materials.bark },
  underground: {
    base: new THREE.MeshStandardMaterial({ color: '#2a2438', roughness: 0.9 }),
    core: new THREE.MeshStandardMaterial({ color: '#3b2f5c', roughness: 0.4, emissive: '#7a4dff', emissiveIntensity: 0.25 }),
    pillar: new THREE.MeshStandardMaterial({ color: '#463c5e', roughness: 0.85 }),
    ledge: new THREE.MeshStandardMaterial({ color: '#2f2842', roughness: 0.9 }),
  },
};

/** Decoración propia de cada variante (sin colisión). */
function towerDecor(variant: TowerVariant, platformY: number, rng: () => number): THREE.Group {
  const g = new THREE.Group();
  switch (variant) {
    case 'ruins':
      for (let i = 0; i < 6; i++) {
        const a = rng() * Math.PI * 2;
        const r = 8 + rng() * 5;
        const b = mesh(box(1 + rng() * 1.5, 0.8 + rng(), 1 + rng() * 1.5), materials.stone, Math.cos(a) * r, 0.4, Math.sin(a) * r);
        b.rotation.set(rng() * 0.4, rng() * 3, rng() * 0.4);
        g.add(b);
      }
      break;
    case 'ice': {
      const ice = new THREE.MeshStandardMaterial({ color: '#dff4ff', roughness: 0.1, transparent: true, opacity: 0.85 });
      for (let i = 0; i < 18; i++) {
        const a = rng() * Math.PI * 2;
        const y = 6 + rng() * (platformY - 8);
        const c = mesh(new THREE.ConeGeometry(0.18, 1 + rng() * 1.6, 5).rotateX(Math.PI), ice, Math.cos(a) * 2.8, y, Math.sin(a) * 2.8, false);
        g.add(c);
      }
      g.add(mesh(new THREE.CylinderGeometry(6.4, 6.4, 0.3, 12), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), 0, platformY + 1.32, 0));
      break;
    }
    case 'volcanic': {
      const lava = new THREE.MeshBasicMaterial({ color: '#ff7a2a' });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const crack = mesh(box(0.15, 3 + rng() * 2, 0.15), lava, Math.cos(a) * 6.9, 1.6, Math.sin(a) * 6.9, false);
        crack.rotation.z = (rng() - 0.5) * 0.6;
        g.add(crack);
        const spike = mesh(new THREE.ConeGeometry(0.8, 4 + rng() * 4, 5), TOWER_LOOKS.volcanic.pillar, Math.cos(a + 0.3) * (9 + rng() * 3), 1.5, Math.sin(a + 0.3) * (9 + rng() * 3));
        g.add(spike);
      }
      break;
    }
    case 'vegetal': {
      const vine = new THREE.MeshStandardMaterial({ color: '#3f7f34', roughness: 0.9 });
      for (let y = 4; y < platformY - 2; y += 3.2) {
        const t = mesh(new THREE.TorusGeometry(2.75, 0.22, 5, 18, Math.PI * 1.3), vine, 0, y, 0);
        t.rotation.set(Math.PI / 2 + (rng() - 0.5) * 0.4, 0, rng() * Math.PI * 2);
        g.add(t);
      }
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(mesh(new THREE.IcosahedronGeometry(2 + rng(), 0), materials.leaves, Math.cos(a) * 5, platformY + 2.2 + rng(), Math.sin(a) * 5));
      }
      break;
    }
    case 'underground': {
      const crystal = new THREE.MeshStandardMaterial({ color: '#b48cff', emissive: '#7a4dff', emissiveIntensity: 1.2, roughness: 0.2 });
      for (let i = 0; i < 10; i++) {
        const a = rng() * Math.PI * 2;
        const r = 7 + rng() * 4;
        const c = mesh(new THREE.OctahedronGeometry(0.6 + rng() * 0.8, 0), crystal, Math.cos(a) * r, 0.8, Math.sin(a) * r, false);
        c.scale.y = 2 + rng() * 2;
        g.add(c);
      }
      break;
    }
  }
  return g;
}

export function buildTower(height: number, beamHeight: number, variant: TowerVariant = 'ruins'): TowerProp {
  const root = new THREE.Group();
  root.name = 'recon_tower';
  const colliders: LocalCollider[] = [];
  const platformY = height - 6;
  const look = TOWER_LOOKS[variant];

  // Base anclada al terreno.
  root.add(mesh(new THREE.CylinderGeometry(6.2, 7.2, 4.5, 8), look.base, 0, 1.5, 0));
  colliders.push({ kind: 'cylinder', x: 0, z: 0, radius: 6.8, yMin: -2, yMax: 3.75, material: 'stone' });

  // Núcleo con anillos de runas (energía interna).
  root.add(mesh(new THREE.CylinderGeometry(2.2, 2.6, platformY - 3.75, 10), look.core, 0, 3.75 + (platformY - 3.75) / 2, 0));
  colliders.push({ kind: 'cylinder', x: 0, z: 0, radius: 2.6, yMin: 3.75, yMax: platformY, material: 'ancestral' });
  const runeRings: THREE.Mesh[] = [];
  for (let y = 8; y < platformY - 1; y += 6) {
    const ring = mesh(new THREE.TorusGeometry(2.45, 0.12, 6, 32).rotateX(Math.PI / 2), materials.rune, 0, y, 0, false);
    runeRings.push(ring);
    root.add(ring);
  }

  // Cuatro pilares exteriores con repisas (rutas de escalada en la Fase 2).
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const px = Math.cos(a) * 4.6;
    const pz = Math.sin(a) * 4.6;
    const pillar = mesh(box(1.3, platformY - 3.75, 1.3), look.pillar, px, 3.75 + (platformY - 3.75) / 2, pz);
    pillar.rotation.y = -a;
    root.add(pillar);
    colliders.push({ kind: 'box', x: px, y: 3.75 + (platformY - 3.75) / 2, z: pz, hx: 0.65, hy: (platformY - 3.75) / 2, hz: 0.65, rotY: -a, material: 'stone' });
    for (let y = 9 + i * 1.5; y < platformY - 2; y += 7) {
      const ledge = mesh(box(2.2, 0.4, 2.2), look.ledge, px * 1.08, y, pz * 1.08);
      ledge.rotation.y = -a;
      root.add(ledge);
      colliders.push({ kind: 'box', x: px * 1.08, y, z: pz * 1.08, hx: 1.1, hy: 0.2, hz: 1.1, rotY: -a, material: 'stone' });
    }
    // Contrafuerte inclinado hasta el núcleo.
    const strut = mesh(box(0.5, 6, 0.5), materials.stoneDark, px * 0.62, platformY - 3, pz * 0.62);
    strut.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
    root.add(strut);
  }

  root.add(towerDecor(variant, platformY, createRng(Math.round(height * 97) + variant.length)));

  // Plataforma de activación + sala de control.
  root.add(mesh(new THREE.CylinderGeometry(6, 5.4, 1.2, 12), materials.stone, 0, platformY + 0.6, 0));
  colliders.push({ kind: 'cylinder', x: 0, z: 0, radius: 6, yMin: platformY - 0.2, yMax: platformY + 1.2, material: 'stone' });
  const activation = mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.15, 24), materials.rune, 0, platformY + 1.28, 0, false);
  root.add(activation);
  root.add(mesh(new THREE.TorusGeometry(5.9, 0.08, 6, 48).rotateX(Math.PI / 2), materials.rune, 0, platformY + 1.25, 0, false));

  // Antena de escaneo con anillo giratorio y cristal.
  root.add(mesh(new THREE.CylinderGeometry(0.25, 0.5, height - platformY + 1, 8), materials.ancestral, 0, platformY + (height - platformY + 1) / 2 + 1, 0));
  colliders.push({ kind: 'cylinder', x: 0, z: 0, radius: 0.55, yMin: platformY + 1.2, yMax: height + 1, material: 'ancestral' });
  const ring = mesh(new THREE.TorusGeometry(2.4, 0.18, 8, 40), materials.ancestral, 0, height - 1.5, 0);
  ring.rotation.x = Math.PI / 2;
  root.add(ring);
  const crystal = mesh(new THREE.OctahedronGeometry(1.1, 0), materials.rune, 0, height + 1.4, 0, false);
  root.add(crystal);

  // Haz azul visible desde muy lejos: indica "esto es importante".
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: ANCESTRAL_CYAN.clone() }, uBoost: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform float uBoost; varying vec2 vUv;
      void main() {
        float fade = pow(1.0 - vUv.y, 1.6 - uBoost * 0.6);
        float bands = 0.75 + 0.25 * sin(vUv.y * 160.0 - uTime * (3.0 + uBoost * 6.0));
        float core = 0.55 + 0.45 * sin(vUv.x * 6.2831 * 3.0 + uTime * 0.5);
        gl_FragColor = vec4(uColor * (1.4 + uBoost), fade * bands * core * (0.42 + uBoost * 0.3));
      }`,
  });
  if (beamHeight > 0) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, beamHeight, 16, 1, true), beamMat);
    beam.position.y = height + 1.4 + beamHeight / 2;
    beam.renderOrder = 5;
    beam.frustumCulled = false;
    root.add(beam);
  }

  // Onda de activación (anillo que se expande sobre el terreno).
  const waveMat = new THREE.MeshBasicMaterial({ color: ANCESTRAL_CYAN, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const wave = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 96).rotateX(-Math.PI / 2), waveMat);
  wave.position.y = platformY;
  wave.visible = false;
  root.add(wave);
  let activated = false;
  let waveT = -1;

  return {
    object: root,
    colliders,
    activation: new THREE.Vector3(0, platformY + 1.2, 0),
    setActivated(on: boolean) {
      if (on && !activated) waveT = 0;
      activated = on;
      beamMat.uniforms.uBoost.value = on ? 1 : 0;
    },
    update(time, dt) {
      if (waveT >= 0) {
        waveT += dt;
        const k = Math.min(1, waveT / 4);
        wave.visible = true;
        wave.scale.setScalar(5 + k * 420);
        waveMat.opacity = (1 - k) * 0.8;
        if (k >= 1) {
          waveT = -1;
          wave.visible = false;
        }
      }
      ring.rotation.z = time * (activated ? 1.6 : 0.5);
      crystal.rotation.y = time * 0.8;
      crystal.position.y = height + 1.4 + Math.sin(time * 1.3) * 0.25;
      beamMat.uniforms.uTime.value = time;
      const pulse = 1.2 + Math.sin(time * 1.6) * 0.5;
      (activation.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
      runeRings.forEach((r, i) => (r.visible = Math.sin(time * 1.2 - i * 0.6) > -0.6));
    },
  };
}

// ------------------------------------------------------------------ templo (piedra ancestral)

export interface TempleProp extends PropResult {
  /** Apertura 0..1: las mitades se separan y aparece el portal. */
  setOpen(t: number): void;
  /** Completado: el símbolo queda encendido de forma permanente. */
  setCompleted(done: boolean): void;
  /** Punto delante de la piedra (local) donde se deja al jugador al salir. */
  front: THREE.Vector3;
}

export function buildTemple(): TempleProp {
  const root = new THREE.Group();
  root.name = 'ancestral_temple';
  const colliders: LocalCollider[] = [];
  root.add(mesh(box(11, 0.4, 9), materials.stoneDark, 0, 0.0, 0));
  colliders.push({ kind: 'box', x: 0, y: 0, z: 0, hx: 5.5, hy: 0.2, hz: 4.5, material: 'stone' });

  // Dos mitades que se separan para revelar el portal.
  const halves: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    g.position.x = side * 1.75;
    g.add(mesh(box(3, 7.5, 4), materials.ancestral, 0, 3.95, 0));
    g.add(mesh(box(0.12, 6.4, 0.12), materials.rune, -side * 1.43, 3.6, 2.02, false));
    halves.push(g);
    root.add(g);
    colliders.push({ kind: 'box', x: side * 1.75, y: 3.95, z: 0, hx: 1.5, hy: 3.75, hz: 2, material: 'ancestral' });
  }
  root.add(mesh(box(7.2, 1, 4.6), materials.stone, 0, 8.2, 0));
  const door = mesh(box(0.5, 4.2, 0.2), new THREE.MeshBasicMaterial({ color: '#04121a' }), 0, 2.3, 2.0, false);
  root.add(door);
  const symbolMat = materials.rune.clone();
  const symbol = mesh(new THREE.TorusGeometry(0.9, 0.1, 8, 32), symbolMat, 0, 6.2, 2.25, false);
  root.add(symbol);
  const eye = mesh(new THREE.CircleGeometry(0.3, 16), materials.glow, 0, 6.2, 2.26, false);
  root.add(eye);
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const tick = mesh(box(0.08, 0.5, 0.05), materials.rune, Math.sin(a) * 1.25, 6.2 + Math.cos(a) * 1.25, 2.25, false);
    tick.rotation.z = -a;
    root.add(tick);
  }
  // Portal: disco cian que gira (visible al abrirse).
  const portalMat = new THREE.MeshBasicMaterial({ color: ANCESTRAL_CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const portal = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40), portalMat);
  portal.position.set(0, 2.6, 0.4);
  portal.scale.set(0.01, 1.6, 1);
  root.add(portal);
  const swirl = new THREE.Mesh(new THREE.RingGeometry(0.5, 1.45, 40, 1, 0, Math.PI * 1.2), portalMat);
  swirl.position.copy(portal.position).add(new THREE.Vector3(0, 0, 0.02));
  portal.add(swirl);
  swirl.position.set(0, 0, 0.02);

  let open = 0;
  let completed = false;
  return {
    object: root,
    colliders,
    front: new THREE.Vector3(0, 0.3, 6),
    setOpen(t: number) {
      open = t;
      const e = t * t * (3 - 2 * t);
      halves[0].position.x = -1.75 - e * 1.6;
      halves[1].position.x = 1.75 + e * 1.6;
      door.visible = t < 0.05;
      portal.scale.x = Math.max(0.01, e);
    },
    setCompleted(done: boolean) {
      completed = done;
      symbolMat.emissive.set(done ? '#7dffb0' : ANCESTRAL_CYAN);
    },
    update(time) {
      const k = 0.5 + 0.5 * Math.sin(time * 0.9);
      symbol.scale.setScalar(1 + k * 0.06);
      eye.scale.setScalar(0.8 + k * 0.4);
      portalMat.opacity = open > 0.05 && !completed ? 0.55 + Math.sin(time * 4) * 0.15 : 0;
      portal.visible = portalMat.opacity > 0;
      swirl.rotation.z = -time * 2.5;
    },
  };
}

// ------------------------------------------------------------------ muro de salida

export interface GateProp extends PropResult {
  /** Progreso de apertura 0..1 (las rocas se hunden). */
  setOpen(t: number): void;
  /** Enciende las runas: la de la torre (izquierda) y la de la piedra (derecha). */
  setRunes(tower: boolean, stone: boolean): void;
}

export function buildGate(width: number, height: number, depth: number): GateProp {
  const root = new THREE.Group();
  root.name = 'valley_gate';
  const movers: { obj: THREE.Object3D; baseY: number }[] = [];
  const rng = createRng(4242);
  const count = 6;
  for (let i = 0; i < count; i++) {
    const g = makeRockGeometry(500 + i, 1);
    const r = mesh(g, materials.rock, (i / (count - 1) - 0.5) * width * 0.92, 0, depth * 0.15 + rng() * depth * 0.25);
    const sc = height * (0.42 + rng() * 0.25);
    r.scale.set(sc * 0.75, sc, sc * 0.7);
    r.position.y = -sc * 0.15;
    r.rotation.y = rng() * Math.PI;
    root.add(r);
    movers.push({ obj: r, baseY: r.position.y });
  }
  // La losa ancestral va delante de las rocas (lado del valle, -Z) para que sus runas se lean.
  const slab = mesh(box(width * 0.3, height * 0.85, depth * 0.6), materials.ancestral, 0, height * 0.42, -depth * 0.55);
  root.add(slab);
  movers.push({ obj: slab, baseY: slab.position.y });
  const runes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    // Runas en la cara interior (la que mira al valle, -Z local): torre y piedra.
    const rune = mesh(new THREE.TorusGeometry(1.2, 0.18, 8, 28), materials.stoneDark, side * 2.1, height * 0.12, -depth * 0.31, false);
    slab.add(rune);
    runes.push(rune);
  }
  return {
    object: root,
    colliders: [{ kind: 'box', x: 0, y: height / 2, z: 0, hx: width / 2, hy: height / 2 + 2, hz: depth / 2, material: 'stone' }],
    setOpen(t: number) {
      const e = t * t * (3 - 2 * t);
      for (const m of movers) m.obj.position.y = m.baseY - e * (height + 6);
      if (t > 0) for (const r of runes) r.material = materials.rune;
    },
    setRunes(tower: boolean, stone: boolean) {
      runes[0].material = tower ? materials.rune : materials.stoneDark;
      runes[1].material = stone ? materials.rune : materials.stoneDark;
    },
  };
}

// ------------------------------------------------------------------ ruinas

export function buildRuin(kind: 'block' | 'pillar' | 'arch' | 'wall' | 'slab' | 'rockface', size: readonly number[], runes: boolean): PropResult {
  const [w, h, d] = size;
  const root = new THREE.Group();
  root.name = `ruin_${kind}`;
  const colliders: LocalCollider[] = [];
  const stone = kind === 'block' ? materials.stone : materials.stoneDark;

  const addRunes = (target: THREE.Object3D, ww: number, hh: number, dd: number, y: number) => {
    if (!runes) return;
    for (const s of [-1, 1]) {
      target.add(mesh(box(ww * 0.6, 0.08, 0.04), materials.rune, 0, y + hh * 0.15, s * (dd / 2 + 0.02), false));
      target.add(mesh(box(0.08, hh * 0.4, 0.04), materials.rune, ww * 0.18, y, s * (dd / 2 + 0.02), false));
    }
  };

  if (kind === 'rockface') {
    // Roca escalable: caja facetada con musgo arriba (material "rock").
    const rock = mesh(box(w, h, d), materials.rock, 0, h / 2, 0);
    root.add(rock);
    const cap = mesh(box(w * 0.94, 0.1, d * 0.94), materials.moss, 0, h + 0.03, 0, false);
    root.add(cap);
    for (let i = 0; i < 3; i++) {
      const ledge = mesh(box(w * (0.3 + i * 0.15), 0.18, 0.25), materials.rockDark, (i - 1) * w * 0.2, h * (0.3 + i * 0.22), d / 2 + 0.1);
      root.add(ledge);
    }
    colliders.push({ kind: 'box', x: 0, y: h / 2, z: 0, hx: w / 2, hy: h / 2, hz: d / 2, material: 'rock' });
    return { object: root, colliders };
  }

  if (kind === 'pillar') {
    const r = w / 2;
    root.add(mesh(new THREE.CylinderGeometry(r * 0.85, r, h, 10), stone, 0, h / 2, 0));
    root.add(mesh(box(w * 1.4, 0.35, w * 1.4), materials.stone, 0, h + 0.17, 0));
    colliders.push({ kind: 'cylinder', x: 0, z: 0, radius: r * 1.05, yMin: 0, yMax: h + 0.35 });
    if (runes) root.add(mesh(new THREE.TorusGeometry(r * 0.92, 0.05, 6, 20).rotateX(Math.PI / 2), materials.rune, 0, h * 0.6, 0, false));
  } else if (kind === 'arch') {
    const pw = Math.min(1.4, w * 0.2);
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - pw / 2);
      root.add(mesh(box(pw, h - 1.2, d), stone, x, (h - 1.2) / 2, 0));
      colliders.push({ kind: 'box', x, y: (h - 1.2) / 2, z: 0, hx: pw / 2, hy: (h - 1.2) / 2, hz: d / 2 });
    }
    const lintel = mesh(box(w, 1.2, d * 1.1), materials.stone, 0, h - 0.6, 0);
    root.add(lintel);
    colliders.push({ kind: 'box', x: 0, y: h - 0.6, z: 0, hx: w / 2, hy: 0.6, hz: (d * 1.1) / 2 });
    if (runes) root.add(mesh(new THREE.TorusGeometry(0.5, 0.07, 6, 20), materials.rune, 0, h - 0.6, (d * 1.1) / 2 + 0.03, false));
  } else {
    root.add(mesh(box(w, h, d), stone, 0, h / 2, 0));
    colliders.push({ kind: 'box', x: 0, y: h / 2, z: 0, hx: w / 2, hy: h / 2, hz: d / 2 });
    addRunes(root, w, h, d, h * 0.55);
    if (kind === 'block') {
      // Musgo en la cara superior: legibilidad de "aquí se puede subir".
      const moss = mesh(box(w * 0.92, 0.06, d * 0.92), materials.moss, 0, h + 0.02, 0, false);
      root.add(moss);
    }
  }
  return { object: root, colliders };
}

// ------------------------------------------------------------------ estelas / terminal

export function buildInscriptionStone(style: 'stele' | 'terminal'): PropResult {
  const root = new THREE.Group();
  if (style === 'terminal') {
    root.name = 'ship_terminal';
    root.add(mesh(box(0.5, 0.9, 0.4), materials.hullDark, 0, 0.45, 0));
    const holoMat = new THREE.MeshBasicMaterial({ color: '#ffae5a', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const holo = mesh(new THREE.PlaneGeometry(0.9, 0.6), holoMat, 0, 1.35, 0, false);
    root.add(holo);
    return {
      object: root,
      colliders: [{ kind: 'box', x: 0, y: 0.45, z: 0, hx: 0.25, hy: 0.45, hz: 0.2, material: 'metal' }],
      update(time) {
        holoMat.opacity = 0.4 + Math.sin(time * 3) * 0.12 + (Math.sin(time * 23) > 0.9 ? 0.2 : 0);
        holo.position.y = 1.35 + Math.sin(time * 1.5) * 0.04;
      },
    };
  }
  root.name = 'inscription_stele';
  const stele = mesh(box(1, 1.6, 0.3), materials.stone, 0, 0.75, 0);
  stele.rotation.x = -0.08;
  root.add(stele);
  const face = mesh(new THREE.PlaneGeometry(0.62, 0.9), materials.rune, 0, 0.1, 0.16, false);
  stele.add(face);
  return { object: root, colliders: [{ kind: 'box', x: 0, y: 0.8, z: 0, hx: 0.5, hy: 0.8, hz: 0.18 }] };
}

// ------------------------------------------------------------------ islas flotantes (decorado lejano)

// Sin niebla pero con emisivo azulado: simula la perspectiva atmosférica de algo muy lejano.
const islandRock = new THREE.MeshStandardMaterial({ color: '#a9b0c4', emissive: '#5d6c8c', emissiveIntensity: 0.55, roughness: 1, flatShading: true, fog: false });
const islandGrass = new THREE.MeshStandardMaterial({ color: '#9fd18a', emissive: '#4f7a5a', emissiveIntensity: 0.35, roughness: 1, flatShading: true, fog: false });

export function buildFloatingIsland(radius: number, waterfall: boolean, seed: number): PropResult {
  const root = new THREE.Group();
  root.name = 'floating_island';
  const rng = createRng(seed);
  const under = new THREE.ConeGeometry(radius, radius * 1.6, 9, 3).rotateX(Math.PI);
  const pos = under.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = 1 + (rng() - 0.5) * 0.25 * (1 - Math.abs(y) / radius);
    pos.setXYZ(i, pos.getX(i) * k, y, pos.getZ(i) * k);
  }
  under.computeVertexNormals();
  root.add(mesh(under, islandRock, 0, -radius * 0.8, 0, false));
  root.add(mesh(new THREE.CylinderGeometry(radius, radius * 0.97, radius * 0.12, 9), islandGrass, 0, 0, 0, false));
  const trees = buildTrees(
    Array.from({ length: Math.round(radius / 10) }, () => {
      const a = rng() * Math.PI * 2;
      const r = rng() * radius * 0.7;
      return { x: Math.cos(a) * r, y: radius * 0.06, z: Math.sin(a) * r, scale: 2 + rng() * 2, rotY: rng() * 6, kind: rng() > 0.5 ? ('pine' as const) : ('broadleaf' as const) };
    }),
  );
  trees.traverse((o) => (o.castShadow = false));
  root.add(trees);
  const ruin = mesh(new THREE.CylinderGeometry(radius * 0.05, radius * 0.06, radius * 0.4, 8), materials.stone, radius * 0.3, radius * 0.25, -radius * 0.2, false);
  root.add(ruin);
  if (waterfall) {
    const mat = new THREE.MeshBasicMaterial({ color: '#e6f8ff', transparent: true, opacity: 0.7, fog: false, depthWrite: false, side: THREE.DoubleSide });
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(radius * 0.12, radius * 3.5), mat);
    fall.position.set(radius * 0.98, -radius * 1.7, 0);
    fall.rotation.y = Math.PI / 2;
    root.add(fall);
  }
  return { object: root, colliders: [] };
}
