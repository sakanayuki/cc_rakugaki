/**
 * 戦略画面。3ターンぶんのグーチョキパーを先に決める。
 *
 * 選んだ手はジャンケンの手であると同時に、攻撃属性でもある。
 * 相手の守りの属性は見えないので、読み合いになる。
 *
 * ふたりが決め終わるまで中身は明かさない（コミット＆リビール）。
 * 両方の手がそろったところで乱数の種を合成し、戦闘画面へ渡す。
 */

import { audio } from '../app/audio';
import { onlineState } from '../app/OnlineState';
import type { Scene, SceneContext } from '../app/SceneManager';
import type { Element } from '../game/element';
import { ELEMENTS } from '../game/element';
import { PVP_TURNS, simulatePvp } from '../game/pvpEngine';
import { commitHashOf, createReveal, mixSeed, verifyReveal } from '../net/fairness';
import type { NetMessage } from '../net/protocol';
import { revealOf } from '../net/protocol';
import { thumbnailFromDoc } from '../paint/thumbnail';
import { button, h } from '../ui/components';
import { ELEMENT_INFO, S } from '../ui/strings';

export function createStrategyScene(ctx: SceneContext): Scene {
  const link = onlineState.link;
  const me = onlineState.me;
  const opponent = onlineState.opponent;
  if (!link || !me || !opponent) {
    ctx.go('menu');
    return { mount() {}, unmount() {} };
  }

  const round = onlineState.round;
  const choices: (Element | null)[] = Array.from({ length: PVP_TURNS }, () => null);
  const status = h('p', { class: 'hint-line', text: S.strategyUnknown });

  let decided = false;
  let disposed = false;
  let unsubscribe: (() => void) | null = null;

  const decideButton = button(S.strategyDecide, {
    variant: 'go',
    size: 'huge',
    disabled: true,
    onClick: () => void decide(),
  });

  /** 1ターンぶんの選択肢 */
  function turnRow(turn: number): HTMLElement {
    const buttons = ELEMENTS.map((element) => {
      const info = ELEMENT_INFO[element];
      const node = h('button', {
        class: 'hand-btn',
        type: 'button',
        'data-turn': String(turn),
        'data-hand': element,
        'aria-label': `${S.turnLabels[turn]} ${info.name}`,
      }, [
        h('span', { class: 'hand-emoji', text: info.emoji }),
        h('span', { class: 'hand-name', text: info.name }),
      ]);
      node.addEventListener('click', () => {
        if (decided) return;
        choices[turn] = element;
        audio.play('tap');
        syncSelection();
      });
      return node;
    });

    return h('div', { class: 'hand-row' }, [
      h('span', { class: 'hand-label', text: S.turnLabels[turn] }),
      h('div', { class: 'hand-choices' }, buttons),
    ]);
  }

  const rows = Array.from({ length: PVP_TURNS }, (_, turn) => turnRow(turn));

  function syncSelection(): void {
    for (const [turn, row] of rows.entries()) {
      for (const node of row.querySelectorAll('.hand-btn')) {
        const selected = node.getAttribute('data-hand') === choices[turn];
        node.classList.toggle('on', selected);
        if (decided) node.setAttribute('disabled', '');
      }
    }
    decideButton.disabled = decided || choices.some((choice) => choice === null);
  }

  /** 手を確定して commit を送る。ここから先は変えられない */
  async function decide(): Promise<void> {
    if (decided || choices.some((choice) => choice === null)) return;
    decided = true;
    syncSelection();
    decideButton.textContent = S.waitingOpponent;
    status.textContent = S.waitingOpponent;

    const reveal = createReveal(choices as Element[]);
    onlineState.myReveal = reveal;
    link!.send({ type: 'commit', round, hash: await commitHashOf(reveal) });
    void maybeReveal();
  }

  /** 相手の commit が届いていて、自分も決めていれば中身を明かす */
  async function maybeReveal(): Promise<void> {
    const mine = onlineState.myReveal;
    if (disposed || !mine || !onlineState.opponentCommit) return;
    link!.send({
      type: 'reveal',
      round,
      choices: mine.choices,
      salt: mine.salt,
      nonce: mine.nonce,
    });
    void maybeStartBattle();
  }

  /** 両方の中身がそろったら、種を合成して戦闘を計算する */
  async function maybeStartBattle(): Promise<void> {
    const mine = onlineState.myReveal;
    const theirs = onlineState.opponentReveal;
    if (disposed || !mine || !theirs) return;

    const hostReveal = onlineState.isHost ? mine : theirs;
    const guestReveal = onlineState.isHost ? theirs : mine;
    const seed = await mixSeed(hostReveal.nonce, guestReveal.nonce);
    if (disposed) return;

    onlineState.lastEvents = simulatePvp({
      host: {
        stats: (onlineState.isHost ? me! : opponent!).stats,
        choices: hostReveal.choices,
      },
      guest: {
        stats: (onlineState.isHost ? opponent! : me!).stats,
        choices: guestReveal.choices,
      },
      seed,
    });
    ctx.go('onlineBattle');
  }

  async function onMessage(message: NetMessage): Promise<void> {
    if (disposed) return;
    switch (message.type) {
      case 'commit':
        if (message.round !== round) return;
        onlineState.opponentCommit = message.hash;
        void maybeReveal();
        break;
      case 'reveal': {
        if (message.round !== round) return;
        const commit = onlineState.opponentCommit;
        const reveal = revealOf(message);
        // 先に受け取ったハッシュと合わなければ、手をすり替えられている
        if (!commit || !(await verifyReveal(reveal, commit))) {
          status.textContent = S.matchDesync;
          onlineState.close();
          setTimeout(() => {
            if (!disposed) ctx.go('menu');
          }, 2200);
          return;
        }
        onlineState.opponentReveal = reveal;
        void maybeStartBattle();
        break;
      }
      case 'bye':
        status.textContent = S.opponentLeft;
        onlineState.close();
        setTimeout(() => {
          if (!disposed) ctx.go('menu');
        }, 2000);
        break;
      default:
        break;
    }
  }

  return {
    mount(root) {
      unsubscribe = link!.on('message', (message) => void onMessage(message));
      const stopError = link!.on('error', () => {
        if (disposed) return;
        status.textContent = S.matchLost;
        onlineState.close();
        setTimeout(() => {
          if (!disposed) ctx.go('menu');
        }, 2000);
      });
      const stopAll = unsubscribe;
      unsubscribe = () => {
        stopAll();
        stopError();
      };

      // 誰と戦っているか分かるように、相手の絵を小さく置く
      const thumbnail = thumbnailFromDoc(opponent!.doc, 128);

      root.append(
        h('div', { class: 'scene' }, [
          h('h2', { class: 'draw-title', text: S.strategyTitle }),
          h('div', { class: 'strategy-head' }, [
            ...(thumbnail
              ? [
                  h('div', { class: 'save-thumb' }, [
                    h('img', { alt: S.sideOpponent, src: thumbnail.toDataURL() }),
                  ]),
                ]
              : []),
            h('p', { class: 'match-note', text: S.strategyHint }),
          ]),
          h('div', { class: 'hand-panel' }, rows),
          status,
          h('div', { class: 'row row-center' }, [
            button(S.quitOnline, {
              variant: 'ghost',
              onClick: () => {
                link!.send({ type: 'bye' });
                onlineState.close();
                ctx.go('menu');
              },
            }),
            decideButton,
          ]),
        ]),
      );
      syncSelection();
    },

    unmount() {
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
