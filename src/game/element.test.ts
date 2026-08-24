import { describe, expect, it } from 'vitest';
import { ELEMENTS, elementMultiplier, judgeElement } from './element';

describe('judgeElement（あたまの形から属性を決める）', () => {
  it('よこに細長いとチョキ', () => {
    expect(judgeElement(2, 0.9)).toBe('scissors');
  });

  it('たてに細長いとチョキ', () => {
    expect(judgeElement(0.4, 0.9)).toBe('scissors');
  });

  it('細長さのしきい値ちょうどはチョキ', () => {
    expect(judgeElement(1.5, 0.9)).toBe('scissors');
    expect(judgeElement(0.67, 0.9)).toBe('scissors');
  });

  it('まるくて塗り密度が高いとグー', () => {
    expect(judgeElement(1, 0.72)).toBe('rock');
    expect(judgeElement(1.2, 0.5)).toBe('rock');
  });

  it('スカスカならパー', () => {
    expect(judgeElement(1, 0.3)).toBe('paper');
    expect(judgeElement(1.49, 0.49)).toBe('paper');
  });

  it('細長さの判定が密度より優先される', () => {
    // 密度が高くても細長ければチョキ
    expect(judgeElement(3, 0.95)).toBe('scissors');
  });

  it('あたまが無い等の異常値でもパーになりクラッシュしない', () => {
    expect(judgeElement(0, 0)).toBe('paper');
    expect(judgeElement(Number.NaN, 0.9)).toBe('paper');
    expect(judgeElement(Number.POSITIVE_INFINITY, 0.9)).toBe('paper');
    expect(judgeElement(-1, 0.9)).toBe('paper');
  });
});

describe('elementMultiplier（じゃんけん三すくみ）', () => {
  it('同じ属性どうしは等倍', () => {
    for (const element of ELEMENTS) {
      expect(elementMultiplier(element, element)).toBe(1);
    }
  });

  it('勝てる相手には2倍', () => {
    expect(elementMultiplier('rock', 'scissors')).toBe(2);
    expect(elementMultiplier('scissors', 'paper')).toBe(2);
    expect(elementMultiplier('paper', 'rock')).toBe(2);
  });

  it('負ける相手には半分', () => {
    expect(elementMultiplier('rock', 'paper')).toBe(0.5);
    expect(elementMultiplier('scissors', 'rock')).toBe(0.5);
    expect(elementMultiplier('paper', 'scissors')).toBe(0.5);
  });

  it('全組み合わせが 0.5 / 1 / 2 のいずれかになる', () => {
    for (const attacker of ELEMENTS) {
      for (const defender of ELEMENTS) {
        expect([0.5, 1, 2]).toContain(elementMultiplier(attacker, defender));
      }
    }
  });
});
