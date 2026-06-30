// AiG — BScanViewer.jsx
// Canvas-based B-scan renderer with pan + scroll-zoom.
// Props:
//   matrix        — Float32Array[][] — matrix[sample][trace] = amplitude
//   colormap      — string — 'grey' | 'seismic' | 'viridis' | 'hot'
//   minVal        — number — amplitude mapped to LUT index 0
//   maxVal        — number — amplitude mapped to LUT index 255
//   height        — number (px) — canvas display height (default: 480)
//   velocity      — number — m/ns for depth calc
//   dt_ns         — number — time step per sample (ns)
//   onPixelHover  — ({ trace, sample, depth_m, amplitude }) => void (optional)
//   onViewChange  — ({ panOffset: {x,y}, zoom, canvasWidth, canvasHeight }) => void (optional)
//                   Called on every pan/zoom change — used by HyperbolaOverlay to sync.

import { useEffect, useRef, useState, useCallback } from 'react';
import { applyColormap } from '../utils/colormap';
import { sampleToDepth } from '../utils/depthCalc';

const DEFAULT_HEIGHT = 480;

export default function BScanViewer({
  matrix,
  colormap    = 'grey',
  minVal      = 0,
  maxVal      = 1,
  height      = DEFAULT_HEIGHT,
  velocity    = 0.1,
  dt_ns       = 0.2,
  onPixelHover,
  onViewChange,
}) {
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const [canvasWidth, setCanvasWidth] = useState(800);

  // Pan + zoom state
  const viewRef = useRef({ offsetX: 0, scale: 1 });
  const dragRef = useRef(null);

  // Cached offscreen canvas — rebuilt only when matrix/colormap/range changes
  const offscreenRef = useRef(null);

  // ── Rebuild offscreen cache ───────────────────────────────────────────────
  useEffect(() => {
    if (!matrix?.length) { offscreenRef.current = null; return; }
    const traces  = matrix[0].length;
    const samples = matrix.length;
    const pixels  = applyColormap(matrix, colormap, minVal, maxVal);
    const os      = document.createElement('canvas');
    os.width      = traces;
    os.height     = samples;
    os.getContext('2d').putImageData(new ImageData(pixels, traces, samples), 0, 0);
    offscreenRef.current = os;
  }, [matrix, colormap, minVal, maxVal]);

  // ── Notify parent of view state ───────────────────────────────────────────
  const notifyViewChange = useCallback(() => {
    if (!onViewChange) return;
    const { offsetX, scale } = viewRef.current;
    onViewChange({
      panOffset:    { x: offsetX, y: 0 },
      zoom:         scale,
      canvasWidth,
      canvasHeight: height,
    });
  }, [onViewChange, canvasWidth, height]);

  // ── Draw to canvas (uses cached offscreen) ────────────────────────────────
  const redrawTimerRef = useRef(null);
  const redraw = useCallback(() => {
    if (redrawTimerRef.current) return;
    redrawTimerRef.current = requestAnimationFrame(() => {
      redrawTimerRef.current = null;
      const canvas = canvasRef.current;
      const os     = offscreenRef.current;
      if (!canvas || !os) return;

      const traces       = os.width;
      const { offsetX, scale } = viewRef.current;
      const displayWidth = Math.round(traces * scale);
      const clampedOffset = Math.max(Math.min(offsetX, 0), canvasWidth - displayWidth);
      viewRef.current.offsetX = clampedOffset;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(os, clampedOffset, 0, displayWidth, height);
    });
  }, [canvasWidth, height]);

  // Redraw when offscreen cache or canvas size changes
  useEffect(() => { redraw(); }, [offscreenRef.current, canvasWidth, height, redraw]);

  // Notify parent after redraw when canvasWidth/height change
  useEffect(() => { notifyViewChange(); }, [canvasWidth, height, notifyViewChange]);

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setCanvasWidth(entry.contentRect.width || 800);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Pan (mouse drag) ──────────────────────────────────────────────────────
  const onMouseDown = useCallback((e) => {
    dragRef.current = { startX: e.clientX, startOffset: viewRef.current.offsetX };
  }, []);

  const onMouseMove = useCallback((e) => {
    // Hover info
    if (onPixelHover && matrix?.length && canvasRef.current) {
      const rect   = canvasRef.current.getBoundingClientRect();
      const px     = e.clientX - rect.left;
      const py     = e.clientY - rect.top;
      const traces  = matrix[0].length;
      const samples = matrix.length;
      const { offsetX, scale } = viewRef.current;
      const trace  = Math.floor((px - offsetX) / (traces * scale) * traces);
      const sample = Math.floor(py / height * samples);
      if (trace >= 0 && trace < traces && sample >= 0 && sample < samples) {
        onPixelHover({
          trace, sample,
          depth_m:   sampleToDepth(sample, dt_ns, velocity),
          amplitude: matrix[sample][trace],
        });
      }
    }

    if (!dragRef.current) return;
    const dx           = e.clientX - dragRef.current.startX;
    const traces       = matrix?.[0]?.length ?? 1;
    const displayWidth = Math.round(traces * viewRef.current.scale);
    viewRef.current.offsetX = Math.max(
      Math.min(dragRef.current.startOffset + dx, 0),
      canvasWidth - displayWidth
    );
    redraw();
    notifyViewChange();
  }, [matrix, height, dt_ns, velocity, canvasWidth, onPixelHover, redraw, notifyViewChange]);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  // ── Scroll zoom ───────────────────────────────────────────────────────────
  const onWheel = useCallback((e) => {
    e.preventDefault();
    if (!matrix?.length) return;

    const traces   = matrix[0].length;
    const rect     = canvasRef.current.getBoundingClientRect();
    const mouseX   = e.clientX - rect.left;
    const factor   = e.deltaY < 0 ? 1.1 : 0.9;
    const prevScale  = viewRef.current.scale;
    const newScale   = Math.max(0.5, Math.min(prevScale * factor, 20));
    const prevOffset = viewRef.current.offsetX;

    // Zoom anchored at mouse cursor
    const traceAtMouse = (mouseX - prevOffset) / (traces * prevScale);
    const newOffset    = mouseX - traceAtMouse * traces * newScale;
    const displayWidth = Math.round(traces * newScale);

    viewRef.current.scale   = newScale;
    viewRef.current.offsetX = Math.max(Math.min(newOffset, 0), canvasWidth - displayWidth);

    redraw();
    notifyViewChange();
  }, [matrix, canvasWidth, redraw, notifyViewChange]);

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!matrix?.length) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-xl border border-dashed
                   border-[#F0E9B8] bg-white/60 text-sm text-stone-400"
      >
        No scan loaded
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full overflow-hidden rounded-xl border border-[#F0E9B8]">
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
