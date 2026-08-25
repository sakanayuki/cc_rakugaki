import { beforeEach, describe, expect, it } from 'vitest';
import { clearSave, loadDoc, saveDoc } from './storage';
import { CANVAS_SIZE, MAX_NAME_LENGTH, createEmptyDoc } from '../paint/types';

/** node 環境には localStorage が無いので最小限のものを用意する */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const SAVE_KEY = 'rakugaki.save.v1';

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

describe('セーブデータの名前フィールド', () => {
  it('名前をつけて保存すると読み戻せる', () => {
    const doc = createEmptyDoc();
    doc.name = 'ぽちまる';
    saveDoc(doc);
    expect(loadDoc()?.name).toBe('ぽちまる');
  });

  it('名前が無い第2版までのセーブもそのまま読める', () => {
    const doc = createEmptyDoc();
    expect(doc.name).toBeUndefined();
    saveDoc(doc);
    const loaded = loadDoc();
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBeUndefined();
  });

  it('名前が文字列でないセーブは壊れているとみなして捨てる', () => {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({ version: 1, canvasSize: CANVAS_SIZE, ops: [], currentStep: 'done', name: 42 }),
    );
    expect(loadDoc()).toBeNull();
    // 壊れたデータは残さない
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });

  it('名前の上限は10文字', () => {
    expect(MAX_NAME_LENGTH).toBe(10);
  });

  it('消したあとは null', () => {
    saveDoc(createEmptyDoc());
    clearSave();
    expect(loadDoc()).toBeNull();
  });
});
