import path from "path";
import fs from "fs/promises";
import { EventEmitter } from "events";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "../uploads");
const modelsDir = path.join(__dirname, "../../models");

export const statusEmitter = new EventEmitter();

export interface FileStatus {
  fileId: string;
  filename?: string;
  step: "uploading" | "converting" | "extracting" | "transcribing" | "completed" | "error";
  message: string;
  progress: number;
  output?: {
    srt: string | null;
    vtt: string | null;
    mp4: string | null;
  };
  startTime?: number;
  endTime?: number;
  duration?: number;
  numChunks?: number;
}

export async function getFileStatus(fileId: string): Promise<FileStatus> {
  const fileDir = path.join(uploadsDir, fileId);

  try {
    const files = await fs.readdir(fileDir);

    // Find video file and determine filename
    const videoFile = files.find((f) => f.match(/\.(mp4|mov|webm|mkv)$/i));
    if (!videoFile) {
      return {
        fileId,
        step: "uploading",
        message: "Waiting for upload...",
        progress: 0,
      };
    }

    const filename = videoFile;
    const ext = path.extname(filename).toLowerCase();
    const basename = path.basename(filename, ext);

    // Check for final files
    const finalVttExists = files.some((f) => f === `${basename}.vtt`);
    const finalSrtExists = files.some((f) => f === `${basename}.srt`);
    const mp4Exists = files.some((f) => f === `${basename}.mp4`);

    // Check for unedited backup files
    const uneditedVttExists = files.some((f) => f === `${basename}_unedited.vtt`);

    // Check for chunk files to determine progress
    const chunkSrts = files.filter((f) => f.match(/^chunk_\d+\.srt$/)).length;

    // If final files exist, transcription is complete
    if (finalVttExists && finalSrtExists) {
      return {
        fileId,
        filename,
        step: "completed",
        message: "Transcription complete",
        progress: 100,
        output: {
          srt: `${basename}.srt`,
          vtt: `${basename}.vtt`,
          mp4: mp4Exists ? `${basename}.mp4` : null,
        },
      };
    }

    // If unedited backup exists, we're in transcription
    if (uneditedVttExists && chunkSrts > 0) {
      const videoPath = path.join(fileDir, filename);
      let totalChunks = 0;
      try {
        const { getVideoDuration } = await import("./transcribe.js");
        const duration = await getVideoDuration(videoPath);
        totalChunks = Math.ceil(duration / 60); // 60-second chunks
      } catch {
        // If we can't get duration, estimate from chunk count
        totalChunks = chunkSrts + 2;
      }

      const progress = totalChunks > 0 ? Math.round((chunkSrts / totalChunks) * 100) : 0;

      return {
        fileId,
        filename,
        step: "transcribing",
        message: `Transcribing chunk ${chunkSrts}/${totalChunks}...`,
        progress,
        numChunks: totalChunks,
      };
    }

    // Chunks exist but no final files → resumable transcription
    if (chunkSrts > 0) {
      const videoPath = path.join(fileDir, filename);
      let totalChunks = 0;
      try {
        const { getVideoDuration } = await import("./transcribe.js");
        const duration = await getVideoDuration(videoPath);
        totalChunks = Math.ceil(duration / 60);
      } catch {
        totalChunks = chunkSrts + 2;
      }

      const progress = totalChunks > 0 ? Math.round((chunkSrts / totalChunks) * 100) : 0;

      return {
        fileId,
        filename,
        step: "transcribing",
        message: `Transcribing chunk ${chunkSrts}/${totalChunks}... (resuming)`,
        progress,
        numChunks: totalChunks,
      };
    }

    // Only video file exists
    return {
      fileId,
      filename,
      step: "extracting",
      message: "Preparing audio extraction...",
      progress: 0,
    };
  } catch {
    return {
      fileId,
      step: "uploading",
      message: "Waiting for upload...",
      progress: 0,
    };
  }
}

export async function listResults(fileId: string): Promise<string[]> {
  const fileDir = path.join(uploadsDir, fileId);

  try {
    const files = await fs.readdir(fileDir);
    return files.filter((f) => !f.startsWith("."));
  } catch {
    return [];
  }
}

export async function getModelPath(): Promise<string | null> {
  const modelPath = path.join(modelsDir, "ggml-small.en.bin");
  try {
    await fs.access(modelPath);
    return modelPath;
  } catch {
    return null;
  }
}
