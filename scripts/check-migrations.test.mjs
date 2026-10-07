import assert from "node:assert/strict";
import test from "node:test";
import { isolatedConfig } from "./check-migrations.mjs";

const template = `project_id = "template"

[api]
port = 54321

[db]
port = 54322
shadow_port = 54320

[studio]
port = 54323

[auth]
site_url = "http://localhost:8848"
additional_redirect_urls = [
  "http://127.0.0.1:8848/**",
  "http://localhost:8848/**"
]
`;

const ports = {
  api: 55321,
  db: 55322,
  shadow: 55320,
  studio: 55323,
  mailpit: 55324,
  smtp: 55325,
  pop3: 55326,
  analytics: 55327,
  vector: 55328
};

test("isolated agent configuration scopes Auth redirects to the chosen loopback origin", () => {
  const generated = isolatedConfig(template, "test-123", ports, "http://127.0.0.1:58848");

  assert.match(generated, /project_id = "test-123"/);
  assert.match(generated, /port = 55321/);
  assert.match(generated, /site_url = "http:\/\/127\.0\.0\.1:58848"/);
  assert.match(generated, /additional_redirect_urls = \["http:\/\/127\.0\.0\.1:58848\/\*\*"\]/);
  assert.doesNotMatch(generated, /localhost:8848|127\.0\.0\.1:8848/);
  assert.doesNotMatch(generated, /:8848|localhost:58848/);
  assert.match(template, /site_url = "http:\/\/localhost:8848"/);
});

test("isolated agent configuration rejects origins outside explicit loopback HTTP", () => {
  for (const origin of [
    "https://127.0.0.1:58848",
    "http://localhost:58848",
    "http://127.0.0.1",
    "http://127.0.0.1:58848/path"
  ]) {
    assert.throws(() => isolatedConfig(template, "test-123", ports, origin));
  }
});
