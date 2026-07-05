import { createServer } from 'node:http'
import { handleHttpRequest } from './httpHandler.js'

// Vercel entrypoint — Vercel's zero-config Node.js detector looks for a file
// named server.{js,ts,...} (or app.*, index.*) at the project root or in src/
// and captures its listen() call as a Function, forwarding raw/untouched
// IncomingMessage/ServerResponse objects (no auto body-parsing), which the
// MCP transport needs. Must be the ONLY such candidate filename in the repo,
// or detection picks whichever one it scans first (see src/local.ts rename).
createServer(handleHttpRequest).listen(Number(process.env.PORT ?? 3000))
