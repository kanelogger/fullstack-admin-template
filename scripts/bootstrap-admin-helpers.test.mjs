import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOTSTRAP_METADATA_KEY,
  bootstrapMarker,
  isEmailConflict,
  matchesBootstrapMarker
} from "./bootstrap-admin-helpers.mjs";

const identity = {
  loginName: "admin",
  displayName: "Template Admin",
  email: "admin@example.test"
};

test("only resumes Auth identities carrying the exact trusted bootstrap marker", () => {
  const user = {
    email: identity.email.toUpperCase(),
    app_metadata: { [BOOTSTRAP_METADATA_KEY]: bootstrapMarker(identity) }
  };
  assert.equal(matchesBootstrapMarker(user, identity), true);
  assert.equal(matchesBootstrapMarker(user, { ...identity, loginName: "other" }), false);
  assert.equal(isEmailConflict(user, identity), false);
});

test("ordinary accounts with a matching email are never upgraded", () => {
  const user = { email: identity.email, app_metadata: {} };
  assert.equal(matchesBootstrapMarker(user, identity), false);
  assert.equal(isEmailConflict(user, identity), true);
});
