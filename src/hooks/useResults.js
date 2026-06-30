// AiG — useResults.js
// Persists detection + classification results in sessionStorage so they
// survive page navigations without needing to pass everything through
// location.state (which breaks on refresh).
//
// Consumed by: Detect.jsx, Classify.jsx, Cluster.jsx, Results.jsx
//
// Usage:
//   const { results, setResults, clearResults, addDetection, updateDetection } = useResults();

import { useState, useCallback } from 'react';

const STORAGE_KEY = 'aig_results';

function loadFromStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveToStorage(data) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
}

const DEFAULT_RESULTS = {
  scanId:      null,
  filename:    null,
  metadata:    null,
  velocity:    0.10,
  detections:  [],   // raw Detection[] from Detect.jsx
  classified:  [],   // ClassificationResult[] from Classify.jsx
  clustered:   [],   // ClassificationResult[] with clusterLabel from Cluster.jsx
};

export function useResults() {
  const [results, setResultsState] = useState(() => loadFromStorage() ?? { ...DEFAULT_RESULTS });

  const setResults = useCallback((patch) => {
    setResultsState((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      saveToStorage(next);
      return next;
    });
  }, []);

  const clearResults = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setResultsState({ ...DEFAULT_RESULTS });
  }, []);

  // Add a single detection (Detect.jsx uses this incrementally)
  const addDetection = useCallback((detection) => {
    setResults((prev) => ({
      ...prev,
      detections: [...prev.detections, detection],
    }));
  }, [setResults]);

  // Update one detection by id (Classify.jsx enriches each object)
  const updateDetection = useCallback((id, patch) => {
    setResults((prev) => ({
      ...prev,
      classified: prev.classified.map((d) =>
        d.id === id ? { ...d, ...patch } : d
      ),
    }));
  }, [setResults]);

  return { results, setResults, clearResults, addDetection, updateDetection };
}
