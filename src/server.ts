import { createServer } from 'node:http'
import { handleHttpRequest } from './httpHandler.js'

// Vercel entrypoint — Vercel detects this `server.listen()` call and captures
// the server as a Function, forwarding raw/untouched IncomingMessage and
// ServerResponse objects (no auto body-parsing), which the MCP transport needs.
createServer(handleHttpRequest).listen(Number(process.env.PORT ?? 3000))
