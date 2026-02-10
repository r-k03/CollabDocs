/**
 * Document routes
 * 
 * All routes need auth. Using permissionService to check access
 * 
 * POST   /api/documents - create doc
 * GET    /api/documents - list my docs
 * GET    /api/documents/:id - get one doc
 * PUT    /api/documents/:id - update title
 * DELETE /api/documents/:id - delete (owner only)
 * POST   /api/documents/:id/share - share with someone
 * GET    /api/documents/:id/history - version history
 * POST   /api/documents/:id/restore - restore old version
 */
const express = require('express');
const Document = require('../models/Document');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const permissionService = require('../services/permissionService');

const router = express.Router();

// All routes need auth
router.use(authenticate);

/**
 * Create a new document
 * User who creates it becomes the owner
 */
router.post('/', async (req, res, next) => {
  try {
    const { title } = req.body;
    const document = await Document.create({
      title: title || 'Untitled Document',
      owner: req.user.id,
      content: '',
      version: 1,
    });

    res.status(201).json({ document });
  } catch (error) {
    next(error);
  }
});

/**
 * List all docs user owns or has access to
 */
router.get('/', async (req, res, next) => {
  try {
    const documents = await Document.find({
      $or: [
        { owner: req.user.id },
        { 'sharedWith.userId': req.user.id },
      ],
    })
      .select('title owner sharedWith version createdAt updatedAt')
      .populate('owner', 'username email')
      .populate('sharedWith.userId', 'username email')
      .sort({ updatedAt: -1 });

    res.json({ documents });
  } catch (error) {
    next(error);
  }
});

/**
 * Get a document
 * Need read access
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { document, role } = await permissionService.getDocumentWithAccess(
      req.params.id,
      req.user.id,
      'read'
    );

    await document.populate('owner', 'username email');
    await document.populate('sharedWith.userId', 'username email');

    res.json({ document, role });
  } catch (error) {
    next(error);
  }
});

/**
 * Update doc title
 * Owner and editors can do this
 */
router.put('/:id', async (req, res, next) => {
  try {
    const { document } = await permissionService.getDocumentWithAccess(
      req.params.id,
      req.user.id,
      'edit'
    );

    if (req.body.title !== undefined) {
      document.title = req.body.title;
    }

    await document.save();
    res.json({ document });
  } catch (error) {
    next(error);
  }
});

/**
 * Delete a document
 * Only owner can delete
 */
router.delete('/:id', async (req, res, next) => {
  try {
    await permissionService.getDocumentWithAccess(
      req.params.id,
      req.user.id,
      'owner'
    );

    await Document.findByIdAndDelete(req.params.id);
    res.json({ message: 'Document deleted.' });
  } catch (error) {
    next(error);
  }
});

/**
 * Share document with someone
 * Only owner can share
 * Body: { email: string, role: 'editor' | 'commenter' | 'viewer' }
 */
router.post('/:id/share', async (req, res, next) => {
  try {
    const { document } = await permissionService.getDocumentWithAccess(
      req.params.id,
      req.user.id,
      'owner'
    );

    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required.' });
    }

    if (!['editor', 'commenter', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Role must be editor, commenter, or viewer.' });
    }

    const targetUser = await User.findOne({ email });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (targetUser._id.toString() === req.user.id) {
      return res.status(400).json({ error: 'Cannot share with yourself.' });
    }

    // If already shared, update role. Otherwise add them
    const existingShare = document.sharedWith.find(
      (entry) => entry.userId.toString() === targetUser._id.toString()
    );

    if (existingShare) {
      existingShare.role = role;
    } else {
      document.sharedWith.push({ userId: targetUser._id, role });
    }

    await document.save();
    await document.populate('sharedWith.userId', 'username email');

    res.json({ document });
  } catch (error) {
    next(error);
  }
});

/**
 * Get version history
 * Need read access
 */
router.get('/:id/history', async (req, res, next) => {
  try {
    const { document } = await permissionService.getDocumentWithAccess(
      req.params.id,
      req.user.id,
      'read'
    );

    await document.populate('versionHistory.editedBy', 'username email');

    res.json({
      currentVersion: document.version,
      history: document.versionHistory,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Restore to an old version
 * Owner only
 * Body: { version: number }
 * 
 * Creates a new version with the old content, doesn't delete history.
 * This way we keep a record of what happened.
 */
router.post('/:id/restore', async (req, res, next) => {
  try {
    const { document } = await permissionService.getDocumentWithAccess(
      req.params.id,
      req.user.id,
      'owner'
    );

    const { version } = req.body;
    if (version === undefined) {
      return res.status(400).json({ error: 'Version number is required.' });
    }

    const historyEntry = document.versionHistory.find(
      (entry) => entry.version === version
    );

    if (!historyEntry) {
      return res.status(404).json({ error: `Version ${version} not found in history.` });
    }

    // Save current state before restoring
    document.pushVersionSnapshot(req.user.id);

    // Apply the restored content as a new version
    document.content = historyEntry.contentSnapshot;
    document.version += 1;

    await document.save();

    res.json({
      message: `Restored to version ${version}. New version: ${document.version}`,
      document,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
