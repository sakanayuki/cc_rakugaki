/**
 * オンライン対戦の通信ログ。
 *
 * 実機（スマホ）ではブラウザのコンソールが見られないので、
 * 画面に出して不具合を追えるようにするためのもの。
 */

const MAX_LINES = 80;
const lines: string[] = [];
const handlers = new Set<(lines: string[]) => void>();

const started = Date.now();

/** 1行足す。先頭に経過秒をつける */
export function netLog(text: string): void {
  const seconds = ((Date.now() - started) / 1000).toFixed(1).padStart(5, ' ');
  lines.push(`${seconds}s ${text}`);
  if (lines.length > MAX_LINES) lines.shift();
  for (const handler of handlers) handler([...lines]);
}

export function netLogLines(): string[] {
  return [...lines];
}

export function clearNetLog(): void {
  lines.length = 0;
  for (const handler of handlers) handler([]);
}

/** 表示側が購読する。戻り値を呼ぶと解除 */
export function onNetLog(handler: (lines: string[]) => void): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
