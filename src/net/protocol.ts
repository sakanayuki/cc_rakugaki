/**
 * データチャネルでやりとりするメッセージの型と、受信したものの検査。
 *
 * 相手から届くものは**すべて信用できない入力**として扱う。
 * 絵を受け取ってそのまま描くと、巨大な絵を送りつけられて画面が固まる。
 * ここを通っていないデータをゲーム側に渡してはいけない。
 */

import type { Element } from '../game/element';
import { isValidChoices } from '../game/pvpEngine';
import type { CharacterDoc, DrawOp, PartId } from '../paint/types';
import { CANVAS_SIZE, STEP_ORDER } from '../paint/types';
import type { Reveal } from './fairness';

/** プロトコルの版。片方だけ更新されたときに気づくためのもの */
export const PROTOCOL_VERSION = 1;

/** 受け取る絵に許す上限。手描きなら余裕で収まる値にしてある */
export const LIMITS = {
  ops: 4000,
  totalPoints: 60_000,
  pointsPerStroke: 5000,
  minWidth: 1,
  maxWidth: 64,
} as const;

/**
 * 絵を分割して送るときの1かたまりの大きさ（base64の文字数）。
 *
 * データチャネルの1メッセージ上限は機種によって違い、**64KBしかない端末もある**。
 * 指で描いた絵は点が多く、gzip+base64でもそれを超えることがあるので、
 * 必ずこの大きさに割って送る。1メッセージで送ろうとすると、
 * 送信側で黙って失敗して「相手にだけ絵が届かない」状態になる。
 */
export const CHUNK_CHARS = 8000;

/** 受け取ってよい かたまりの数の上限（= 約1.6MBぶん） */
export const MAX_CHUNKS = 200;

export type NetMessage =
  | { type: 'hello'; v: number; size: number; chunks: number }
  | { type: 'chunk'; i: number; data: string }
  | { type: 'ready' }
  | { type: 'commit'; round: number; hash: string }
  | { type: 'reveal'; round: number; choices: Element[]; salt: string; nonce: number }
  | { type: 'verify'; round: number; digest: string }
  | { type: 'rematch'; round: number }
  | { type: 'bye' }
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 受け取ったメッセージを NetMessage として認めてよいか */
export function parseMessage(raw: unknown): NetMessage | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'hello':
      return isFiniteNumber(raw.v) &&
        isFiniteNumber(raw.size) &&
        isFiniteNumber(raw.chunks) &&
        raw.chunks >= 0 &&
        raw.chunks <= MAX_CHUNKS
        ? { type: 'hello', v: raw.v, size: raw.size, chunks: raw.chunks }
        : null;
    case 'chunk':
      return isFiniteNumber(raw.i) &&
        raw.i >= 0 &&
        raw.i < MAX_CHUNKS &&
        typeof raw.data === 'string' &&
        raw.data.length <= CHUNK_CHARS * 2
        ? { type: 'chunk', i: raw.i, data: raw.data }
        : null;
    case 'ready':
      return { type: 'ready' };
    case 'commit':
      return isFiniteNumber(raw.round) && typeof raw.hash === 'string' && raw.hash.length <= 128
        ? { type: 'commit', round: raw.round, hash: raw.hash }
        : null;
    case 'reveal':
      return isFiniteNumber(raw.round) &&
        isValidChoices(raw.choices) &&
        typeof raw.salt === 'string' &&
        raw.salt.length <= 128 &&
        isFiniteNumber(raw.nonce)
        ? { type: 'reveal', round: raw.round, choices: raw.choices, salt: raw.salt, nonce: raw.nonce }
        : null;
    case 'verify':
      return isFiniteNumber(raw.round) && typeof raw.digest === 'string' && raw.digest.length <= 128
        ? { type: 'verify', round: raw.round, digest: raw.digest }
        : null;
    case 'rematch':
      return isFiniteNumber(raw.round) ? { type: 'rematch', round: raw.round } : null;
    case 'bye':
      return { type: 'bye' };
    case 'ping':
      return isFiniteNumber(raw.t) ? { type: 'ping', t: raw.t } : null;
    case 'pong':
      return isFiniteNumber(raw.t) ? { type: 'pong', t: raw.t } : null;
    default:
      return null;
  }
}

/** reveal メッセージから、照合に使う形を取り出す */
export function revealOf(message: Extract<NetMessage, { type: 'reveal' }>): Reveal {
  return { choices: message.choices, salt: message.salt, nonce: message.nonce };
}

function isPartId(value: unknown): value is PartId {
  return typeof value === 'string' && (STEP_ORDER as readonly string[]).includes(value);
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function inCanvas(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= CANVAS_SIZE;
}

/** 1つの描画オペを検査する。点の数は呼び出し側で合計を見張る */
function checkOp(value: unknown): { ok: false } | { ok: true; points: number } {
  if (!isObject(value)) return { ok: false };
  if (!isFiniteNumber(value.seq) || !isPartId(value.part) || !isColor(value.color)) {
    return { ok: false };
  }
  if (value.type === 'stroke') {
    if (!isFiniteNumber(value.width)) return { ok: false };
    if (value.width < LIMITS.minWidth || value.width > LIMITS.maxWidth) return { ok: false };
    if (!Array.isArray(value.points) || value.points.length > LIMITS.pointsPerStroke) {
      return { ok: false };
    }
    for (const point of value.points) {
      if (!Array.isArray(point) || point.length !== 2) return { ok: false };
      if (!inCanvas(point[0]) || !inCanvas(point[1])) return { ok: false };
    }
    return { ok: true, points: value.points.length };
  }
  if (value.type === 'fill') {
    return inCanvas(value.x) && inCanvas(value.y) ? { ok: true, points: 0 } : { ok: false };
  }
  return { ok: false };
}

/**
 * 相手から届いた絵を、描いてよいものとして認めるか。
 * 認めた場合は**名前を落とした**新しいオブジェクトを返す。
 * 相手は「あいて」で統一するので名前は使わないし、
 * よその子がつけた名前を持ち回る理由もない。
 */
export function sanitizeIncomingDoc(value: unknown): CharacterDoc | null {
  if (!isObject(value)) return null;
  if (value.version !== 1) return null;
  if (value.canvasSize !== CANVAS_SIZE) return null;
  if (value.currentStep !== 'done' && !isPartId(value.currentStep)) return null;
  if (!Array.isArray(value.ops) || value.ops.length > LIMITS.ops) return null;

  let totalPoints = 0;
  for (const op of value.ops) {
    const checked = checkOp(op);
    if (!checked.ok) return null;
    totalPoints += checked.points;
    if (totalPoints > LIMITS.totalPoints) return null;
  }

  return {
    version: 1,
    canvasSize: CANVAS_SIZE,
    ops: value.ops as DrawOp[],
    currentStep: value.currentStep,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    // name はあえて引き継がない
  };
}

/** 送る前に名前を落とす。相手の端末に子どもの名前を渡さない */
export function stripNameForSending(doc: CharacterDoc): CharacterDoc {
  const { name: _name, ...rest } = doc;
  return rest;
}

/** 送るために、符号化した絵を決まった大きさに割る */
export function splitIntoChunks(encoded: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += CHUNK_CHARS) {
    chunks.push(encoded.slice(i, i + CHUNK_CHARS));
  }
  return chunks;
}

/**
 * 受け取ったかたまりを組み立てる。
 * 数が合っていて穴が無いときだけ文字列を返す。
 */
export function joinChunks(parts: (string | undefined)[], expected: number): string | null {
  if (parts.length !== expected) return null;
  for (const part of parts) if (typeof part !== 'string') return null;
  return parts.join('');
}
