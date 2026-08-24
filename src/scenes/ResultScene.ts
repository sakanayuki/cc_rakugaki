/**
 * 対戦リザルト画面。
 * 勝った場合は全ステータスが1.5倍になり、次の試合に進むかここでやめるかを選べる。
 * 5連勝で優勝。負けた場合はメインメニューに戻る。
 */

import { audio } from '../app/audio';
import { gameState, WIN_TARGET } from '../app/GameState';
import type { Scene, SceneContext, SceneParamMap } from '../app/SceneManager';
import { getStage } from '../app/Stage3D';
import { enemyById } from '../game/enemies';
import type { Stats } from '../game/stats';
import { starsFor } from '../game/stats';
import { buildCharacter } from '../rig/rigBuilder';
import { button, h, starString } from '../ui/components';
import { S } from '../ui/strings';

const CONFETTI_COLORS = ['#ff6b6b', '#ffd93d', '#43c26b', '#4aa8e0', '#a37bd8', '#ff9f43'];

/** 強化前後を並べて見せる1行 */
function upgradeRow(label: string, before: number, after: number, key: keyof typeof KEYS): HTMLElement {
  return h('div', { class: 'stat-row' }, [
    h('span', { class: 'stat-label', text: label }),
    h('span', { class: 'stars', text: starString(starsFor(after, KEYS[key])) }),
    h('span', { class: 'stat-value' }, [
      h('span', { text: `${before} → ` }),
      h('span', { class: 'up-value', text: String(after) }),
    ]),
  ]);
}

const KEYS = {
  maxHp: 'maxHp',
  atk: 'atk',
  spd: 'spd',
} as const;

export function createResultScene(ctx: SceneContext, params: SceneParamMap['result']): Scene {
  const stage = getStage();
  const stageHost = h('div', { class: 'stage3d' });
  const confettiHost = h('div', {
    style:
      'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:30',
  });

  const won = params.outcome === 'win';
  const enemy = enemyById(params.enemyId);

  // 勝利ならここで強化を確定させる
  let before: Stats | null = null;
  let after: Stats | null = null;
  if (won && gameState.baseStats) {
    before = gameState.effectiveStats();
    gameState.registerWin();
    after = gameState.effectiveStats();
  }
  const champion = won && gameState.isChampion;

  function spawnConfetti(count: number): void {
    for (let i = 0; i < count; i++) {
      const piece = h('div', {
        class: 'confetti',
        style: [
          `left:${Math.random() * 100}%`,
          `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}`,
          `animation-duration:${2 + Math.random() * 2}s`,
          `animation-delay:${Math.random() * 1.5}s`,
          `transform:rotate(${Math.random() * 360}deg)`,
        ].join(';'),
      });
      confettiHost.append(piece);
    }
  }

  function buildButtons(): HTMLElement[] {
    if (!won) {
      return [button(S.toMenu, { variant: 'primary', size: 'huge', onClick: () => ctx.go('menu') })];
    }
    if (champion) {
      return [button(S.toMenu, { variant: 'primary', size: 'huge', onClick: () => ctx.go('menu') })];
    }
    return [
      button(S.stopHere, { variant: 'ghost', onClick: () => ctx.go('menu') }),
      button(S.nextBattle, {
        variant: 'go',
        size: 'huge',
        onClick: () => ctx.go('roulette'),
      }),
    ];
  }

  return {
    mount(root) {
      const title = champion ? S.championTitle : won ? S.winTitle : S.loseTitle;
      const subtitle = champion
        ? `${WIN_TARGET}れんしょう たっせい！`
        : won
          ? `${enemy.name}に かった！ ${gameState.winStreak}れんしょう！`
          : `${enemy.name}に まけちゃった… ${gameState.winStreak}れんしょうで おわり`;

      const panel: HTMLElement[] = [];
      if (won && before && after) {
        panel.push(
          h('p', { class: 'hint-line', text: S.powerUp }),
          h('div', { class: 'stat-panel' }, [
            upgradeRow(S.statHp, before.maxHp, after.maxHp, 'maxHp'),
            upgradeRow(S.statAtk, before.atk, after.atk, 'atk'),
            upgradeRow(S.statSpd, before.spd, after.spd, 'spd'),
          ]),
        );
      }

      root.append(
        h('div', { class: 'scene' }, [
          h('h1', { class: won ? 'result-title' : 'result-title lose', text: title }),
          h('p', { class: 'result-sub', text: subtitle }),
          ...(champion ? [h('div', { class: 'trophy', text: '🏆' })] : []),
          stageHost,
          ...panel,
          h('div', { class: 'row row-center' }, buildButtons()),
        ]),
      );
      document.body.append(confettiHost);

      stage.mount(stageHost);

      const analysis = gameState.analysis;
      if (analysis) {
        const built = buildCharacter(analysis);
        built.setFacing(1);
        stage.addRig(built);
        // 勝利のジャンプぶん、少し余裕を持たせる
        stage.frame({ halfWidth: built.halfWidth, height: built.height, margin: built.height * 0.4 });
        // 負けたときは倒れたポーズのまま止める
        void built.play(won ? 'win' : 'lose', !won);
      }

      if (champion) {
        audio.play('champion');
        spawnConfetti(70);
      } else if (won) {
        spawnConfetti(36);
      }

    },

    unmount() {
      confettiHost.remove();
      stage.unmount();
    },
  };
}
