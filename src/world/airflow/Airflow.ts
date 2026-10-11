import { smoothstep } from '../../core/math';
import type { AirflowConfig } from '../../data/schemas';

export interface AirSample {
  /** Viento horizontal (m/s). */
  windX: number;
  windZ: number;
  /** Velocidad ascendente de una corriente térmica (m/s), 0 si no hay. */
  lift: number;
  /** Impulso vertical al saltar dentro (chimeneas ancestrales), 0 si no hay. */
  launch: number;
  thermalId: string | null;
}

export function emptyAir(): AirSample {
  return { windX: 0, windZ: 0, lift: 0, launch: 0, thermalId: null };
}

interface Thermal {
  def: AirflowConfig['thermals'][number];
  baseY: number;
}

/**
 * Campo de aire del mundo: viento global + zonas de viento + corrientes térmicas.
 * Lógica pura (la Fase 5 hará el viento dinámico con el clima).
 */
export class Airflow {
  private readonly thermals: Thermal[];
  private readonly gx: number;
  private readonly gz: number;

  constructor(
    private readonly cfg: AirflowConfig,
    terrainHeight: (x: number, z: number) => number,
  ) {
    this.thermals = cfg.thermals.map((def) => ({ def, baseY: terrainHeight(def.position[0], def.position[1]) }));
    const [dx, dz] = cfg.globalWind.direction;
    const l = Math.hypot(dx, dz) || 1;
    this.gx = (dx / l) * cfg.globalWind.strength;
    this.gz = (dz / l) * cfg.globalWind.strength;
  }

  get thermalList(): ReadonlyArray<{ id: string; kind: string; x: number; z: number; baseY: number; radius: number; height: number }> {
    return this.thermals.map((t) => ({ id: t.def.id, kind: t.def.kind, x: t.def.position[0], z: t.def.position[1], baseY: t.baseY, radius: t.def.radius, height: t.def.height }));
  }

  sample(x: number, y: number, z: number, out: AirSample = emptyAir()): AirSample {
    out.windX = this.gx;
    out.windZ = this.gz;
    out.lift = 0;
    out.launch = 0;
    out.thermalId = null;
    for (const w of this.cfg.windZones) {
      const d = Math.hypot(x - w.center[0], z - w.center[1]);
      if (d >= w.radius || y > w.maxHeight) continue;
      const k = 1 - smoothstep(w.radius * 0.6, w.radius, d);
      const l = Math.hypot(w.direction[0], w.direction[1]) || 1;
      out.windX += (w.direction[0] / l) * w.strength * k;
      out.windZ += (w.direction[1] / l) * w.strength * k;
    }
    for (const t of this.thermals) {
      const d = Math.hypot(x - t.def.position[0], z - t.def.position[1]);
      const rel = y - t.baseY;
      if (d >= t.def.radius || rel < -1 || rel > t.def.height) continue;
      // La corriente se debilita cerca del techo: el planeador "flota" arriba en lugar de salir disparado.
      const lift = t.def.lift * (1 - smoothstep(t.def.height * 0.75, t.def.height, rel));
      if (lift > out.lift) {
        out.lift = lift;
        out.thermalId = t.def.id;
        out.launch = rel < 3 ? t.def.launch : 0;
      }
    }
    return out;
  }
}
