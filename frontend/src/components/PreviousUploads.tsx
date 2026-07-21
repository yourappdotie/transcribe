import { useEffect, useState } from "react";

interface Upload {
  fileId: string;
  filename: string;
  status: string;
  progress: number;
  chunksCompleted: number;
  totalChunks: number;
  createdAt: string;
}

interface PreviousUploadsProps {
  onResume: (fileId: string, filename: string) => void;
}

export default function PreviousUploads({ onResume }: PreviousUploadsProps) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

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

  const handleHide = (fileId: string) => {
    setHiddenIds((prev) => new Set([...prev, fileId]));
  };

  const handleDelete = async (fileId: string) => {
    const confirmed = confirm("Are you sure you want to delete this upload folder and all its files?");
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/uploads/${fileId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setUploads((prev) => prev.filter((u) => u.fileId !== fileId));
        setHiddenIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });
      } else {
        alert("Failed to delete upload");
      }
    } catch (err) {
      console.error("Delete error:", err);
      alert("Failed to delete upload");
    }
  };

  if (loading) {
    return <div className="previous-uploads">Loading previous uploads...</div>;
  }

  if (uploads.length === 0) {
    return null;
  }

  const visibleUploads = uploads.filter((u) => !hiddenIds.has(u.fileId));

  return (
    <div className="previous-uploads">
      <h4>Previous Uploads</h4>
      <div className="uploads-strip">
        {visibleUploads.map((upload) => {
          const isComplete = upload.status === "completed";
          const progressPercent = isComplete
            ? 100
            : upload.totalChunks > 0
              ? Math.round((upload.chunksCompleted / upload.totalChunks) * 100)
              : 0;

          return (
            <div
              key={upload.fileId}
              className={`upload-card ${upload.status}`}
              onClick={() => onResume(upload.fileId, upload.filename)}
            >
              <div className="card-header">
                <span className="status-badge">{upload.status}</span>
                <div className="card-actions">
                  <button
                    className="action-btn hide-btn"
                    title="Hide this upload"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleHide(upload.fileId);
                    }}
                  >
                    ✕
                  </button>
                  <button
                    className="action-btn delete-btn"
                    title="Delete this upload"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(upload.fileId);
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
              <div className="card-body">
                <p className="filename">{upload.filename}</p>
                {!isComplete && (upload.totalChunks > 0 || upload.chunksCompleted > 0) && (
                  <p className="progress-text">
                    {upload.totalChunks > 0 ? `${upload.chunksCompleted}/${upload.totalChunks} chunks completed` : `${upload.chunksCompleted} chunks completed`}
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
