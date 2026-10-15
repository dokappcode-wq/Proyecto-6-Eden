import type { ElementsConfig } from '../../data/schemas';

export interface IcePlatform {
  id: number;
  x: number;
  /** Nivel del agua sobre el que flota. */
  y: number;
  z: number;
  radius: number;
  /** Segundos de vida restantes. */
  life: number;
}

/**
 * Plataformas de hielo creadas al congelar agua (flecha o bastón de hielo):
 * se puede caminar sobre ellas, se derriten con el tiempo y mucho antes cerca del fuego.
 * Lógica pura: los colisionadores y el aspecto los gestiona el sistema.
 */
export class IceField {
  readonly platforms: IcePlatform[] = [];
  private nextId = 1;

  constructor(private readonly cfg: ElementsConfig['ice']) {}

  /** Congela el agua en (x,z). Si ya hay hielo muy cerca, lo renueva en lugar de duplicarlo. */
  freeze(x: number, z: number, waterY: number, radius = this.cfg.platformRadius): IcePlatform {
    for (const p of this.platforms) {
      if (Math.hypot(p.x - x, p.z - z) < p.radius * 0.6) {
        p.life = this.cfg.meltSeconds;
        return p;
      }
    }
    const p: IcePlatform = { id: this.nextId++, x, y: waterY, z, radius, life: this.cfg.meltSeconds };
    this.platforms.push(p);
    return p;
  }

  /** Avanza el deshielo; `heatAt` > 0 acelera (fuego cerca). Devuelve las que se han derretido. */
  step(dt: number, heatAt: (x: number, z: number) => number): IcePlatform[] {
    const gone: IcePlatform[] = [];
    for (let i = this.platforms.length - 1; i >= 0; i--) {
      const p = this.platforms[i];
      p.life -= dt * (1 + heatAt(p.x, p.z) * 12);
      if (p.life <= 0) {
        gone.push(p);
        this.platforms.splice(i, 1);
      }
    }
    return gone;
  }

  /** Derrite el hielo en un radio (fuego directo). */
  melt(x: number, z: number, radius: number): void {
    for (const p of this.platforms) if (Math.hypot(p.x - x, p.z - z) < radius + p.radius) p.life = Math.min(p.life, 0.6);
  }
}
