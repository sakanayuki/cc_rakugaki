/**
 * 効果音。Web Audio API でその場で合成するので音声ファイルは持たない。
 * 自動再生制限があるため、最初のユーザー操作で AudioContext を resume する。
 */

import type { Element } from '../game/element';

const MUTE_KEY = 'rakugaki.mute';

export type SfxName =
  | 'tap'
  | 'fill'
  | 'nope'
  | 'step'
  | 'spinTick'
  | 'spinStop'
  | 'warn'
  | 'critical'
  | 'hitRock'
  | 'hitScissors'
  | 'hitPaper'
  | 'dodge'
  | 'guard'
  | 'special'
  | 'win'
  | 'champion'
  | 'lose'
  | 'hall'
  | 'shutter';

interface ToneOptions {
  freq: number;
  freqEnd?: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** 最初のユーザー操作で呼ぶ */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* プライベートモード等では保存できないが動作に支障はない */
    }
    return this.muted;
  }

  play(name: SfxName): void {
    if (this.muted) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    switch (name) {
      case 'tap':
        this.tone({ freq: 880, duration: 0.06, type: 'square', gain: 0.12 });
        break;
      case 'fill':
        this.tone({ freq: 200, freqEnd: 800, duration: 0.16, type: 'triangle', gain: 0.16 });
        break;
      case 'nope':
        this.tone({ freq: 220, freqEnd: 140, duration: 0.18, type: 'sawtooth', gain: 0.1 });
        break;
      case 'step':
        this.tone({ freq: 523, duration: 0.1, type: 'triangle', gain: 0.15 });
        this.tone({ freq: 784, duration: 0.16, type: 'triangle', gain: 0.15, delay: 0.1 });
        break;
      case 'spinTick':
        this.tone({ freq: 1200, duration: 0.03, type: 'square', gain: 0.06 });
        break;
      case 'spinStop':
        this.tone({ freq: 660, duration: 0.1, type: 'square', gain: 0.14 });
        this.tone({ freq: 990, duration: 0.22, type: 'square', gain: 0.14, delay: 0.1 });
        break;
      case 'warn':
        // 相性が悪い相手を引いたときの、不安げな下降2音
        this.tone({ freq: 520, freqEnd: 380, duration: 0.22, type: 'triangle', gain: 0.16 });
        this.tone({ freq: 390, freqEnd: 270, duration: 0.3, type: 'triangle', gain: 0.16, delay: 0.2 });
        break;
      case 'critical':
        // 会心の一撃。通常の命中音よりはっきり派手にする
        this.tone({ freq: 2400, freqEnd: 900, duration: 0.12, type: 'square', gain: 0.16 });
        this.noise({ duration: 0.26, gain: 0.3, filter: 3600, delay: 0.05 });
        this.tone({ freq: 150, freqEnd: 55, duration: 0.34, type: 'sine', gain: 0.34, delay: 0.05 });
        break;
      case 'hitRock':
        this.noise({ duration: 0.16, gain: 0.22, filter: 700 });
        this.tone({ freq: 130, freqEnd: 60, duration: 0.22, type: 'sine', gain: 0.3 });
        break;
      case 'hitScissors':
        this.noise({ duration: 0.14, gain: 0.16, filter: 4200 });
        this.tone({ freq: 1400, freqEnd: 500, duration: 0.14, type: 'sawtooth', gain: 0.1 });
        break;
      case 'hitPaper':
        this.tone({ freq: 900, freqEnd: 1700, duration: 0.14, type: 'square', gain: 0.12 });
        this.noise({ duration: 0.1, gain: 0.12, filter: 2500, delay: 0.12 });
        break;
      case 'dodge':
        this.tone({ freq: 1100, freqEnd: 420, duration: 0.18, type: 'sine', gain: 0.14 });
        break;
      case 'guard':
        this.tone({ freq: 1800, freqEnd: 1200, duration: 0.12, type: 'square', gain: 0.12 });
        this.noise({ duration: 0.08, gain: 0.14, filter: 5000 });
        break;
      case 'special':
        [523, 659, 784, 1047, 1319].forEach((freq, i) => {
          this.tone({ freq, duration: 0.14, type: 'square', gain: 0.13, delay: i * 0.09 });
        });
        this.noise({ duration: 0.5, gain: 0.3, filter: 1200, delay: 0.55 });
        this.tone({ freq: 160, freqEnd: 50, duration: 0.6, type: 'sine', gain: 0.32, delay: 0.55 });
        break;
      case 'win':
        [523, 659, 784].forEach((freq, i) => {
          this.tone({ freq, duration: 0.2, type: 'triangle', gain: 0.16, delay: i * 0.11 });
        });
        break;
      case 'champion':
        [523, 659, 784, 1047, 784, 1047, 1319].forEach((freq, i) => {
          this.tone({ freq, duration: 0.26, type: 'triangle', gain: 0.16, delay: i * 0.13 });
        });
        break;
      case 'hall':
        // 殿堂入り。優勝より更に長く、荘厳に
        [523, 659, 784, 1047, 1319, 1568].forEach((freq, i) => {
          this.tone({ freq, duration: 0.32, type: 'triangle', gain: 0.15, delay: i * 0.16 });
        });
        [2093, 2637, 3136].forEach((freq, i) => {
          this.tone({ freq, duration: 0.5, type: 'sine', gain: 0.07, delay: 1.0 + i * 0.12 });
        });
        break;
      case 'shutter':
        // カメラのシャッター
        this.noise({ duration: 0.05, gain: 0.22, filter: 6000 });
        this.tone({ freq: 2600, duration: 0.03, type: 'square', gain: 0.1, delay: 0.06 });
        break;
      case 'lose':
        [440, 349, 262].forEach((freq, i) => {
          this.tone({ freq, duration: 0.28, type: 'triangle', gain: 0.15, delay: i * 0.18 });
        });
        break;
    }
  }

  private tone(options: ToneOptions): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + (options.delay ?? 0);
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = options.type ?? 'sine';
    osc.frequency.setValueAtTime(options.freq, start);
    if (options.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.freqEnd),
        start + options.duration,
      );
    }
    const peak = options.gain ?? 0.15;
    gainNode.gain.setValueAtTime(0.0001, start);
    gainNode.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);
    osc.connect(gainNode).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + options.duration + 0.02);
  }

  private noise(options: { duration: number; gain: number; filter: number; delay?: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + (options.delay ?? 0);
    const frames = Math.max(1, Math.floor(ctx.sampleRate * options.duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      channel[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(options.filter, start);
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(options.gain, start);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);
    source.connect(filter).connect(gainNode).connect(ctx.destination);
    source.start(start);
  }
}

export const audio = new AudioManager();

/** 属性ごとに命中音を変える（グー=ドン、チョキ=シュッ、パー=ピュン） */
export function hitSfxFor(element: Element): SfxName {
  if (element === 'rock') return 'hitRock';
  if (element === 'scissors') return 'hitScissors';
  return 'hitPaper';
}
