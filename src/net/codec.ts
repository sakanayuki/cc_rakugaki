/**
 * 絵をデータチャネルに載せるための圧縮・復元。
 *
 * 手描き1体の CharacterDoc は JSON で 30〜150KB あり、そのままだと
 * 1メッセージの上限を超えることがある。gzip すると座標の羅列がよく縮んで
 * 5〜20KB に収まるので、分割せずに1メッセージで送れる。
 *
 * ここは「文字列に変換する／戻す」だけを受け持つ。中身が正しいかの検査は
 * protocol.ts が行う（信用できない入力なので必ず両方通すこと）。
 */

import type { CharacterDoc } from '../paint/types';

/** gzip したもの */
const PREFIX_GZIP = 'g1:';
/** gzip が使えない環境で、圧縮せずに送るもの */
const PREFIX_RAW = 'r1:';

/** 展開後に許すバイト数。gzip爆弾よけなので、展開しながら打ち切る */
export const MAX_DECODED_BYTES = 2 * 1024 * 1024;

/** 受け取った文字列そのものの長さの上限（展開する前に弾く） */
export const MAX_ENCODED_LENGTH = 1_500_000;

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

function hasCompressionStream(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // 一度に渡しすぎるとスタックが溢れるので刻む
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new DecodeError('base64url として読めない');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const writing = writer
    .write(bytes)
    .then(() => writer.close())
    .catch(() => {
      /* 失敗は読み出し側で表面化する */
    });
  const buffer = await new Response(stream.readable).arrayBuffer();
  await writing;
  return new Uint8Array(buffer);
}

/** 展開しながら上限を見張る。全部読んでから測ると gzip爆弾で先にメモリが尽きる */
async function gunzip(bytes: Uint8Array<ArrayBuffer>, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const writing = writer
    .write(bytes)
    .then(() => writer.close())
    .catch(() => {
      /* 壊れた gzip は reader 側でエラーになる */
    });

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new DecodeError('おおきすぎる');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof DecodeError) throw error;
    throw new DecodeError('gzip として読めない');
  } finally {
    await writing;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/** 絵を1本の文字列にする */
export async function encodeDoc(doc: CharacterDoc): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  if (!hasCompressionStream()) return PREFIX_RAW + bytesToBase64Url(json);
  return PREFIX_GZIP + bytesToBase64Url(await gzip(json));
}

/**
 * 受け取った文字列を絵に戻す。
 * 戻り値は「JSONとして読めた」だけの状態。中身の妥当性は protocol.ts で検査する。
 */
export async function decodeDoc(encoded: string): Promise<unknown> {
  if (typeof encoded !== 'string') throw new DecodeError('文字列ではない');
  if (encoded.length > MAX_ENCODED_LENGTH) throw new DecodeError('おおきすぎる');

  let bytes: Uint8Array<ArrayBuffer>;
  if (encoded.startsWith(PREFIX_GZIP)) {
    if (!hasCompressionStream()) throw new DecodeError('この環境では gzip をほどけない');
    bytes = await gunzip(base64UrlToBytes(encoded.slice(PREFIX_GZIP.length)), MAX_DECODED_BYTES);
  } else if (encoded.startsWith(PREFIX_RAW)) {
    bytes = base64UrlToBytes(encoded.slice(PREFIX_RAW.length));
    if (bytes.length > MAX_DECODED_BYTES) throw new DecodeError('おおきすぎる');
  } else {
    throw new DecodeError('しらない形式');
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DecodeError('JSON として読めない');
  }
}
