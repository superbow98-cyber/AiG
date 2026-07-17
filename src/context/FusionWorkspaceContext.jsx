// AiG — FusionWorkspaceContext.jsx
//
// WHY THIS EXISTS
// ----------------
// ResNetSpatial.jsx and XRFWorkspace.jsx each `navigate('/fusion-engine', { state })`
// with ONLY their own half of the pipeline in the router state object. That's fine
// the first time you land on Fusion Engine — but the moment you leave it again to go
// fill in the *other* half (e.g. "Not loaded. Enter elements in XRF AI Workspace" ->
// XRF Workspace -> "Send to Fusion Engine"), FusionEngine.jsx unmounts. Its local
// useState is destroyed. When XRF Workspace navigates back with only
// { xrfEmbedding, elements } in state, FusionEngine.jsx remounts fresh and the
// previously-loaded ResNet embedding is gone — even though it was real, already
// computed, and the user never asked to discard it. That's the "why does it only
// fuse one" bug: each leg of the round trip silently drops the other leg.
//
// FIX
// ----
// Hold both embeddings (plus enough metadata to show provenance) in a context that
// lives above the router, backed by sessionStorage so it also survives a hard
// refresh. Both ResNetSpatial and XRFWorkspace write into this store *in addition
// to* their existing navigate(state) call (kept as-is so direct/standalone flows
// still work). FusionEngine reads from the store first and treats location.state
// as an incoming update to merge in, not a full replacement.

import { createContext, useContext, useState, useCallback } from 'react';

const STORAGE_KEY = 'aig.fusionWorkspace.v1';

const FusionWorkspaceContext = createContext(null);

function loadInitial() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { resnet: null, xrf: null };
    const parsed = JSON.parse(raw);
    return {
      resnet: parsed.resnet ?? null,
      xrf: parsed.xrf ?? null,
    };
  } catch {
    return { resnet: null, xrf: null };
  }
}

function persist(next) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // sessionStorage unavailable (e.g. private mode) — in-memory state still works
    // for the current mount, it just won't survive a hard refresh.
  }
}

export function FusionWorkspaceProvider({ children }) {
  const [store, setStore] = useState(loadInitial);

  // resnetData: { embedding: number[], patch?, patchSize?, detection?, scanId?, filename?, ... }
  const setResnet = useCallback((resnetData) => {
    setStore((prev) => {
      const next = { ...prev, resnet: resnetData };
      persist(next);
      return next;
    });
  }, []);

  // xrfData: { embedding: number[], elements?, ... }
  const setXrf = useCallback((xrfData) => {
    setStore((prev) => {
      const next = { ...prev, xrf: xrfData };
      persist(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    const next = { resnet: null, xrf: null };
    setStore(next);
    persist(next);
  }, []);

  return (
    <FusionWorkspaceContext.Provider value={{ ...store, setResnet, setXrf, clearAll }}>
      {children}
    </FusionWorkspaceContext.Provider>
  );
}

export function useFusionWorkspace() {
  const ctx = useContext(FusionWorkspaceContext);
  if (!ctx) {
    throw new Error('useFusionWorkspace must be used inside <FusionWorkspaceProvider>');
  }
  return ctx;
}
