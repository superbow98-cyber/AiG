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
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-300 border-b border-gray-700 pb-3">
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
        <p className="text-sm text-gray-200">{label}</p>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
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
        <h1 className="text-xl font-bold text-white">Settings</h1>
        {saved && (
          <span className="text-xs text-emerald-400 font-mono">✓ Saved</span>
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
            <span className="text-sm font-mono text-emerald-400 w-28 text-right">
              {velDisplay}
            </span>
          </Row>
          <input
            type="range"
            min={0.06} max={0.16} step={0.001}
            value={settings.velocity}
            onChange={(e) => set('velocity', parseFloat(e.target.value))}
            className="w-full accent-emerald-400"
          />
          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(SOIL_VELOCITY_PRESETS).map(([name, vel]) => (
              <button
                key={name}
                onClick={() => set('velocity', vel)}
                className={`px-2.5 py-1 text-xs rounded-full capitalize transition-colors
                  ${Math.abs(settings.velocity - vel) < 0.0005
                    ? 'bg-emerald-500 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white'}`}
              >
                {name} ({vel} m/ns)
              </button>
            ))}
          </div>
        </div>

        {/* Default colormap */}
        <Row label="Default colormap" hint="Applied when opening B-scan viewer">
          <select
            value={settings.colormap}
            onChange={(e) => set('colormap', e.target.value)}
            className="bg-gray-700 border border-gray-600 text-gray-200 text-sm
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
            className="bg-gray-700 border border-gray-600 text-gray-200 text-sm
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
          <div className="flex rounded-lg overflow-hidden border border-gray-600">
            {['metric', 'imperial'].map((u) => (
              <button
                key={u}
                onClick={() => set('units', u)}
                className={`px-4 py-1.5 text-sm font-semibold capitalize transition-colors
                  ${settings.units === u
                    ? 'bg-emerald-500 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white'}`}
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
              <span className="text-sm text-gray-300 font-mono">{user.email}</span>
            </Row>
            <Row label="User ID" hint="Supabase auth UID">
              <span className="text-xs text-gray-500 font-mono">
                {user.id.slice(0, 8)}…
              </span>
            </Row>
            <div className="pt-1">
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-gray-700
                           text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {signingOut ? 'Signing out…' : 'Sign Out'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Loading profile…</p>
        )}
      </Section>

      {/* ── Reset ── */}
      <div className="flex justify-end">
        <button
          onClick={handleReset}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-400
                     hover:text-white text-sm rounded-lg transition-colors"
        >
          Reset to defaults
        </button>
      </div>

    </div>
  );
}
