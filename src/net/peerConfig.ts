/**
 * ブローカーの接続先。
 *
 * **差し替えるのはこのファイルだけで済むようにしてある。**
 * PeerJS の無料公開サーバーが止まったら、ここに host/port/path を書き足して
 * 自前の PeerServer に向ければ復旧できる。
 */

/** 接続が open になるまで待つ時間 */
export const CONNECT_TIMEOUT_MS = 30_000;

/** あいことばが埋まっていたときに作り直す回数 */
export const ID_RETRY_LIMIT = 5;

/** 待機中の生存確認の間隔と、返事が無いと諦めるまでの時間 */
export const PING_INTERVAL_MS = 5_000;
export const PING_TIMEOUT_MS = 15_000;

/**
 * host / port / path を省略すると PeerJS の公開クラウド（0.peerjs.com:443）に繋がる。
 * iceServers は自分のグローバルな居場所を知るためだけのもので、対戦データは通らない。
 */
export const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
  },
} as const;
