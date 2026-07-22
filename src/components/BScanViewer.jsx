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
    // Redraw immediately with whatever scale is already current (colormap-only
    // changes shouldn't reset the user's pan/zoom) — `offscreenRef.current`
    // is a ref, so it can never be a real effect dependency; calling redraw
    // here directly is what actually keeps a colormap switch in sync.
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Fit-to-width + redraw + notify — one atomic effect ────────────────────
  // BUG THIS FIXES ("B-scan collapses to a narrow strip pushed to the right
  // edge until you manually zoom the browser out/in"): this used to be TWO
  // separate effects, both depending on canvasWidth —
  //   1. `redraw()` on [canvasWidth, height, ...]
  //   2. this fit-to-width block on [matrix, canvasWidth], which recomputes
  //      viewRef.current.scale = canvasWidth / traces
  // React runs effects in declaration order within a commit. Effect 1 ran
  // FIRST, so on every canvasWidth change (e.g. ResizeObserver catching the
  // container's real width after fullscreen toggle, sidebar collapse, or
  // just initial layout settling) it called redraw() using whatever scale
  // was already in viewRef.current — computed for the OLD, usually smaller,
  // canvasWidth — while displayWidth/clampedOffset used the NEW, larger
  // canvasWidth. That produces exactly the visual bug reported: a narrow
  // strip of B-scan drawn at a large positive offset (clampedOffset =
  // canvasWidth − displayWidth, which is large when displayWidth is small),
  // i.e. pushed against the right edge with the rest of the canvas blank.
  // Effect 2 then corrected viewRef.current.scale, but by then the frame
  // ordering was no longer guaranteed self-healing on every browser/timing
  // combination — this is the same shape of bug §40 v6 tried to patch via a
  // forced remount, which helped the fullscreen-toggle case specifically but
  // not this more general one (any canvasWidth change, including plain page
  // load, hits the same race). Merging both concerns into a single effect
  // means scale is always recomputed and the draw scheduled in one
  // synchronous pass — there is no longer a second effect that can observe
  // (or draw from) a stale scale against a fresh width.
  useEffect(() => {
    if (!matrix?.length || !canvasWidth) return;
    const traces = matrix[0].length;
    if (!traces) return;
    viewRef.current = { offsetX: 0, scale: canvasWidth / traces };
    redraw();
    notifyViewChange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix, canvasWidth, height]);

  // ── Resize observer ───────────────────────────────────────────────────────
  // Read the container's actual width synchronously on mount (via
  // getBoundingClientRect) instead of relying solely on ResizeObserver's
  // first callback. Per spec RO does fire once immediately on observe(), but
  // that callback is still async (queued as a microtask) — under an ancestor
  // layout change happening in the same tick (e.g. toggling a `fixed`
  // overlay on), there's a narrow window where the very first paint uses the
  // stale default (800) before RO catches up. Reading the rect directly here
  // removes that window entirely; RO still drives every update after this.
  useEffect(() => {
    if (!containerRef.current) return;
    const initial = containerRef.current.getBoundingClientRect().width;
    if (initial) setCanvasWidth(initial);
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
