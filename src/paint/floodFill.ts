/**
 * 塗りつぶし（バケツツール）。
 * 境界判定は「全レイヤーを合成した画像」で行い、書き込みは現在のパーツレイヤーだけに行う。
 * これで「からだの輪郭を境界にして、うでレイヤーを塗る」が成立する。
 */

/** これ以上の不透明度を「線が引かれている」とみなす */
export const ALPHA_THRESHOLD = 128;
/** 同じ色とみなす許容差（R+G+Bの絶対差の合計） */
export const COLOR_TOLERANCE = 40;
/** アンチエイリアスの縁とみなす不透明度の上限（膨張処理の対象） */
export const FRINGE_ALPHA = 250;
/**
 * キャンバスのこの割合を超える塗りは「囲われていない場所を塗ろうとした」とみなして拒否する。
 * これがないと背景をタップしただけで画面全体が1色に染まり、キャラクターが巨大な四角になってしまう。
 */
export const MAX_FILL_RATIO = 0.6;

export interface FillMaskResult {
  /** 塗る対象のピクセル（1=塗る） */
  mask: Uint8Array;
  /** 塗るピクセル数 */
  count: number;
  /** 種にしたピクセルが「線の上」だったか（=塗り直し） */
  seedOpaque: boolean;
}

export interface FillOptions {
  /** 同じ色とみなす許容差 */
  tolerance?: number;
  /**
   * 塗ってはいけないピクセル（1=侵入禁止）。前工程で描いたパーツを渡す。
   * 「かべ」としては効くが「塗れる面」ではない、という扱いになる。
   */
  blocked?: Uint8Array | null;
}

/**
 * 塗りつぶし範囲を求める。
 * 種が透明なら「透明領域を線で囲まれた範囲まで」、
 * 種が線の上なら「同じ色の連続範囲」（塗り直し）を対象にする。
 */
export function computeFillMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  options: FillOptions = {},
): FillMaskResult | null {
  const tolerance = options.tolerance ?? COLOR_TOLERANCE;
  const blocked = options.blocked ?? null;
  const sx = Math.floor(seedX);
  const sy = Math.floor(seedY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;

  // 種が前工程のパーツの上なら、そこは塗れない
  if (blocked && blocked[sy * width + sx]) return null;

  const seedIndex = (sy * width + sx) * 4;
  const seedOpaque = data[seedIndex + 3] >= ALPHA_THRESHOLD;
  const seedR = data[seedIndex];
  const seedG = data[seedIndex + 1];
  const seedB = data[seedIndex + 2];

  const matches = (pixel: number): boolean => {
    if (blocked && blocked[pixel]) return false;
    const i = pixel * 4;
    const alpha = data[i + 3];
    if (!seedOpaque) return alpha < ALPHA_THRESHOLD;
    if (alpha < ALPHA_THRESHOLD) return false;
    return (
      Math.abs(data[i] - seedR) + Math.abs(data[i + 1] - seedG) + Math.abs(data[i + 2] - seedB) <=
      tolerance
    );
  };

  const mask = new Uint8Array(width * height);
  let count = 0;
  const stack: number[] = [sx, sy];

  while (stack.length > 0) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    const rowStart = y * width;
    if (mask[rowStart + x] || !matches(rowStart + x)) continue;

    let left = x;
    while (left > 0 && !mask[rowStart + left - 1] && matches(rowStart + left - 1)) left--;

    let spanAbove = false;
    let spanBelow = false;
    for (let cursor = left; cursor < width; cursor++) {
      const pixel = rowStart + cursor;
      if (mask[pixel] || !matches(pixel)) break;
      mask[pixel] = 1;
      count++;

      if (y > 0) {
        const up = pixel - width;
        const ok = !mask[up] && matches(up);
        if (ok && !spanAbove) {
          stack.push(cursor, y - 1);
          spanAbove = true;
        } else if (!ok) {
          spanAbove = false;
        }
      }
      if (y < height - 1) {
        const down = pixel + width;
        const ok = !mask[down] && matches(down);
        if (ok && !spanBelow) {
          stack.push(cursor, y + 1);
          spanBelow = true;
        } else if (!ok) {
          spanBelow = false;
        }
      }
    }
  }

  if (count === 0) return null;
  return { mask, count, seedOpaque };
}

/**
 * マスクを1px膨張させる。線のアンチエイリアス部分（半透明の縁）にだけ広げるので、
 * 線そのものの色は塗りつぶされず、塗り残しの白いスキマだけが消える。
 */
export function dilateFringe(
  mask: Uint8Array,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  blocked: Uint8Array | null = null,
): number {
  const added: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (mask[pixel] !== 1) continue;
      const neighbours = [
        x > 0 ? pixel - 1 : -1,
        x < width - 1 ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1,
        y < height - 1 ? pixel + width : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || mask[n]) continue;
        if (blocked && blocked[n]) continue;
        if (data[n * 4 + 3] < FRINGE_ALPHA) added.push(n);
      }
    }
  }
  for (const pixel of added) mask[pixel] = 1;
  return added.length;
}

/** 塗りつぶしが広すぎないか（＝囲われていない場所ではないか）を判定する */
export function isFillTooLarge(count: number, width: number, height: number): boolean {
  return count > width * height * MAX_FILL_RATIO;
}
