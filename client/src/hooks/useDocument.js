/**
 * useDocument Hook
 *
 * Manages the collaborative editing session. Key design:
 * - Operations are queued and sent ONE AT A TIME
 * - baseVersion is set at send time (after previous ack), not at creation time
 * - This prevents the server from incorrectly transforming ops against local state
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from '../services/socket';

const useDocument = (documentId) => {
  const [document, setDocument] = useState(null);
  const [content, setContent] = useState('');
  const [version, setVersion] = useState(0);
  const [role, setRole] = useState(null);
  const [activeUsers, setActiveUsers] = useState([]);
  const [cursors, setCursors] = useState({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  const socketRef = useRef(null);
  const versionRef = useRef(0);
  const contentRef = useRef('');

  // Op queue: ops waiting to be sent. Sent one at a time.
  const sendQueueRef = useRef([]);
  // The op currently in flight (sent, waiting for ack)
  const inflightOpRef = useRef(null);

  // Apply a single operation to a content string
  const applyOp = (text, operation) => {
    if (operation.type === 'insert') {
      const pos = Math.min(Math.max(0, operation.position), text.length);
      return text.slice(0, pos) + operation.text + text.slice(pos);
    }
    if (operation.type === 'delete') {
      const pos = Math.min(Math.max(0, operation.position), text.length);
      const end = Math.min(pos + operation.length, text.length);
      return text.slice(0, pos) + text.slice(end);
    }
    return text;
  };

  // Send the next op from the queue if nothing is in flight
  const trySendNext = useCallback(() => {
    if (inflightOpRef.current) return;
    if (sendQueueRef.current.length === 0) return;
    if (!socketRef.current) return;

    const op = sendQueueRef.current.shift();
    // Set baseVersion NOW (after previous ack), not when it was created
    op.baseVersion = versionRef.current;
    inflightOpRef.current = op;
    socketRef.current.emit('operation', { documentId, operation: op });
  }, [documentId]);

  // Keep refs in sync
  useEffect(() => { versionRef.current = version; }, [version]);
  useEffect(() => { contentRef.current = content; }, [content]);

  /**
   * Queue an insert and optimistically apply it locally
   */
  const sendInsert = useCallback((position, text) => {
    if (!socketRef.current || role === 'viewer' || role === 'commenter') return;

    const operation = { type: 'insert', position, text };
    sendQueueRef.current.push(operation);

    // Optimistically apply locally
    setContent((prev) => {
      const pos = Math.min(Math.max(0, position), prev.length);
      const newContent = prev.slice(0, pos) + text + prev.slice(pos);
      contentRef.current = newContent;
      return newContent;
    });

    trySendNext();
  }, [documentId, role, trySendNext]);

  /**
   * Queue a delete and optimistically apply it locally
   */
  const sendDelete = useCallback((position, length) => {
    if (!socketRef.current || role === 'viewer' || role === 'commenter') return;

    const operation = { type: 'delete', position, length };
    sendQueueRef.current.push(operation);

    // Optimistically apply locally
    setContent((prev) => {
      const pos = Math.min(Math.max(0, position), prev.length);
      const end = Math.min(pos + length, prev.length);
      const newContent = prev.slice(0, pos) + prev.slice(end);
      contentRef.current = newContent;
      return newContent;
    });

    trySendNext();
  }, [documentId, role, trySendNext]);

  /**
   * Send cursor position to other collaborators
   */
  const sendCursorMove = useCallback((position, selectionRange) => {
    if (!socketRef.current) return;
    socketRef.current.emit('cursor_move', {
      documentId,
      cursor: { position, selectionRange },
    });
  }, [documentId]);

  /**
   * Connect to socket and set up event listeners
   */
  useEffect(() => {
    if (!documentId) return;

    const socket = getSocket();
    if (!socket) {
      setError('Not authenticated');
      return;
    }

    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      socket.emit('join_document', { documentId });
    };

    const onDisconnect = () => {
      setConnected(false);
    };

    // Initial document state from server
    const onDocumentState = (data) => {
      setDocument(data.document);
      const initialContent = data.document.content != null ? String(data.document.content) : '';
      setContent(initialContent);
      contentRef.current = initialContent;
      setVersion(data.document.version);
      versionRef.current = data.document.version;
      // Clear any queued/inflight ops from a previous session
      sendQueueRef.current = [];
      inflightOpRef.current = null;
      setRole(data.role);
      setActiveUsers(data.activeUsers);
      setConnected(true);
    };

    // Server confirmed our operation — send next queued op
    const onOperationAck = (data) => {
      setVersion(data.version);
      versionRef.current = data.version;
      inflightOpRef.current = null;
      // Now that we have the new version, send the next queued op
      if (sendQueueRef.current.length > 0 && socketRef.current) {
        const op = sendQueueRef.current.shift();
        op.baseVersion = versionRef.current;
        inflightOpRef.current = op;
        socketRef.current.emit('operation', { documentId, operation: op });
      }
    };

    // Remote operation from another user
    const onRemoteOperation = (data) => {
      const { operation, version: newVersion } = data;

      setContent((prev) => {
        const newContent = applyOp(prev, operation);
        contentRef.current = newContent;
        return newContent;
      });

      setVersion(newVersion);
      versionRef.current = newVersion;
    };

    // Presence events
    const onUserJoined = (userData) => {
      setActiveUsers((prev) => {
        if (prev.find((u) => u.userId === userData.userId)) return prev;
        return [...prev, userData];
      });
    };

    const onUserLeft = ({ userId }) => {
      setActiveUsers((prev) => prev.filter((u) => u.userId !== userId));
      setCursors((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    };

    const onCursorMoved = ({ userId, username, cursor }) => {
      setCursors((prev) => ({
        ...prev,
        [userId]: { username, ...cursor },
      }));
    };

    const onErrorMessage = ({ message }) => {
      setError(message);
    };

    // Register all listeners
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('document_state', onDocumentState);
    socket.on('operation_ack', onOperationAck);
    socket.on('remote_operation', onRemoteOperation);
    socket.on('user_joined', onUserJoined);
    socket.on('user_left', onUserLeft);
    socket.on('cursor_moved', onCursorMoved);
    socket.on('error_message', onErrorMessage);

    if (socket.connected) {
      socket.emit('join_document', { documentId });
      setConnected(true);
    }

    return () => {
      socket.emit('leave_document', { documentId });
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('document_state', onDocumentState);
      socket.off('operation_ack', onOperationAck);
      socket.off('remote_operation', onRemoteOperation);
      socket.off('user_joined', onUserJoined);
      socket.off('user_left', onUserLeft);
      socket.off('cursor_moved', onCursorMoved);
      socket.off('error_message', onErrorMessage);
    };
  }, [documentId]);

  return {
    document,
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
  };
};

export default useDocument;
