/**
 * 動作プレビュー画面。
 * 描いた絵から自動でリグを組み、4つのアクションを再生できる。
 * 同時に、絵から決まったパラメータ（たいりょく・こうげき・はやさ・ぞくせい）も確認する。
 *
 * 見た目は役割ごとに分ける:
 *   情報（押せない）  … 平らな白いパネル。影なし
 *   アクション（押せる）… 3Dステージに連結した1枚の操作パネル。4ボタンとも同じ色
 *   遷移（押せる）    … 画面下部に独立配置。大きく彩度の高い色
 */

import { audio, hitSfxFor } from '../app/audio';
import { gameState } from '../app/GameState';
import type { Scene, SceneContext } from '../app/SceneManager';
import { getStage } from '../app/Stage3D';
import { computeStats, starsFor } from '../game/stats';
import type { Stats } from '../game/stats';
import { CANVAS_SIZE } from '../paint/types';
import type { ActionName } from '../rig/animations';
import { attackActionFor } from '../rig/animations';
import { analyzeCharacter } from '../rig/partAnalyzer';
import type { CharacterRig } from '../rig/rigBuilder';
import { buildCharacter } from '../rig/rigBuilder';
import { button, h, starString } from '../ui/components';
import { ELEMENT_INFO, PREVIEW_HINTS, S, elementReason } from '../ui/strings';

/** ステータス1行分の表示を作る（押せない情報であることが分かる平らな見た目） */
function statRow(label: string, stars: number, value: number): HTMLElement {
  return h('div', { class: 'stat-row' }, [
    h('span', { class: 'stat-label', text: label }),
    h('span', { class: 'stars', text: starString(stars) }),
    h('span', { class: 'stat-value', text: String(value) }),
  ]);
}

export function createPreviewScene(ctx: SceneContext): Scene {
  const stage = getStage();
  const stageHost = h('div', { class: 'stage3d stage3d-attached' });

  let rig: CharacterRig | null = null;
  let busy = false;
  let manualRotation = 0;
  let dragging = false;
  let lastX = 0;

  const engine = gameState.engine;
  if (!engine) {
    // 通常ここには来ない（オエカキを経由しないとプレビューに入れない）
    ctx.go('menu');
    return { mount() {}, unmount() {} };
  }

  const analysis = analyzeCharacter(engine);
  gameState.analysis = analysis;
  const baseStats: Stats = computeStats({
    bodyArea: analysis.areas.body,
    armsArea: analysis.areas.arms,
    legsArea: analysis.areas.legs,
    canvasArea: CANVAS_SIZE * CANVAS_SIZE,
    colorCount: analysis.colorCount,
    headAspect: analysis.headAspect,
    headDensity: analysis.headDensity,
  });
  gameState.baseStats = baseStats;
  const stats = gameState.effectiveStats();

  function playAction(action: ActionName): void {
    const current = rig;
    if (!current || busy) return;
    busy = true;
    setButtonsEnabled(false);
    void current.play(action).then(() => {
      busy = false;
      setButtonsEnabled(true);
    });
  }

  // 4つとも同じトーナルボタン。「この領域の操作」であることを色ではなく配置で示す
  const actionButtons = [
    button(S.actAttack, {
      onClick: () => playAction(attackActionFor(stats.element)),
    }),
    button(S.actHit, { onClick: () => playAction('hit') }),
    button(S.actDodge, { onClick: () => playAction('dodge') }),
    button(S.actGuard, { onClick: () => playAction('guard') }),
  ];

  function setButtonsEnabled(enabled: boolean): void {
    for (const node of actionButtons) node.disabled = !enabled;
  }

  function onPointerDown(event: PointerEvent): void {
    dragging = true;
    lastX = event.clientX;
    stageHost.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging || !rig) return;
    manualRotation += (event.clientX - lastX) * 0.012;
    lastX = event.clientX;
    rig.container.rotation.y = manualRotation;
  }

  function onPointerUp(event: PointerEvent): void {
    dragging = false;
    if (stageHost.hasPointerCapture(event.pointerId)) {
      stageHost.releasePointerCapture(event.pointerId);
    }
  }

  const info = ELEMENT_INFO[stats.element];
  const hint = PREVIEW_HINTS[Math.floor(Math.random() * PREVIEW_HINTS.length)];

  return {
    mount(root) {
      root.append(
        h('div', { class: 'scene' }, [
          h('h2', { class: 'draw-title', text: S.previewTitle }),
          h('div', { class: 'preview-layout' }, [
            // 3Dステージと操作パネルを1かたまりに見せる
            h('div', { class: 'stage-group' }, [
              stageHost,
              h('div', { class: 'action-panel' }, [
                h('div', { class: 'action-panel-title', text: S.actionPanelTitle }),
                h('div', { class: 'action-row' }, actionButtons),
              ]),
            ]),
            h('div', { class: 'preview-side' }, [
              h('div', { class: 'stat-panel' }, [
                statRow(S.statHp, starsFor(stats.maxHp, 'maxHp'), stats.maxHp),
                statRow(S.statAtk, starsFor(stats.atk, 'atk'), stats.atk),
                statRow(S.statSpd, starsFor(stats.spd, 'spd'), stats.spd),
                // 属性も他のステータスと同じ行として並べる（バッジ状にしない）
                h('div', { class: 'stat-row' }, [
                  h('span', { class: 'stat-label', text: S.statElement }),
                  h('span', {
                    class: 'stat-element',
                    text: `${info.emoji} ${info.name}（${info.note}）`,
                  }),
                ]),
              ]),
              h('p', { class: 'hint-line', text: elementReason(stats.element) }),
              h('p', { class: 'hint-line', text: hint }),
            ]),
          ]),
          h('div', { class: 'draw-footer' }, [
            button(S.toDraw, { variant: 'ghost', onClick: () => ctx.go('draw', { resume: true }) }),
            button(S.toBattle, { variant: 'primary', onClick: () => ctx.go('roulette') }),
          ]),
          // オンライン対戦への唯一の入口。1人用と混ざらないよう段を分ける
          h('div', { class: 'row row-center' }, [
            button(S.toOnline, { variant: 'go', onClick: () => ctx.go('match') }),
          ]),
        ]),
      );

      stage.mount(stageHost);
      stageHost.append(h('div', { class: 'stage-hint', text: S.dragHint }));

      const built = buildCharacter(analysis);
      built.setFacing(1);
      // 描いた絵の大きさに合わせてカメラを引く（小さい絵でも大きい絵でも収まる）
      stage.frame({ halfWidth: built.halfWidth, height: built.height });
      built.onEvent((name, self) => {
        if (name === 'projectile') {
          const from = self.muzzleWorld();
          const to = from.clone();
          to.x += 4.5;
          to.y += 0.3;
          stage.launchProjectile(from, to, self.headCanvas);
          audio.play('hitPaper');
        }
        if (name === 'impact') audio.play(hitSfxFor(stats.element));
      });
      stage.addRig(built);
      rig = built;
      void built.play('idle');

      stageHost.addEventListener('pointerdown', onPointerDown);
      stageHost.addEventListener('pointermove', onPointerMove);
      stageHost.addEventListener('pointerup', onPointerUp);
      stageHost.addEventListener('pointercancel', onPointerUp);
    },

    unmount() {
      stageHost.removeEventListener('pointerdown', onPointerDown);
      stageHost.removeEventListener('pointermove', onPointerMove);
      stageHost.removeEventListener('pointerup', onPointerUp);
      stageHost.removeEventListener('pointercancel', onPointerUp);
      rig = null;
      stage.unmount();
    },
  };
}
