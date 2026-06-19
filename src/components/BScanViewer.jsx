// AiG — BScanViewer.jsx
// Canvas-based B-scan renderer with pan + scroll-zoom.
// Props:
//   matrix      — Float32Array[][] — matrix[sample][trace] = amplitude
//   colormap    — string — 'grey' | 'seismic' | 'viridis' | 'hot'
//   minVal      — number — amplitude mapped to LUT index 0
//   maxVal      — number — amplitude mapped to LUT index 255
//   width       — number (px) — canvas display width  (default: fills container)
//   height      — number (px) — canvas display height (default: 480)
//   onPixelHover — ({ trace, sample, depth_m, amplitude }) => void (optional)

import { useEffect, useRef, useState, useCallback } from 'react';
import { applyColormap } from '../utils/colormap';
import { sampleToDepth } from '../utils/depthCalc';

const DEFAULT_HEIGHT = 480;

export default function BScanViewer({
  matrix,
  colormap = 'grey',
  minVal = 0,
  maxVal = 1,
  height = DEFAULT_HEIGHT,
  velocity = 0.1,
  dt_ns = 0.2,
  onPixelHover,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasWidth, setCanvasWidth] = useState(800);

  // Pan + zoom state
  const viewRef = useRef({ offsetX: 0, scale: 1 }); // scale = horizontal zoom
  const dragRef = useRef(null); // { startX, startOffset }

  // ── resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setCanvasWidth(entry.contentRect.width || 800);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── render to canvas ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !matrix?.length) return;

    const samples = matrix.length;
    const traces = matrix[0].length;
    const ctx = canvas.getContext('2d');

    // Build full-resolution ImageData once per matrix/colormap/range change
    const pixels = applyColormap(matrix, colormap, minVal, maxVal);
    const imageData = new ImageData(pixels, traces, samples);

    // Draw offscreen at native resolution, then scale to canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = traces;
    offscreen.height = samples;
    offscreen.getContext('2d').putImageData(imageData, 0, 0);

    const { offsetX, scale } = viewRef.current;
    const displayWidth = Math.round(traces * scale);
    const clampedOffset = Math.max(Math.min(offsetX, 0), canvasWidth - displayWidth);
    viewRef.current.offsetX = clampedOffset;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreen, clampedOffset, 0, displayWidth, height);
  }, [matrix, colormap, minVal, maxVal, canvasWidth, height]);

  // ── pan (mouse drag) ──────────────────────────────────────────────────────
  const onMouseDown = useCallback((e) => {
    dragRef.current = { startX: e.clientX, startOffset: viewRef.current.offsetX };
  }, []);

  const onMouseMove = useCallback((e) => {
    // Hover callback
    if (onPixelHover && matrix?.length && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const traces = matrix[0].length;
      const samples = matrix.length;
      const { offsetX, scale } = viewRef.current;
      const traceF = (px - offsetX) / (traces * scale) * traces;
      const sampleF = py / height * samples;
      const trace = Math.floor(traceF);
      const sample = Math.floor(sampleF);
      if (trace >= 0 && trace < traces && sample >= 0 && sample < samples) {
        onPixelHover({
          trace,
          sample,
          depth_m: sampleToDepth(sample, dt_ns, velocity),
          amplitude: matrix[sample][trace],
        });
      }
    }

    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const traces = matrix?.[0]?.length ?? 1;
    const displayWidth = Math.round(traces * viewRef.current.scale);
    const newOffset = Math.max(
      Math.min(dragRef.current.startOffset + dx, 0),
      canvasWidth - displayWidth
    );
    viewRef.current.offsetX = newOffset;
    // Trigger redraw
    canvasRef.current && redraw();
  }, [matrix, height, dt_ns, velocity, canvasWidth, onPixelHover]);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  // ── scroll zoom ───────────────────────────────────────────────────────────
  const onWheel = useCallback((e) => {
    e.preventDefault();
    if (!matrix?.length) return;
    const traces = matrix[0].length;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const prevScale = viewRef.current.scale;
    const newScale = Math.max(0.5, Math.min(prevScale * zoomFactor, 20));

    // Zoom around mouse cursor
    const prevOffset = viewRef.current.offsetX;
    const traceAtMouse = (mouseX - prevOffset) / (traces * prevScale);
    const newOffset = mouseX - traceAtMouse * traces * newScale;
    const displayWidth = Math.round(traces * newScale);
    viewRef.current.scale = newScale;
    viewRef.current.offsetX = Math.max(Math.min(newOffset, 0), canvasWidth - displayWidth);
    redraw();
  }, [matrix, canvasWidth]);

  // ── redraw helper (pan/zoom only — reuses last ImageData via offscreen) ──
  const redrawTimerRef = useRef(null);
  const redraw = useCallback(() => {
    if (redrawTimerRef.current) return; // throttle to rAF
    redrawTimerRef.current = requestAnimationFrame(() => {
      redrawTimerRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas || !matrix?.length) return;
      const traces = matrix[0].length;
      const samples = matrix.length;
      const ctx = canvas.getContext('2d');

      const offscreen = document.createElement('canvas');
      offscreen.width = traces;
      offscreen.height = samples;
      const pixels = applyColormap(matrix, colormap, minVal, maxVal);
      offscreen.getContext('2d').putImageData(new ImageData(pixels, traces, samples), 0, 0);

      const { offsetX, scale } = viewRef.current;
      const displayWidth = Math.round(traces * scale);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(offscreen, offsetX, 0, displayWidth, height);
    });
  }, [matrix, colormap, minVal, maxVal, height]);

  // ── empty state ───────────────────────────────────────────────────────────
  if (!matrix?.length) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-800/50 text-sm text-gray-500"
      >
        No scan loaded
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full overflow-hidden rounded-xl border border-gray-700">
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={height}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        className="block cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
      />
    </div>
  );
}
