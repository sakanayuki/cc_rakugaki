/**
 * 敵9種（通常6種＋強敵3種）。
 * 見た目はプレイヤーと同じ CharacterDoc 形式（描画オペレーション列）で持つので、
 * リグ生成・アニメーション・描画のパイプラインを完全に共通化できる。
 *
 * 通常敵は固定ステータスを持つ。
 * 強敵はステータスを持たず、プレイヤーの素ステータスの1.2倍として生成する。
 * どちらも2戦目以降は 1.1 のべき乗で強くなる。
 */

import type { CharacterDoc, DrawOp, PartId } from '../paint/types';
import { CANVAS_SIZE } from '../paint/types';
import type { Element } from './element';
import type { Stats } from './stats';

export type EnemyKind = 'normal' | 'strong';

export interface EnemyDef {
  id: string;
  /** ひらがな表示名 */
  name: string;
  kind: EnemyKind;
  element: Element;
  /** ルーレットのセクター色 */
  themeColor: string;
  /** キャラクター性の一言 */
  flavor: string;
  doc: CharacterDoc;
  /** 通常敵のみ。強敵はプレイヤー基準で生成するので持たない */
  baseStats?: Stats;
}

/** 強敵が1戦目時点でプレイヤーの何倍の強さか */
export const STRONG_RATIO = 1.2;

/** 強敵の素ステータスをプレイヤーの素ステータスから作る */
export function strongStatsFor(playerBase: Stats, element: Element): Stats {
  return {
    maxHp: Math.max(1, Math.round(playerBase.maxHp * STRONG_RATIO)),
    atk: Math.max(1, Math.round(playerBase.atk * STRONG_RATIO)),
    spd: Math.max(1, Math.round(playerBase.spd * STRONG_RATIO)),
    element,
  };
}

/** 連勝数に応じたスケールを掛ける */
export function scaleStats(stats: Stats, scale: number): Stats {
  return {
    maxHp: Math.max(1, Math.round(stats.maxHp * scale)),
    atk: Math.max(1, Math.round(stats.atk * scale)),
    spd: Math.max(1, Math.round(stats.spd * scale)),
    element: stats.element,
  };
}

/** 描画オペレーションを組み立てるための小さなビルダー */
class DocBuilder {
  private seq = 0;
  private readonly ops: DrawOp[] = [];

  stroke(part: PartId, color: string, width: number, points: [number, number][]): this {
    this.ops.push({ seq: this.seq++, part, type: 'stroke', color, width, points });
    return this;
  }

  fill(part: PartId, x: number, y: number, color: string): this {
    this.ops.push({ seq: this.seq++, part, type: 'fill', color, x: Math.round(x), y: Math.round(y) });
    return this;
  }

  /** 点（目や鼻に使う） */
  dot(part: PartId, x: number, y: number, radius: number, color: string): this {
    return this.stroke(part, color, radius * 2, [[x, y]]);
  }

  line(
    part: PartId,
    from: [number, number],
    to: [number, number],
    color: string,
    width: number,
  ): this {
    return this.stroke(part, color, width, [from, to]);
  }

  /** 楕円の輪郭を描いて中を塗る */
  blob(
    part: PartId,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    outline: string,
    fillColor: string,
    width = 10,
  ): this {
    const points: [number, number][] = [];
    const segments = 40;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
    }
    this.stroke(part, outline, width, points);
    return this.fill(part, cx, cy, fillColor);
  }

  /** 角丸なしの四角を描いて中を塗る */
  box(
    part: PartId,
    cx: number,
    cy: number,
    w: number,
    h: number,
    outline: string,
    fillColor: string,
    width = 10,
  ): this {
    const left = cx - w / 2;
    const right = cx + w / 2;
    const top = cy - h / 2;
    const bottom = cy + h / 2;
    this.stroke(part, outline, width, [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
      [left, top],
    ]);
    return this.fill(part, cx, cy, fillColor);
  }

  /** 三角形（耳・帽子など） */
  triangle(
    part: PartId,
    a: [number, number],
    b: [number, number],
    c: [number, number],
    outline: string,
    fillColor: string,
    width = 10,
  ): this {
    this.stroke(part, outline, width, [a, b, c, a]);
    const cx = (a[0] + b[0] + c[0]) / 3;
    const cy = (a[1] + b[1] + c[1]) / 3;
    return this.fill(part, cx, cy, fillColor);
  }

  build(): CharacterDoc {
    return {
      version: 1,
      canvasSize: CANVAS_SIZE,
      ops: this.ops,
      currentStep: 'done',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }
}

/** ゴロン: がっしりした岩のゴーレム */
function golemDoc(): CharacterDoc {
  const b = new DocBuilder();
  b.box('body', 512, 570, 320, 300, '#4a4038', '#8d8378');
  b.box('head', 512, 290, 250, 210, '#4a4038', '#a49a8e');
  b.dot('head', 455, 285, 22, '#2b2b2b');
  b.dot('head', 570, 285, 22, '#2b2b2b');
  b.line('head', [455, 355], [570, 355], '#2b2b2b', 12);
  b.box('arms', 300, 560, 120, 300, '#4a4038', '#8d8378');
  b.box('arms', 724, 560, 120, 300, '#4a4038', '#8d8378');
  b.box('legs', 440, 800, 130, 160, '#4a4038', '#6f665c');
  b.box('legs', 590, 800, 130, 160, '#4a4038', '#6f665c');
  return b.build();
}

/** カチカチ: 四角いロボット */
function robotDoc(): CharacterDoc {
  const b = new DocBuilder();
  b.box('body', 512, 570, 270, 280, '#1c3f6e', '#4aa8e0');
  b.dot('body', 512, 560, 40, '#ffd83d');
  b.box('head', 512, 300, 230, 190, '#1c3f6e', '#9ad3f5');
  b.dot('head', 455, 295, 24, '#1c3f6e');
  b.dot('head', 570, 295, 24, '#1c3f6e');
  b.line('head', [512, 205], [512, 150], '#1c3f6e', 12);
  b.dot('head', 512, 140, 22, '#e8402a');
  b.box('arms', 330, 555, 90, 280, '#1c3f6e', '#7cc0ea');
  b.box('arms', 694, 555, 90, 280, '#1c3f6e', '#7cc0ea');
  b.box('legs', 445, 800, 110, 170, '#1c3f6e', '#3d7fb0');
  b.box('legs', 580, 800, 110, 170, '#1c3f6e', '#3d7fb0');
  return b.build();
}

/** チョッキン: よこ長のカニ */
function crabDoc(): CharacterDoc {
  const b = new DocBuilder();
  b.blob('body', 512, 610, 210, 140, '#8c2010', '#e8402a');
  b.blob('head', 512, 390, 140, 85, '#8c2010', '#ff6a52');
  b.dot('head', 460, 375, 20, '#2b2b2b');
  b.dot('head', 565, 375, 20, '#2b2b2b');
  b.blob('arms', 270, 520, 105, 80, '#8c2010', '#ff6a52');
  b.line('arms', [340, 545], [400, 590], '#8c2010', 22);
  b.blob('arms', 754, 520, 105, 80, '#8c2010', '#ff6a52');
  b.line('arms', [684, 545], [624, 590], '#8c2010', 22);
  b.blob('legs', 420, 790, 45, 90, '#8c2010', '#c93520');
  b.blob('legs', 604, 790, 45, 90, '#8c2010', '#c93520');
  return b.build();
}

/** シュバにゃん: すばやい忍者ねこ */
function ninjaDoc(): CharacterDoc {
  const b = new DocBuilder();
  b.blob('body', 512, 590, 105, 175, '#241d3d', '#5b4b8a');
  b.line('body', [420, 560], [604, 560], '#ffd83d', 18);
  b.blob('head', 512, 320, 115, 130, '#241d3d', '#6f5da3');
  b.triangle('head', [410, 235], [455, 130], [500, 240], '#241d3d', '#6f5da3', 8);
  b.triangle('head', [524, 240], [569, 130], [614, 235], '#241d3d', '#6f5da3', 8);
  b.dot('head', 470, 320, 17, '#ffd83d');
  b.dot('head', 556, 320, 17, '#ffd83d');
  b.blob('arms', 355, 560, 55, 120, '#241d3d', '#5b4b8a', 8);
  b.blob('arms', 669, 560, 55, 120, '#241d3d', '#5b4b8a', 8);
  b.blob('legs', 460, 810, 45, 130, '#241d3d', '#4a3d72', 8);
  b.blob('legs', 566, 810, 45, 130, '#241d3d', '#4a3d72', 8);
  return b.build();
}

/** パタパタ: はねを飛ばすトリ */
function birdDoc(): CharacterDoc {
  const b = new DocBuilder();
  b.blob('body', 512, 600, 150, 160, '#a06a00', '#ffd83d');
  b.blob('head', 512, 350, 110, 105, '#a06a00', '#ffe97d');
  b.triangle('head', [600, 340], [690, 365], [600, 385], '#a06a00', '#ff8c1a', 8);
  b.dot('head', 480, 330, 18, '#2b2b2b');
  b.dot('head', 555, 330, 18, '#2b2b2b');
  b.blob('arms', 300, 600, 105, 65, '#a06a00', '#ffe97d');
  b.blob('arms', 724, 600, 105, 65, '#a06a00', '#ffe97d');
  b.line('legs', [470, 745], [462, 870], '#ff8c1a', 20);
  b.line('legs', [554, 745], [562, 870], '#ff8c1a', 20);
  return b.build();
}

/** フワリン: まほうつかい（いちばん強い） */
function witchDoc(): CharacterDoc {
  const b = new DocBuilder();
  b.triangle('body', [512, 420], [700, 760], [324, 760], '#3f2560', '#9b59d0');
  b.dot('body', 512, 640, 34, '#ffd83d');
  b.blob('head', 512, 320, 110, 115, '#3f2560', '#f2d3b0');
  b.triangle('head', [370, 215], [512, 40], [654, 215], '#3f2560', '#6d3fa0');
  b.line('head', [360, 220], [664, 220], '#3f2560', 20);
  b.dot('head', 472, 325, 17, '#2b2b2b');
  b.dot('head', 552, 325, 17, '#2b2b2b');
  b.blob('arms', 320, 570, 60, 130, '#3f2560', '#9b59d0', 8);
  b.line('arms', [300, 460], [330, 700], '#7a4a20', 18);
  b.blob('arms', 704, 570, 60, 130, '#3f2560', '#9b59d0', 8);
  b.blob('legs', 460, 810, 42, 90, '#3f2560', '#5b3a80', 8);
  b.blob('legs', 566, 810, 42, 90, '#3f2560', '#5b3a80', 8);
  return b.build();
}

/** ゴツゴツおう: ゴロンの上位。岩の王冠をかぶった王 */
function kingRockDoc(): CharacterDoc {
  const b = new DocBuilder();
  b.box('body', 512, 580, 360, 330, '#1f1a15', '#5a5148');
  b.box('body', 512, 580, 200, 180, '#c9a227', '#7a6f60');
  b.box('head', 512, 275, 280, 210, '#1f1a15', '#6e6459');
  b.triangle('head', [372, 175], [432, 60], [492, 175], '#1f1a15', '#c9a227', 8);
  b.triangle('head', [512, 175], [572, 55], [632, 175], '#1f1a15', '#c9a227', 8);
  b.dot('head', 452, 275, 26, '#ffd83d');
  b.dot('head', 575, 275, 26, '#ffd83d');
  b.line('head', [440, 350], [585, 350], '#1f1a15', 16);
  b.box('arms', 258, 565, 150, 330, '#1f1a15', '#5a5148');
  b.box('arms', 766, 565, 150, 330, '#1f1a15', '#5a5148');
  b.box('legs', 428, 815, 150, 175, '#1f1a15', '#463f38');
  b.box('legs', 600, 815, 150, 175, '#1f1a15', '#463f38');
  return b.build();
}

/** ザクザクおう: 三日月のような刃をもつ王 */
function kingScissorsDoc(): CharacterDoc {
  const b = new DocBuilder();
  b.blob('body', 512, 590, 145, 195, '#140c26', '#4a2f7a');
  b.line('body', [400, 545], [624, 545], '#c0c6d4', 20);
  b.blob('head', 512, 295, 135, 150, '#140c26', '#5c3d94');
  b.triangle('head', [392, 200], [428, 70], [478, 205], '#140c26', '#c0c6d4', 8);
  b.triangle('head', [546, 205], [596, 70], [632, 200], '#140c26', '#c0c6d4', 8);
  b.dot('head', 466, 300, 20, '#ff4d4d');
  b.dot('head', 560, 300, 20, '#ff4d4d');
  b.blob('arms', 300, 545, 70, 175, '#140c26', '#4a2f7a', 8);
  b.line('arms', [268, 420], [230, 640], '#c0c6d4', 26);
  b.blob('arms', 724, 545, 70, 175, '#140c26', '#4a2f7a', 8);
  b.line('arms', [756, 420], [794, 640], '#c0c6d4', 26);
  b.blob('legs', 452, 820, 55, 140, '#140c26', '#3a2560');
  b.blob('legs', 574, 820, 55, 140, '#140c26', '#3a2560');
  return b.build();
}

/** ヒラヒラおう: マントを広げた魔王 */
function kingPaperDoc(): CharacterDoc {
  const b = new DocBuilder();
  b.triangle('body', [512, 390], [740, 790], [284, 790], '#0d1330', '#26346e');
  b.dot('body', 512, 640, 42, '#ffd83d');
  b.blob('head', 512, 285, 125, 130, '#0d1330', '#3a4a90');
  b.triangle('head', [382, 190], [512, 45], [642, 190], '#0d1330', '#ffd83d', 8);
  b.dot('head', 466, 290, 20, '#ff4d4d');
  b.dot('head', 560, 290, 20, '#ff4d4d');
  b.blob('arms', 252, 560, 130, 90, '#0d1330', '#26346e');
  b.blob('arms', 772, 560, 130, 90, '#0d1330', '#26346e');
  b.blob('legs', 452, 830, 52, 110, '#0d1330', '#1a2450');
  b.blob('legs', 574, 830, 52, 110, '#0d1330', '#1a2450');
  return b.build();
}

/**
 * 通常敵6種。
 * ステータスは第2版で再調整済み（HPは概ね据え置き、ATKを下げて事故死を減らした）。
 * ATKの上限は「不利属性でも3ラウンド耐えられる」ことを基準にしている。
 */
export const NORMAL_ENEMIES: readonly EnemyDef[] = [
  {
    id: 'golem',
    name: 'ゴロン',
    kind: 'normal',
    element: 'rock',
    themeColor: '#a99a86',
    flavor: 'かたいけど おそい',
    doc: golemDoc(),
    baseStats: { maxHp: 150, atk: 17, spd: 5, element: 'rock' },
  },
  {
    id: 'robot',
    name: 'カチカチ',
    kind: 'normal',
    element: 'rock',
    themeColor: '#8fd0f2',
    flavor: 'バランスがた',
    doc: robotDoc(),
    baseStats: { maxHp: 115, atk: 21, spd: 12, element: 'rock' },
  },
  {
    id: 'crab',
    name: 'チョッキン',
    kind: 'normal',
    element: 'scissors',
    themeColor: '#ff9a8a',
    flavor: 'ハサミで きりつける',
    doc: crabDoc(),
    baseStats: { maxHp: 105, atk: 20, spd: 14, element: 'scissors' },
  },
  {
    id: 'ninja',
    name: 'シュバにゃん',
    kind: 'normal',
    element: 'scissors',
    themeColor: '#b8a8e0',
    flavor: 'すばやくて よく よける',
    doc: ninjaDoc(),
    baseStats: { maxHp: 88, atk: 19, spd: 22, element: 'scissors' },
  },
  {
    id: 'bird',
    name: 'パタパタ',
    kind: 'normal',
    element: 'paper',
    themeColor: '#ffe58a',
    flavor: 'はねを とばす',
    doc: birdDoc(),
    baseStats: { maxHp: 98, atk: 18, spd: 18, element: 'paper' },
  },
  {
    id: 'witch',
    name: 'フワリン',
    kind: 'normal',
    element: 'paper',
    themeColor: '#c9a2ea',
    flavor: 'まほうが とても つよい',
    doc: witchDoc(),
    baseStats: { maxHp: 132, atk: 22, spd: 9, element: 'paper' },
  },
];

/**
 * 強敵3種。グー・チョキ・パーを1体ずつ担当する。
 * ステータスは持たず、プレイヤーの素ステータスの1.2倍として生成される。
 */
export const STRONG_ENEMIES: readonly EnemyDef[] = [
  {
    id: 'kingRock',
    name: 'ゴツゴツおう',
    kind: 'strong',
    element: 'rock',
    themeColor: '#6e6459',
    flavor: 'いわの おうさま',
    doc: kingRockDoc(),
  },
  {
    id: 'kingScissors',
    name: 'ザクザクおう',
    kind: 'strong',
    element: 'scissors',
    themeColor: '#5c3d94',
    flavor: 'やいばの おうさま',
    doc: kingScissorsDoc(),
  },
  {
    id: 'kingPaper',
    name: 'ヒラヒラおう',
    kind: 'strong',
    element: 'paper',
    themeColor: '#26346e',
    flavor: 'まおうさま',
    doc: kingPaperDoc(),
  },
];

export const ENEMIES: readonly EnemyDef[] = [...NORMAL_ENEMIES, ...STRONG_ENEMIES];

export function enemyById(id: string): EnemyDef {
  const enemy = ENEMIES.find((candidate) => candidate.id === id);
  if (!enemy) throw new Error(`しらない てき です: ${id}`);
  return enemy;
}

/** 強敵のうち、指定した属性の1体 */
export function strongEnemyOf(element: Element): EnemyDef {
  const enemy = STRONG_ENEMIES.find((candidate) => candidate.element === element);
  if (!enemy) throw new Error(`しらない ぞくせい です: ${element}`);
  return enemy;
}

/**
 * その試合での敵の実効ステータス。
 * 通常敵は固定値、強敵はプレイヤー基準。どちらも連勝数のスケールが掛かる。
 */
export function enemyStatsFor(enemy: EnemyDef, playerBase: Stats, scale: number): Stats {
  const base = enemy.baseStats ?? strongStatsFor(playerBase, enemy.element);
  return scaleStats(base, scale);
}
