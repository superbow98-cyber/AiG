// AiG — Supabase Client
// Initialises Supabase for Google OAuth login + the GPR+XRF reference database.
//
// Configure your project by creating a `.env` file (copy from .env.example):
//   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
//   VITE_SUPABASE_ANON_KEY=your-anon-key-here
//
// If the env vars are missing, the app still boots (e.g. for Guest / demo mode)
// — only the cloud features (login, save scans, save XRF records) are disabled.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    '[AiG] Supabase env vars not set — running without cloud features. ' +
      'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to a .env file to enable ' +
      'Google login and the GPR+XRF database.'
  );
}

// Fall back to harmless placeholders so createClient() never throws at import
// time; any auth/db call will simply fail and is handled gracefully in the UI.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'public-anon-placeholder-key'
);
