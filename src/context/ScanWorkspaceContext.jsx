// AiG — ScanWorkspaceContext.jsx  (§39)
//
// WHY THIS EXISTS
// ----------------
// AI Detection Lab and ResNet-18 Spatial AI each have a "standalone" mode:
// if you open them directly (sidebar click, not via an explicit "Send to X"
// button), they upload/parse their own file and run their own detector
// (utils/autoDetect.js quickAutoDetect) independently of each other. Two
// separate runs on what a person assumes is "the same scan" can produce
// different box counts/positions, and — worse — ResNet-18 Spatial AI has no
// classifier of its own (its 128-D embedding carries no material label), so
// its B-scan overlay was faking material names ("stone"/"void") just to
// colour-code "embedding extracted" vs "not yet", which reads exactly like
// a confident material prediction even though it isn't one (§38 follow-up).
//
// FIX
// ----
// Hold the "current scan" (matrix/metadata/detections, plus any real AI
// classifications produced by AI Detection Lab) in a context above the
// router, mirroring the FusionWorkspaceContext pattern (§18). Both pages
// read this as a fallback (after their own location.state / freshly-loaded
// scan) instead of silently re-detecting from scratch, so navigating between
// AI Research Lab pages via the sidebar shows the same boxes everywhere, and
// ResNet-18 Spatial AI can show AI Detection Lab's *real* classification
// labels when available instead of a fake material name.
//
// Kept in-memory only (no sessionStorage) — a full GPR matrix is much larger
// than the embedding arrays FusionWorkspaceContext persists, so writing it
// on every scan would risk hitting sessionStorage's ~5MB quota. This only
// needs to survive in-app navigation within the current tab, not a hard
// refresh.

import { createContext, useContext, useState, useCallback } from 'react';

const ScanWorkspaceContext = createContext(null);

export function ScanWorkspaceProvider({ children }) {
  const [scan, setScanState] = useState({
    matrix: null,
    metadata: null,
    filename: null,
    scanId: null,
    velocity: 0.1,
    classicalDetections: [],   // from utils/autoDetect.js quickAutoDetect — unlabelled boxes
    aiDetections: null,        // from AI Detection Lab's runDetector — real label + confidence per box
  });

  // Base scan + classical detections. Called whenever a page finishes
  // loading/parsing a scan (upload, sample, or arriving via location.state)
  // so the *other* AI Research Lab pages can pick up the same scan instead
  // of re-uploading/re-detecting from scratch.
  const setScanBase = useCallback((next) => {
    setScanState((prev) => ({
      ...prev,
      matrix: next.matrix ?? prev.matrix,
      metadata: next.metadata ?? prev.metadata,
      filename: next.filename ?? prev.filename,
      scanId: next.scanId ?? prev.scanId,
      velocity: next.velocity ?? prev.velocity,
      classicalDetections: next.classicalDetections ?? prev.classicalDetections,
      // a genuinely new scan invalidates any previous AI classifications
      aiDetections: next.filename && next.filename !== prev.filename ? null : prev.aiDetections,
    }));
  }, []);

  // Real per-box classifications from AI Detection Lab's deep-detector head
  // (YOLO-lite / Faster R-CNN-lite / Mask R-CNN-lite) — these have genuine
  // label + confidence values, unlike ResNet-18's embedding-only output.
  const setAiDetections = useCallback((dets) => {
    setScanState((prev) => ({ ...prev, aiDetections: dets }));
  }, []);

  const clearScan = useCallback(() => {
    setScanState({
      matrix: null, metadata: null, filename: null, scanId: null, velocity: 0.1,
      classicalDetections: [], aiDetections: null,
    });
  }, []);

  return (
    <ScanWorkspaceContext.Provider value={{ ...scan, setScanBase, setAiDetections, clearScan }}>
      {children}
    </ScanWorkspaceContext.Provider>
  );
}

export function useScanWorkspace() {
  const ctx = useContext(ScanWorkspaceContext);
  if (!ctx) {
    throw new Error('useScanWorkspace must be used inside <ScanWorkspaceProvider>');
  }
  return ctx;
}
