/**
 * 殿堂入りの記念写真（賞状風）を描く。
 *
 * 1080x1080 の JPEG にするための Canvas を組み立てる。3Dは使わず、
 * 2Dのオエカキをそのまま貼り、戦闘画面と同じ配色の背景と金の縁取りを添える。
 */

import { PaintEngine } from '../paint/PaintEngine';
import { contentBoundsOf } from '../paint/thumbnail';
import type { CharacterDoc } from '../paint/types';

/** 出力する写真の一辺（px） */
export const PHOTO_SIZE = 1080;

const FONT_STACK =
  '"Hiragino Maru Gothic ProN", "ヒラギノ丸ゴ ProN", "M PLUS Rounded 1c", system-ui, sans-serif';

/** 戦闘画面と同じ配色 */
const SKY_TOP = '#bfe9ff';
const SKY_BOTTOM = '#e8f7d4';
const GROUND = '#c6e3a0';
/** 地平線の位置（上から何割か） */
const HORIZON = 0.72;

const GOLD_DARK = '#b8901c';
const GOLD_MID = '#f6e27a';
const GOLD_LIGHT = '#fff6c8';
const INK = '#4a3b12';

export interface CertificateOptions {
  doc: CharacterDoc;
  /** キャラクターの名前。空なら既定名を呼び出し側で入れておく */
  name: string;
  /** 撮影日。省略時は今日 */
  date?: Date;
  size?: number;
}

/** 「2026ねん 8がつ 25にち」 */
export function formatDate(date: Date): string {
  return `${date.getFullYear()}ねん ${date.getMonth() + 1}がつ ${date.getDate()}にち`;
}

/** 金色の縦グラデーション */
function goldGradient(ctx: CanvasRenderingContext2D, top: number, bottom: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, GOLD_LIGHT);
  gradient.addColorStop(0.45, GOLD_MID);
  gradient.addColorStop(0.55, GOLD_DARK);
  gradient.addColorStop(1, GOLD_MID);
  return gradient;
}

/** 縁取りつきの中央寄せテキスト。はみ出すときは自動で縮める */
function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  baselineY: number,
  fontSize: number,
  maxWidth: number,
  fill: string | CanvasGradient,
  strokeColor: string,
  strokeWidth: number,
): void {
  let size = fontSize;
  ctx.font = `900 ${size}px ${FONT_STACK}`;
  while (ctx.measureText(text).width > maxWidth && size > 16) {
    size -= 2;
    ctx.font = `900 ${size}px ${FONT_STACK}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = strokeColor;
  ctx.strokeText(text, centerX, baselineY);
  ctx.fillStyle = fill;
  ctx.fillText(text, centerX, baselineY);
}

/** 四すみのロココ風の飾り。原点を角に置き、内側へ伸びるように描く */
function drawCornerOrnament(ctx: CanvasRenderingContext2D, length: number): void {
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';

  // 斜めの線
  ctx.beginPath();
  ctx.moveTo(0, length);
  ctx.lineTo(length, 0);
  ctx.stroke();

  // 内側に短い平行線
  ctx.beginPath();
  ctx.moveTo(0, length * 0.55);
  ctx.lineTo(length * 0.55, 0);
  ctx.stroke();

  // 角の菱形
  const d = length * 0.2;
  ctx.beginPath();
  ctx.moveTo(length * 0.62, length * 0.62 - d);
  ctx.lineTo(length * 0.62 + d, length * 0.62);
  ctx.lineTo(length * 0.62, length * 0.62 + d);
  ctx.lineTo(length * 0.62 - d, length * 0.62);
  ctx.closePath();
  ctx.fillStyle = GOLD_MID;
  ctx.fill();
  ctx.stroke();
}

/** 賞状らしい金の二重罫と四すみ飾り */
function drawBorder(ctx: CanvasRenderingContext2D, size: number): void {
  const outer = size * 0.024;
  const thick = size * 0.02;

  // 太い外罫
  ctx.strokeStyle = goldGradient(ctx, outer, size - outer);
  ctx.lineWidth = thick;
  ctx.strokeRect(outer + thick / 2, outer + thick / 2, size - (outer + thick / 2) * 2, size - (outer + thick / 2) * 2);

  // 細い内罫
  const inner = outer + thick + size * 0.012;
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = size * 0.0037;
  ctx.strokeRect(inner, inner, size - inner * 2, size - inner * 2);

  // 四すみ
  const ornament = size * 0.055;
  const pad = inner + size * 0.012;
  const corners: [number, number, number][] = [
    [pad, pad, 0],
    [size - pad, pad, 90],
    [size - pad, size - pad, 180],
    [pad, size - pad, 270],
  ];
  for (const [x, y, deg] of corners) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((deg * Math.PI) / 180);
    drawCornerOrnament(ctx, ornament);
    ctx.restore();
  }
}

/**
 * 記念写真を描いて Canvas を返す。
 * 中で PaintEngine（約20MB）を起こすので、描き終わったら必ず解放する。
 */
export function renderCertificate(options: CertificateOptions): HTMLCanvasElement {
  const size = options.size ?? PHOTO_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const horizonY = size * HORIZON;

  // --- 1. 背景（戦闘画面と同じ配色） ---
  const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_BOTTOM);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, size, horizonY);
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, horizonY, size, size - horizonY);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, horizonY - 2, size, 4);

  // --- 2. 後光 ---
  const halo = ctx.createRadialGradient(size / 2, size * 0.44, 0, size / 2, size * 0.44, size * 0.5);
  halo.addColorStop(0, 'rgba(255,255,255,0.5)');
  halo.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // --- 3〜4. キャラクターと影 ---
  const engine = new PaintEngine(structuredClone(options.doc));
  try {
    const bounds = contentBoundsOf(engine);
    if (bounds) {
      const maxHeight = size * 0.46;
      const maxWidth = size * 0.62;
      const scale = Math.min(maxHeight / bounds.height, maxWidth / bounds.width);
      const drawWidth = bounds.width * scale;
      const drawHeight = bounds.height * scale;
      const feetY = size * 0.765;
      const left = size / 2 - drawWidth / 2;
      const top = feetY - drawHeight;

      // 足元の影
      const shadowR = Math.max(drawWidth * 0.42, 40);
      const shadow = ctx.createRadialGradient(size / 2, feetY, 0, size / 2, feetY, shadowR);
      shadow.addColorStop(0, 'rgba(60,70,40,0.38)');
      shadow.addColorStop(1, 'rgba(60,70,40,0)');
      ctx.save();
      ctx.translate(size / 2, feetY);
      ctx.scale(1, 0.26);
      ctx.translate(-size / 2, -feetY);
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.arc(size / 2, feetY, shadowR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.drawImage(
        engine.compositeCanvas(),
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        left,
        top,
        drawWidth,
        drawHeight,
      );
    }
  } finally {
    // 1024x1024 のレイヤーを5枚持っているので必ず手放す
    engine.release();
  }

  // --- 5. 見出し ---
  ctx.save();
  ctx.font = `${size * 0.085}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('👑', size / 2, size * 0.125);
  drawFittedText(
    ctx,
    'でんどういり',
    size / 2,
    size * 0.225,
    size * 0.098,
    size * 0.74,
    goldGradient(ctx, size * 0.14, size * 0.23),
    INK,
    size * 0.011,
  );
  ctx.restore();

  // --- 6. 名前 ---
  ctx.save();
  drawFittedText(
    ctx,
    options.name,
    size / 2,
    size * 0.858,
    size * 0.072,
    size * 0.72,
    '#ffffff',
    INK,
    size * 0.009,
  );
  ctx.restore();

  // --- 7. 日付 ---
  ctx.save();
  ctx.font = `800 ${size * 0.03}px ${FONT_STACK}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  // 縁の内罫（約 0.944）と四すみ飾り（約 0.877 より外）にかからない位置に置く
  ctx.fillText(formatDate(options.date ?? new Date()), size * 0.855, size * 0.918);
  ctx.restore();

  // --- 8. 縁取り ---
  drawBorder(ctx, size);

  return canvas;
}
