import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from 'node:http'
import { z } from 'zod'

const API_BASE_URL = process.env.API_BASE_URL ?? 'https://your-project.vercel.app'
const API_KEY = process.env.API_KEY ?? ''
const PORT = process.env.PORT ? parseInt(process.env.PORT) : null

// ─────────────────────────────────────────────
// API helper
// ─────────────────────────────────────────────

async function apiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      `API error ${response.status}: ${JSON.stringify(data)}`
    )
  }

  return data
}

// ─────────────────────────────────────────────
// Build MCP server with all tools
// ─────────────────────────────────────────────

function buildServer() {
  const server = new McpServer({
    name: 'recipe-mcp',
    version: '1.0.0',
  })

  server.tool(
    'import_recipe_url',
    'Import a recipe from a URL. Fetches the page, extracts the recipe, estimates nutrition, and saves it to the library.',
    { url: z.string().url().describe('The URL of the recipe page to import') },
    async ({ url }) => {
      const result = await apiRequest('POST', '/recipes/import/url', { url })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  server.tool(
    'import_recipe_text',
    'Import a recipe from pasted text. Claude will extract and structure the recipe automatically.',
    { text: z.string().min(10).describe('Raw recipe text to parse and import') },
    async ({ text }) => {
      const result = await apiRequest('POST', '/recipes/import/text', { text })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  server.tool(
    'search_recipes',
    'Search recipes using semantic search. Supports filtering by rating, dietary tags, and excluding recently used recipes.',
    {
      query: z.string().describe('Natural language search query e.g. "quick high protein dinner"'),
      limit: z.number().min(1).max(20).optional().default(10).describe('Max results to return'),
      minRating: z.number().min(1).max(5).optional().describe('Minimum rating filter (1-5)'),
      dietaryTags: z.array(z.string()).optional().describe('Required dietary tags e.g. ["high_protein", "gluten_free"]'),
      excludeRecentDays: z.number().optional().describe('Exclude recipes used in meal plans in the last N days'),
    },
    async ({ query, limit, minRating, dietaryTags, excludeRecentDays }) => {
      const result = await apiRequest('POST', '/recipes/search', {
        query,
        limit,
        minRating,
        dietaryTags,
        excludeRecentDays,
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  server.tool(
    'list_recipes',
    'List all recipes in the library with basic details.',
    {},
    async () => {
      const result = await apiRequest('GET', '/recipes')
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  server.tool(
    'rate_recipe',
    'Rate a recipe from 1 to 5 stars with an optional note.',
    {
      id: z.string().uuid().describe('The recipe ID to rate'),
      rating: z.number().min(1).max(5).int().describe('Rating from 1 to 5'),
      note: z.string().optional().describe('Optional note e.g. "too spicy, reduce chili next time"'),
    },
    async ({ id, rating, note }) => {
      const result = await apiRequest('PATCH', `/recipes/${id}/rating`, {
        rating,
        note,
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  return server
}

// ─────────────────────────────────────────────
// Start — HTTP for Claude.ai, stdio for Claude Desktop
// ─────────────────────────────────────────────

if (PORT) {
  // HTTP transport — for Claude.ai web
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  })

  const server = buildServer()
  await server.connect(transport)

  const httpServer = createServer(async (req, res) => {
    // CORS headers — required for Claude.ai to connect
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    if (req.url === '/mcp' || req.url?.startsWith('/mcp?')) {
      await transport.handleRequest(req, res)
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  httpServer.listen(PORT, () => {
    console.error(`Recipe MCP server running on port ${PORT}`)
  })
} else {
  // Stdio transport — for Claude Desktop
  const server = buildServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Recipe MCP server running via stdio')
}