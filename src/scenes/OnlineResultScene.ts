/**
 * オンライン対戦のリザルト画面。
 *
 * 勝った人を称える。ひきわけなら両方を称える。
 * 「もういちど たたかう」は両方が押したときだけ戦略画面へ戻る。
 */

import { audio } from '../app/audio';
import { onlineState } from '../app/OnlineState';
import type { Scene, SceneContext } from '../app/SceneManager';
import { getStage } from '../app/Stage3D';
import type { PvpEvent } from '../game/pvpEngine';
import type { NetMessage } from '../net/protocol';
import { buildCharacter } from '../rig/rigBuilder';
import { button, h } from '../ui/components';
import { S } from '../ui/strings';

const CONFETTI_COLORS = ['#ff6b6b', '#ffd93d', '#43c26b', '#4aa8e0', '#a37bd8', '#ff9f43'];
const YOU_X = -2;
const OPPONENT_X = 2;

export function createOnlineResultScene(ctx: SceneContext): Scene {
  const link = onlineState.link;
  const me = onlineState.me;
  const opponent = onlineState.opponent;
  const end = onlineState.lastEvents?.find(
    (event): event is Extract<PvpEvent, { type: 'end' }> => event.type === 'end',
  );
  if (!link || !me || !opponent || !end) {
    ctx.go('menu');
    return { mount() {}, unmount() {} };
  }

  const stage = getStage();
  const stageHost = h('div', { class: 'stage3d' });
  const confettiHost = h('div', {
    style: 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:30',
  });
  const status = h('p', { class: 'hint-line hidden' });

  const mySide = onlineState.mySide;
  const drew = end.winner === 'draw';
  const iWon = end.winner === mySide;
  const myPercent = mySide === 'host' ? end.hostPercent : end.guestPercent;
  const theirPercent = mySide === 'host' ? end.guestPercent : end.hostPercent;

  let disposed = false;
  let iWantRematch = false;
  let theyWantRematch = false;
  let unsubscribe: (() => void) | null = null;

  const rematchButton = button(S.rematch, {
    variant: 'go',
    size: 'huge',
    onClick: () => {
      if (iWantRematch) return;
      iWantRematch = true;
      rematchButton.disabled = true;
      rematchButton.textContent = S.waitingOpponent;
      link!.send({ type: 'rematch', round: onlineState.round });
      maybeRestart();
    },
  });

  function spawnConfetti(count: number): void {
    for (let i = 0; i < count; i++) {
      confettiHost.append(
        h('div', {
          class: 'confetti',
          style: [
            `left:${Math.random() * 100}%`,
            `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}`,
            `animation-duration:${2 + Math.random() * 2}s`,
            `animation-delay:${Math.random() * 1.5}s`,
            `transform:rotate(${Math.random() * 360}deg)`,
          ].join(';'),
        }),
      );
    }
  }

  /** ふたりとも「もういちど」を押したら、手を捨てて戦略画面へ */
  function maybeRestart(): void {
    if (!iWantRematch || !theyWantRematch || disposed) return;
    onlineState.startNextRound();
    ctx.go('strategy');
  }

  function leaveToMenu(text: string): void {
    if (disposed) return;
    status.textContent = text;
    status.classList.remove('hidden');
    rematchButton.disabled = true;
    onlineState.close();
    setTimeout(() => {
      if (!disposed) ctx.go('menu');
    }, 2000);
  }

  function onMessage(message: NetMessage): void {
    if (disposed) return;
    if (message.type === 'rematch') {
      if (message.round !== onlineState.round) return;
      theyWantRematch = true;
      if (!iWantRematch) {
        status.textContent = 'あいては もういちど やりたいって！';
        status.classList.remove('hidden');
      }
      maybeRestart();
    } else if (message.type === 'bye') {
      leaveToMenu(S.opponentLeft);
    }
  }

  return {
    mount(root) {
      const stopMessage = link!.on('message', onMessage);
      const stopError = link!.on('error', () => leaveToMenu(S.matchLost));
      unsubscribe = () => {
        stopMessage();
        stopError();
      };

      const title = drew ? S.drawTitle : iWon ? S.winTitle : S.loseTitle;
      // ％は下の大きな箱で見せるので、ここでは「なぜ そうなったか」を書く
      const subtitle = drew
        ? S.drawSub
        : end.reason === 'ko'
          ? iWon
            ? S.resultKoWin
            : S.resultKoLose
          : iWon
            ? S.resultPointsWin
            : S.resultPointsLose;

      const lines: HTMLElement[] = [];
      // 1回で終わったときは、何が起きたのか分かるように一言そえる
      if (end.oneShot) {
        lines.push(
          h('p', {
            class: 'hint-line hint-gold',
            text: iWon ? S.oneShotWin : S.oneShotLose,
          }),
        );
      }

      root.append(
        h('div', { class: 'scene' }, [
          h('h1', { class: iWon || drew ? 'result-title' : 'result-title lose', text: title }),
          h('p', { class: 'result-sub', text: subtitle }),
          ...(drew ? [h('div', { class: 'trophy', text: '🤝' })] : []),
          h('div', { class: 'percent-row' }, [
            h('div', { class: 'percent-box' }, [
              h('span', { class: 'percent-label', text: S.sideYou }),
              h('span', { class: 'percent-value', text: `${myPercent}%` }),
            ]),
            h('div', { class: 'percent-box' }, [
              h('span', { class: 'percent-label', text: S.sideOpponent }),
              h('span', { class: 'percent-value', text: `${theirPercent}%` }),
            ]),
          ]),
          ...lines,
          stageHost,
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
            rematchButton,
          ]),
        ]),
      );
      document.body.append(confettiHost);

      stage.mount(stageHost);
      const mine = buildCharacter(me!.analysis);
      mine.container.position.x = YOU_X;
      mine.setFacing(1);
      stage.addRig(mine);
      void mine.play(iWon || drew ? 'win' : 'lose', !iWon && !drew);

      const theirs = buildCharacter(opponent!.analysis);
      theirs.container.position.x = OPPONENT_X;
      theirs.setFacing(-1);
      stage.addRig(theirs);
      void theirs.play(!iWon || drew ? 'win' : 'lose', iWon && !drew);

      const height = Math.max(mine.height, theirs.height);
      const halfWidth = OPPONENT_X + Math.max(mine.halfWidth, theirs.halfWidth);
      stage.frame({ halfWidth, height, margin: height * 0.4 });

      if (iWon || drew) {
        audio.play(drew ? 'win' : 'champion');
        spawnConfetti(drew ? 40 : 70);
      }
    },

    unmount() {
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
      confettiHost.remove();
      stage.unmount();
    },
  };
}
