/**
 * 属性（じゃんけん三すくみ）の判定と相性。
 * あたまパーツの「かたち」だけで決まるので、同じ絵からは必ず同じ属性が出る。
 */

export type Element = 'rock' | 'scissors' | 'paper';

export const ELEMENTS: readonly Element[] = ['rock', 'scissors', 'paper'];

/** 細長いと判定する縦横比のしきい値 */
export const SCISSORS_ASPECT_HIGH = 1.5;
export const SCISSORS_ASPECT_LOW = 0.67;
/** ぎっしり詰まっていると判定する塗り密度のしきい値 */
export const ROCK_DENSITY = 0.5;

/**
 * あたまの形から属性を決める。
 *   1. 細長い（縦長 or 横長）      → チョキ（ざんげき）
 *   2. まるくて塗り密度が高い       → グー（どんき）
 *   3. それ以外（スカスカ／ひろがり） → パー（とびどうぐ）
 * 順に評価するので必ず一意に決まる。
 *
 * @param aspect  あたまbboxの 幅 / 高さ
 * @param density あたまの不透明ピクセル数 / bbox面積（0..1）
 */
export function judgeElement(aspect: number, density: number): Element {
  if (!Number.isFinite(aspect) || aspect <= 0) return 'paper';
  if (aspect >= SCISSORS_ASPECT_HIGH || aspect <= SCISSORS_ASPECT_LOW) return 'scissors';
  if (density >= ROCK_DENSITY) return 'rock';
  return 'paper';
}

/** 三すくみ。攻める側 → 倒せる側 */
const BEATS: Record<Element, Element> = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
};

/**
 * その守りの属性に対して**こうかばつぐん（2倍）になる攻撃属性**を返す。
 *
 * オンライン対戦の戦略画面で、
 * 「相手のまもりに よく効く手」と「自分のまもりが やられる手」の
 * どちらを出すのにも使う（守り側から見れば、これが弱点そのもの）。
 */
export function strongAgainst(defender: Element): Element {
  const found = ELEMENTS.find((attacker) => BEATS[attacker] === defender);
  // 三すくみなので必ず1つ見つかる
  return found ?? defender;
}

/**
 * 属性相性の倍率。
 *   グー   → チョキ ×2 / グー ×1 / パー ×0.5
 *   チョキ → パー   ×2 / チョキ ×1 / グー ×0.5
 *   パー   → グー   ×2 / パー ×1 / チョキ ×0.5
 */
export function elementMultiplier(attacker: Element, defender: Element): 0.5 | 1 | 2 {
  if (attacker === defender) return 1;
  return BEATS[attacker] === defender ? 2 : 0.5;
}
