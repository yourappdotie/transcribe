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

    // Find video file
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

    // Check for VTT/SRT files (regardless of state)
    const finalVttExists = files.some((f) => f === `${basename}.vtt`);
    const finalSrtExists = files.some((f) => f === `${basename}.srt`);
    const mp4Exists = files.some((f) => f === `${basename}.mp4`);

    // Check for chunk files
    const chunkSrts = files.filter((f) => f.match(/^chunk_\d+\.srt$/)).length;

    // Determine progress
    let totalChunks = 0;
    try {
      const { getVideoDuration } = await import("./transcribe.js");
      const duration = await getVideoDuration(path.join(fileDir, filename));
      totalChunks = Math.ceil(duration / 60);
    } catch {
      // Can't calculate, estimate from chunks
      totalChunks = chunkSrts || 1;
    }

    const progress = totalChunks > 0 ? Math.round((chunkSrts / totalChunks) * 100) : 0;
    const isComplete = chunkSrts > 0 && chunkSrts === totalChunks;

    return {
      fileId,
      filename,
      step: isComplete ? "completed" : chunkSrts > 0 ? "transcribing" : "extracting",
      message: isComplete
        ? "Transcription complete"
        : chunkSrts > 0
        ? `Transcribing chunk ${chunkSrts}/${totalChunks}...`
        : "Preparing audio extraction...",
      progress: isComplete ? 100 : progress,
      numChunks: totalChunks,
      output: finalVttExists || finalSrtExists ? {
        srt: finalSrtExists ? `${basename}.srt` : null,
        vtt: finalVttExists ? `${basename}.vtt` : null,
        mp4: mp4Exists ? `${basename}.mp4` : null,
      } : undefined,
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
