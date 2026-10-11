import * as THREE from 'three';
import type { TerrainConfig } from '../../data/schemas';
import type { TerrainGenerator } from './TerrainGenerator';

/**
 * "Impostor" del continente entero: una malla única de baja resolución que se ve
 * más allá del radio de streaming. Dentro del radio cubierto por chunks se descarta
 * en el fragment shader, para que no se solape con el terreno detallado.
 */
export class FarTerrain {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uCenter: { value: new THREE.Vector2(1e9, 1e9) },
    uRadius: { value: 0 },
  };

  constructor(terrain: TerrainGenerator, cfg: TerrainConfig) {
    const { resolution, extent, drop } = cfg.far;
    const n = Math.round(extent / resolution) + 1;
    const half = extent / 2;
    const pos = new Float32Array(n * n * 3);
    const nor = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const hs = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) hs[j * n + i] = terrain.rawHeight(-half + i * resolution, -half + j * resolution);
    }
    const H = (i: number, j: number) => hs[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = j * n + i;
        const x = -half + i * resolution;
        const z = -half + j * resolution;
        const h = H(i, j);
        pos.set([x, h - drop, z], v * 3);
        const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * resolution);
        const dz = (H(i, j + 1) - H(i, j - 1)) / (2 * resolution);
        const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
        nor.set([-dx * inv, inv, -dz * inv], v * 3);
        terrain.surfaceColor(x, z, h, inv, col, v * 3);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec2 vFarXZ;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFarXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        'varying vec2 vFarXZ;\nuniform vec2 uCenter;\nuniform float uRadius;\nvoid main() {\n  if (distance(vFarXZ, uCenter) < uRadius) discard;',
      );
    };
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'far-terrain';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.receiveShadow = false;
    // El terreno lejano se dibuja después del cercano: lo que tapan los chunks se descarta por profundidad.
    this.mesh.renderOrder = 1;
  }

  /** Oculta la zona ya cubierta por chunks detallados. */
  setCoverage(x: number, z: number, radius: number): void {
    if (Number.isNaN(x)) return;
    this.uniforms.uCenter.value.set(x, z);
    this.uniforms.uRadius.value = radius;
  }
}
