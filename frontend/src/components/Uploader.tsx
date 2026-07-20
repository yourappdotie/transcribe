import { useRef, useState } from "react";

interface UploaderProps {
  onUpload: (file: File) => void;
}

export default function Uploader({ onUpload }: UploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleFileSelect = (files: FileList | null) => {
    if (files && files.length > 0) {
      onUpload(files[0]);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.currentTarget.files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  return (
    <div className="uploader-section">
      <div
        className={`upload-zone ${isDragging ? "dragging" : ""}`}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="upload-icon">📁</div>
        <h2>Select or drag audio/video file</h2>
        <p className="upload-hint">Supports MP4, MOV, WebM, MP3, WAV, and more</p>
        <input
          ref={inputRef}
          type="file"
          onChange={handleChange}
          accept="audio/*,video/*"
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
}
