/**
 * Permission checking stuff
 * 
 * All the permission logic is here so I don't have to duplicate it everywhere.
 * Both HTTP routes and websocket handlers use this. Learned the hard way that
 * if you only check permissions in routes but not sockets, people can bypass
 * it by using websockets directly.
 * 
 * Roles: owner > editor > commenter > viewer
 */
const Document = require('../models/Document');
const logger = require('../utils/logger');

const ROLES = {
  OWNER: 'owner',
  EDITOR: 'editor',
  COMMENTER: 'commenter',
  VIEWER: 'viewer',
};

// Who can edit
const EDIT_ROLES = new Set([ROLES.OWNER, ROLES.EDITOR]);

// Who can read (basically everyone who has access)
const READ_ROLES = new Set([ROLES.OWNER, ROLES.EDITOR, ROLES.COMMENTER, ROLES.VIEWER]);

/**
 * Figure out what role a user has for a document
 * Returns null if they don't have access
 */
const getUserRole = (document, userId) => {
  const ownerId = document.owner._id
    ? document.owner._id.toString()
    : document.owner.toString();

  if (ownerId === userId) {
    return ROLES.OWNER;
  }

  const shareEntry = document.sharedWith.find(
    (entry) => entry.userId.toString() === userId
  );

  return shareEntry ? shareEntry.role : null;
};

/**
 * Can they read it?
 */
const canRead = (document, userId) => {
  const role = getUserRole(document, userId);
  return role !== null && READ_ROLES.has(role);
};

/**
 * Can they edit it?
 */
const canEdit = (document, userId) => {
  const role = getUserRole(document, userId);
  return role !== null && EDIT_ROLES.has(role);
};

/**
 * Are they the owner?
 */
const isOwner = (document, userId) => {
  return getUserRole(document, userId) === ROLES.OWNER;
};

/**
 * Get document and check access at the same time
 * Throws error if they don't have access
 */
const getDocumentWithAccess = async (documentId, userId, requiredLevel = 'read') => {
  const document = await Document.findById(documentId);

  if (!document) {
    const err = new Error('Document not found');
    err.status = 404;
    throw err;
  }

  const role = getUserRole(document, userId);

  if (!role) {
    const err = new Error('You do not have access to this document');
    err.status = 403;
    throw err;
  }

  if (requiredLevel === 'edit' && !EDIT_ROLES.has(role)) {
    const err = new Error('You do not have edit access to this document');
    err.status = 403;
    throw err;
  }

  if (requiredLevel === 'owner' && role !== ROLES.OWNER) {
    const err = new Error('Only the document owner can perform this action');
    err.status = 403;
    throw err;
  }

  return { document, role };
};

module.exports = {
  ROLES,
  getUserRole,
  canRead,
  canEdit,
  isOwner,
  getDocumentWithAccess,
};
