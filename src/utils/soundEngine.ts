/**
 * موتور افکت‌های صوتی MindQuest با Web Audio API
 * تضمین فعال‌سازی در نخستین تعامل کاربر و تولید صدای متمایز برای گزینه درست، نادرست، اتمام وقت و تعاملات
 */

interface ToneStep {
  freq: number;
  endFreq?: number;
  type: OscillatorType;
  duration: number;
  delay?: number;
  gain?: number;
  filterFreq?: number;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private unlocked = false;
  public enabled = true;
  public lastPlayedEffect: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const unlockHandler = () => {
        this.unlock();
      };
      window.addEventListener('pointerdown', unlockHandler, { capture: true, passive: true });
      window.addEventListener('touchstart', unlockHandler, { capture: true, passive: true });
      window.addEventListener('mousedown', unlockHandler, { capture: true, passive: true });
      window.addEventListener('keydown', unlockHandler, { capture: true, passive: true });
    }
  }

  private getOrCreateContext(allowBeforeGesture = false): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;

    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (!this.ctx && !allowBeforeGesture && ua && !ua.hasBeenActive) {
      return null;
    }

    if (!this.ctx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.85;
      this.masterGain.connect(this.ctx.destination);
    }

    return this.ctx;
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    try {
      const ctx = this.getOrCreateContext(true);
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }

      if (!this.unlocked) {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0);
        this.unlocked = true;
      }
    } catch {
      // Ignore audio unlock errors
    }
  }

  private withRunningContext(cb: (ctx: AudioContext, dest: AudioNode) => void): void {
    const ctx = this.getOrCreateContext(false);
    if (!ctx || !this.masterGain) return;
    const dest = this.masterGain;

    if (ctx.state === 'running') {
      cb(ctx, dest);
    } else {
      ctx
        .resume()
        .then(() => {
          if (this.enabled && ctx.state === 'running') {
            cb(ctx, dest);
          }
        })
        .catch(() => {});
    }
  }

  private playSequence(effectName: string, steps: ToneStep[]): void {
    this.lastPlayedEffect = effectName;
    try {
      this.withRunningContext((ctx, dest) => {
        const baseTime = ctx.currentTime;
        for (const step of steps) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const start = baseTime + (step.delay ?? 0);
          const stop = start + step.duration;
          const peakGain = step.gain ?? 0.12;

          osc.type = step.type;
          osc.frequency.setValueAtTime(step.freq, start);
          if (step.endFreq && step.endFreq !== step.freq) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(40, step.endFreq), stop);
          }

          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.linearRampToValueAtTime(peakGain, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, stop);

          if (step.filterFreq) {
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(step.filterFreq, start);
            osc.connect(filter);
            filter.connect(gain);
          } else {
            osc.connect(gain);
          }

          gain.connect(dest);
          osc.start(start);
          osc.stop(stop + 0.025);
        }
      });
    } catch {
      // Ignore audio synthesis errors
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.unlock();
      this.powerup();
    }
  }

  public click(): void {
    this.playSequence('click', [
      { freq: 640, endFreq: 760, type: 'sine', duration: 0.06, gain: 0.07 },
    ]);
  }

  public optionTap(optionIndex = 0): void {
    const freqs = [523.25, 587.33, 659.25, 698.46];
    const f = freqs[Math.abs(optionIndex) % freqs.length];
    this.playSequence(`optionTap:${optionIndex}`, [
      { freq: f, endFreq: f * 1.12, type: 'triangle', duration: 0.09, gain: 0.1 },
    ]);
  }

  /**
   * صدای شاد، شفاف و صعودی برای انتخاب گزینه درست (متناسب با استریک و گزینه)
   */
  public correct(streak = 1, optionIndex = 0): void {
    const pitchBoost = Math.min(Math.max(streak - 1, 0), 5) * 30 + (optionIndex % 4) * 12;
    const steps: ToneStep[] = [
      { freq: 523.25 + pitchBoost, type: 'triangle', duration: 0.14, delay: 0, gain: 0.16 },
      { freq: 659.25 + pitchBoost, type: 'triangle', duration: 0.16, delay: 0.065, gain: 0.17 },
      { freq: 783.99 + pitchBoost, type: 'sine', duration: 0.24, delay: 0.13, gain: 0.18 },
      { freq: (783.99 + pitchBoost) * 2, type: 'sine', duration: 0.22, delay: 0.135, gain: 0.06 },
    ];
    if (streak >= 2) {
      steps.push({
        freq: 1046.5 + pitchBoost,
        type: 'triangle',
        duration: 0.3,
        delay: 0.19,
        gain: 0.15,
      });
    }
    this.playSequence(`correct:${streak}`, steps);
  }

  /**
   * صدای واضح، بم و نزولی برای انتخاب گزینه نادرست (بوزر بازی)
   */
  public wrong(optionIndex = 0): void {
    const offset = (optionIndex % 4) * 6;
    this.playSequence(`wrong:${optionIndex}`, [
      {
        freq: 310 - offset,
        endFreq: 235 - offset,
        type: 'sawtooth',
        duration: 0.16,
        delay: 0,
        gain: 0.14,
        filterFreq: 1100,
      },
      {
        freq: 220 - offset,
        endFreq: 155 - offset,
        type: 'sawtooth',
        duration: 0.28,
        delay: 0.12,
        gain: 0.16,
        filterFreq: 950,
      },
      {
        freq: 155 - offset,
        type: 'triangle',
        duration: 0.28,
        delay: 0.12,
        gain: 0.12,
      },
    ]);
  }

  /**
   * صدای متمایز اتمام زمان (Time Out)
   */
  public timeout(): void {
    this.playSequence('timeout', [
      { freq: 520, endFreq: 390, type: 'triangle', duration: 0.18, delay: 0, gain: 0.15 },
      { freq: 390, endFreq: 260, type: 'triangle', duration: 0.3, delay: 0.16, gain: 0.15 },
    ]);
  }

  public tick(): void {
    this.playSequence('tick', [
      { freq: 980, endFreq: 720, type: 'sine', duration: 0.045, gain: 0.08 },
    ]);
  }

  public countdown(finalGo = false): void {
    this.playSequence(finalGo ? 'countdown:go' : 'countdown', [
      {
        freq: finalGo ? 880 : 440,
        endFreq: finalGo ? 1046.5 : 440,
        type: 'triangle',
        duration: finalGo ? 0.3 : 0.14,
        gain: 0.15,
      },
    ]);
  }

  public join(): void {
    this.playSequence('join', [
      { freq: 587.33, type: 'sine', duration: 0.12, delay: 0, gain: 0.11 },
      { freq: 880, type: 'sine', duration: 0.18, delay: 0.09, gain: 0.13 },
    ]);
  }

  public powerup(): void {
    this.playSequence('powerup', [
      { freq: 440, type: 'sine', duration: 0.1, delay: 0, gain: 0.11 },
      { freq: 660, type: 'sine', duration: 0.12, delay: 0.06, gain: 0.12 },
      { freq: 990, type: 'triangle', duration: 0.2, delay: 0.12, gain: 0.13 },
    ]);
  }

  public victory(): void {
    const notes = [392.0, 493.88, 587.33, 783.99, 987.77];
    this.playSequence(
      'victory',
      notes.map((f, idx) => ({
        freq: f,
        type: 'triangle' as OscillatorType,
        duration: idx === notes.length - 1 ? 0.45 : 0.28,
        delay: idx * 0.095,
        gain: 0.16,
      }))
    );
  }

  public getStatus() {
    return {
      enabled: this.enabled,
      unlocked: this.unlocked,
      state: this.ctx?.state ?? 'uninitialized',
      lastPlayedEffect: this.lastPlayedEffect,
    };
  }
}

export const soundEngine = new SoundEngine();
