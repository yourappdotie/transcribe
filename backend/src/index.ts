import express, { Request, Response } from "express";
import cors from "cors";
import multer, { StorageEngine } from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs/promises";
import { mkdirSync, rmSync } from "fs";
import { fileURLToPath } from "url";
import { transcribeFile } from "./transcribe.js";
import { getFileStatus, listResults } from "./storage.js";

const CHUNK_DURATION = 60;
const CHUNK_OVERLAP = 5;

interface SubtitleEntry {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, "../uploads");

const storage: StorageEngine = multer.diskStorage({
  destination: (req: Request & { fileId?: string }, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    const fileId = req.fileId || uuidv4();
    req.fileId = fileId;
    const fileDir = path.join(uploadsDir, fileId);
    try {
      mkdirSync(fileDir, { recursive: true });
      cb(null, fileDir);
    } catch (err) {
      cb(err as Error, "");
    }
  },
  filename: (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

app.post(
  "/api/upload",
  upload.single("file"),
  async (req: Request & { file?: Express.Multer.File; fileId?: string }, res: Response) => {
    try {
      if (!req.file || !req.fileId) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const fileId = req.fileId;
      const fileDir = path.join(uploadsDir, fileId);
      const filePath = path.join(fileDir, req.file.filename);

      res.json({
        fileId,
        filename: req.file.filename,
        status: "uploaded",
      });

      transcribeFile(fileId, filePath).catch((err) => {
        console.error(`Transcription failed for ${fileId}:`, err);
      });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

app.get("/api/status/:fileId", async (req: Request, res: Response) => {
  try {
    const status = await getFileStatus(req.params.fileId);
    res.json(status);
  } catch (err) {
    console.error("Status error:", err);
    res.status(500).json({ error: "Failed to get status" });
  }
});

app.get("/api/files/:fileId", async (req: Request, res: Response) => {
  try {
    const files = await listResults(req.params.fileId);
    res.json(files);
  } catch (err) {
    console.error("List files error:", err);
    res.status(500).json({ error: "Failed to list files" });
  }
});

app.get("/api/download/:fileId/:filename", async (req: Request, res: Response) => {
  try {
    const fileDir = path.join(uploadsDir, req.params.fileId);
    const filePath = path.join(fileDir, req.params.filename);

    const realPath = await fs.realpath(filePath);
    if (!realPath.startsWith(await fs.realpath(fileDir))) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    res.download(filePath);
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).json({ error: "Download failed" });
  }
});

app.get("/api/uploads", async (req: Request, res: Response) => {
  try {
    const uploadsDir = path.join(__dirname, "../uploads");
    const folders = await fs.readdir(uploadsDir);
    const uploads = [];

    for (const folder of folders) {
      try {
        const folderPath = path.join(uploadsDir, folder);
        const stat = await fs.stat(folderPath);

        if (!stat.isDirectory()) continue;

        const statusPath = path.join(folderPath, ".status.json");
        let status;
        try {
          const content = await fs.readFile(statusPath, "utf-8");
          status = JSON.parse(content);
        } catch {
          continue;
        }

        // Count chunk files to determine progress
        const files = await fs.readdir(folderPath);
        const wavChunks = files.filter((f) => /^chunk_\d+\.wav$/.test(f)).length;
        const srtChunks = files.filter((f) => /^chunk_\d+\.srt$/.test(f)).length;
        const videoFile = files.find((f) =>
          f.match(/\.(mp4|mov|webm|mkv)$/i)
        );

        uploads.push({
          fileId: folder,
          filename: status.filename || videoFile || "Unknown",
          status: status.step,
          progress: status.progress || 0,
          wavChunks,
          srtChunks,
          createdAt: stat.birthtime,
        });
      } catch (err) {
        console.error(`Error processing folder ${folder}:`, err);
      }
    }

    // Sort by creation date, newest first
    uploads.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    res.json(uploads);
  } catch (err) {
    console.error("Error listing uploads:", err);
    res.status(500).json({ error: "Failed to list uploads" });
  }
});

app.get("/api/transcription/:fileId/live", async (req: Request, res: Response) => {
  try {
    const fileDir = path.join(uploadsDir, req.params.fileId);
    const files = await fs.readdir(fileDir);
    const chunkFiles = files
      .filter((f) => f.match(/^chunk_\d+\.srt$/))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)![0], 10);
        const numB = parseInt(b.match(/\d+/)![0], 10);
        return numA - numB;
      });

    if (chunkFiles.length === 0) {
      res.json({ srt: "", vtt: "" });
      return;
    }

    // Merge completed chunks
    const mergedSubtitles: SubtitleEntry[] = [];
    for (let i = 0; i < chunkFiles.length; i++) {
      const chunkFile = path.join(fileDir, chunkFiles[i]);
      const content = await fs.readFile(chunkFile, "utf-8");
      const entries = parseAndOffsetSRT(content, i * CHUNK_DURATION);
      mergedSubtitles.push(...entries);
    }

    mergedSubtitles.sort((a, b) => a.startMs - b.startMs);

    const srt = entriesToSRT(mergedSubtitles);
    const vtt = convertSRTtoVTT(srt);

    res.json({ srt, vtt });
  } catch (err) {
    console.error("Live transcription error:", err);
    res.status(500).json({ error: "Failed to get live transcription" });
  }
});

app.post("/api/update-subtitles/:fileId", async (req: Request, res: Response) => {
  try {
    const { vttContent } = req.body;
    if (!vttContent) {
      res.status(400).json({ error: "No VTT content provided" });
      return;
    }

    const fileDir = path.join(uploadsDir, req.params.fileId);
    const status = await getFileStatus(req.params.fileId);

    if (!status.output?.vtt) {
      res.status(400).json({ error: "No subtitle file found" });
      return;
    }

    const vttPath = path.join(fileDir, status.output.vtt);
    const srtPath = path.join(fileDir, status.output.srt || "");

    // Write VTT
    await fs.writeFile(vttPath, vttContent);

    // Convert VTT to SRT (replace periods with commas in timecodes)
    const srtContent = vttContent
      .replace(/WEBVTT\n\n/, "")
      .split("\n")
      .reduce((acc: string[], line: string, idx: number, arr: string[]) => {
        if (line.includes("-->")) {
          acc.push(line.replace(/\./g, ","));
        } else {
          acc.push(line);
        }
        return acc;
      }, [])
      .join("\n")
      .trim();

    // Add SRT numbering
    const srtLines = srtContent.split("\n");
    let entryNum = 1;
    let srtWithNumbers = "";
    for (let i = 0; i < srtLines.length; i++) {
      const line = srtLines[i];
      if (line.includes("-->")) {
        srtWithNumbers += entryNum + "\n" + line + "\n";
      } else if (line.trim() === "") {
        if (srtWithNumbers.trim() && srtWithNumbers.trim().split("\n").length > 2) {
          srtWithNumbers += "\n";
          entryNum++;
        }
      } else {
        srtWithNumbers += line + "\n";
      }
    }

    await fs.writeFile(srtPath, srtWithNumbers.trim());

    res.json({ success: true });
  } catch (err) {
    console.error("Update subtitles error:", err);
    res.status(500).json({ error: "Failed to update subtitles" });
  }
});

app.delete("/api/uploads/:fileId", async (req: Request, res: Response) => {
  try {
    const fileDir = path.join(uploadsDir, req.params.fileId);
    rmSync(fileDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete upload error:", err);
    res.status(500).json({ error: "Failed to delete upload" });
  }
});

app.listen(port, () => {
  console.log(`Transcribe backend running on http://localhost:${port}`);
});

// Helper functions for subtitle parsing
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

function parseAndOffsetSRT(content: string, offsetSeconds: number): SubtitleEntry[] {
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
}

function entriesToSRT(entries: SubtitleEntry[]): string {
  const result: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    result.push(String(i + 1));
    result.push(`${msToTime(entries[i].startMs)} --> ${msToTime(entries[i].endMs)}`);
    result.push(entries[i].text);
    result.push("");
  }

  return result.join("\n");
}

function convertSRTtoVTT(srt: string): string {
  return (
    "WEBVTT\n\n" +
    srt
      .split("\n")
      .filter((line) => !line.match(/^\d+$/))
      .map((line) => line.replace(/,/g, "."))
      .join("\n")
  );
}
