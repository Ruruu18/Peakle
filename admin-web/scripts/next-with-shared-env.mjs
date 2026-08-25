import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(scriptDirectory, "..");
const repositoryDirectory = path.resolve(webDirectory, "..");

// Local admin builds share the Expo app's public Supabase project. Hosted
// builds can provide the standard NEXT_PUBLIC_* variables directly.
loadEnvConfig(repositoryDirectory);
process.env.NEXT_PUBLIC_SUPABASE_URL ||= process.env.EXPO_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("Pass a Next.js command such as dev, build, or start.");

const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, command, ...args], {
  cwd: webDirectory,
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
