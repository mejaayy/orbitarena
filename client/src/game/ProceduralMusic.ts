export class ProceduralMusicManager {
  private audio: HTMLAudioElement | null = null;
  private isPlaying: boolean = false;

  constructor() {}

  start() {
    if (this.isPlaying) return;

    try {
      this.audio = new Audio('/music.mp3');
      this.audio.loop = false;
      this.audio.volume = 0.125;
      this.audio.currentTime = 13;

      this.audio.addEventListener('timeupdate', () => {
        if (this.audio && this.audio.currentTime >= 115) {
          this.audio.currentTime = 13;
        }
      });

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
    this.isPlaying = false;
  }

  setVolume(volume: number) {
    if (this.audio) {
      this.audio.volume = Math.max(0, Math.min(1, volume));
    }
  }
}

export const proceduralMusic = new ProceduralMusicManager();
