import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const SupabaseClientConfigSchema = z.object({
  url: z.string().url(),
  publishableKey: z.string().min(1)
});

let supabaseClient: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const config = SupabaseClientConfigSchema.parse({
    url: import.meta.env.VITE_SUPABASE_URL,
    publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  });

  supabaseClient = createClient(config.url, config.publishableKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  return supabaseClient;
}

export function getSupabaseClientIfConfigured(): SupabaseClient | null {
  const result = SupabaseClientConfigSchema.safeParse({
    url: import.meta.env.VITE_SUPABASE_URL,
    publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  });
  return result.success ? getSupabaseClient() : null;
}
