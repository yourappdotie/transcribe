import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "../uploads");
const modelsDir = path.join(__dirname, "../../models");

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
}

export async function updateStatus(fileId: string, status: Partial<FileStatus>): Promise<void> {
  const fileDir = path.join(uploadsDir, fileId);
  const statusPath = path.join(fileDir, ".status.json");

  await fs.mkdir(fileDir, { recursive: true });

  const current = await getFileStatus(fileId).catch(() => ({}));
  const updated = { fileId, ...current, ...status };

  await fs.writeFile(statusPath, JSON.stringify(updated, null, 2));
}

export async function getFileStatus(fileId: string): Promise<FileStatus> {
  const fileDir = path.join(uploadsDir, fileId);
  const statusPath = path.join(fileDir, ".status.json");

  try {
    const content = await fs.readFile(statusPath, "utf-8");
    return JSON.parse(content);
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
