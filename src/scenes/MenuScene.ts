/** メインメニュー画面。あたらしく描くか、前回の絵の続きから。 */

import { gameState } from '../app/GameState';
import type { Scene, SceneContext } from '../app/SceneManager';
import { hasSave, loadDoc } from '../app/storage';
import { button, confirmDialog, h } from '../ui/components';
import { S } from '../ui/strings';
import { createEmptyDoc } from '../paint/types';

export function createMenuScene(ctx: SceneContext): Scene {
  return {
    mount(root) {
      // メニューに戻った時点で連勝チャレンジはリセットされる
      gameState.resetRun();

      const saveExists = hasSave();

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
          const doc = loadDoc();
          if (!doc) return;
          gameState.clearCharacter();
          gameState.doc = doc;
          ctx.go('draw', { resume: true });
        },
      });

      root.append(
        h('div', { class: 'scene scene-center' }, [
          h('h1', { class: 'menu-logo', text: S.appTitle }),
          h('p', { class: 'menu-sub', text: S.appSub }),
          h('div', { class: 'menu-buttons' }, [newButton, continueButton]),
          h('p', { class: 'menu-hint', text: S.menuHint }),
        ]),
      );
    },

    unmount() {
      /* 後片付けは不要 */
    },
  };
}
