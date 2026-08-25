import { beforeEach, describe, expect, it } from 'vitest';
import { GROWTH_KO, GROWTH_SPECIAL, WIN_TARGET, gameState } from './GameState';
import type { Stats } from '../game/stats';

const BASE: Stats = { maxHp: 100, atk: 20, spd: 10, element: 'rock' };

beforeEach(() => {
  gameState.clearCharacter();
  gameState.baseStats = { ...BASE };
});

describe('成長ルール', () => {
  it('最初は素のステータスそのまま', () => {
    expect(gameState.growthRate).toBe(1);
    expect(gameState.effectiveStats()).toEqual(BASE);
  });

  it('3回以内のKOで初期値の+20%が上乗せされる', () => {
    gameState.registerWin('ko');
    expect(gameState.growthRate).toBeCloseTo(1 + GROWTH_KO);
    expect(gameState.effectiveStats()).toEqual({ maxHp: 120, atk: 24, spd: 12, element: 'rock' });
  });

  it('必殺技での勝利は+10%', () => {
    gameState.registerWin('special');
    expect(gameState.growthRate).toBeCloseTo(1 + GROWTH_SPECIAL);
    expect(gameState.effectiveStats()).toEqual({ maxHp: 110, atk: 22, spd: 11, element: 'rock' });
  });

  it('加算方式なので、勝ち方を混ぜると足し合わせになる', () => {
    gameState.registerWin('ko');
    gameState.registerWin('special');
    gameState.registerWin('ko');
    expect(gameState.growthRate).toBeCloseTo(1.5);
    expect(gameState.effectiveStats().maxHp).toBe(150);
  });

  it('4連勝すべてKOなら1.8倍、すべて必殺技なら1.4倍', () => {
    for (let i = 0; i < 4; i++) gameState.registerWin('ko');
    expect(gameState.growthRate).toBeCloseTo(1.8);

    gameState.resetRun();
    for (let i = 0; i < 4; i++) gameState.registerWin('special');
    expect(gameState.growthRate).toBeCloseTo(1.4);
  });

  it('属性は成長しても変わらない', () => {
    gameState.registerWin('ko');
    expect(gameState.effectiveStats().element).toBe('rock');
  });

  it('ステータス未算出で参照するとエラーになる', () => {
    gameState.baseStats = null;
    expect(() => gameState.effectiveStats()).toThrow();
  });
});

describe('連勝の進行', () => {
  it('戦目は連勝数+1', () => {
    expect(gameState.battleNumber).toBe(1);
    gameState.registerWin('ko');
    expect(gameState.battleNumber).toBe(2);
  });

  it('敵は2戦目以降1.1のべき乗で強くなる', () => {
    expect(gameState.enemyScale).toBeCloseTo(1);
    gameState.registerWin('ko');
    expect(gameState.enemyScale).toBeCloseTo(1.1);
    gameState.registerWin('ko');
    expect(gameState.enemyScale).toBeCloseTo(1.21);
    gameState.registerWin('ko');
    gameState.registerWin('ko');
    expect(gameState.enemyScale).toBeCloseTo(1.4641);
  });

  it('5戦目だけが最終戦になる', () => {
    for (let i = 1; i < WIN_TARGET; i++) {
      expect(gameState.isFinalBattle).toBe(false);
      gameState.registerWin('ko');
    }
    expect(gameState.battleNumber).toBe(WIN_TARGET);
    expect(gameState.isFinalBattle).toBe(true);
  });

  it('5連勝で優勝になる', () => {
    for (let i = 0; i < WIN_TARGET; i++) {
      expect(gameState.isChampion).toBe(false);
      gameState.registerWin('ko');
    }
    expect(gameState.isChampion).toBe(true);
  });

  it('メニューに戻ると成長と連勝がリセットされる', () => {
    gameState.registerWin('ko');
    gameState.resetRun();
    expect(gameState.growthRate).toBe(1);
    expect(gameState.winStreak).toBe(0);
    expect(gameState.lastWinKind).toBeNull();
  });
});
