import { resolve } from "node:path";
import { readProfile } from "../services/capability.js";
import { isOllamaRunning } from "../services/ollama.js";
import { formatErrorEnvelope } from "../lib/format.js";
import { runIndex } from "../workflows/index.js";

export type McpResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export interface WithGuardsOptions {
  autoIndex?: boolean;
  operationName?: string;
  /** When true, skip the Ollama-running check (search_codebase uses keyword fallback when Ollama is down). */
  allowOllamaDown?: boolean;
}

/**
 * Wraps an MCP tool handler with profile + Ollama guards and optional auto-index retry.
 */
export function withGuards<T extends Record<string, unknown>>(
  handler: (args: T) => Promise<McpResult>,
  opts?: WithGuardsOptions,
): (args: T) => Promise<McpResult> {
  const op = opts?.operationName ?? "Operation";
  return async (args: T): Promise<McpResult> => {
    const profile = await readProfile();
    if (!profile) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatErrorEnvelope(
              "No capability profile found.",
              "Run 'brain-cache init' first.",
            ),
          },
        ],
      };
    }
    if (!opts?.allowOllamaDown) {
      const running = await isOllamaRunning();
      if (!running) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: formatErrorEnvelope(
                "Ollama is not running.",
                "Start it with 'ollama serve'.",
              ),
            },
          ],
        };
      }
    }
    try {
      return await handler(args);
    } catch (err) {
      if (
        opts?.autoIndex &&
        err instanceof Error &&
        err.message.includes("No index found") // DEBT-01: This string match is the implicit contract for auto-index trigger. See also: workflows that throw this error.
      ) {
        const resolvedPath = resolve(
          (args as Record<string, unknown>).path as string ?? ".",
        );
        await runIndex(resolvedPath);
        try {
          return await handler(args);
        } catch (retryErr) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: formatErrorEnvelope(
                  `${op} failed after auto-index: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
                ),
              },
            ],
          };
        }
      }
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatErrorEnvelope(
              `${op} failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          },
        ],
      };
    }
  };
}
