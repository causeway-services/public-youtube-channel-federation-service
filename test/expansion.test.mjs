import assert from "node:assert/strict";
import test from "node:test";
import { assayExpansion, loadExpansion } from "../src/expansion.mjs";
test("five-channel proposal adds one alternating explainer Monday through Saturday", () => {
  const result = assayExpansion(loadExpansion(), "2096-07-21T12:00:00Z"); assert.equal(result.status, "feasible-provisional-not-activated"); assert.equal(result.weeklyTotal, 27); assert.equal(result.minimumDailyHeadroom, 16); assert.equal(result.newPerDay.Sunday, 0); assert.ok(Object.entries(result.newPerDay).filter(([day]) => day !== "Sunday").every(([, count]) => count === 1)); assert.deepEqual(result.unboundChannels, []); assert.equal(result.authorityGranted.length, 0);
});
test("overlap, quota arithmetic drift, and ambient research reuse are refused", () => {
  const overlap = structuredClone(loadExpansion()); overlap.portfolio.find((line) => line.line === "modern-business-practice").weekdays = ["Monday", "Thursday", "Saturday"]; assert.throws(() => assayExpansion(overlap), /partition/u);
  const arithmetic = structuredClone(loadExpansion()); arithmetic.capacity.weeklyTotal = 28; assert.throws(() => assayExpansion(arithmetic), /arithmetic/u);
  const ambient = structuredClone(loadExpansion()); ambient.researchEconomy.requiredProductFields = []; assert.throws(() => assayExpansion(ambient), /atomic research/u);
});
