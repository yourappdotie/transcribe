import { useState, useEffect } from "react";
import { uploadFile, getStatus } from "./api";
import type { FileStatus } from "./api";
import Uploader from "./components/Uploader";
import StatusDisplay from "./components/StatusDisplay";
import PreviousUploads from "./components/PreviousUploads";

interface TranscriptionJob {
  fileId: string;
  filename: string;
  originalFilename: string;
  status: FileStatus;
  liveVtt?: string;
  eventSource?: EventSource;
}

export default function App() {
  const [jobs, setJobs] = useState<TranscriptionJob[]>(() => {
    try {
      const stored = localStorage.getItem("transcribe_jobs");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Persist jobs to localStorage
  useEffect(() => {
    const jobsWithoutEventSource = jobs.map(({ eventSource, ...job }) => job);
    localStorage.setItem("transcribe_jobs", JSON.stringify(jobsWithoutEventSource));
  }, [jobs]);

  // Set up SSE for active jobs
  useEffect(() => {
    const activeJobs = jobs.filter(
      (job) => job.status.step !== "completed" && job.status.step !== "error" && !job.eventSource
    );

    for (const job of activeJobs) {
      const eventSource = new EventSource(`/api/transcription/${job.fileId}/stream`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setJobs((prev) =>
            prev.map((j) =>
              j.fileId === job.fileId
                ? { ...j, status: data.status, liveVtt: data.liveVtt || j.liveVtt, eventSource }
                : j
            )
          );
        } catch (err) {
          console.error(`Error parsing SSE data for ${job.fileId}:`, err);
        }
      };

      eventSource.onerror = () => {
        console.error(`SSE error for ${job.fileId}`);
        eventSource.close();
        setJobs((prev) =>
          prev.map((j) => (j.fileId === job.fileId ? { ...j, eventSource: undefined } : j))
        );
      };

      setJobs((prev) =>
        prev.map((j) => (j.fileId === job.fileId ? { ...j, eventSource } : j))
      );
    }

    return () => {
      jobs.forEach((job) => {
        if (job.eventSource) {
          job.eventSource.close();
        }
      });
    };
  }, [jobs.filter((j) => j.status.step !== "completed" && j.status.step !== "error").map((j) => j.fileId).join()]);

  const isProcessing = jobs.some(
    (job) => job.status.step !== "completed" && job.status.step !== "error"
  );

  const handleResume = async (fileId: string, filename: string) => {
    try {
      // Get current status without triggering resume (to avoid regenerating VTT from chunks)
      const status = await getStatus(fileId);

      const newJob: TranscriptionJob = {
        fileId,
        filename,
        originalFilename: filename,
        status,
      };

      setJobs((prev) => [newJob, ...prev]);
      // SSE will start automatically via useEffect if transcription is in progress
    } catch (err) {
      console.error("Resume error:", err);
      alert("Failed to load job. Please try again.");
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
      // SSE will start automatically via useEffect
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
        {jobs.length === 0 ? (
          <>
            <Uploader onUpload={handleUpload} />
            <PreviousUploads onResume={handleResume} />
          </>
        ) : (
          <div className="jobs">
            {jobs.map((job) => <StatusDisplay key={job.fileId} job={job} />)}
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Made by Ger O'Connell • YourApp.ie</p>
      </footer>
    </div>
  );
}
