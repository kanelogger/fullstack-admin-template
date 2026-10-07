export function mergeProductStatus(previous, requested) {
  if (previous === "Fail" || requested === "Fail") return "Fail";
  return requested ?? previous ?? "Unknown";
}

export function isDebugCaptureActive(status) {
  const runs = Array.isArray(status?.runs) ? status.runs : [];
  const states = [status?.run?.state, status?.state, status?.capture?.state, ...runs.map(run => run?.state)];
  return states.some(state => state === "capturing" || state === "recording");
}

export function mergeBrowserPageVisited(previous, requested) {
  return previous === true || requested === true;
}
