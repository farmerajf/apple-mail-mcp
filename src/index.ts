#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import express, { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { createServer } from "./server.js";

const config = loadConfig(process.env.CONFIG_PATH);
console.log(`[server] Config loaded (transport: ${config.transport})`);

if (config.transport === "stdio") {
  startStdioServer(config);
} else {
  startHttpServer(config);
}

async function startStdioServer(config: Config): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();

  console.log("[server] Starting in stdio mode");
  await server.connect(transport);
}

function startHttpServer(config: Config): void {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const app = express();
  app.use((req, _res, next) => {
    console.log(`[http] --> ${req.method} ${req.path} from ${req.ip}`);
    next();
  });
  app.use(express.json());

  function validateApiKey(
    req: Request,
    res: Response,
    next: () => void,
  ): void {
    const providedKey = req.params.apiKey;
    if (providedKey !== config.apiKey) {
      console.warn(`[http] Unauthorized request from ${req.ip}: invalid API key`);
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  // Streamable HTTP endpoint - handles POST, GET, DELETE
  app.post(
    "/:apiKey/mcp",
    validateApiKey,
    async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      console.log(`[http] POST /mcp session=${sessionId ?? "none"} (active sessions: ${transports.size})`);

      // Existing session
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Stale session ID - tell client to re-initialize
      if (sessionId) {
        console.warn(`[http] POST with stale session: ${sessionId}, returning 404`);
        res.status(404).json({ error: "Session not found" });
        return;
      }

      // New session - create transport and MCP server
      console.log("[http] Creating new session");
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          console.log(`[http] Session closed: ${transport.sessionId} (active: ${transports.size - 1})`);
          transports.delete(transport.sessionId);
        }
      };

      const mcpServer = createServer(config);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
        console.log(`[http] Session initialized: ${transport.sessionId} (active: ${transports.size})`);
      }
    },
  );

  // GET for server-initiated SSE notifications stream
  app.get(
    "/:apiKey/mcp",
    validateApiKey,
    async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      console.log(`[http] GET /mcp session=${sessionId ?? "none"}`);
      if (!sessionId || !transports.has(sessionId)) {
        console.warn(`[http] GET with unknown/missing session: ${sessionId ?? "none"}`);
        res.status(400).json({ error: "Invalid or missing session ID" });
        return;
      }
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    },
  );

  // DELETE to terminate session
  app.delete(
    "/:apiKey/mcp",
    validateApiKey,
    async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      console.log(`[http] DELETE /mcp session=${sessionId ?? "none"}`);
      if (!sessionId || !transports.has(sessionId)) {
        console.warn(`[http] DELETE for unknown session: ${sessionId ?? "none"}`);
        res.status(400).json({ error: "Invalid or missing session ID" });
        return;
      }
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    },
  );

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  const basePath = config.basePath || "";
  const server = app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
    console.log(`[server] MCP endpoint: http://localhost:${config.port}/{apiKey}/mcp`);
    if (basePath) {
      console.log(`[server] External base path: ${basePath}`);
    }
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[server] Port ${config.port} is already in use`);
    } else {
      console.error(`[server] Failed to start: ${err.message}`);
    }
    process.exit(1);
  });

  process.on("SIGINT", async () => {
    console.log(`[server] Shutting down (SIGINT), closing ${transports.size} session(s)...`);
    for (const transport of transports.values()) {
      await transport.close();
    }
    server.close();
    process.exit(0);
  });
}
