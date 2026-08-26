import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  isValidRoomCode,
  makeRoomCode,
  normalizeRoomCode,
  peerIdFor,
} from './roomCode';

describe('あいことばの生成', () => {
  it('かならず6文字になる', () => {
    for (let i = 0; i < 200; i++) expect(makeRoomCode()).toHaveLength(CODE_LENGTH);
  });

  it('紛らわしい文字は絶対に出ない', () => {
    const banned = ['0', 'O', '1', 'I', 'L'];
    for (const char of banned) expect(CODE_ALPHABET).not.toContain(char);
    for (let i = 0; i < 500; i++) {
      const code = makeRoomCode();
      for (const char of banned) expect(code).not.toContain(char);
    }
  });

  it('使う文字はアルファベットの中だけ', () => {
    for (let i = 0; i < 200; i++) {
      expect(isValidRoomCode(makeRoomCode())).toBe(true);
    }
  });

  it('毎回おなじものは出ない', () => {
    const codes = new Set(Array.from({ length: 200 }, () => makeRoomCode()));
    expect(codes.size).toBeGreaterThan(190);
  });

  it('どの文字も出うる（偏りで一部が死んでいない）', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) for (const char of makeRoomCode()) seen.add(char);
    expect(seen.size).toBe(CODE_ALPHABET.length);
  });
});

describe('あいことばの正規化', () => {
  it('小文字・スペース・ハイフンを吸収する', () => {
    expect(normalizeRoomCode('a7 k3-qm')).toBe('A7K3QM');
    expect(normalizeRoomCode('  A7K3QM  ')).toBe('A7K3QM');
  });

  it('使わない文字は落とす', () => {
    expect(normalizeRoomCode('A7K3Q!M')).toBe('A7K3QM');
  });

  it('6文字を超えたぶんは捨てる', () => {
    expect(normalizeRoomCode('A7K3QMXYZ')).toBe('A7K3QM');
  });

  it('足りなければ不正として扱える', () => {
    expect(isValidRoomCode(normalizeRoomCode('A7K'))).toBe(false);
    expect(isValidRoomCode('')).toBe(false);
  });

  it('紛らわしい文字が入っていたら落ちて長さが足りなくなる', () => {
    // 聞き間違いはそのまま通さず、入れ直してもらう
    expect(isValidRoomCode(normalizeRoomCode('A7K3QO'))).toBe(false);
  });
});

describe('PeerJS の ID', () => {
  it('頭に rkg- が付く', () => {
    expect(peerIdFor('A7K3QM')).toBe('rkg-A7K3QM');
  });
});
