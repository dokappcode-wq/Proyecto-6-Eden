import * as THREE from 'three';
import type { GameConfig, WorldConfig } from '../data/schemas';

/** Dueño del WebGLRenderer, la escena y la cámara. Los sistemas añaden objetos a `scene`. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly onResize = () => this.resize();

  constructor(
    private readonly container: HTMLElement,
    config: GameConfig,
  ) {
    const r = config.render;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, r.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = r.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(r.clearColor);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(r.clearColor);
    this.scene.fog = new THREE.Fog(r.fogColor, r.fogNear, r.fogFar);

    const c = config.camera;
    this.camera = new THREE.PerspectiveCamera(c.fov, 1, c.near, c.far);
    this.camera.position.set(c.position[0], c.position[1], c.position[2]);
    this.camera.lookAt(c.lookAt[0], c.lookAt[1], c.lookAt[2]);

    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  /** Luces y suelo base definidos en world.json. */
  buildEnvironment(world: WorldConfig): void {
    const hemi = new THREE.HemisphereLight(world.ambient.skyColor, world.ambient.groundColor, world.ambient.intensity);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(world.sun.color, world.sun.intensity);
    const dir = new THREE.Vector3(...world.sun.direction).normalize();
    sun.position.copy(dir.multiplyScalar(-60));
    sun.castShadow = this.renderer.shadowMap.enabled;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 30;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 200 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(world.ground.size, world.ground.size),
      new THREE.MeshStandardMaterial({ color: world.ground.color, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);
  }

  draw(): void {
    this.renderer.render(this.scene, this.camera);
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  get triangles(): number {
    return this.renderer.info.render.triangles;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
