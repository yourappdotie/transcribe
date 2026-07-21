import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { updateStatus, getModelPath } from "./storage.js";

export async function transcribeFile(fileId: string, inputPath: string): Promise<void> {
  const fileDir = path.dirname(inputPath);
  const filename = path.basename(inputPath);
  const ext = path.extname(filename).toLowerCase();
  const basename = path.basename(filename, ext);

  try {
    // Check for model
    const modelPath = await getModelPath();
    if (!modelPath) {
      throw new Error("Whisper model not found at models/ggml-small.en.bin");
    }

    // Convert MOV to MP4 if needed
    if (ext === ".mov") {
      const mp4Path = path.join(fileDir, `${basename}.mp4`);
      const mp4Exists = await fs
        .access(mp4Path)
        .then(() => true)
        .catch(() => false);

      if (!mp4Exists) {
        await updateStatus(fileId, {
          step: "converting",
          message: "Creating browser-compatible MP4...",
          progress: 0,
        });

        await runCommand("ffmpeg", [
          "-y",
          "-loglevel",
          "error",
          "-i",
          inputPath,
          "-c",
          "copy",
          mp4Path,
        ]);

        await updateStatus(fileId, {
          step: "converting",
          message: "MP4 created",
          progress: 100,
        });
      }
    }

    // Extract audio
    await updateStatus(fileId, {
      step: "extracting",
      message: "Extracting audio...",
      progress: 0,
    });

    const wavPath = path.join(fileDir, `${basename}.wav`);
    await runCommand("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      wavPath,
    ]);

    await updateStatus(fileId, {
      step: "extracting",
      message: "Audio extracted",
      progress: 100,
    });

    // Run Whisper
    await updateStatus(fileId, {
      step: "transcribing",
      message: "Running Whisper transcription...",
      progress: 0,
    });

    await runTranscribeCommand(fileId, wavPath, modelPath);

    const srtPath = path.join(fileDir, `${basename}.srt`);
    await fs.rename(`${wavPath}.srt`, srtPath);

    // Generate VTT
    const srtContent = await fs.readFile(srtPath, "utf-8");
    const vttContent = `WEBVTT\n\n${srtContent.replace(/,/g, ".")}`;
    const vttPath = path.join(fileDir, `${basename}.vtt`);
    await fs.writeFile(vttPath, vttContent);

    // Cleanup
    await fs.unlink(wavPath);

    await updateStatus(fileId, {
      step: "completed",
      message: "Transcription complete",
      progress: 100,
      output: {
        srt: `${basename}.srt`,
        vtt: `${basename}.vtt`,
        mp4: ext === ".mov" ? `${basename}.mp4` : null,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await updateStatus(fileId, {
      step: "error",
      message: error,
      progress: 0,
    });
    throw err;
  }
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stderr = "";

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} failed: ${stderr}`));
      } else {
        resolve();
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

async function runTranscribeCommand(
  fileId: string,
  wavPath: string,
  modelPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("whisper-cli", [
      "--language",
      "en",
      "--model",
      modelPath,
      "--output-srt",
      "--print-progress",
      wavPath,
    ]);

    let stderr = "";
    let lastProgress = 0;

    proc.stderr.on("data", (data) => {
      const output = data.toString();
      stderr += output;

      // Parse progress: "whisper_print_progress_callback: progress = X%"
      const match = output.match(/progress\s*=\s*(\d+)%/);
      if (match) {
        const progress = parseInt(match[1], 10);
        if (progress !== lastProgress) {
          lastProgress = progress;
          updateStatus(fileId, {
            step: "transcribing",
            message: `Transcribing... ${progress}%`,
            progress,
          }).catch(() => {
            // Ignore status update errors
          });
        }
      }
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`whisper-cli failed: ${stderr}`));
      } else {
        resolve();
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}
