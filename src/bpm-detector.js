/**
 * BPM detection tuned for stable musical tempo matching.
 * Builds an onset envelope, scores tempos by autocorrelation, then exposes
 * half/double alternatives because detected tempo often differs by a clean factor.
 */

export async function detectBPM(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const analysisBuffer = trimForAnalysis(audioBuffer, sampleRate);
  const filtered = await renderFilteredMono(analysisBuffer, sampleRate);
  const envelope = buildOnsetEnvelope(filtered, sampleRate);
  const candidates = scoreTempoCandidates(envelope.values, envelope.frameRate);

  if (candidates.length === 0) {
    return null;
  }

  const best = selectPrimaryCandidate(candidates);
  const normalized = normalizeTempoRange(best.bpm);

  return {
    bpm: roundBpm(normalized),
    rawBpm: roundBpm(best.bpm),
    confidence: best.confidence,
    candidates: buildBpmVariants(best.bpm, candidates),
  };
}

function trimForAnalysis(audioBuffer, sampleRate) {
  const maxDuration = 180;
  const trimStart = 0;
  const startFrame = Math.floor(trimStart * sampleRate);
  const frameCount = Math.min(
    Math.floor(maxDuration * sampleRate),
    audioBuffer.length - startFrame,
  );
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const ctx = new OfflineAudioContext(channels, frameCount, sampleRate);
  const copy = ctx.createBuffer(channels, frameCount, sampleRate);

  for (let ch = 0; ch < channels; ch++) {
    const source = audioBuffer.getChannelData(Math.min(ch, audioBuffer.numberOfChannels - 1));
    const target = copy.getChannelData(ch);
    for (let i = 0; i < frameCount; i++) {
      target[i] = source[startFrame + i] || 0;
    }
  }

  return copy;
}

async function renderFilteredMono(audioBuffer, sampleRate) {
  const ctx = new OfflineAudioContext(1, audioBuffer.length, sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 90;
  highpass.Q.value = 0.7;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 4200;
  lowpass.Q.value = 0.7;

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(ctx.destination);
  source.start(0);

  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

function buildOnsetEnvelope(samples, sampleRate) {
  const frameSize = 1024;
  const hopSize = 256;
  const values = [];
  let prevEnergy = 0;

  for (let i = 0; i + frameSize < samples.length; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < frameSize; j++) {
      const sample = samples[i + j];
      energy += sample * sample;
    }

    const currentEnergy = Math.sqrt(energy / frameSize);
    values.push(Math.max(0, currentEnergy - prevEnergy));
    prevEnergy = currentEnergy;
  }

  removeLocalMean(values, Math.round(sampleRate / hopSize));
  normalize(values);

  return {
    values,
    frameRate: sampleRate / hopSize,
  };
}

function removeLocalMean(values, radius) {
  const copy = values.slice();
  let sum = 0;
  let start = 0;

  for (let i = 0; i < values.length; i++) {
    sum += copy[i];
    while (i - start > radius) {
      sum -= copy[start];
      start++;
    }
    values[i] = Math.max(0, copy[i] - sum / (i - start + 1));
  }
}

function normalize(values) {
  let max = 0;
  for (const value of values) {
    if (value > max) max = value;
  }
  if (max <= 0) return;
  for (let i = 0; i < values.length; i++) {
    values[i] /= max;
  }
}

function scoreTempoCandidates(envelope, frameRate) {
  const scores = [];

  for (let bpm = 60; bpm <= 240; bpm += 0.1) {
    const lag = (60 / bpm) * frameRate;
    const score = autocorrelationScore(envelope, lag);

    if (score > 0) {
      scores.push({ bpm, score });
    }
  }

  const peaks = [];
  for (let i = 1; i < scores.length - 1; i++) {
    if (scores[i].score >= scores[i - 1].score && scores[i].score >= scores[i + 1].score) {
      peaks.push(scores[i]);
    }
  }

  if (peaks.length === 0) return [];

  peaks.sort((a, b) => b.score - a.score);
  const maxScore = peaks[0].score;
  const deduped = [];

  for (const peak of peaks) {
    if (deduped.some((item) => areRelatedTempos(item.bpm, peak.bpm))) continue;
    deduped.push({
      bpm: refineBpm(envelope, frameRate, peak.bpm),
      confidence: Math.max(0, Math.min(1, peak.score / maxScore)),
      score: peak.score,
    });
    if (deduped.length >= 8) break;
  }

  return deduped.sort((a, b) => b.score - a.score);
}

function selectPrimaryCandidate(candidates) {
  const top = candidates[0];
  const strongWorkingTempo = candidates.find((candidate) => (
    candidate.bpm >= 130 &&
    candidate.bpm <= 210 &&
    candidate.score >= top.score * 0.48
  ));

  return strongWorkingTempo || top;
}

function autocorrelationScore(values, lag) {
  const maxOffset = Math.floor(Math.min(values.length - lag * 4, values.length - lag));
  if (lag <= 0 || maxOffset <= 0) return 0;

  let score = 0;
  let weight = 0;

  for (let i = 0; i < maxOffset; i++) {
    const value = values[i];
    if (value <= 0) continue;

    score += value * sampleAt(values, i + lag);
    score += value * sampleAt(values, i + lag * 2) * 0.65;
    score += value * sampleAt(values, i + lag * 3) * 0.4;
    weight += value;
  }

  return weight > 0 ? score / weight : 0;
}

function refineBpm(values, frameRate, bpm) {
  let bestBpm = bpm;
  let bestScore = -Infinity;

  for (let candidate = bpm - 1.5; candidate <= bpm + 1.5; candidate += 0.01) {
    const lag = (60 / candidate) * frameRate;
    const score = autocorrelationScore(values, lag);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = candidate;
    }
  }

  return bestBpm;
}

function sampleAt(values, index) {
  const left = Math.floor(index);
  const right = left + 1;
  if (left < 0 || right >= values.length) return 0;
  const mix = index - left;
  return values[left] * (1 - mix) + values[right] * mix;
}

function areRelatedTempos(a, b) {
  const ratios = [1, 2, 0.5];
  return ratios.some((ratio) => Math.abs(a * ratio - b) < 0.8);
}

function normalizeTempoRange(bpm) {
  let normalized = bpm;
  while (normalized < 120) normalized *= 2;
  while (normalized > 240) normalized /= 2;
  return normalized;
}

function buildBpmVariants(primaryBpm, candidates) {
  const values = [
    primaryBpm / 2,
    primaryBpm,
    Math.round(primaryBpm),
    Math.round(primaryBpm) + 1,
    Math.round(primaryBpm) - 1,
    primaryBpm * 2,
    normalizeTempoRange(primaryBpm),
    ...candidates.slice(1, 5).map((candidate) => candidate.bpm),
  ];
  const unique = [];

  for (const value of values) {
    if (value < 60 || value > 300) continue;
    const bpm = roundBpm(value);
    if (!unique.some((item) => Math.abs(item.bpm - bpm) < 0.6)) {
      unique.push({
        bpm,
        label: getVariantLabel(bpm, primaryBpm),
      });
    }
  }

  return unique.sort((a, b) => scoreVariant(a.bpm, primaryBpm) - scoreVariant(b.bpm, primaryBpm));
}

function getVariantLabel(bpm, primaryBpm) {
  if (Math.abs(bpm - normalizeTempoRange(primaryBpm)) < 0.8) return 'main';
  if (Math.abs(bpm - primaryBpm / 2) < 0.8) return '1/2';
  if (Math.abs(bpm - primaryBpm * 2) < 0.8) return '2x';
  return 'alt';
}

function scoreVariant(bpm, primaryBpm) {
  const normalized = normalizeTempoRange(primaryBpm);
  if (Math.abs(bpm - normalized) < 0.8) return 0;
  if (bpm >= 120 && bpm <= 240) return 1;
  return 2;
}

function roundBpm(value) {
  return Math.round(value * 100) / 100;
}
