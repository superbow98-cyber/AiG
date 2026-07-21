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
    // xrf_material is GROUND TRUTH (confirmed by real pXRF reading / excavation),
    // not the AI's own guess. Results.jsx saves straight from Classify.jsx's
    // classifier output — there is no real-world confirmation at that point,
    // so this must stay null. Populating it with det.material here was copying
    // the AI's prediction into the "ground truth" field, which made
    // Validate.jsx compare the AI's guess against itself — always 100%
    // accuracy, never a real validation. Real ground truth only exists via
    // the human-confirmed §20 saveLabelledRecord() flow (ResNetSpatial /
    // XRFWorkspace / FusionEngine "Save labelled record" panels).
    xrf_material:     det.confirmed_material ?? null,
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

// ── training-labelled records (§20 training roadmap, Stage 1) ────────────────
// Distinct from detectionToRecord()/saveXrfRecord() above: those save an AI
// detection's own guess into `xrf_material` as if it were ground truth, which
// is fine for the Detection Lab review flow but useless (circular) as
// training data. This path requires an explicit HUMAN-CONFIRMED material,
// kept in its own field separate from whatever the AI predicted, so
// gpr_xrf_records rows saved here are safe to eventually fit
// fusionEngine.train() / gprOnlyHead / xrfOnlyHead against (§20 Stage 2).
//
// At least one of resnetEmbedding / xrfElements must be provided — a record
// with only one half is still valid training data for that head's "-only"
// classifier (gprOnlyHead or xrfOnlyHead), just not for the fusion head.
export async function saveLabelledRecord({
  groundTruthMaterial,       // required — human-confirmed, e.g. 'metal'
  resnetEmbedding = null,    // 128-D array/Float32Array or null
  xrfElements = null,        // { Fe: 12.3, Ca: 8.1, ... } or null
  aiPrediction = null,       // { label, confidence } — what the model guessed, kept separate from ground truth
  fusionScores = null,       // { fusion, gprOnly, xrfOnly } score dicts, optional
  isSynthetic = false,       // §24 — true only for deliberate demo/test data (e.g. §21 SYNTHETIC_DEMO_ files), never real field data
  ctx = {},                  // { datasetId, siteId, filename, artifactCategory }
}) {
  if (!groundTruthMaterial) {
    throw new Error('groundTruthMaterial is required — confirm the actual material before saving a training record.');
  }
  if (!resnetEmbedding && !xrfElements) {
    throw new Error('Need at least one of resnetEmbedding or xrfElements to save a training record.');
  }
  const user_id = await requireUserId();
  const resnetArr = resnetEmbedding ? Array.from(resnetEmbedding) : null;
  const row = {
    user_id,
    dataset_id: ctx.datasetId ?? null,
    site_id: ctx.siteId ?? null,
    scan_filename: ctx.filename ?? null,
    artifact_category: ctx.artifactCategory ?? null,
    gpr_features: resnetArr ? { vector: resnetArr, length: resnetArr.length, source: 'resnet18_embedding' } : null,
    xrf_features: xrfElements ?? null,
    fusion_output: fusionScores ?? null,
    xrf_material: groundTruthMaterial,          // ← ground truth, human-confirmed, NOT the AI's guess
    xrf_elements: xrfElements ?? null,
    ai_prediction: aiPrediction?.label ?? null, // ← AI's own guess, kept separate for later accuracy analysis
    confidence: aiPrediction?.confidence ?? null,
    predicted_material: aiPrediction?.label ?? null,
    predicted_confidence: aiPrediction?.confidence ?? null,
    is_synthetic: isSynthetic,                  // ← §24 — must be true for demo/test data, false for real field data
  };
  const { data, error } = await supabase.from('gpr_xrf_records').insert(row).select('id').single();
  return { data, error };
}

// Delete a saved record outright — for removing unusable/mislabelled/junk
// rows (e.g. the old pre-§20 'unknown' rows, or a synthetic row someone no
// longer needs) to keep gpr_xrf_records trustworthy as a training source.
// No soft-delete/undo — Database.jsx's Browse tab already confirms before
// calling this.
export async function deleteRecord(id) {
  const { error } = await supabase.from('gpr_xrf_records').delete().eq('id', id);
  return { error };
}

// List existing saved XRF readings (real, previously-confirmed samples) so a
// user can pair one with a NEW GPR/ResNet embedding instead of re-entering
// chemistry from scratch every time — e.g. reusing a known metal-artifact
// reading from earlier fieldwork. Only rows with actual xrf_elements are
// returned (rows saved without XRF, or the old 'unknown'-tagged junk rows,
// are excluded). Caller is responsible for confirming the picked reading
// genuinely corresponds to the same physical object as the GPR anomaly
// before treating any resulting fusion save as valid ground truth — see the
// warning in FusionEngine.jsx's save panel.
export async function listSavedXrfSamples(limit = 25) {
  const { data, error } = await supabase
    .from('gpr_xrf_records')
    .select('id, created_at, xrf_material, xrf_elements, scan_filename')
    .not('xrf_elements', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: data ?? [], error };
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

// ── direct messages (private 1:1 chat between accepted connections) ──────────
// Distinct from the dataset chat above: not scoped to a dataset, just a
// private conversation between two users. RLS (migration 004) only allows
// this between users with an 'accepted' row in user_connections — enforced
// server-side, not just hidden in the UI.
export async function listDirectMessages(otherUserId) {
  const me = await requireUserId();
  return supabase.from('direct_messages').select('*')
    .or(`and(sender_id.eq.${me},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${me})`)
    .order('created_at', { ascending: true });
}

export async function sendDirectMessage(otherUserId, body) {
  const sender_id = await requireUserId();
  return supabase.from('direct_messages').insert({ sender_id, recipient_id: otherUserId, body }).select().single();
}

// postgres_changes filters only support a single eq() condition, not an OR
// across two columns, so this subscribes broadly and filters client-side to
// just the messages between `myId` and `otherUserId`.
export function subscribeDirectMessages(myId, otherUserId, onInsert) {
  const channel = supabase
    .channel(`dm_${[myId, otherUserId].sort().join('_')}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'direct_messages' },
      (payload) => {
        const m = payload.new;
        const involvesUs =
          (m.sender_id === myId && m.recipient_id === otherUserId) ||
          (m.sender_id === otherUserId && m.recipient_id === myId);
        if (involvesUs) onInsert(m);
      })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// ── profile lookup by ids (for rendering connection/chat names) ──────────────
export async function getProfilesByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return { data: [], error: null };
  return supabase.from('profiles').select('id, email, display_name').in('id', unique);
}
