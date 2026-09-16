// Shared CORS handling for edge functions callable from a browser origin
// (organizer-web, admin-web). React Native callers are unaffected by CORS
// and ignore these headers, so it's safe to apply everywhere consistently.

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Call at the top of Deno.serve and return its result immediately if present.
export function handleCorsPreflight(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  return null;
}
