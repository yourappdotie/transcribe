import { useEffect, useState } from "react";

interface Upload {
  fileId: string;
  filename: string;
  status: string;
  progress: number;
  wavChunks: number;
  srtChunks: number;
  createdAt: string;
}

interface PreviousUploadsProps {
  onResume: (fileId: string, filename: string) => void;
}

export default function PreviousUploads({ onResume }: PreviousUploadsProps) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUploads = async () => {
      try {
        const response = await fetch("/api/uploads");
        if (!response.ok) throw new Error("Failed to load uploads");
        const data = await response.json();
        setUploads(data);
      } catch (err) {
        console.error("Error loading uploads:", err);
      } finally {
        setLoading(false);
      }
    };

    loadUploads();
  }, []);

  if (loading) {
    return <div className="previous-uploads">Loading previous uploads...</div>;
  }

  if (uploads.length === 0) {
    return null;
  }

  return (
    <div className="previous-uploads">
      <h4>Previous Uploads</h4>
      <div className="uploads-strip">
        {uploads.map((upload) => {
          const isComplete = upload.status === "completed";
          const progressPercent = isComplete
            ? 100
            : Math.round((upload.srtChunks / (upload.wavChunks || 1)) * 100);

          return (
            <div
              key={upload.fileId}
              className={`upload-card ${upload.status}`}
              onClick={() => onResume(upload.fileId, upload.filename)}
            >
              <div className="card-header">
                <span className="status-badge">{upload.status}</span>
              </div>
              <div className="card-body">
                <p className="filename">{upload.filename}</p>
                {!isComplete && upload.wavChunks > 0 && (
                  <p className="progress-text">
                    {upload.srtChunks}/{upload.wavChunks} chunks
                  </p>
                )}
                {!isComplete && (
                  <div className="small-progress-bar">
                    <div
                      className="small-progress-fill"
                      style={{ width: `${progressPercent}%` }}
                    ></div>
                  </div>
                )}
                <p className="date">
                  {new Date(upload.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
