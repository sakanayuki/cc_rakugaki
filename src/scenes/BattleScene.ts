/**
 * 戦闘画面。
 * battleEngine が生成したイベント列を、順番に3Dの演出として再生していく。
 * プレイヤーの操作は「3往復して決着がつかなかったときの必殺技ボタン」だけ。
 */

import * as THREE from 'three';
import { audio, hitSfxFor } from '../app/audio';
import { gameState } from '../app/GameState';
import type { Scene, SceneContext, SceneParamMap } from '../app/SceneManager';
import { getStage } from '../app/Stage3D';
import type { BattleEvent, Side } from '../game/battleEngine';
import { Battle } from '../game/battleEngine';
import { enemyById } from '../game/enemies';
import { systemRng } from '../game/rng';
import type { Stats } from '../game/stats';
import { attackActionFor } from '../rig/animations';
import { getEnemyAssets } from '../rig/enemyAssets';
import type { CharacterRig } from '../rig/rigBuilder';
import { buildCharacter } from '../rig/rigBuilder';
import { h, wait } from '../ui/components';
import { ELEMENT_INFO, S, attackMessage, streakLabel } from '../ui/strings';

const PLAYER_X = -2;
const ENEMY_X = 2;

interface FighterView {
  root: HTMLElement;
  fill: HTMLElement;
  number: HTMLElement;
}

function fighterBox(name: string, stats: Stats): FighterView {
  const info = ELEMENT_INFO[stats.element];
  const fill = h('div', { class: 'hp-fill' });
  const number = h('div', { class: 'hp-num', text: `${stats.maxHp} / ${stats.maxHp}` });
  const root = h('div', { class: 'fighter-box' }, [
    h('div', { class: 'fighter-name', text: `${info.emoji} ${name}` }),
    h('div', { class: 'hp-bar' }, [fill]),
    number,
  ]);
  return { root, fill, number };
}

export function createBattleScene(ctx: SceneContext, params: SceneParamMap['battle']): Scene {
  const stage = getStage();
  const stageHost = h('div', { class: 'stage3d' });
  const overlay = h('div', { class: 'grow' });
  const flash = h('div', { class: 'flash-white' });
  const message = h('div', { class: 'msg-band', text: S.battleStart });

  const enemy = enemyById(params.enemyId);
  const playerStats = gameState.effectiveStats();
  const playerView = fighterBox('きみ', playerStats);
  const enemyView = fighterBox(enemy.name, enemy.stats);

  const battle = new Battle(
    { name: 'きみ', stats: playerStats },
    { name: enemy.name, stats: enemy.stats },
    systemRng,
  );

  let playerRig: CharacterRig | null = null;
  let enemyRig: CharacterRig | null = null;
  let disposed = false;
  let specialResolve: (() => void) | null = null;

  function rigOf(side: Side): CharacterRig | null {
    return side === 'player' ? playerRig : enemyRig;
  }

  function statsOf(side: Side): Stats {
    return side === 'player' ? playerStats : enemy.stats;
  }

  function viewOf(side: Side): FighterView {
    return side === 'player' ? playerView : enemyView;
  }

  function updateHp(side: Side, hp: number): void {
    const view = viewOf(side);
    const max = statsOf(side).maxHp;
    const ratio = Math.max(0, Math.min(1, hp / max));
    view.fill.style.transform = `scaleX(${ratio})`;
    view.fill.style.background = ratio > 0.5 ? '#43c26b' : ratio > 0.22 ? '#ffd93d' : '#ff6b6b';
    view.number.textContent = `${hp} / ${max}`;
  }

  /** 3D上の位置を画面座標に変換して、その場に要素を出す */
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

  function showDamage(side: Side, damage: number): void {
    popAt(rigOf(side), h('div', { class: 'dmg-pop', text: `-${damage}` }), 0.6);
  }

  function showTag(text: string, weak = false): void {
    const node = h('div', { class: weak ? 'effect-tag weak' : 'effect-tag', text });
    overlay.append(node);
    setTimeout(() => node.remove(), 1100);
  }

  function whiteFlash(): void {
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
  }

  /** 攻撃が当たった瞬間の処理（ダメージ表示・被弾モーション・HP更新） */
  function resolveImpact(event: Extract<BattleEvent, { type: 'attack' }>): void {
    const defender = rigOf(event.target);
    if (event.result === 'dodge') {
      void defender?.play('dodge');
      audio.play('dodge');
      showTag(S.dodged, true);
      return;
    }
    if (event.result === 'guard') {
      void defender?.play('guard');
      audio.play('guard');
      showTag(S.guarded, true);
    } else {
      void defender?.play('hit');
      audio.play(hitSfxFor(statsOf(event.actor).element));
    }
    if (event.elementMul === 2) showTag(S.superEffective);
    else if (event.elementMul === 0.5) showTag(S.notEffective, true);
    showDamage(event.target, event.damage);
    updateHp(event.target, event.hpAfter);
  }

  async function playAttack(event: Extract<BattleEvent, { type: 'attack' }>): Promise<void> {
    const actor = rigOf(event.actor);
    const defender = rigOf(event.target);
    message.textContent = attackMessage(event.actor === 'player', enemy.name);
    if (!actor) return;

    const element = statsOf(event.actor).element;
    let resolved = false;
    const impactOnce = () => {
      if (resolved || disposed) return;
      resolved = true;
      resolveImpact(event);
    };

    actor.onEvent((name, self) => {
      if (name === 'projectile') {
        const from = self.muzzleWorld();
        const to = defender ? defender.centerWorld() : new THREE.Vector3(0, 1.4, 0);
        audio.play('hitPaper');
        stage.launchProjectile(from, to, self.headCanvas, impactOnce);
      }
      if (name === 'impact') impactOnce();
    });

    await actor.play(attackActionFor(element));
    impactOnce();
    actor.onEvent(null);
    await wait(650);
  }

  async function playSpecial(): Promise<void> {
    const actor = playerRig;
    message.textContent = S.specialGo;
    audio.play('special');
    if (!actor) return;
    actor.onEvent((name) => {
      if (name === 'flash') whiteFlash();
    });
    await actor.play('special');
    actor.onEvent(null);
    void enemyRig?.play('hit');
    updateHp('enemy', 0);
    await wait(500);
  }

  /** 必殺技ボタンが押されるまで待つ */
  function waitForSpecial(): Promise<void> {
    message.textContent = S.specialReady;
    return new Promise<void>((resolve) => {
      specialResolve = resolve;
      const node = h('button', { class: 'btn btn-huge special-btn', type: 'button', text: S.special });
      node.addEventListener('click', () => {
        node.remove();
        specialResolve = null;
        resolve();
      });
      overlay.append(node);
    });
  }

  async function playEvents(events: BattleEvent[]): Promise<void> {
    for (const event of events) {
      if (disposed) return;
      switch (event.type) {
        case 'start':
          message.textContent = S.battleStart;
          await wait(900);
          break;
        case 'attack':
          await playAttack(event);
          break;
        case 'specialReady':
          await waitForSpecial();
          if (disposed) return;
          await playSpecial();
          if (disposed) return;
          await playEvents(battle.useSpecial());
          return;
        case 'special':
          break;
        case 'end':
          await finish(event.winner);
          return;
      }
    }
  }

  async function finish(winner: Side): Promise<void> {
    const winnerRig = rigOf(winner);
    const loserRig = rigOf(winner === 'player' ? 'enemy' : 'player');
    void winnerRig?.play('win');
    void loserRig?.play('lose', true);
    audio.play(winner === 'player' ? 'win' : 'lose');
    message.textContent = winner === 'player' ? S.winTitle : S.loseTitle;
    await wait(1800);
    if (disposed) return;
    ctx.go('result', {
      outcome: winner === 'player' ? 'win' : 'lose',
      enemyId: enemy.id,
    });
  }

  return {
    mount(root) {
      root.append(
        h('div', { class: 'scene' }, [
          h('div', { class: 'streak-banner', text: streakLabel(gameState.winStreak + 1) }),
          h('div', { class: 'battle-top' }, [playerView.root, enemyView.root]),
          h('div', { class: 'stage3d grow' }, [stageHost, overlay, flash]),
          message,
        ]),
      );

      // stage3d のなかに3Dキャンバスと演出用オーバーレイを重ねる
      stageHost.style.position = 'absolute';
      stageHost.style.inset = '0';
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.pointerEvents = 'none';
      overlay.style.overflow = 'hidden';

      stage.mount(stageHost);

      const analysis = gameState.analysis;
      if (analysis) {
        const rig = buildCharacter(analysis);
        rig.container.position.x = PLAYER_X;
        rig.setFacing(1);
        stage.addRig(rig);
        void rig.play('idle');
        playerRig = rig;
      }

      const enemyRigBuilt = buildCharacter(getEnemyAssets(enemy.id).analysis);
      enemyRigBuilt.container.position.x = ENEMY_X;
      enemyRigBuilt.setFacing(-1);
      stage.addRig(enemyRigBuilt);
      void enemyRigBuilt.play('idle');
      enemyRig = enemyRigBuilt;

      // 2体ぶんの幅と、踏み込み・ジャンプの動きぶんの余裕をとる
      const height = Math.max(playerRig?.height ?? 0, enemyRigBuilt.height);
      const halfWidth =
        ENEMY_X + Math.max(playerRig?.halfWidth ?? 0, enemyRigBuilt.halfWidth);
      stage.frame({ halfWidth, height, margin: height * 0.18 });

      updateHp('player', playerStats.maxHp);
      updateHp('enemy', enemy.stats.maxHp);

      void playEvents(battle.run());
    },

    unmount() {
      disposed = true;
      specialResolve?.();
      specialResolve = null;
      playerRig = null;
      enemyRig = null;
      stage.unmount();
    },
  };
}
