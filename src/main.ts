/** エントリポイント。6画面を登録してメインメニューから始める。 */

import './style.css';
import { audio } from './app/audio';
import { SceneManager } from './app/SceneManager';
import { createBattleScene } from './scenes/BattleScene';
import { createDrawScene } from './scenes/DrawScene';
import { createMenuScene } from './scenes/MenuScene';
import { createPreviewScene } from './scenes/PreviewScene';
import { createResultScene } from './scenes/ResultScene';
import { createRouletteScene } from './scenes/RouletteScene';
import { button, h } from './ui/components';
import { S } from './ui/strings';

const sceneRoot = document.getElementById('scene-root');
const muteButton = document.getElementById('mute-btn');
if (!sceneRoot) throw new Error('#scene-root が見つかりません');

const manager = new SceneManager(sceneRoot);
manager.register('menu', createMenuScene);
manager.register('draw', createDrawScene);
manager.register('preview', createPreviewScene);
manager.register('roulette', createRouletteScene);
manager.register('battle', createBattleScene);
manager.register('result', createResultScene);

// --- ミュート切り替え ---
if (muteButton instanceof HTMLButtonElement) {
  const sync = () => {
    muteButton.textContent = audio.isMuted ? '🔇' : '🔊';
  };
  sync();
  muteButton.addEventListener('click', () => {
    const muted = audio.toggleMute();
    sync();
    if (!muted) audio.play('tap');
  });
}

// --- ボタンのタップ音（最初の操作で AudioContext を起こす） ---
document.addEventListener(
  'pointerdown',
  (event) => {
    audio.unlock();
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tappable = target.closest('.btn, .tool-btn, .swatch');
    if (tappable && !(tappable instanceof HTMLButtonElement && tappable.disabled)) {
      audio.play('tap');
    }
  },
  { capture: true },
);

// --- 想定外のエラーで真っ白にならないようにする ---
function showCrashScreen(): void {
  if (document.querySelector('.crash-overlay')) return;
  const overlay = h('div', { class: 'overlay crash-overlay' }, [
    h('div', { class: 'dialog' }, [
      h('p', { text: 'ごめんね、うまく うごかなかったよ。\nメニューに もどるね。' }),
      h('div', { class: 'dialog-buttons' }, [
        button(S.toMenu, {
          variant: 'primary',
          onClick: () => {
            overlay.remove();
            manager.go('menu');
          },
        }),
      ]),
    ]),
  ]);
  document.body.append(overlay);
}

window.addEventListener('error', showCrashScreen);
window.addEventListener('unhandledrejection', showCrashScreen);

manager.go('menu');
