export class ProceduralMusicManager {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isPlaying: boolean = false;
  private schedulerId: number | null = null;
  private nextNoteTime: number = 0;
  private currentStep: number = 0;
  private currentBar: number = 0;
  private tempo: number = 118; // BPM - slower, more relaxed
  private stepDuration: number = 0;
  private totalSteps: number = 256; // 16 bars × 16 steps

  // Instrument nodes
  private bassOsc: OscillatorNode | null = null;
  private bassGain: GainNode | null = null;
  private padOsc1: OscillatorNode | null = null;
  private padOsc2: OscillatorNode | null = null;
  private padGain: GainNode | null = null;

  // Bass patterns for different bars (deeper notes - dropped an octave)
  private bassPatterns: number[][] = [
    // Bars 1-4: Simple A pattern
    [27.5, 0, 0, 0, 27.5, 0, 0, 0, 27.5, 0, 0, 0, 36.7, 0, 0, 0],
    // Bars 5-8: Move to D
    [36.7, 0, 0, 0, 36.7, 0, 0, 0, 27.5, 0, 0, 0, 27.5, 0, 0, 0],
    // Bars 9-12: E variation  
    [41.2, 0, 0, 0, 41.2, 0, 0, 0, 36.7, 0, 0, 0, 27.5, 0, 0, 0],
    // Bars 13-16: Resolution
    [27.5, 0, 0, 0, 36.7, 0, 0, 0, 41.2, 0, 0, 0, 27.5, 0, 0, 0]
  ];

  // Arpeggio pattern (notes relative to root) - simpler, less busy
  private arpPattern: number[] = [0, 7, 12, 7];
  private arpIndex: number = 0;

  constructor() {
    this.stepDuration = 60 / this.tempo / 4; // 16th notes
  }

  private initAudio() {
    if (this.audioContext) return;

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.25; // Slightly quieter overall
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

    // Atmospheric pad with two detuned oscillators - deeper and warmer
    this.padGain = this.audioContext.createGain();
    this.padGain.gain.value = 0.06; // Quieter

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400; // Lower cutoff for warmer sound
    filter.Q.value = 0.5;

    this.padOsc1 = this.audioContext.createOscillator();
    this.padOsc1.type = 'sine'; // Softer than sawtooth
    this.padOsc1.frequency.value = 55; // A1 - one octave lower

    this.padOsc2 = this.audioContext.createOscillator();
    this.padOsc2.type = 'sine';
    this.padOsc2.frequency.value = 55.2; // Slightly detuned for warmth

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
      this.scheduleNote(this.currentStep, this.currentBar, this.nextNoteTime);
      this.nextNoteTime += this.stepDuration;
      this.currentStep++;
      if (this.currentStep >= 16) {
        this.currentStep = 0;
        this.currentBar = (this.currentBar + 1) % 16;
      }
    }

    this.schedulerId = requestAnimationFrame(() => this.scheduler());
  }

  private scheduleNote(step: number, bar: number, time: number) {
    if (!this.audioContext || !this.masterGain) return;

    // Kick drum on beats 0, 4, 8, 12 - softer
    if (step % 4 === 0) {
      this.playKick(time);
    }

    // Hi-hat only on beats (less busy) - every 4th step, very quiet
    if (step % 4 === 2) {
      this.playHiHat(time, 0.03);
    }

    // Snare/clap on beat 4 and 12 only - softer
    if (step === 4 || step === 12) {
      this.playSnare(time);
    }

    // Bass pattern changes every 4 bars
    const patternIndex = Math.floor(bar / 4) % 4;
    const bassNote = this.bassPatterns[patternIndex][step];
    if (bassNote > 0) {
      this.playBass(time, bassNote);
    }

    // Arpeggio only on every 4th step - less busy, quieter
    if (step % 4 === 0 && bar % 2 === 0) {
      this.playArp(time, bar);
    }
  }

  private playKick(time: number) {
    if (!this.audioContext || !this.masterGain) return;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sine';
    // Deeper kick - starts lower
    osc.frequency.setValueAtTime(80, time);
    osc.frequency.exponentialRampToValueAtTime(25, time + 0.15);

    // Softer attack
    gain.gain.setValueAtTime(0.35, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.2);
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

    // Noise component - softer, lower frequency
    const bufferSize = this.audioContext.sampleRate * 0.08;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = this.audioContext.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1500; // Lower, less harsh

    const noiseGain = this.audioContext.createGain();
    noiseGain.gain.setValueAtTime(0.1, time); // Quieter
    noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.08);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    noise.start(time);
    noise.stop(time + 0.08);

    // Body tone - deeper
    const osc = this.audioContext.createOscillator();
    const oscGain = this.audioContext.createGain();

    osc.type = 'sine'; // Softer than triangle
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(80, time + 0.05);

    oscGain.gain.setValueAtTime(0.1, time);
    oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.06);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.06);
  }

  private playBass(time: number, freq: number) {
    if (!this.audioContext || !this.masterGain) return;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    osc.type = 'sine'; // Softer, rounder bass
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, time); // Lower cutoff for warmer sound
    filter.frequency.exponentialRampToValueAtTime(80, time + 0.2);

    // Longer, warmer bass
    gain.gain.setValueAtTime(0.35, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.25);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.25);
  }

  private playArp(time: number, bar: number) {
    if (!this.audioContext || !this.masterGain) return;

    // Base frequency A2 = 110Hz (one octave lower)
    const baseFreq = 110;
    const semitone = this.arpPattern[this.arpIndex];
    const freq = baseFreq * Math.pow(2, semitone / 12);

    this.arpIndex = (this.arpIndex + 1) % this.arpPattern.length;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    osc.type = 'triangle'; // Softer than square
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, time); // Lower, less harsh
    filter.frequency.exponentialRampToValueAtTime(300, time + 0.2);
    filter.Q.value = 2;

    // Very quiet - background only
    gain.gain.setValueAtTime(0.04, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.2);
  }
}

export const proceduralMusic = new ProceduralMusicManager();
