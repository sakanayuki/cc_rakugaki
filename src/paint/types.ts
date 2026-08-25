/** お絵かきデータの型定義。絵はビットマップではなくオペレーション列として保持する。 */

export type PartId = 'body' | 'head' | 'arms' | 'legs';

/** オエカキのステップ順 */
export const STEP_ORDER: readonly PartId[] = ['body', 'head', 'arms', 'legs'];

/** 表示合成の順（あとのものが手前）。あたま・うでが からだ の手前に来る */
export const COMPOSITE_ORDER: readonly PartId[] = ['body', 'legs', 'arms', 'head'];

/** 論理キャンバスの一辺（px） */
export const CANVAS_SIZE = 1024;

/** 「つぎへ」を押せるようになる最小の塗りピクセル数（キャンバスの0.1%） */
export const MIN_PART_PIXELS = Math.round(CANVAS_SIZE * CANVAS_SIZE * 0.001);

export interface StrokeOp {
  seq: number;
  part: PartId;
  type: 'stroke';
  color: string;
  width: number;
  points: [number, number][];
}

export interface FillOp {
  seq: number;
  part: PartId;
  type: 'fill';
  color: string;
  x: number;
  y: number;
}

export type DrawOp = StrokeOp | FillOp;

export interface CharacterDoc {
  version: 1;
  canvasSize: number;
  ops: DrawOp[];
  /** オエカキの進行位置。4パーツ描き終わると 'done' */
  currentStep: PartId | 'done';
  updatedAt: string;
  /**
   * 殿堂入りでつけた名前。
   * 第3版で足した「任意」フィールド。version は 1 のまま据え置いてあるので、
   * これが無い古いセーブもそのまま読める。
   */
  name?: string;
}

/** 名前の最大文字数 */
export const MAX_NAME_LENGTH = 10;

export function createEmptyDoc(): CharacterDoc {
  return {
    version: 1,
    canvasSize: CANVAS_SIZE,
    ops: [],
    currentStep: 'body',
    updatedAt: new Date().toISOString(),
  };
}

/** パレット12色。子どもが選びやすいよう色数を絞る */
export const PALETTE: readonly { color: string; name: string }[] = [
  { color: '#2b2b2b', name: 'くろ' },
  { color: '#ffffff', name: 'しろ' },
  { color: '#e8402a', name: 'あか' },
  { color: '#ff8c1a', name: 'オレンジ' },
  { color: '#ffd83d', name: 'きいろ' },
  { color: '#3fbf5f', name: 'みどり' },
  { color: '#4fd1e0', name: 'みずいろ' },
  { color: '#2f6ee0', name: 'あお' },
  { color: '#9b59d0', name: 'むらさき' },
  { color: '#ff7fb6', name: 'ピンク' },
  { color: '#9c6b3f', name: 'ちゃいろ' },
  { color: '#9aa3ab', name: 'はいいろ' },
];

/** ペンの太さ3段階（論理px） */
export const PEN_WIDTHS: readonly number[] = [6, 14, 28];
