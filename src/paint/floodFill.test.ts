import { describe, expect, it } from 'vitest';
import { computeFillMask, dilateFringe, isFillTooLarge } from './floodFill';

const WIDTH = 10;
const HEIGHT = 10;

/** 線の位置を関数で指定して RGBA バッファを作る */
function makeData(alphaAt: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const index = (y * WIDTH + x) * 4;
      const alpha = alphaAt(x, y);
      data[index] = 20;
      data[index + 1] = 20;
      data[index + 2] = 20;
      data[index + 3] = alpha;
    }
  }
  return data;
}

/** (2,2)-(7,7) の四角い枠線 */
const boxOutline = (x: number, y: number): number => {
  const onBorder =
    (x >= 2 && x <= 7 && (y === 2 || y === 7)) || (y >= 2 && y <= 7 && (x === 2 || x === 7));
  return onBorder ? 255 : 0;
};

describe('computeFillMask', () => {
  it('囲まれた内側だけを塗る', () => {
    const data = makeData(boxOutline);
    const result = computeFillMask(data, WIDTH, HEIGHT, 5, 5);

    expect(result).not.toBeNull();
    expect(result?.seedOpaque).toBe(false);
    // 内側は 3..6 の 4x4
    expect(result?.count).toBe(16);
    expect(result?.mask[5 * WIDTH + 5]).toBe(1);
    // 線の上と外側は塗らない
    expect(result?.mask[2 * WIDTH + 2]).toBe(0);
    expect(result?.mask[0]).toBe(0);
  });

  it('線の外側をタップすると外側が全部つながって塗られる', () => {
    const data = makeData(boxOutline);
    const result = computeFillMask(data, WIDTH, HEIGHT, 0, 0);

    // 100 - 内側16 - 枠線20 = 64
    expect(result?.count).toBe(64);
    expect(result?.mask[5 * WIDTH + 5]).toBe(0);
  });

  it('線の上をタップすると同じ色の線をたどって塗り直せる', () => {
    const data = makeData(boxOutline);
    const result = computeFillMask(data, WIDTH, HEIGHT, 2, 2);

    expect(result?.seedOpaque).toBe(true);
    // 6x6 の枠線 = 20px
    expect(result?.count).toBe(20);
  });

  it('キャンバスの外を指定したら null', () => {
    const data = makeData(boxOutline);
    expect(computeFillMask(data, WIDTH, HEIGHT, -1, 5)).toBeNull();
    expect(computeFillMask(data, WIDTH, HEIGHT, 5, HEIGHT)).toBeNull();
  });

  it('すきまがあると外へ漏れる（囲めていないことが検出できる）', () => {
    // 枠線の一部を消して穴を開ける
    const data = makeData((x, y) => (x === 5 && y === 7 ? 0 : boxOutline(x, y)));
    const result = computeFillMask(data, WIDTH, HEIGHT, 5, 5);
    expect(result?.count).toBeGreaterThan(16);
  });
});

describe('isFillTooLarge（囲われていない場所を塗ろうとした場合の拒否）', () => {
  it('キャンバスの60%を超える塗りは大きすぎると判定する', () => {
    expect(isFillTooLarge(64, WIDTH, HEIGHT)).toBe(true);
    expect(isFillTooLarge(16, WIDTH, HEIGHT)).toBe(false);
    expect(isFillTooLarge(60, WIDTH, HEIGHT)).toBe(false);
  });
});

describe('dilateFringe（アンチエイリアスの縁を埋める）', () => {
  it('くっきりした線しかないときは何も広げない', () => {
    const data = makeData(boxOutline);
    const result = computeFillMask(data, WIDTH, HEIGHT, 5, 5);
    expect(result).not.toBeNull();
    if (!result) return;

    const added = dilateFringe(result.mask, data, WIDTH, HEIGHT);
    expect(added).toBe(0);
  });

  it('半透明の縁は塗りに取り込む', () => {
    // (3,3) の左どなり (2,3) を半透明にする
    const data = makeData((x, y) => (x === 2 && y === 3 ? 200 : boxOutline(x, y)));
    const result = computeFillMask(data, WIDTH, HEIGHT, 5, 5);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.mask[3 * WIDTH + 2]).toBe(0);
    const added = dilateFringe(result.mask, data, WIDTH, HEIGHT);
    expect(added).toBe(1);
    expect(result.mask[3 * WIDTH + 2]).toBe(1);
  });
});
