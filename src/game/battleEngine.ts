/**
 * 戦闘ロジック。UI・Three.js に依存せず、イベント列を生成するだけにしてある。
 * 画面側はこのイベントを順番に演出として再生する。
 */

import { elementMultiplier } from './element';
import type { RNG } from './rng';
import { randRange, systemRng } from './rng';
import type { Stats } from './stats';

export type Side = 'player' | 'enemy';

export interface Combatant {
  name: string;
  stats: Stats;
}

export type AttackResult = 'hit' | 'dodge' | 'guard';

export type BattleEvent =
  | { type: 'start'; first: Side }
  | {
      type: 'attack';
      actor: Side;
      target: Side;
      result: AttackResult;
      damage: number;
      elementMul: 0.5 | 1 | 2;
      hpAfter: number;
    }
  /** 3往復して決着がつかなかった。ここでプレイヤーの入力を待つ */
  | { type: 'specialReady' }
  | { type: 'special'; damage: number; hpAfter: number }
  | { type: 'end'; winner: Side };

/** 互いに何回攻撃したら必殺技が解禁されるか */
export const MAX_ROUNDS = 3;
/** 回避率の下限・上限（％） */
export const DODGE_MIN = 5;
export const DODGE_MAX = 25;
/** 防御が発生する確率 */
export const GUARD_CHANCE = 0.15;
/** ダメージのゆらぎ */
export const DAMAGE_VARIANCE = { min: 0.85, max: 1.15 } as const;

export type BattleStatus = 'ready' | 'awaitingSpecial' | 'ended';

/** 回避率（％）。素早さの差で決まる */
export function dodgeChance(attackerSpd: number, defenderSpd: number): number {
  return Math.max(DODGE_MIN, Math.min(DODGE_MAX, DODGE_MIN + (defenderSpd - attackerSpd)));
}

export class Battle {
  readonly player: Combatant;
  readonly enemy: Combatant;
  playerHp: number;
  enemyHp: number;

  private readonly rng: RNG;
  private status: BattleStatus = 'ready';
  private started = false;

  constructor(player: Combatant, enemy: Combatant, rng: RNG = systemRng) {
    this.player = player;
    this.enemy = enemy;
    this.rng = rng;
    this.playerHp = player.stats.maxHp;
    this.enemyHp = enemy.stats.maxHp;
  }

  get state(): BattleStatus {
    return this.status;
  }

  /** 素早さが高いほうが先攻。同値ならプレイヤー先攻 */
  get firstMover(): Side {
    return this.player.stats.spd >= this.enemy.stats.spd ? 'player' : 'enemy';
  }

  hpOf(side: Side): number {
    return side === 'player' ? this.playerHp : this.enemyHp;
  }

  combatantOf(side: Side): Combatant {
    return side === 'player' ? this.player : this.enemy;
  }

  /**
   * 戦闘開始から、決着または必殺技解禁までのイベントを一気に生成する。
   * 必殺技解禁で止まった場合は useSpecial() で続きを取得する。
   */
  run(): BattleEvent[] {
    if (this.started) throw new Error('battle already started');
    this.started = true;

    const events: BattleEvent[] = [];
    const first = this.firstMover;
    const second: Side = first === 'player' ? 'enemy' : 'player';
    events.push({ type: 'start', first });

    for (let round = 0; round < MAX_ROUNDS; round++) {
      for (const actor of [first, second]) {
        const event = this.resolveAttack(actor);
        events.push(event);
        if (event.hpAfter <= 0) {
          this.status = 'ended';
          events.push({ type: 'end', winner: actor });
          return events;
        }
      }
    }

    // 3往復して決着がつかなかった → プレイヤーだけ必殺技が使える
    this.status = 'awaitingSpecial';
    events.push({ type: 'specialReady' });
    return events;
  }

  /** 必殺技。演出のあと必ずNPCを倒す（一撃必殺） */
  useSpecial(): BattleEvent[] {
    if (this.status !== 'awaitingSpecial') {
      throw new Error('special is not available');
    }
    const damage = this.enemyHp;
    this.enemyHp = 0;
    this.status = 'ended';
    return [
      { type: 'special', damage, hpAfter: 0 },
      { type: 'end', winner: 'player' },
    ];
  }

  private resolveAttack(actor: Side): Extract<BattleEvent, { type: 'attack' }> {
    const target: Side = actor === 'player' ? 'enemy' : 'player';
    const attacker = this.combatantOf(actor).stats;
    const defender = this.combatantOf(target).stats;
    const elementMul = elementMultiplier(attacker.element, defender.element);

    const dodgeRoll = this.rng.next() * 100;
    if (dodgeRoll < dodgeChance(attacker.spd, defender.spd)) {
      return {
        type: 'attack',
        actor,
        target,
        result: 'dodge',
        damage: 0,
        elementMul,
        hpAfter: this.hpOf(target),
      };
    }

    const guarded = this.rng.next() < GUARD_CHANCE;
    const variance = randRange(this.rng, DAMAGE_VARIANCE.min, DAMAGE_VARIANCE.max);
    let damage = Math.max(1, Math.round(attacker.atk * elementMul * variance));
    if (guarded) damage = Math.max(1, Math.ceil(damage / 2));

    const hpAfter = Math.max(0, this.hpOf(target) - damage);
    if (target === 'player') this.playerHp = hpAfter;
    else this.enemyHp = hpAfter;

    return {
      type: 'attack',
      actor,
      target,
      result: guarded ? 'guard' : 'hit',
      damage,
      elementMul,
      hpAfter,
    };
  }
}
