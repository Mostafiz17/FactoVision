import { loadEnvConfig } from "@next/env";

/** Match `next start` by default; explicit development mode matches `next dev`.
 * Existing process variables retain precedence. Never log parsed file contents.
 */
export function loadScriptEnv(directory = process.cwd()) {
  let failed = false;
  const result = loadEnvConfig(directory, process.env.NODE_ENV === "development", {
    info: () => undefined,
    error: () => { failed = true; },
  });
  if (failed) throw new Error("Unable to load a project environment file; check its syntax and file permissions.");
  return result.loadedEnvFiles.map((file) => file.path);
}
