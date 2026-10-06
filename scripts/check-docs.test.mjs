import assert from "node:assert/strict";
import test from "node:test";
import {
  extractLocalMarkdownLinks,
  extractPnpmScriptReferences
} from "./check-docs.mjs";

test("local Markdown link extraction skips external URLs and anchors", () => {
  assert.deepEqual(
    extractLocalMarkdownLinks("[guide](./guide.md#setup) [web](https://example.test) [top](#top)"),
    ["./guide.md"]
  );
});

test("pnpm script extraction reads code references and ignores prose and package commands", () => {
  const markdown = "pnpm workspace uses pnpm. Run `pnpm check:docs`; then:\n\n```sh\npnpm build\npnpm install --frozen-lockfile\n```";
  assert.deepEqual(
    extractPnpmScriptReferences(markdown),
    new Set(["check:docs", "build"])
  );
});
