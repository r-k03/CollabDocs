# CollabDocs — Real-Time Collaborative Editor

This is a full-stack collaboration project I built to practice real-time systems, backend architecture, and access control in a realistic way. The app supports live multi-user editing with operational updates (not full-document overwrites), role-based sharing, and Redis-backed scaling between server instances.

---

## Tech Stack

| Layer        | Technology                    |
|-------------|-------------------------------|
| Backend      | Node.js + Express             |
| Real-time    | Socket.IO (WebSockets)        |
| Database     | MongoDB (Mongoose ODM)        |
| Cache/PubSub | Redis                        |
| Auth         | JWT + bcrypt                  |
| Frontend     | React 18 (hooks, functional)  |

---

## Architecture Overview

I split the backend by responsibility so each part is easy to reason about and test.

### Backend Structure

```
/server
  /config                   Environment, DB, Redis configuration
  /models                   Mongoose schemas (User, Document)
  /routes                   Express route handlers (auth, documents)
  /middleware               JWT auth, global error handler
  /services
    otService.js            Operational transformation engine
    permissionService.js    Centralized authorization
    realtimeService.js      Redis pub/sub for scaling
  /sockets                  WebSocket event handlers
  /utils                    Logger utility
```

---

## Why I Used Operational Transformation (OT)

### The Problem
If two people edit at the same time, operation order matters. Without conflict handling, clients can diverge and show different document states.

### Why OT Fits This Project
I picked OT over CRDTs for this implementation because:

1. **Central authority already exists**: the server already controls persistence and permissions, so OT's server-ordered flow fits naturally.
2. **Lightweight operations**: operations stay small (`insert`/`delete` with position and base version).
3. **Good learning value**: transform logic is explicit, so it's easier to explain and debug in interviews.
4. **Industry relevance**: OT is a proven model for collaborative editors.

---

## How Horizontal Scaling Works

To avoid coupling collaboration to one Node process, updates are propagated through Redis pub/sub:

1. A user connected to Server A sends an operation for document `abc123`
2. Server A validates permissions, applies the operation, and emits to local clients
3. Server A publishes that operation to Redis channel `doc:abc123`
4. Server B receives the same message from Redis
5. Server B broadcasts to clients connected to B
6. Clients on both servers converge to the same version

**Design choices I made:**
- Each server instance has a unique `SERVER_ID` to prevent rebroadcast loops
- Presence data uses Redis + TTL so stale entries clean themselves up
- Room subscriptions are created only when needed and removed when empty

---

## Permission Enforcement

Access control follows a Google Docs-style role model:

| Action          | Owner | Editor | Commenter | Viewer |
|----------------|-------|--------|-----------|--------|
| Read document   | ✅    | ✅     | ✅        | ✅     |
| Edit content    | ✅    | ✅     | ❌        | ❌     |
| Share document  | ✅    | ❌     | ❌        | ❌     |
| View history    | ✅    | ✅     | ✅        | ✅     |
| Restore version | ✅    | ❌     | ❌        | ❌     |
| Delete document | ✅    | ❌     | ❌        | ❌     |

### Enforcement Points (Defense in Depth)

Permissions are checked in two places so a client cannot bypass rules:

1. **REST layer** (`/routes/documents.js`) checks access before route logic runs.
2. **Socket layer** (`/sockets/documentHandler.js`) checks edit permission again before applying operations.

This double check matters because socket sessions are long-lived, roles can change while connected, and the server should never trust client-side role state.

---

## Setup & Running

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- Redis (local or cloud)

### Quick Start

```bash
# 1. Clone and install
git clone
npm run install:all

# 2. Create environment file
# Add values for MongoDB + Redis

# 3. Start both frontend and backend
npm run dev
```

This starts:
- **API server** at `http://localhost:5000`
- **React dev server** at `http://localhost:3000`

---

## API Endpoints

### Auth
| Method | Endpoint           |  Auth |
|--------|-------------------|-------------------|
| POST   | /api/auth/register |  No   |
| POST   | /api/auth/login    |  No   |
| GET    | /api/auth/me       |  Yes  |

### Documents
| Method | Endpoint                      |  Auth | Role    |
|--------|------------------------------|----------------------|------|
| POST   | /api/documents               |  Yes  | —       |
| GET    | /api/documents               |  Yes  | —       |
| GET    | /api/documents/:id           |  Yes  | Any     |
| PUT    | /api/documents/:id           |  Yes  | Editor+ |
| DELETE | /api/documents/:id           |  Yes  | Owner   |
| POST   | /api/documents/:id/share     |  Yes  | Owner   |
| GET    | /api/documents/:id/history   |  Yes  | Any     |
| POST   | /api/documents/:id/restore   |  Yes  | Owner   |

### WebSocket Events

| Event (Client → Server) |  Description              |
|--------------------------|--------------------------------------|
| join_document            |  Join editing room        |
| leave_document           |  Leave editing room       |
| operation                |  Send edit operation      |
| cursor_move              |  Broadcast cursor pos     |

| Event (Server → Client)  |  Description              |
|---------------------------|--------------------------------------|
| document_state            |  Initial state on join    |
| operation_ack             |  Confirm applied op       |
| remote_operation          |  Another user's edit      |
| user_joined               |  Presence: user joined    |
| user_left                 |  Presence: user left      |
| cursor_moved              |  Remote cursor update     |
| error_message             |  Error notification       |

---

## Version History

- Before each successful edit, the previous content is saved as a snapshot
- History is capped at 50 entries to keep document records bounded
- Restoring an old version creates a new version instead of rewriting history
- This keeps an audit trail of who changed what and when
