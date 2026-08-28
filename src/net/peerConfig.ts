/**
 * ブローカーの接続先と、経路さがし（ICE）の設定。
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
 * **`config` はここに書かない。** PeerJS は `config` を浅く上書きする（マージしない）ので、
 * ここに書くと既定の iceServers（STUNとTURN）が丸ごと消える。
 * 経路さがしの設定を足したいときは、下の EXTRA_ICE_SERVERS を使うこと。
 */
export const PEER_OPTIONS = {
  debug: 0,
} as const;

/**
 * PeerJS の既定の iceServers に**足す**中継サーバー。
 * `PeerLink` が `util.defaultConfig.iceServers` と繋ぎ合わせて使う（置き換えない）。
 *
 * PeerJS の既定には `turn:eu-0.turn.peerjs.com:3478` などが入っているが、
 * **UDPの3478番だけ**なので、次の場合に経路が作れない。
 *
 * - UDPを通さないネットワーク（会社・学校・一部の公衆Wi-Fi）
 * - PeerJS 側の無料TURNが混んでいる・止まっている
 *
 * そこで **TCP と 443番（TLS）でも中継できる先**を足しておく。
 * 443番のTCPはWebの通信と同じ形なので、いちばん塞がれにくい。
 *
 * 到達できないものが混じっていても害はない。ICEは候補を並行して試し、
 * 繋がらないものは黙って捨てるだけなので、多いほど繋がる可能性が上がる。
 */
export const EXTRA_ICE_SERVERS: RTCIceServer[] = [
  // 予備のSTUN（自分の外から見える住所を知るため）
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },

  // Open Relay Project の無料TURN。UDP・TCP・443 をひととおり並べる
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];
