/**
 * Waveform display using wavesurfer.js.
 */
import WaveSurfer from 'wavesurfer.js';

export class Waveform {
  constructor(container) {
    this.wavesurfer = WaveSurfer.create({
      container,
      waveColor: '#526072',
      progressColor: '#2f7dd3',
      cursorColor: '#f4f7fb',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 'auto',
      normalize: true,
      interact: true,
      hideScrollbar: true,
      fillParent: true,
      backend: 'WebAudio',
    });

    // Disable wavesurfer's own audio playback — we use SoundTouch engine
    this.wavesurfer.setMuted(true);

    this.onSeek = null;

    this.wavesurfer.on('click', (relativeX) => {
      if (this.onSeek) {
        this.onSeek(relativeX);
      }
    });
  }

  async loadBlob(blob) {
    await this.wavesurfer.loadBlob(blob);
  }

  setProgress(percentage) {
    // percentage is 0-100
    if (this.wavesurfer && percentage >= 0) {
      this.wavesurfer.seekTo(Math.min(percentage / 100, 1));
    }
  }

  destroy() {
    if (this.wavesurfer) {
      this.wavesurfer.destroy();
    }
  }
}
