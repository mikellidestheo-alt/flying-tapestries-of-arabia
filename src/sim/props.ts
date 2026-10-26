// Deterministic prop placement per chunk (palms near water, rock spires in the desert).
import { Prng, hashInts } from './prng';
import { baseHeight, oasisFactor, type TerrainParams } from './terrain';

export type PropKind = 'palm' | 'rock' | 'reed';

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  scale: number;
  rot: number;
}

export interface PropParams {
  candidatesPerChunk: number;
  palmChance: number;
  rockChance: number;
}

export function chunkProps(
  tp: TerrainParams,
  pp: PropParams,
  cx: number,
  cz: number,
  size: number,
): Prop[] {
  const rng = new Prng(hashInts(tp.seed, cx, cz, 0x70726f70));
  const out: Prop[] = [];
  for (let i = 0; i < pp.candidatesPerChunk; i++) {
    const x = (cx + rng.next()) * size;
    const z = (cz + rng.next()) * size;
    const roll = rng.next();
    const scale = rng.range(0.8, 1.35);
    const rot = rng.range(0, 6.2831853);
    const o = oasisFactor(tp, x, z);
    const h = baseHeight(tp, x, z);
    if (o > 0.12 && h > tp.waterLevel + 0.5) {
      if (roll < pp.palmChance + o * 0.4) out.push({ kind: 'palm', x, z, scale, rot });
    } else if (o <= 0.12 && roll < pp.rockChance) {
      out.push({ kind: 'rock', x, z, scale: scale * 1.2, rot });
    }
  }
  return out;
}
