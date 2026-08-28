/**
 * オンライン対戦の接続。**peerjs を触ってよいのはこのファイルだけ**。
 *
 * ここに閉じ込めておけば、ブローカーを自前のものに移すときも、
 * 別の接続方式を足すときも、直す場所が1か所で済む。
 *
 * peerjs は動的 import なので、オンライン対戦に入らなければ読み込まれない。
 */

import type { DataConnection, Peer, PeerError, PeerOptions } from 'peerjs';
import type { NetMessage } from './protocol';
import { parseMessage } from './protocol';
import {
  CONNECT_TIMEOUT_MS,
  EXTRA_ICE_SERVERS,
  ID_RETRY_LIMIT,
  PEER_OPTIONS,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
} from './peerConfig';
import { makeRoomCode, peerIdFor } from './roomCode';

export type LinkState = 'idle' | 'waiting' | 'connecting' | 'open' | 'closed';

/** 画面に出す文言を選ぶための、エラーの大分類 */
export type LinkErrorKind =
  /** そのあいことばで待っている人がいない */
  | 'not-found'
  /** ブローカーに繋がらない。サービス側の都合 */
  | 'offline'
  /** WebRTC が使えないブラウザ */
  | 'unsupported'
  /** 直接つながらなかった・途中で切れた */
  | 'lost'
  /** 相手が「やめる」を選んだ */
  | 'bye';

export class LinkError extends Error {
  /**
   * @param detail つながらなかったときに、どこで止まったのかを示す短い印。
   *   画面のすみに小さく出して、うまくいかない環境を報告してもらうために使う。
   */
  constructor(
    readonly kind: LinkErrorKind,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'LinkError';
  }
}

export interface PeerLinkEvents {
  message: (message: NetMessage) => void;
  state: (state: LinkState) => void;
  error: (error: LinkError) => void;
}

type Handlers = { [K in keyof PeerLinkEvents]: Set<PeerLinkEvents[K]> };

/** PeerJS のエラー種別を、画面の出し分けに使う大分類へ寄せる */
function kindOf(type: string): LinkErrorKind {
  switch (type) {
    case 'peer-unavailable':
      return 'not-found';
    case 'browser-incompatible':
      return 'unsupported';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'ssl-unavailable':
      return 'offline';
    default:
      return 'lost';
  }
}

export class PeerLink {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private currentState: LinkState = 'idle';
  private connectTimer = 0;
  private pingTimer = 0;
  /** 集まった経路候補の数。relay が 0 なら TURN中継に届いていない */
  private readonly found = { host: 0, srflx: 0, relay: 0 };
  private lastHeard = 0;
  private disposed = false;
  private readonly handlers: Handlers = {
    message: new Set(),
    state: new Set(),
    error: new Set(),
  };

  /** ホストとして待っている側か。計算順（host/guest）を決めるのに使う */
  isHost = false;
  /** 画面に出す6文字。ホストのときだけ入る */
  roomCode: string | null = null;

  private constructor(
    private readonly PeerCtor: new (id: string, options?: PeerOptions) => Peer,
    private readonly options: PeerOptions,
  ) {}

  /** peerjs はここで初めて読み込まれる */
  static async create(): Promise<PeerLink> {
    const { Peer, util } = await import('peerjs');

    // 既定の iceServers（STUNとPeerJSのTURN）を**消さずに**、予備の中継先を足す。
    // config を丸ごと渡すと既定値が消えるので、必ずここで繋ぎ合わせること
    const options: PeerOptions = {
      ...PEER_OPTIONS,
      config: {
        ...util.defaultConfig,
        iceServers: [...(util.defaultConfig.iceServers ?? []), ...EXTRA_ICE_SERVERS],
      },
    };
    return new PeerLink(
      Peer as unknown as new (id: string, options?: PeerOptions) => Peer,
      options,
    );
  }

  get state(): LinkState {
    return this.currentState;
  }

  on<K extends keyof PeerLinkEvents>(event: K, handler: PeerLinkEvents[K]): () => void {
    this.handlers[event].add(handler as never);
    return () => {
      this.handlers[event].delete(handler as never);
    };
  }

  private emitState(state: LinkState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const handler of this.handlers.state) handler(state);
  }

  private emitError(error: LinkError): void {
    for (const handler of this.handlers.error) handler(error);
  }

  /**
   * ホストとして待つ。画面に出す6文字を返す。
   * あいことばが埋まっていたら、別のものを作って何度か試す。
   */
  async host(): Promise<string> {
    this.isHost = true;
    for (let attempt = 0; attempt < ID_RETRY_LIMIT; attempt++) {
      const code = makeRoomCode();
      const taken = await this.openPeer(code);
      if (!taken) {
        this.roomCode = code;
        this.emitState('waiting');
        this.waitForIncoming();
        return code;
      }
    }
    throw new LinkError('offline', 'あいことばを作れなかった');
  }

  /**
   * ブローカーに登録する。あいことばが埋まっていたら true を返して呼び直させる。
   * それ以外の失敗は例外にする。
   */
  private openPeer(code: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const peer = new this.PeerCtor(peerIdFor(code), this.options);
      this.peer = peer;

      const onOpen = () => {
        peer.off('error', onError);
        resolve(false);
      };
      const onError = (error: PeerError<string>) => {
        peer.off('open', onOpen);
        if (error.type === 'unavailable-id') {
          peer.destroy();
          resolve(true);
          return;
        }
        reject(new LinkError(kindOf(error.type), error.message));
      };

      peer.once('open', onOpen);
      peer.once('error', onError);
    });
  }

  /** ホストが相手の到着を待つ。対戦が始まったあとに来た接続は断る */
  private waitForIncoming(): void {
    const peer = this.peer;
    if (!peer) return;

    peer.on('connection', (incoming) => {
      if (this.conn) {
        // すでに相手がいる。同時に1人だけ
        incoming.close();
        return;
      }
      this.attach(incoming);
    });
    peer.on('error', (error: PeerError<string>) => {
      this.emitError(new LinkError(kindOf(error.type), error.message));
    });
  }

  /** ゲストとして、あいことばの相手に繋ぐ */
  async join(code: string): Promise<void> {
    this.isHost = false;
    this.roomCode = code;
    this.emitState('connecting');

    // ゲスト自身のIDは何でもよいので PeerJS に決めてもらう
    const peer = new this.PeerCtor(undefined as unknown as string, this.options);
    this.peer = peer;

    await new Promise<void>((resolve, reject) => {
      peer.once('open', () => resolve());
      peer.once('error', (error: PeerError<string>) =>
        reject(new LinkError(kindOf(error.type), error.message)),
      );
    });

    // 繋ぎ先がいなければ 'peer-unavailable' がここで飛んでくる
    peer.on('error', (error: PeerError<string>) => {
      this.emitError(new LinkError(kindOf(error.type), error.message));
      if (kindOf(error.type) === 'not-found') this.close();
    });

    this.attach(peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' }));
  }

  /** データチャネルにイベントを繋ぐ */
  private attach(conn: DataConnection): void {
    this.conn = conn;
    this.emitState('connecting');

    // 直接つながらない回線だと open がいつまでも来ないので見張る
    this.connectTimer = window.setTimeout(() => {
      if (this.currentState !== 'open') {
        this.emitError(new LinkError('lost', '時間内につながらなかった', this.iceDetail()));
        this.close();
      }
    }, CONNECT_TIMEOUT_MS);

    this.watchCandidates();

    conn.on('open', () => {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = 0;
      this.emitState('open');
      this.startHeartbeat();
    });

    conn.on('data', (raw) => {
      const message = parseMessage(raw);
      if (!message) return; // 知らないものは黙って捨てる
      this.lastHeard = Date.now();

      // ping/pong は接続の生存確認だけのもの。画面には渡さない
      if (message.type === 'ping') {
        this.send({ type: 'pong', t: message.t });
        return;
      }
      if (message.type === 'pong') return;

      for (const handler of this.handlers.message) handler(message);
    });

    conn.on('close', () => {
      if (this.disposed) return;
      this.emitError(new LinkError('lost', 'あいてとの接続が切れた'));
      this.close();
    });

    conn.on('error', (error) => {
      this.emitError(new LinkError('lost', String(error)));
    });
  }

  /**
   * 集まった経路候補を種類ごとに数える。
   * PeerJS が RTCPeerConnection を作るのは少しあとなので、出てくるまで待って繋ぐ。
   */
  private watchCandidates(): void {
    const hook = (): boolean => {
      const pc = this.conn?.peerConnection;
      if (!pc) return false;
      pc.addEventListener('icecandidate', (event) => {
        const type = event.candidate?.type;
        if (type === 'host') this.found.host += 1;
        else if (type === 'srflx') this.found.srflx += 1;
        else if (type === 'relay') this.found.relay += 1;
      });
      return true;
    };
    if (hook()) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      if (hook() || (tries += 1) > 60) window.clearInterval(timer);
    }, 50);
  }

  /**
   * どこで止まったのかを short code にする。
   *
   * - `h` = 自分のLAN内の住所、`s` = 外から見える住所（STUN）、`r` = 中継（TURN）
   * - **`r0` なら TURN中継に届いていない**ので、中継先を変える必要がある
   * - ICEが `failed` なら経路が見つからなかった、
   *   `checking` のままなら候補は集まったが疎通しなかった、という区別がつく
   */
  private iceDetail(): string {
    const pc = this.conn?.peerConnection;
    const counts = `h${this.found.host} s${this.found.srflx} r${this.found.relay}`;
    if (!pc) return `ice:none ${counts}`;
    return `ice:${pc.iceConnectionState}/${pc.connectionState} ${counts}`;
  }

  /**
   * 相手が生きているか見張る。
   * 回線がいきなり消えると close が飛んでこないことがあり、
   * そのままだと「あいてを まってるよ…」で永遠に待つことになる。
   */
  private startHeartbeat(): void {
    this.lastHeard = Date.now();
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => {
      if (this.disposed) return;
      if (Date.now() - this.lastHeard > PING_TIMEOUT_MS) {
        this.emitError(new LinkError('lost', 'あいてから へんじが ない'));
        this.close();
        return;
      }
      this.send({ type: 'ping', t: Date.now() });
    }, PING_INTERVAL_MS);
  }

  send(message: NetMessage): void {
    if (this.conn?.open) this.conn.send(message);
  }

  /**
   * 相手だけを切り離してホストの待機に戻す。
   * 相互プレビューで「知らない人だ」となったときに使う。
   */
  rejectPeer(): void {
    const conn = this.conn;
    this.conn = null;
    window.clearTimeout(this.connectTimer);
    this.connectTimer = 0;
    window.clearInterval(this.pingTimer);
    this.pingTimer = 0;
    conn?.close();
    if (this.isHost && this.peer && !this.peer.destroyed) this.emitState('waiting');
    else this.close();
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this.connectTimer);
    this.connectTimer = 0;
    window.clearInterval(this.pingTimer);
    this.pingTimer = 0;
    this.conn?.close();
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
    this.emitState('closed');
  }
}
