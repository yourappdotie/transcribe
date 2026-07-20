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

        {status.progress > 0 && !isComplete && !isError && (
          <div className="progress-section">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${status.progress}%` }}></div>
            </div>
            <p className="progress-text">{status.progress}%</p>
          </div>
        )}

        {isComplete && status.output && (
          <div className="results-section">
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
