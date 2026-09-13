import test from "node:test";
import assert from "node:assert/strict";
import { isPermissionDenied } from "./firebase";

// Only an explicit refusal may sign an account out. Everything else keeps the
// session, so this is the one branch that decides between the two.
test("only a permission-denied code counts as a refusal", () => {
  assert.equal(isPermissionDenied({ code: "permission-denied" }), true);
  assert.equal(isPermissionDenied({ code: "firestore/permission-denied" }), true);
  assert.equal(isPermissionDenied({ code: "unavailable" }), false);
  assert.equal(isPermissionDenied({ code: "unauthenticated" }), false);
  assert.equal(isPermissionDenied({ code: "deadline-exceeded" }), false);
  assert.equal(isPermissionDenied(new Error("offline")), false);
  assert.equal(isPermissionDenied("permission-denied"), false);
  assert.equal(isPermissionDenied(null), false);
  assert.equal(isPermissionDenied(undefined), false);
});
