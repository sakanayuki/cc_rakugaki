/**
 * 殿堂入り画面。5連勝したときだけ入れる。
 * キャラクターに名前をつけて、記念写真（JPEG）を持ち帰るための画面。
 */

import { audio } from '../app/audio';
import { gameState } from '../app/GameState';
import type { Scene, SceneContext } from '../app/SceneManager';
import { saveDoc } from '../app/storage';
import type { CharacterDoc } from '../paint/types';
import { MAX_NAME_LENGTH } from '../paint/types';
import { renderCertificate } from '../photo/certificate';
import { dateStamp, sanitizeFileName, saveCanvasAsJpeg } from '../photo/saveImage';
import { button, h } from '../ui/components';
import { S } from '../ui/strings';

/** 入力してから写真を描き直すまでの待ち時間 */
const REDRAW_DEBOUNCE_MS = 200;

export function createHallOfFameScene(ctx: SceneContext): Scene {
  if (!gameState.doc) {
    // 通常ここには来ない（5連勝しないと入れない）
    ctx.go('menu');
    return { mount() {}, unmount() {} };
  }
  // 以降は必ず絵がある。クロージャの中でも null でないことを保ちたいので束縛し直す
  const doc: CharacterDoc = gameState.doc;

  const photo = h('img', { class: 'photo-preview', alt: S.hallTitle });
  const status = h('p', { class: 'hint-line', text: S.hallMaking });
  const nameInput = h('input', {
    class: 'name-input',
    type: 'text',
    maxlength: String(MAX_NAME_LENGTH),
    placeholder: S.hallNamePlaceholder,
    value: doc.name ?? '',
    'aria-label': S.hallNamePrompt,
  });

  let canvas: HTMLCanvasElement | null = null;
  let redrawTimer = 0;
  let disposed = false;

  /** 入力が空なら既定名を使う */
  function currentName(): string {
    const typed = nameInput.value.trim().slice(0, MAX_NAME_LENGTH);
    return typed.length > 0 ? typed : S.defaultCharacterName;
  }

  function redraw(): void {
    if (disposed) return;
    canvas = renderCertificate({ doc, name: currentName() });
    photo.src = canvas.toDataURL('image/jpeg', 0.92);
  }

  /** 入力のたびに描き直すと重いので、少し待ってからまとめて描く */
  function scheduleRedraw(): void {
    if (redrawTimer) clearTimeout(redrawTimer);
    redrawTimer = window.setTimeout(() => {
      redrawTimer = 0;
      // 入力された名前は絵と一緒に保存する
      const typed = nameInput.value.trim().slice(0, MAX_NAME_LENGTH);
      if (typed.length > 0) doc.name = typed;
      else delete doc.name;
      saveDoc(doc);
      redraw();
    }, REDRAW_DEBOUNCE_MS);
  }

  async function onSave(): Promise<void> {
    // 写真ができる前に押されたら、その場で作ってから保存する
    if (!canvas) redraw();
    if (!canvas) return;
    const fileName = `rakugaki-${sanitizeFileName(currentName())}-${dateStamp()}.jpg`;
    status.textContent = S.hallMaking;
    const outcome = await saveCanvasAsJpeg(canvas, fileName, S.hallTitle);
    if (disposed) return;
    if (outcome === 'shared' || outcome === 'downloaded') {
      status.textContent = S.hallSaved;
      audio.play('shutter');
    } else {
      // キャンセル・非対応どちらも、長押しで保存できることを伝える
      status.textContent = S.hallLongPress;
    }
  }

  return {
    mount(root) {
      nameInput.addEventListener('input', scheduleRedraw);

      root.append(
        h('div', { class: 'scene' }, [
          h('h1', { class: 'result-title', text: S.hallTitle }),
          h('div', { class: 'photo-wrap' }, [photo]),
          h('div', { class: 'name-row' }, [
            h('label', { class: 'name-label', text: S.hallNamePrompt }),
            nameInput,
          ]),
          status,
          h('div', { class: 'row row-center' }, [
            button(S.toMenu, { variant: 'ghost', onClick: () => ctx.go('menu') }),
            button(S.hallSave, { variant: 'primary', size: 'huge', onClick: () => void onSave() }),
          ]),
        ]),
      );

      audio.play('hall');
      // 1080x1080 の生成は少し重いので、画面が一度描画されてから作る
      // （rAF のコールバックは描画の直前に走るので、そこから setTimeout でもう一段ずらす）
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (disposed) return;
          redraw();
          status.textContent = S.hallLongPress;
        }, 0);
      });
    },

    unmount() {
      disposed = true;
      if (redrawTimer) clearTimeout(redrawTimer);
      nameInput.removeEventListener('input', scheduleRedraw);
    },
  };
}
