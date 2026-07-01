// AiG — FileLoader.jsx
// Drag-and-drop + click-to-browse GPR file input.
// Handles Mala two-file requirement (.rd3/.dt2 + companion .rad header).
// Calls useGPRData.setScan() on valid drop/select.

import { useState, useRef, useCallback } from 'react';
import { validateFile, formatFileSize } from '../utils/fileHelpers';
import { UploadCloud, FileWarning, CheckCircle2, X } from 'lucide-react';

export default function FileLoader({ setScan, loadDemo, scan, onScanLoaded }) {
  const [dragOver, setDragOver] = useState(false);
  const [pendingMala, setPendingMala] = useState(null);
  const [localError, setLocalError] = useState(null);

  const primaryRef = useRef(null);
  const radRef = useRef(null);

  const clearError = () => setLocalError(null);

  const handleFile = useCallback(async (file, radFile = null) => {
    clearError();
    const { valid, format, error } = validateFile(file);
    if (!valid) { setLocalError(error); return; }
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

  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (files.length === 2) {
      const rad = files.find((f) => f.name.toLowerCase().endsWith('.rad'));
      const primary = files.find((f) => f !== rad);
      if (rad && primary) { handleFile(primary, rad); return; }
    }
    handleFile(files[0]);
  };

  const handleDemo = () => {
    clearError();
    setPendingMala(null);
    loadDemo();
    if (onScanLoaded) onScanLoaded();
  };

  const errorMsg = localError || scan.error;
  const loaded = !!scan.filename && !scan.loading;

  return (
    <div className="w-full space-y-4">
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !pendingMala && primaryRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <UploadCloud className="h-10 w-10 text-gray-400" />
        <p className="text-sm font-medium text-gray-700">
          Drag &amp; drop a GPR file here, or click to browse
        </p>
        <p className="text-xs text-gray-500">
          Supports .DZT, .rd3 / .dt2 (+ .rad), .sgy, .csv
        </p>
        <input
          ref={primaryRef}
          type="file"
          className="hidden"
          accept=".dzt,.rd3,.dt2,.sgy,.csv"
          onChange={(e) => {
            if (e.target.files?.[0]) handleFile(e.target.files[0]);
            e.target.value = '';
          }}
        />
      </div>

      {pendingMala && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <FileWarning className="h-4 w-4" />
            <span>
              <strong>{pendingMala.file.name}</strong> needs its companion <code>.rad</code> header file.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => radRef.current?.click()}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">
              Select .rad file
            </button>
            <button type="button" onClick={() => setPendingMala(null)}
              className="rounded-md p-1.5 text-amber-600 hover:bg-amber-100" aria-label="Cancel">
              <X className="h-4 w-4" />
            </button>
          </div>
          <input ref={radRef} type="file" className="hidden" accept=".rad"
            onChange={(e) => {
              if (e.target.files?.[0]) handleRadFile(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <FileWarning className="h-4 w-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {loaded && !errorMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>
            Loaded <strong>{scan.filename}</strong>
            {scan.size ? ` (${formatFileSize(scan.size)})` : ''}
          </span>
        </div>
      )}

      <div className="text-center">
        <button type="button" onClick={handleDemo}
          className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline">
          Or try a synthetic demo scan
        </button>
      </div>
    </div>
  );
}