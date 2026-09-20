import { describe, expect, it } from 'vitest';
import { STEP_ORDER, createEmptyDoc } from '../paint/types';
import { S, stepTitleOf } from './strings';

describe('オエカキのステップ順', () => {
  it('あたま → からだ → うで → あし の順', () => {
    expect([...STEP_ORDER]).toEqual(['head', 'body', 'arms', 'legs']);
  });

  it('新しい絵は先頭のステップから始まる', () => {
    expect(createEmptyDoc().currentStep).toBe(STEP_ORDER[0]);
  });
});

describe('見出しの番号', () => {
  it('STEP_ORDER の位置から番号を付ける', () => {
    const marks = ['①', '②', '③', '④'];
    STEP_ORDER.forEach((part, index) => {
      expect(stepTitleOf(part)).toBe(`${marks[index]} ${S.stepTitle[part]}`);
    });
  });

  it('文言そのものには番号を焼き込まない', () => {
    // ここに番号を書くと、順番を変えたときに必ずずれる
    for (const title of Object.values(S.stepTitle)) {
      expect(title).not.toMatch(/[①②③④]/);
    }
  });

  it('いまの順番だと あたま が①、からだ が②', () => {
    expect(stepTitleOf('head')).toBe('① あたまを かこう！');
    expect(stepTitleOf('body')).toBe('② からだを かこう！');
  });
});
