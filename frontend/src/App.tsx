import { useState } from "react";
import { uploadFile, getStatus, type FileStatus } from "./api";
import Uploader from "./components/Uploader";
import StatusDisplay from "./components/StatusDisplay";
import OriginalVideoPlayback from "./components/OriginalVideoPlayback";
import PreviousUploads from "./components/PreviousUploads";

interface TranscriptionJob {
  fileId: string;
  filename: string;
  originalFilename: string;
  status: FileStatus;
}

export default function App() {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);

  const isProcessing = jobs.some(
    (job) => job.status.step !== "completed" && job.status.step !== "error"
  );

  const handleResume = async (fileId: string, filename: string) => {
    try {
      const status = await getStatus(fileId);

      const newJob: TranscriptionJob = {
        fileId,
        filename,
        originalFilename: filename,
        status,
      };

      setJobs((prev) => [newJob, ...prev]);

      // Poll for status updates
      if (status.step !== "completed" && status.step !== "error") {
        const pollInterval = setInterval(async () => {
          try {
            const updatedStatus = await getStatus(fileId);
            setJobs((prev) =>
              prev.map((job) =>
                job.fileId === fileId ? { ...job, status: updatedStatus } : job
              )
            );

            if (
              updatedStatus.step === "completed" ||
              updatedStatus.step === "error"
            ) {
              clearInterval(pollInterval);
            }
          } catch (err) {
            console.error("Error polling status:", err);
          }
        }, 5000);
      }
    } catch (err) {
      console.error("Resume error:", err);
      alert("Failed to resume job. Please try again.");
    }
  };

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
        originalFilename: filename,
        status: initialStatus,
      };

      setJobs((prev) => [newJob, ...prev]);

      // Poll for status updates every 5 seconds
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
      }, 5000);
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
        {!isProcessing ? (
          <>
            <Uploader onUpload={handleUpload} />
            <PreviousUploads onResume={handleResume} />
          </>
        ) : (
          jobs.length > 0 && (
            <OriginalVideoPlayback
              fileId={jobs[0].fileId}
              filename={jobs[0].originalFilename}
            />
          )
        )}

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

      <footer className="footer">
        <p>Made by Ger O'Connell • YourApp.ie</p>
      </footer>
    </div>
  );
}
