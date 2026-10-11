import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data';
import { desiredChunks, distanceToChunk } from '../src/world/terrain/chunks';
import { TerrainGenerator } from '../src/world/terrain/TerrainGenerator';

const data = loadGameData();
const terrain = new TerrainGenerator(data.terrain);
const v = data.terrain.valley;

describe('TerrainGenerator', () => {
  it('es determinista por semilla', () => {
    const other = new TerrainGenerator(data.terrain);
    for (const [x, z] of [[0, 0], [1234, -987], [-3000, 2500]]) expect(other.rawHeight(x, z)).toBe(terrain.rawHeight(x, z));
    const reseeded = new TerrainGenerator({ ...data.terrain, seed: data.terrain.seed + 1 });
    expect(reseeded.rawHeight(1500, 1500)).not.toBe(terrain.rawHeight(1500, 1500));
  });

  it('el suelo del valle es llano y está rodeado de muros altos', () => {
    for (const [x, z] of [[-120, -110], [0, 60], [100, 100]]) {
      expect(Math.abs(terrain.rawHeight(x, z) - v.floorHeight)).toBeLessThan(3);
    }
    for (const [x, z] of [[0, -230], [230, 0], [-230, 0]]) {
      expect(terrain.rawHeight(x, z)).toBeGreaterThan(v.floorHeight + 50);
    }
  });

  it('los muros del valle no son transitables (pendiente > máxima)', () => {
    const maxSlopeCos = Math.cos((data.player.movement.maxSlopeDeg * Math.PI) / 180);
    let steep = 0;
    for (let d = v.innerRadius + 5; d < v.wallRadius - 3; d += 2) if (terrain.normal(0, -d).y < maxSlopeCos) steep++;
    expect(steep).toBeGreaterThan(5);
  });

  it('el corredor sur está abierto hasta un acantilado sobre las llanuras', () => {
    expect(Math.abs(terrain.rawHeight(0, 230) - v.floorHeight)).toBeLessThan(3);
    expect(terrain.rawHeight(0, 300)).toBeLessThan(v.floorHeight - 20);
    expect(terrain.rawHeight(30, 230)).toBeGreaterThan(v.floorHeight + 40); // paredes del corredor
  });

  it('el río y los lagos tienen agua por encima del lecho', () => {
    const river = data.terrain.rivers[0];
    const [x, z] = river.points[3];
    expect(terrain.rawHeight(x, z)).toBeLessThan(river.waterLevel);
    expect(terrain.waterLevelAt(x, z)).toBe(river.waterLevel);
    for (const lake of data.terrain.lakes) expect(terrain.rawHeight(lake.center[0], lake.center[1])).toBeLessThan(lake.waterLevel);
  });

  it('height() coincide con la malla en los vértices de la rejilla', () => {
    const g = data.terrain.physicsGrid;
    for (const [x, z] of [[10, 10], [-120, -110], [44, 98]]) {
      expect(terrain.height(x, z)).toBeCloseTo(terrain.rawHeight(Math.round(x / g) * g, Math.round(z / g) * g), 4);
    }
  });

  it('el mar rodea el continente', () => {
    expect(terrain.rawHeight(0, 4100)).toBeLessThan(data.terrain.seaLevel);
    expect(terrain.rawHeight(-4100, 0)).toBeLessThan(data.terrain.seaLevel);
  });

  it('montañas al norte más altas que las llanuras', () => {
    let maxN = 0;
    for (let x = -1000; x <= 1000; x += 100) maxN = Math.max(maxN, terrain.rawHeight(x, -2600));
    expect(maxN).toBeGreaterThan(250);
  });
});

describe('streaming de chunks', () => {
  const cfg = data.terrain.chunk;
  it('el chunk del foco es LOD0 y nada supera la distancia máxima', () => {
    const list = desiredChunks(10, 10, 0, 0, cfg, data.terrain.worldSize);
    const own = list.find((c) => c.cx === 0 && c.cz === 0);
    expect(own?.lod).toBe(0);
    expect(list.every((c) => c.distance <= cfg.lodDistances[2])).toBe(true);
    expect(list[0].distance).toBe(0);
  });

  it('prioriza los chunks en la dirección de movimiento', () => {
    const still = desiredChunks(0, 0, 0, 0, cfg, data.terrain.worldSize);
    const flying = desiredChunks(0, 0, 25, 0, cfg, data.terrain.worldSize);
    const rank = (list: typeof still, cx: number) => list.findIndex((c) => c.cx === cx && c.cz === 0);
    expect(rank(flying, 2)).toBeLessThan(rank(still, 2));
    expect(rank(flying, 2)).toBeLessThan(rank(flying, -3));
  });

  it('distanceToChunk es 0 dentro del chunk', () => {
    expect(distanceToChunk(64, 64, 0, 0, 128)).toBe(0);
    expect(distanceToChunk(-10, 64, 0, 0, 128)).toBe(10);
  });
});

describe('materiales y corrientes', () => {
  it('los muros del valle no son escalables; la roca exterior sí', () => {
    expect(terrain.materialAt(0, -200, 0.3)).toBe('valley_wall');
    expect(terrain.materialAt(0, 2600, 0.3)).toBe('rock');
    expect(terrain.materialAt(2600, 0, 0.3)).toBe('sand');
  });

  it('el río empuja aguas abajo', () => {
    const r = data.terrain.rivers[0];
    const [a, b] = [r.points[2], r.points[3]];
    const c = terrain.waterCurrentAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    expect(c.x * (b[0] - a[0]) + c.z * (b[1] - a[1])).toBeGreaterThan(0);
  });
});
