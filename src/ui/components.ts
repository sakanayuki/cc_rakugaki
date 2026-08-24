/**
 * DOM生成のための小さなヘルパー群。UIフレームワークは使わない。
 */

import { S } from './strings';

type Attrs = Record<string, unknown> & {
  class?: string;
  text?: string;
  style?: string;
};

/** 要素を属性・子ノードつきで作る */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'style') {
      node.setAttribute('style', String(value));
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

export interface ButtonOptions {
  variant?: 'default' | 'primary' | 'go' | 'danger' | 'ghost';
  size?: 'normal' | 'huge' | 'small';
  class?: string;
  disabled?: boolean;
  onClick?: () => void;
}

/** ゲーム用の大きなボタン */
export function button(label: string, opts: ButtonOptions = {}): HTMLButtonElement {
  const classes = ['btn'];
  if (opts.variant && opts.variant !== 'default') classes.push(`btn-${opts.variant}`);
  if (opts.size === 'huge') classes.push('btn-huge');
  if (opts.size === 'small') classes.push('btn-small');
  if (opts.class) classes.push(opts.class);

  const node = h('button', {
    class: classes.join(' '),
    type: 'button',
    text: label,
  });
  if (opts.disabled) node.disabled = true;
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  return node;
}

/**
 * 「うん / やめる」の確認ダイアログ。
 * 破壊的な操作（絵を消す等）の前に必ず挟む。
 */
export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (answer: boolean) => {
      overlay.remove();
      resolve(answer);
    };
    const yes = button(S.yes, { variant: 'go', onClick: () => close(true) });
    const no = button(S.no, { variant: 'ghost', onClick: () => close(false) });
    const overlay = h('div', { class: 'overlay' }, [
      h('div', { class: 'dialog' }, [
        h('p', { style: 'white-space: pre-line', text: message }),
        h('div', { class: 'dialog-buttons' }, [no, yes]),
      ]),
    ]);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(false);
    });
    document.body.append(overlay);
  });
}

/** 1〜5個の星文字列（満たない分は白星） */
export function starString(filled: number, total = 5): string {
  const n = Math.max(0, Math.min(total, Math.round(filled)));
  return '★'.repeat(n) + '☆'.repeat(total - n);
}

/** 指定ミリ秒待つ */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
