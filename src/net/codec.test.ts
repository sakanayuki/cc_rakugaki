import { describe, expect, it } from 'vitest';
import { DecodeError, MAX_ENCODED_LENGTH, decodeDoc, encodeDoc } from './codec';
import { CANVAS_SIZE, createEmptyDoc } from '../paint/types';
import type { CharacterDoc, DrawOp } from '../paint/types';

/** それらしい大きさの絵を作る */
function bigDoc(strokes: number, points: number): CharacterDoc {
  const ops: DrawOp[] = [];
  for (let i = 0; i < strokes; i++) {
    ops.push({
      seq: i,
      part: 'body',
      type: 'stroke',
      color: '#2b2b2b',
      width: 14,
      points: Array.from({ length: points }, (_, p) => [
        (i * 7 + p) % CANVAS_SIZE,
        (i * 13 + p * 3) % CANVAS_SIZE,
      ] as [number, number]),
    });
  }
  return { ...createEmptyDoc(), ops, currentStep: 'done' };
}

describe('絵の符号化', () => {
  it('往復して元に戻る', async () => {
    const doc = bigDoc(20, 30);
    expect(await decodeDoc(await encodeDoc(doc))).toEqual(doc);
  });

  it('空の絵でも往復できる', async () => {
    const doc = createEmptyDoc();
    expect(await decodeDoc(await encodeDoc(doc))).toEqual(doc);
  });

  it('名前つきの絵も往復できる', async () => {
    const doc: CharacterDoc = { ...createEmptyDoc(), name: 'ぽちまる' };
    expect(await decodeDoc(await encodeDoc(doc))).toEqual(doc);
  });

  it('gzip で実際に小さくなる', async () => {
    const doc = bigDoc(200, 60);
    const raw = JSON.stringify(doc).length;
    const encoded = (await encodeDoc(doc)).length;
    expect(encoded).toBeLessThan(raw / 2);
  });

  it('gzip 形式のしるしが付く', async () => {
    expect(await encodeDoc(createEmptyDoc())).toMatch(/^g1:/);
  });
});

describe('壊れた入力', () => {
  it('しらない形式は弾く', async () => {
    await expect(decodeDoc('なにこれ')).rejects.toThrow(DecodeError);
    await expect(decodeDoc('')).rejects.toThrow(DecodeError);
  });

  it('中身が壊れた gzip は弾く', async () => {
    await expect(decodeDoc('g1:AAAAAAAAAAAA')).rejects.toThrow(DecodeError);
  });

  it('base64 として読めないものは弾く', async () => {
    await expect(decodeDoc('r1:###')).rejects.toThrow(DecodeError);
  });

  it('JSON でないものは弾く', async () => {
    const bytes = new TextEncoder().encode('これはJSONではない');
    const base64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
    await expect(decodeDoc(`r1:${base64}`)).rejects.toThrow(DecodeError);
  });

  it('長すぎる文字列は展開する前に弾く', async () => {
    await expect(decodeDoc('g1:' + 'A'.repeat(MAX_ENCODED_LENGTH))).rejects.toThrow(DecodeError);
  });

  it('文字列でないものは弾く', async () => {
    await expect(decodeDoc(42 as unknown as string)).rejects.toThrow(DecodeError);
  });
});
