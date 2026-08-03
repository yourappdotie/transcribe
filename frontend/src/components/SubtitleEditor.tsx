import { useState, useEffect, useRef } from "react";
import CommonEdits from "./CommonEdits";

interface SubtitleEntry {
  index: number;
  timecode: string;
  text: string;
}

interface SubtitleEditorProps {
  fileId: string;
  vttUrl?: string;
  vttContent?: string;
  onSaved?: () => void;
  isLive?: boolean;
  liveVtt?: string;
  onSeek?: (seconds: number) => void;
}

export default function SubtitleEditor({ fileId, vttUrl, vttContent, onSaved, isLive = false, liveVtt, onSeek }: SubtitleEditorProps) {
  const [entries, setEntries] = useState<SubtitleEntry[]>([]);
  const [history, setHistory] = useState<SubtitleEntry[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string>("");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [isLoading, setIsLoading] = useState(true);
  const [showCommonEdits, setShowCommonEdits] = useState(false);

  // Load VTT file or live transcription
  useEffect(() => {
    const loadVTT = async () => {
      try {
        let content: string;

        if (isLive && liveVtt) {
          content = liveVtt;
        } else if (isLive) {
          setIsLoading(false);
          return;
        } else if (vttContent) {
          // Use VTT content passed as prop (preferred to avoid CORS)
          content = vttContent;
        } else if (vttUrl) {
          // Fallback: load from URL
          const response = await fetch(vttUrl);
          if (!response.ok) throw new Error("Failed to load VTT");
          content = await response.text();
        } else {
          throw new Error("No VTT content or URL provided");
        }

        const parsed = parseVTT(content);
        setEntries(parsed);
        setHistory([parsed]);
        setHistoryIndex(0);
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load subtitles");
        setIsLoading(false);
      }
    };

    loadVTT();
  }, [liveVtt, vttUrl, vttContent, isLive, fileId]);

  const parseVTT = (content: string): SubtitleEntry[] => {
    const lines = content.split("\n");
    const result: SubtitleEntry[] = [];
    let i = 0;
    let index = 1;

    while (i < lines.length) {
      const line = lines[i].trim();

      if (line.includes("-->")) {
        const timecode = line;
        i++;
        const textLines: string[] = [];

        while (i < lines.length && lines[i].trim() !== "") {
          textLines.push(lines[i]);
          i++;
        }

        if (textLines.length > 0) {
          result.push({
            index,
            timecode,
            text: textLines.join("\n"),
          });
          index++;
        }
      }
      i++;
    }

    return result;
  };

  const entriesToVTT = (subs: SubtitleEntry[]): string => {
    const vttLines = ["WEBVTT", ""];
    for (const entry of subs) {
      vttLines.push(entry.timecode);
      vttLines.push(entry.text);
      vttLines.push("");
    }
    return vttLines.join("\n");
  };

  const handleTextChange = (index: number, newText: string) => {
    const newEntries = entries.map((entry) =>
      entry.index === index ? { ...entry, text: newText } : entry
    );
    setEntries(newEntries);

    // Add to history
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newEntries);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);

    // Auto-save
    setStatus("saving");
    setError("");

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`http://localhost:5000/api/update-subtitles/${fileId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vttContent: entriesToVTT(newEntries) }),
        });

        if (!response.ok) {
          throw new Error("Save failed");
        }

        setStatus("saved");
        setTimeout(() => setStatus("idle"), 2000);
        onSaved?.();
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Save failed");
      }
    }, 1000);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setEntries(history[newIndex]);
      setStatus("idle");
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setEntries(history[newIndex]);
      setStatus("idle");
    }
  };

  const timeToSeconds = (timeStr: string): number => {
    const parts = timeStr.replace(",", ".").split(":");
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  };

  const handleEntryClick = (timecode: string) => {
    if (onSeek) {
      const seconds = timeToSeconds(timecode);
      onSeek(seconds);
    }
  };

  if (isLoading) {
    return <div className="subtitle-editor loading">Loading subtitles...</div>;
  }

  if (entries.length === 0) {
    return <div className="subtitle-editor empty">No subtitles to edit</div>;
  }

  return (
    <div className="subtitle-editor">
      <div className="editor-toolbar">
        <div className="toolbar-buttons">
          <button
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            className="toolbar-btn"
            title="Undo (Ctrl+Z)"
          >
            ↶ Undo
          </button>
          <button
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            className="toolbar-btn"
            title="Redo (Ctrl+Y)"
          >
            ↷ Redo
          </button>
          <div className="toolbar-separator"></div>
          <button
            onClick={() => setShowCommonEdits(true)}
            className="toolbar-btn common-edits-btn"
            title="Common editing options"
          >
            ⚡ Common Edits
          </button>
        </div>
        <div className={`status-indicator ${status}`}>
          {status === "saving" && "Saving..."}
          {status === "saved" && "✓ Saved"}
          {status === "error" && "✗ Error"}
          {status === "idle" && ""}
        </div>
      </div>

      <CommonEdits isOpen={showCommonEdits} onClose={() => setShowCommonEdits(false)} />

      {error && <div className="editor-error">{error}</div>}

      <div className="subtitle-entries">
        {entries.map((entry) => (
          <div
            key={entry.index}
            className="subtitle-entry"
            onClick={() => handleEntryClick(entry.timecode)}
            style={{ cursor: onSeek ? "pointer" : "default" }}
          >
            <div className="entry-header">
              <span className="entry-number">#{entry.index}</span>
              <span className="entry-timecode">{entry.timecode}</span>
            </div>
            <textarea
              className="entry-text"
              value={entry.text}
              onChange={(e) => handleTextChange(entry.index, e.target.value)}
              placeholder="Enter subtitle text..."
            />
          </div>
        ))}
      </div>
    </div>
  );
}
