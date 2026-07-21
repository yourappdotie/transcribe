import { useState, useEffect, useRef } from "react";
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
  liveVtt?: string;
}

export default function App() {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const pollIntervalRef = useRef<NodeJS.Timeout>();

  // Single unified polling for all active jobs
  useEffect(() => {
    const activeJobs = jobs.filter(
      (job) => job.status.step !== "completed" && job.status.step !== "error"
    );

    if (activeJobs.length === 0) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      return;
    }

    const poll = async () => {
      for (const job of activeJobs) {
        try {
          // Fetch status
          const status = await getStatus(job.fileId);

          // Fetch live VTT if transcribing
          let liveVtt;
          if (status.step === "transcribing" || status.step === "converting" || status.step === "extracting") {
            const response = await fetch(`/api/transcription/${job.fileId}/live`);
            if (response.ok) {
              const data = await response.json();
              liveVtt = data.vtt;
            }
          }

          setJobs((prev) =>
            prev.map((j) =>
              j.fileId === job.fileId ? { ...j, status, liveVtt } : j
            )
          );
        } catch (err) {
          console.error(`Error polling job ${job.fileId}:`, err);
        }
      }
    };

    poll();
    pollIntervalRef.current = setInterval(poll, 5000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [jobs]);

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
      // Polling will start automatically via useEffect
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
              liveVtt={jobs[0].liveVtt}
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
