/**
 * ふたりの端末がメッセージを交換して、同じ戦闘結果にたどりつくところまでの通しテスト。
 *
 * ネットワークは使わず、データチャネルの代わりに配列でメッセージを渡し合う。
 * 実際に使うモジュール（protocol / codec / fairness / pvpEngine）はすべて本物なので、
 * 「2台の画面で結果が違う」というオンライン対戦でいちばん怖いバグをここで捕まえられる。
 */

import { describe, expect, it } from 'vitest';
import type { Element } from '../game/element';
import type { PvpEvent, PvpSide } from '../game/pvpEngine';
import { simulatePvp } from '../game/pvpEngine';
import { computeStats } from '../game/stats';
import type { Stats } from '../game/stats';
import { createEmptyDoc } from '../paint/types';
import type { CharacterDoc } from '../paint/types';
import { decodeDoc, encodeDoc } from './codec';
import { commitHashOf, createReveal, mixSeed, verifyReveal } from './fairness';
import type { Reveal } from './fairness';
import type { NetMessage } from './protocol';
import { PROTOCOL_VERSION, parseMessage, revealOf, sanitizeIncomingDoc } from './protocol';

/**
 * 1台ぶんの端末。
 *
 * 本物の OnlineState / 各シーンがやることを、通信部分だけ取り出して並べてある。
 * 相手のステータスは受け取らず、届いた絵から自分で計算するところが肝。
 */
class FakePeer {
  readonly outbox: NetMessage[] = [];
  opponentStats: Stats | null = null;
  myReveal: Reveal | null = null;
  opponentCommit: string | null = null;
  opponentReveal: Reveal | null = null;
  events: PvpEvent[] | null = null;

  constructor(
    readonly side: PvpSide,
    readonly doc: CharacterDoc,
    readonly myStats: Stats,
  ) {}

  private send(message: NetMessage): void {
    this.outbox.push(message);
  }

  async sendHello(): Promise<void> {
    this.send({ type: 'hello', v: PROTOCOL_VERSION, doc: await encodeDoc(this.doc) });
  }

  async decide(choices: Element[]): Promise<void> {
    const reveal = createReveal(choices);
    this.myReveal = reveal;
    this.send({ type: 'commit', round: 0, hash: await commitHashOf(reveal) });
  }

  /** 相手から届いた1通を処理する。JSONを通して「本当に送られてきた形」で受ける */
  async receive(raw: NetMessage): Promise<void> {
    const message = parseMessage(JSON.parse(JSON.stringify(raw)));
    if (!message) throw new Error('検査を通らないメッセージ');

    switch (message.type) {
      case 'hello': {
        const decoded = await decodeDoc(message.doc);
        const clean = sanitizeIncomingDoc(decoded);
        if (!clean) throw new Error('あいての絵を認められない');
        // ステータスは送ってもらわない。絵から自分で出す
        this.opponentStats = statsOf(clean);
        break;
      }
      case 'commit':
        this.opponentCommit = message.hash;
        if (this.myReveal) {
          const mine = this.myReveal;
          this.send({ type: 'reveal', round: 0, ...mine });
        }
        break;
      case 'reveal': {
        const reveal = revealOf(message);
        expect(await verifyReveal(reveal, this.opponentCommit!)).toBe(true);
        this.opponentReveal = reveal;
        break;
      }
      default:
        break;
    }
  }

  /** 両方の手がそろったので、種を合成して戦闘を計算する */
  async runBattle(): Promise<PvpEvent[]> {
    const mine = this.myReveal!;
    const theirs = this.opponentReveal!;
    const isHost = this.side === 'host';
    const hostReveal = isHost ? mine : theirs;
    const guestReveal = isHost ? theirs : mine;
    const seed = await mixSeed(hostReveal.nonce, guestReveal.nonce);

    this.events = simulatePvp({
      host: { stats: isHost ? this.myStats : this.opponentStats!, choices: hostReveal.choices },
      guest: { stats: isHost ? this.opponentStats! : this.myStats, choices: guestReveal.choices },
      seed,
    });
    return this.events;
  }
}

/** 絵からステータスを出す。本物の computeStats を使う（PaintEngineはDOMが要るので面積は直に与える） */
function statsOf(doc: CharacterDoc): Stats {
  // 絵の中身に応じて変わればよいので、オペ数から決めごとで面積を作る
  const scale = doc.ops.length;
  return computeStats({
    bodyArea: 40_000 + scale * 900,
    armsArea: 18_000 + scale * 400,
    legsArea: 12_000 + scale * 300,
    canvasArea: 1024 * 1024,
    colorCount: 3,
    headAspect: 1,
    headDensity: 0.6,
  });
}

function docWithOps(count: number): CharacterDoc {
  const base = createEmptyDoc();
  return {
    ...base,
    currentStep: 'done',
    ops: Array.from({ length: count }, (_, i) => ({
      seq: i,
      part: 'body' as const,
      type: 'stroke' as const,
      color: '#2b2b2b',
      width: 14,
      points: [
        [i % 900, (i * 3) % 900],
        [(i + 5) % 900, (i * 7) % 900],
      ] as [number, number][],
    })),
  };
}

/** outbox にたまったものを相手に流し込む */
async function deliver(from: FakePeer, to: FakePeer): Promise<void> {
  while (from.outbox.length > 0) await to.receive(from.outbox.shift()!);
}

/** 出会いから戦闘結果まで、ひととおり通す */
async function playMatch(
  hostChoices: Element[],
  guestChoices: Element[],
  hostOps = 40,
  guestOps = 70,
): Promise<{ host: PvpEvent[]; guest: PvpEvent[] }> {
  const host = new FakePeer('host', docWithOps(hostOps), statsOf(docWithOps(hostOps)));
  const guest = new FakePeer('guest', docWithOps(guestOps), statsOf(docWithOps(guestOps)));

  // 1. 絵の交換
  await host.sendHello();
  await guest.sendHello();
  await deliver(host, guest);
  await deliver(guest, host);

  // 2. 手を決めて、ハッシュだけ先に送る
  await host.decide(hostChoices);
  await guest.decide(guestChoices);
  await deliver(host, guest);
  await deliver(guest, host);

  // 3. commit を受けて出た reveal を配る
  await deliver(host, guest);
  await deliver(guest, host);

  return { host: await host.runBattle(), guest: await guest.runBattle() };
}

const ALL = (element: Element): Element[] => [element, element, element];

describe('出会いから戦闘までの通し', () => {
  it('ふたりとも まったく同じ結果になる', async () => {
    const { host, guest } = await playMatch(
      ['rock', 'paper', 'scissors'],
      ['scissors', 'scissors', 'rock'],
    );
    expect(host).toEqual(guest);
  });

  it('どんな手の組み合わせでも結果が一致する', async () => {
    const hands: Element[] = ['rock', 'scissors', 'paper'];
    for (const a of hands) {
      for (const b of hands) {
        const { host, guest } = await playMatch(ALL(a), ALL(b));
        expect(host).toEqual(guest);
      }
    }
  });

  it('絵の大きさが違っても一致する', async () => {
    for (const [hostOps, guestOps] of [[5, 300], [300, 5], [100, 100]]) {
      const { host, guest } = await playMatch(ALL('rock'), ALL('paper'), hostOps, guestOps);
      expect(host).toEqual(guest);
    }
  });

  it('相手のステータスは絵から復元される（送ってもらっていない）', async () => {
    const host = new FakePeer('host', docWithOps(40), statsOf(docWithOps(40)));
    const guest = new FakePeer('guest', docWithOps(120), statsOf(docWithOps(120)));
    await guest.sendHello();
    await deliver(guest, host);
    expect(host.opponentStats).toEqual(guest.myStats);
  });

  it('何度やっても勝敗の食い違いが出ない', async () => {
    for (let i = 0; i < 40; i++) {
      const pick = (n: number): Element[] =>
        [0, 1, 2].map((t) => (['rock', 'scissors', 'paper'] as Element[])[(n + t) % 3]);
      const { host, guest } = await playMatch(pick(i), pick(i * 2 + 1));
      const hostEnd = host.find((e) => e.type === 'end');
      const guestEnd = guest.find((e) => e.type === 'end');
      expect(hostEnd).toEqual(guestEnd);
    }
  });
});

describe('ずるへの備え', () => {
  it('手をすり替えた reveal は検査で落ちる', async () => {
    const cheater = createReveal(ALL('rock'));
    const hash = await commitHashOf(cheater);
    // あとから勝てる手に変えても、先に送ったハッシュと合わない
    const swapped = { ...cheater, choices: ALL('paper') };
    expect(await verifyReveal(swapped, hash)).toBe(false);
  });

  it('相手の commit を見てから手を決めても、中身は分からない', async () => {
    const a = createReveal(ALL('rock'));
    const b = createReveal(ALL('rock'));
    // 同じ手でも salt が違うのでハッシュは別物。手を読めない
    expect(await commitHashOf(a)).not.toBe(await commitHashOf(b));
  });

  it('片方だけでは乱数の種を決められない', async () => {
    const seeds = new Set<number>();
    for (let guestNonce = 0; guestNonce < 8; guestNonce++) {
      seeds.add(await mixSeed(12345, guestNonce));
    }
    // ホストの nonce を固定しても、相手しだいで種が散る
    expect(seeds.size).toBe(8);
  });

  it('巨大な絵を送りつけられても受け取らない', async () => {
    const huge = docWithOps(5000);
    const encoded = await encodeDoc(huge);
    const decoded = await decodeDoc(encoded);
    expect(sanitizeIncomingDoc(decoded)).toBeNull();
  });
});
