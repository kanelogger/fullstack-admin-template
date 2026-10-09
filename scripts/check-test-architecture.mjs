import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  loadArchitectureRules,
  parsePlaywrightTestCases,
  suiteInputSha256,
  summarizeInputs,
  validateAssertionCoverage
} from "./test-architecture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

export const CHECK_TEST_ARCHITECTURE_MODES = Object.freeze(["ci", "acceptance"]);

export function parseCheckTestArchitectureArgs(argv = process.argv.slice(2)) {
  const args = argv.filter(value => value !== "--");
  let mode = "ci";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mode") {
      const value = args[index + 1];
      if (!CHECK_TEST_ARCHITECTURE_MODES.includes(value)) {
        throw new Error(`--mode must be one of ${CHECK_TEST_ARCHITECTURE_MODES.join(", ")}`);
      }
      mode = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { mode };
}

export async function checkTestArchitecture(repositoryRoot = root, options = {}) {
  const mode = options.mode === "acceptance" ? "acceptance" : "ci";
  const requireFreshEvidence = mode === "acceptance";
  const { rules } = await loadArchitectureRules(repositoryRoot);
  const assertionManifest = JSON.parse(await readFile(join(repositoryRoot, "scripts/test-architecture-assertions.json"), "utf8"));
  const currentSummary = requireFreshEvidence ? await summarizeInputs(repositoryRoot, "browser") : null;
  const suiteInputDigests = requireFreshEvidence
    ? Object.fromEntries(await Promise.all(["pnpm test:unit", "pnpm test:browser"].map(async suite => [
      suite,
      await suiteInputSha256(repositoryRoot, suite, rules)
    ])))
    : {};
  const frontendE2e = join(repositoryRoot, "frontend/e2e");
  const files = (await readdir(frontendE2e)).filter(path => path.endsWith(".spec.ts")).sort();
  const active = [...rules.allowedPlaywrightSpecs].sort();
  const retiredPaths = Array.isArray(assertionManifest.retiredPaths) ? assertionManifest.retiredPaths : [];
  const retiredPathSet = new Set(retiredPaths);
  const retiringPaths = rules.retiringPaths.filter(path => !retiredPathSet.has(path));
  const retired = rules.retiringPaths.filter(path => retiredPathSet.has(path)).map(path => basename(path)).sort();
  const retiring = retiringPaths.map(path => basename(path)).sort();
  const registered = [...new Set([...active, ...retiring])].sort();
  const errors = [];
  let managementDrift = [];

  if (registered.length !== active.length + retiring.length) errors.push("Playwright allowlist and retiring registry contain duplicate spec names");
  for (const file of files) if (!registered.includes(file)) errors.push(`Playwright spec is outside the active allowlist and retirement registry: ${file}`);
  for (const file of registered) if (!files.includes(file)) errors.push(`Registered Playwright spec is missing: ${file}`);
  for (const path of retiredPaths) if (files.includes(basename(path))) errors.push(`Retired Playwright spec still exists: ${path}`);
  if (retiredPathSet.size !== retiredPaths.length || retiredPaths.some(path => !rules.retiringPaths.includes(path))) {
    errors.push("Retired assertion paths must be unique members of the retirement registry");
  }

  const config = await readFile(join(repositoryRoot, "frontend/playwright.config.ts"), "utf8");
  if (!config.includes("testMatch:")) errors.push("Playwright projects must declare explicit testMatch allowlists");
  if (/testMatch\s*:\s*["'`]\*\*\/\*\.spec\.ts/.test(config)) errors.push("Playwright config contains a broad spec wildcard");
  for (const file of active) if (!config.includes(file)) errors.push(`Active spec is absent from Playwright project allowlists: ${file}`);
  for (const file of retiring) if (config.includes(file)) errors.push(`Retiring spec must stay outside Playwright project allowlists: ${file}`);

  const packageManifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  for (const name of ["test:e2e:mock", "test:e2e:local"]) {
    if (Object.hasOwn(packageManifest.scripts ?? {}, name)) errors.push(`Retired command remains in the root workspace scripts: ${name}`);
  }
  if (Object.values(packageManifest.scripts ?? {}).some(command => /(?:test:e2e|\*-smoke\.spec)/.test(command))) {
    errors.push("A root script still references the retired broad E2E entrypoint or smoke specs");
  }
  const workflow = await readFile(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  for (const required of ["pnpm check:test-architecture", "pnpm test:browser", "pnpm test:visual"]) {
    if (!workflow.includes(required)) errors.push(`CI does not run required test architecture gate: ${required}`);
  }
  if (workflow.includes("pnpm check:test-architecture:acceptance") || /check:test-architecture[^\n]*--mode\s+acceptance/.test(workflow)) {
    errors.push("CI must not run the BrowserSkill acceptance evidence gate");
  }
  if (/pnpm\s+test:visual:update|pnpm\s+test:visual:accept/.test(workflow)) {
    errors.push("CI must compare visual baselines without generating or accepting candidates");
  }

  if (assertionManifest.schemaVersion !== 2 || !Array.isArray(assertionManifest.files) || !Array.isArray(assertionManifest.cases)) {
    errors.push("Assertion retirement manifest is invalid or lacks per-assertion records");
  } else {
    const verification = assertionManifest.verification ?? {};
    if (!/^[0-9a-f]{40}$/i.test(assertionManifest.sourceCommit ?? "")) {
      errors.push("Assertion retirement manifest must pin the historical source commit");
    }
    if (requireFreshEvidence) {
      if (verification.productInputSha256 !== currentSummary.productInputSha256) errors.push("Assertion verification product digest is stale");
      if (verification.scenarioInputSha256 !== currentSummary.scenarioInputSha256) errors.push("Assertion verification scenario-input digest is stale");
      managementDrift = verification.managementInputSha256 === currentSummary.managementInputSha256
        ? []
        : ["Acceptance scripts or ledgers changed after the recorded verification snapshot"];
      for (const suite of ["pnpm test:unit", "pnpm test:browser"]) {
        const result = verification.suites?.[suite];
        const suiteDigest = suiteInputDigests[suite];
        if (result?.status !== "Pass" || result.productInputSha256 !== currentSummary.productInputSha256 ||
            result.inputSha256 !== suiteDigest) {
          errors.push(`Assertion verification suite is missing a current passing result: ${suite}`);
        }
      }
      for (const scenario of Object.keys(rules.scenarios)) {
        const result = verification.browserReports?.[scenario];
        if (!result?.runId || result.status !== "Pass" ||
            result.productInputSha256 !== currentSummary.productInputSha256 ||
            result.scenarioInputSha256 !== currentSummary.scenarioInputSha256) {
          errors.push(`Assertion verification is missing a passing current-source BrowserSkill report: ${scenario}`);
        }
      }
    } else if (verification.gate !== "acceptance-only") {
      errors.push("Assertion verification archive must declare gate=acceptance-only so CI cannot treat it as current evidence");
    }

    const sourcePaths = new Set(rules.retiringPaths);
    if (assertionManifest.files.length !== sourcePaths.size ||
        assertionManifest.files.some(entry => !sourcePaths.has(entry.path))) {
      errors.push("Assertion manifest has stale or unregistered source files");
    }
    for (const path of rules.retiringPaths) {
      const isRetired = retiredPathSet.has(path);
      const fileManifest = assertionManifest.files.find(entry => entry.path === path);
      const mappedCases = assertionManifest.cases.filter(entry => entry.path === path);
      if (isRetired && files.includes(basename(path))) errors.push(`Retired Playwright spec still exists: ${path}`);
      if (!isRetired && !files.includes(basename(path))) errors.push(`Retiring Playwright spec is missing: ${path}`);

      if (!fileManifest || !/^[0-9a-f]{64}$/.test(fileManifest.sha256)) {
        errors.push(`${path}: reviewed source digest is missing or invalid`);
      }
      let source = null;
      if (!isRetired) {
        try { source = await readFile(join(repositoryRoot, path), "utf8"); } catch (error) {
          errors.push(`${path}: retiring source cannot be read (${error.message})`);
          continue;
        }
        const sourceSha256 = createHash("sha256").update(source).digest("hex");
        if (fileManifest?.sha256 !== sourceSha256) errors.push(`${path}: source digest does not match its reviewed retirement record`);
      }
      const actualCases = source ? parsePlaywrightTestCases(source) : null;
      const actualNames = actualCases?.map(testCase => testCase.name) ?? [];
      const mappedNames = mappedCases.map(entry => entry.name);
      if (new Set(mappedNames).size !== mappedCases.length ||
          (actualCases && mappedCases.length !== actualCases.length) || mappedCases.length === 0) {
        errors.push(`${path}: per-assertion case mappings are missing, duplicated or stale`);
        continue;
      }
      for (const mapping of mappedCases) {
        const actualCase = actualCases?.find(entry => entry.name === mapping.name);
        if (Object.hasOwn(mapping, "coverage") || !Number.isInteger(mapping.assertionCount) ||
            !Array.isArray(mapping.assertions) || mapping.assertions.length !== mapping.assertionCount ||
            (actualCase && mapping.assertionCount !== actualCase.assertionCount)) {
          errors.push(`${path} :: ${mapping.name}: explicit per-assertion mapping is missing or stale`);
          continue;
        }
        for (const [index, assertion] of mapping.assertions.entries()) {
          const assertionLabel = `${path} :: ${mapping.name} :: assertion ${index + 1}`;
          const expectedFingerprint = createHash("sha256").update(`${index + 1}\0${assertion?.source ?? ""}`).digest("hex");
          const liveAssertion = actualCase?.assertions[index];
          if (!assertion || assertion.index !== index + 1 || assertion.line < 1 ||
              typeof assertion.source !== "string" || !assertion.source.trim() || assertion.fingerprint !== expectedFingerprint ||
              (liveAssertion && (assertion.line !== liveAssertion.line || assertion.fingerprint !== liveAssertion.fingerprint || assertion.source !== liveAssertion.source))) {
            errors.push(`${assertionLabel}: source fingerprint is missing or stale`);
            continue;
          }
          const coverageErrors = await validateAssertionCoverage(assertion, {
            absoluteRoot: repositoryRoot,
            batchScenarios: Object.keys(rules.scenarios),
            manifest: assertionManifest,
            rules,
            verifiedReports: Object.fromEntries(Object.entries(verification.browserReports ?? {})
              .map(([key, value]) => [key, value.runId])),
            currentSummary,
            suiteInputDigests,
            requireFreshEvidence
          });
          for (const error of coverageErrors) errors.push(`${assertionLabel}: ${error}`);
        }
      }
      if (actualCases && mappedCases.some(entry => !actualNames.includes(entry.name))) errors.push(`${path}: assertion manifest has stale test names`);
    }
  }

  return {
    valid: errors.length === 0,
    mode,
    browserskillEvidenceRequired: requireFreshEvidence,
    errors,
    activeSpecs: active,
    retiringSpecs: retiring,
    retiredSpecs: retired,
    managementDrift
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  Promise.resolve()
    .then(() => parseCheckTestArchitectureArgs())
    .then(options => checkTestArchitecture(root, options))
    .then(result => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.valid) process.exitCode = 1;
    }).catch(error => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
