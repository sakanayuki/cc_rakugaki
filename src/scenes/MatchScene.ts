/**
 * 対人マッチング画面。
 *
 * あいことば（6文字）を作って相手に教えるか、教わったものを入れるかを選ぶ。
 * つながったらお互いの絵を見せ合い、ふたりとも「これで OK」を押したら
 * 戦略画面へ進む。知らない相手が来たときは、ここで断れる。
 */

import { audio } from '../app/audio';
import { gameState } from '../app/GameState';
import { fighterFromDoc, onlineState } from '../app/OnlineState';
import type { Scene, SceneContext } from '../app/SceneManager';
import { getStage } from '../app/Stage3D';
import { decodeDoc } from '../net/codec';
import type { LinkErrorKind } from '../net/PeerLink';
import { PeerLink } from '../net/PeerLink';
import type { NetMessage } from '../net/protocol';
import { PROTOCOL_VERSION, sanitizeIncomingDoc, stripNameForSending } from '../net/protocol';
import { encodeDoc } from '../net/codec';
import { CODE_LENGTH, isValidRoomCode, normalizeRoomCode } from '../net/roomCode';
import { buildCharacter } from '../rig/rigBuilder';
import { button, h } from '../ui/components';
import { S } from '../ui/strings';

type Phase = 'role' | 'hosting' | 'entering' | 'connecting' | 'exchanging' | 'preview';

const YOU_X = -2;
const OPPONENT_X = 2;

/** 接続の失敗を、こども向けの1行に置き換える */
function messageFor(kind: LinkErrorKind): string {
  switch (kind) {
    case 'not-found':
      return S.matchNotFound;
    case 'offline':
      return S.matchOffline;
    case 'unsupported':
      return S.matchNoWebrtc;
    case 'bye':
      return S.opponentLeft;
    default:
      return S.matchTimeout;
  }
}

export function createMatchScene(ctx: SceneContext): Scene {
  const stage = getStage();
  const body = h('div', { class: 'grow match-body' });
  const notice = h('p', { class: 'hint-line hidden' });
  const stageHost = h('div', { class: 'stage3d' });

  let phase: Phase = 'role';
  let disposed = false;
  let link: PeerLink | null = null;
  let iAmReady = false;
  let opponentReady = false;
  let helloSent = false;

  const doc = gameState.doc;
  if (!doc || !gameState.analysis) {
    // プレビュー画面を通らないとここには来られない
    ctx.go('menu');
    return { mount() {}, unmount() {} };
  }

  function showNotice(text: string): void {
    notice.textContent = text;
    notice.classList.remove('hidden');
  }

  function clearNotice(): void {
    notice.classList.add('hidden');
  }

  /** 接続を捨ててメインメニューへ。オンライン状態も片づける */
  function bail(text: string): void {
    if (disposed) return;
    showNotice(text);
    onlineState.close();
    link = null;
    setTimeout(() => {
      if (!disposed) ctx.go('menu');
    }, 2200);
  }

  // --- 画面の段階ごとの描画 ---

  function render(): void {
    if (disposed) return;
    body.replaceChildren();
    switch (phase) {
      case 'role':
        renderRole();
        break;
      case 'hosting':
        renderHosting();
        break;
      case 'entering':
        renderEntering();
        break;
      case 'connecting':
      case 'exchanging':
        renderWaiting();
        break;
      case 'preview':
        renderPreview();
        break;
    }
  }

  function renderRole(): void {
    body.append(
      h('div', { class: 'match-choice' }, [
        button(S.matchHost, { variant: 'primary', size: 'huge', onClick: () => void startHost() }),
        button(S.matchGuest, { variant: 'go', size: 'huge', onClick: () => void startGuest() }),
      ]),
    );
  }

  function renderHosting(): void {
    const code = link?.roomCode ?? '';
    const cells = h(
      'div',
      { class: 'code-display' },
      [...code].map((char) => h('span', { class: 'code-cell', text: char })),
    );
    const copyButton = button(S.matchCopy, {
      onClick: () => {
        void navigator.clipboard?.writeText(code).then(() => {
          copyButton.textContent = S.matchCopied;
          setTimeout(() => {
            copyButton.textContent = S.matchCopy;
          }, 1500);
        });
      },
    });

    body.append(
      h('p', { class: 'match-lead', text: S.matchTellFriend }),
      cells,
      h('div', { class: 'row row-center' }, [copyButton]),
      h('p', { class: 'hint-line', text: S.waitingOpponent }),
      h('p', { class: 'match-note', text: S.matchCodeExpires }),
    );
  }

  function renderEntering(): void {
    const inputs: HTMLInputElement[] = [];
    const connectButton = button(S.matchConnect, {
      variant: 'go',
      size: 'huge',
      disabled: true,
      onClick: () => void joinWith(inputs.map((input) => input.value).join('')),
    });

    function sync(): void {
      const code = normalizeRoomCode(inputs.map((input) => input.value).join(''));
      connectButton.disabled = !isValidRoomCode(code);
    }

    for (let i = 0; i < CODE_LENGTH; i++) {
      const cell = h('input', {
        class: 'code-input',
        type: 'text',
        maxlength: '1',
        inputmode: 'latin',
        autocapitalize: 'characters',
        autocomplete: 'off',
        'aria-label': `${i + 1}もじめ`,
      });
      cell.addEventListener('input', () => {
        // 貼り付けられたら、まとめて各マスに撒く
        const typed = normalizeRoomCode(cell.value);
        if (typed.length > 1) {
          [...typed].forEach((char, offset) => {
            if (inputs[i + offset]) inputs[i + offset].value = char;
          });
          inputs[Math.min(i + typed.length, CODE_LENGTH - 1)].focus();
        } else {
          cell.value = typed;
          if (typed && inputs[i + 1]) inputs[i + 1].focus();
        }
        sync();
      });
      cell.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !cell.value && inputs[i - 1]) inputs[i - 1].focus();
      });
      inputs.push(cell);
    }

    body.append(
      h('p', { class: 'match-lead', text: S.matchEnterPrompt }),
      h('div', { class: 'code-inputs' }, inputs),
      h('div', { class: 'row row-center' }, [connectButton]),
    );
    inputs[0].focus();
  }

  function renderWaiting(): void {
    body.append(
      h('p', { class: 'match-lead', text: phase === 'exchanging' ? S.matchExchanging : S.matchConnecting }),
      h('div', { class: 'spinner' }),
    );
  }

  function renderPreview(): void {
    const okButton = button(iAmReady ? S.waitingOpponent : S.matchOk, {
      variant: 'go',
      size: 'huge',
      disabled: iAmReady,
      onClick: () => {
        iAmReady = true;
        link?.send({ type: 'ready' });
        render();
        maybeStart();
      },
    });

    body.append(
      h('p', { class: 'match-lead', text: S.matchReadyTitle }),
      h('div', { class: 'stage3d grow' }, [stageHost]),
      h('div', { class: 'versus-labels' }, [
        h('span', { class: 'versus-you', text: S.sideYou }),
        h('span', { class: 'versus-vs', text: 'VS' }),
        h('span', { class: 'versus-them', text: S.sideOpponent }),
      ]),
      h('p', {
        class: opponentReady ? 'hint-line hint-ready' : 'hint-line',
        text: opponentReady ? 'あいては じゅんびできたよ！' : S.waitingOpponent,
      }),
      h('div', { class: 'row row-center' }, [
        button(S.no, { variant: 'ghost', onClick: () => rejectOpponent() }),
        okButton,
      ]),
    );
    mountStage();
  }

  /** 相手を断ってホストは待機に戻る。ゲストは役割えらびに戻る */
  function rejectOpponent(): void {
    const wasHost = link?.isHost ?? false;
    teardownStage();
    onlineState.opponent = null;
    iAmReady = false;
    opponentReady = false;
    helloSent = false;
    link?.rejectPeer();
    if (wasHost && link && link.state !== 'closed') {
      phase = 'hosting';
    } else {
      link?.close();
      link = null;
      onlineState.close();
      phase = 'role';
    }
    render();
  }

  // --- 3Dプレビュー ---

  function mountStage(): void {
    const me = onlineState.me;
    const opponent = onlineState.opponent;
    if (!me || !opponent) return;

    stage.mount(stageHost);

    const mine = buildCharacter(me.analysis);
    mine.container.position.x = YOU_X;
    mine.setFacing(1);
    stage.addRig(mine);
    void mine.play('idle');

    const theirs = buildCharacter(opponent.analysis);
    theirs.container.position.x = OPPONENT_X;
    theirs.setFacing(-1);
    stage.addRig(theirs);
    void theirs.play('idle');

    const height = Math.max(mine.height, theirs.height);
    const halfWidth = OPPONENT_X + Math.max(mine.halfWidth, theirs.halfWidth);
    stage.frame({ halfWidth, height, margin: height * 0.18 });
  }

  function teardownStage(): void {
    // リグは Stage3D が持っているので、外すのはステージごとでよい
    stage.unmount();
  }

  // --- 接続 ---

  async function ensureLink(): Promise<PeerLink> {
    if (link) return link;
    const created = await PeerLink.create();
    link = created;
    onlineState.link = created;
    created.on('state', (state) => {
      if (state === 'open') void sendHello();
    });
    created.on('error', (error) => {
      if (disposed) return;
      if (phase === 'preview' || phase === 'exchanging') bail(messageFor(error.kind));
      else {
        showNotice(messageFor(error.kind));
        phase = 'role';
        link = null;
        onlineState.close();
        render();
      }
    });
    created.on('message', (message) => void onMessage(message));
    return created;
  }

  async function startHost(): Promise<void> {
    clearNotice();
    phase = 'hosting';
    body.replaceChildren(h('p', { class: 'match-lead', text: S.matchMaking }), h('div', { class: 'spinner' }));
    try {
      const created = await ensureLink();
      await created.host();
      if (disposed) return;
      onlineState.me = fighterFromDoc(doc!);
      render();
    } catch {
      if (!disposed) {
        showNotice(S.matchOffline);
        phase = 'role';
        link = null;
        onlineState.close();
        render();
      }
    }
  }

  async function startGuest(): Promise<void> {
    clearNotice();
    phase = 'entering';
    render();
    // 相手の到着を待たせないよう、自分の解析だけ先に済ませておく
    onlineState.me = fighterFromDoc(doc!);
  }

  async function joinWith(rawCode: string): Promise<void> {
    const code = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(code)) return;
    clearNotice();
    phase = 'connecting';
    render();
    try {
      const created = await ensureLink();
      await created.join(code);
    } catch {
      if (!disposed) {
        showNotice(S.matchNotFound);
        phase = 'entering';
        link = null;
        onlineState.close();
        render();
      }
    }
  }

  /** つながったら自分の絵を送る。名前は落として送る */
  async function sendHello(): Promise<void> {
    if (helloSent || disposed || !doc) return;
    helloSent = true;
    phase = 'exchanging';
    render();
    const encoded = await encodeDoc(stripNameForSending(doc));
    if (disposed) return;
    link?.send({ type: 'hello', v: PROTOCOL_VERSION, doc: encoded });
  }

  async function onMessage(message: NetMessage): Promise<void> {
    if (disposed) return;
    switch (message.type) {
      case 'hello': {
        if (message.v !== PROTOCOL_VERSION) return bail(S.matchOffline);
        let decoded: unknown;
        try {
          decoded = await decodeDoc(message.doc);
        } catch {
          return bail(S.matchBadDoc);
        }
        const clean = sanitizeIncomingDoc(decoded);
        if (!clean) return bail(S.matchBadDoc);
        if (disposed) return;
        onlineState.opponent = fighterFromDoc(clean);
        if (!onlineState.me) onlineState.me = fighterFromDoc(doc!);
        phase = 'preview';
        audio.play('step');
        render();
        maybeStart();
        break;
      }
      case 'ready':
        opponentReady = true;
        if (phase === 'preview') render();
        maybeStart();
        break;
      case 'bye':
        bail(S.opponentLeft);
        break;
      default:
        break;
    }
  }

  /** ふたりとも OK を押したら戦略画面へ */
  function maybeStart(): void {
    if (!iAmReady || !opponentReady || disposed) return;
    if (!onlineState.me || !onlineState.opponent) return;
    onlineState.round = 0;
    teardownStage();
    ctx.go('strategy');
  }

  return {
    mount(root) {
      root.append(
        h('div', { class: 'scene' }, [
          h('h2', { class: 'draw-title', text: S.matchTitle }),
          body,
          notice,
          h('div', { class: 'row row-center' }, [
            button(S.back, {
              variant: 'ghost',
              onClick: () => {
                onlineState.close();
                link = null;
                ctx.go('preview');
              },
            }),
          ]),
        ]),
      );
      render();
    },

    unmount() {
      disposed = true;
      teardownStage();
    },
  };
}
