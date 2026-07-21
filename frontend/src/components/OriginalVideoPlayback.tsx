import { useRef, useEffect, useState } from "react";
import { getDownloadUrl } from "../api";

interface OriginalVideoPlaybackProps {
  fileId: string;
  filename: string;
  liveVtt?: string;
}

export default function OriginalVideoPlayback({
  fileId,
  filename,
  liveVtt,
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

  // Update subtitle track when liveVtt changes
  useEffect(() => {
    if (liveVtt && trackRef.current) {
      // Create blob URL for the VTT content
      const blob = new Blob([liveVtt], { type: "text/vtt" });
      const url = URL.createObjectURL(blob);

      // Revoke old URL
      if (vttUrl) {
        URL.revokeObjectURL(vttUrl);
      }

      trackRef.current.src = url;
      setVttUrl(url);
    }

    return () => {
      if (vttUrl) {
        URL.revokeObjectURL(vttUrl);
      }
    };
  }, [liveVtt, vttUrl]);

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
