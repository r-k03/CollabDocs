/**
 * OT (Operational Transformation) service
 * 
 * This handles conflict resolution when multiple people edit at the same time.
 * Basically the Google Docs approach.
 * 
 * Why OT instead of CRDT:
 * - OT is simpler for text editing with a server
 * - We have MongoDB as the source of truth anyway
 * - CRDTs add a ton of metadata per character which seems overkill
 * 
 * Operation format:
 * { type: "insert", position: Number, text: String, baseVersion: Number }
 * { type: "delete", position: Number, length: Number, baseVersion: Number }
 * 
 * How it works:
 * If a client's version is behind, we transform their operation against
 * all the operations they missed. This way everyone ends up with the same
 * document even if messages arrive in different orders.
 */
const Document = require('../models/Document');
const logger = require('../utils/logger');

/**
 * Keep track of recent operations in memory
 * Maps documentId to an array of operations
 */
const operationBuffers = new Map();

const MAX_BUFFER_SIZE = 200; // Don't let it get too big

/**
 * Get the buffer for a doc (create if it doesn't exist)
 */
const getBuffer = (documentId) => {
  if (!operationBuffers.has(documentId)) {
    operationBuffers.set(documentId, []);
  }
  return operationBuffers.get(documentId);
};

/**
 * Transform opA against opB
 * Returns opA adjusted for opB happening first
 * 
 * If two operations happen at the same time,
 * we need to adjust one so it still works when applied after the other.
 */
const transformOperation = (opA, opB) => {
  const transformed = { ...opA };

  // Both inserting
  if (opA.type === 'insert' && opB.type === 'insert') {
    // If B inserted before where A wants to insert, move A forward
    if (opB.position <= opA.position) {
      transformed.position += opB.text.length;
    }
  }

  // A inserting, B deleting
  if (opA.type === 'insert' && opB.type === 'delete') {
    // If B deleted before A's position, move A back
    if (opB.position < opA.position) {
      transformed.position -= Math.min(opB.length, opA.position - opB.position);
    }
  }

  // A deleting, B inserting
  if (opA.type === 'delete' && opB.type === 'insert') {
    // If B inserted before A's delete, move A forward
    if (opB.position <= opA.position) {
      transformed.position += opB.text.length;
    }
  }

  // Both deleting - this is the tricky one
  if (opA.type === 'delete' && opB.type === 'delete') {
    if (opB.position >= opA.position + opA.length) {
      // B deleted after A, no problem
    } else if (opB.position + opB.length <= opA.position) {
      // B deleted before A, shift A back
      transformed.position -= opB.length;
    } else {
      // They overlap - need to shrink A so we don't double-delete
      const overlapStart = Math.max(opA.position, opB.position);
      const overlapEnd = Math.min(opA.position + opA.length, opB.position + opB.length);
      const overlapLength = Math.max(0, overlapEnd - overlapStart);

      transformed.length -= overlapLength;
      transformed.position = Math.min(opA.position, opB.position);

      // If everything was already deleted, make it a no-op
      if (transformed.length <= 0) {
        transformed.length = 0;
        transformed.type = 'noop';
      }
    }
  }

  return transformed;
};

/**
 * Actually apply an operation to the content string
 * Returns the new content
 */
const applyOperation = (content, operation) => {
  if (operation.type === 'noop') {
    return content;
  }

  if (operation.type === 'insert') {
    const pos = Math.min(Math.max(0, operation.position), content.length);
    return content.slice(0, pos) + operation.text + content.slice(pos);
  }

  if (operation.type === 'delete') {
    const pos = Math.min(Math.max(0, operation.position), content.length);
    const end = Math.min(pos + operation.length, content.length);
    return content.slice(0, pos) + content.slice(end);
  }

  logger.warn('Unknown operation type:', operation.type);
  return content;
};

/**
 * Process an operation from a client
 * 
 * Steps:
 * 1. Get the document
 * 2. Check if client is behind (baseVersion < current version)
 * 3. If behind, transform against all the ops they missed
 * 4. Save snapshot to history
 * 5. Apply the op and bump version
 * 6. Save to DB
 * 7. Add to buffer for future transforms
 */
const processOperation = async (documentId, operation, userId) => {
  // Get latest doc state
  const document = await Document.findById(documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  const buffer = getBuffer(documentId);
  let transformedOp = { ...operation };

  // If client is behind, transform against missed ops
  if (operation.baseVersion < document.version) {
    const missedOps = buffer.filter((entry) => entry.version > operation.baseVersion);

    for (const { operation: serverOp } of missedOps) {
      transformedOp = transformOperation(transformedOp, serverOp);
      if (transformedOp.type === 'noop') break; // No point continuing if it's a no-op
    }
  }

  // If transform made it a no-op, don't save anything
  if (transformedOp.type === 'noop') {
    return {
      document,
      transformedOp,
      newVersion: document.version,
    };
  }

  // Save snapshot before changing
  document.pushVersionSnapshot(userId);

  // Apply the op
  const newContent = applyOperation(document.content, transformedOp);
  document.content = newContent;
  document.version += 1;

  // Save to DB
  await document.save();

  // Add to buffer
  buffer.push({
    version: document.version,
    operation: transformedOp,
  });

  // Don't let buffer get too big
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
  }

  logger.debug(
    `OT: Applied ${transformedOp.type} at pos ${transformedOp.position} → v${document.version}`
  );

  return {
    document,
    transformedOp,
    newVersion: document.version,
  };
};

/**
 * Clean up buffer when no one is editing the doc anymore
 * Otherwise it'll just sit in memory forever
 */
const clearBuffer = (documentId) => {
  operationBuffers.delete(documentId);
};

module.exports = {
  transformOperation,
  applyOperation,
  processOperation,
  clearBuffer,
};
