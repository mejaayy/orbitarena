export class ProceduralMusicManager {
  private audio: HTMLAudioElement | null = null;
  private nextAudio: HTMLAudioElement | null = null;
  private isPlaying: boolean = false;
  private crossfading: boolean = false;
  private volume: number = 0.125;
  enabled: boolean = true;

  constructor() {
    const saved = localStorage.getItem('orbit-arena-music');
    if (saved !== null) this.enabled = saved !== 'false';
  }

  private createAudioElement(): HTMLAudioElement {
    const audio = new Audio('/music.mp3');
    audio.loop = false;
    audio.volume = this.volume;
    audio.playbackRate = 1.1;
    return audio;
  }

  private crossfadeLoop() {
    if (!this.audio || this.crossfading) return;

    const fadeTime = 1.5;
    const checkTime = 115 - fadeTime;

    if (this.audio.currentTime >= checkTime) {
      this.crossfading = true;

      this.nextAudio = this.createAudioElement();
      this.nextAudio.currentTime = 13;
      this.nextAudio.volume = 0;
      this.nextAudio.play().catch(() => {});

      const steps = 30;
      const interval = (fadeTime * 1000) / steps;
      let step = 0;

      const fadeInterval = setInterval(() => {
        step++;
        const progress = step / steps;

        if (this.audio) {
          this.audio.volume = this.volume * (1 - progress);
        }
        if (this.nextAudio) {
          this.nextAudio.volume = this.volume * progress;
        }

        if (step >= steps) {
          clearInterval(fadeInterval);
          if (this.audio) {
            this.audio.pause();
            this.audio = null;
          }
          this.audio = this.nextAudio;
          this.nextAudio = null;
          this.crossfading = false;
        }
      }, interval);
    }
  }

  start() {
    if (this.isPlaying || !this.enabled) return;

    try {
      this.audio = this.createAudioElement();
      this.audio.currentTime = 13;

      const checkLoop = () => {
        if (!this.isPlaying) return;
        this.crossfadeLoop();
        requestAnimationFrame(checkLoop);
      };

      this.audio.play().catch(e => {
        console.warn('Music autoplay blocked, will retry on interaction');
        const resume = () => {
          this.audio?.play().catch(() => {});
          document.removeEventListener('click', resume);
          document.removeEventListener('keydown', resume);
        };
        document.addEventListener('click', resume);
        document.addEventListener('keydown', resume);
      });
      this.isPlaying = true;
      requestAnimationFrame(checkLoop);
    } catch (e) {
      console.warn('Could not play music:', e);
    }
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    if (this.nextAudio) {
      this.nextAudio.pause();
      this.nextAudio = null;
    }
    this.isPlaying = false;
    this.crossfading = false;
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio) {
      this.audio.volume = this.volume;
    }
  }
}

export const proceduralMusic = new ProceduralMusicManager();
