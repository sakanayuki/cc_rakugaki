/**
 * 対戦相手ルーレット画面。
 * スタートを押すと回りはじめ、2秒かけて減速して勝手に止まる。
 * 止まる場所は押した瞬間に乱数で決めてから逆算するので、演出と結果はズレない。
 * 再抽選は何度でもできる（同じ相手との連戦も許容）。
 */

import { audio } from '../app/audio';
import { gameState } from '../app/GameState';
import type { Scene, SceneContext } from '../app/SceneManager';
import { ENEMIES } from '../game/enemies';
import { randInt, systemRng } from '../game/rng';
import { starsFor } from '../game/stats';
import { getEnemyAssets } from '../rig/enemyAssets';
import { button, h, starString } from '../ui/components';
import { ELEMENT_INFO, S, streakLabel } from '../ui/strings';

/** 回転が止まるまでの時間（秒） */
const SPIN_DURATION = 2;
/** 止まるまでに最低何回転させるか */
const MIN_TURNS = 4;
const SECTOR_COUNT = ENEMIES.length;
const SECTOR_ANGLE = (Math.PI * 2) / SECTOR_COUNT;
/** 矢印が指している方向（真上） */
const POINTER_ANGLE = -Math.PI / 2;

export function createRouletteScene(ctx: SceneContext): Scene {
  const canvas = h('canvas', { class: 'wheel-canvas' });
  const cardHost = h('div', {});
  const buttonRow = h('div', { class: 'row row-center' });

  let rotation = -SECTOR_ANGLE / 2;
  let spinning = false;
  let frameHandle = 0;
  let disposed = false;
  let selectedIndex: number | null = null;
  let lastTickSector = -1;

  const thumbnails = ENEMIES.map((enemy) => getEnemyAssets(enemy.id).thumbnail);

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

    // 外周のふち
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fillStyle = '#ffffff';
    context.fill();

    context.rotate(rotation);
    for (let i = 0; i < SECTOR_COUNT; i++) {
      const start = i * SECTOR_ANGLE;
      context.beginPath();
      context.moveTo(0, 0);
      context.arc(0, 0, radius - 10, start, start + SECTOR_ANGLE);
      context.closePath();
      context.fillStyle = ENEMIES[i].themeColor;
      context.fill();
      // 当たったセクターだけ金色のふちで目立たせる
      const chosen = i === selectedIndex;
      context.strokeStyle = chosen ? '#ffd83d' : '#ffffff';
      context.lineWidth = chosen ? 10 : 5;
      context.stroke();
    }

    // 各セクターに敵の絵と名前
    for (let i = 0; i < SECTOR_COUNT; i++) {
      const angle = (i + 0.5) * SECTOR_ANGLE;
      context.save();
      context.rotate(angle);
      const iconSize = radius * 0.34;
      context.drawImage(
        thumbnails[i],
        radius * 0.56 - iconSize / 2,
        -iconSize / 2,
        iconSize,
        iconSize,
      );
      context.rotate(Math.PI / 2);
      context.fillStyle = '#3b3226';
      context.font = `800 ${Math.max(11, radius * 0.085)}px "Hiragino Maru Gothic ProN", system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(ENEMIES[i].name, 0, -radius * 0.86);
      context.restore();
    }

    // 中心のつまみ
    context.beginPath();
    context.arc(0, 0, radius * 0.14, 0, Math.PI * 2);
    context.fillStyle = '#ffffff';
    context.fill();
    context.strokeStyle = '#e4d9c3';
    context.lineWidth = 4;
    context.stroke();
    context.restore();
  }

  /** 矢印の下に来ているセクター番号 */
  function sectorUnderPointer(): number {
    const normalized = ((POINTER_ANGLE - rotation) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(normalized / SECTOR_ANGLE) % SECTOR_COUNT;
  }

  function spin(): void {
    if (spinning) return;
    spinning = true;
    selectedIndex = null;
    cardHost.replaceChildren();
    renderButtons();

    const index = randInt(systemRng, SECTOR_COUNT);
    const sectorCenter = (index + 0.5) * SECTOR_ANGLE;
    // 矢印の位置にそのセクターの中心が来る回転角を求め、そこに4回転ぶん足す
    let target = POINTER_ANGLE - sectorCenter;
    while (target < rotation + MIN_TURNS * Math.PI * 2) target += Math.PI * 2;

    const start = rotation;
    const startTime = performance.now();
    lastTickSector = sectorUnderPointer();

    const step = (now: number) => {
      if (disposed) return;
      const elapsed = (now - startTime) / 1000;
      const progress = Math.min(1, elapsed / SPIN_DURATION);
      const eased = 1 - (1 - progress) ** 3;
      rotation = start + (target - start) * eased;
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
      drawWheel();
      spinning = false;
      selectedIndex = index;
      audio.play('spinStop');
      renderCard(index);
      renderButtons();
    };
    frameHandle = requestAnimationFrame(step);
  }

  function renderCard(index: number): void {
    const enemy = ENEMIES[index];
    const info = ELEMENT_INFO[enemy.stats.element];
    const image = h('img', { alt: enemy.name, src: thumbnails[index].toDataURL() });
    cardHost.replaceChildren(
      h('div', { class: 'enemy-card' }, [
        image,
        h('div', {}, [
          h('div', { class: 'enemy-name', text: enemy.name }),
          h('div', { class: 'enemy-meta' }, [
            h('span', { text: `${info.emoji} ${info.name}（${info.note}）` }),
            h('span', { text: `${S.statHp} ${starString(starsFor(enemy.stats.maxHp, 'maxHp'))}` }),
            h('span', { text: `${S.statAtk} ${starString(starsFor(enemy.stats.atk, 'atk'))}` }),
            h('span', { text: `${S.statSpd} ${starString(starsFor(enemy.stats.spd, 'spd'))}` }),
            h('span', { text: enemy.flavor }),
          ]),
        ]),
      ]),
    );
  }

  function renderButtons(): void {
    if (spinning) {
      buttonRow.replaceChildren(button(S.spinning, { size: 'huge', disabled: true }));
      return;
    }
    if (selectedIndex === null) {
      buttonRow.replaceChildren(button(S.spin, { variant: 'primary', size: 'huge', onClick: spin }));
      return;
    }
    const enemy = ENEMIES[selectedIndex];
    buttonRow.replaceChildren(
      button(S.respin, { variant: 'ghost', onClick: spin }),
      button(S.fight, {
        variant: 'danger',
        size: 'huge',
        onClick: () => {
          gameState.enemyId = enemy.id;
          ctx.go('battle', { enemyId: enemy.id });
        },
      }),
    );
  }

  function onResize(): void {
    drawWheel();
  }

  return {
    mount(root) {
      const banner = h('div', {
        class: 'streak-banner',
        text: gameState.winStreak > 0 ? streakLabel(gameState.winStreak) : S.rouletteTitle,
      });

      root.append(
        h('div', { class: 'scene' }, [
          banner,
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
