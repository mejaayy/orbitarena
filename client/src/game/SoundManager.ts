export class SoundManager {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean = true;
  pickupSoundsEnabled: boolean = true;
  abilitySoundsEnabled: boolean = true;

  constructor() {
    this.initAudio();
    const savedPickup = localStorage.getItem('orbit-arena-pickup-sounds');
    const savedAbility = localStorage.getItem('orbit-arena-ability-sounds');
    if (savedPickup !== null) this.pickupSoundsEnabled = savedPickup !== 'false';
    if (savedAbility !== null) this.abilitySoundsEnabled = savedAbility !== 'false';
  }

  private initAudio() {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
      this.masterGain.gain.value = 0.5;
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  private ensureContext() {
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setVolume(volume: number) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  // Dash - quick whoosh sound
  playDash() {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;
    this.ensureContext();

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    filter.type = 'lowpass';
    filter.frequency.value = 1888; // One semitone lower
    filter.frequency.exponentialRampToValueAtTime(472, this.audioContext.currentTime + 0.15);

    osc.type = 'sawtooth';
    osc.frequency.value = 378; // One semitone lower
    osc.frequency.exponentialRampToValueAtTime(142, this.audioContext.currentTime + 0.15);

    gain.gain.value = 0.25;
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.15);
  }

  // Slam - heavy impact thud
  playSlam() {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;
    this.ensureContext();

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.value = 75.5; // One semitone lower
    osc.frequency.exponentialRampToValueAtTime(28.3, this.audioContext.currentTime + 0.3);

    gain.gain.value = 0.4;
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.3);

    // Add noise burst for impact
    const noise = this.createNoise(0.1);
    const noiseGain = this.audioContext.createGain();
    noiseGain.gain.value = 0.15;
    noiseGain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
    noise.connect(noiseGain);
    noiseGain.connect(this.masterGain);
  }

  // Pull - suction/vacuum sound
  playPull() {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;
    this.ensureContext();

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    filter.type = 'bandpass';
    filter.frequency.value = 283; // One semitone lower
    filter.Q.value = 5;

    osc.type = 'sawtooth';
    osc.frequency.value = 142; // One semitone lower
    osc.frequency.exponentialRampToValueAtTime(378, this.audioContext.currentTime + 0.25);

    gain.gain.value = 0.2;
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.25);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.25);
  }

  // Push - burst outward sound
  playPush() {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;
    this.ensureContext();

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'square';
    osc.frequency.value = 189; // One semitone lower
    osc.frequency.exponentialRampToValueAtTime(75.5, this.audioContext.currentTime + 0.2);

    gain.gain.value = 0.25;
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.2);

    // Add burst
    const burst = this.audioContext.createOscillator();
    const burstGain = this.audioContext.createGain();
    burst.type = 'sine';
    burst.frequency.value = 113; // One semitone lower
    burstGain.gain.value = 0.2;
    burstGain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);
    burst.connect(burstGain);
    burstGain.connect(this.masterGain);
    burst.start();
    burst.stop(this.audioContext.currentTime + 0.15);
  }

  // Pierce - sharp projectile sound
  playPierce() {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;
    this.ensureContext();

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'triangle';
    osc.frequency.value = 755; // One semitone lower
    osc.frequency.exponentialRampToValueAtTime(378, this.audioContext.currentTime + 0.12);

    gain.gain.value = 0.2;
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.12);
  }

  // Stun Wave - electric buzz
  playStunWave() {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;
    this.ensureContext();

    const osc1 = this.audioContext.createOscillator();
    const osc2 = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc1.type = 'square';
    osc1.frequency.value = 208; // One semitone lower
    osc2.type = 'square';
    osc2.frequency.value = 212; // One semitone lower

    gain.gain.value = 0.15;
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);

    osc1.start();
    osc2.start();
    osc1.stop(this.audioContext.currentTime + 0.3);
    osc2.stop(this.audioContext.currentTime + 0.3);
  }

  // Taking damage - short hit sound
  playDamage() {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;
    this.ensureContext();

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sawtooth';
    osc.frequency.value = 283; // One semitone lower
    osc.frequency.exponentialRampToValueAtTime(94.4, this.audioContext.currentTime + 0.1);

    gain.gain.value = 0.25;
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.1);
  }

  // Elimination - dramatic death sound
  playElimination() {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;
    this.ensureContext();

    // Descending tones (one semitone lower)
    const notes = [378, 283, 189, 94.4];
    notes.forEach((freq, i) => {
      const osc = this.audioContext!.createOscillator();
      const gain = this.audioContext!.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;

      const startTime = this.audioContext!.currentTime + i * 0.08;
      gain.gain.setValueAtTime(0.2, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.15);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(startTime);
      osc.stop(startTime + 0.15);
    });
  }

  // Kill ping - satisfying chime when you eliminate someone
  playKillPing() {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;
    this.ensureContext();

    const t = this.audioContext.currentTime;

    const osc1 = this.audioContext.createOscillator();
    const osc2 = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc1.type = 'sine';
    osc1.frequency.value = 1200;
    osc2.type = 'sine';
    osc2.frequency.value = 1600;

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(t);
    osc2.start(t + 0.08);
    osc1.stop(t + 0.2);
    osc2.stop(t + 0.35);
  }

  // HP Pickup - dark low thud with filtered noise
  playPickupHP() {
    if (!this.enabled || !this.pickupSoundsEnabled || !this.audioContext || !this.masterGain) return;
    this.ensureContext();

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    filter.type = 'lowpass';
    filter.frequency.value = 400;

    osc.type = 'triangle';
    osc.frequency.value = 207.6; // G#3 - dark but audible
    osc.frequency.exponentialRampToValueAtTime(155.6, this.audioContext.currentTime + 0.12);

    gain.gain.value = 0.25;
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.18);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.15);
  }

  // Charge Pickup - subdued filtered pulse
  playPickupCharge() {
    if (!this.enabled || !this.pickupSoundsEnabled || !this.audioContext || !this.masterGain) return;
    this.ensureContext();

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    filter.type = 'lowpass';
    filter.frequency.value = 600;

    osc.type = 'sawtooth';
    osc.frequency.value = 233.1; // A#3 - mid dark
    osc.frequency.exponentialRampToValueAtTime(155.6, this.audioContext.currentTime + 0.1);

    gain.gain.value = 0.2;
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.12);
  }

  // Low charge warning - subtle warning beep
  playLowCharge() {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;
    this.ensureContext();

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.value = 189; // One semitone lower

    gain.gain.value = 0.1;
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.08);
  }

  private createNoise(duration: number): AudioBufferSourceNode {
    const bufferSize = this.audioContext!.sampleRate * duration;
    const buffer = this.audioContext!.createBuffer(1, bufferSize, this.audioContext!.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.audioContext!.createBufferSource();
    noise.buffer = buffer;
    noise.start();
    noise.stop(this.audioContext!.currentTime + duration);

    return noise;
  }

  // Play ability sound by type
  playAbility(type: string) {
    if (!this.abilitySoundsEnabled) return;
    switch (type) {
      case 'DASH':
        this.playDash();
        break;
      case 'SLAM':
        this.playSlam();
        break;
      case 'PULL':
        this.playPull();
        break;
      case 'PUSH':
        this.playPush();
        break;
      case 'PIERCE':
        this.playPierce();
        break;
      case 'STUN_WAVE':
        this.playStunWave();
        break;
    }
  }
}

export const soundManager = new SoundManager();
