const localOrigins = new Set([
  "http://localhost:8848",
  "http://127.0.0.1:8848"
]);

function allowedOrigins(configured = Deno.env.get("APP_ALLOWED_ORIGINS")) {
  if (!configured) return localOrigins;
  return new Set(configured.split(",").map(origin => origin.trim()).filter(Boolean));
}

export function corsHeaders(request: Request, configuredOrigins?: string): HeadersInit {
  const origin = request.headers.get("origin");
  const allowed = allowedOrigins(configuredOrigins);

  return {
    "Access-Control-Allow-Origin": origin && allowed.has(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

export function jsonResponse(
  request: Request,
  status: number,
  body: unknown,
  configuredOrigins?: string
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, configuredOrigins),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export function handlePreflight(request: Request, configuredOrigins?: string): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response("ok", { headers: corsHeaders(request, configuredOrigins) });
}
