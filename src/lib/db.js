// AiG — db.js
// Centralised Supabase data-access helpers (additive — existing pages keep
// working). Fixes the "save shows success but DB stays empty" problem by:
//   • always attaching user_id (RLS requires auth.uid() = user_id)
//   • surfacing real errors instead of swallowing them
//   • blocking guest/unauthenticated writes with a clear message
//
// Every write returns { data, error } OR throws a descriptive Error — callers
// must check. Never report success without checking `error`.
import { supabase } from './supabase';

// ── auth helpers ─────────────────────────────────────────────────────────────
export async function getAuthUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

// Guests (local demo mode) have id === 'guest' — not a real DB user.
export function isRealUser(user) {
  return Boolean(user && user.id && user.id !== 'guest');
}

async function requireUserId() {
  const user = await getAuthUser();
  if (!isRealUser(user)) {
    throw new Error(
      'Cloud database needs a Google sign-in. You are in guest/demo mode, ' +
      'which is local only — sign in to save records.'
    );
  }
  return user.id;
}

// ── ids ──────────────────────────────────────────────────────────────────────
// Readable, sortable dataset id, e.g. "DS-LZ4F9A-7Q2".
export function makeDatasetId(prefix = 'DS') {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${t}-${r}`;
}

// ── profiles ─────────────────────────────────────────────────────────────────
export async function ensureProfile(user) {
  if (!isRealUser(user)) return;
  try {
    await supabase.from('profiles').upsert(
      { id: user.id, email: user.email, display_name: (user.email || '').split('@')[0] },
      { onConflict: 'id' }
    );
  } catch (_) { /* non-fatal */ }
}

export async function searchProfiles(query) {
  const q = (query || '').trim();
  if (!q) return { data: [], error: null };
  return supabase
    .from('profiles')
    .select('id, email, display_name')
    .or(`email.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(15);
}

// ── datasets ─────────────────────────────────────────────────────────────────
export async function createDataset({ datasetId, siteId, title, artifactCategory, visibility = 'private' }) {
  const user_id = await requireUserId();
  const dataset_id = datasetId || makeDatasetId();
  const { data, error } = await supabase
    .from('datasets')
    .insert({ dataset_id, user_id, site_id: siteId ?? null, title: title ?? null,
              artifact_category: artifactCategory ?? null, visibility })
    .select()
    .single();
  return { data, error, dataset_id };
}

export async function listDatasets() {
  return supabase.from('datasets').select('*').order('created_at', { ascending: false });
}

export async function setDatasetVisibility(datasetId, visibility) {
  return supabase.from('datasets').update({ visibility }).eq('dataset_id', datasetId);
}

// ── GPR+XRF records ──────────────────────────────────────────────────────────
// Map a ClassificationResult (+ context) to a gpr_xrf_records row, including the
// AI-fusion fields (GPR features, XRF features, fusion output).
export function detectionToRecord(det, ctx = {}) {
  const features = det.features ? Array.from(det.features) : null;
  return {
    dataset_id:       ctx.datasetId ?? null,
    site_id:          ctx.siteId ?? null,
    material_id:      det.material_id ?? null,
    artifact_category: ctx.artifactCategory ?? det.artifact_category ?? null,
    scan_filename:    ctx.filename ?? null,
    gpr_signature:    features,
    gpr_features:     features ? { vector: features, length: features.length } : null,
    xrf_features:     det.xrf_elements ?? null,
    fusion_output:    { scores: det.scores ?? null, top_matches: det.top_matches ?? null },
    hyperbola_shape:  det.hyperbola ?? null,
    position_trace:   det.trace ?? null,
    position_m:       det.position_m ?? null,
    depth_ns:         det.depth_ns ?? null,
    depth_m:          det.depth_m ?? null,
    size_width_cm:    det.size_width_cm ?? null,
    size_height_cm:   det.size_height_cm ?? null,
    xrf_material:     det.material ?? det.label ?? null,
    xrf_elements:     det.xrf_elements ?? null,
    ai_prediction:    det.material ?? det.label ?? null,
    predicted_material: det.material ?? det.label ?? null,
    confidence:       det.confidence ?? null,
    predicted_confidence: det.confidence ?? null,
  };
}

// Save many detections as one batch insert. Returns { data, error, count }.
export async function saveXrfRecords(detections, ctx = {}) {
  const user_id = await requireUserId();
  const rows = detections.map((d) => ({ ...detectionToRecord(d, ctx), user_id }));
  const { data, error } = await supabase.from('gpr_xrf_records').insert(rows).select('id');
  return { data, error, count: data?.length ?? 0 };
}

export async function saveXrfRecord(det, ctx = {}) {
  const user_id = await requireUserId();
  const { data, error } = await supabase
    .from('gpr_xrf_records')
    .insert({ ...detectionToRecord(det, ctx), user_id })
    .select('id')
    .single();
  return { data, error };
}

// ── connections ──────────────────────────────────────────────────────────────
export async function sendConnection(addresseeId) {
  const requester_id = await requireUserId();
  if (requester_id === addresseeId) return { error: new Error('You cannot connect to yourself.') };
  return supabase.from('user_connections')
    .insert({ requester_id, addressee_id: addresseeId, status: 'pending' })
    .select().single();
}

export async function acceptConnection(id) {
  return supabase.from('user_connections').update({ status: 'accepted' }).eq('id', id).select().single();
}

export async function listConnections() {
  const user = await getAuthUser();
  if (!isRealUser(user)) return { incoming: [], outgoing: [], accepted: [], me: null };
  const { data } = await supabase.from('user_connections').select('*');
  const rows = data ?? [];
  return {
    me: user.id,
    incoming: rows.filter((r) => r.addressee_id === user.id && r.status === 'pending'),
    outgoing: rows.filter((r) => r.requester_id === user.id && r.status === 'pending'),
    accepted: rows.filter((r) => r.status === 'accepted'),
  };
}

// ── dataset chat ─────────────────────────────────────────────────────────────
export async function listMessages(datasetId) {
  return supabase.from('dataset_messages').select('*').eq('dataset_id', datasetId)
    .order('created_at', { ascending: true });
}

export async function sendMessage(datasetId, body) {
  const user_id = await requireUserId();
  return supabase.from('dataset_messages').insert({ dataset_id: datasetId, user_id, body }).select().single();
}

export function subscribeMessages(datasetId, onInsert) {
  const channel = supabase
    .channel(`dataset_chat_${datasetId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'dataset_messages', filter: `dataset_id=eq.${datasetId}` },
      (payload) => onInsert(payload.new))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// ── profile lookup by ids (for rendering connection/chat names) ──────────────
export async function getProfilesByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return { data: [], error: null };
  return supabase.from('profiles').select('id, email, display_name').in('id', unique);
}
