export class ProceduralMusicManager {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isPlaying: boolean = false;
  private schedulerId: number | null = null;
  private nextNoteTime: number = 0;
  private currentStep: number = 0;
  private currentBar: number = 0;
  private tempo: number = 126; // BPM - slightly faster
  private stepDuration: number = 0;
  private totalBars: number = 48; // 48 bars for longer loop

  // Instrument nodes
  private bassOsc: OscillatorNode | null = null;
  private bassGain: GainNode | null = null;
  private padOsc1: OscillatorNode | null = null;
  private padOsc2: OscillatorNode | null = null;
  private padGain: GainNode | null = null;

  // Bass patterns for different bars (one semitone lower)
  private bassPatterns: number[][] = [
    // Bars 1-4: Simple G# pattern (A dropped one semitone)
    [25.96, 0, 0, 0, 25.96, 0, 0, 0, 25.96, 0, 0, 0, 34.65, 0, 0, 0],
    // Bars 5-8: Move to C#
    [34.65, 0, 0, 0, 34.65, 0, 0, 0, 25.96, 0, 0, 0, 25.96, 0, 0, 0],
    // Bars 9-12: D# variation  
    [38.89, 0, 0, 0, 38.89, 0, 0, 0, 34.65, 0, 0, 0, 25.96, 0, 0, 0],
    // Bars 13-16: Resolution
    [25.96, 0, 0, 0, 34.65, 0, 0, 0, 38.89, 0, 0, 0, 25.96, 0, 0, 0]
  ];

  // Arpeggio pattern - dark minor intervals (shifted down one semitone via base freq)
  private arpPattern: number[] = [0, 3, 7, 3, 0, -5, 0, 3]; // Minor with tension
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
    // Pad is now handled dynamically in schedulePadChord
  }

  private padFilter: BiquadFilterNode | null = null;
  private currentPadOscs: OscillatorNode[] = [];

  private schedulePadChord(time: number, section: number) {
    if (!this.audioContext || !this.masterGain) return;

    // Stop previous pad chord
    this.currentPadOscs.forEach(osc => {
      try { osc.stop(time); } catch (e) {}
    });
    this.currentPadOscs = [];

    // Different chords for different sections - Am, Dm, Em, Am progression (12 sections for 48 bars)
    const chordFreqs: number[][] = [
      [55, 65.4, 82.4],     // Am (A1, C2, E2)
      [73.4, 87.3, 110],    // Dm (D2, F2, A2)
      [82.4, 98, 123.5],    // Em (E2, G2, B2)
      [55, 65.4, 82.4],     // Am
      [73.4, 87.3, 110],    // Dm
      [82.4, 98, 123.5],    // Em
      [55, 65.4, 82.4],     // Am
      [73.4, 87.3, 110],    // Dm
      [82.4, 98, 123.5],    // Em
      [55, 65.4, 82.4],     // Am
      [73.4, 87.3, 110],    // Dm
      [55, 65.4, 82.4],     // Am (resolution)
    ];

    const chordIndex = section % 12;
    const freqs = chordFreqs[chordIndex];

    // Create filter if not exists
    if (!this.padFilter) {
      this.padFilter = this.audioContext.createBiquadFilter();
      this.padFilter.type = 'lowpass';
      this.padFilter.frequency.value = 500;
      this.padFilter.Q.value = 1;
    }

    // Quieter pad gain
    if (!this.padGain) {
      this.padGain = this.audioContext.createGain();
      this.padGain.gain.value = 0.05; // Much quieter
      this.padFilter.connect(this.padGain);
      this.padGain.connect(this.masterGain);
    }

    // Fade in/out for smooth transitions
    this.padGain.gain.setValueAtTime(0.01, time);
    this.padGain.gain.linearRampToValueAtTime(0.05, time + 0.5);

    // Create oscillators for chord
    freqs.forEach(freq => {
      const osc = this.audioContext!.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.connect(this.padFilter!);
      osc.start(time);
      this.currentPadOscs.push(osc);
    });

    // Add slight detune for thickness
    const detuneOsc = this.audioContext.createOscillator();
    detuneOsc.type = 'sawtooth';
    detuneOsc.frequency.value = freqs[0] * 1.003;
    detuneOsc.connect(this.padFilter);
    detuneOsc.start(time);
    this.currentPadOscs.push(detuneOsc);
  }

  private stopPad() {
    try {
      this.padOsc1?.stop();
      this.padOsc2?.stop();
      this.currentPadOscs.forEach(osc => {
        try { osc.stop(); } catch (e) {}
      });
    } catch (e) {}
    this.padOsc1 = null;
    this.padOsc2 = null;
    this.padGain = null;
    this.padFilter = null;
    this.currentPadOscs = [];
    this.lastPadSection = -1;
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
        this.currentBar = (this.currentBar + 1) % this.totalBars;
      }
    }

    this.schedulerId = requestAnimationFrame(() => this.scheduler());
  }

  private lastPadSection: number = -1;

  private scheduleNote(step: number, bar: number, time: number) {
    if (!this.audioContext || !this.masterGain) return;

    const section = Math.floor(bar / 4); // 0-11 for 12 sections of 4 bars each (48 bars total)

    // Trigger pad chord change at start of each section
    if (step === 0 && bar % 4 === 0 && section !== this.lastPadSection) {
      this.schedulePadChord(time, section);
      this.lastPadSection = section;
    }

    // Section 0 (bars 0-3): Intro - sparse kick, pad plays
    if (section === 0) {
      if (step === 0 || step === 8) {
        this.playKick(time);
      }
      if (step === 0 && bar >= 2) {
        this.playArp(time, bar);
      }
    }

    // Section 1 (bars 4-7): Building - add sparse hi-hats
    if (section === 1) {
      if (step === 0 || step === 8) {
        this.playKick(time);
      }
      if (step % 8 === 4) {
        this.playHiHat(time, 0.02);
      }
      if (step === 0) {
        this.playArp(time, bar);
      }
      // Introduce bass on last 2 bars
      if (bar >= 6) {
        const bassNote = this.bassPatterns[0][step];
        if (bassNote > 0) {
          this.playBass(time, bassNote);
        }
      }
    }

    // Section 2 (bars 8-11): Growing - full kick pattern, more hi-hats
    if (section === 2) {
      if (step % 4 === 0) {
        this.playKick(time);
      }
      if (step % 4 === 2) {
        this.playHiHat(time, 0.02);
      }
      const bassNote = this.bassPatterns[1][step];
      if (bassNote > 0) {
        this.playBass(time, bassNote);
      }
      if (step % 4 === 0) {
        this.playArp(time, bar);
      }
    }

    // Section 3 (bars 12-15): First peak - add snares
    if (section === 3) {
      if (step % 4 === 0) {
        this.playKick(time);
      }
      if (step % 2 === 0) {
        this.playHiHat(time, step % 4 === 0 ? 0.03 : 0.02);
      }
      if (step === 4 || step === 12) {
        this.playSnare(time);
      }
      const bassNote = this.bassPatterns[1][step];
      if (bassNote > 0) {
        this.playBass(time, bassNote);
      }
      if (step % 2 === 0) {
        this.playArp(time, bar);
      }
    }

    // Section 4 (bars 16-19): Full energy with melody
    if (section === 4) {
      if (step % 4 === 0) {
        this.playKick(time);
      }
      if (step % 2 === 0) {
        this.playHiHat(time, step % 4 === 0 ? 0.04 : 0.02);
      }
      if (step === 4 || step === 12) {
        this.playSnare(time);
      }
      const bassNote = this.bassPatterns[2][step];
      if (bassNote > 0) {
        this.playBass(time, bassNote);
      }
      if (step % 2 === 0) {
        this.playArp(time, bar);
      }
      if (bar % 2 === 0 && step === 0) {
        this.playMelody(time, bar);
      }
    }

    // Section 5 (bars 20-23): Peak energy - everything
    if (section === 5) {
      if (step % 4 === 0) {
        this.playKick(time);
      }
      // Busier hi-hats
      this.playHiHat(time, step % 4 === 0 ? 0.04 : 0.015);
      if (step === 4 || step === 12) {
        this.playSnare(time);
      }
      const bassNote = this.bassPatterns[2][step];
      if (bassNote > 0) {
        this.playBass(time, bassNote);
      }
      if (step % 2 === 0) {
        this.playArp(time, bar);
      }
      if (step === 0) {
        this.playMelody(time, bar);
      }
    }

    // Section 6 (bars 24-27): Breakdown - strip back
    if (section === 6) {
      if (step === 0 || step === 8) {
        this.playKick(time);
      }
      if (step === 4 || step === 12) {
        this.playHiHat(time, 0.02);
      }
      const bassNote = this.bassPatterns[3][step];
      if (bassNote > 0) {
        this.playBass(time, bassNote);
      }
      if (step === 0) {
        this.playArp(time, bar);
      }
    }

    // Section 7 (bars 28-31): Building back up
    if (section === 7) {
      if (step === 0 || step === 8) {
        this.playKick(time);
      }
      if (step % 4 === 2) {
        this.playHiHat(time, 0.02);
      }
      const bassNote = this.bassPatterns[0][step];
      if (bassNote > 0) {
        this.playBass(time, bassNote);
      }
      if (step === 0) {
        this.playArp(time, bar);
      }
    }

    // Section 8 (bars 32-35): Second wave - growing intensity
    if (section === 8) {
      if (step % 4 === 0) {
        this.playKick(time);
      }
      if (step % 4 === 2) {
        this.playHiHat(time, 0.02);
      }
      const bassNote = this.bassPatterns[1][step];
      if (bassNote > 0) {
        this.playBass(time, bassNote);
      }
      if (step % 4 === 0) {
        this.playArp(time, bar);
      }
    }

    // Section 9 (bars 36-39): Second peak - full energy
    if (section === 9) {
      if (step % 4 === 0) {
        this.playKick(time);
      }
      if (step % 2 === 0) {
        this.playHiHat(time, step % 4 === 0 ? 0.04 : 0.02);
      }
      if (step === 4 || step === 12) {
        this.playSnare(time);
      }
      const bassNote = this.bassPatterns[2][step];
      if (bassNote > 0) {
        this.playBass(time, bassNote);
      }
      if (step % 2 === 0) {
        this.playArp(time, bar);
      }
      if (step === 0) {
        this.playMelody(time, bar);
      }
    }

    // Section 10 (bars 40-43): Extended peak - everything
    if (section === 10) {
      if (step % 4 === 0) {
        this.playKick(time);
      }
      this.playHiHat(time, step % 4 === 0 ? 0.04 : 0.015);
      if (step === 4 || step === 12) {
        this.playSnare(time);
      }
      const bassNote = this.bassPatterns[2][step];
      if (bassNote > 0) {
        this.playBass(time, bassNote);
      }
      if (step % 2 === 0) {
        this.playArp(time, bar);
      }
      if (step === 0) {
        this.playMelody(time, bar);
      }
    }

    // Section 11 (bars 44-47): Resolution and loop transition
    if (section === 11) {
      if (step === 0 || step === 8) {
        this.playKick(time);
      }
      if (step % 4 === 2) {
        this.playHiHat(time, 0.02);
      }
      const bassNote = this.bassPatterns[3][step];
      if (bassNote > 0) {
        this.playBass(time, bassNote);
      }
      if (step === 0) {
        this.playArp(time, bar);
      }
      // Fill at end to loop
      if (bar === 47 && step >= 12) {
        this.playHiHat(time, 0.03);
        if (step === 14) {
          this.playSnare(time);
        }
      }
    }
  }

  private playMelody(time: number, bar: number) {
    if (!this.audioContext || !this.masterGain) return;

    // Dark minor melody - ominous feel (one semitone lower)
    const melodyNotes = [0, -2, 3, 0, -5, 3, 0, -2]; // Descending dark phrases
    const baseFreq = 207.65; // G#3 (one semitone below A3)
    const noteIndex = bar % 8;
    const freq = baseFreq * Math.pow(2, melodyNotes[noteIndex] / 12);

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    osc.type = 'sawtooth'; // Darker synth tone
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.value = 800;

    gain.gain.setValueAtTime(0.05, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.4);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.4);
  }

  private playKick(time: number) {
    if (!this.audioContext || !this.masterGain) return;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sine';
    // Deeper kick - one semitone lower
    osc.frequency.setValueAtTime(75.5, time);
    osc.frequency.exponentialRampToValueAtTime(23.6, time + 0.15);

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

    osc.type = 'sine'; // Softer than triangle - one semitone lower
    osc.frequency.setValueAtTime(141.6, time);
    osc.frequency.exponentialRampToValueAtTime(75.5, time + 0.05);

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

    // Base frequency G#2 = 103.8Hz (one semitone below A2)
    const baseFreq = 103.8;
    const semitone = this.arpPattern[this.arpIndex];
    const freq = baseFreq * Math.pow(2, semitone / 12);

    this.arpIndex = (this.arpIndex + 1) % this.arpPattern.length;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    osc.type = 'sawtooth'; // Dark synth sound
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, time);
    filter.frequency.exponentialRampToValueAtTime(400, time + 0.15);
    filter.Q.value = 4; // Resonant for that synth character

    gain.gain.setValueAtTime(0.06, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.15);
  }
}

export const proceduralMusic = new ProceduralMusicManager();
