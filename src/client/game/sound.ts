/**
 * 効果音。外部の音源ファイルは使わず、Web Audio でその場で合成する（すべてオリジナル）。
 */
type Sfx = 'move' | 'rotate' | 'lock' | 'hardDrop' | 'clear' | 'quad' | 'hold' | 'levelUp' | 'gameOver';

class SoundEngine {
  private ctx: AudioContext | null = null;
  muted = false;

  /** ユーザー操作の中で呼んで AudioContext を有効にする */
  unlock(): void {
    if (this.muted) return;
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  play(s: Sfx): void {
    switch (s) {
      case 'move':
        return this.tone(420, 0.03, 'square', 0.02);
      case 'rotate':
        return this.tone(620, 0.05, 'triangle', 0.05, 900);
      case 'hold':
        return this.tone(300, 0.08, 'triangle', 0.06, 600);
      case 'lock':
        return this.tone(160, 0.08, 'sine', 0.12, 90);
      case 'hardDrop':
        return this.tone(220, 0.12, 'sawtooth', 0.08, 60);
      case 'clear':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.12, 'square', 0.05, undefined, i * 0.04));
        return;
      case 'quad':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.16, 'square', 0.06, undefined, i * 0.05));
        return;
      case 'levelUp':
        [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.08, undefined, i * 0.08));
        return;
      case 'gameOver':
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.06, undefined, i * 0.18));
        return;
    }
  }
}

export const sound = new SoundEngine();
