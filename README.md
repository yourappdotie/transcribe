# transcribe

A simple command-line transcription tool built around `whisper-cli` and `ffmpeg`.

It generates subtitle files suitable for editing, websites and HTML5 video players, while keeping the entire transcription process local.

## Features

- Transcribes audio and video files using Whisper.
- Produces both SRT and WebVTT subtitle files.
- Automatically remuxes MOV files to MP4 (without re-encoding) for improved browser compatibility.
- Uses local models only; no cloud services.

## Requirements

- `ffmpeg`
- `whisper-cli` (from whisper.cpp)
- A compatible Whisper model

## Model

The Whisper model is not included in this repository.

Place a compatible model at:

```
models/ggml-small.en.bin
```

## Usage

Transcribe one or more audio or video files:

```bash
./transcribe file1 file2 ...
```

The tool accepts any input format that `ffmpeg` can decode.

## Output

For an input such as:

```
sample.mov
```

the tool generates:

```
sample.mp4
sample.srt
sample.vtt
```

The MP4 is created only when the input is a MOV and is produced by remuxing the existing audio and video streams without re-encoding.

The original input file is never modified.

## Demo

The `demo` directory contains a minimal HTML page demonstrating subtitle playback.

Run a local web server:

```bash
cd demo
python3 -m http.server 8000
```

Then open:

```
http://localhost:8000
```

Opening the page directly using a `file://` URL may prevent subtitle tracks from loading correctly in some browsers.

## License

MIT