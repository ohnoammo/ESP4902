import { createDemoBackend } from './demoBackend';
import { createSupabaseBackend } from './supabaseBackend';
import { Backend } from './types';
import { AppMode } from '../types';

// Live mode talks to the real device through Supabase; demo mode uses the built-in simulation.
export function createBackend(mode: AppMode): Backend {
  return mode === 'live' ? createSupabaseBackend() : createDemoBackend();
}

export * from './types';
