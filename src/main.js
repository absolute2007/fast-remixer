import './style.css';
import { AudioEngine } from './audio-engine.js';
import { Waveform } from './waveform.js';
import { detectBPM } from './bpm-detector.js';
import { readMetadata, formatDuration, formatFileSize } from './metadata.js';
import { audioBufferToWav, downloadBlob } from './exporter.js';

// --- State ---
const engine = new AudioEngine();
let waveform = null;
let currentFile = null;
let metadata = null;
let detectedBPM = null;

// --- DOM refs ---
const $ = (sel) => document.querySelector(sel);
const btnOpen = $('#btn-open');
const btnExport = $('#btn-export');
const exportFormat = $('#export-format');
const fileInput = $('#file-input');
const dropZone = $('#drop-zone');
const waveformContainer = $('#waveform-container');
const remixControls = $('#remix-controls');
const panelMetadata = $('#panel-metadata');

const btnPlay = $('#btn-play');
const btnStop = $('#btn-stop');
const btnSkipBack = $('#btn-skip-back');
const btnSkipForward = $('#btn-skip-forward');
const iconPlay = $('#icon-play');
const iconPause = $('#icon-pause');
const timeCurrent = $('#time-current');
const timeDuration = $('#time-duration');

const sliderSpeed = $('#slider-speed');
const sliderPitch = $('#slider-pitch');
const valSpeed = $('#val-speed');
const valPitch = $('#val-pitch');
const valVolume = $('#val-volume');
const sliderVolume = $('#slider-volume');
const sliderVolumeMain = $('#slider-volume-main');

const bpmValue = $('#bpm-value');
const btnDetectBPM = $('#btn-detect-bpm');
const bpmManualInput = $('#bpm-manual-input');
const btnSetBPM = $('#btn-set-bpm');
const bpmAdjusted = $('#bpm-adjusted');
const bpmAdjustedValue = $('#bpm-adjusted-value');
const bpmCandidates = $('#bpm-candidates');

const fileInfoContent = $('#file-info-content');

function updateSliderFill(slider) {
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const value = Number(slider.value || 0);
  const percent = ((value - min) / (max - min)) * 100;
  slider.style.setProperty('--slider-fill', `${Math.max(0, Math.min(100, percent))}%`);
}

function syncSlider(slider) {
  updateSliderFill(slider);
  slider.addEventListener('input', () => updateSliderFill(slider));
}

document.querySelectorAll('.remix-slider').forEach(syncSlider);

// --- File loading ---
btnOpen.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
});

// Drag & drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && isAudioFile(file)) {
    loadFile(file);
  }
});

// Also handle drop on the whole window
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file && isAudioFile(file)) {
    loadFile(file);
  }
});

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma', 'opus',
  'aiff', 'aif', 'ape', 'wv', 'mka', 'webm', 'mp4',
]);

function isAudioFile(file) {
  if (file.type.startsWith('audio/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ext && AUDIO_EXTENSIONS.has(ext);
}

async function loadFile(file) {
  currentFile = file;

  // Read audio data
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await engine.loadBuffer(arrayBuffer.slice(0));

  // Reset controls
  sliderSpeed.value = 1;
  sliderPitch.value = 0;
  sliderVolumeMain.value = 1;
  sliderVolume.value = 1;
  [sliderSpeed, sliderPitch, sliderVolumeMain, sliderVolume].forEach(updateSliderFill);
  valSpeed.textContent = '1.00×';
  valPitch.textContent = '0 st';
  valVolume.textContent = '100%';
  engine.speed = 1;
  engine.pitchSemitones = 0;
  engine.exportVolume = 1;
  engine.volume = 1;
  detectedBPM = null;
  bpmValue.textContent = '—';
  bpmAdjusted.hidden = true;
  bpmCandidates.hidden = true;
  bpmCandidates.innerHTML = '';

  // Show waveform
  dropZone.hidden = true;
  waveformContainer.hidden = false;
  remixControls.hidden = false;
  panelMetadata.hidden = false;
  btnExport.disabled = false;
  exportFormat.disabled = false;
  btnDetectBPM.disabled = false;
  bpmManualInput.disabled = false;
  btnSetBPM.disabled = false;

  // Init waveform display
  if (waveform) waveform.destroy();
  waveform = new Waveform('#waveform');
  waveform.onSeek = (relativeX) => {
    engine.seekTo(relativeX);
    waveform.setProgress(relativeX * 100);
    updateTimeDisplay(relativeX * engine.duration, engine.duration);
  };
  await waveform.loadBlob(new Blob([arrayBuffer]));

  // Update duration display
  timeDuration.textContent = formatDuration(audioBuffer.duration);
  timeCurrent.textContent = '0:00';

  // Read metadata
  metadata = await readMetadata(file);
  renderFileInfo(metadata, file);
  renderMetadataForm(metadata);

  // Set up time tracking
  engine.onTimeUpdate = (info) => {
    updateTimeDisplay(info.currentTime, info.duration);
    waveform.setProgress(info.percentage);
  };

  engine.onEnded = () => {
    setPlayState(false);
    waveform.setProgress(0);
    timeCurrent.textContent = '0:00';
  };
}

// --- File info panel ---
function renderFileInfo(meta, file) {
  const rows = [];

  const name = meta?.title || file.name.replace(/\.[^.]+$/, '');
  rows.push(infoRow('Name', name));

  if (meta?.artist) rows.push(infoRow('Artist', meta.artist));
  if (meta?.album) rows.push(infoRow('Album', meta.album));

  rows.push(infoRow('Format', meta?.format || file.type.split('/')[1]?.toUpperCase() || '—'));
  rows.push(infoRow('Duration', formatDuration(meta?.duration || engine.duration)));

  if (meta?.sampleRate) rows.push(infoRow('Sample Rate', `${meta.sampleRate} Hz`));
  if (meta?.bitrate) rows.push(infoRow('Bitrate', `${meta.bitrate} kbps`));
  if (meta?.channels) rows.push(infoRow('Channels', meta.channels === 2 ? 'Stereo' : meta.channels === 1 ? 'Mono' : String(meta.channels)));

  rows.push(infoRow('Size', formatFileSize(file.size)));

  fileInfoContent.innerHTML = rows.join('');
}

function infoRow(label, value) {
  return `<div class="info-row"><span class="info-label">${label}</span><span class="info-value" title="${value}">${value}</span></div>`;
}

// --- Metadata form ---
function renderMetadataForm(meta) {
  if (!meta) return;
  $('#meta-title').value = meta.title;
  $('#meta-artist').value = meta.artist;
  $('#meta-album').value = meta.album;
  $('#meta-year').value = meta.year;
  $('#meta-track').value = meta.track;
  $('#meta-genre').value = meta.genre;

  const artContainer = $('#album-art-container');
  if (meta.albumArt) {
    artContainer.hidden = false;
    $('#album-art').src = meta.albumArt;
  } else {
    artContainer.hidden = true;
  }
}

function getMetadataFromForm() {
  return {
    title: $('#meta-title').value,
    artist: $('#meta-artist').value,
    album: $('#meta-album').value,
    year: $('#meta-year').value,
    track: $('#meta-track').value,
    genre: $('#meta-genre').value,
  };
}

// --- Playback controls ---
btnPlay.addEventListener('click', togglePlay);
btnStop.addEventListener('click', () => {
  engine.stop();
  setPlayState(false);
  waveform?.setProgress(0);
  timeCurrent.textContent = '0:00';
});

btnSkipBack.addEventListener('click', () => {
  const newTime = Math.max(0, engine.currentTime - 5);
  const pct = newTime / engine.duration;
  engine.seekTo(pct);
  waveform?.setProgress(pct * 100);
  updateTimeDisplay(newTime, engine.duration);
});

btnSkipForward.addEventListener('click', () => {
  const newTime = Math.min(engine.duration, engine.currentTime + 5);
  const pct = newTime / engine.duration;
  engine.seekTo(pct);
  waveform?.setProgress(pct * 100);
  updateTimeDisplay(newTime, engine.duration);
});

function togglePlay() {
  if (!engine.audioBuffer) return;
  if (engine.playing) {
    engine.pause();
    setPlayState(false);
  } else {
    engine.play();
    setPlayState(true);
  }
}

function setPlayState(playing) {
  iconPlay.hidden = playing;
  iconPause.hidden = !playing;
}

function updateTimeDisplay(current, duration) {
  timeCurrent.textContent = formatDuration(current);
  timeDuration.textContent = formatDuration(duration);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  }
});

// --- Remix sliders ---
sliderSpeed.addEventListener('input', () => {
  const val = parseFloat(sliderSpeed.value);
  engine.speed = val;
  valSpeed.textContent = `${val.toFixed(2)}×`;
  updateAdjustedBPM();
});

sliderPitch.addEventListener('input', () => {
  const val = parseFloat(sliderPitch.value);
  engine.pitchSemitones = val;
  const display = val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1);
  valPitch.textContent = `${display} st`;
});

// Transport volume -- controls what you hear during playback
sliderVolume.addEventListener('input', () => {
  engine.volume = parseFloat(sliderVolume.value);
});

// Remix panel volume -- controls the gain applied to the exported track
sliderVolumeMain.addEventListener('input', () => {
  const val = parseFloat(sliderVolumeMain.value);
  engine.exportVolume = val;
  valVolume.textContent = `${Math.round(val * 100)}%`;
});

// Reset buttons
document.querySelectorAll('.btn-reset').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const defaultVal = parseFloat(btn.dataset.default);
    const slider = document.getElementById(targetId);
    slider.value = defaultVal;
    slider.dispatchEvent(new Event('input'));
  });
});

// --- BPM detection ---
btnDetectBPM.addEventListener('click', async () => {
  if (!engine.audioBuffer) return;

  btnDetectBPM.disabled = true;
  btnDetectBPM.innerHTML = '<span class="spinner"></span>';

  try {
    const result = await detectBPM(engine.audioBuffer);
    detectedBPM = result?.bpm ?? null;
    bpmValue.textContent = detectedBPM ? formatBpm(detectedBPM) : '?';
    bpmManualInput.value = detectedBPM ? formatBpm(detectedBPM) : '';
    renderBpmCandidates(result?.candidates || []);
    updateAdjustedBPM();
  } catch {
    bpmValue.textContent = '?';
    bpmCandidates.hidden = true;
    bpmCandidates.innerHTML = '';
  }

  btnDetectBPM.textContent = 'Detect';
  btnDetectBPM.disabled = false;
});

btnSetBPM.addEventListener('click', applyManualBPM);
bpmManualInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    applyManualBPM();
  }
});

function updateAdjustedBPM() {
  if (!detectedBPM) return;
  const speed = parseFloat(sliderSpeed.value);
  const adjusted = detectedBPM * speed;
  if (Math.abs(speed - 1.0) > 0.005) {
    bpmAdjusted.hidden = false;
    bpmAdjustedValue.textContent = `${formatBpm(adjusted)} BPM`;
  } else {
    bpmAdjusted.hidden = true;
  }
}

function renderBpmCandidates(candidates) {
  if (!candidates.length) {
    bpmCandidates.hidden = true;
    bpmCandidates.innerHTML = '';
    return;
  }

  bpmCandidates.innerHTML = candidates
    .slice(0, 5)
    .map((candidate, index) => {
      const active = Math.abs(candidate.bpm - detectedBPM) < 0.6 || index === 0;
      return `<button class="bpm-chip${active ? ' is-active' : ''}" data-bpm="${candidate.bpm}">
        <span>${formatBpm(candidate.bpm)}</span>
        <small>${candidate.label}</small>
      </button>`;
    })
    .join('');
  bpmCandidates.hidden = false;

  bpmCandidates.querySelectorAll('.bpm-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      detectedBPM = Number(chip.dataset.bpm);
      bpmValue.textContent = formatBpm(detectedBPM);
      bpmManualInput.value = formatBpm(detectedBPM);
      bpmCandidates.querySelectorAll('.bpm-chip').forEach((item) => item.classList.remove('is-active'));
      chip.classList.add('is-active');
      updateAdjustedBPM();
    });
  });
}

function applyManualBPM() {
  const value = Number(bpmManualInput.value);
  if (!Number.isFinite(value) || value <= 0) return;

  detectedBPM = value;
  bpmValue.textContent = formatBpm(value);
  bpmCandidates.querySelectorAll('.bpm-chip').forEach((item) => item.classList.remove('is-active'));
  updateAdjustedBPM();
}

function formatBpm(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
}

// --- Export ---
btnExport.addEventListener('click', async () => {
  if (!engine.audioBuffer) return;

  const format = exportFormat.value;
  const meta = getMetadataFromForm();
  const baseName = meta.title || currentFile.name.replace(/\.[^.]+$/, '');
  const suffix = [];
  if (Math.abs(engine.speed - 1.0) > 0.005) suffix.push(`${engine.speed.toFixed(2)}x`);
  if (Math.abs(engine.pitchSemitones) > 0.05) suffix.push(`${engine.pitchSemitones > 0 ? '+' : ''}${engine.pitchSemitones.toFixed(1)}st`);
  const defaultName = suffix.length > 0
    ? `${baseName} (${suffix.join(', ')}).${format}`
    : `${baseName}.${format}`;

  // Use Electron save dialog if available, otherwise browser download
  const useElectron = typeof window.electronAPI !== 'undefined';

  if (useElectron) {
    const filterMap = {
      wav: { name: 'WAV Audio', extensions: ['wav'] },
      mp3: { name: 'MP3 Audio', extensions: ['mp3'] },
      flac: { name: 'FLAC Audio', extensions: ['flac'] },
      ogg: { name: 'OGG Vorbis', extensions: ['ogg'] },
      aac: { name: 'AAC Audio', extensions: ['m4a', 'aac'] },
    };

    const dialogResult = await window.electronAPI.showSaveDialog({
      title: 'Export track',
      defaultPath: defaultName,
      filters: [
        filterMap[format] || { name: 'Audio', extensions: [format] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (dialogResult.canceled || !dialogResult.filePath) return;

    btnExport.disabled = true;
    const origText = btnExport.innerHTML;
    btnExport.innerHTML = '<span class="spinner"></span> Rendering...';

    try {
      const rendered = await engine.renderOffline();
      if (rendered) {
        const wavBlob = audioBufferToWav(rendered);
        const wavArrayBuffer = await wavBlob.arrayBuffer();

        const result = await window.electronAPI.saveFile({
          wavBuffer: new Uint8Array(wavArrayBuffer),
          filePath: dialogResult.filePath,
          format,
          metadata: meta,
        });

        if (!result.success) {
          console.error('Export error:', result.error);
        }
      }
    } catch (err) {
      console.error('Export failed:', err);
    }

    btnExport.innerHTML = origText;
    btnExport.disabled = false;
  } else {
    // Browser fallback: WAV only
    btnExport.disabled = true;
    const origText = btnExport.innerHTML;
    btnExport.innerHTML = '<span class="spinner"></span> Rendering...';

    try {
      const rendered = await engine.renderOffline();
      if (rendered) {
        const wavBlob = audioBufferToWav(rendered);
        downloadBlob(wavBlob, defaultName.replace(/\.[^.]+$/, '.wav'));
      }
    } catch (err) {
      console.error('Export failed:', err);
    }

    btnExport.innerHTML = origText;
    btnExport.disabled = false;
  }
});
