/**
 * 描かれた絵を解析して、リグ生成とステータス算出に必要な情報を取り出す。
 *
 * - パーツごとの外接矩形・面積・重心
 * - うで／あし は「からだの重心X」を境にして左右に分ける
 * - 片側しか描かれていない場合は、もう片方をミラー複製して補う（片うでしか描かない子ども対策）
 */

import { ALPHA_THRESHOLD } from '../paint/floodFill';
import { createCanvas, usedColorCount } from '../paint/PaintEngine';
import type { PaintEngine } from '../paint/PaintEngine';
import type { PartId } from '../paint/types';
import { CANVAS_SIZE } from '../paint/types';

export type BoneName = 'body' | 'head' | 'armL' | 'armR' | 'legL' | 'legR';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface PartAnalysis {
  bone: BoneName;
  /** bboxで切り抜いた画像。そのままテクスチャに使う */
  canvas: HTMLCanvasElement;
  bbox: BBox;
  area: number;
  centroid: { x: number; y: number };
  /** 反対側から複製したパーツか */
  mirrored: boolean;
}

export interface CharacterAnalysis {
  parts: Partial<Record<BoneName, PartAnalysis>>;
  /** からだの重心X。左右分割の境界であり、キャラクターの中心軸 */
  bodyCenterX: number;
  /** いちばん下の描画位置＝足元（3D空間の地面に合わせる） */
  groundY: number;
  colorCount: number;
  areas: Record<PartId, number>;
  headAspect: number;
  headDensity: number;
}

interface ScanResult {
  bbox: BBox | null;
  area: number;
  centroid: { x: number; y: number };
}

/** 一部分のピクセルを走査して bbox・面積・重心を求める */
function scanRegion(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  xFrom: number,
  xTo: number,
): ScanResult {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let area = 0;
  let sumX = 0;
  let sumY = 0;

  const from = Math.max(0, Math.floor(xFrom));
  const to = Math.min(width, Math.ceil(xTo));

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = from; x < to; x++) {
      if (data[(row + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      area++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (area === 0) {
    return { bbox: null, area: 0, centroid: { x: 0, y: 0 } };
  }
  return {
    bbox: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
    area,
    centroid: { x: sumX / area, y: sumY / area },
  };
}

/** bboxの矩形で切り抜く */
function cropTo(source: HTMLCanvasElement, bbox: BBox, mirror: boolean): HTMLCanvasElement {
  const canvas = createCanvas(Math.max(1, bbox.width), Math.max(1, bbox.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2Dコンテキストを取得できませんでした');
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(
    source,
    bbox.minX,
    bbox.minY,
    bbox.width,
    bbox.height,
    0,
    0,
    bbox.width,
    bbox.height,
  );
  return canvas;
}

/** 軸Xを中心に左右反転した bbox */
function mirrorBBox(bbox: BBox, axisX: number): BBox {
  const minX = 2 * axisX - bbox.maxX;
  const maxX = 2 * axisX - bbox.minX;
  return { ...bbox, minX, maxX, width: maxX - minX + 1 };
}

/** 片側が空とみなす面積の比率 */
const EMPTY_SIDE_RATIO = 0.05;

/**
 * 左右ペアのパーツ（うで・あし）を解析する。
 * 片側が空なら、もう片方をミラー複製する。
 */
function analyzePair(
  layer: HTMLCanvasElement,
  data: Uint8ClampedArray,
  splitX: number,
  leftBone: BoneName,
  rightBone: BoneName,
): PartAnalysis[] {
  const left = scanRegion(data, CANVAS_SIZE, CANVAS_SIZE, 0, splitX);
  const right = scanRegion(data, CANVAS_SIZE, CANVAS_SIZE, splitX, CANVAS_SIZE);
  const total = left.area + right.area;
  if (total === 0) return [];

  const leftEmpty = left.area < total * EMPTY_SIDE_RATIO;
  const rightEmpty = right.area < total * EMPTY_SIDE_RATIO;

  const build = (
    bone: BoneName,
    scan: ScanResult,
    source: ScanResult,
    mirrored: boolean,
  ): PartAnalysis | null => {
    if (!mirrored) {
      if (!scan.bbox) return null;
      return {
        bone,
        canvas: cropTo(layer, scan.bbox, false),
        bbox: scan.bbox,
        area: scan.area,
        centroid: scan.centroid,
        mirrored: false,
      };
    }
    if (!source.bbox) return null;
    const bbox = mirrorBBox(source.bbox, splitX);
    return {
      bone,
      canvas: cropTo(layer, source.bbox, true),
      bbox,
      area: source.area,
      centroid: { x: 2 * splitX - source.centroid.x, y: source.centroid.y },
      mirrored: true,
    };
  };

  const results: PartAnalysis[] = [];
  // 両側とも空のケースは total === 0 で除外済みなので、必ずどちらかは実体がある
  const leftPart = build(leftBone, left, right, leftEmpty && !rightEmpty);
  const rightPart = build(rightBone, right, left, rightEmpty && !leftEmpty);
  if (leftPart) results.push(leftPart);
  if (rightPart) results.push(rightPart);
  return results;
}

/** 単体パーツ（からだ・あたま）を解析する */
function analyzeSingle(
  layer: HTMLCanvasElement,
  data: Uint8ClampedArray,
  bone: BoneName,
): PartAnalysis | null {
  const scan = scanRegion(data, CANVAS_SIZE, CANVAS_SIZE, 0, CANVAS_SIZE);
  if (!scan.bbox) return null;
  return {
    bone,
    canvas: cropTo(layer, scan.bbox, false),
    bbox: scan.bbox,
    area: scan.area,
    centroid: scan.centroid,
    mirrored: false,
  };
}

function layerData(engine: PaintEngine, part: PartId): Uint8ClampedArray {
  const layer = engine.layerOf(part);
  const ctx = layer.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2Dコンテキストを取得できませんでした');
  return ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;
}

/** 描かれた絵を丸ごと解析する */
export function analyzeCharacter(engine: PaintEngine): CharacterAnalysis {
  const parts: Partial<Record<BoneName, PartAnalysis>> = {};

  const bodyData = layerData(engine, 'body');
  const headData = layerData(engine, 'head');
  const armsData = layerData(engine, 'arms');
  const legsData = layerData(engine, 'legs');

  const body = analyzeSingle(engine.layerOf('body'), bodyData, 'body');
  if (body) parts.body = body;
  const head = analyzeSingle(engine.layerOf('head'), headData, 'head');
  if (head) parts.head = head;

  // からだが無い（=まだ描かれていない）場合はキャンバス中央を中心軸として扱う
  const bodyCenterX = body ? body.centroid.x : CANVAS_SIZE / 2;

  for (const part of analyzePair(engine.layerOf('arms'), armsData, bodyCenterX, 'armL', 'armR')) {
    parts[part.bone] = part;
  }
  for (const part of analyzePair(engine.layerOf('legs'), legsData, bodyCenterX, 'legL', 'legR')) {
    parts[part.bone] = part;
  }

  let groundY = 0;
  for (const part of Object.values(parts)) {
    groundY = Math.max(groundY, part.bbox.maxY);
  }
  if (groundY === 0) groundY = CANVAS_SIZE;

  // ミラー複製した分も「見えている面積」として数える（見た目とステータスを一致させる）
  const armsArea = (parts.armL?.area ?? 0) + (parts.armR?.area ?? 0);
  const legsArea = (parts.legL?.area ?? 0) + (parts.legR?.area ?? 0);

  const headBox = head?.bbox;
  const headAspect = headBox && headBox.height > 0 ? headBox.width / headBox.height : 1;
  const headDensity =
    head && headBox && headBox.width * headBox.height > 0
      ? head.area / (headBox.width * headBox.height)
      : 0;

  return {
    parts,
    bodyCenterX,
    groundY,
    colorCount: usedColorCount(engine.getDoc()),
    areas: {
      body: body?.area ?? 0,
      head: head?.area ?? 0,
      arms: armsArea,
      legs: legsArea,
    },
    headAspect,
    headDensity,
  };
}
