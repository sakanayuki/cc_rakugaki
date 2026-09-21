/**
 * よみこみ画面。プレビューから対戦へ進むときに挟む。
 *
 * 敵9体ぶんの絵を展開して解析する処理は数秒かかる。これを押した直後に
 * まとめてやると画面が固まり、3歳児には「ボタンが効いたのかどうか」が
 * 分からない。ここで1体ずつ進めながら、進み具合をバーで見せる。
 *
 * バーの伸びは**本当の進み具合**で、見せかけのアニメーションではない。
 * 1体終えるごとに1コマ休んで（`nextFrame`）、画面を描き直させている。
 */

import { gameState } from '../app/GameState';
import type { Scene, SceneContext } from '../app/SceneManager';
import { ENEMIES } from '../game/enemies';
import { getEnemyAssets, isEnemyAssetReady } from '../rig/enemyAssets';
import { h } from '../ui/components';
import { S } from '../ui/strings';

/**
 * 最低これだけは見せる。
 * 2回目以降は敵の絵が作り済みで一瞬で終わるが、パッと切り替わると
 * かえって「押せたのか」が分からないので、必ずバーが伸びるのを見せる。
 */
const MIN_SHOW_MS = 700;

/**
 * 画面が**描き終わる**まで待つ。
 *
 * `requestAnimationFrame` だけだと、続きがマイクロタスクとして
 * コールバックの直後＝描画の前に動いてしまい、重い処理が同じコマに入って
 * バーが1度も更新されない。rAF のあとに `setTimeout` を挟んで、
 * 描画が済んでから次の1体に取りかかる。
 */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

export function createLoadingScene(ctx: SceneContext): Scene {
  const fill = h('div', { class: 'loading-fill' });
  const runner = h('div', { class: 'loading-runner' });
  const track = h('div', {
    class: 'loading-track',
    role: 'progressbar',
    'aria-label': S.loadingTitle,
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
  }, [fill, runner]);

  /** 用意できた相手を並べる場所。待っている間に1体ずつ増える */
  const facesRow = h('div', { class: 'loading-faces' });

  let disposed = false;

  /** 0〜1 で進み具合を反映する */
  function setProgress(value: number): void {
    const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
    fill.style.width = `${percent}%`;
    runner.style.left = `${percent}%`;
    track.setAttribute('aria-valuenow', String(percent));
  }

  /**
   * 走るのは自分が描いたキャラのあたま。
   * プレビューで解析済みのものを借りるだけなので、ここでは何も作らない。
   */
  function buildRunner(): void {
    const head = gameState.analysis?.parts.head?.canvas;
    if (head) {
      runner.append(h('img', { class: 'loading-runner-img', alt: '', src: head.toDataURL() }));
    } else {
      runner.textContent = '🎨';
    }
  }

  /** 用意できた相手の顔を1つ足す */
  function addFace(id: string): void {
    const thumbnail = getEnemyAssets(id).thumbnail;
    facesRow.append(
      h('div', { class: 'loading-face' }, [h('img', { alt: '', src: thumbnail.toDataURL() })]),
    );
  }

  /** 敵の絵を1体ずつ作りながらバーを進める */
  async function prepare(): Promise<void> {
    const startedAt = performance.now();

    for (const [index, enemy] of ENEMIES.entries()) {
      if (disposed) return;
      // 作り済みのものは待たずに出す。未作成のものだけ1コマ休んでから作る
      if (!isEnemyAssetReady(enemy.id)) {
        // 先に画面を描かせてから重い処理に入る（バーが止まって見えないように）
        await afterPaint();
        if (disposed) return;
      }
      addFace(enemy.id);
      setProgress((index + 1) / ENEMIES.length);
    }

    setProgress(1);

    const rest = MIN_SHOW_MS - (performance.now() - startedAt);
    if (rest > 0) await new Promise((resolve) => setTimeout(resolve, rest));
    if (disposed) return;
    ctx.go('roulette');
  }

  return {
    mount(root) {
      buildRunner();
      root.append(
        h('div', { class: 'scene scene-center' }, [
          h('h2', { class: 'loading-title', text: S.loadingTitle }),
          track,
          h('p', { class: 'loading-note', text: S.loadingNote }),
          facesRow,
        ]),
      );

      // 何体作るかに関わらず、まずバーを少し出して「動いている」ことを見せる
      setProgress(0.06);
      void prepare();
    },

    unmount() {
      disposed = true;
    },
  };
}
