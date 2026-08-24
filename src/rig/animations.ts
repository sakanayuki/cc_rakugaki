/**
 * アクション定義。すべてキーフレームのデータテーブルとして持つ。
 * リグ構造は全キャラクター共通なので、プレイヤーにも敵にもそのまま適用できる。
 *
 * 角度の向き: キャラクターは +X 方向を向いている。
 * うで／あしのピボットは付け根にあり、rotZ を + にすると前（+X側）へ振り出される。
 */

import type { Element } from '../game/element';

export type ChannelName =
  | 'root.x'
  | 'root.y'
  | 'root.rotY'
  | 'root.rotZ'
  | 'body.rotZ'
  | 'body.scaleY'
  | 'head.rotZ'
  | 'armL.rotZ'
  | 'armR.rotZ'
  | 'legL.rotZ'
  | 'legR.rotZ';

export interface Keyframe {
  /** 0..1 に正規化した時間 */
  t: number;
  v: number;
}

export type ActionEventName = 'projectile' | 'flash' | 'shield' | 'impact';

export interface ActionEvent {
  t: number;
  name: ActionEventName;
}

export interface ActionDef {
  duration: number;
  loop: boolean;
  tracks: Partial<Record<ChannelName, Keyframe[]>>;
  events?: ActionEvent[];
}

export type ActionName =
  | 'idle'
  | 'attackRock'
  | 'attackScissors'
  | 'attackPaper'
  | 'hit'
  | 'dodge'
  | 'guard'
  | 'special'
  | 'win'
  | 'lose'
  | 'walk';

/** チャンネルの既定値（アニメが指定しない場合の値） */
export const CHANNEL_DEFAULT: Record<ChannelName, number> = {
  'root.x': 0,
  'root.y': 0,
  'root.rotY': 0,
  'root.rotZ': 0,
  'body.rotZ': 0,
  'body.scaleY': 1,
  'head.rotZ': 0,
  'armL.rotZ': 0,
  'armR.rotZ': 0,
  'legL.rotZ': 0,
  'legR.rotZ': 0,
};

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2;
}

/** キーフレーム列から時刻 t（0..1）の値を取り出す */
export function sampleTrack(keys: Keyframe[], t: number): number {
  if (keys.length === 0) return 0;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.v;
      return a.v + (b.v - a.v) * easeInOut((t - a.t) / span);
    }
  }
  return last.v;
}

export const ACTIONS: Record<ActionName, ActionDef> = {
  // ゆらゆら揺れながら呼吸する待機モーション
  idle: {
    duration: 2.4,
    loop: true,
    tracks: {
      'root.rotY': [
        { t: 0, v: -0.06 },
        { t: 0.5, v: 0.06 },
        { t: 1, v: -0.06 },
      ],
      'body.scaleY': [
        { t: 0, v: 0.985 },
        { t: 0.5, v: 1.015 },
        { t: 1, v: 0.985 },
      ],
      'armL.rotZ': [
        { t: 0, v: -0.05 },
        { t: 0.5, v: 0.05 },
        { t: 1, v: -0.05 },
      ],
      'armR.rotZ': [
        { t: 0, v: 0.05 },
        { t: 0.5, v: -0.05 },
        { t: 1, v: 0.05 },
      ],
      'head.rotZ': [
        { t: 0, v: 0.03 },
        { t: 0.5, v: -0.03 },
        { t: 1, v: 0.03 },
      ],
    },
  },

  // グー（鈍器）: 前に踏み込んで両腕を振り下ろす
  attackRock: {
    duration: 0.8,
    loop: false,
    tracks: {
      'root.x': [
        { t: 0, v: 0 },
        { t: 0.35, v: 0.7 },
        { t: 0.75, v: 0.7 },
        { t: 1, v: 0 },
      ],
      'armL.rotZ': [
        { t: 0, v: 0 },
        { t: 0.35, v: 2.6 },
        { t: 0.55, v: 0.5 },
        { t: 1, v: 0 },
      ],
      'armR.rotZ': [
        { t: 0, v: 0 },
        { t: 0.35, v: 2.6 },
        { t: 0.55, v: 0.5 },
        { t: 1, v: 0 },
      ],
      'body.rotZ': [
        { t: 0, v: 0 },
        { t: 0.35, v: 0.18 },
        { t: 0.55, v: -0.22 },
        { t: 1, v: 0 },
      ],
      'legL.rotZ': [
        { t: 0, v: 0 },
        { t: 0.35, v: 0.35 },
        { t: 1, v: 0 },
      ],
    },
    events: [{ t: 0.55, name: 'impact' }],
  },

  // チョキ（斬撃）: 体をひねって腕を横に薙ぐ
  attackScissors: {
    duration: 0.8,
    loop: false,
    tracks: {
      'root.x': [
        { t: 0, v: 0 },
        { t: 0.35, v: 0.75 },
        { t: 0.75, v: 0.75 },
        { t: 1, v: 0 },
      ],
      'root.rotY': [
        { t: 0, v: 0 },
        { t: 0.3, v: -0.45 },
        { t: 0.55, v: 0.35 },
        { t: 1, v: 0 },
      ],
      'armR.rotZ': [
        { t: 0, v: 0 },
        { t: 0.3, v: -0.9 },
        { t: 0.55, v: 1.9 },
        { t: 1, v: 0 },
      ],
      'armL.rotZ': [
        { t: 0, v: 0 },
        { t: 0.3, v: 0.4 },
        { t: 0.55, v: -0.6 },
        { t: 1, v: 0 },
      ],
      'body.rotZ': [
        { t: 0, v: 0 },
        { t: 0.55, v: 0.3 },
        { t: 1, v: 0 },
      ],
    },
    events: [{ t: 0.55, name: 'impact' }],
  },

  // パー（飛び道具）: 両腕を突き出して弾を飛ばす
  attackPaper: {
    duration: 0.9,
    loop: false,
    tracks: {
      'root.x': [
        { t: 0, v: 0 },
        { t: 0.3, v: -0.25 },
        { t: 0.45, v: 0.35 },
        { t: 1, v: 0 },
      ],
      'armL.rotZ': [
        { t: 0, v: 0 },
        { t: 0.28, v: -0.5 },
        { t: 0.45, v: 1.45 },
        { t: 0.8, v: 1.3 },
        { t: 1, v: 0 },
      ],
      'armR.rotZ': [
        { t: 0, v: 0 },
        { t: 0.28, v: -0.5 },
        { t: 0.45, v: 1.45 },
        { t: 0.8, v: 1.3 },
        { t: 1, v: 0 },
      ],
      'body.rotZ': [
        { t: 0, v: 0 },
        { t: 0.45, v: -0.15 },
        { t: 1, v: 0 },
      ],
    },
    events: [{ t: 0.46, name: 'projectile' }],
  },

  // 被ダメージ: のけぞって後ろに下がる
  hit: {
    duration: 0.6,
    loop: false,
    tracks: {
      'root.x': [
        { t: 0, v: 0 },
        { t: 0.25, v: -0.5 },
        { t: 1, v: 0 },
      ],
      'body.rotZ': [
        { t: 0, v: 0 },
        { t: 0.2, v: -0.28 },
        { t: 0.5, v: 0.15 },
        { t: 0.75, v: -0.08 },
        { t: 1, v: 0 },
      ],
      'head.rotZ': [
        { t: 0, v: 0 },
        { t: 0.2, v: -0.4 },
        { t: 0.6, v: 0.2 },
        { t: 1, v: 0 },
      ],
      'armL.rotZ': [
        { t: 0, v: 0 },
        { t: 0.25, v: -0.7 },
        { t: 1, v: 0 },
      ],
      'armR.rotZ': [
        { t: 0, v: 0 },
        { t: 0.25, v: -0.7 },
        { t: 1, v: 0 },
      ],
    },
    events: [{ t: 0, name: 'flash' }],
  },

  // 回避: 後ろにひらりとホップ
  dodge: {
    duration: 0.55,
    loop: false,
    tracks: {
      'root.x': [
        { t: 0, v: 0 },
        { t: 0.45, v: -0.9 },
        { t: 1, v: 0 },
      ],
      'root.y': [
        { t: 0, v: 0 },
        { t: 0.45, v: 0.45 },
        { t: 1, v: 0 },
      ],
      'body.rotZ': [
        { t: 0, v: 0 },
        { t: 0.45, v: 0.35 },
        { t: 1, v: 0 },
      ],
      'legL.rotZ': [
        { t: 0, v: 0 },
        { t: 0.45, v: 0.7 },
        { t: 1, v: 0 },
      ],
      'legR.rotZ': [
        { t: 0, v: 0 },
        { t: 0.45, v: -0.4 },
        { t: 1, v: 0 },
      ],
    },
  },

  // 防御: 両腕を体の前でクロスして踏ん張る
  guard: {
    duration: 0.7,
    loop: false,
    tracks: {
      'root.y': [
        { t: 0, v: 0 },
        { t: 0.25, v: -0.12 },
        { t: 1, v: 0 },
      ],
      'armL.rotZ': [
        { t: 0, v: 0 },
        { t: 0.2, v: 1.35 },
        { t: 0.75, v: 1.35 },
        { t: 1, v: 0 },
      ],
      'armR.rotZ': [
        { t: 0, v: 0 },
        { t: 0.2, v: 1.15 },
        { t: 0.75, v: 1.15 },
        { t: 1, v: 0 },
      ],
      'body.rotZ': [
        { t: 0, v: 0 },
        { t: 0.25, v: -0.1 },
        { t: 1, v: 0 },
      ],
    },
    events: [{ t: 0.18, name: 'shield' }],
  },

  // 必殺技: 高速スピン → 大ジャンプ → 急降下
  special: {
    duration: 3,
    loop: false,
    tracks: {
      'root.rotY': [
        { t: 0, v: 0 },
        { t: 0.45, v: Math.PI * 6 },
        { t: 0.6, v: Math.PI * 6 },
        { t: 1, v: Math.PI * 6 },
      ],
      'root.y': [
        { t: 0, v: 0 },
        { t: 0.45, v: 0 },
        { t: 0.62, v: 2.6 },
        { t: 0.78, v: 0 },
        { t: 1, v: 0 },
      ],
      'root.x': [
        { t: 0, v: 0 },
        { t: 0.45, v: -0.4 },
        { t: 0.62, v: 0.6 },
        { t: 0.78, v: 1.6 },
        { t: 1, v: 0 },
      ],
      'armL.rotZ': [
        { t: 0, v: 0 },
        { t: 0.5, v: 2.9 },
        { t: 0.78, v: 0.4 },
        { t: 1, v: 0 },
      ],
      'armR.rotZ': [
        { t: 0, v: 0 },
        { t: 0.5, v: 2.9 },
        { t: 0.78, v: 0.4 },
        { t: 1, v: 0 },
      ],
      'body.scaleY': [
        { t: 0, v: 1 },
        { t: 0.5, v: 1.12 },
        { t: 0.78, v: 0.92 },
        { t: 1, v: 1 },
      ],
    },
    events: [
      { t: 0.78, name: 'impact' },
      { t: 0.79, name: 'flash' },
    ],
  },

  // 勝利: バンザイしながら小さくジャンプ
  win: {
    duration: 0.8,
    loop: true,
    tracks: {
      'root.y': [
        { t: 0, v: 0 },
        { t: 0.5, v: 0.4 },
        { t: 1, v: 0 },
      ],
      // 左右で符号を逆にして、あたまの横に開くバンザイにする
      // （両腕とも同じ向きに上げると、大きなあたまの裏に隠れてしまう）
      'armL.rotZ': [
        { t: 0, v: -2.5 },
        { t: 0.5, v: -2.9 },
        { t: 1, v: -2.5 },
      ],
      'armR.rotZ': [
        { t: 0, v: 2.9 },
        { t: 0.5, v: 2.5 },
        { t: 1, v: 2.9 },
      ],
      'body.scaleY': [
        { t: 0, v: 1 },
        { t: 0.5, v: 1.05 },
        { t: 1, v: 1 },
      ],
    },
  },

  // 敗北: 力尽きて倒れる
  lose: {
    duration: 1,
    loop: false,
    tracks: {
      'root.rotZ': [
        { t: 0, v: 0 },
        { t: 0.55, v: -1.45 },
        { t: 0.75, v: -1.62 },
        { t: 1, v: -1.55 },
      ],
      'root.y': [
        { t: 0, v: 0 },
        { t: 0.55, v: 0.1 },
        { t: 0.75, v: 0 },
        { t: 1, v: 0 },
      ],
      'armL.rotZ': [
        { t: 0, v: 0 },
        { t: 0.5, v: -0.9 },
        { t: 1, v: -0.7 },
      ],
      'armR.rotZ': [
        { t: 0, v: 0 },
        { t: 0.5, v: -0.6 },
        { t: 1, v: -0.5 },
      ],
    },
  },

  // 登場用の歩き
  walk: {
    duration: 0.8,
    loop: true,
    tracks: {
      'legL.rotZ': [
        { t: 0, v: -0.5 },
        { t: 0.5, v: 0.5 },
        { t: 1, v: -0.5 },
      ],
      'legR.rotZ': [
        { t: 0, v: 0.5 },
        { t: 0.5, v: -0.5 },
        { t: 1, v: 0.5 },
      ],
      'armL.rotZ': [
        { t: 0, v: 0.35 },
        { t: 0.5, v: -0.35 },
        { t: 1, v: 0.35 },
      ],
      'armR.rotZ': [
        { t: 0, v: -0.35 },
        { t: 0.5, v: 0.35 },
        { t: 1, v: -0.35 },
      ],
      'root.y': [
        { t: 0, v: 0 },
        { t: 0.25, v: 0.08 },
        { t: 0.5, v: 0 },
        { t: 0.75, v: 0.08 },
        { t: 1, v: 0 },
      ],
    },
  },
};

/** 属性に対応する攻撃モーション */
export function attackActionFor(element: Element): ActionName {
  switch (element) {
    case 'rock':
      return 'attackRock';
    case 'scissors':
      return 'attackScissors';
    case 'paper':
      return 'attackPaper';
  }
}
