import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validatePublicEnvironment } from "./public-env.mjs";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(scriptDirectory, "..");
const repositoryDirectory = path.resolve(webDirectory, "..");

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("Pass a Next.js command such as dev, build, or start.");
process.env.NODE_ENV ||= command === "dev" ? "development" : "production";

// Load portal values first, so the shared Expo fallback cannot overwrite the
// standalone deployment's configuration. Shell-provided values still win.
const portalEnvironment = { ...loadEnvConfig(webDirectory, command === "dev").combinedEnv };
// @next/env caches its first directory and resets process.env on a forced load.
// Restore the portal/shell values after loading the parent fallback.
loadEnvConfig(repositoryDirectory, command === "dev", console, true);
Object.assign(process.env, portalEnvironment);
process.env.NEXT_PUBLIC_SUPABASE_URL ||= process.env.EXPO_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (command === "build") validatePublicEnvironment(process.env);

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
