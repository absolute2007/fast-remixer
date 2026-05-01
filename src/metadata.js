/**
 * Metadata reader using music-metadata.
 * Reads ID3, Vorbis, APE, and other tags from audio files.
 */
import * as mm from 'music-metadata';

export async function readMetadata(file) {
  try {
    const buffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(buffer);

    const metadata = await mm.parseBuffer(uint8, file.type || undefined, {
      duration: true,
      skipCovers: false,
    });

    const common = metadata.common || {};
    const format = metadata.format || {};

    const result = {
      title: common.title || '',
      artist: common.artist || '',
      album: common.album || '',
      year: common.year ? String(common.year) : '',
      genre: common.genre ? common.genre[0] : '',
      track: common.track?.no ? String(common.track.no) : '',
      comment: common.comment ? common.comment[0] : '',

      // Format info
      format: format.codec || format.container || '—',
      sampleRate: format.sampleRate || 0,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : 0,
      channels: format.numberOfChannels || 0,
      duration: format.duration || 0,
      lossless: format.lossless || false,

      // Album art
      albumArt: null,
    };

    // Extract album art
    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      const blob = new Blob([pic.data], { type: pic.format });
      result.albumArt = URL.createObjectURL(blob);
    }

    return result;
  } catch (err) {
    console.warn('Metadata parse failed:', err.message);
    return null;
  }
}

export function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
