import assert from "node:assert/strict";
import test from "node:test";
import { runDailyPortfolioSnapshot } from "../src/daily-snapshot.mjs";
import { ACTOR, contentId } from "../src/federation.mjs";

test("the daily close authenticates all five deliveries and emits offer-only deficit opportunities", async () => {
  const deliveries = Array.from({ length: 5 }, (_, index) => ({ index }));
  const body = { type: "FiveChannelPortfolioSnapshot", federation: ACTOR, portfolioDeficits: { generationUnits: 1, releasePlanUnits: 2, publicationUnits: 3, bufferDays: 4 }, reports: [{ channel: "urn:channel", line: "line", generationDeficit: 1, releasePlanDeficit: 0, publicationDeficit: 0, bufferDeficitDays: 0 }] }, snapshot = { id: contentId(body), ...body };
  const result = await runDailyPortfolioSnapshot({ at: "2096-07-22T23:55:00.000-05:00", civilDay: "2096-07-22", dataRoot: "/tmp/not-used", settlement: "eip155:31337:0x9999999999999999999999999999999999999999", client: { collectPortfolioDeliveries: async (day) => { assert.equal(day, "2096-07-22"); return deliveries; }, verifyDelivery: async (delivery) => deliveries.includes(delivery) }, admit: async ({ civilDay, deliveries: values }, options) => { assert.equal(civilDay, "2096-07-22"); assert.equal(values.length, 5); assert.equal(await options.verifyDelivery(values[0]), true); return snapshot; } });
  assert.equal(result.snapshot, snapshot.id);
  assert.equal(result.procurementOpportunities.length, 1);
  assert.equal(result.procurementOpportunities[0].authority, "offer-only");
});
