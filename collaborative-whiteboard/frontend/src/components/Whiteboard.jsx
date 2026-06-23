import React, { useEffect, useRef, useCallback } from 'react';

/**
 * ---------------------------------------------------------------------------
 * Whiteboard
 * ---------------------------------------------------------------------------
 * This component owns:
 *   1. The <canvas> element and its 2D rendering context.
 *   2. Local mouse-driven drawing (mousedown / mousemove / mouseup).
 *   3. Sending finished/in-progress strokes to the server via Socket.IO.
 *   4. Receiving strokes from other users and rendering them immediately.
 *   5. Full-history resync when first joining a room.
 *   6. Auto-resizing the canvas to fill its container without distorting
 *      already-drawn content.
 *
 * DATA MODEL — a "stroke" object looks like:
 *   {
 *     id: string,            // unique id for this stroke (for de-dup)
 *     points: [{x, y}, ...], // every point sampled while the mouse moved
 *     color: string,         // hex color
 *     size: number,          // brush width in px
 *     userId: string,        // who drew it (used for conflict resolution)
 *     timestamp: number      // Date.now() when the stroke was finished
 *   }
 *
 * We keep the ENTIRE history of strokes (not just pixels) so that:
 *   - new joiners can replay the whole drawing exactly,
 *   - the canvas can be redrawn cleanly after a resize (canvases lose their
 *     pixel content when you change width/height).
 * ---------------------------------------------------------------------------
 */
export default function Whiteboard({ socket, color, brushSize, userId }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const ctxRef = useRef(null);

  // The authoritative list of strokes we know about, kept in a ref so we can
  // redraw synchronously (e.g. after a resize) without waiting on React state.
  const historyRef = useRef([]);

  // Tracks the in-progress stroke while the mouse is down.
  const currentStrokeRef = useRef(null);
  const isDrawingRef = useRef(false);

  // -------------------------------------------------------------------------
  // Drawing helpers
  // -------------------------------------------------------------------------

  // Draws a single stroke (a connected sequence of points) onto the canvas.
  // Using simple straight-line segments between consecutive points — at a
  // high enough sampling rate (every mousemove event) this already looks
  // smooth, and it keeps the code easy to follow.
  const drawStroke = useCallback((ctx, stroke) => {
    const { points, color: strokeColor, size } = stroke;
    if (!points || points.length === 0) return;

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1) {
      // A single click with no movement — draw a dot so it's still visible.
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = strokeColor;
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }, []);

  // Clears the canvas and redraws every stroke in `historyRef`, in order.
  // Order matters here for visual correctness when strokes overlap — this
  // is why the server keeps history deterministically sorted (see server.js
  // conflict-resolution comments) and we just render in the order we're given.
  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of historyRef.current) {
      drawStroke(ctx, stroke);
    }
  }, [drawStroke]);

  // -------------------------------------------------------------------------
  // Canvas setup + responsive resize handling
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;

    // Resizes the underlying canvas pixel buffer to match its container's
    // current on-screen size (accounting for devicePixelRatio so drawing
    // stays crisp on high-DPI screens), then redraws all known strokes —
    // because resizing a canvas element clears its pixels.
    const resizeCanvas = () => {
      const { width, height } = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      // Reset the transform before scaling to avoid compounding scale
      // factors on repeated resizes.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      redrawAll();
    };

    resizeCanvas();

    // Use ResizeObserver instead of window 'resize' so it also reacts to
    // sidebar toggles / layout changes, not just window resizing.
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [redrawAll]);

  // -------------------------------------------------------------------------
  // Socket event wiring: state resync, incremental strokes, clear events
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    // Full resync — sent once when we join a room. Replaces our entire
    // local history and redraws from scratch.
    const handleRoomState = (payload) => {
      historyRef.current = payload.drawingHistory || [];
      redrawAll();
    };

    // Incremental stroke from another user — append + draw immediately,
    // without touching the rest of the canvas (cheap and fast).
    const handleStrokeAdded = (stroke) => {
      historyRef.current = [...historyRef.current, stroke];
      const ctx = ctxRef.current;
      if (ctx) drawStroke(ctx, stroke);
    };

    // Server told us the canvas was cleared (by us or someone else).
    const handleCanvasCleared = () => {
      historyRef.current = [];
      redrawAll();
    };

    socket.on('room-state', handleRoomState);
    socket.on('stroke-added', handleStrokeAdded);
    socket.on('canvas-cleared', handleCanvasCleared);

    return () => {
      socket.off('room-state', handleRoomState);
      socket.off('stroke-added', handleStrokeAdded);
      socket.off('canvas-cleared', handleCanvasCleared);
    };
  }, [socket, drawStroke, redrawAll]);

  // -------------------------------------------------------------------------
  // Mouse-driven local drawing
  // -------------------------------------------------------------------------

  // Converts a raw mouse event into canvas-local coordinates (accounting
  // for the canvas's on-screen position).
  const getCanvasPoint = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  const handleMouseDown = useCallback(
    (e) => {
      isDrawingRef.current = true;
      const point = getCanvasPoint(e);

      // Start a brand-new stroke. We assign its `id` and `timestamp` now —
      // the timestamp is what the server's conflict-resolution merge will
      // use to order this stroke relative to everyone else's.
      currentStrokeRef.current = {
        id: `${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        points: [point],
        color,
        size: brushSize,
        userId,
        timestamp: Date.now(),
      };
    },
    [color, brushSize, userId, getCanvasPoint]
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!isDrawingRef.current || !currentStrokeRef.current) return;

      const point = getCanvasPoint(e);
      currentStrokeRef.current.points.push(point);

      // Draw just the newest segment locally for instant feedback —
      // we don't wait for the server round-trip to see our own ink.
      const ctx = ctxRef.current;
      const pts = currentStrokeRef.current.points;
      if (ctx && pts.length >= 2) {
        const prev = pts[pts.length - 2];
        ctx.strokeStyle = color;
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
    },
    [color, brushSize, getCanvasPoint]
  );

  const finishStroke = useCallback(() => {
    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    isDrawingRef.current = false;

    const stroke = currentStrokeRef.current;
    currentStrokeRef.current = null;

    // Refresh the timestamp to the moment the stroke is FINISHED, so it
    // reflects "when this stroke was committed" — this is the value the
    // server's deterministic sort/tie-break logic relies on.
    stroke.timestamp = Date.now();

    // Add to our own local history immediately (optimistic update) ...
    historyRef.current = [...historyRef.current, stroke];

    // ... then tell the server, which will merge it into the room's
    // authoritative history and broadcast it to everyone else.
    socket?.emit('draw-stroke', stroke);
  }, [socket]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair touch-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={finishStroke}
        onMouseLeave={finishStroke}
      />
    </div>
  );
}
