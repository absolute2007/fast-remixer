const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const isDev = !app.isPackaged;
const appName = 'Fast Remixer';

/** Resolve path to ffmpeg binary from ffmpeg-static. */
function getFfmpegPath() {
  try {
    return require('ffmpeg-static');
  } catch {
    return null;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 420,
    backgroundColor: '#111318',
    title: appName,
    icon: path.join(__dirname, '..', 'public', 'app-icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.setName(appName);

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// --- IPC: Show save dialog ---
ipcMain.handle('show-save-dialog', async (_event, options) => {
  const result = await dialog.showSaveDialog(options);
  return result;
});

// --- IPC: Save and convert file ---
ipcMain.handle('save-file', async (_event, options) => {
  const { wavBuffer, filePath, format, metadata } = options;

  // wavBuffer is a Uint8Array (arraybuffer sent from renderer)
  const tempWav = filePath + '.tmp.wav';

  try {
    // Write WAV to temp file
    fs.writeFileSync(tempWav, Buffer.from(wavBuffer));

    if (format === 'wav') {
      // For WAV just rename, no conversion needed (metadata not supported in WAV)
      fs.renameSync(tempWav, filePath);
      return { success: true };
    }

    // Convert with ffmpeg
    const ffmpeg = getFfmpegPath();
    if (!ffmpeg) {
      // Fallback: just save as WAV if ffmpeg not available
      fs.renameSync(tempWav, filePath);
      return { success: true, warning: 'ffmpeg not found, saved as WAV' };
    }

    const args = ['-y', '-i', tempWav];

    // Add metadata
    if (metadata) {
      if (metadata.title) args.push('-metadata', `title=${metadata.title}`);
      if (metadata.artist) args.push('-metadata', `artist=${metadata.artist}`);
      if (metadata.album) args.push('-metadata', `album=${metadata.album}`);
      if (metadata.year) args.push('-metadata', `date=${metadata.year}`);
      if (metadata.track) args.push('-metadata', `track=${metadata.track}`);
      if (metadata.genre) args.push('-metadata', `genre=${metadata.genre}`);
    }

    // Format-specific encoding options
    switch (format) {
      case 'mp3':
        args.push('-codec:a', 'libmp3lame', '-q:a', '2');
        break;
      case 'flac':
        args.push('-codec:a', 'flac', '-compression_level', '5');
        break;
      case 'ogg':
        args.push('-codec:a', 'libvorbis', '-q:a', '6');
        break;
      case 'aac':
        args.push('-codec:a', 'aac', '-b:a', '256k');
        break;
      default:
        args.push('-codec:a', 'pcm_s16le');
        break;
    }

    args.push(filePath);

    await new Promise((resolve, reject) => {
      execFile(ffmpeg, args, { timeout: 120000 }, (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve();
        }
      });
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(tempWav); } catch { /* ignore */ }
  }
});
