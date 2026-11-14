import type { Env } from './types.js';
import { handleGet, handlePost, jsonError } from './handlers.js';

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function withCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN;

    if (url.pathname !== '/scores') {
      return withCors(jsonError(404, 'Not Found'), origin);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    let response: Response;
    if (request.method === 'GET') {
      response = await handleGet(request, env);
    } else if (request.method === 'POST') {
      response = await handlePost(request, env);
    } else {
      response = jsonError(405, 'Method Not Allowed');
    }

    return withCors(response, origin);
  },
};
