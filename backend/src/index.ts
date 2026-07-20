import express, { Request, Response } from "express";
import cors from "cors";
import multer, { StorageEngine } from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs/promises";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { transcribeFile } from "./transcribe.js";
import { getFileStatus, listResults } from "./storage.js";

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

app.listen(port, () => {
  console.log(`Transcribe backend running on http://localhost:${port}`);
});
