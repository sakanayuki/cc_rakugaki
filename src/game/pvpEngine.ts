/**
 * オンライン対戦の戦闘ロジック。PvEとはルールが違うので別モジュールにしてある。
 *
 * 3ターン戦って、のこり体力％が多いほうの勝ち。どちらかが0になったらそこで終わり。
 * 各ターンは、ふたりが選んだ手でジャンケンをして、勝ったほうだけが攻撃できる
 * （あいこは両方）。選んだ手は攻撃属性も兼ねていて、相手の絵から決まる
 * 防御属性との相性でダメージが変わる。
 *
 * **この関数は同じ入力から必ず同じイベント列を返す**。2台の端末が
 * それぞれ計算して同じ結果になることが、オンライン対戦の土台になっている。
 * 乱数はシード付きのものを注入し、消費順は resolveAttack に閉じ込めてある。
 */

import type { AttackResult } from './battleEngine';
import { resolveAttack } from './battleEngine';
import type { Element } from './element';
import { elementMultiplier } from './element';
import type { RNG } from './rng';
import { seededRng } from './rng';
import type { Stats } from './stats';

/** 1試合のターン数 */
export const PVP_TURNS = 3;

/** ホストが先に登録した側。画面上の左右ではなく、計算順を固定するための呼び名 */
export type PvpSide = 'host' | 'guest';

export interface PvpFighter {
  stats: Stats;
  /** 3ターン分の手。攻撃属性も兼ねる */
  choices: Element[];
}

export interface PvpInput {
  host: PvpFighter;
  guest: PvpFighter;
  /** 両者の nonce から合成した種。片方だけでは決められない */
  seed: number;
}

export type PvpEvent =
  | {
      type: 'turnStart';
      turn: number;
      hostChoice: Element;
      guestChoice: Element;
      janken: PvpSide | 'draw';
    }
  | {
      type: 'attack';
      turn: number;
      actor: PvpSide;
      target: PvpSide;
      result: AttackResult;
      damage: number;
      elementMul: 0.5 | 1 | 2;
      critical: boolean;
      hpAfter: number;
    }
  | { type: 'turnEnd'; turn: number; hostHp: number; guestHp: number }
  | {
      type: 'end';
      winner: PvpSide | 'draw';
      hostPercent: number;
      guestPercent: number;
      /** ko = 体力が0になった / turns = 3ターン戦い切った */
      reason: 'ko' | 'turns';
      /** 1回の攻撃だけで決着したか（リザルトの文言に使う） */
      oneShot: boolean;
    };

/**
 * ジャンケンの勝敗。三すくみは属性相性と同じ表なので使いまわす
 * （グー → チョキ が2倍 ＝ グーの勝ち）。
 */
export function jankenWinner(host: Element, guest: Element): PvpSide | 'draw' {
  if (host === guest) return 'draw';
  return elementMultiplier(host, guest) === 2 ? 'host' : 'guest';
}

/**
 * のこり体力の割合（％）。
 * 勝敗はこの整数で比べる。内部の小数で比べると「同じ数字なのに負けた」となり、
 * 3歳児に説明できなくなるため。
 */
export function hpPercent(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  return Math.round((hp / maxHp) * 100);
}

/** あいこのターンで先に殴る側。はやさが高いほう、同値ならホスト */
function firstMover(host: Stats, guest: Stats): PvpSide {
  return host.spd >= guest.spd ? 'host' : 'guest';
}

/** 手が3つそろっているか（通信で届いたものは信用できないので呼び出し側で必ず確認する） */
export function isValidChoices(value: unknown): value is Element[] {
  if (!Array.isArray(value) || value.length !== PVP_TURNS) return false;
  return value.every((item) => item === 'rock' || item === 'scissors' || item === 'paper');
}

/** 3ターンを最後まで解決してイベント列を返す */
export function simulatePvp(input: PvpInput, rngFactory: (seed: number) => RNG = seededRng): PvpEvent[] {
  const rng = rngFactory(input.seed);
  const stats: Record<PvpSide, Stats> = { host: input.host.stats, guest: input.guest.stats };
  const hp: Record<PvpSide, number> = {
    host: input.host.stats.maxHp,
    guest: input.guest.stats.maxHp,
  };

  const events: PvpEvent[] = [];
  let attackCount = 0;
  let knockedOut = false;

  for (let turn = 0; turn < PVP_TURNS && !knockedOut; turn++) {
    const hostChoice = input.host.choices[turn];
    const guestChoice = input.guest.choices[turn];
    const janken = jankenWinner(hostChoice, guestChoice);
    events.push({ type: 'turnStart', turn, hostChoice, guestChoice, janken });

    // ジャンケンに勝った側だけが殴れる。あいこは両方、はやい順に
    const attackers: PvpSide[] =
      janken === 'draw'
        ? firstMover(stats.host, stats.guest) === 'host'
          ? ['host', 'guest']
          : ['guest', 'host']
        : [janken];

    for (const actor of attackers) {
      const target: PvpSide = actor === 'host' ? 'guest' : 'host';
      const attackElement = actor === 'host' ? hostChoice : guestChoice;
      const outcome = resolveAttack(rng, stats[actor], stats[target], attackElement, hp[target]);
      hp[target] = outcome.hpAfter;
      attackCount += 1;
      events.push({ type: 'attack', turn, actor, target, ...outcome });

      if (outcome.hpAfter <= 0) {
        // 倒れた時点で打ち切る。あいこでも、後攻は殴り返せない
        knockedOut = true;
        break;
      }
    }

    events.push({ type: 'turnEnd', turn, hostHp: hp.host, guestHp: hp.guest });
  }

  const hostPercent = hpPercent(hp.host, stats.host.maxHp);
  const guestPercent = hpPercent(hp.guest, stats.guest.maxHp);
  const winner: PvpSide | 'draw' =
    hostPercent === guestPercent ? 'draw' : hostPercent > guestPercent ? 'host' : 'guest';

  events.push({
    type: 'end',
    winner,
    hostPercent,
    guestPercent,
    reason: knockedOut ? 'ko' : 'turns',
    oneShot: knockedOut && attackCount === 1,
  });

  return events;
}
