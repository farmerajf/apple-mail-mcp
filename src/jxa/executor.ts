import { execFile } from "node:child_process";
import type { JXAResult } from "../types.js";

/**
 * Execute a JXA script via osascript and return parsed JSON output.
 *
 * All JXA scripts are expected to JSON.stringify their output.
 * Arguments are passed as a JSON string via the __args env var.
 */
export async function executeJXA<T>(
  script: string,
  args?: Record<string, unknown>,
  timeoutMs: number = 60000,
): Promise<JXAResult<T>> {
  return new Promise((resolve) => {
    const env: Record<string, string> = { ...process.env } as Record<
      string,
      string
    >;
    if (args) {
      env.__args = JSON.stringify(args).replace(/\0/g, "");
    }

    // Strip null bytes from script — osascript chokes on them
    const safeScript = script.replace(/\0/g, "");

    const child = execFile(
      "osascript",
      ["-l", "JavaScript", "-e", safeScript],
      {
        env,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      },
      (error, stdout, stderr) => {
        if (error) {
          // Check for timeout
          if (error.killed || error.code === "ETIMEDOUT") {
            resolve({ success: false, error: "Script execution timed out" });
            return;
          }

          // Check for common errors
          const errMsg = stderr || error.message;
          if (errMsg.includes("not running")) {
            resolve({
              success: false,
              error:
                "Mail.app is not running. It will be launched automatically on next attempt.",
            });
            return;
          }
          if (
            errMsg.includes("not allowed") ||
            errMsg.includes("permission")
          ) {
            resolve({
              success: false,
              error:
                "Automation permission denied. Enable in System Settings → Privacy & Security → Automation.",
            });
            return;
          }

          resolve({
            success: false,
            error: errMsg || "Unknown JXA error",
          });
          return;
        }

        const output = stdout.trim();
        if (!output) {
          resolve({ success: true, data: undefined });
          return;
        }

        try {
          const data = JSON.parse(output) as T;
          resolve({ success: true, data });
        } catch {
          resolve({
            success: false,
            error: `Failed to parse JXA output: ${output.slice(0, 200)}`,
          });
        }
      },
    );

    // Safety: ensure child process is killed on timeout
    child.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}
