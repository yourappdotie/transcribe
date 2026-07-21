import { useRef, useEffect, useState } from "react";
import { getDownloadUrl } from "../api";

interface OriginalVideoPlaybackProps {
  fileId: string;
  filename: string;
}

export default function OriginalVideoPlayback({
  fileId,
  filename,
}: OriginalVideoPlaybackProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const [vttUrl, setVttUrl] = useState<string>("");

  const videoUrl = getDownloadUrl(fileId, filename);
  const ext = filename.toLowerCase().split(".").pop();

  // Determine video type
  let mimeType = "video/mp4";
  if (ext === "mov") mimeType = "video/quicktime";
  if (ext === "webm") mimeType = "video/webm";

  // Poll for live subtitles and update track
  useEffect(() => {
    const updateSubtitles = async () => {
      try {
        const response = await fetch(`/api/transcription/${fileId}/live`);
        if (!response.ok) return;

        const data = await response.json();
        if (data.vtt) {
          // Create blob URL for the VTT content
          const blob = new Blob([data.vtt], { type: "text/vtt" });
          const url = URL.createObjectURL(blob);

          // Update track source
          if (trackRef.current) {
            // Revoke old URL
            if (vttUrl) {
              URL.revokeObjectURL(vttUrl);
            }
            trackRef.current.src = url;
            setVttUrl(url);
          }
        }
      } catch (err) {
        console.error("Error updating subtitles:", err);
      }
    };

    updateSubtitles();

    // Poll every 5 seconds
    const interval = setInterval(updateSubtitles, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [fileId, vttUrl]);

  return (
    <div className="original-video-section">
      <h3>Original Video</h3>
      <p className="video-hint">Watch and review while transcription runs</p>
      <div className="video-container">
        <video
          ref={videoRef}
          className="original-video"
          controls
          autoPlay={false}
          controlsList="nodownload"
        >
          <source src={videoUrl} type={mimeType} />
          <track
            ref={trackRef}
            kind="subtitles"
            srcLang="en"
            label="English"
            default
          />
          Your browser does not support video playback.
        </video>
      </div>
      <p className="filename">{filename}</p>
    </div>
  );
}
