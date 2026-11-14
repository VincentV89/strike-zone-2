import type { Env, ScoreEntry } from './types.js';
import { ScoresStore } from './scores-store.js';
import { validateSubmitRequest } from './validation.js';

export async function handleGet(
  _request: Request,
  env: Env,
): Promise<Response> {
  const store = new ScoresStore(env.KV);
  const all = await store.readAll();
  const scores: ScoreEntry[] = all.slice(0, 10);
  return jsonResponse(200, { scores });
}

export async function handlePost(
  request: Request,
  env: Env,
): Promise<Response> {
  const rateLimitResult = await env.RATE_LIMITER.limit({
    key: request.headers.get('CF-Connecting-IP') ?? 'unknown',
  });
  if (!rateLimitResult.success) {
    return new Response(null, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const result = validateSubmitRequest(body);
  if (!result.ok) {
    return jsonError(400, result.error);
  }

  const store = new ScoresStore(env.KV);
  await store.insert(result.value);
  return new Response(null, { status: 201 });
}

export function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function jsonError(status: number, message: string): Response {
  return jsonResponse(status, { error: message });
}
