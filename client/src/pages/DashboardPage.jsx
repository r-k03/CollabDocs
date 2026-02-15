import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDocuments, createDocument, deleteDocument } from '../services/api';
import './DashboardPage.css';

const DashboardPage = () => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await getDocuments();
      setDocuments(res.data.documents);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await createDocument({ title: 'Untitled Document' });
      navigate(`/document/${res.data.document._id}`);
    } catch (err) {
      console.error('Failed to create document:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e, docId) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this document?')) return;

    try {
      await deleteDocument(docId);
      setDocuments((prev) => prev.filter((d) => d._id !== docId));
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  const getUserRole = (doc) => {
    if (doc.owner?._id === user?.id || doc.owner === user?.id) return 'owner';
    const share = doc.sharedWith?.find(
      (s) => (s.userId?._id || s.userId) === user?.id
    );
    return share?.role || 'unknown';
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  const roleColors = {
    owner: 'badge-primary',
    editor: 'badge-success',
    commenter: 'badge-warning',
    viewer: 'badge-danger',
  };

  return (
    <div className="dashboard-page">
      <nav className="dashboard-nav">
        <div className="container nav-inner">
          <div className="nav-brand">
            <span className="logo-icon">C</span>
            <span className="logo-text">CollabDocs</span>
          </div>
          <div className="nav-right">
            <span className="nav-user">{user?.username}</span>
            <button className="btn btn-secondary btn-sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <main className="container dashboard-content">
        <div className="dashboard-header">
          <div>
            <h1>Your Documents</h1>
            <p className="dashboard-subtitle">{documents.length} document{documents.length !== 1 ? 's' : ''}</p>
          </div>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : '+ New Document'}
          </button>
        </div>

        {loading ? (
          <div className="dashboard-loading">Loading documents...</div>
        ) : documents.length === 0 ? (
          <div className="dashboard-empty">
            <div className="empty-icon">&#128196;</div>
            <h2>No documents yet</h2>
            <p>Create your first document to start collaborating</p>
            <button className="btn btn-primary" onClick={handleCreate}>
              Create Document
            </button>
          </div>
        ) : (
          <div className="documents-grid">
            {documents.map((doc) => {
              const docRole = getUserRole(doc);
              return (
                <div
                  key={doc._id}
                  className="document-card"
                  onClick={() => navigate(`/document/${doc._id}`)}
                >
                  <div className="card-top">
                    <div className="card-icon">&#128196;</div>
                    {docRole === 'owner' && (
                      <button
                        className="card-delete"
                        onClick={(e) => handleDelete(e, doc._id)}
                        title="Delete document"
                      >
                        &#10005;
                      </button>
                    )}
                  </div>
                  <h3 className="card-title">{doc.title}</h3>
                  <div className="card-meta">
                    <span className={`badge ${roleColors[docRole] || 'badge-primary'}`}>
                      {docRole}
                    </span>
                    <span className="card-date">{formatDate(doc.updatedAt)}</span>
                  </div>
                  {doc.owner?.username && docRole !== 'owner' && (
                    <div className="card-owner">by {doc.owner.username}</div>
                  )}
                  <div className="card-version">v{doc.version}</div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default DashboardPage;
