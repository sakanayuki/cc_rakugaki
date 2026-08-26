import { describe, expect, it } from 'vitest';
import { LIMITS, parseMessage, revealOf, sanitizeIncomingDoc, stripNameForSending } from './protocol';
import { CANVAS_SIZE, createEmptyDoc } from '../paint/types';
import type { CharacterDoc, DrawOp } from '../paint/types';

function stroke(points: [number, number][]): DrawOp {
  return { seq: 0, part: 'body', type: 'stroke', color: '#2b2b2b', width: 14, points };
}

function docWith(ops: DrawOp[]): unknown {
  return { ...createEmptyDoc(), ops, currentStep: 'done' };
}

describe('メッセージの検査', () => {
  it('正しいものは通る', () => {
    expect(parseMessage({ type: 'hello', v: 1, doc: 'g1:xx' })).toEqual({
      type: 'hello', v: 1, doc: 'g1:xx',
    });
    expect(parseMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseMessage({ type: 'bye' })).toEqual({ type: 'bye' });
    expect(parseMessage({ type: 'ping', t: 5 })).toEqual({ type: 'ping', t: 5 });
  });

  it('知らない種類は弾く', () => {
    expect(parseMessage({ type: 'shutdown' })).toBeNull();
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage('hello')).toBeNull();
    expect(parseMessage(42)).toBeNull();
  });

  it('形が違うものは弾く', () => {
    expect(parseMessage({ type: 'hello', v: 1 })).toBeNull();
    expect(parseMessage({ type: 'hello', v: '1', doc: 'x' })).toBeNull();
    expect(parseMessage({ type: 'commit', round: 0 })).toBeNull();
    expect(parseMessage({ type: 'ping', t: Number.NaN })).toBeNull();
  });

  it('reveal は手が3つそろっていないと弾く', () => {
    const base = { type: 'reveal', round: 0, salt: 'ab', nonce: 7 };
    expect(parseMessage({ ...base, choices: ['rock', 'paper', 'scissors'] })).not.toBeNull();
    expect(parseMessage({ ...base, choices: ['rock', 'paper'] })).toBeNull();
    expect(parseMessage({ ...base, choices: ['rock', 'paper', 'bomb'] })).toBeNull();
  });

  it('長すぎるハッシュは弾く', () => {
    expect(parseMessage({ type: 'commit', round: 0, hash: 'a'.repeat(200) })).toBeNull();
  });

  it('reveal から照合用の形を取り出せる', () => {
    const message = parseMessage({
      type: 'reveal', round: 1, choices: ['rock', 'rock', 'rock'], salt: 'ab', nonce: 3,
    });
    expect(message && revealOf(message as never)).toEqual({
      choices: ['rock', 'rock', 'rock'], salt: 'ab', nonce: 3,
    });
  });
});

describe('受け取った絵の検査', () => {
  it('ふつうの絵は通る', () => {
    const doc = docWith([stroke([[10, 10], [20, 20]])]);
    expect(sanitizeIncomingDoc(doc)).not.toBeNull();
  });

  it('名前は引き継がない', () => {
    const doc = { ...createEmptyDoc(), name: 'ぽちまる' };
    expect(sanitizeIncomingDoc(doc)?.name).toBeUndefined();
  });

  it('版やキャンバスサイズが違うものは弾く', () => {
    expect(sanitizeIncomingDoc({ ...createEmptyDoc(), version: 2 })).toBeNull();
    expect(sanitizeIncomingDoc({ ...createEmptyDoc(), canvasSize: 4096 })).toBeNull();
  });

  it('オペが多すぎるものは弾く', () => {
    const ops = Array.from({ length: LIMITS.ops + 1 }, () => stroke([[1, 1]]));
    expect(sanitizeIncomingDoc(docWith(ops))).toBeNull();
  });

  it('点の合計が多すぎるものは弾く', () => {
    const points = Array.from({ length: LIMITS.pointsPerStroke }, () => [1, 1] as [number, number]);
    const strokes = Math.ceil(LIMITS.totalPoints / LIMITS.pointsPerStroke) + 1;
    const ops = Array.from({ length: strokes }, () => stroke(points));
    expect(sanitizeIncomingDoc(docWith(ops))).toBeNull();
  });

  it('1本のストロークが長すぎるものは弾く', () => {
    const points = Array.from({ length: LIMITS.pointsPerStroke + 1 }, () => [1, 1] as [number, number]);
    expect(sanitizeIncomingDoc(docWith([stroke(points)]))).toBeNull();
  });

  it('キャンバスの外の座標は弾く', () => {
    expect(sanitizeIncomingDoc(docWith([stroke([[-1, 0]])]))).toBeNull();
    expect(sanitizeIncomingDoc(docWith([stroke([[0, CANVAS_SIZE + 1]])]))).toBeNull();
    expect(sanitizeIncomingDoc(docWith([stroke([[Number.NaN, 0]])]))).toBeNull();
    expect(sanitizeIncomingDoc(docWith([stroke([[Infinity, 0]])]))).toBeNull();
  });

  it('色の形式が違うものは弾く', () => {
    const bad = { ...stroke([[1, 1]]), color: 'red' };
    expect(sanitizeIncomingDoc(docWith([bad as DrawOp]))).toBeNull();
  });

  it('ペンの太さが常識外なものは弾く', () => {
    for (const width of [0, -5, LIMITS.maxWidth + 1]) {
      const bad = { ...stroke([[1, 1]]), width };
      expect(sanitizeIncomingDoc(docWith([bad as DrawOp]))).toBeNull();
    }
  });

  it('知らない種類のオペは弾く', () => {
    const bad = { seq: 0, part: 'body', type: 'eval', color: '#000000' };
    expect(sanitizeIncomingDoc(docWith([bad as unknown as DrawOp]))).toBeNull();
  });

  it('塗りつぶしも座標を見る', () => {
    const fill: DrawOp = { seq: 0, part: 'body', type: 'fill', color: '#ff0000', x: 10, y: 10 };
    expect(sanitizeIncomingDoc(docWith([fill]))).not.toBeNull();
    expect(sanitizeIncomingDoc(docWith([{ ...fill, x: -1 }]))).toBeNull();
  });

  it('オブジェクトでないものは弾く', () => {
    expect(sanitizeIncomingDoc(null)).toBeNull();
    expect(sanitizeIncomingDoc('doc')).toBeNull();
    expect(sanitizeIncomingDoc([])).toBeNull();
  });
});

describe('送る前の名前落とし', () => {
  it('名前が消える', () => {
    const doc: CharacterDoc = { ...createEmptyDoc(), name: 'ぽちまる' };
    expect(stripNameForSending(doc).name).toBeUndefined();
  });

  it('絵そのものは変わらない', () => {
    const doc: CharacterDoc = { ...createEmptyDoc(), name: 'ぽちまる', ops: [stroke([[1, 1]])] };
    expect(stripNameForSending(doc).ops).toEqual(doc.ops);
  });

  it('元のオブジェクトは書き換えない', () => {
    const doc: CharacterDoc = { ...createEmptyDoc(), name: 'ぽちまる' };
    stripNameForSending(doc);
    expect(doc.name).toBe('ぽちまる');
  });
});
