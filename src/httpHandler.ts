import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'

const API_BASE_URL = process.env.API_BASE_URL ?? 'https://your-project.vercel.app'
const API_KEY = process.env.API_KEY ?? ''

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

export function buildServer() {
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
    'find_recipes_by_ingredients',
    'Find recipes from the library that best utilize a list of ingredients you have on hand, ranked by actual ingredient coverage rather than thematic similarity. Reports which on-hand ingredients each recipe uses and what else you would need to buy.',
    {
      ingredients: z.array(z.string()).min(1).describe('Ingredients you have on hand, e.g. ["chicken breast", "broccoli", "garlic", "soy sauce"]'),
      limit: z.number().min(1).max(20).optional().default(5).describe('Max number of recipes to return'),
    },
    async ({ ingredients, limit }) => {
      const result = await apiRequest('POST', '/recipes/match-ingredients', { ingredients, limit })
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
    'get_recipe',
    'Fetch full details for a single recipe by id.',
    {
      id: z.string().uuid().describe('The recipe ID to fetch'),
    },
    async ({ id }) => {
      const result = await apiRequest('GET', `/recipes/${id}`)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  server.tool(
    'delete_recipe',
    'Permanently delete a recipe. This is a hard delete, not reversible, and also removes it from any meal plans it was scheduled in — confirm with the user before calling this.',
    {
      id: z.string().uuid().describe('The recipe ID to delete'),
    },
    async ({ id }) => {
      const result = await apiRequest('DELETE', `/recipes/${id}`)
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

  server.tool(
    'get_day_plan',
    'Get the recipes scheduled for a specific day, along with a shopping list for just that day\'s ingredients.',
    {
      date: z.string().describe('The date in YYYY-MM-DD format, e.g. "2026-07-06"'),
    },
    async ({ date }) => {
      const result = await apiRequest('GET', `/plans/day/${date}`)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  server.tool(
    'get_random_recipe',
    'Get a random recipe, optionally filtered by dietary tag, along with a shopping list for it.',
    {
      tag: z.string().optional().describe('Optional dietary tag to filter by, e.g. "vegan", "high_protein", "gluten_free"'),
    },
    async ({ tag }) => {
      const path = tag ? `/recipes/random?tag=${encodeURIComponent(tag)}` : '/recipes/random'
      const result = await apiRequest('GET', path)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  return server
}

// ─────────────────────────────────────────────
// Raw HTTP request handler — shared by the local
// PORT-based dev server and the Vercel-captured
// server (src/server.ts). Must receive untouched
// Node req/res so the MCP transport can read the
// JSON-RPC body itself.
// ─────────────────────────────────────────────

export async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

  // OAuth authorize — single-user personal server, so there's no real login
  // screen: immediately redirect back with a fixed code.
  if (req.url?.startsWith('/authorize')) {
    const url = new URL(req.url, `https://${req.headers.host}`)
    const redirectUri = url.searchParams.get('redirect_uri')
    const state = url.searchParams.get('state')

    if (!redirectUri) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid_request', error_description: 'missing redirect_uri' }))
      return
    }

    const redirect = new URL(redirectUri)
    redirect.searchParams.set('code', 'recipe-mcp-auth-code')
    if (state) redirect.searchParams.set('state', state)
    res.writeHead(302, { Location: redirect.toString() })
    res.end()
    return
  }

  // OAuth token exchange — always issues the same fixed token. There's no
  // per-user identity here; the real access control is the API_KEY the MCP
  // uses when calling the recipe API.
  if (req.url === '/token' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        access_token: 'recipe-mcp-access-token',
        token_type: 'Bearer',
        expires_in: 31536000,
      }))
    })
    return
  }

  if (req.url === '/mcp' || req.url?.startsWith('/mcp?')) {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      })
      const server = buildServer()
      await server.connect(transport)
      // Pass through any pre-parsed body (e.g. Vercel's /api helper already
      // consumes the stream and populates req.body) so the transport doesn't
      // try to read an already-drained stream.
      await transport.handleRequest(req, res, (req as IncomingMessage & { body?: unknown }).body)
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
}
