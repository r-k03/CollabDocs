import React, { useState, useEffect } from 'react';
import { getDocumentHistory, restoreDocument } from '../services/api';
import './Modal.css';

const HistoryPanel = ({ documentId, onClose }) => {
  const [history, setHistory] = useState([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await getDocumentHistory(documentId);
        setHistory(res.data.history.reverse()); // Most recent first
        setCurrentVersion(res.data.currentVersion);
      } catch (err) {
        console.error('Failed to load history:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [documentId]);

  const handleRestore = async (version) => {
    if (!window.confirm(`Restore to version ${version}? This creates a new version.`)) return;

    setRestoring(version);
    try {
      await restoreDocument(documentId, version);
      onClose();
      window.location.reload(); // Reload to get new content via socket
    } catch (err) {
      console.error('Failed to restore:', err);
    } finally {
      setRestoring(null);
    }
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Version History</h2>
          <button className="modal-close" onClick={onClose}>&#10005;</button>
        </div>

        <div className="history-container">
          {loading ? (
            <div className="history-loading">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="history-empty">No version history yet. Edits will create snapshots.</div>
          ) : (
            <div className="history-layout">
              <div className="history-list">
                <div className="history-current">
                  <span className="history-version">v{currentVersion}</span>
                  <span className="history-label">Current</span>
                </div>
                {history.map((entry) => (
                  <div
                    key={entry.version}
                    className={`history-item ${selectedSnapshot?.version === entry.version ? 'selected' : ''}`}
                    onClick={() => setSelectedSnapshot(entry)}
                  >
                    <div className="history-item-header">
                      <span className="history-version">v{entry.version}</span>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={(e) => { e.stopPropagation(); handleRestore(entry.version); }}
                        disabled={restoring === entry.version}
                      >
                        {restoring === entry.version ? '...' : 'Restore'}
                      </button>
                    </div>
                    <div className="history-item-meta">
                      <span>{entry.editedBy?.username || 'Unknown'}</span>
                      <span>{formatDate(entry.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {selectedSnapshot && (
                <div className="history-preview">
                  <h3>Version {selectedSnapshot.version} Preview</h3>
                  <pre className="history-preview-content">
                    {selectedSnapshot.contentSnapshot || '(empty)'}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HistoryPanel;
