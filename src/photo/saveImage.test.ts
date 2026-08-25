import { describe, expect, it } from 'vitest';
import { asciiFileName, dateStamp, sanitizeFileName } from './saveImage';
import { formatDate } from './certificate';

describe('ファイル名の組み立て', () => {
  it('そのまま使える名前は変えない', () => {
    expect(sanitizeFileName('ぽちまる')).toBe('ぽちまる');
  });

  it('ファイル名に使えない文字を落とす', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('空白は詰める', () => {
    expect(sanitizeFileName('ぽち まる')).toBe('ぽちまる');
  });

  it('全部落ちてしまったら既定名にする', () => {
    expect(sanitizeFileName('  ')).toBe('character');
    expect(sanitizeFileName('///')).toBe('character');
  });
});

describe('ダウンロード時のファイル名', () => {
  it('ひらがなを落として日付だけ残す（Chromium が名前ごと捨てるのを避ける）', () => {
    expect(asciiFileName('rakugaki-ぽちまる-20260825.jpg')).toBe('rakugaki-20260825.jpg');
  });

  it('ASCIIだけの名前はそのまま使う', () => {
    expect(asciiFileName('rakugaki-pochi-20260825.jpg')).toBe('rakugaki-pochi-20260825.jpg');
  });

  it('区切りだけになってしまったら既定名にする', () => {
    expect(asciiFileName('---.jpg')).toBe('rakugaki.jpg');
    expect(asciiFileName('ぽちまる')).toBe('rakugaki.jpg');
  });

  it('拡張子は必ず残る', () => {
    for (const name of ['rakugaki-ぽ-20260825.jpg', 'ぜんぶひらがな.jpg', 'a.jpg']) {
      expect(asciiFileName(name).endsWith('.jpg')).toBe(true);
    }
  });
});

describe('日付', () => {
  it('YYYYMMDD で0埋めする', () => {
    expect(dateStamp(new Date(2026, 0, 3))).toBe('20260103');
    expect(dateStamp(new Date(2026, 11, 25))).toBe('20261225');
  });

  it('写真の日付は ひらがな で0埋めしない', () => {
    expect(formatDate(new Date(2026, 0, 3))).toBe('2026ねん 1がつ 3にち');
    expect(formatDate(new Date(2026, 7, 25))).toBe('2026ねん 8がつ 25にち');
  });
});
