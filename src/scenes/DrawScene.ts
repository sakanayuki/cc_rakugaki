/**
 * オエカキ画面。
 * からだ → あたま → うで → あし の4ステップで、1パーツずつ描き足していく。
 * ツールは ペン色 / 太さ / ぬりつぶし / ひとつもどす / このパーツをやりなおし の5つ。
 */

import { audio } from '../app/audio';
import { gameState } from '../app/GameState';
import type { Scene, SceneContext, SceneParamMap } from '../app/SceneManager';
import { saveDoc } from '../app/storage';
import { PaintEngine } from '../paint/PaintEngine';
import type { PartId } from '../paint/types';
import {
  CANVAS_SIZE,
  COMPOSITE_ORDER,
  MIN_PART_PIXELS,
  PALETTE,
  PEN_WIDTHS,
  STEP_ORDER,
  createEmptyDoc,
} from '../paint/types';
import { button, confirmDialog, h } from '../ui/components';
import { S } from '../ui/strings';

/** ステップごとに表示する、うすい下書きガイド */
interface GuideShape {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

const GUIDES: Record<PartId, GuideShape[]> = {
  body: [{ cx: 512, cy: 570, rx: 170, ry: 165 }],
  head: [{ cx: 512, cy: 300, rx: 130, ry: 130 }],
  arms: [
    { cx: 320, cy: 560, rx: 78, ry: 150 },
    { cx: 704, cy: 560, rx: 78, ry: 150 },
  ],
  legs: [
    { cx: 445, cy: 800, rx: 65, ry: 110 },
    { cx: 579, cy: 800, rx: 65, ry: 110 },
  ],
};

type Tool = 'pen' | 'fill';

/** いま描いていないパーツの表示濃度。半透明にして現在の線を見分けやすくする */
const OTHER_PART_ALPHA = 0.5;

/** 角丸の正方形パス。roundRect が無い古いブラウザでは直角の四角で代用する */
function paperPath(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, size, size, 18);
  } else {
    context.rect(x, y, size, size);
  }
}

export function createDrawScene(ctx: SceneContext, params: SceneParamMap['draw']): Scene {
  const resume = params?.resume ?? false;

  const doc = gameState.doc ?? createEmptyDoc();
  gameState.doc = doc;
  const engine = new PaintEngine(doc);
  gameState.engine = engine;
  // 描き直したので、前の解析結果は無効
  gameState.analysis = null;

  let step: PartId = resolveStep();
  let tool: Tool = 'pen';
  let color = PALETTE[0].color;
  let width = PEN_WIDTHS[1];

  let drawing = false;
  let dirty = true;
  let frameHandle = 0;
  let disposed = false;
  let toastTimer = 0;

  const canvas = h('canvas', { class: 'paint-canvas' });
  const titleNode = h('h2', { class: 'draw-title' });
  const hintNode = h('p', { class: 'hint-line' });
  const dots = STEP_ORDER.map(() => h('div', { class: 'step-dot' }));
  const nextButton = button(S.next, { variant: 'go', onClick: goNext });
  const backButton = button(S.back, { variant: 'ghost', onClick: goBack });
  const undoButton = toolButton('↩️', S.toolUndo, () => {
    if (engine.undo(step)) {
      audio.play('tap');
      refresh();
    }
  });
  const resetButton = toolButton('🗑', S.toolReset, async () => {
    if (!engine.hasOps(step)) return;
    const ok = await confirmDialog(S.confirmResetPart);
    if (!ok) return;
    engine.clearPart(step);
    refresh();
  });

  const swatches = PALETTE.map((entry) =>
    h('button', {
      class: 'swatch',
      type: 'button',
      'aria-label': entry.name,
      style: `background:${entry.color}`,
      onclick: () => {
        color = entry.color;
        syncTools();
      },
    }),
  );

  const widthButtons = PEN_WIDTHS.map((value, index) => {
    const label = [S.widthThin, S.widthMid, S.widthFat][index];
    const node = h('button', { class: 'tool-btn', type: 'button', 'aria-label': label }, [
      h('span', {
        class: 'width-dot',
        style: `width:${6 + index * 7}px;height:${6 + index * 7}px`,
      }),
      h('small', { text: label }),
    ]);
    node.addEventListener('click', () => {
      width = value;
      syncTools();
    });
    return node;
  });

  const penButton = toolButton('✏️', S.toolPen, () => {
    tool = 'pen';
    syncTools();
  });
  const fillButton = toolButton('🪣', S.toolFill, () => {
    tool = 'fill';
    syncTools();
  });

  function toolButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const node = h('button', { class: 'tool-btn', type: 'button', 'aria-label': label }, [
      h('span', { text: icon }),
      h('small', { text: label }),
    ]);
    node.addEventListener('click', onClick);
    return node;
  }

  /** 保存された進行位置から、開くステップを決める */
  function resolveStep(): PartId {
    if (!resume) return 'body';
    if (doc.currentStep === 'done') return 'legs';
    return doc.currentStep;
  }

  // ---------------------------------------------------------------- 描画

  /**
   * キャンバス要素の中央に取れる最大の正方形。
   * 画面が縦長でも横長でも、描画面は必ず正方形にする（絵が歪まないように）。
   */
  function squareArea(rect: DOMRect): { side: number; left: number; top: number } {
    const side = Math.min(rect.width, rect.height);
    return { side, left: (rect.width - side) / 2, top: (rect.height - side) / 2 };
  }

  function toLogical(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const area = squareArea(rect);
    const clamp = (value: number) => Math.max(0, Math.min(CANVAS_SIZE, value));
    return {
      x: clamp(((event.clientX - rect.left - area.left) / area.side) * CANVAS_SIZE),
      y: clamp(((event.clientY - rect.top - area.top) / area.side) * CANVAS_SIZE),
    };
  }

  function render(): void {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(rect.width * ratio);
    const pixelHeight = Math.round(rect.height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);

    const area = squareArea(rect);
    context.save();
    context.translate(area.left, area.top);

    // 画用紙（正方形）
    paperPath(context, 0, 0, area.side);
    context.fillStyle = '#fffdf5';
    context.fill();
    context.save();
    context.clip();

    // 下書きガイド（今のステップのぶんだけ）
    const scale = area.side / CANVAS_SIZE;
    context.save();
    context.scale(scale, scale);
    context.strokeStyle = 'rgba(120, 110, 95, 0.35)';
    context.lineWidth = 6;
    context.setLineDash([22, 18]);
    for (const guide of GUIDES[step]) {
      context.beginPath();
      context.ellipse(guide.cx, guide.cy, guide.rx, guide.ry, 0, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();

    // いま描いているパーツ以外は半透明にする。
    // さらに現在パーツを最前面に描くことで、合成順で後ろになるステップ（あし等）でも
    // 「いま引いた線」が必ず見えるようにする。
    context.globalAlpha = OTHER_PART_ALPHA;
    for (const part of COMPOSITE_ORDER) {
      if (part === step) continue;
      context.drawImage(engine.layerOf(part), 0, 0, area.side, area.side);
    }
    context.globalAlpha = 1;
    context.drawImage(engine.layerOf(step), 0, 0, area.side, area.side);
    context.restore();

    // 画用紙のふち
    paperPath(context, 1.5, 1.5, area.side - 3);
    context.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    context.lineWidth = 3;
    context.stroke();
    context.restore();
  }

  function loop(): void {
    if (disposed) return;
    frameHandle = requestAnimationFrame(loop);
    if (!dirty) return;
    dirty = false;
    render();
  }

  function invalidate(): void {
    dirty = true;
  }

  /** ヒント欄を一時的に警告文に差し替える */
  function toast(message: string): void {
    if (toastTimer) clearTimeout(toastTimer);
    hintNode.textContent = message;
    hintNode.classList.add('hint-warn');
    toastTimer = window.setTimeout(() => {
      toastTimer = 0;
      hintNode.classList.remove('hint-warn');
      hintNode.textContent = S.stepHint[step];
    }, 1800);
  }

  // ---------------------------------------------------------------- 入力

  function onPointerDown(event: PointerEvent): void {
    if (!event.isPrimary) return;
    audio.unlock();
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const point = toLogical(event);

    if (tool === 'fill') {
      const outcome = engine.fillAt(step, point.x, point.y, color);
      audio.play(outcome === 'ok' ? 'fill' : 'nope');
      if (outcome === 'blocked') toast(S.fillBlocked);
      else if (outcome === 'too-large') toast(S.fillTooLarge);
      refresh();
      return;
    }
    drawing = true;
    engine.beginStroke(step, color, width, point.x, point.y);
    invalidate();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drawing) return;
    event.preventDefault();
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    for (const sample of events.length > 0 ? events : [event]) {
      const point = toLogical(sample);
      engine.extendStroke(point.x, point.y);
    }
    invalidate();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drawing) return;
    drawing = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    engine.endStroke();
    refresh();
  }

  // ---------------------------------------------------------------- 進行

  function currentIndex(): number {
    return STEP_ORDER.indexOf(step);
  }

  function goNext(): void {
    if (engine.partPixelCount(step) < MIN_PART_PIXELS) return;
    audio.play('step');
    const index = currentIndex();
    if (index >= STEP_ORDER.length - 1) {
      doc.currentStep = 'done';
      saveDoc(doc);
      ctx.go('preview');
      return;
    }
    step = STEP_ORDER[index + 1];
    doc.currentStep = step;
    saveDoc(doc);
    refresh();
  }

  function goBack(): void {
    const index = currentIndex();
    if (index <= 0) {
      ctx.go('menu');
      return;
    }
    step = STEP_ORDER[index - 1];
    doc.currentStep = step;
    saveDoc(doc);
    refresh();
  }

  // ---------------------------------------------------------------- 表示更新

  function syncTools(): void {
    for (let i = 0; i < swatches.length; i++) {
      swatches[i].classList.toggle('selected', PALETTE[i].color === color);
    }
    for (let i = 0; i < widthButtons.length; i++) {
      widthButtons[i].classList.toggle('selected', PEN_WIDTHS[i] === width);
    }
    penButton.classList.toggle('selected', tool === 'pen');
    fillButton.classList.toggle('selected', tool === 'fill');
  }

  /** ステップ・ツール・ボタンの有効状態をまとめて更新する */
  function refresh(): void {
    titleNode.textContent = S.stepTitle[step];
    if (!toastTimer) hintNode.textContent = S.stepHint[step];

    const index = currentIndex();
    dots.forEach((dot, i) => {
      dot.classList.toggle('done', i < index);
      dot.classList.toggle('current', i === index);
    });

    const enough = engine.partPixelCount(step) >= MIN_PART_PIXELS;
    nextButton.disabled = !enough;
    nextButton.textContent = enough
      ? index >= STEP_ORDER.length - 1
        ? S.toBattle
        : S.next
      : S.drawSomething;
    undoButton.disabled = !engine.hasOps(step);
    resetButton.disabled = !engine.hasOps(step);

    syncTools();
    invalidate();
  }

  return {
    mount(root) {
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);

      root.append(
        h('div', { class: 'scene' }, [
          h('div', { class: 'draw-header' }, [
            h('div', { class: 'step-dots' }, dots),
            titleNode,
          ]),
          hintNode,
          h('div', { class: 'draw-body' }, [
            h('div', { class: 'canvas-wrap' }, [canvas]),
            h('div', { class: 'toolbar' }, [
              h('div', { class: 'tool-row' }, [h('div', { class: 'palette' }, swatches)]),
              h('div', { class: 'tool-row' }, [
                // 同じ種類の選択肢はM3の連結ボタングループにまとめる。
                // 「道具えらび」と「ふとさえらび」は別の選択なので、群も分ける
                h('div', { class: 'btn-group' }, [penButton, fillButton]),
                h('div', { class: 'btn-group' }, widthButtons),
                // 取り消し系は選択ではないので、群に入れず単独で置く
                undoButton,
                resetButton,
              ]),
            ]),
          ]),
          h('div', { class: 'draw-footer' }, [backButton, nextButton]),
        ]),
      );

      refresh();
      loop();
      // レイアウト確定後にもう一度描き直す
      requestAnimationFrame(invalidate);
    },

    unmount() {
      disposed = true;
      if (toastTimer) clearTimeout(toastTimer);
      if (frameHandle) cancelAnimationFrame(frameHandle);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    },
  };
}
