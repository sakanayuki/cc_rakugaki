/**
 * 対戦相手ルーレット画面。
 *
 * 1〜4戦目: 通常敵6種（重み1.0）＋強敵3種（重み0.25）の重み付きルーレット。
 * 5戦目   : 強敵3種のみ。プレイヤーに不利な相手が50%、残りが25%ずつ。再抽選は不可。
 *
 * 止まる場所は押した瞬間に重み付き乱数で決めてから角度を逆算するので、演出と結果はズレない。
 */

import { audio } from '../app/audio';
import { gameState } from '../app/GameState';
import type { Scene, SceneContext } from '../app/SceneManager';
import { isDisadvantaged } from '../game/battleEngine';
import type { EnemyDef } from '../game/enemies';
import { NORMAL_ENEMIES, STRONG_ENEMIES, enemyStatsFor } from '../game/enemies';
import { systemRng } from '../game/rng';
import type { Stats } from '../game/stats';
import { starsFor } from '../game/stats';
import { getEnemyAssets } from '../rig/enemyAssets';
import { button, h, starString } from '../ui/components';
import { ELEMENT_INFO, S, streakLabel } from '../ui/strings';

/** 回転が止まるまでの時間（秒） */
const SPIN_DURATION = 2;
/** 止まるまでに最低何回転させるか */
const MIN_TURNS = 4;
/** 矢印が指している方向（真上） */
const POINTER_ANGLE = -Math.PI / 2;
/** 強敵のセクターは通常敵の1/4の面積にする */
const STRONG_WEIGHT = 0.25;
/** 最終戦で不利な相手に割り当てる重み（残り2体が1.0なので 2:1:1 = 50%:25%:25%） */
const FINAL_BAD_WEIGHT = 2;

interface Slot {
  enemy: EnemyDef;
  weight: number;
  /** 盤面ローカルでの開始角 */
  start: number;
  /** セクターの角度 */
  angle: number;
  stats: Stats;
  disadvantaged: boolean;
}

export function createRouletteScene(ctx: SceneContext): Scene {
  const canvas = h('canvas', { class: 'wheel-canvas' });
  const cardHost = h('div', {});
  const buttonRow = h('div', { class: 'row row-center' });

  const isFinal = gameState.isFinalBattle;
  const playerBase = gameState.baseStats;
  if (!playerBase) {
    // 通常ここには来ない（プレビューを経由しないとルーレットに入れない）
    ctx.go('menu');
    return { mount() {}, unmount() {} };
  }
  const playerElement = playerBase.element;
  const scale = gameState.enemyScale;

  /** 出走表を作る。最終戦は強敵のみ・不利な相手を厚くする */
  const slots: Slot[] = (() => {
    const entries: { enemy: EnemyDef; weight: number }[] = isFinal
      ? STRONG_ENEMIES.map((enemy) => ({
          enemy,
          weight: isDisadvantaged(playerElement, enemy.element) ? FINAL_BAD_WEIGHT : 1,
        }))
      : [
          ...NORMAL_ENEMIES.map((enemy) => ({ enemy, weight: 1 })),
          ...STRONG_ENEMIES.map((enemy) => ({ enemy, weight: STRONG_WEIGHT })),
        ];

    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = 0;
    return entries.map((entry) => {
      const angle = (Math.PI * 2 * entry.weight) / total;
      const slot: Slot = {
        enemy: entry.enemy,
        weight: entry.weight,
        start: cursor,
        angle,
        stats: enemyStatsFor(entry.enemy, playerBase, scale),
        disadvantaged: isDisadvantaged(playerElement, entry.enemy.element),
      };
      cursor += angle;
      return slot;
    });
  })();

  const thumbnails = slots.map((slot) => getEnemyAssets(slot.enemy.id).thumbnail);

  let rotation = -slots[0].angle / 2;
  let spinning = false;
  let frameHandle = 0;
  let disposed = false;
  let selected: number | null = null;
  let lastTickSector = -1;

  /** 重みに比例した抽選 */
  function pickSlot(): number {
    const total = slots.reduce((sum, slot) => sum + slot.weight, 0);
    let roll = systemRng.next() * total;
    for (let i = 0; i < slots.length; i++) {
      roll -= slots[i].weight;
      if (roll <= 0) return i;
    }
    return slots.length - 1;
  }

  /** 矢印の下に来ているセクター番号 */
  function sectorUnderPointer(): number {
    const twoPi = Math.PI * 2;
    const local = (((POINTER_ANGLE - rotation) % twoPi) + twoPi) % twoPi;
    for (let i = 0; i < slots.length; i++) {
      if (local >= slots[i].start && local < slots[i].start + slots[i].angle) return i;
    }
    return slots.length - 1;
  }

  function drawWheel(): void {
    const rect = canvas.getBoundingClientRect();
    const cssSize = Math.max(1, Math.min(rect.width, rect.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixels = Math.round(cssSize * ratio);
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssSize, cssSize);

    const center = cssSize / 2;
    const radius = center - 6;

    context.save();
    context.translate(center, center);

    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fillStyle = '#ffffff';
    context.fill();

    context.rotate(rotation);
    slots.forEach((slot, i) => {
      context.beginPath();
      context.moveTo(0, 0);
      context.arc(0, 0, radius - 10, slot.start, slot.start + slot.angle);
      context.closePath();
      context.fillStyle = slot.enemy.themeColor;
      context.fill();
      // 強敵は金のふち。当たったセクターはさらに太く
      const strong = slot.enemy.kind === 'strong';
      context.strokeStyle = i === selected ? '#ffd83d' : strong ? '#e0b422' : '#ffffff';
      context.lineWidth = i === selected ? 10 : strong ? 7 : 5;
      context.stroke();
    });

    // 各セクターに敵の絵と名前。
    // 強敵のセクターは1/4の幅しかないので、名前は入れずに王冠マークだけにする
    // （名前を書くと隣のセクターと重なって読めなくなる）。名前はカードで見せる。
    slots.forEach((slot, i) => {
      const mid = slot.start + slot.angle / 2;
      const narrow = slot.angle < 0.5;
      context.save();
      context.rotate(mid);

      const iconSize = radius * (narrow ? 0.14 : 0.34);
      const iconAt = radius * (narrow ? 0.7 : 0.56);
      context.drawImage(thumbnails[i], iconAt - iconSize / 2, -iconSize / 2, iconSize, iconSize);

      context.rotate(Math.PI / 2);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      if (narrow) {
        context.font = `${Math.max(11, radius * 0.075)}px system-ui, sans-serif`;
        context.fillText('👑', 0, -radius * 0.9);
      } else {
        // 強敵のセクター色は濃いので、文字は白にしないと読めない
        context.fillStyle = slot.enemy.kind === 'strong' ? '#ffffff' : '#3b3226';
        context.font = `800 ${Math.max(11, radius * 0.085)}px "Hiragino Maru Gothic ProN", system-ui, sans-serif`;
        context.fillText(slot.enemy.name, 0, -radius * 0.86);
      }
      context.restore();
    });

    context.beginPath();
    context.arc(0, 0, radius * 0.14, 0, Math.PI * 2);
    context.fillStyle = '#ffffff';
    context.fill();
    context.strokeStyle = '#e4d9c3';
    context.lineWidth = 4;
    context.stroke();
    context.restore();
  }

  function spin(): void {
    if (spinning) return;
    spinning = true;
    selected = null;
    cardHost.replaceChildren();
    renderButtons();

    const index = pickSlot();
    const slot = slots[index];
    const sectorCenter = slot.start + slot.angle / 2;
    let target = POINTER_ANGLE - sectorCenter;
    while (target < rotation + MIN_TURNS * Math.PI * 2) target += Math.PI * 2;

    const start = rotation;
    const startTime = performance.now();
    lastTickSector = sectorUnderPointer();

    const step = (now: number) => {
      if (disposed) return;
      const progress = Math.min(1, (now - startTime) / 1000 / SPIN_DURATION);
      rotation = start + (target - start) * (1 - (1 - progress) ** 3);
      drawWheel();

      const sector = sectorUnderPointer();
      if (sector !== lastTickSector) {
        lastTickSector = sector;
        audio.play('spinTick');
      }

      if (progress < 1) {
        frameHandle = requestAnimationFrame(step);
        return;
      }
      rotation = target;
      spinning = false;
      selected = index;
      drawWheel();
      audio.play(slot.disadvantaged ? 'warn' : 'spinStop');
      renderCard(index);
      renderButtons();
    };
    frameHandle = requestAnimationFrame(step);
  }

  function renderCard(index: number): void {
    const slot = slots[index];
    const info = ELEMENT_INFO[slot.enemy.element];
    const strong = slot.enemy.kind === 'strong';

    const meta = h('div', { class: 'enemy-meta' }, [
      h('span', { text: `${info.emoji} ${info.name}（${info.note}）` }),
      h('span', { text: `${S.statHp} ${starString(starsFor(slot.stats.maxHp, 'maxHp'))}` }),
      h('span', { text: `${S.statAtk} ${starString(starsFor(slot.stats.atk, 'atk'))}` }),
      h('span', { text: `${S.statSpd} ${starString(starsFor(slot.stats.spd, 'spd'))}` }),
      h('span', { text: slot.enemy.flavor }),
    ]);

    const card = h('div', { class: strong ? 'enemy-card strong' : 'enemy-card' }, [
      h('img', { alt: slot.enemy.name, src: thumbnails[index].toDataURL() }),
      h('div', {}, [
        h('div', { class: 'enemy-name' }, [
          h('span', { text: slot.enemy.name }),
          ...(strong ? [h('span', { class: 'strong-tag', text: S.strongTag })] : []),
        ]),
        meta,
      ]),
    ]);

    const children = slot.disadvantaged
      ? [
          h('div', { class: 'warn-banner' }, [
            h('div', { text: S.badMatchupTitle }),
            h('small', { text: S.badMatchupDetail }),
          ]),
          card,
        ]
      : [card];
    cardHost.replaceChildren(...children);
  }

  function renderButtons(): void {
    if (spinning) {
      buttonRow.replaceChildren(button(S.spinning, { size: 'huge', disabled: true }));
      return;
    }
    if (selected === null) {
      buttonRow.replaceChildren(button(S.spin, { variant: 'primary', size: 'huge', onClick: spin }));
      return;
    }
    const slot = slots[selected];
    const fight = button(S.fight, {
      variant: 'danger',
      size: 'huge',
      onClick: () => {
        gameState.enemyId = slot.enemy.id;
        ctx.go('battle', { enemyId: slot.enemy.id });
      },
    });
    // 最終戦は一発勝負。回し直せると不利50%の重み付けが無意味になる
    if (isFinal) {
      buttonRow.replaceChildren(fight);
      return;
    }
    buttonRow.replaceChildren(button(S.respin, { variant: 'ghost', onClick: spin }), fight);
  }

  function onResize(): void {
    drawWheel();
  }

  return {
    mount(root) {
      const title = isFinal
        ? S.finalRouletteTitle
        : gameState.winStreak > 0
          ? streakLabel(gameState.winStreak)
          : S.rouletteTitle;

      root.append(
        h('div', { class: 'scene' }, [
          h('div', { class: 'streak-banner', text: title }),
          h('div', { class: 'wheel-wrap' }, [
            h('div', { class: 'wheel-box' }, [h('div', { class: 'wheel-pointer', text: '🔻' }), canvas]),
          ]),
          cardHost,
          buttonRow,
        ]),
      );

      renderButtons();
      window.addEventListener('resize', onResize);
      requestAnimationFrame(() => drawWheel());
    },

    unmount() {
      disposed = true;
      if (frameHandle) cancelAnimationFrame(frameHandle);
      window.removeEventListener('resize', onResize);
    },
  };
}
