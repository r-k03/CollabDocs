import React, { useState, useEffect } from 'react';
import { shareDocument, getDocument } from '../services/api';
import './Modal.css';

const ShareModal = ({ documentId, onClose }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [sharedWith, setSharedWith] = useState([]);

  useEffect(() => {
    const fetchShared = async () => {
      try {
        const res = await getDocument(documentId);
        setSharedWith(res.data.document.sharedWith || []);
      } catch (err) {
        console.error('Failed to load share info:', err);
      }
    };
    fetchShared();
  }, [documentId]);

  const handleShare = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const res = await shareDocument(documentId, { email, role });
      setSharedWith(res.data.document.sharedWith || []);
      setSuccess(`Shared with ${email} as ${role}`);
      setEmail('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to share document.');
    } finally {
      setLoading(false);
    }
  };

  const roleLabels = {
    editor: 'Can edit',
    commenter: 'Can comment',
    viewer: 'Can view',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Share Document</h2>
          <button className="modal-close" onClick={onClose}>&#10005;</button>
        </div>

        <form className="share-form" onSubmit={handleShare}>
          {error && <div className="auth-error">{error}</div>}
          {success && <div className="share-success">{success}</div>}

          <div className="share-inputs">
            <input
              type="email"
              className="input"
              placeholder="Enter email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <select
              className="input share-role-select"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="viewer">Viewer</option>
              <option value="commenter">Commenter</option>
              <option value="editor">Editor</option>
            </select>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? '...' : 'Share'}
            </button>
          </div>
        </form>

        {sharedWith.length > 0 && (
          <div className="shared-list">
            <h3>People with access</h3>
            {sharedWith.map((entry, idx) => {
              const u = entry.userId;
              return (
                <div key={idx} className="shared-user">
                  <div className="shared-user-info">
                    <span className="shared-user-name">{u?.username || 'Unknown'}</span>
                    <span className="shared-user-email">{u?.email || ''}</span>
                  </div>
                  <span className={`badge badge-${entry.role === 'editor' ? 'success' : entry.role === 'commenter' ? 'warning' : 'primary'}`}>
                    {roleLabels[entry.role] || entry.role}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ShareModal;
