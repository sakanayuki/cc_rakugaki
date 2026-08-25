/**
 * UI文言の一元管理。
 * 対象は3歳児なので漢字は使わず、すべてひらがな＋カタカナで書く。
 */

import type { Element } from '../game/element';
import type { PartId } from '../paint/types';

export const S = {
  appTitle: 'らくがきバトル',
  appSub: 'じぶんで かいた えが うごきだして たたかうよ！',

  // --- メニュー ---
  menuNew: '✏️ あたらしく はじめる',
  menuContinue: '🎨 つづきから',
  menuNoSave: 'まだ えが ないよ',
  menuOverwrite: 'まえに かいた えは きえちゃうよ。\nあたらしく かく？',
  menuHint: '5かい かてば ゆうしょうだ！',

  // --- 共通 ---
  yes: 'うん',
  no: 'やめる',
  back: '← もどる',
  next: 'つぎへ →',

  // --- オエカキ ---
  stepTitle: {
    body: '① からだを かこう！',
    head: '② あたまを かこう！',
    arms: '③ りょううでを かこう！',
    legs: '④ りょうあしを かこう！',
  } as Record<PartId, string>,
  stepHint: {
    body: 'おおきく ぬると たいりょくが つよくなるよ',
    head: 'あたまの かたちで わざが きまるよ',
    arms: 'ふとい うでは こうげきが つよいよ',
    legs: 'おおきな あしは はやく うごけるよ',
  } as Record<PartId, string>,
  toolPen: 'ペン',
  toolFill: 'ぬる',
  toolUndo: 'もどす',
  toolReset: 'やりなおし',
  widthThin: 'ほそい',
  widthMid: 'ふつう',
  widthFat: 'ふとい',
  confirmResetPart: 'いま かいた ぶんを\nぜんぶ けしても いい？',
  fillBlocked: 'そこは まえに かいた ところだよ',
  fillTooLarge: 'かこまれて いないと ぬれないよ',
  drawSomething: 'なにか かいてね',

  // --- プレビュー ---
  previewTitle: 'うごかして みよう！',
  actAttack: '👊 こうげき',
  actHit: '💥 いたい！',
  actDodge: '💨 よける',
  actGuard: '🛡 ぼうぎょ',
  statHp: '❤️ たいりょく',
  statAtk: '💪 こうげき',
  statSpd: '👟 はやさ',
  statElement: '⚔️ ぞくせい',
  actionPanelTitle: '▶ うごかして みよう',
  toDraw: '✏️ えを なおす',
  toBattle: '⚔️ たたかいへ すすむ！',
  dragHint: 'ゆびで よこに うごかすと まわるよ',

  // --- ルーレット ---
  rouletteTitle: 'だれと たたかう？',
  spin: '🎡 ルーレット スタート！',
  spinning: 'まわってる…',
  respin: '🔄 もういちど まわす',
  fight: '⚔️ たたかう！',
  finalRouletteTitle: '👑 さいごの たたかい！',
  strongTag: 'つよい！',
  badMatchupTitle: '⚠️ あいしょうが わるいよ！',
  badMatchupDetail: 'きみの こうげきは はんぶん。あいての こうげきは 2ばい！',

  // --- 戦闘 ---
  battleStart: 'たたかい スタート！',
  special: '⭐ ひっさつわざ！ ⭐',
  specialGo: 'ひっさつわざ さくれつ！！',
  specialReady: 'ひっさつわざが つかえる！ ボタンを おそう！',
  dodged: 'ひらり！ よけた！',
  guarded: 'ガード！ ダメージ はんぶん！',
  superEffective: 'こうかは ばつぐん！ ×2',
  notEffective: 'いまいち…… ×はんぶん',
  critical: '⚡ かいしんの いちげき！ ⚡',
  earlySpecial: 'あいしょうが わるいから、はやく ひっさつわざが つかえる！',

  // --- リザルト ---
  winTitle: 'かった！',
  loseTitle: 'まけちゃった…',
  championTitle: 'ゆうしょう！！',
  powerUpKo: 'ひっさつわざを つかわずに かった！ つよさ +20%',
  powerUpSpecial: 'ひっさつわざで かった！ つよさ +10%',
  powerUpStrong: '👑 つよい あいてに かった！ つよさ +50%',
  nextBattle: '➡️ つぎの たたかいへ！',
  stopHere: '🏠 ここで やめる',
  toMenu: '🏠 メニューへ もどる',

  // --- 殿堂入り ---
  toHallOfFame: '👑 でんどういりへ！',
  hallTitle: '👑 でんどういり！',
  hallNamePrompt: 'なまえを つけてね',
  hallNamePlaceholder: 'なまえ（10もじまで）',
  defaultCharacterName: 'なまえなし',
  hallSave: '📷 とっておく',
  hallSaved: 'ほぞん できたよ！',
  hallLongPress: 'ながおしして「がぞうを ほぞん」してね',
  hallMaking: 'つくってるよ…',
} as const;

/** 属性の表示情報 */
export const ELEMENT_INFO: Record<Element, { emoji: string; name: string; note: string }> = {
  rock: { emoji: '✊', name: 'グー', note: 'どんき' },
  scissors: { emoji: '✌️', name: 'チョキ', note: 'ざんげき' },
  paper: { emoji: '🖐', name: 'パー', note: 'とびどうぐ' },
};

export function elementLabel(el: Element): string {
  const info = ELEMENT_INFO[el];
  return `${info.emoji} ${info.name}（${info.note}）`;
}

/** 「○れんしょうちゅう！」 */
export function streakLabel(streak: number): string {
  return `🔥 ${streak}れんしょうちゅう！`;
}

/** 攻撃メッセージ */
export function attackMessage(isPlayer: boolean, name: string): string {
  return isPlayer ? 'きみの こうげき！' : `${name}の こうげき！`;
}

/** 属性判定の理由をこども向けに説明する */
export function elementReason(el: Element): string {
  switch (el) {
    case 'scissors':
      return 'ほそながい あたまだから チョキ（ざんげき）！';
    case 'rock':
      return 'まるくて ぎっしりの あたまだから グー（どんき）！';
    case 'paper':
      return 'ひろがった あたまだから パー（とびどうぐ）！';
  }
}

/** プレビューで出すヒント（ランダム表示用） */
export const PREVIEW_HINTS: readonly string[] = [
  'おおきく ぬると たいりょくが アップするよ',
  'ふとい うでを かくと こうげきが つよくなるよ',
  'おおきな あしを かくと はやく うごけるよ',
  'いろを たくさん つかうと ちょっと つよくなるよ',
  'グーは チョキに つよい！ チョキは パーに つよい！',
  'パーは グーに つよいよ！ じゃんけんと おなじ！',
];
