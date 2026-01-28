/// <reference types="vite/client" />

declare namespace NodeJS {
  interface ProcessEnv {
    GEMINI_API_KEY: string;
    OPENAI_API_KEY: string;
    GEMINI_PAID_TIER: string;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
  }
}
