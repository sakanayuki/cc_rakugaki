/** メインメニュー画面。あたらしく描くか、前回の絵の続きから。 */

import { gameState } from '../app/GameState';
import type { Scene, SceneContext } from '../app/SceneManager';
import { loadDoc } from '../app/storage';
import { button, confirmDialog, h } from '../ui/components';
import { S } from '../ui/strings';
import { thumbnailFromDoc } from '../paint/thumbnail';
import { createEmptyDoc } from '../paint/types';

/** メニューに出す絵のプレビューの一辺（px） */
const THUMBNAIL_SIZE = 72;

export function createMenuScene(ctx: SceneContext): Scene {
  return {
    mount(root) {
      // メニューに戻った時点で連勝チャレンジはリセットされる
      gameState.resetRun();

      const savedDoc = loadDoc();
      const saveExists = savedDoc !== null;
      // 保存された絵のサムネイル。生成に使ったエンジンは thumbnailFromDoc 内で解放される
      const thumbnail = savedDoc ? thumbnailFromDoc(savedDoc, THUMBNAIL_SIZE * 2) : null;

      const newButton = button(S.menuNew, {
        variant: 'primary',
        size: 'huge',
        onClick: async () => {
          if (saveExists) {
            const ok = await confirmDialog(S.menuOverwrite);
            if (!ok) return;
          }
          gameState.clearCharacter();
          gameState.doc = createEmptyDoc();
          ctx.go('draw', { resume: false });
        },
      });

      const continueButton = button(saveExists ? S.menuContinue : S.menuNoSave, {
        variant: 'go',
        size: 'huge',
        disabled: !saveExists,
        onClick: () => {
          if (!savedDoc) return;
          gameState.clearCharacter();
          gameState.doc = savedDoc;
          ctx.go('draw', { resume: true });
        },
      });

      // セーブがあるときだけ、ボタンの横に小さく絵を出す。
      // 殿堂入りで名前をつけていれば、その下に名前も添える
      const savedName = savedDoc?.name;
      const continueRow = thumbnail
        ? h('div', { class: 'continue-row' }, [
            h('div', { class: 'save-thumb-col' }, [
              h('div', { class: 'save-thumb' }, [
                h('img', {
                  alt: savedName ?? S.menuContinue,
                  src: thumbnail.toDataURL(),
                  width: String(THUMBNAIL_SIZE),
                  height: String(THUMBNAIL_SIZE),
                }),
              ]),
              ...(savedName ? [h('span', { class: 'save-name', text: savedName })] : []),
            ]),
            continueButton,
          ])
        : continueButton;

      root.append(
        h('div', { class: 'scene scene-center' }, [
          h('h1', { class: 'menu-logo', text: S.appTitle }),
          h('p', { class: 'menu-sub', text: S.appSub }),
          h('div', { class: 'menu-buttons' }, [newButton, continueRow]),
          h('p', { class: 'menu-hint', text: S.menuHint }),
        ]),
      );
    },

    unmount() {
      /* 後片付けは不要 */
    },
  };
}
