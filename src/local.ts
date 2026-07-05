import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from 'node:http'
import { buildServer, handleHttpRequest } from './httpHandler.js'

const PORT = process.env.PORT ? parseInt(process.env.PORT) : null

// ─────────────────────────────────────────────
// Start — HTTP for local testing / Procfile hosts, stdio for Claude Desktop
// ─────────────────────────────────────────────

if (PORT) {
  const httpServer = createServer(handleHttpRequest)
  httpServer.listen(PORT, () => {
    console.log(`Recipe MCP server running on port ${PORT}`)
  })
} else {
  // Stdio transport — for Claude Desktop
  const server = buildServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Recipe MCP server running via stdio')
}
