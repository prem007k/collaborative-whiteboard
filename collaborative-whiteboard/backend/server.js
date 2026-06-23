// server.js
// -----------------------------------------------------------------------------
// Real-Time Collaborative Whiteboard — Backend
//
// Responsibilities:
//   1. Serve a tiny health-check HTTP endpoint (Express).
//   2. Run a Socket.IO server that manages "rooms" — each room has its own
//      authoritative drawing history and its own list of connected users.
//   3. Implement deterministic conflict resolution so that if two clients
//      draw at (almost) the same time, every client — no matter what order
//      the network delivers messages in — ends up with the IDENTICAL final
//      canvas history. This is the "conflict prevention" feature.
// -----------------------------------------------------------------------------

import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

// Simple health check — useful to confirm the backend is alive.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

const httpServer = http.createServer(app);

// Socket.IO server, scoped to allow only our frontend origin.
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// -----------------------------------------------------------------------------
// In-memory room state
// -----------------------------------------------------------------------------
// rooms = {
//   [roomId]: {
//     drawingHistory: [ strokeObject, ... ],   // authoritative, sorted history
//     users: {
//       [socketId]: { userId, color }
//     }
//   }
// }
//
// NOTE: This is intentionally in-memory (no database) to keep the demo simple
// and fast to run. If the server restarts, room history is lost. For a
// production app you'd persist `drawingHistory` to Redis/Postgres/etc.
// -----------------------------------------------------------------------------
const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      drawingHistory: [],
      users: {},
    };
  }
  return rooms[roomId];
}

/**
 * ---------------------------------------------------------------------------
 * CONFLICT RESOLUTION MERGE
 * ---------------------------------------------------------------------------
 * This is the core "resume-worthy" piece of logic. The problem it solves:
 *
 *   Two users (User A and User B) might draw a stroke at *almost* the exact
 *   same moment. Their strokes travel over the network independently and
 *   can arrive at the server (and therefore at other clients) in ANY order,
 *   regardless of which user actually drew first. If we naively just
 *   `push()` each incoming stroke onto an array as it arrives, different
 *   clients could end up with their local history arrays in different
 *   orders (e.g. due to re-syncs, dropped connections, or reconnects),
 *   which could cause subtle "replay" bugs or a corrupted-looking canvas
 *   history when strokes overlap or get redrawn.
 *
 * The fix: instead of trusting arrival order, we treat `drawingHistory` as
 * a CRDT-like, *deterministically sorted* list:
 *
 *   1. Primary sort key:   stroke.timestamp (ascending) — the moment the
 *      stroke was created on the client, NOT the moment it arrived at the
 *      server. This means "who drew first" wins regardless of network
 *      jitter or delivery order.
 *
 *   2. Tie-breaker key:    stroke.userId (string), compared lexicographically,
 *      HIGHER string wins ties. This only matters in the rare case where two
 *      strokes have the *exact* same millisecond timestamp (a true race
 *      condition). Without a tie-breaker, the final order would depend on
 *      arrival order again — which is non-deterministic. With it, EVERY
 *      server and EVERY client, given the same set of strokes, will compute
 *      the exact same sorted order, no matter what order the strokes were
 *      received in.
 *
 * Because the merge function is a pure, deterministic sort over
 * (timestamp, userId), it doesn't matter:
 *   - which server process handled the message,
 *   - whether a client reconnected and replayed events,
 *   - or whether messages arrived out of order on the wire.
 *
 * Everyone converges on the same final `drawingHistory` array. This is the
 * same core idea used in distributed systems / CRDTs: pick a deterministic
 * total order over events instead of relying on arrival order.
 * ---------------------------------------------------------------------------
 */
function mergeStrokesIntoHistory(history, newStrokes) {
  // 1. Combine the existing authoritative history with the incoming stroke(s).
  const combined = [...history, ...newStrokes];

  // 2. De-duplicate by stroke `id` — a client might resend the same stroke
  //    (e.g. after a reconnect), and we never want duplicates in history.
  const dedupedMap = new Map();
  for (const stroke of combined) {
    dedupedMap.set(stroke.id, stroke);
  }
  const deduped = Array.from(dedupedMap.values());

  // 3. Deterministic sort: timestamp ascending, then userId DESCENDING
  //    (lexicographically higher userId wins a tie) as required.
  deduped.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp; // earlier stroke comes first
    }
    // Exact same timestamp => tie-break by userId, higher string wins,
    // meaning the higher userId should be ordered AFTER (drawn on top).
    if (a.userId < b.userId) return -1;
    if (a.userId > b.userId) return 1;
    return 0;
  });

  return deduped;
}

// -----------------------------------------------------------------------------
// Helper: build the public user list for a room (id + color only — never
// leak internal socket details to clients).
// -----------------------------------------------------------------------------
function getPublicUserList(roomId) {
  const room = rooms[roomId];
  if (!room) return [];
  return Object.values(room.users).map((u) => ({
    userId: u.userId,
    color: u.color,
  }));
}

// A small pool of pleasant, distinct avatar colors assigned round-robin per room.
const AVATAR_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#84CC16',
  '#10B981', '#06B6D4', '#3B82F6', '#6366F1',
  '#A855F7', '#EC4899',
];

function pickAvatarColor(roomId) {
  const room = getOrCreateRoom(roomId);
  const usedCount = Object.keys(room.users).length;
  return AVATAR_COLORS[usedCount % AVATAR_COLORS.length];
}

// -----------------------------------------------------------------------------
// Socket.IO connection handling
// -----------------------------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[connect] socket ${socket.id} connected`);

  /**
   * Client asks to join a room. We:
   *  - register them in the room's user list
   *  - send them the FULL authoritative drawing history (state resync)
   *  - send them the current user list
   *  - tell everyone else in the room that a new user joined (with updated
   *    user count + user list), so existing clients don't need to resend
   *    their own history — only the new user gets the full backlog.
   */
  socket.on('join-room', ({ roomId, userId }) => {
    if (!roomId || !userId) return;

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userId = userId;

    const room = getOrCreateRoom(roomId);
    const color = pickAvatarColor(roomId);
    room.users[socket.id] = { userId, color };

    // 1. Send the FULL history + this user's assigned color only to the
    //    user who just joined ("state resync").
    socket.emit('room-state', {
      drawingHistory: room.drawingHistory,
      users: getPublicUserList(roomId),
      yourColor: color,
    });

    // 2. Notify everyone else in the room (NOT the full history again —
    //    just the updated presence/user list).
    socket.to(roomId).emit('user-list-updated', {
      users: getPublicUserList(roomId),
    });

    console.log(`[join] ${userId} joined room ${roomId} (${Object.keys(room.users).length} users)`);
  });

  /**
   * Client sends one or more new strokes. We merge them into the
   * room's authoritative history using the deterministic conflict
   * resolution described above, then broadcast ONLY the new incremental
   * strokes to every other client in the room (not the whole history —
   * that's only needed once, on join).
   */
  socket.on('draw-stroke', (stroke) => {
    const roomId = socket.data.roomId;
    if (!roomId || !stroke) return;

    const room = getOrCreateRoom(roomId);

    // Merge this single incoming stroke into the authoritative history.
    room.drawingHistory = mergeStrokesIntoHistory(room.drawingHistory, [stroke]);

    // Broadcast the incremental stroke to everyone else in the room.
    // Each client applies it locally, so we don't need to resend full history.
    socket.to(roomId).emit('stroke-added', stroke);
  });

  /**
   * Clear canvas for everyone in the room. We reset the authoritative
   * server-side history too, so any new joiner sees a blank canvas.
   */
  socket.on('clear-canvas', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = getOrCreateRoom(roomId);
    room.drawingHistory = [];

    // Notify EVERYONE in the room (including sender) so all canvases reset.
    io.to(roomId).emit('canvas-cleared');
  });

  /**
   * Clean up when a user disconnects: remove them from the room's user
   * list and notify everyone else. If the room becomes empty, free its
   * memory entirely.
   */
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    delete rooms[roomId].users[socket.id];

    if (Object.keys(rooms[roomId].users).length === 0) {
      // No one left in this room — free the memory.
      delete rooms[roomId];
      console.log(`[cleanup] room ${roomId} is empty, removed from memory`);
    } else {
      socket.to(roomId).emit('user-list-updated', {
        users: getPublicUserList(roomId),
      });
    }

    console.log(`[disconnect] socket ${socket.id} disconnected`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`✅ Whiteboard backend running on http://localhost:${PORT}`);
  console.log(`   Allowing CORS from: ${CLIENT_ORIGIN}`);
});
