/**
 * Document model
 * 
 * This is the main thing - stores the actual documents. Has:
 * - Owner and who it's shared with (roles)
 * - Version number for OT stuff
 * - History of versions (capped at 50 so it doesn't get huge)
 * 
 * Keeping history in the same doc instead of separate collection because
 * it's faster to read everything at once. Probably fine for this project.
 */
const mongoose = require('mongoose');

const MAX_HISTORY_SIZE = 50;

const versionEntrySchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    contentSnapshot: { type: String, default: '' },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const shareEntrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: {
      type: String,
      enum: ['editor', 'commenter', 'viewer'],
      required: true,
    },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Document title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
      default: 'Untitled Document',
    },
    content: {
      type: String,
      default: '',
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sharedWith: [shareEntrySchema],
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    versionHistory: {
      type: [versionEntrySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for fast lookup of documents shared with a user
documentSchema.index({ 'sharedWith.userId': 1 });

/**
 * Save a snapshot before editing
 * Called before each edit so we can restore later if needed
 */
documentSchema.methods.pushVersionSnapshot = function (editedBy) {
  this.versionHistory.push({
    version: this.version,
    contentSnapshot: this.content != null ? String(this.content) : '',
    editedBy,
    timestamp: new Date(),
  });

  // Only keep last 50 versions, otherwise it gets too big
  if (this.versionHistory.length > MAX_HISTORY_SIZE) {
    this.versionHistory = this.versionHistory.slice(-MAX_HISTORY_SIZE);
  }
};

module.exports = mongoose.model('Document', documentSchema);
