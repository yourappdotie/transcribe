import { useState } from "react";
import { uploadFile, getStatus, type FileStatus } from "./api";
import Uploader from "./components/Uploader";
import StatusDisplay from "./components/StatusDisplay";

interface TranscriptionJob {
  fileId: string;
  filename: string;
  status: FileStatus;
}

export default function App() {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);

  const handleUpload = async (file: File) => {
    try {
      const { fileId, filename } = await uploadFile(file);
      const initialStatus: FileStatus = {
        fileId,
        filename,
        step: "uploading",
        message: "Upload complete, starting processing...",
        progress: 0,
      };

      const newJob: TranscriptionJob = {
        fileId,
        filename,
        status: initialStatus,
      };

      setJobs((prev) => [newJob, ...prev]);

      // Poll for status updates
      const pollInterval = setInterval(async () => {
        try {
          const status = await getStatus(fileId);
          setJobs((prev) =>
            prev.map((job) => (job.fileId === fileId ? { ...job, status } : job))
          );

          if (status.step === "completed" || status.step === "error") {
            clearInterval(pollInterval);
          }
        } catch (err) {
          console.error("Error polling status:", err);
        }
      }, 500);
    } catch (err) {
      console.error("Upload error:", err);
      alert("Upload failed. Please try again.");
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Transcribe</h1>
        <p>Local audio and video transcription</p>
      </header>

      <main className="main">
        <Uploader onUpload={handleUpload} />

        <div className="jobs">
          {jobs.length === 0 ? (
            <div className="empty-state">
              <p>No transcriptions yet. Upload a file to get started.</p>
            </div>
          ) : (
            jobs.map((job) => <StatusDisplay key={job.fileId} job={job} />)
          )}
        </div>
      </main>
    </div>
  );
}
