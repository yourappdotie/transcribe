
interface CommonEditsProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CommonEdits({ isOpen, onClose }: CommonEditsProps) {
  const handleActionClick = (action: string) => {
    alert(`🔄 Coming Soon\n\n${action} functionality will be available soon. This feature is currently in development.`);
  };

  if (!isOpen) return null;

  return (
    <div className="common-edits-overlay" onClick={onClose}>
      <div className="common-edits-menu" onClick={(e) => e.stopPropagation()}>
        <div className="menu-header">
          <h3>Common Edits</h3>
          <button className="menu-close" onClick={onClose} aria-label="Close menu">
            ✕
          </button>
        </div>

        <div className="menu-actions">
          <button
            className="action-btn placeholder-btn"
            onClick={() => handleActionClick("Placeholder 1")}
          >
            <span className="action-icon">🎙️</span>
            <span className="action-text">Placeholder 1</span>
          </button>

          <button
            className="action-btn placeholder-btn"
            onClick={() => handleActionClick("Placeholder 2")}
          >
            <span className="action-icon">✏️</span>
            <span className="action-text">Placeholder 2</span>
          </button>

          <button
            className="action-btn placeholder-btn"
            onClick={() => handleActionClick("Placeholder 3")}
          >
            <span className="action-icon">📋</span>
            <span className="action-text">Placeholder 3</span>
          </button>
        </div>
      </div>
    </div>
  );
}
