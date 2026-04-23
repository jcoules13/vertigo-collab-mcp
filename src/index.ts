import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';

import { registerReservationTools } from './tools/reservations.js';
import { registerRdvTools } from './tools/rdvs.js';
import { registerDossierTools } from './tools/dossiers.js';
import { registerPermanenceTools } from './tools/permanences.js';
import { registerCollaborateurTools } from './tools/collaborateurs.js';
import { registerStatsTools } from './tools/stats.js';
import { registerExportTools } from './tools/export.js';

const API_KEY = process.env.MCP_API_KEY ?? '';
const PORT = parseInt(process.env.PORT ?? '3100');
export const ACTOR_ID = process.env.COLLAB_ACTOR_ID ?? '';

if (!API_KEY) {
  console.error('FATAL: MCP_API_KEY is not set');
  process.exit(1);
}
if (!ACTOR_ID) console.warn('WARN: COLLAB_ACTOR_ID not set — write operations will have no actor attribution');

function createServer(): McpServer {
  const server = new McpServer({
    name: 'vertigo-collab',
    version: '1.0.0',
  });
  registerReservationTools(server);
  registerRdvTools(server);
  registerDossierTools(server);
  registerPermanenceTools(server);
  registerCollaborateurTools(server);
  registerStatsTools(server);
  registerExportTools(server);
  return server;
}

const app = express();
app.use(express.json({ limit: '4mb' }));

// Auth middleware
app.use('/mcp', (req, res, next) => {
  const key = req.headers['x-api-key'] ?? req.headers['authorization']?.replace('Bearer ', '');
  if (key !== API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// Session store for Streamable HTTP
const sessions = new Map<string, StreamableHTTPServerTransport>();

// MCP POST — initialize or resume session
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    if (sessionId && sessions.has(sessionId)) {
      // Resume existing session
      const transport = sessions.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New session
      let transport: StreamableHTTPServerTransport;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => { sessions.set(id, transport); },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } else {
      res.status(400).json({ error: 'Missing or invalid session' });
    }
  } catch (err) {
    console.error('MCP POST error:', err);
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

// MCP GET — SSE stream for server-initiated messages
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: 'Unknown session' });
    return;
  }
  await sessions.get(sessionId)!.handleRequest(req, res);
});

// MCP DELETE — close session
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    await sessions.get(sessionId)!.close();
    sessions.delete(sessionId);
  }
  res.status(200).end();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'vertigo-collab-mcp', sessions: sessions.size });
});

app.listen(PORT, () => {
  console.log(`vertigo-collab-mcp listening on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
