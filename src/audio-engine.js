/**
 * Audio engine using SoundTouch.js for real-time pitch/tempo manipulation.
 * Wraps Web Audio API + SoundTouch PitchShifter.
 */
import { PitchShifter, SoundTouch, SimpleFilter, WebAudioBufferSource } from 'soundtouchjs';

export class AudioEngine {
  constructor() {
    this.audioContext = null;
    this.audioBuffer = null;
    this.shifter = null;
    this.gainNode = null;

    this._playing = false;
    this._speed = 1.0;
    this._pitch = 0; // semitones
    this._exportVolume = 1.0;

    this.onTimeUpdate = null;
    this.onEnded = null;
  }

  async init() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  async loadBuffer(arrayBuffer) {
    await this.init();
    this.stop();

    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

    // Create SoundTouch processor
    this._createShifter();

    return this.audioBuffer;
  }

  _createShifter() {
    if (this.shifter) {
      this.shifter.off();
      this.shifter.disconnect();
    }

    this.shifter = new PitchShifter(
      this.audioContext,
      this.audioBuffer,
      4096,
      () => {
        // on end callback
        this._playing = false;
        if (this.onEnded) this.onEnded();
      }
    );

    this.shifter.tempo = this._speed;
    this.shifter.pitchSemitones = this._pitch;
    this.shifter.connect(this.gainNode);

    // Track playback position
    this.shifter.on('play', (detail) => {
      if (this.onTimeUpdate) {
        this.onTimeUpdate({
          currentTime: detail.timePlayed,
          duration: this.audioBuffer.duration,
          percentage: detail.percentagePlayed
        });
      }
    });
  }

  play() {
    if (!this.audioBuffer) return;
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    this._playing = true;
  }

  pause() {
    if (this.audioContext) {
      this.audioContext.suspend();
    }
    this._playing = false;
  }

  stop() {
    if (this.shifter) {
      this.shifter.percentagePlayed = 0;
    }
    this._playing = false;
    if (this.audioContext && this.audioContext.state !== 'suspended') {
      this.audioContext.suspend();
    }
  }

  seekTo(percentage) {
    if (!this.shifter) return;
    // SoundTouch SimpleFilter can only seek backwards
    // Recreate the shifter and set position
    const wasPlaying = this._playing;
    if (wasPlaying) {
      this.audioContext.suspend();
    }

    this._createShifter();
    this.shifter.percentagePlayed = percentage;

    if (wasPlaying) {
      this.audioContext.resume();
      this._playing = true;
    }
  }

  set speed(value) {
    this._speed = value;
    if (this.shifter) {
      this.shifter.tempo = value;
    }
  }

  get speed() {
    return this._speed;
  }

  set pitchSemitones(value) {
    this._pitch = value;
    if (this.shifter) {
      this.shifter.pitchSemitones = value;
    }
  }

  get pitchSemitones() {
    return this._pitch;
  }

  set volume(value) {
    if (this.gainNode) {
      this.gainNode.gain.value = value;
    }
  }

  get volume() {
    return this.gainNode ? this.gainNode.gain.value : 1;
  }

  set exportVolume(value) {
    this._exportVolume = value;
  }

  get exportVolume() {
    return this._exportVolume;
  }

  get playing() {
    return this._playing;
  }

  get duration() {
    return this.audioBuffer ? this.audioBuffer.duration : 0;
  }

  get currentTime() {
    if (!this.shifter) return 0;
    return this.shifter.timePlayed || 0;
  }

  get sampleRate() {
    return this.audioBuffer ? this.audioBuffer.sampleRate : 0;
  }

  /**
   * Render the processed audio offline and return as AudioBuffer.
   * Used for export.
   */
  async renderOffline() {
    if (!this.audioBuffer) return null;

    const sampleRate = this.audioBuffer.sampleRate;
    const channels = this.audioBuffer.numberOfChannels;
    const sourceFrames = this.audioBuffer.length;

    const st = new SoundTouch();
    st.tempo = this._speed;
    st.pitchSemitones = this._pitch;

    const source = new WebAudioBufferSource(this.audioBuffer);
    const filter = new SimpleFilter(source, st);

    // Estimate output length
    const estimatedFrames = Math.ceil(sourceFrames / this._speed) + 8192;
    const outputL = new Float32Array(estimatedFrames);
    const outputR = new Float32Array(estimatedFrames);

    const bufSize = 4096;
    const extractBuf = new Float32Array(bufSize * 2);
    let totalFrames = 0;

    while (true) {
      const extracted = filter.extract(extractBuf, bufSize);
      if (extracted === 0) break;

      for (let i = 0; i < extracted; i++) {
        if (totalFrames + i < estimatedFrames) {
          outputL[totalFrames + i] = extractBuf[i * 2];
          outputR[totalFrames + i] = extractBuf[i * 2 + 1];
        }
      }
      totalFrames += extracted;
    }

    // Create output AudioBuffer
    const outCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
    const outBuffer = outCtx.createBuffer(2, totalFrames, sampleRate);
    const outL = outputL.subarray(0, totalFrames);
    const outR = outputR.subarray(0, totalFrames);

    // Apply export volume
    if (this._exportVolume !== 1) {
      const g = this._exportVolume;
      for (let i = 0; i < totalFrames; i++) {
        outL[i] *= g;
        outR[i] *= g;
      }
    }

    outBuffer.getChannelData(0).set(outL);
    outBuffer.getChannelData(1).set(outR);

    return outBuffer;
  }
}
