function captureRuns(status) {
  const runs = Array.isArray(status?.runs) ? status.runs : [];
  return [...runs, status?.run, status?.capture].filter(run => run && typeof run === "object");
}

export function hasBrowserDebugCapture(status) {
  return captureRuns(status).some(run =>
    typeof run.id === "string" ||
    typeof run.run_id === "string" ||
    run.state === "capturing" ||
    run.state === "recording" ||
    run.state === "stopped"
  );
}

export function addRequiredEvidence(record, evidencePath) {
  record.requiredEvidence = [...new Set([...(record.requiredEvidence ?? []), evidencePath])];
}

export function enforceEvidenceGate(record) {
  if (record.productStatus === "Pass" && (record.evidenceStatus !== "Complete" || !record.browserPageVisited)) {
    record.productStatus = "Unknown";
    record.productReason = "BrowserSkill acceptance requires an inspected page and complete saved evidence";
  }
}

export function updateEvidenceState(record, presentEvidence, unknownReason, observedFailures = []) {
  const required = new Set(record.requiredEvidence ?? []);
  if (record.browserPageVisited) required.add("evidence/final.png");
  record.requiredEvidence = [...required];

  const present = new Set(presentEvidence);
  record.evidence = [...new Set([
    ...(record.evidence ?? []),
    ...[...required].filter(evidencePath => present.has(evidencePath))
  ])];

  const missing = [...required].filter(evidencePath => !present.has(evidencePath));
  let status;
  let failures = [...observedFailures];
  if (unknownReason) {
    status = "Unknown";
    failures.push(unknownReason);
  } else if (missing.length > 0) {
    status = "Incomplete";
    failures.push(...missing.map(evidencePath => `Required evidence is missing: ${evidencePath}`));
  } else if (required.size > 0) {
    status = "Complete";
  } else {
    status = "NotRequired";
  }

  const priorFailures = [...(record.evidenceFailures ?? []), ...observedFailures];
  if (status === "Complete" && priorFailures.length > 0) {
    record.evidenceHistory = [
      ...(record.evidenceHistory ?? []),
      { checkedAt: new Date().toISOString(), evidenceFailures: priorFailures }
    ];
  }
  record.evidenceFailures = [...new Set(status === "Complete" ? [] : [...priorFailures, ...failures])];
  record.evidenceStatus = status;
  enforceEvidenceGate(record);
  return status;
}
