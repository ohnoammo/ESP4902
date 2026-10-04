import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Configured from .env (see .env.example). Only the publishable key ever goes in the app.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = !!url && !!key;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !key) {
    throw new Error('Supabase is not configured. Copy .env.example to .env and restart the dev server.');
  }
  // No sign-in: the app uses the anon role, so there is no session to store or refresh.
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
