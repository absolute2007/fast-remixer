# Fast Remixer

Fast Remixer is a desktop audio utility for quickly loading a track, changing playback speed, pitch, and gain, checking BPM candidates, editing basic metadata, and exporting the result to common audio formats.

## Features

- Load common audio formats: MP3, WAV, FLAC, OGG, AAC, M4A, WMA, OPUS, AIFF, APE, WV, and related containers.
- Preview changes with transport controls and waveform seeking.
- Adjust speed, pitch, and export gain.
- Detect BPM candidates and manually set the final BPM when needed.
- Edit title, artist, album, year, track, and genre before export.
- Export to WAV, MP3, FLAC, OGG, or AAC using bundled FFmpeg.

## Download

Windows installer:

[Fast Remixer Setup 1.0.0](https://github.com/absolute2007/fast-remixer/releases/download/v1.0.0/Fast.Remixer.Setup.1.0.0.exe)

## Development

Requirements:

- Node.js
- npm

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev
```

Run the Electron app in development mode:

```bash
npm run dev:electron
```

Build the frontend:

```bash
npm run build
```

Build the Windows installer:

```bash
npm run dist
```

The installer is written to `dist/`.

## Notes

BPM detection is a helper, not a replacement for checking the beat grid by ear. The app shows multiple candidates and includes a manual BPM field for tracks where the best practical value is slightly different from the strongest automatic estimate.
