/**
 * オンラインの戦闘画面。
 *
 * 戦略画面で計算しておいたイベント列を再生するだけで、**この画面では通信しない**。
 * 途中で切れても最後まで見られるし、演出の速さの違いで結果がずれることもない。
 *
 * 体力は数字ではなく％で出す（相手の最大体力を見せない約束のため）。
 */

import * as THREE from 'three';
import { audio, hitSfxFor } from '../app/audio';
import { onlineState } from '../app/OnlineState';
import type { Scene, SceneContext } from '../app/SceneManager';
import { getStage } from '../app/Stage3D';
import type { Element } from '../game/element';
import type { PvpEvent, PvpSide } from '../game/pvpEngine';
import { hpPercent } from '../game/pvpEngine';
import type { Stats } from '../game/stats';
import { attackActionFor } from '../rig/animations';
import type { CharacterRig } from '../rig/rigBuilder';
import { buildCharacter } from '../rig/rigBuilder';
import { h, wait } from '../ui/components';
import { ELEMENT_INFO, S } from '../ui/strings';

const YOU_X = -2;
const OPPONENT_X = 2;
const CUTIN_MS = 700;
/** ジャンケンの結果を見せる時間 */
const JANKEN_MS = 1300;

interface FighterView {
  root: HTMLElement;
  fill: HTMLElement;
  percent: HTMLElement;
}

function fighterBox(label: string): FighterView {
  const fill = h('div', { class: 'hp-fill' });
  const percent = h('div', { class: 'hp-num', text: '100%' });
  const root = h('div', { class: 'fighter-box' }, [
    h('div', { class: 'fighter-name', text: label }),
    h('div', { class: 'hp-bar' }, [fill]),
    percent,
  ]);
  return { root, fill, percent };
}

export function createOnlineBattleScene(ctx: SceneContext): Scene {
  const events = onlineState.lastEvents;
  const me = onlineState.me;
  const opponent = onlineState.opponent;
  if (!events || !me || !opponent) {
    ctx.go('menu');
    return { mount() {}, unmount() {} };
  }

  const stage = getStage();
  const stageHost = h('div', { class: 'stage3d' });
  const overlay = h('div', { class: 'grow' });
  const tagStack = h('div', { class: 'tag-stack' });
  const flash = h('div', { class: 'flash-white' });
  const message = h('div', { class: 'msg-band', text: S.matchReadyTitle });

  const youView = fighterBox(S.sideYou);
  const themView = fighterBox(S.sideOpponent);

  const mySide = onlineState.mySide;
  let myRig: CharacterRig | null = null;
  let opponentRig: CharacterRig | null = null;
  let disposed = false;

  const isMine = (side: PvpSide): boolean => side === mySide;
  const rigOf = (side: PvpSide): CharacterRig | null => (isMine(side) ? myRig : opponentRig);
  const statsOf = (side: PvpSide): Stats => (isMine(side) ? me.stats : opponent.stats);
  const viewOf = (side: PvpSide): FighterView => (isMine(side) ? youView : themView);

  function updateHp(side: PvpSide, hp: number): void {
    const view = viewOf(side);
    const percent = hpPercent(hp, statsOf(side).maxHp);
    const ratio = Math.max(0, Math.min(1, percent / 100));
    view.fill.style.transform = `scaleX(${ratio})`;
    view.fill.style.background = ratio > 0.5 ? '#43c26b' : ratio > 0.22 ? '#ffd93d' : '#ff6b6b';
    view.percent.textContent = `${percent}%`;
  }

  function popAt(rig: CharacterRig | null, node: HTMLElement, lift = 0): void {
    const rect = stageHost.getBoundingClientRect();
    let left = rect.width / 2;
    let top = rect.height / 2;
    if (rig) {
      const point = rig.centerWorld();
      point.y += lift;
      const projected = point.project(stage.camera);
      left = (projected.x * 0.5 + 0.5) * rect.width;
      top = (-projected.y * 0.5 + 0.5) * rect.height;
    }
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    overlay.append(node);
    setTimeout(() => node.remove(), 1200);
  }

  function showTag(text: string, variant: 'strong' | 'weak' | 'crit' = 'strong'): void {
    const node = h('div', { class: `effect-tag ${variant}`, text });
    tagStack.append(node);
    setTimeout(() => node.remove(), 1100);
  }

  function whiteFlash(soft = false): void {
    flash.classList.remove('on', 'soft');
    void flash.offsetWidth;
    flash.classList.toggle('soft', soft);
    flash.classList.add('on');
  }

  async function showCutin(): Promise<void> {
    const node = h('div', { class: 'cutin' }, [h('span', { text: S.critical })]);
    overlay.append(node);
    audio.play('critical');
    whiteFlash(true);
    await wait(CUTIN_MS);
    node.remove();
  }

  /** ターンの頭で、ふたりの手とジャンケンの結果を見せる */
  async function showJanken(event: Extract<PvpEvent, { type: 'turnStart' }>): Promise<void> {
    const myChoice = isMine('host') ? event.hostChoice : event.guestChoice;
    const theirChoice = isMine('host') ? event.guestChoice : event.hostChoice;
    const result =
      event.janken === 'draw'
        ? S.jankenDraw
        : isMine(event.janken)
          ? S.jankenYouWin
          : S.jankenTheyWin;

    message.textContent = `${S.turnLabels[event.turn]}`;
    const node = h('div', { class: 'janken-cutin' }, [
      h('div', { class: 'janken-hands' }, [
        h('span', { class: 'janken-hand', text: ELEMENT_INFO[myChoice].emoji }),
        h('span', { class: 'janken-vs', text: 'VS' }),
        h('span', { class: 'janken-hand', text: ELEMENT_INFO[theirChoice].emoji }),
      ]),
      h('div', { class: 'janken-result', text: result }),
    ]);
    overlay.append(node);
    audio.play('spinStop');
    await wait(JANKEN_MS);
    node.remove();
  }

  async function resolveImpact(event: Extract<PvpEvent, { type: 'attack' }>): Promise<void> {
    const defender = rigOf(event.target);

    if (event.result === 'dodge') {
      void defender?.play('dodge');
      audio.play('dodge');
      showTag(S.dodged, 'weak');
      return;
    }

    if (event.critical) {
      message.textContent = S.critical;
      await showCutin();
      if (disposed) return;
      showTag(S.critical, 'crit');
    }

    if (event.result === 'guard') {
      void defender?.play('guard');
      audio.play('guard');
      showTag(S.guarded, 'weak');
    } else {
      void defender?.play('hit');
    }

    if (event.elementMul === 2) showTag(S.superEffective, 'strong');
    else if (event.elementMul === 0.5) showTag(S.notEffective, 'weak');

    const damage = h('div', {
      class: event.critical ? 'dmg-pop crit' : 'dmg-pop',
      text: `-${event.damage}`,
    });
    popAt(rigOf(event.target), damage, 0.6);
    updateHp(event.target, event.hpAfter);
  }

  /** 攻撃1回ぶんの演出。攻撃の見た目は「選んだ手」で決まる */
  async function playAttack(
    event: Extract<PvpEvent, { type: 'attack' }>,
    element: Element,
  ): Promise<void> {
    const actor = rigOf(event.actor);
    const defender = rigOf(event.target);
    message.textContent = isMine(event.actor) ? 'きみの こうげき！' : 'あいての こうげき！';
    if (!actor) return;

    let resolved = false;
    let impact: Promise<void> = Promise.resolve();
    const impactOnce = () => {
      if (resolved || disposed) return;
      resolved = true;
      impact = resolveImpact(event);
    };

    actor.onEvent((name, self) => {
      if (name === 'projectile') {
        const from = self.muzzleWorld();
        const to = defender ? defender.centerWorld() : new THREE.Vector3(0, 1.4, 0);
        audio.play('hitPaper');
        stage.launchProjectile(from, to, self.headCanvas, impactOnce);
      }
      if (name === 'impact') {
        if (!event.critical) audio.play(hitSfxFor(element));
        impactOnce();
      }
    });

    await actor.play(attackActionFor(element));
    impactOnce();
    actor.onEvent(null);
    await impact;
    if (disposed) return;
    await wait(600);
  }

  async function playEvents(): Promise<void> {
    // ターンごとの手を覚えておく。攻撃の見た目と属性に使う
    let hostChoice: Element = 'rock';
    let guestChoice: Element = 'rock';

    for (const event of events!) {
      if (disposed) return;
      switch (event.type) {
        case 'turnStart':
          hostChoice = event.hostChoice;
          guestChoice = event.guestChoice;
          await showJanken(event);
          break;
        case 'attack':
          await playAttack(event, event.actor === 'host' ? hostChoice : guestChoice);
          break;
        case 'turnEnd':
          await wait(200);
          break;
        case 'end': {
          const iWon = event.winner === mySide;
          const drew = event.winner === 'draw';
          void rigOf(mySide)?.play(iWon || drew ? 'win' : 'lose', !iWon && !drew);
          void rigOf(onlineState.opponentSide)?.play(
            !iWon || drew ? 'win' : 'lose',
            iWon && !drew,
          );
          audio.play(drew ? 'win' : iWon ? 'champion' : 'lose');
          message.textContent = drew ? S.drawTitle : iWon ? S.winTitle : S.loseTitle;
          await wait(1800);
          if (disposed) return;
          ctx.go('onlineResult');
          return;
        }
      }
    }
  }

  return {
    mount(root) {
      root.append(
        h('div', { class: 'scene' }, [
          h('div', { class: 'battle-top' }, [youView.root, themView.root]),
          h('div', { class: 'stage3d grow' }, [stageHost, overlay, tagStack, flash]),
          message,
        ]),
      );

      stageHost.style.position = 'absolute';
      stageHost.style.inset = '0';
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.pointerEvents = 'none';
      overlay.style.overflow = 'hidden';

      stage.mount(stageHost);

      const mine = buildCharacter(me.analysis);
      mine.container.position.x = YOU_X;
      mine.setFacing(1);
      stage.addRig(mine);
      void mine.play('idle');
      myRig = mine;

      const theirs = buildCharacter(opponent.analysis);
      theirs.container.position.x = OPPONENT_X;
      theirs.setFacing(-1);
      stage.addRig(theirs);
      void theirs.play('idle');
      opponentRig = theirs;

      const height = Math.max(mine.height, theirs.height);
      const halfWidth = OPPONENT_X + Math.max(mine.halfWidth, theirs.halfWidth);
      stage.frame({ halfWidth, height, margin: height * 0.18 });

      updateHp('host', onlineState.isHost ? me.stats.maxHp : opponent.stats.maxHp);
      updateHp('guest', onlineState.isHost ? opponent.stats.maxHp : me.stats.maxHp);

      void playEvents();
    },

    unmount() {
      disposed = true;
      myRig = null;
      opponentRig = null;
      stage.unmount();
    },
  };
}
