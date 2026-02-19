import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import useDocument from '../hooks/useDocument';
import ShareModal from '../components/ShareModal';
import HistoryPanel from '../components/HistoryPanel';
import { updateDocument } from '../services/api';
import './EditorPage.css';

// Distinct colors for collaborator cursors
const CURSOR_COLORS = [
  '#ff6b6b', '#48dbfb', '#feca57', '#ff9ff3', '#54a0ff',
  '#5f27cd', '#01a3a4', '#f368e0', '#ee5a24', '#0abde3',
];

const getCursorColor = (userId) => {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
};

const CARET_STYLE_PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'wordSpacing',
  'textIndent',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
  'whiteSpace',
  'tabSize',
];

const getCaretCoordinates = (textarea, position) => {
  if (!textarea) return null;

  const mirror = document.createElement('div');
  const marker = document.createElement('span');
  const style = window.getComputedStyle(textarea);

  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.left = '-9999px';
  mirror.style.top = '0';
  mirror.style.overflow = 'hidden';
  mirror.style.wordWrap = 'break-word';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.width = `${textarea.clientWidth}px`;

  CARET_STYLE_PROPS.forEach((prop) => {
    mirror.style[prop] = style[prop];
  });

  const text = textarea.value || '';
  const safePos = Math.min(Math.max(0, position), text.length);
  mirror.textContent = text.slice(0, safePos);
  marker.textContent = text.slice(safePos) || ' ';
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  const top = marker.offsetTop - textarea.scrollTop;
  const left = marker.offsetLeft - textarea.scrollLeft;
  document.body.removeChild(mirror);

  return { top, left };
};

const EditorPage = () => {
  const { id: documentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    document: doc,
    content,
    version,
    role,
    activeUsers,
    cursors,
    connected,
    error,
    sendInsert,
    sendDelete,
    sendCursorMove,
  } = useDocument(documentId);

  const [title, setTitle] = useState('');
  const [showShare, setShowShare] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [remoteCursorMarkers, setRemoteCursorMarkers] = useState({});

  const editorRef = useRef(null);
  const lastContentRef = useRef('');

  const updateRemoteCursorMarkers = useCallback(() => {
    const textarea = editorRef.current;
    if (!textarea) {
      setRemoteCursorMarkers({});
      return;
    }

    const nextMarkers = {};
    Object.entries(cursors).forEach(([userId, cursorData]) => {
      if (userId === user?.id) return;
      if (typeof cursorData?.position !== 'number') return;
      const coords = getCaretCoordinates(textarea, cursorData.position);
      if (!coords) return;
      nextMarkers[userId] = { ...cursorData, ...coords };
    });

    setRemoteCursorMarkers(nextMarkers);
  }, [cursors, user?.id]);

  // Initialize title when document loads
  useEffect(() => {
    if (doc?.title && !titleEditing) {
      setTitle(doc.title);
    }
  }, [doc?.title, titleEditing]);

  // Keep editor in sync with content from hook only update if it differs
  // to avoid cursor jumping on our own edits
  useEffect(() => {
    if (editorRef.current && content !== undefined) {
      const el = editorRef.current;
      if (el.value !== content) {
        // Save cursor position
        const start = el.selectionStart;
        const end = el.selectionEnd;

        // Calculate cursor offset from remote operations
        const lenDiff = content.length - (lastContentRef.current || '').length;

        el.value = content;

        // Try to maintain cursor position intelligently
        const newStart = Math.min(start + (lenDiff > 0 ? 0 : 0), content.length);
        const newEnd = Math.min(end + (lenDiff > 0 ? 0 : 0), content.length);
        el.setSelectionRange(newStart, newEnd);
      }
      lastContentRef.current = content;
    }
  }, [content]);

  useEffect(() => {
    updateRemoteCursorMarkers();
  }, [content, cursors, updateRemoteCursorMarkers]);

  useEffect(() => {
    const textarea = editorRef.current;
    if (!textarea) return undefined;

    const recalc = () => updateRemoteCursorMarkers();
    textarea.addEventListener('scroll', recalc);
    window.addEventListener('resize', recalc);

    return () => {
      textarea.removeEventListener('scroll', recalc);
      window.removeEventListener('resize', recalc);
    };
  }, [doc, updateRemoteCursorMarkers]);

  /**
   * Handle text input in the editor.
   * We compute the diff between old and new content to generate
   * insert/delete operations rather than sending full content.
   */
  const handleInput = useCallback((e) => {
    const newValue = e.target.value;
    const oldValue = lastContentRef.current || '';

    if (newValue === oldValue) return;

    const el = editorRef.current;
    const cursorPos = el.selectionStart;

    // Determine what changed: compare from both ends to find the edit region
    let commonPrefixLen = 0;
    const minLen = Math.min(oldValue.length, newValue.length);
    while (commonPrefixLen < minLen && oldValue[commonPrefixLen] === newValue[commonPrefixLen]) {
      commonPrefixLen++;
    }

    let commonSuffixLen = 0;
    while (
      commonSuffixLen < (minLen - commonPrefixLen) &&
      oldValue[oldValue.length - 1 - commonSuffixLen] === newValue[newValue.length - 1 - commonSuffixLen]
    ) {
      commonSuffixLen++;
    }

    const deletedLen = oldValue.length - commonPrefixLen - commonSuffixLen;
    const insertedText = newValue.slice(commonPrefixLen, newValue.length - commonSuffixLen);

    // Send delete operation if text was removed
    if (deletedLen > 0) {
      sendDelete(commonPrefixLen, deletedLen);
    }

    // Send insert operation if text was added
    if (insertedText.length > 0) {
      sendInsert(commonPrefixLen, insertedText);
    }

    // Update local ref (actual state update happens via optimistic apply in the hook)
    lastContentRef.current = newValue;

    // Broadcast cursor position
    sendCursorMove(cursorPos, null);
  }, [sendInsert, sendDelete, sendCursorMove]);

  /**
   * Track cursor/selection changes for presence.
   */
  const handleSelect = useCallback(() => {
    if (!editorRef.current) return;
    const el = editorRef.current;
    sendCursorMove(el.selectionStart, {
      start: el.selectionStart,
      end: el.selectionEnd,
    });
  }, [sendCursorMove]);

  /**
   * Save title on blur.
   */
  const handleTitleBlur = async () => {
    const newTitle = title.trim();
    setTitleEditing(false);
    if (title !== doc?.title && newTitle) {
      try {
        await updateDocument(documentId, { title: newTitle });
        setTitle(newTitle);
      } catch (err) {
        console.error('Failed to update title:', err);
      }
    }
  };

  const canEdit = role === 'owner' || role === 'editor';

  if (error) {
    return (
      <div className="editor-error">
        <h2>Access Error</h2>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="editor-loading">
        <div className="loading-spinner" />
        <p>Loading document...</p>
      </div>
    );
  }

  return (
    <div className="editor-page">
      <header className="editor-header">
        <div className="editor-header-left">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/dashboard')}>
            &#8592; Back
          </button>
          <input
            className="title-input"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setTitleEditing(true); }}
            onBlur={handleTitleBlur}
            disabled={!canEdit}
            placeholder="Document title"
          />
        </div>

        <div className="editor-header-center">
          <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot" />
            {connected ? 'Connected' : 'Reconnecting...'}
          </div>

          <span className="version-badge">v{version}</span>
        </div>

        <div className="editor-header-right">
          <div className="active-users">
            {activeUsers.map((u) => (
              <div
                key={u.userId}
                className="user-avatar"
                style={{ backgroundColor: getCursorColor(u.userId) }}
                title={`${u.username} (${u.role})`}
              >
                {u.username[0].toUpperCase()}
              </div>
            ))}
          </div>

          {role === 'owner' && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowHistory(true)}>
                History
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setShowShare(true)}>
                Share
              </button>
            </>
          )}
        </div>
      </header>

      {!canEdit && (
        <div className="readonly-banner">
          You have <strong>{role}</strong> access - this document is read-only for you.
        </div>
      )}

      <div className="editor-container">
        <div className="editor-wrapper">
          <div className="cursors-layer">
            {Object.entries(remoteCursorMarkers).map(([userId, cursorData]) => {
              const color = getCursorColor(userId);

              return (
                <div
                  key={userId}
                  className="remote-cursor"
                  style={{ transform: `translate(${cursorData.left}px, ${cursorData.top}px)` }}
                >
                  <div className="remote-cursor-caret" style={{ backgroundColor: color }} />
                  <div className="remote-cursor-name" style={{ backgroundColor: color }}>
                    {cursorData.username}
                  </div>
                </div>
              );
            })}
          </div>

          <textarea
            ref={editorRef}
            className="editor-textarea"
            value={content ?? ''}
            onChange={handleInput}
            onSelect={handleSelect}
            readOnly={!canEdit}
            placeholder={canEdit ? 'Start typing...' : 'Read-only document'}
            spellCheck={false}
          />
        </div>
      </div>

      {showShare && (
        <ShareModal documentId={documentId} onClose={() => setShowShare(false)} />
      )}
      {showHistory && (
        <HistoryPanel documentId={documentId} onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
};

export default EditorPage;
