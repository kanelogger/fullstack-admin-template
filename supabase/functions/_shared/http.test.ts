import { corsHeaders, handlePreflight, jsonResponse } from "./http.ts";

const selectedOrigin = "http://127.0.0.1:57776";
const otherOrigin = "http://127.0.0.1:57777";
const allowedOrigins = selectedOrigin;

Deno.test("Edge CORS accepts the current dynamic Vite origin", () => {
  const request = new Request("http://127.0.0.1/functions/v1/session-login", {
    headers: { origin: selectedOrigin }
  });
  const responseOrigin = new Headers(corsHeaders(request, allowedOrigins)).get("Access-Control-Allow-Origin");
  if (responseOrigin !== selectedOrigin) throw new Error(`Expected dynamic origin, received ${responseOrigin}`);
});

Deno.test("Edge CORS rejects a different dynamic Vite origin", () => {
  const request = new Request("http://127.0.0.1/functions/v1/session-login", {
    headers: { origin: otherOrigin }
  });
  const responseOrigin = new Headers(corsHeaders(request, allowedOrigins)).get("Access-Control-Allow-Origin");
  if (responseOrigin !== "null") throw new Error(`Expected rejected origin, received ${responseOrigin}`);
});

Deno.test("JSON and preflight responses use the supplied origin list", () => {
  const request = new Request("http://127.0.0.1/functions/v1/session-login", {
    method: "OPTIONS",
    headers: { origin: selectedOrigin }
  });
  const preflight = handlePreflight(request, allowedOrigins);
  const response = jsonResponse(request, 200, { success: true }, allowedOrigins);
  if (!preflight || new Headers(preflight.headers).get("Access-Control-Allow-Origin") !== selectedOrigin) {
    throw new Error("Preflight did not use the selected dynamic origin");
  }
  if (response.headers.get("Access-Control-Allow-Origin") !== selectedOrigin) {
    throw new Error("JSON response did not use the selected dynamic origin");
  }
});
