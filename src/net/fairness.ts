/**
 * 対戦をずるできなくするための仕組み。
 *
 * P2Pには審判役のサーバーがいないので、次の2つを自前で担保する。
 *
 * 1. **手の同時公開**（コミット＆リビール）
 *    先に相手の手を見てから自分の手を決められると、ジャンケンが成立しない。
 *    まずハッシュだけを送り、両方そろってから中身を明かす。
 *
 * 2. **乱数の種を両者で作る**
 *    片方だけが種を決められると、会心が出る展開を選べてしまう。
 *    お互いの nonce を混ぜて種にする。nonce はハッシュで封じてあるので
 *    あとから選び直せない。
 */

import type { Element } from '../game/element';

/** 手・salt・nonce をまとめたもの。reveal で相手に渡す */
export interface Reveal {
  choices: Element[];
  /** ハッシュから中身を逆算されないための詰め物 */
  salt: string;
  /** 乱数の種のもと */
  nonce: number;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

/** 自分の手をひとまとめにする。salt と nonce はここで作る */
export function createReveal(choices: Element[]): Reveal {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const nonceBytes = new Uint32Array(1);
  crypto.getRandomValues(nonceBytes);
  return { choices: [...choices], salt: toHex(saltBytes), nonce: nonceBytes[0] };
}

/**
 * commit で送るハッシュ。
 * 中身を並べる順番は両者で完全に同じでなければならないので、ここで固定する。
 */
export async function commitHashOf(reveal: Reveal): Promise<string> {
  return toHex(await sha256(`${reveal.salt}|${reveal.nonce}|${reveal.choices.join(',')}`));
}

/** 相手の reveal が、先に受け取った commit と合っているか */
export async function verifyReveal(reveal: Reveal, commitHash: string): Promise<boolean> {
  return (await commitHashOf(reveal)) === commitHash;
}

/**
 * 両者の nonce から戦闘の種を作る。
 * 足し算や XOR だと片方が狙った値を作れてしまうので、ハッシュを通す。
 * 順番は host → guest で固定（どちらの端末でも同じ種になる）。
 */
export async function mixSeed(hostNonce: number, guestNonce: number): Promise<number> {
  const digest = await sha256(`${hostNonce}|${guestNonce}`);
  // 先頭4バイトを符号なし32bitとして使う
  return ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
}

/**
 * 戦闘結果の照合用ダイジェスト。
 * 相手のものと食い違ったら、計算がズレているので試合を続けない。
 */
export async function digestOf(value: unknown): Promise<string> {
  return (await sha256(JSON.stringify(value))).slice(0, 8).reduce(
    (hex, byte) => hex + byte.toString(16).padStart(2, '0'),
    '',
  );
}
