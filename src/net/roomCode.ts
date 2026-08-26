/**
 * オンライン対戦の「あいことば」。
 *
 * 口で読み上げて伝えられるように6文字にしてある。紛らわしい文字
 * （0とO、1とIとL）は最初から使わないので、聞き間違いが起きない。
 */

/** あいことばに使う文字。紛らわしい 0 O 1 I L は入れない */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 画面に出す文字数 */
export const CODE_LENGTH = 6;

/**
 * 実際の PeerJS ID に付ける頭。
 * 公開ブローカーは世界中のアプリが共用しているので、これが無いと
 * 短いIDが他のアプリとぶつかる。画面には出さない。
 */
export const PEER_ID_PREFIX = 'rkg-';

/**
 * あいことばを作る。
 * 剰余を取ると文字ごとの出やすさが偏るので、範囲外の値は捨てて引き直す。
 */
export function makeRoomCode(): string {
  const size = CODE_ALPHABET.length;
  // 256 を size で割り切れるところまでを有効範囲にする
  const limit = Math.floor(256 / size) * size;
  let code = '';
  const buffer = new Uint8Array(CODE_LENGTH * 2);
  while (code.length < CODE_LENGTH) {
    crypto.getRandomValues(buffer);
    for (const value of buffer) {
      if (value >= limit) continue;
      code += CODE_ALPHABET[value % size];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

/**
 * 入力されたあいことばを整える。
 * 小文字で打たれても、スペースやハイフンが混ざっても受け付ける。
 * 例: 'a7 k3-qm' → 'A7K3QM'
 */
export function normalizeRoomCode(input: string): string {
  let normalized = '';
  for (const char of input.toUpperCase()) {
    if (CODE_ALPHABET.includes(char)) normalized += char;
  }
  return normalized.slice(0, CODE_LENGTH);
}

/** 正規化済みのあいことばとして成立しているか */
export function isValidRoomCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  return [...code].every((char) => CODE_ALPHABET.includes(char));
}

/** あいことばから、ブローカーに登録する実際のIDを作る */
export function peerIdFor(code: string): string {
  return `${PEER_ID_PREFIX}${code}`;
}
