import { getDownloadUrl, type FileStatus } from "../api";

interface StatusDisplayProps {
  job: {
    fileId: string;
    filename: string;
    status: FileStatus;
  };
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
