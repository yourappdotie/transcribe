# Transcribe

A modern web application for local audio and video transcription using Whisper and ffmpeg.

## Features

- **React + Vite frontend** with a clean, modern UI
- **Express.js backend** for file handling and transcription
- **File-isolated storage** – each upload gets its own folder
- **Real-time progress tracking** – see actual processing steps
- **Subtitle generation** – produces both SRT and WebVTT formats
- **Browser-compatible output** – automatically converts MOV to MP4
- **Local processing** – no cloud services, keeps everything on your machine

## Requirements

- Node.js 18+
- `ffmpeg`
- `whisper-cli` (from whisper.cpp)
- A Whisper model file

## Setup

### 1. Install dependencies

```bash
npm install
```

This installs dependencies for both the backend and frontend (monorepo setup).

### 2. Add Whisper model

Place a compatible Whisper model at:

```
models/ggml-small.en.bin
```

Download from: https://huggingface.co/ggerganov/whisper.cpp

### 3. Run in development

```bash
npm run dev
```

This starts both the backend (port 5000) and frontend (port 5173) concurrently.

Open http://localhost:5173 in your browser.

## Project Structure

```
transcribe/
├── backend/
│   ├── src/
│   │   ├── index.ts         # Express server
│   │   ├── transcribe.ts    # ffmpeg & whisper-cli execution
│   │   └── storage.ts       # Status tracking and file management
│   ├── uploads/             # Generated during runtime
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Main app component
│   │   ├── api.ts           # API client
│   │   ├── index.css        # Styles
│   │   └── components/      # React components
│   ├── index.html
│   └── package.json
├── models/                  # Add ggml-small.en.bin here
└── package.json             # Root monorepo config
```

## Usage

1. Open the web app at http://localhost:5173
2. Click or drag a video/audio file onto the upload zone
3. The app processes the file and shows real-time progress
4. Download the generated SRT and VTT subtitle files

## Output Files

For each upload, you get:

- **SRT** – SubRip subtitle format (for editing, most text editors)
- **VTT** – WebVTT format (for HTML5 video players)
- **MP4** – Browser-compatible video (only if input was MOV)

All files are stored in `backend/uploads/{fileId}/` isolated per upload.

## API Endpoints

- `POST /api/upload` – Upload a file
- `GET /api/status/:fileId` – Get transcription status
- `GET /api/files/:fileId` – List output files
- `GET /api/download/:fileId/:filename` – Download a result file

## Build for production

```bash
npm run build
npm run preview
```

The backend builds to `backend/dist/` and frontend to `frontend/dist/`.

## License

MIT
