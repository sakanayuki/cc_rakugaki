import { describe, expect, it } from 'vitest';
import type { Element } from '../game/element';
import { commitHashOf, createReveal, digestOf, mixSeed, verifyReveal } from './fairness';

const CHOICES: Element[] = ['rock', 'paper', 'scissors'];

describe('コミット＆リビール', () => {
  it('正しい reveal は通る', async () => {
    const reveal = createReveal(CHOICES);
    const hash = await commitHashOf(reveal);
    expect(await verifyReveal(reveal, hash)).toBe(true);
  });

  it('手をすり替えたら弾く', async () => {
    const reveal = createReveal(CHOICES);
    const hash = await commitHashOf(reveal);
    const cheated = { ...reveal, choices: ['rock', 'rock', 'rock'] as Element[] };
    expect(await verifyReveal(cheated, hash)).toBe(false);
  });

  it('nonce をすり替えたら弾く（種を選び直せない）', async () => {
    const reveal = createReveal(CHOICES);
    const hash = await commitHashOf(reveal);
    expect(await verifyReveal({ ...reveal, nonce: reveal.nonce + 1 }, hash)).toBe(false);
  });

  it('salt をすり替えたら弾く', async () => {
    const reveal = createReveal(CHOICES);
    const hash = await commitHashOf(reveal);
    expect(await verifyReveal({ ...reveal, salt: 'ff'.repeat(16) }, hash)).toBe(false);
  });

  it('毎回ちがう salt と nonce が出る', () => {
    const salts = new Set<string>();
    const nonces = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const reveal = createReveal(CHOICES);
      salts.add(reveal.salt);
      nonces.add(reveal.nonce);
    }
    expect(salts.size).toBe(100);
    expect(nonces.size).toBeGreaterThan(95);
  });

  it('おなじ手でもハッシュは毎回ちがう（手を読まれない）', async () => {
    const a = await commitHashOf(createReveal(CHOICES));
    const b = await commitHashOf(createReveal(CHOICES));
    expect(a).not.toBe(b);
  });

  it('元の手を書き換えても reveal に影響しない（複製している）', async () => {
    const choices: Element[] = ['rock', 'paper', 'scissors'];
    const reveal = createReveal(choices);
    choices[0] = 'paper';
    expect(reveal.choices[0]).toBe('rock');
  });
});

describe('乱数の種の合成', () => {
  it('両者の nonce がおなじなら、どちらの端末でもおなじ種になる', async () => {
    expect(await mixSeed(123, 456)).toBe(await mixSeed(123, 456));
  });

  it('順番が入れ替わると別の種になる（host/guest を固定する必要がある）', async () => {
    expect(await mixSeed(123, 456)).not.toBe(await mixSeed(456, 123));
  });

  it('片方が変われば種も変わる', async () => {
    expect(await mixSeed(1, 2)).not.toBe(await mixSeed(1, 3));
  });

  it('符号なし32bitの範囲に収まる', async () => {
    for (const [a, b] of [[0, 0], [4294967295, 4294967295], [7, 99999]]) {
      const seed = await mixSeed(a, b);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('結果の照合', () => {
  it('おなじ結果からはおなじダイジェストが出る', async () => {
    const events = [{ type: 'end', winner: 'host' }];
    expect(await digestOf(events)).toBe(await digestOf([{ type: 'end', winner: 'host' }]));
  });

  it('結果がずれていたら気づける', async () => {
    expect(await digestOf({ winner: 'host' })).not.toBe(await digestOf({ winner: 'guest' }));
  });
});
