/**
 * 7画面を切り替える軽量なシーンマシン。
 * URLルーティングは使わない（GitHub Pages のサブパス配下で扱いが面倒になるため）。
 */

import type { WinKind } from './GameState';

export type SceneName =
  | 'menu'
  | 'draw'
  | 'preview'
  | 'roulette'
  | 'battle'
  | 'result'
  | 'hall';

export interface SceneParamMap {
  menu: void;
  /** resume: true なら保存された絵の続きから */
  draw: { resume: boolean } | void;
  preview: void;
  roulette: void;
  battle: { enemyId: string };
  result: { outcome: 'win' | 'lose'; enemyId: string; winKind: WinKind };
  /** 殿堂入り。5連勝したときだけ入れる */
  hall: void;
}

export interface SceneContext {
  go<K extends SceneName>(name: K, params?: SceneParamMap[K]): void;
}

export interface Scene {
  /** 画面を組み立てて root に差し込む */
  mount(root: HTMLElement): void;
  /** 後片付け（タイマー・3Dリソースなど） */
  unmount(): void;
}

export type SceneFactory<K extends SceneName = SceneName> = (
  ctx: SceneContext,
  params: SceneParamMap[K],
) => Scene;

export class SceneManager implements SceneContext {
  private readonly root: HTMLElement;
  private readonly factories = new Map<SceneName, SceneFactory>();
  private current: Scene | null = null;
  private currentName: SceneName | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  register<K extends SceneName>(name: K, factory: SceneFactory<K>): void {
    this.factories.set(name, factory as SceneFactory);
  }

  get active(): SceneName | null {
    return this.currentName;
  }

  go<K extends SceneName>(name: K, params?: SceneParamMap[K]): void {
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`未登録のシーンです: ${name}`);

    if (this.current) {
      this.current.unmount();
      this.current = null;
    }
    this.root.replaceChildren();

    const scene = factory(this, params as SceneParamMap[SceneName]);
    this.current = scene;
    this.currentName = name;
    scene.mount(this.root);
  }
}
