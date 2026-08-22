import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { getModelPath, statusEmitter } from "./storage.js";

const CHUNK_DURATION = 60; // 1 minute
const CHUNK_OVERLAP = 5; // 5 second overlap

export interface SubtitleEntry {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number; // 0-1, average confidence of tokens
}

export async function transcribeFile(fileId: string, inputPath: string, signal?: AbortSignal): Promise<void> {
  const fileDir = path.dirname(inputPath);
  const filename = path.basename(inputPath);
  const ext = path.extname(filename).toLowerCase();
  const basename = path.basename(filename, ext);
  const startTime = Date.now();

  try {
    // Check if abort signal is already set
    if (signal?.aborted) {
      throw new DOMException("Transcription aborted", "AbortError");
    }
    const modelPath = await getModelPath();
    if (!modelPath) {
      throw new Error("Whisper model not found at models/ggml-small.en.bin");
    }

    // Get video duration
    const duration = await getVideoDuration(inputPath);
    const numChunks = Math.ceil(duration / CHUNK_DURATION);

    // Check if this is a resume (chunks already exist)
    const files = await fs.readdir(fileDir);
    const existingWavChunks = files.filter((f) => f.match(/^chunk_\d+\.wav$/)).length;
    const isResume = existingWavChunks > 0;

    // Check if final VTT exists (means edits have been made - preserve them)
    const finalSrtPath = path.join(fileDir, `${basename}.srt`);
    const finalVttPath = path.join(fileDir, `${basename}.vtt`);
    const finalFilesExist = await fs
      .access(finalVttPath)
      .then(() => true)
      .catch(() => false);

    if (!isResume) {
      // Fresh start: prepare for chunking
      statusEmitter.emit("update", fileId, {
        fileId,
        filename,
        step: "converting",
        message: `Preparing audio extraction...`,
        progress: 0,
        numChunks,
      });

      // Handle MOV to MP4 conversion if needed (for audio extraction source)
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
      }
    } else {
      // Resume: chunks already exist, go straight to transcribing
      statusEmitter.emit("update", fileId, {
        fileId,
        filename,
        step: "transcribing",
        message: `Resuming transcription (skipping audio extraction)...`,
        progress: 0,
        numChunks,
      });
    }

    // Determine the audio source (converted MP4 if MOV, otherwise original)
    const audioSource = ext === ".mov"
      ? path.join(fileDir, `${basename}.mp4`)
      : inputPath;

    // Track all subtitles as we go
    const allSubtitles: SubtitleEntry[][] = [];

    // Transcribe each chunk
    for (let i = 0; i < numChunks; i++) {
      // Check abort signal before each chunk
      if (signal?.aborted) {
        throw new DOMException("Transcription aborted", "AbortError");
      }

      const chunkNum = i + 1;
      const wavPath = path.join(fileDir, `chunk_${chunkNum}.wav`);
      const srtPath = path.join(fileDir, `chunk_${chunkNum}.srt`);
      const wavJsonPath = `${wavPath}.json`;
      const progress = Math.round((i / numChunks) * 100);

      // Check if this chunk is already transcribed
      try {
        await fs.access(wavJsonPath);

        // Broadcast progress for skipped chunks
        statusEmitter.emit("update", fileId, {
          fileId,
          filename,
          step: "transcribing",
          message: `Transcribing chunk ${chunkNum}/${numChunks}... (resuming)`,
          progress,
        });

        // Read existing JSON subtitles for merging
        const subtitles = await readAndOffsetJSON(wavJsonPath, i * CHUNK_DURATION);
        allSubtitles.push(subtitles);

        // Build incremental final merge with this chunk
        await buildIncrementalFinalVtt(
          fileDir,
          basename,
          allSubtitles,
          finalFilesExist
        );
        continue;
      } catch {
        // File doesn't exist, proceed with transcription
      }

      statusEmitter.emit("update", fileId, {
        fileId,
        filename,
        step: "transcribing",
        message: `Transcribing chunk ${chunkNum}/${numChunks}...`,
        progress,
      });

      // Extract audio chunk directly from source
      const chunkStartTime = i * CHUNK_DURATION;
      const chunkDuration = CHUNK_DURATION + CHUNK_OVERLAP;

      await runCommand("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        chunkStartTime.toString(),
        "-i",
        audioSource,
        "-t",
        chunkDuration.toString(),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wavPath,
      ]);

      // Transcribe with whisper-cli (outputs JSON)
      await runTranscribeCommand(fileId, wavPath, modelPath, chunkNum, numChunks);

      // Read JSON output and convert to SRT format
      try {
        const subtitles = await readAndOffsetJSON(wavJsonPath, i * CHUNK_DURATION);
        allSubtitles.push(subtitles);

        // Also save SRT format for backward compatibility
        const srtContent = subtitlesToSRT(subtitles);
        await fs.writeFile(srtPath, srtContent);
      } catch (err) {
        console.error(`Failed to parse JSON for chunk ${chunkNum}:`, err);
        throw new Error(`Whisper-cli did not create subtitle file for chunk ${chunkNum}`);
      }

      // Build incremental final merge with newly transcribed chunk
      await buildIncrementalFinalVtt(
        fileDir,
        basename,
        allSubtitles,
        finalFilesExist
      );
    }

    const endTime = Date.now();
    const duration_ms = endTime - startTime;

    statusEmitter.emit("update", fileId, {
      fileId,
      filename,
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
    statusEmitter.emit("update", fileId, {
      fileId,
      filename,
      step: "error",
      message: error,
      progress: 0,
    });
    throw err;
  }
}

export async function getVideoDuration(filePath: string): Promise<number> {
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

async function buildIncrementalFinalVtt(
  fileDir: string,
  basename: string,
  allSubtitles: SubtitleEntry[][],
  finalFilesExist: boolean
): Promise<void> {
  // Merge all completed chunks with overlap reconciliation and gap-filling
  const mergedSrt = mergeSubtitlesWithOverlap(allSubtitles, allSubtitles.length);
  const mergedVtt = convertSRTtoVTT(mergedSrt);

  // Always update both unedited and final versions
  const uneditedSrtPath = path.join(fileDir, `${basename}_unedited.srt`);
  const uneditedVttPath = path.join(fileDir, `${basename}_unedited.vtt`);
  const finalSrtPath = path.join(fileDir, `${basename}.srt`);
  const finalVttPath = path.join(fileDir, `${basename}.vtt`);

  await fs.writeFile(uneditedSrtPath, mergedSrt);
  await fs.writeFile(uneditedVttPath, mergedVtt);

  // Only update final files if they don't exist yet (first time)
  // After that, only user edits via /api/update-subtitles should modify final files
  if (!finalFilesExist) {
    await fs.writeFile(finalSrtPath, mergedSrt);
    await fs.writeFile(finalVttPath, mergedVtt);
  }
}

async function readAndOffsetJSON(
  jsonPath: string,
  offsetSeconds: number
): Promise<SubtitleEntry[]> {
  try {
    const content = await fs.readFile(jsonPath, "utf-8");
    const data = JSON.parse(content);
    const entries: SubtitleEntry[] = [];
    let index = 1;

    if (!data.transcription || !Array.isArray(data.transcription)) {
      return [];
    }

    for (const segment of data.transcription) {
      const startMs = segment.offsets.from + offsetSeconds * 1000;
      const endMs = segment.offsets.to + offsetSeconds * 1000;
      const text = segment.text.trim();

      // Calculate confidence as average of token probabilities
      let confidence = 0.5; // default if no tokens
      if (segment.tokens && Array.isArray(segment.tokens) && segment.tokens.length > 0) {
        const tokenConfidences = segment.tokens
          .map((token: any) => token.p || 0)
          .filter((p: number) => p > 0); // Filter out invalid probabilities

        if (tokenConfidences.length > 0) {
          confidence = tokenConfidences.reduce((a: number, b: number) => a + b, 0) / tokenConfidences.length;
        }
      }

      entries.push({
        index,
        startMs,
        endMs,
        text,
        confidence,
      });
      index++;
    }

    return entries;
  } catch (err) {
    console.error(`Error reading JSON: ${err}`);
    return [];
  }
}

export function timeToMs(timeStr: string): number {
  const parts = timeStr.replace(",", ".").split(":");
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseFloat(parts[2]);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

export function msToTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function subtitlesToSRT(entries: SubtitleEntry[]): string {
  const lines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    lines.push(String(i + 1));
    lines.push(`${msToTime(entry.startMs)} --> ${msToTime(entry.endMs)}`);
    lines.push(entry.text);
    lines.push("");
  }
  return lines.join("\n");
}

export function mergeSubtitlesWithOverlap(
  allSubtitles: SubtitleEntry[][],
  numChunks: number
): string {
  const result: string[] = [];
  const allEntries: SubtitleEntry[] = [];

  // Combine all entries from all chunks - keep everything initially
  for (let chunkIdx = 0; chunkIdx < allSubtitles.length; chunkIdx++) {
    for (const entry of allSubtitles[chunkIdx]) {
      allEntries.push(entry);
    }
  }

  // Sort by start time
  allEntries.sort((a, b) => a.startMs - b.startMs);

  // Deduplicate: for entries with same timing, keep the highest confidence version
  const seen = new Map<string, SubtitleEntry>();
  const dedupedEntries: SubtitleEntry[] = [];

  for (const entry of allEntries) {
    const key = `${entry.startMs}:${entry.endMs}`;
    const confidence = entry.confidence ?? 0.5;

    if (!seen.has(key)) {
      seen.set(key, entry);
      dedupedEntries.push(entry);
    } else {
      // Existing entry with same timing - compare confidence
      const existing = seen.get(key)!;
      const existingConfidence = existing.confidence ?? 0.5;

      // Keep the higher confidence version (more likely accurate)
      if (confidence > existingConfidence) {
        // Replace the existing entry
        const idx = dedupedEntries.indexOf(existing);
        if (idx !== -1) {
          dedupedEntries[idx] = entry;
        }
        seen.set(key, entry);
      }
      // Otherwise keep the existing one (higher or equal confidence)
    }
  }

  // Fill large gaps (>10 seconds) with BLANK_AUDIO to signal captions are on but silent
  const finalEntries: SubtitleEntry[] = [];
  const GAP_THRESHOLD_MS = 10000; // 10 seconds

  for (let i = 0; i < dedupedEntries.length; i++) {
    finalEntries.push(dedupedEntries[i]);

    // Check gap to next entry
    if (i < dedupedEntries.length - 1) {
      const gap = dedupedEntries[i + 1].startMs - dedupedEntries[i].endMs;

      if (gap > GAP_THRESHOLD_MS) {
        // Create a BLANK_AUDIO entry for the gap
        finalEntries.push({
          index: -1, // Will be renumbered
          startMs: dedupedEntries[i].endMs,
          endMs: dedupedEntries[i + 1].startMs,
          text: "[BLANK_AUDIO]",
        });
      }
    }
  }

  // Renumber entries and build output
  for (let i = 0; i < finalEntries.length; i++) {
    result.push(String(i + 1));
    result.push(`${msToTime(finalEntries[i].startMs)} --> ${msToTime(finalEntries[i].endMs)}`);
    result.push(finalEntries[i].text);
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
      "--output-json",
      "--print-progress",
      wavPath,
    ]);

    let stderr = "";

    proc.stderr.on("data", (data) => {
      const output = data.toString();
      stderr += output;

      // Parse progress from this chunk (0-100%)
      // whisper-cli outputs: "[00:15.600 --> 00:17.280]" or "progress = 50%" format
      const match = output.match(/progress\s*[=:]\s*(\d+)%?/i) ||
                   output.match(/(\d+)%/);

      if (match) {
        const chunkProgress = parseInt(match[1], 10);
        const overallProgress = Math.round(
          ((chunkNum - 1 + chunkProgress / 100) / totalChunks) * 100
        );

        console.log(`[${fileId}] Chunk ${chunkNum}: ${chunkProgress}% (overall: ${overallProgress}%)`);

        statusEmitter.emit("update", fileId, {
          fileId,
          step: "transcribing",
          message: `Transcribing chunk ${chunkNum}/${totalChunks}... ${chunkProgress}%`,
          progress: overallProgress,
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
