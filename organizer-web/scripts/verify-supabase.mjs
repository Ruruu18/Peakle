import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(path.resolve(process.cwd(), ".."));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("Supabase public environment values are missing.");

const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, {
  headers: { apikey: anonKey },
});
if (!response.ok) throw new Error(`Supabase Auth health check failed with HTTP ${response.status}.`);

console.log("Supabase Auth is reachable.");
