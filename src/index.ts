#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import express, { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { createServer } from "./server.js";

const config = loadConfig(process.env.CONFIG_PATH);

if (config.transport === "stdio") {
  startStdioServer(config);
} else {
  startHttpServer(config);
}

async function startStdioServer(config: Config): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();

  console.error("Apple Mail MCP server running on stdio");
  await server.connect(transport);
}

function startHttpServer(config: Config): void {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const app = express();
  app.use(express.json());

  function validateApiKey(
    req: Request,
    res: Response,
    next: () => void,
  ): void {
    const providedKey = req.params.apiKey;
    if (providedKey !== config.apiKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  // Streamable HTTP endpoint — handles POST, GET, DELETE
  app.post(
    "/:apiKey/mcp",
    validateApiKey,
    async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      // Existing session
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // New session — create transport and MCP server
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          console.log(`Session closed: ${transport.sessionId}`);
          transports.delete(transport.sessionId);
        }
      };

      const mcpServer = createServer(config);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
        console.log(`New session: ${transport.sessionId}`);
      }
    },
  );

  // GET for server-initiated SSE notifications stream
  app.get(
    "/:apiKey/mcp",
    validateApiKey,
    async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
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
      if (!sessionId || !transports.has(sessionId)) {
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
    console.log(`Apple Mail MCP server running on port ${config.port}`);
    console.log(
      `Endpoint: http://localhost:${config.port}/{apiKey}/mcp`,
    );
    if (basePath) {
      console.log(`External base path: ${basePath}`);
    }
  });

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    for (const transport of transports.values()) {
      await transport.close();
    }
    server.close();
    process.exit(0);
  });
}
