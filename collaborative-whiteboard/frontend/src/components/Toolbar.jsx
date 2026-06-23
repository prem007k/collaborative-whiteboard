import React from 'react';

// Quick-pick swatch colors, in addition to the full color picker.
const SWATCHES = ['#5b8def', '#ef4444', '#10b981', '#f59e0b', '#ffffff', '#000000'];

export default function Toolbar({ color, setColor, brushSize, setBrushSize, onClear }) {
  return (
    <div className="flex items-center gap-4 bg-ink-800 border border-ink-700 rounded-xl px-3 py-2">
      {/* Color swatches */}
      <div className="flex items-center gap-1.5">
        {SWATCHES.map((sw) => (
          <button
            key={sw}
            onClick={() => setColor(sw)}
            className={`w-6 h-6 rounded-full border-2 transition-transform ${
              color === sw ? 'border-accent scale-110' : 'border-transparent'
            }`}
            style={{ backgroundColor: sw }}
            title={sw}
            aria-label={`Select color ${sw}`}
          />
        ))}
        {/* Native color picker for full custom color choice */}
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="w-6 h-6 rounded-full overflow-hidden border-2 border-ink-600 bg-transparent cursor-pointer"
          title="Custom color"
        />
      </div>

      <div className="h-6 w-px bg-ink-700" />

      {/* Brush size slider, range 2–20px */}
      <div className="flex items-center gap-2">
        <label htmlFor="brush-size" className="text-xs text-slate-400 whitespace-nowrap">
          Brush
        </label>
        <input
          id="brush-size"
          type="range"
          min={2}
          max={20}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className="w-24 accent-accent cursor-pointer"
        />
        <span className="text-xs text-slate-400 w-6 text-right">{brushSize}px</span>
        {/* Live preview dot of current brush size/color */}
        <div
          className="rounded-full flex-shrink-0"
          style={{
            width: Math.max(brushSize, 4),
            height: Math.max(brushSize, 4),
            backgroundColor: color,
          }}
        />
      </div>

      <div className="h-6 w-px bg-ink-700" />

      <button
        onClick={onClear}
        className="text-xs px-3 py-1.5 rounded-md bg-ink-700 hover:bg-ink-600 transition-colors font-medium"
      >
        Clear Canvas
      </button>
    </div>
  );
}
