import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import Whiteboard from './components/Whiteboard.jsx';
import Toolbar from './components/Toolbar.jsx';
import Sidebar from './components/Sidebar.jsx';

// Backend URL — Socket.IO will connect here. Adjust if you deploy elsewhere.
const SERVER_URL = 'http://localhost:5000';

// Generates a random 6-character, easy-to-read Room ID (uppercase letters + digits).
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no easily-confused chars (0/O, 1/I)
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// Generates a stable per-tab userId so the server/other clients can tell users apart.
function generateUserId() {
  return 'user_' + Math.random().toString(36).slice(2, 10);
}

export default function App() {
  // `roomId` is null until the user creates/joins a room — that's our "screen" switch.
  const [roomId, setRoomId] = useState(null);
  const [joinInput, setJoinInput] = useState('');
  const [suggestedRoomId] = useState(generateRoomId);
  const [userId] = useState(generateUserId);

  // Socket connection — created once, lives for the whole app lifetime.
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);

  // Drawing tool settings, lifted up here so the Toolbar can control them
  // and the Whiteboard can read them.
  const [color, setColor] = useState('#5b8def');
  const [brushSize, setBrushSize] = useState(4);

  // Room presence state, driven by server events.
  const [users, setUsers] = useState([]);
  const [myColor, setMyColor] = useState('#5b8def');

  // Establish the socket connection once on mount.
  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    return () => {
      socket.disconnect();
    };
  }, []);

  // Listen for presence updates (user list / avatar colors) at the App level
  // so the Sidebar always has fresh data regardless of which room we're in.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleRoomState = (payload) => {
      setUsers(payload.users || []);
      if (payload.yourColor) setMyColor(payload.yourColor);
    };
    const handleUserListUpdated = (payload) => {
      setUsers(payload.users || []);
    };

    socket.on('room-state', handleRoomState);
    socket.on('user-list-updated', handleUserListUpdated);

    return () => {
      socket.off('room-state', handleRoomState);
      socket.off('user-list-updated', handleUserListUpdated);
    };
  }, [roomId]);

  // Join a room: tell the server, and flip our local "screen" to the board view.
  const joinRoom = useCallback(
    (id) => {
      const cleanId = id.trim().toUpperCase();
      if (!cleanId) return;
      setRoomId(cleanId);
      socketRef.current?.emit('join-room', { roomId: cleanId, userId });
    },
    [userId]
  );

  const leaveRoom = useCallback(() => {
    // Simplest "leave" implementation: disconnect + reconnect fresh socket.
    socketRef.current?.disconnect();
    socketRef.current?.connect();
    setRoomId(null);
    setUsers([]);
  }, []);

  const myUserId = userId;

  // ---------------------------------------------------------------------
  // Screen 1: Landing / room selection
  // ---------------------------------------------------------------------
  if (!roomId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-950 text-slate-100 px-4">
        <div className="w-full max-w-md bg-ink-900 border border-ink-700 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center font-bold text-lg">
              ✎
            </div>
            <div>
              <h1 className="text-xl font-semibold leading-tight">Collaborative Whiteboard</h1>
              <p className="text-sm text-slate-400">Draw together, in real time.</p>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">
              Start a new session
            </p>
            <button
              onClick={() => joinRoom(suggestedRoomId)}
              className="w-full py-3 rounded-lg bg-accent hover:bg-accent-dim transition-colors font-medium"
            >
              Create Room <span className="font-mono opacity-80">({suggestedRoomId})</span>
            </button>
          </div>

          <div className="flex items-center gap-2 mb-6">
            <div className="h-px flex-1 bg-ink-700" />
            <span className="text-xs text-slate-500">OR</span>
            <div className="h-px flex-1 bg-ink-700" />
          </div>

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">
              Join an existing room
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                joinRoom(joinInput);
              }}
              className="flex gap-2"
            >
              <input
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                placeholder="ROOM ID"
                maxLength={6}
                className="flex-1 px-3 py-3 rounded-lg bg-ink-800 border border-ink-700 focus:border-accent outline-none font-mono tracking-widest text-center placeholder:text-slate-600"
              />
              <button
                type="submit"
                disabled={!joinInput.trim()}
                className="px-4 py-3 rounded-lg bg-ink-700 hover:bg-ink-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
              >
                Join
              </button>
            </form>
          </div>

          <p className="mt-6 text-xs text-slate-500 text-center">
            {isConnected ? (
              <span className="text-emerald-400">● connected to server</span>
            ) : (
              <span className="text-amber-400">● connecting to server…</span>
            )}
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Screen 2: The actual whiteboard
  // ---------------------------------------------------------------------
  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 text-slate-100 overflow-hidden">
      {/* Top bar: room info + toolbar */}
      <header className="flex flex-wrap items-center gap-4 px-4 py-3 bg-ink-900 border-b border-ink-700 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center font-bold">
            ✎
          </div>
          <div className="leading-tight">
            <p className="text-xs text-slate-400">Room</p>
            <p className="font-mono font-semibold tracking-wider">{roomId}</p>
          </div>
        </div>

        <button
          onClick={() => {
            navigator.clipboard?.writeText(roomId);
          }}
          className="text-xs px-2 py-1 rounded-md bg-ink-800 hover:bg-ink-700 border border-ink-700 transition-colors"
          title="Copy Room ID to clipboard"
        >
          Copy ID
        </button>

        <div className="flex-1" />

        <Toolbar
          color={color}
          setColor={setColor}
          brushSize={brushSize}
          setBrushSize={setBrushSize}
          onClear={() => socketRef.current?.emit('clear-canvas')}
        />

        <button
          onClick={leaveRoom}
          className="text-xs px-3 py-2 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 transition-colors"
        >
          Leave Room
        </button>
      </header>

      {/* Main content: canvas + sidebar */}
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 relative bg-ink-950">
          <Whiteboard
            socket={socketRef.current}
            color={color}
            brushSize={brushSize}
            userId={myUserId}
          />
        </main>
        <Sidebar users={users} myUserId={myUserId} myColor={myColor} />
      </div>
    </div>
  );
}
