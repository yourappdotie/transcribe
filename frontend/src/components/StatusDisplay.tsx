import { useState } from "react";
import { getDownloadUrl, type FileStatus } from "../api";
import SubtitleEditor from "./SubtitleEditor";

interface StatusDisplayProps {
  job: {
    fileId: string;
    filename: string;
    status: FileStatus;
  };
  originalFilename?: string;
}

function VideoPlayer({
  fileId,
  status,
}: {
  fileId: string;
  status: FileStatus;
}) {
  if (!status.output?.vtt && !status.output?.mp4) {
    return <p className="no-video">No video file available</p>;
  }

  // Use MP4 if available (converted from MOV), otherwise use original
  const videoFile = status.output.mp4 || status.output.srt?.replace(".srt", "");

  return (
    <div className="video-player-container">
      <video className="video-player" controls width="100%">
        <source src={getDownloadUrl(fileId, videoFile || "")} type="video/mp4" />
        {status.output.vtt && (
          <track
            kind="subtitles"
            src={getDownloadUrl(fileId, status.output.vtt)}
            srcLang="en"
            label="English"
            default
          />
        )}
        Your browser does not support the video tag or subtitles.
      </video>
    </div>
  );
}

const stepLabels: Record<FileStatus["step"], string> = {
  uploading: "Uploading",
  converting: "Converting",
  extracting: "Extracting audio",
  transcribing: "Transcribing",
  completed: "Completed",
  error: "Error",
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

export default function StatusDisplay({ job }: StatusDisplayProps) {
  const { fileId, filename, status } = job;
  const isComplete = status.step === "completed";
  const isError = status.step === "error";
  const [showEditor, setShowEditor] = useState(false);

  return (
    <div className={`job-card ${status.step}`}>
      <div className="job-header">
        <div className="job-title">
          <h3>{filename}</h3>
          <span className="step-badge">{stepLabels[status.step]}</span>
        </div>
      </div>

      <div className="job-content">
        <p className="status-message">{status.message}</p>

        {!isComplete && !isError && (
          <div className="progress-section">
            <div className="progress-container">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${status.progress}%` }}></div>
              </div>
              <span className="progress-percentage">{status.progress}%</span>
            </div>
            <div className="step-indicator">
              <span className={`step-dot ${status.step === "converting" ? "active" : status.step === "extracting" || status.step === "transcribing" ? "done" : ""}`}></span>
              <span className="step-label">Convert</span>
              <span className={`step-dot ${status.step === "extracting" ? "active" : status.step === "transcribing" ? "done" : ""}`}></span>
              <span className="step-label">Extract</span>
              <span className={`step-dot ${status.step === "transcribing" ? "active" : ""}`}></span>
              <span className="step-label">Transcribe</span>
            </div>
          </div>
        )}

        {isComplete && status.output && (
          <div className="results-section">
            {status.duration !== undefined && (
              <div className="completion-stats">
                <div className="stat-item">
                  <span className="stat-label">Processing time:</span>
                  <span className="stat-value">{formatDuration(status.duration)}</span>
                </div>
              </div>
            )}

            <div className="player-section">
              <h4>Preview</h4>
              <VideoPlayer fileId={fileId} status={status} />
            </div>

            {status.output.vtt && (
              <div className="editor-section">
                <button
                  className={`edit-toggle-btn ${showEditor ? "active" : ""}`}
                  onClick={() => setShowEditor(!showEditor)}
                >
                  {showEditor ? "✓ Close Editor" : "✏️ Edit Subtitles"}
                </button>
                {showEditor && (
                  <SubtitleEditor
                    fileId={fileId}
                    vttUrl={getDownloadUrl(fileId, status.output.vtt)}
                  />
                )}
              </div>
            )}

            <div className="downloads-section">
              <h4>Downloads</h4>
              <div className="downloads">
                {status.output.srt && (
                  <a href={getDownloadUrl(fileId, status.output.srt)} className="download-btn">
                    📄 {status.output.srt}
                  </a>
                )}
                {status.output.vtt && (
                  <a href={getDownloadUrl(fileId, status.output.vtt)} className="download-btn">
                    📄 {status.output.vtt}
                  </a>
                )}
                {status.output.mp4 && (
                  <a href={getDownloadUrl(fileId, status.output.mp4)} className="download-btn">
                    🎬 {status.output.mp4}
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {isError && (
          <div className="error-section">
            <p className="error-message">❌ {status.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
