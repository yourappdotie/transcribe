import { getDownloadUrl } from "../api";

interface OriginalVideoPlaybackProps {
  fileId: string;
  filename: string;
}

export default function OriginalVideoPlayback({
  fileId,
  filename,
}: OriginalVideoPlaybackProps) {
  const videoUrl = getDownloadUrl(fileId, filename);
  const ext = filename.toLowerCase().split(".").pop();

  // Determine video type
  let mimeType = "video/mp4";
  if (ext === "mov") mimeType = "video/quicktime";
  if (ext === "webm") mimeType = "video/webm";

  return (
    <div className="original-video-section">
      <h3>Original Video</h3>
      <p className="video-hint">Watch and review while transcription runs</p>
      <div className="video-container">
        <video
          className="original-video"
          controls
          autoPlay={false}
          controlsList="nodownload"
        >
          <source src={videoUrl} type={mimeType} />
          Your browser does not support video playback.
        </video>
      </div>
      <p className="filename">{filename}</p>
    </div>
  );
}
