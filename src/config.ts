import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export type TransportMode = "stdio" | "http";

export interface Config {
  transport: TransportMode;
  port: number;
  apiKey: string;
  basePath?: string;
  defaultAccount?: string;
  maxResults: number;
  timeout: number;
  searchTimeout: number;
  draftMode: boolean;
  excludeMailboxes: string[];
}

const DEFAULT_CONFIG_PATH = "./config.json";

export function loadConfig(configPath?: string): Config {
  const resolvedPath = resolve(configPath || DEFAULT_CONFIG_PATH);

  if (!existsSync(resolvedPath)) {
    // No config file — return defaults (stdio mode)
    return applyDefaults({});
  }

  const raw = readFileSync(resolvedPath, "utf-8");
  const config = JSON.parse(raw) as Partial<Config>;
  return applyDefaults(config);
}

function applyDefaults(config: Partial<Config>): Config {
  // Transport mode — --stdio CLI arg overrides to stdio, otherwise default to http
  const transport: TransportMode = process.argv.includes("--stdio")
    ? "stdio"
    : "http";

  // Validate http-specific requirements
  if (transport === "http") {
    if (typeof config.port !== "number" || config.port <= 0) {
      throw new Error("Config must have a valid port number for HTTP mode");
    }
    if (typeof config.apiKey !== "string" || config.apiKey.length === 0) {
      throw new Error("Config must have a non-empty apiKey for HTTP mode");
    }

    // Normalize basePath: ensure leading slash, no trailing slash
    if (config.basePath) {
      let bp = config.basePath;
      if (!bp.startsWith("/")) bp = "/" + bp;
      if (bp.endsWith("/")) bp = bp.slice(0, -1);
      config.basePath = bp;
    }
  }

  return {
    transport,
    port: config.port || 0,
    apiKey: config.apiKey || "",
    basePath: config.basePath,
    defaultAccount: config.defaultAccount || process.env.MAIL_DEFAULT_ACCOUNT,
    maxResults: config.maxResults || 50,
    timeout: config.timeout || 30000,
    searchTimeout: config.searchTimeout || 60000,
    draftMode: config.draftMode ?? process.env.MAIL_DRAFT_MODE === "true",
    excludeMailboxes: config.excludeMailboxes || ["Junk", "Deleted Messages"],
  };
}
