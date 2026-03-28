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

  server.tool(
    'create_meal_plan',
    'Generate a meal plan for a given number of days. Searches your recipe library and assigns recipes to breakfast, lunch, dinner, and snack slots. If an overlapping active plan exists you will be warned and asked to confirm before replacing it.',
    {
      days: z.number().min(1).max(14).optional().default(7).describe('Number of days to plan for'),
      name: z.string().optional().describe('Name for the meal plan e.g. "Week of March 25"'),
      slots: z.array(z.enum(['breakfast', 'lunch', 'dinner', 'snack'])).optional().default(['breakfast', 'lunch', 'dinner']).describe('Meal slots to fill each day'),
      force: z.boolean().optional().default(false).describe('Set to true to replace overlapping active plans without warning'),
      constraints: z.object({
        dietaryTags: z.array(z.string()).optional().describe('Required dietary tags e.g. ["high_protein", "vegetarian"]'),
        excludeIngredients: z.array(z.string()).optional().describe('Ingredients to avoid e.g. ["nuts", "shellfish"]'),
        maxCaloriesPerDay: z.number().optional().describe('Maximum calories per day'),
        minRating: z.number().min(1).max(5).optional().describe('Only include recipes rated this or higher'),
        excludeRecentDays: z.number().optional().default(14).describe('Exclude recipes used in the last N days'),
      }).optional().describe('Constraints for the meal plan'),
    },
    async ({ days, name, slots, force, constraints }) => {
      const result = await apiRequest('POST', '/plans', {
        days,
        name,
        slots,
        force,
        constraints,
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  server.tool(
    'list_meal_plans',
    'List all active meal plans with their date ranges. Use this to find a specific plan by date — e.g. "this week" or "next 3 days" — before generating a shopping list or viewing plan details.',
    {},
    async () => {
      const result = await apiRequest('GET', '/plans')
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  server.tool(
    'delete_meal_plan',
    'Soft delete a meal plan. The plan is marked as deleted and deactivated but kept for history.',
    {
      mealPlanId: z.string().uuid().describe('The meal plan ID to delete'),
    },
    async ({ mealPlanId }) => {
      const result = await apiRequest('DELETE', `/plans/${mealPlanId}`)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  server.tool(
    'generate_shopping_list',
    'Generate a categorized shopping list from a meal plan. Groups ingredients by category (produce, dairy, meat etc.) and shows which recipes each ingredient is used in.',
    {
      mealPlanId: z.string().uuid().describe('The meal plan ID to generate a shopping list for'),
    },
    async ({ mealPlanId }) => {
      const result = await apiRequest('POST', `/plans/${mealPlanId}/shopping-list`)
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
  // Stateless pattern: create a new transport per request
  const httpServer = createServer(async (req, res) => {
    // CORS headers
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

    // OAuth dynamic client registration — required by Claude.ai
    if (req.url === '/register' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        const clientInfo = {
          client_id: 'recipe-mcp-client',
          client_secret: 'not-used',
          redirect_uris: [],
          grant_types: ['authorization_code'],
          token_endpoint_auth_method: 'none',
        }
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(clientInfo))
      })
      return
    }

    // OAuth authorization server metadata
    if (req.url === '/.well-known/oauth-authorization-server') {
      const metadata = {
        issuer: `https://${req.headers.host}`,
        authorization_endpoint: `https://${req.headers.host}/authorize`,
        token_endpoint: `https://${req.headers.host}/token`,
        registration_endpoint: `https://${req.headers.host}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(metadata))
      return
    }

    if (req.url === '/mcp' || req.url?.startsWith('/mcp?')) {
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless
        })
        const server = buildServer()
        await server.connect(transport)
        await transport.handleRequest(req, res)
        res.on('close', () => server.close())
      } catch (err) {
        console.error('MCP request error:', err)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      }
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

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