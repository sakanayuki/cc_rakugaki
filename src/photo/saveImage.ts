/**
 * 記念写真の保存。
 *
 * タブレット・スマホではダウンロードリンクが効かないことがあるので、
 * 共有シート → ダウンロード の順に試す。どちらも使えない場合に備えて、
 * 呼び出し側は写真を <img> で画面に出しておき、長押し保存できるようにしておくこと。
 */

export type SaveOutcome =
  /** 共有シートから保存された（またはシートを開けた） */
  | 'shared'
  /** ダウンロードした */
  | 'downloaded'
  /** ユーザーが共有をキャンセルした */
  | 'cancelled'
  /** どの手段も使えなかった。長押し保存を案内する */
  | 'failed';

/** ファイル名に使えない文字を落とす */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\s]+/g, '');
  return cleaned.length > 0 ? cleaned : 'character';
}

/** YYYYMMDD */
export function dateStamp(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function toJpegBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * ダウンロード用にASCIIだけの名前へ落とす。
 * Chromium は blob: のダウンロードで download 属性にマルチバイト文字が入っていると
 * 名前ごと捨てて拡張子なしの「download」にしてしまい、画像として開けなくなる。
 * ひらがなの名前は落ちてしまうが、日付が残るので区別はつく。
 */
export function asciiFileName(fileName: string): string {
  const ascii = fileName
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\/:*?"<>|\s]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+(?=\.)/g, '');
  // 「-.jpg」のように区切りだけが残った場合の保険
  return /^[^.]+\.[A-Za-z0-9]+$/.test(ascii) ? ascii : 'rakugaki.jpg';
}

function download(blob: Blob, fileName: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = asciiFileName(fileName);
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    // すぐに revoke するとダウンロードが始まらない環境があるので、少し待つ
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch {
    return false;
  }
}

/** キャンバスをJPEGにして保存する */
export async function saveCanvasAsJpeg(
  canvas: HTMLCanvasElement,
  fileName: string,
  shareTitle: string,
): Promise<SaveOutcome> {
  const blob = await toJpegBlob(canvas);
  if (!blob) return 'failed';

  // 1. 共有シート（iOS/Android。写真アプリに保存できる）
  //    こちらは名前にひらがなが入っていても問題ない
  try {
    const file = new File([blob], fileName, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: shareTitle });
      return 'shared';
    }
  } catch (error) {
    // ユーザーがキャンセルしただけならエラー扱いにしない
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    // 共有に失敗したときはダウンロードへ落ちる
  }

  // 2. ダウンロード（PC向け）
  return download(blob, fileName) ? 'downloaded' : 'failed';
}
