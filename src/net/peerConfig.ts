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
 *
 * **`config`（iceServers）は絶対に書かないこと。**
 * PeerJS の既定値には Google の STUN だけでなく、
 * `turn:eu-0.turn.peerjs.com` / `turn:us-0.turn.peerjs.com` という
 * **無料のTURN中継**も入っている。TURNは「直接つながらない回線どうしを
 * 中継してくれる係」で、これが無いと次の場合に接続できない。
 *
 * - 同じWi-Fiでも、ルーターが端末どうしの通信を遮っている（AP分離など）
 * - 携帯回線や一部のプロバイダ（相手から見える穴が毎回変わるタイプのNAT）
 *
 * そして PeerJS は `config` を**浅く上書き**する（マージしない）ので、
 * ここに `{ iceServers: [...STUNだけ] }` と書くと**TURNが消える**。
 * 実際それで「つながらなかったよ」が出る不具合を出したので、既定値に任せる。
 *
 * 自前のTURNを足したいときは、既定値を消さないよう
 * PeerJS の `util.defaultConfig.iceServers` に足す形で書くこと。
 */
export const PEER_OPTIONS = {
  debug: 0,
} as const;
