// AiG — FileLoader.jsx
// Drag-and-drop + click-to-browse GPR file input.
// Handles Mala two-file requirement (.rd3/.dt2 + companion .rad header).
// Calls useGPRData.setScan() on valid drop/select.

import { useState, useRef, useCallback } from 'react';
import { validateFile, formatFileSize } from '../utils/fileHelpers';
import { UploadCloud, FileWarning, CheckCircle2, X } from 'lucide-react';

/**
 * Props:
 *   onScanLoaded  — (scan) => void  — called after setScan resolves (optional, for parent nav)
 *   setScan       — from useGPRData
 *   loadDemo      — from useGPRData
 *   scan          — from useGPRData (to read loading/error/filename)
 */
export default function FileLoader({ setScan, loadDemo, scan, onScanLoaded }) {
  const [dragOver, setDragOver] = useState(false);
  const [pendingMala, setPendingMala] = useState(null); // { file, format } waiting for .rad
  const [localError, setLocalError] = useState(null);

  const primaryRef = useRef(null);
  const radRef = useRef(null);

  const clearError = () => setLocalError(null);

  // ── core loader ──────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file, radFile = null) => {
    clearError();
    const { valid, format, error } = validateFile(file);
    if (!valid) {
      setLocalError(error);
      return;
    }

    // Mala needs a companion .rad header — ask for it if not already provided
    if ((format === 'rd3' || format === 'dt2') && !radFile) {
      setPendingMala({ file, format });
      return;
    }

    await setScan(file, { radFile });
    if (onScanLoaded) onScanLoaded();
  }, [setScan, onScanLoaded]);

  const handleRadFile = useCallback(async (radFile) => {
    if (!pendingMala) return;
    clearError();
    if (!radFile.name.toLowerCase().endsWith('.rad')) {
      setLocalError('Mala format needs a .rad companion header file.');
      return;
    }
    await setScan(pendingMala.file, { radFile });
    setPendingMala(null);
    if (onScanLoaded) onScanLoaded();
  }, [pendingMala, setScan, onScanLoaded]);

  // ── drag handlers ─────────────────────────────────────────────────────────
  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    // If two files dropped, try to auto-detect primary + .rad pair
    if (files.length === 2) {
      const rad = files.find((f) => f.name.toLowerCase().endsWith('.rad'));
      const primary = files.find((f) => f !== rad);
      if (rad && primary) { handleFile(primary, rad); return; }
    }
    handleFile(files[0]);
  };

  // ── demo loader ───────────────────────────────────────────────────────────
  const handleDemo = () => {
    clearError();
    setPendingMala(null);
    loadDemo();
    if (onScanLoaded) onScanLoaded();
  };

  // ── render ────────────────────────────────────────────────────────────────
  const errorMsg = localError || scan.error;
  const loaded = !!scan.filename && !scan.loading;

  return (
    <div className="w-full space-y-4">

      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !pendingMala &&
