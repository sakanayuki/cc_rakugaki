/**
 * 乱数。戦闘・ルーレットはRNGを注入可能にして、テストで結果を再現できるようにする。
 */

export interface RNG {
  /** [0, 1) の乱数 */
  next(): number;
}

/** シード固定の擬似乱数（mulberry32）。テスト用 */
export function seededRng(seed: number): RNG {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** 本番用 */
export const systemRng: RNG = {
  next: () => Math.random(),
};

/** min以上max未満の実数 */
export function randRange(rng: RNG, min: number, max: number): number {
  return min + rng.next() * (max - min);
}

/** 0以上n未満の整数 */
export function randInt(rng: RNG, n: number): number {
  return Math.min(n - 1, Math.floor(rng.next() * n));
}
