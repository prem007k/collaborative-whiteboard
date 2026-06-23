# Real-Time Collaborative Whiteboard

A multi-user, real-time whiteboard built with **React + Vite + Tailwind** on the
frontend and **Node.js + Express + Socket.IO** on the backend. Multiple people
can join the same room and draw together, with deterministic conflict
resolution so simultaneous strokes never corrupt the shared canvas.

---

## ✨ Features

- Auto-generated 6-character Room IDs, or join an existing room by ID
- Freehand drawing with adjustable color and brush size (2–20px)
- Real-time sync of strokes across all users in a room
- "Clear Canvas" that resets the board for everyone
- Live user list with auto-assigned avatar colors + active user count
- Deterministic server-side conflict resolution for simultaneous strokes
- Canvas auto-resizes smoothly to fill its container (no distortion, no lost drawing)

---

## 🗂 Project Structure

```
collaborative-whiteboard/
├── backend/
│   ├── package.json
│   ├── server.js          # Express + Socket.IO server, room + merge logic
│   └── .env.example
├── frontend/
│   ├── package.json
│   ├── index.html
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── index.css
│       ├── App.jsx
│       └── components/
│           ├── Whiteboard.jsx   # Canvas drawing + socket sync
│           ├── Toolbar.jsx      # Color picker, brush size, clear button
│           └── Sidebar.jsx      # Active users list
└── README.md
```

---

## 🚀 Quick Start (under 2 minutes)

You'll need **Node.js 18+** installed. Open **two terminal windows** — one for
the backend, one for the frontend.

### 1. Start the backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

You should see:
```
✅ Whiteboard backend running on http://localhost:5000
   Allowing CORS from: http://localhost:5173
```

### 2. Start the frontend (in a second terminal)

```bash
cd frontend
npm install
npm run dev
```

You should see Vite print a local URL:
```
➜  Local:   http://localhost:5173/
```

### 3. Try it out

1. Open **http://localhost:5173** in your browser.
2. Click **"Create Room"** — note the generated Room ID.
3. Open the same URL in a **second browser tab/window** (or another browser).
4. Paste the Room ID into the **"Join an existing room"** field and click **Join**.
5. Draw on either tab — you'll see strokes appear in real time on both, the
   user count update, and a colored avatar appear in the sidebar.

That's it — no database, no build step required to get going.

---

## 🧠 How the Conflict Resolution Works

This is the core "no canvas corruption" guarantee, implemented in
`backend/server.js` inside `mergeStrokesIntoHistory()`. The file has detailed
inline comments — here's the short version:

**The problem:** Two users can draw at almost the exact same moment. Their
stroke messages travel over the network independently and can arrive at the
server (and other clients) in *any* order — not necessarily the order the
strokes were actually drawn in. If you just append incoming strokes to an
array as they arrive, different clients can end up disagreeing about stroke
order after reconnects/resyncs.

**The fix — a deterministic total order:**

1. **Primary key — `timestamp` (ascending).** Every stroke is stamped with
   `Date.now()` the moment it's finished on the client. The server always
   sorts the authoritative `drawingHistory` array by this timestamp, so "who
   drew first" wins — regardless of network jitter or arrival order.

2. **Tie-breaker — `userId` (lexicographic, higher wins).** In the rare case
   where two strokes land on the *exact* same millisecond, we break the tie
   by comparing `userId` strings — the higher string is ordered *after* (i.e.
   rendered on top). Since this is a pure string comparison with no
   reliance on arrival order, every server instance and every client
   computes the *same* result given the same set of strokes.

3. **De-duplication by stroke `id`.** Before sorting, strokes are deduped by
   their unique `id`, so reconnect/replay scenarios never produce duplicate
   ink.

Because the merge is a pure function of `(timestamp, userId)` — not "whoever
the server happened to process first" — every client converges on the exact
same final drawing history, no matter what order packets arrive in. This is
the same idea behind CRDTs / distributed systems: pick a deterministic total
order over events instead of trusting delivery order.

**State sync strategy:**
- **New user joins** → server emits the **entire** `drawingHistory` (`room-state` event) so they see the full canvas immediately.
- **Existing users** → only receive the **new incremental stroke** (`stroke-added` event) as it happens, which keeps real-time drawing fast and bandwidth-light.

---

## 🔧 Configuration

### Backend (`backend/.env`)
```
PORT=5000
CLIENT_ORIGIN=http://localhost:5173
```
`CLIENT_ORIGIN` controls the CORS allow-list for both the Express HTTP routes
and the Socket.IO server — only this origin will be allowed to connect.

### Frontend
The backend URL is set directly in `frontend/src/App.jsx`:
```js
const SERVER_URL = 'http://localhost:5000';
```
Change this if you deploy the backend somewhere other than localhost.

---

## 🛠 Tech Stack

| Layer        | Technology                          |
|--------------|--------------------------------------|
| Frontend     | React 18, Vite, Tailwind CSS, HTML5 Canvas |
| Realtime     | Socket.IO (WebSocket transport, polling fallback) |
| Backend      | Node.js, Express                     |
| Modules      | ES Modules (`"type": "module"`) throughout |

---

## 📝 Notes & Possible Extensions

- Room history is stored **in memory** on the backend for simplicity — restarting
  the server clears all rooms. For production use, persist `drawingHistory` to
  Redis or a database.
- Drawing is rendered as straight-line segments between sampled mouse points.
  At normal mouse-move sampling rates this already looks smooth; if you want
  buttery curves at very low sampling rates, consider adding quadratic Bezier
  smoothing in `drawStroke()` inside `Whiteboard.jsx`.
- Currently supports mouse input only — touch/stylus support could be added by
  also wiring up `touchstart` / `touchmove` / `touchend` handlers alongside the
  existing mouse handlers in `Whiteboard.jsx`.
