import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { updateStatus, getModelPath } from "./storage.js";

const CHUNK_DURATION = 60; // 1 minute
const CHUNK_OVERLAP = 5; // 5 second overlap

interface SubtitleEntry {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export async function transcribeFile(fileId: string, inputPath: string): Promise<void> {
  const fileDir = path.dirname(inputPath);
  const filename = path.basename(inputPath);
  const ext = path.extname(filename).toLowerCase();
  const basename = path.basename(filename, ext);
  const startTime = Date.now();

  try {
    await updateStatus(fileId, { startTime });

    const modelPath = await getModelPath();
    if (!modelPath) {
      throw new Error("Whisper model not found at models/ggml-small.en.bin");
    }

    // Get video duration
    const duration = await getVideoDuration(inputPath);
    const numChunks = Math.ceil(duration / CHUNK_DURATION);

    await updateStatus(fileId, {
      step: "converting",
      message: `Converting to MP4 if needed...`,
      progress: 0,
    });

    // Handle MOV to MP4 conversion if needed
    let videoPath = inputPath;
    if (ext === ".mov") {
      const mp4Path = path.join(fileDir, `${basename}.mp4`);
      const mp4Exists = await fs
        .access(mp4Path)
        .then(() => true)
        .catch(() => false);

      if (!mp4Exists) {
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
      }
      videoPath = mp4Path;
    }

    // Split video into chunks
    const chunkPaths = await splitVideoIntoChunks(fileId, videoPath, fileDir, numChunks);

    // Transcribe each chunk
    const allSubtitles: SubtitleEntry[][] = [];

    for (let i = 0; i < chunkPaths.length; i++) {
      const chunkNum = i + 1;
      const progress = Math.round((i / chunkPaths.length) * 100);

      await updateStatus(fileId, {
        step: "transcribing",
        message: `Transcribing chunk ${chunkNum}/${numChunks}...`,
        progress,
      });

      const wavPath = path.join(fileDir, `chunk_${chunkNum}.wav`);
      const srtPath = path.join(fileDir, `chunk_${chunkNum}.srt`);

      // Extract audio
      await runCommand("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-i",
        chunkPaths[i],
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wavPath,
      ]);

      // Transcribe with whisper-cli
      await runTranscribeCommand(fileId, wavPath, modelPath, chunkNum, numChunks);

      // Rename the .wav.srt to .srt
      const wavSrtPath = `${wavPath}.srt`;
      try {
        await fs.rename(wavSrtPath, srtPath);
      } catch (err) {
        console.error(`Failed to rename ${wavSrtPath} to ${srtPath}:`, err);
        throw new Error(`Whisper-cli did not create subtitle file for chunk ${chunkNum}`);
      }

      // Read and offset subtitles
      const subtitles = await readAndOffsetSRT(srtPath, i * CHUNK_DURATION);
      allSubtitles.push(subtitles);

      // Cleanup chunk video and audio files (keep SRT for live transcription)
      await fs.unlink(chunkPaths[i]);
      await fs.unlink(wavPath);
    }

    // Merge subtitles with overlap reconciliation
    const mergedSrt = mergeSubtitlesWithOverlap(allSubtitles, numChunks);
    const mergedVtt = convertSRTtoVTT(mergedSrt);

    const srtPath = path.join(fileDir, `${basename}.srt`);
    const vttPath = path.join(fileDir, `${basename}.vtt`);

    await fs.writeFile(srtPath, mergedSrt);
    await fs.writeFile(vttPath, mergedVtt);

    const endTime = Date.now();
    const duration_ms = endTime - startTime;

    await updateStatus(fileId, {
      step: "completed",
      message: "Transcription complete",
      progress: 100,
      endTime,
      duration: duration_ms,
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

async function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);

    let output = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && output.trim()) {
        const duration = parseFloat(output.trim());
        if (!isNaN(duration)) {
          resolve(duration);
          return;
        }
      }
      reject(new Error(`Failed to get video duration: ${stderr || "No output from ffprobe"}`));
    });

    proc.on("error", (err) => reject(err));
  });
}

async function splitVideoIntoChunks(
  fileId: string,
  videoPath: string,
  fileDir: string,
  numChunks: number
): Promise<string[]> {
  const chunkPaths: string[] = [];

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * CHUNK_DURATION;
    const duration = CHUNK_DURATION + CHUNK_OVERLAP;
    const chunkPath = path.join(fileDir, `chunk_${i + 1}.mp4`);
    const chunkNum = i + 1;
    const progress = Math.round((i / numChunks) * 100);

    await updateStatus(fileId, {
      step: "converting",
      message: `Splitting chunk ${chunkNum}/${numChunks}...`,
      progress,
    });

    await runCommand("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      startTime.toString(),
      "-i",
      videoPath,
      "-t",
      duration.toString(),
      "-c",
      "copy",
      chunkPath,
    ]);

    chunkPaths.push(chunkPath);
  }

  return chunkPaths;
}

async function readAndOffsetSRT(
  srtPath: string,
  offsetSeconds: number
): Promise<SubtitleEntry[]> {
  try {
    const content = await fs.readFile(srtPath, "utf-8");
    const lines = content.split("\n");
    const entries: SubtitleEntry[] = [];
    let i = 0;
    let index = 1;

    while (i < lines.length) {
      const line = lines[i].trim();

      if (line.includes("-->")) {
        const [startStr, endStr] = line.split("-->").map((s) => s.trim());
        const startMs = timeToMs(startStr) + offsetSeconds * 1000;
        const endMs = timeToMs(endStr) + offsetSeconds * 1000;
        i++;

        const textLines: string[] = [];
        while (i < lines.length && lines[i].trim() !== "") {
          textLines.push(lines[i]);
          i++;
        }

        entries.push({
          index,
          startMs,
          endMs,
          text: textLines.join("\n"),
        });
        index++;
      }
      i++;
    }

    return entries;
  } catch {
    return [];
  }
}

function timeToMs(timeStr: string): number {
  const parts = timeStr.replace(",", ".").split(":");
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseFloat(parts[2]);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

function msToTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function mergeSubtitlesWithOverlap(
  allSubtitles: SubtitleEntry[][],
  numChunks: number
): string {
  const result: string[] = [];
  const allEntries: SubtitleEntry[] = [];
  const overlapMs = CHUNK_OVERLAP * 1000;

  // Combine all entries and handle overlaps
  for (let chunkIdx = 0; chunkIdx < allSubtitles.length; chunkIdx++) {
    const chunkStart = chunkIdx * CHUNK_DURATION * 1000;
    const overlapBoundary = chunkStart + (CHUNK_DURATION - CHUNK_OVERLAP) * 1000;

    for (const entry of allSubtitles[chunkIdx]) {
      // Check if this entry is in an overlap region
      if (chunkIdx > 0 && entry.startMs >= overlapBoundary - overlapMs) {
        // Entry is in overlap region
        const distToStart = entry.startMs - (overlapBoundary - overlapMs);
        const distToEnd = overlapBoundary - entry.startMs;

        // Favor earlier chunk if closer to start (0-2.5s), favor later chunk if closer to end (2.5-5s)
        if (distToStart < distToEnd) {
          // This entry already came from the earlier chunk, keep it
          allEntries.push(entry);
        } else {
          // This entry should come from the later chunk, skip it now and let the later chunk provide it
          continue;
        }
      } else if (chunkIdx < allSubtitles.length - 1 && entry.startMs >= overlapBoundary) {
        // This entry is in the overlap but should wait for the next chunk
        continue;
      } else {
        // Entry is not in overlap, add it
        allEntries.push(entry);
      }
    }
  }

  // Sort by start time and renumber
  allEntries.sort((a, b) => a.startMs - b.startMs);

  for (let i = 0; i < allEntries.length; i++) {
    result.push(String(i + 1));
    result.push(`${msToTime(allEntries[i].startMs)} --> ${msToTime(allEntries[i].endMs)}`);
    result.push(allEntries[i].text);
    result.push("");
  }

  return result.join("\n");
}

function convertSRTtoVTT(srt: string): string {
  const vttLines = ["WEBVTT", ""];
  const vttContent = srt
    .split("\n")
    .filter((line) => !line.match(/^\d+$/))
    .map((line) => line.replace(/,/g, "."))
    .join("\n");

  return "WEBVTT\n\n" + vttContent;
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
  modelPath: string,
  chunkNum: number,
  totalChunks: number
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

    proc.stderr.on("data", (data) => {
      const output = data.toString();
      stderr += output;

      // Parse progress from this chunk (0-100%)
      const match = output.match(/progress\s*=\s*(\d+)%/);
      if (match) {
        const chunkProgress = parseInt(match[1], 10);
        const overallProgress = Math.round(
          ((chunkNum - 1 + chunkProgress / 100) / totalChunks) * 100
        );
        updateStatus(fileId, {
          step: "transcribing",
          message: `Transcribing chunk ${chunkNum}/${totalChunks}... ${chunkProgress}%`,
          progress: overallProgress,
        }).catch(() => {
          // Ignore errors
        });
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
