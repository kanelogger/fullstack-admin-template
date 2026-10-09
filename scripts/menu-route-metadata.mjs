import assert from "node:assert/strict";

const registryBlockPattern = /export const menuRouteRegistry\s*=\s*\{([\s\S]*?)\}\s*satisfies/;
const metadataBlockPattern = /export const registeredMenuRoutes:[\s\S]*?=\s*\[([\s\S]*?)\];/;

function capture(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `Could not read ${label}`);
  return match[1];
}

/**
 * RouteKey → lazy component specifier.
 * Tolerates wrapped lines, so `pnpm format` may reflow the registry freely.
 */
export function parseMenuRouteRegistry(source) {
  const block = capture(source, registryBlockPattern, "menuRouteRegistry");
  return [...block.matchAll(/"([^"]+)"\s*:\s*\(\)\s*=>\s*import\(\s*"([^"]+)"\s*\)/g)].map(
    match => ({ routeKey: match[1], specifier: match[2] })
  );
}

/**
 * Registered menu metadata, parsed per entry instead of per line:
 * field order, indentation and line wrapping are formatting details.
 */
export function parseRegisteredMenuRoutes(source) {
  const block = capture(source, metadataBlockPattern, "registeredMenuRoutes");
  const entries = block.split(/routeKey\s*:/).slice(1).map(segment => ({
    routeKey: capture(segment, /^\s*"([^"]+)"/, "registered routeKey"),
    label: capture(segment, /label\s*:\s*"([^"]+)"/, "registered label"),
    defaultPath: capture(segment, /defaultPath\s*:\s*"([^"]+)"/, "registered defaultPath"),
    requiredPermissionKey: capture(
      segment,
      /requiredPermissionKey\s*:\s*"([^"]+)"/,
      "registered requiredPermissionKey"
    )
  }));
  assert.ok(entries.length > 0, "registeredMenuRoutes must declare at least one route");
  return entries;
}
