export class ProceduralMusicManager {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isPlaying: boolean = false;
  private schedulerId: number | null = null;
  private nextNoteTime: number = 0;
  private currentStep: number = 0;
  private tempo: number = 128; // BPM
  private stepDuration: number = 0;

  // Instrument nodes
  private bassOsc: OscillatorNode | null = null;
  private bassGain: GainNode | null = null;
  private padOsc1: OscillatorNode | null = null;
  private padOsc2: OscillatorNode | null = null;
  private padGain: GainNode | null = null;

  // Bass pattern (16 steps, note values in Hz, 0 = rest)
  private bassPattern: number[] = [
    55, 0, 55, 0, 55, 0, 73.4, 0, // A1, rest, A1, rest, A1, rest, D2, rest
    55, 0, 55, 0, 82.4, 0, 73.4, 0  // A1, rest, A1, rest, E2, rest, D2, rest
  ];

  // Arpeggio pattern (notes relative to root)
  private arpPattern: number[] = [0, 4, 7, 12, 7, 4, 0, -5];
  private arpIndex: number = 0;

  constructor() {
    this.stepDuration = 60 / this.tempo / 4; // 16th notes
  }

  private initAudio() {
    if (this.audioContext) return;

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.3;
      this.masterGain.connect(this.audioContext.destination);
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  setVolume(volume: number) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  start() {
    if (this.isPlaying) return;
    
    this.initAudio();
    if (!this.audioContext || !this.masterGain) return;

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    this.isPlaying = true;
    this.nextNoteTime = this.audioContext.currentTime;
    this.currentStep = 0;
    this.arpIndex = 0;

    // Start ambient pad
    this.startPad();

    // Start sequencer
    this.scheduler();
  }

  stop() {
    this.isPlaying = false;
    
    if (this.schedulerId) {
      cancelAnimationFrame(this.schedulerId);
      this.schedulerId = null;
    }

    this.stopPad();
  }

  private startPad() {
    if (!this.audioContext || !this.masterGain) return;

    // Atmospheric pad with two detuned oscillators
    this.padGain = this.audioContext.createGain();
    this.padGain.gain.value = 0.08;

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.Q.value = 1;

    this.padOsc1 = this.audioContext.createOscillator();
    this.padOsc1.type = 'sawtooth';
    this.padOsc1.frequency.value = 110; // A2

    this.padOsc2 = this.audioContext.createOscillator();
    this.padOsc2.type = 'sawtooth';
    this.padOsc2.frequency.value = 110.5; // Slightly detuned for chorus effect

    this.padOsc1.connect(filter);
    this.padOsc2.connect(filter);
    filter.connect(this.padGain);
    this.padGain.connect(this.masterGain);

    this.padOsc1.start();
    this.padOsc2.start();
  }

  private stopPad() {
    try {
      this.padOsc1?.stop();
      this.padOsc2?.stop();
    } catch (e) {}
    this.padOsc1 = null;
    this.padOsc2 = null;
    this.padGain = null;
  }

  private scheduler() {
    if (!this.isPlaying || !this.audioContext) return;

    // Schedule notes ahead of time
    while (this.nextNoteTime < this.audioContext.currentTime + 0.1) {
      this.scheduleNote(this.currentStep, this.nextNoteTime);
      this.nextNoteTime += this.stepDuration;
      this.currentStep = (this.currentStep + 1) % 16;
    }

    this.schedulerId = requestAnimationFrame(() => this.scheduler());
  }

  private scheduleNote(step: number, time: number) {
    if (!this.audioContext || !this.masterGain) return;

    // Kick drum on beats 0, 4, 8, 12
    if (step % 4 === 0) {
      this.playKick(time);
    }

    // Hi-hat on every step
    this.playHiHat(time, step % 2 === 0 ? 0.08 : 0.04);

    // Snare/clap on beats 4 and 12
    if (step === 4 || step === 12) {
      this.playSnare(time);
    }

    // Bass on pattern
    const bassNote = this.bassPattern[step];
    if (bassNote > 0) {
      this.playBass(time, bassNote);
    }

    // Arpeggio on every other step
    if (step % 2 === 0) {
      this.playArp(time);
    }
  }

  private playKick(time: number) {
    if (!this.audioContext || !this.masterGain) return;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(30, time + 0.1);

    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.15);
  }

  private playHiHat(time: number, volume: number) {
    if (!this.audioContext || !this.masterGain) return;

    const bufferSize = this.audioContext.sampleRate * 0.05;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 8000;

    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(time);
    noise.stop(time + 0.05);
  }

  private playSnare(time: number) {
    if (!this.audioContext || !this.masterGain) return;

    // Noise component
    const bufferSize = this.audioContext.sampleRate * 0.1;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = this.audioContext.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 3000;

    const noiseGain = this.audioContext.createGain();
    noiseGain.gain.setValueAtTime(0.2, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    noise.start(time);
    noise.stop(time + 0.1);

    // Body tone
    const osc = this.audioContext.createOscillator();
    const oscGain = this.audioContext.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(100, time + 0.05);

    oscGain.gain.setValueAtTime(0.15, time);
    oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.08);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.08);
  }

  private playBass(time: number, freq: number) {
    if (!this.audioContext || !this.masterGain) return;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, time);
    filter.frequency.exponentialRampToValueAtTime(100, time + 0.1);

    gain.gain.setValueAtTime(0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.12);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.12);
  }

  private playArp(time: number) {
    if (!this.audioContext || !this.masterGain) return;

    // Base frequency A3 = 220Hz
    const baseFreq = 220;
    const semitone = this.arpPattern[this.arpIndex];
    const freq = baseFreq * Math.pow(2, semitone / 12);

    this.arpIndex = (this.arpIndex + 1) % this.arpPattern.length;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, time);
    filter.frequency.exponentialRampToValueAtTime(500, time + 0.15);
    filter.Q.value = 5;

    gain.gain.setValueAtTime(0.08, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.15);
  }
}

export const proceduralMusic = new ProceduralMusicManager();
