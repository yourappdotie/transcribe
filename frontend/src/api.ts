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
}

export async function uploadFile(file: File): Promise<{ fileId: string; filename: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Upload failed");
  }

  return response.json();
}

export async function getStatus(fileId: string): Promise<FileStatus> {
  const response = await fetch(`/api/status/${fileId}`);

  if (!response.ok) {
    throw new Error("Failed to get status");
  }

  return response.json();
}

export async function listFiles(fileId: string): Promise<string[]> {
  const response = await fetch(`/api/files/${fileId}`);

  if (!response.ok) {
    throw new Error("Failed to list files");
  }

  return response.json();
}

export function getDownloadUrl(fileId: string, filename: string): string {
  return `/api/download/${fileId}/${encodeURIComponent(filename)}`;
}
