// AiG — Settings.jsx
// App-wide preferences — soil velocity, colormap, AI model, units, profile.
//
// Persists to localStorage under key 'aig_settings'.
// Other pages read settings via useSettings() hook (see bottom of this file —
// exported for convenience so no separate hook file needed).
//
// Consumed by: App.jsx (route /settings)
// Read by:     Preprocess.jsx, Visualise.jsx, Detect.jsx, Classify.jsx via useSettings()

import { useState, useEffect, createContext, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SOIL_VELOCITY_PRESETS } from '../utils/depthCalc';

// ── Settings context (consumed by other pages) ────────────────────────────────

export const SettingsContext = createContext(null);

export const DEFAULT_SETTINGS = {
  velocity:       0.10,     // m/ns
  colormap:       'seismic',
  defaultModel:   'ensemble',
  units:          'metric', // 'metric' | 'imperial'
};

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (ctx) return ctx;
  // Fallback: read directly from localStorage (for pages not wrapped in provider)
  try {
    const raw = localStorage.getItem('aig_settings');
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COLORMAPS     = ['seismic', 'grey', 'viridis', 'hot'];
const MODEL_OPTIONS = [
  { value: 'ensemble',           label: 'Ensemble (k-NN + Naïve Bayes)' },
  { value: 'knn',                label: 'k-NN only' },
  { value: 'naiveBayes',         label: 'Naïve Bayes' },
  { value: 'logisticRegression', label: 'Logistic Regression' },
  { value: 'svm',                label: 'SVM (linear)' },
  { value: 'decisionTree',       label: 'Decision Tree' },
];

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="bg-white border border-[#F0E9B8] rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-stone-600 border-b border-[#F0E9B8] pb-3">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-stone-700">{label}</p>
        {hint && <p className="text-xs text-stone-400 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate();

  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem('aig_settings');
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  });

  const [saved,    setSaved]    = useState(false);
  const [user,     setUser]     = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  // Load user
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user ?? null));
  }, []);

  // Auto-save on change
  useEffect(() => {
    try {
      localStorage.setItem('aig_settings', JSON.stringify(settings));
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 1500);
      return () => clearTimeout(t);
    } catch (_) {}
  }, [settings]);

  const set = (key, val) => setSettings((s) => ({ ...s, [key]: val }));

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    navigate('/');
  }

  function handleReset() {
    setSettings({ ...DEFAULT_SETTINGS });
  }

  // Velocity in imperial: 1 m/ns = 3.281 ft/ns
  const velDisplay = settings.units === 'imperial'
    ? `${(settings.velocity * 3.281).toFixed(3)} ft/ns`
    : `${settings.velocity.toFixed(3)} m/ns`;

  return (
    <div className="p-6 space-y-6 max-w-2xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-stone-800">Settings</h1>
        {saved && (
          <span className="text-xs text-[#C9971A] font-mono">✓ Saved</span>
        )}
      </div>

      {/* ── GPR Processing ── */}
      <Section title="GPR Processing">

        {/* Soil velocity */}
        <div className="space-y-3">
          <Row
            label="Soil velocity"
            hint="Affects depth calculations across all pages"
          >
            <span className="text-sm font-mono text-[#C9971A] w-28 text-right">
              {velDisplay}
            </span>
          </Row>
          <input
            type="range"
            min={0.06} max={0.16} step={0.001}
            value={settings.velocity}
            onChange={(e) => set('velocity', parseFloat(e.target.value))}
            className="w-full accent-[#C9971A]"
          />
          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(SOIL_VELOCITY_PRESETS).map(([name, vel]) => (
              <button
                key={name}
                onClick={() => set('velocity', vel)}
                className={`px-2.5 py-1 text-xs rounded-full capitalize transition-colors
                  ${Math.abs(settings.velocity - vel) < 0.0005
                    ? 'bg-[#C9971A] text-white'
                    : 'bg-[#F7F3D0] text-stone-500 hover:text-stone-900'}`}
              >
                {name} ({vel} m/ns)
              </button>
            ))}
          </div>

          {/* Malaysia tropical context note */}
          <div className="flex items-start gap-2 bg-[#F7F3D0] border border-[#E8DFA0] rounded-lg px-3 py-2">
            <span className="text-sm">🌴</span>
            <p className="text-xs text-stone-500 leading-relaxed">
              <span className="font-semibold text-stone-600">Tropical soil (Malaysia):</span> high
              moisture lowers radar velocity (~0.055 m/ns) and attenuates the signal — expect
              weaker, noisier B-scans. Lean on strong denoising (Background removal → PCA/ICA →
              Autoencoder) in Preprocess to recover targets.
            </p>
          </div>
        </div>

        {/* Default colormap */}
        <Row label="Default colormap" hint="Applied when opening B-scan viewer">
          <select
            value={settings.colormap}
            onChange={(e) => set('colormap', e.target.value)}
            className="bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 text-sm
                       rounded-lg px-3 py-1.5"
          >
            {COLORMAPS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Row>
      </Section>

      {/* ── AI Model ── */}
      <Section title="AI Classification">
        <Row
          label="Default classifier"
          hint="Used as default selection on Classify page"
        >
          <select
            value={settings.defaultModel}
            onChange={(e) => set('defaultModel', e.target.value)}
            className="bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 text-sm
                       rounded-lg px-3 py-1.5"
          >
            {MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Row>
      </Section>

      {/* ── Display ── */}
      <Section title="Display">
        <Row label="Units" hint="Affects depth and distance labels across all pages">
          <div className="flex rounded-lg overflow-hidden border border-[#E8DFA0]">
            {['metric', 'imperial'].map((u) => (
              <button
                key={u}
                onClick={() => set('units', u)}
                className={`px-4 py-1.5 text-sm font-semibold capitalize transition-colors
                  ${settings.units === u
                    ? 'bg-[#C9971A] text-white'
                    : 'bg-[#F7F3D0] text-stone-500 hover:text-stone-900'}`}
              >
                {u}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      {/* ── Profile ── */}
      <Section title="Profile">
        {user ? (
          <div className="space-y-3">
            <Row label="Email" hint="Signed in via Google">
              <span className="text-sm text-stone-600 font-mono">{user.email}</span>
            </Row>
            <Row label="User ID" hint="Supabase auth UID">
              <span className="text-xs text-stone-400 font-mono">
                {user.id.slice(0, 8)}…
              </span>
            </Row>
            <div className="pt-1">
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-stone-200
                           text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {signingOut ? 'Signing out…' : 'Sign Out'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-stone-400">Loading profile…</p>
        )}
      </Section>

      {/* ── Reset ── */}
      <div className="flex justify-end">
        <button
          onClick={handleReset}
          className="px-4 py-2 bg-[#F7F3D0] hover:bg-[#F0E9B8] text-stone-500
                     hover:text-stone-900 text-sm rounded-lg transition-colors"
        >
          Reset to defaults
        </button>
      </div>

    </div>
  );
}
