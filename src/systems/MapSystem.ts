import * as THREE from 'three';
import type { GameContext, System } from '../core/Game';
import { createTransform } from '../core/ecs/components';
import type { Entity } from '../core/ecs/World';
import type { MapLayer, RegionsConfig, TerrainConfig, TowerDef, TowersConfig } from '../data/schemas';
import type { CompassMarker } from '../ui/Hud';
import { FogOfWar, seedOf } from '../world/map/FogOfWar';
import { MapImage } from '../world/map/MapImage';
import type { StaticColliders } from '../world/physics/StaticColliders';
import { ANCESTRAL_CYAN } from '../world/props/kit';
import { buildTower, type TowerProp } from '../world/props/structures';
import type { TerrainGenerator } from '../world/terrain/TerrainGenerator';
import { addCollider } from '../world/valley/ValleyBuilder';
import type { CameraSystem } from './CameraSystem';
import type { PlayerSystem } from './PlayerSystem';

export type PoiKind = 'tower' | 'temple' | 'ruins' | 'cave' | 'camp' | 'island' | 'underground' | 'settlement' | 'station';

export interface Poi {
  id: string;
  kind: PoiKind;
  name: string;
  x: number;
  z: number;
  layer: MapLayer;
  /** Destino del viaje rápido (si lo permite). */
  travel?: { x: number; y: number; z: number; yaw: number };
  /** Se puede viajar (torre activada, templo visitado). */
  unlocked?: () => boolean;
  /** Visible aunque esté en la niebla (torres descubiertas por su haz). */
  alwaysVisible?: () => boolean;
}

export interface MapMarker {
  x: number;
  z: number;
  color: string;
  compass: CompassMarker;
}

interface TowerRt {
  def: TowerDef;
  x: number;
  y: number;
  z: number;
  top: THREE.Vector3;
  prop: TowerProp | null;
  activated: boolean;
  discovered: boolean;
  compass: CompassMarker | null;
}

export interface MapDeps {
  towers: TowersConfig;
  regions: RegionsConfig;
  terrainCfg: TerrainConfig;
  terrain: TerrainGenerator;
  colliders: StaticColliders;
  scene: THREE.Scene;
  playerEntity: Entity;
  player: PlayerSystem;
  camera: CameraSystem;
  threeCamera: THREE.PerspectiveCamera;
  /** Torre del valle (la construye el valle): posición de su plataforma. */
  valleyTowerTop: THREE.Vector3;
  compass: { add(m: CompassMarker): void; remove(m: CompassMarker): void };
  /** ¿Hay enemigos en combate cerca? (no se puede viajar). */
  inCombat: () => boolean;
  /** Abre el mapa al terminar el escaneo. */
  openMap: (focus: { x: number; z: number; radius: number } | null) => void;
}

const MARKER_COLORS = ['#ff5b4b', '#ffd23a', '#7ee36b', '#b48cff'];
const MAX_MARKERS = 24;

/**
 * Torres de reconocimiento y mapa: niebla de guerra, descubrimiento por el haz, activación con
 * escaneo animado (haz, ondas y revelado orgánico), puntos de interés por capa, marcadores
 * y viaje rápido a torres y templos.
 */
export class MapSystem implements System {
  readonly name = 'map';
  readonly fog: FogOfWar;
  readonly image: MapImage;
  readonly group = new THREE.Group();
  readonly towers: TowerRt[] = [];
  readonly pois: Poi[] = [];
  readonly markers: MapMarker[] = [];
  readonly visitedTemples = new Set<string>();
  private revealT = 0;
  private scan: { tower: TowerRt; t: number } | null = null;
  private readonly waves: THREE.Mesh[] = [];
  private readonly waveMat: THREE.ShaderMaterial;
  private travelT = -1;
  private travelTo: Poi | null = null;
  private markerColor = 0;

  constructor(
    private readonly d: MapDeps,
    ctx: GameContext,
  ) {
    const res = d.towers.fog.resolution;
    this.fog = new FogOfWar(res, d.terrainCfg.worldSize);
    this.image = new MapImage(d.terrain, d.terrainCfg, 512, d.terrainCfg.worldSize);
    this.group.name = 'map-fx';
    d.scene.add(this.group);
    this.waveMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: ANCESTRAL_CYAN.clone() }, uAlpha: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
        void main() { float a = pow(1.0 - vUv.y, 2.0) * uAlpha; gl_FragColor = vec4(uColor * 1.6, a); }`,
    });
    for (let i = 0; i < d.towers.scan.waves; i++) {
      // Muro de luz cilíndrico (abierto): desde arriba parece un anillo, de lado una cortina.
      const w = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 70, 96, 1, true).translate(0, 25, 0), this.waveMat.clone());
      w.visible = false;
      w.frustumCulled = false;
      w.renderOrder = 6;
      this.group.add(w);
      this.waves.push(w);
    }
    this.buildTowers(ctx);

    ctx.bus.on('interact', ({ id, kind }) => {
      if (kind !== 'tower') return;
      const t = this.towers.find((x) => x.def.id === id);
      // La del valle la activa su propio sistema (que emite tower:activated).
      if (t && !t.def.builtin) this.activate(ctx, t);
    });
    ctx.bus.on('tower:activated', ({ id }) => {
      const t = this.towers.find((x) => x.def.id === id);
      if (t && t.def.builtin && !t.activated) this.startScan(ctx, t);
    });
    ctx.bus.on('temple:enter', ({ id }) => this.visitedTemples.add(id));
  }

  // ------------------------------------------------------------------ torres

  private buildTowers(ctx: GameContext): void {
    for (const def of this.d.towers.towers) {
      const [x, z] = def.position;
      if (def.builtin) {
        const top = this.d.valleyTowerTop.clone();
        this.towers.push({ def, x, y: this.d.terrain.height(x, z), z, top, prop: null, activated: false, discovered: false, compass: null });
        continue;
      }
      // Base sobre el punto más bajo de la huella (la base se hunde en las laderas).
      let y = Infinity;
      for (let a = 0; a < 8; a++) y = Math.min(y, this.d.terrain.height(x + Math.cos(a) * 6, z + Math.sin(a) * 6));
      y = Math.min(y, this.d.terrain.height(x, z));
      const prop = buildTower(def.height, 900, def.variant);
      prop.object.position.set(x, y, z);
      this.group.add(prop.object);
      for (const c of prop.colliders) addCollider(this.d.colliders, c, x, y, z, 0);
      const top = new THREE.Vector3(x + prop.activation.x, y + prop.activation.y, z + prop.activation.z);
      const e = ctx.world.createEntity();
      ctx.world.add(e, 'name', { value: def.id });
      ctx.world.add(e, 'transform', createTransform(top.x, top.y, top.z));
      ctx.world.add(e, 'interactable', { id: def.id, kind: 'tower', prompt: 'Activar torre', radius: 2.4, enabled: true });
      this.towers.push({ def, x, y, z, top, prop, activated: false, discovered: false, compass: null });
      this.pois.push(this.towerPoi(this.towers[this.towers.length - 1]));
    }
    const valley = this.towers.find((t) => t.def.builtin);
    if (valley) this.pois.unshift(this.towerPoi(valley));
  }

  private towerPoi(t: TowerRt): Poi {
    return {
      id: t.def.id,
      kind: 'tower',
      name: t.def.name,
      x: t.x,
      z: t.z,
      layer: t.def.variant === 'underground' ? 'underground' : 'surface',
      travel: { x: t.top.x + 1.5, y: t.top.y, z: t.top.z + 1.5, yaw: 0 },
      unlocked: () => t.activated,
      alwaysVisible: () => t.discovered || t.activated,
    };
  }

  tower(id: string): TowerRt | undefined {
    return this.towers.find((t) => t.def.id === id);
  }

  private activate(ctx: GameContext, t: TowerRt): void {
    if (t.activated || this.scan) return;
    const it = [...ctx.world.query('interactable')].map((e) => ctx.world.require(e, 'interactable')).find((i) => i.id === t.def.id);
    if (it) {
      it.enabled = false;
      it.prompt = 'Torre activada';
    }
    t.prop?.setActivated(true);
    ctx.bus.emit('tower:activated', { id: t.def.id });
    this.startScan(ctx, t);
  }

  /** Escaneo: inicio → expansión → escaneo total → revelación → mapa actualizado. */
  private startScan(ctx: GameContext, t: TowerRt): void {
    t.activated = true;
    t.discovered = true;
    this.scan = { tower: t, t: 0 };
    const cam = this.d.threeCamera.position.clone();
    const top = t.top;
    const crystal = top.clone().add(new THREE.Vector3(0, 7, 0));
    const r = t.def.revealRadius;
    const high = top.clone().add(new THREE.Vector3(-r * 0.12, 70, -r * 0.12));
    const wide = top.clone().add(new THREE.Vector3(r * 0.16, 110, r * 0.1));
    const back = top.clone().add(new THREE.Vector3(6, 3.5, 6));
    const s = this.d.towers.scan.seconds;
    this.d.camera.playCinematic(ctx, `scan:${t.def.id}`, [
      { from: cam, to: top.clone().add(new THREE.Vector3(10, 6, 10)), lookFrom: top, lookTo: crystal, seconds: s * 0.18, fov: 55 },
      { from: top.clone().add(new THREE.Vector3(10, 6, 10)), to: high, lookFrom: crystal, lookTo: new THREE.Vector3(t.x + r * 0.3, t.y, t.z + r * 0.3), seconds: s * 0.36, fov: 62 },
      { from: high, to: wide, lookFrom: new THREE.Vector3(t.x + r * 0.3, t.y, t.z + r * 0.3), lookTo: new THREE.Vector3(t.x - r * 0.3, t.y, t.z - r * 0.2), seconds: s * 0.32, fov: 66 },
      { from: wide, to: back, lookFrom: new THREE.Vector3(t.x - r * 0.3, t.y, t.z - r * 0.2), lookTo: top, seconds: s * 0.14, fov: 55 },
    ]);
    ctx.bus.emit('tower:scan', { id: t.def.id, phase: 'start' });
  }

  private stepScan(ctx: GameContext, dt: number): void {
    const sc = this.scan;
    if (!sc) return;
    sc.t += dt;
    const s = this.d.towers.scan.seconds;
    const t = sc.tower;
    // Revelado orgánico al ritmo de las ondas.
    const k = Math.min(1, Math.max(0, (sc.t - s * 0.15) / (s * 0.7)));
    this.fog.revealOrganic(t.x, t.z, t.def.revealRadius, seedOf(t.def.id), k);
    if (sc.t >= s + 0.3) {
      this.scan = null;
      this.fog.revealOrganic(t.x, t.z, t.def.revealRadius, seedOf(t.def.id), 1);
      ctx.bus.emit('tower:scan', { id: t.def.id, phase: 'end' });
      ctx.bus.emit('hud:note', { text: `${t.def.name}: mapa actualizado. Salta y planea hacia tu próximo destino`, tone: 'good' });
      this.d.openMap({ x: t.x, z: t.z, radius: t.def.revealRadius });
    }
  }

  // ------------------------------------------------------------------ puntos de interés y marcadores

  addPoi(p: Poi): void {
    this.pois.push(p);
  }

  /** Visible en el mapa: descubierto por la niebla o por el haz de la torre. */
  poiVisible(p: Poi): boolean {
    return (p.alwaysVisible?.() ?? false) || this.fog.at(p.x, p.z) > 0.5;
  }

  /** Capa en la que está un punto: bajo tierra, en el cielo (muy por encima del suelo) o superficie. */
  layerOf(x: number, y: number, z: number): MapLayer {
    const ground = this.d.terrain.height(x, z);
    if (y < ground - 6) return 'underground';
    if (y > 220 && y - ground > 100) return 'sky';
    return 'surface';
  }

  regionAt(x: number, z: number, layer: MapLayer): string | null {
    for (const r of this.d.regions.regions) {
      const [x0, z0, x1, z1] = r.bounds;
      if (r.layer === layer && x >= x0 && x <= x1 && z >= z0 && z <= z1) return r.name;
    }
    return null;
  }

  addMarker(x: number, z: number): MapMarker | null {
    if (this.markers.length >= MAX_MARKERS) return null;
    const color = MARKER_COLORS[this.markerColor++ % MARKER_COLORS.length];
    const m: MapMarker = { x, z, color, compass: { x, z, color } };
    this.markers.push(m);
    this.d.compass.add(m.compass);
    return m;
  }

  removeMarker(m: MapMarker): void {
    const i = this.markers.indexOf(m);
    if (i < 0) return;
    this.d.compass.remove(m.compass);
    this.markers.splice(i, 1);
  }

  /** Viaje rápido (no en combate). Devuelve el motivo si no se puede. */
  travel(ctx: GameContext, p: Poi): string | null {
    if (!p.travel || !(p.unlocked?.() ?? false)) return 'Aún no puedes viajar aquí';
    if (this.d.inCombat()) return 'No puedes viajar en pleno combate';
    if (this.travelT >= 0 || this.scan) return 'Espera un momento';
    this.travelTo = p;
    this.travelT = 0;
    ctx.bus.emit('screen:fade', { to: 'black', seconds: 0.45, text: p.name });
    return null;
  }

  // ------------------------------------------------------------------ paso

  fixedUpdate(ctx: GameContext, dt: number): void {
    // La imagen del mapa se genera en segundo plano (también en el título).
    this.image.step(4);
    if (ctx.session.mode !== 'play') return;
    const ch = ctx.world.require(this.d.playerEntity, 'character');
    // El jugador revela lo que tiene alrededor (más cuanto más alto vuela).
    this.revealT -= dt;
    if (this.revealT <= 0) {
      this.revealT = 0.4;
      const f = this.d.towers.fog;
      const above = Math.max(0, ch.y - this.d.terrain.height(ch.x, ch.z));
      this.fog.revealCircle(ch.x, ch.z, Math.min(f.maxPlayerRadius, f.playerRadius + above * f.heightBonus));
      // Torres a la vista por su haz: aparecen en el mapa y en la brújula.
      for (const t of this.towers) {
        if (t.discovered || Math.hypot(t.x - ch.x, t.z - ch.z) > f.discoverDistance) continue;
        t.discovered = true;
        ctx.bus.emit('tower:discovered', { id: t.def.id });
      }
      for (const t of this.towers) {
        const want = t.discovered && !t.activated;
        if (want && !t.compass) {
          t.compass = { x: t.x, z: t.z, color: '#1fd6ff' };
          this.d.compass.add(t.compass);
        } else if (!want && t.compass) {
          this.d.compass.remove(t.compass);
          t.compass = null;
        }
      }
    }
    this.stepScan(ctx, dt);
    if (this.travelT >= 0) {
      this.travelT += dt;
      if (this.travelT >= 0.5 && this.travelTo?.travel) {
        const tr = this.travelTo.travel;
        this.d.player.placeFree(ctx, tr.x, tr.y, tr.z, tr.yaw);
        ctx.bus.emit('player:traveled', { id: this.travelTo.id });
        ctx.bus.emit('screen:fade', { to: 'clear', seconds: 0.6 });
        this.travelT = -1;
        this.travelTo = null;
      }
    }
  }

  render(ctx: GameContext): void {
    const t = ctx.time.elapsed;
    for (const tw of this.towers) tw.prop?.update?.(t, ctx.time.frameDt);
    const sc = this.scan;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      if (!sc) {
        w.visible = false;
        continue;
      }
      const s = this.d.towers.scan.seconds;
      const k = (sc.t - s * 0.15 - i * 0.55) / (s * 0.7);
      w.visible = k > 0 && k < 1;
      if (!w.visible) continue;
      const r = 8 + k * sc.tower.def.revealRadius;
      w.position.set(sc.tower.x, sc.tower.y, sc.tower.z);
      w.scale.set(r, 1 + k * 0.6, r);
      (w.material as THREE.ShaderMaterial).uniforms.uAlpha.value = (1 - k) * 0.9;
    }
  }

  // ------------------------------------------------------------------ guardado

  save(): { towers: string[]; fog: string; markers: { x: number; z: number; color: string }[]; temples: string[] } {
    return {
      towers: this.towers.filter((t) => t.activated).map((t) => t.def.id),
      fog: this.fog.serialize(),
      markers: this.markers.map((m) => ({ x: m.x, z: m.z, color: m.color })),
      temples: [...this.visitedTemples],
    };
  }

  restore(ctx: GameContext, data: { towers: string[]; fog: string; markers: { x: number; z: number; color: string }[]; temples: string[] } | null, valleyActivated: boolean): void {
    for (const m of [...this.markers]) this.removeMarker(m);
    this.visitedTemples.clear();
    this.fog.restore(data?.fog ?? '');
    const active = new Set(data?.towers ?? []);
    for (const t of this.towers) {
      t.activated = active.has(t.def.id) || (t.def.builtin === true && valleyActivated);
      t.discovered = t.activated;
      t.prop?.setActivated(t.activated);
      const e = [...ctx.world.query('interactable')].find((x) => ctx.world.require(x, 'interactable').id === t.def.id);
      if (e !== undefined && !t.def.builtin) {
        const it = ctx.world.require(e, 'interactable');
        it.enabled = !t.activated;
        it.prompt = t.activated ? 'Torre activada' : 'Activar torre';
      }
      // Partidas sin niebla guardada: las torres activas revelan su zona.
      if (t.activated) this.fog.revealOrganic(t.x, t.z, t.def.revealRadius, seedOf(t.def.id), 1);
    }
    for (const m of data?.markers ?? []) {
      const mk = this.addMarker(m.x, m.z);
      if (mk) {
        mk.color = m.color;
        mk.compass.color = m.color;
      }
    }
    for (const id of data?.temples ?? []) this.visitedTemples.add(id);
  }
}
