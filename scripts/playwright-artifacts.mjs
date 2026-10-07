const artifactSets = new Set(["mock", "local-auth", "visual", "adhoc"]);

export function playwrightArtifactDirectories(artifactSet) {
  if (!artifactSets.has(artifactSet)) {
    throw new Error(`Invalid Playwright artifact set: ${artifactSet}`);
  }
  return {
    outputDir: `test-results/${artifactSet}`,
    htmlReport: `playwright-report/${artifactSet}`
  };
}

export function playwrightArtifactEnvironment(environment, artifactSet) {
  playwrightArtifactDirectories(artifactSet);
  return { ...environment, PLAYWRIGHT_ARTIFACT_SET: artifactSet };
}
