# transcribe

A simple local video transcription tool for macOS using `ffmpeg` and `whisper.cpp`.

## Requirements

- Homebrew
- ffmpeg
- whisper-cli (from `brew install whisper-cpp`)
- `models/ggml-small.en.bin`

## Usage

```bash
transcribe "/path/to/video.mov"
```

The script creates:

- `video.srt`
- `video.vtt`

next to the original video.

All processing is performed locally. No cloud services are used.
