import { describe, expect, it } from 'vitest';
import { ACTIONS, CHANNEL_DEFAULT, attackActionFor, sampleTrack } from './animations';
import type { ActionName, ChannelName } from './animations';

const ALL_ACTIONS = Object.keys(ACTIONS) as ActionName[];

describe('sampleTrack', () => {
  const track = [
    { t: 0, v: 0 },
    { t: 0.5, v: 10 },
    { t: 1, v: 0 },
  ];

  it('キーフレームの値をそのまま返す', () => {
    expect(sampleTrack(track, 0)).toBe(0);
    expect(sampleTrack(track, 0.5)).toBe(10);
    expect(sampleTrack(track, 1)).toBe(0);
  });

  it('範囲外は端の値で止まる', () => {
    expect(sampleTrack(track, -1)).toBe(0);
    expect(sampleTrack(track, 5)).toBe(0);
  });

  it('あいだの値はなめらかに補間される', () => {
    const quarter = sampleTrack(track, 0.25);
    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(10);

    // イージングがかかるので、動きはじめは線形より遅い
    expect(sampleTrack(track, 0.125)).toBeLessThan(2.5);
    // 区間の折り返し以降は線形より速い
    expect(sampleTrack(track, 0.375)).toBeGreaterThan(7.5);
  });

  it('空のトラックでも落ちない', () => {
    expect(sampleTrack([], 0.4)).toBe(0);
  });
});

describe('アクション定義', () => {
  it('必要なアクションがすべて揃っている', () => {
    for (const name of [
      'idle',
      'attackRock',
      'attackScissors',
      'attackPaper',
      'hit',
      'dodge',
      'guard',
      'special',
      'win',
      'lose',
      'walk',
    ]) {
      expect(ACTIONS).toHaveProperty(name);
    }
  });

  it('どのアクションも長さが正で、キーフレームは0..1の昇順', () => {
    for (const name of ALL_ACTIONS) {
      const action = ACTIONS[name];
      expect(action.duration).toBeGreaterThan(0);
      for (const keys of Object.values(action.tracks)) {
        expect(keys.length).toBeGreaterThan(0);
        let previous = -1;
        for (const key of keys) {
          expect(key.t).toBeGreaterThanOrEqual(0);
          expect(key.t).toBeLessThanOrEqual(1);
          expect(key.t).toBeGreaterThanOrEqual(previous);
          expect(Number.isFinite(key.v)).toBe(true);
          previous = key.t;
        }
      }
    }
  });

  it('イベントの発火時刻も0..1に収まっている', () => {
    for (const name of ALL_ACTIONS) {
      for (const event of ACTIONS[name].events ?? []) {
        expect(event.t).toBeGreaterThanOrEqual(0);
        expect(event.t).toBeLessThanOrEqual(1);
      }
    }
  });

  it('ループするアクションは最初と最後の値が一致する（つなぎ目が飛ばない）', () => {
    for (const name of ALL_ACTIONS) {
      const action = ACTIONS[name];
      if (!action.loop) continue;
      for (const keys of Object.values(action.tracks)) {
        expect(keys[0].v).toBeCloseTo(keys[keys.length - 1].v);
      }
    }
  });

  it('単発の攻撃モーションは中立姿勢に戻って終わる', () => {
    for (const name of ['attackRock', 'attackScissors', 'attackPaper', 'hit', 'dodge', 'guard'] as const) {
      for (const [channel, keys] of Object.entries(ACTIONS[name].tracks)) {
        const expected = CHANNEL_DEFAULT[channel as ChannelName];
        expect(keys[keys.length - 1].v).toBe(expected);
      }
    }
  });
});

describe('attackActionFor', () => {
  it('属性ごとに攻撃モーションが割り当てられている', () => {
    expect(attackActionFor('rock')).toBe('attackRock');
    expect(attackActionFor('scissors')).toBe('attackScissors');
    expect(attackActionFor('paper')).toBe('attackPaper');
  });
});
