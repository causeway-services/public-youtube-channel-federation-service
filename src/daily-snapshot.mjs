#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createChannelStatusClient, loadChannelStatusDescriptors } from "./channel-status-client.mjs";
import { NODE_ROOT, admitPortfolioSnapshot, formProcurementOpportunities } from "./federation.mjs";

function chicagoDay(now = new Date()) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now), get = (type) => parts.find((part) => part.type === type)?.value; return `${get("year")}-${get("month")}-${get("day")}`; }
function account() { return JSON.parse(readFileSync(join(NODE_ROOT, "content/evm/accounts/eip155-31337.json"), "utf8")).account.caip10; }

export async function runDailyPortfolioSnapshot(options = {}) {
  const at = options.at ?? new Date().toISOString(), civilDay = options.civilDay ?? chicagoDay(new Date(at));
  const client = options.client ?? createChannelStatusClient({ descriptors: options.descriptors ?? loadChannelStatusDescriptors(), timeoutMs: options.timeoutMs ?? 120000 });
  const deliveries = await client.collectPortfolioDeliveries(civilDay);
  const snapshot = await (options.admit ?? admitPortfolioSnapshot)({ civilDay, deliveries }, { at, dataRoot: resolve(options.dataRoot ?? join(NODE_ROOT, "data")), runtimeRoot: options.runtimeRoot, settlement: options.settlement ?? account(), witnessJournalAgentUrl: options.witnessJournalAgentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT, verifyDelivery: (delivery) => client.verifyDelivery(delivery) });
  const opportunities = formProcurementOpportunities(snapshot, at);
  return { type: "FiveChannelDailyPortfolioSnapshotRun", civilDay, snapshot: snapshot.id, deficits: snapshot.portfolioDeficits, procurementOpportunities: opportunities.map((offer) => ({ offer: offer.id, channel: offer.target, deficits: offer.object.deficits, authority: "offer-only" })) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runDailyPortfolioSnapshot().then((value) => process.stdout.write(`${JSON.stringify(value)}\n`)).catch((error) => { process.stderr.write(`refused: ${error.message}\n`); process.exitCode = 78; });
