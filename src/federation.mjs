import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSettlementStore, querySettlementRecords, recordSettlementRecord } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";
import { addressChannelPortfolioRecord } from "@red-cup-engineering/a2a-channel-portfolio-status-service";
import { ACTOR, NODE_ROOT } from "./identity.mjs";

export { ACTOR, NODE_ROOT } from "./identity.mjs";
export function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
export function digest(value) { return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }
export function contentId(value) { return identifyJsonSemanticContent({ objectKind: "emsweb.video-federation.record", value: value, witnessRoot: EMPTY_WITNESS_ROOT }).token; }
function exactId(value) { if (!value || typeof value !== "object") return false; const { id, ...body } = value; return id === contentId(body); }
function exactChannelPortfolioRecord(value) { if (!value || typeof value !== "object") return false; const { id, ...body } = value; try { return id === addressChannelPortfolioRecord(body).id; } catch { return false; } }
function covenant() { return JSON.parse(readFileSync(join(NODE_ROOT, "content/config/covenant.json"), "utf8")); }
function day(value) { return /^\d{4}-\d{2}-\d{2}$/u.test(value ?? ""); }
function text(value) { return typeof value === "string" && value.trim() !== ""; }
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function target(line, civilDay, field) { if (!day(civilDay) || !Array.isArray(line.eligibleWeekdays)) throw new TypeError("covenant line lacks exact weekday eligibility"); return line.eligibleWeekdays.includes(WEEKDAYS[new Date(`${civilDay}T12:00:00Z`).getUTCDay()]) ? line[field] : 0; }
function chicagoCivilDay(instant) { const date = new Date(instant); if (Number.isNaN(date.valueOf())) throw new TypeError("portfolio instant is invalid"); const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const get = (type) => parts.find((part) => part.type === type)?.value; return `${get("year")}-${get("month")}-${get("day")}`; }

function validateStatus(status, line, civilDay) {
  if (!exactChannelPortfolioRecord(status) || status.type !== "ChannelPortfolioStatus" || status.channel !== line.channel || status.youtubeChannelId !== line.youtubeChannelId || status.youtubeHandle !== line.youtubeHandle || status.line !== line.line || status.format !== line.format || status.civilDay !== civilDay || status.timezone !== "America/Chicago") throw new TypeError("channel status does not preserve its covenant and venue identity");
  if (!Array.isArray(status.generationAdmissions) || !Array.isArray(status.releaseClaims) || !Array.isArray(status.publicationReceipts) || !Array.isArray(status.privateDraftReceipts) || !Array.isArray(status.inventory)) throw new TypeError("channel status lacks generation, release-plan, private-draft, publication, or inventory arrays");
  for (const entries of [status.generationAdmissions, status.releaseClaims, status.publicationReceipts, status.privateDraftReceipts, status.inventory]) if (new Set(entries.map((entry) => entry?.id)).size !== entries.length || entries.some((entry) => !text(entry?.id))) throw new TypeError("channel status contains duplicate or absent inner identities");
  const generationTarget = target(line, civilDay, "dailyGenerationTarget"), releaseTarget = target(line, civilDay, "dailyReleaseTarget");
  const todayGenerations = status.generationAdmissions.filter((entry) => entry.civilDay === civilDay); if (todayGenerations.length > generationTarget) throw new TypeError("channel status exceeds its weekday generation covenant");
  const todayReleasePlans = status.releaseClaims.filter((entry) => entry.civilDay === civilDay); if (todayReleasePlans.length > releaseTarget) throw new TypeError("channel status exceeds its weekday release-plan covenant");
  const todayPublications = status.publicationReceipts.filter((entry) => entry.civilDay === civilDay); if (todayPublications.length > releaseTarget) throw new TypeError("channel status exceeds its weekday publication covenant");
  const todayPrivateDrafts = status.privateDraftReceipts.filter((entry) => entry.civilDay === civilDay);
  if (status.generationAdmissions.some((entry) => !day(entry.civilDay) || entry.civilDay > civilDay || entry.format !== line.format || !text(entry.artifact) || !Number.isFinite(Date.parse(entry.admittedAt)))) throw new TypeError("generation admission summary is malformed");
  const generationDays = new Map(); for (const entry of status.generationAdmissions) generationDays.set(entry.civilDay, (generationDays.get(entry.civilDay) ?? 0) + 1); if ([...generationDays].some(([entryDay, count]) => count > target(line, entryDay, "dailyGenerationTarget"))) throw new TypeError("channel status contains historical target-zero or daily generation excess");
  if (status.inventory.some((entry) => !day(entry.generatedCivilDay) || entry.generatedCivilDay > civilDay || !text(entry.sourceGenerationAdmission) || !text(entry.artifact) || !Number.isFinite(Date.parse(entry.admittedAt)) || !["held", "denied", "unknown", "contested"].includes(entry.releaseEligible) || (entry.releaseClaimCivilDay !== null && !day(entry.releaseClaimCivilDay)))) throw new TypeError("inventory summary is malformed");
  const generations = new Map(status.generationAdmissions.map((entry) => [entry.id, entry]));
  if (status.inventory.some((entry) => !generations.has(entry.sourceGenerationAdmission) || generations.get(entry.sourceGenerationAdmission).artifact !== entry.artifact || generations.get(entry.sourceGenerationAdmission).civilDay !== entry.generatedCivilDay) || new Set(status.inventory.map((entry) => entry.sourceGenerationAdmission)).size !== status.inventory.length || status.inventory.length !== status.generationAdmissions.length) throw new TypeError("inventory is not one-to-one with exact generation admissions");
  if (new Set(status.inventory.map((entry) => entry.artifact)).size !== status.inventory.length) throw new TypeError("inventory reuses a generated artifact");
  const inventory = new Map(status.inventory.map((entry) => [entry.id, entry]));
  if (status.releaseClaims.some((entry) => !day(entry.civilDay) || !inventory.has(entry.inventory) || !Number.isFinite(Date.parse(entry.plannedPublishAt)) || chicagoCivilDay(entry.plannedPublishAt) !== entry.civilDay)) throw new TypeError("release claim does not bind exact reported inventory and civil day");
  if (new Set(status.releaseClaims.map((entry) => entry.inventory)).size !== status.releaseClaims.length) throw new TypeError("release claims reuse one inventory item");
  const releaseDays = new Map(); for (const entry of status.releaseClaims) releaseDays.set(entry.civilDay, (releaseDays.get(entry.civilDay) ?? 0) + 1); if ([...releaseDays].some(([entryDay, count]) => count > target(line, entryDay, "dailyReleaseTarget"))) throw new TypeError("channel status contains historical target-zero or daily release-plan excess");
  for (const claim of status.releaseClaims) if (inventory.get(claim.inventory).releaseClaimCivilDay !== claim.civilDay) throw new TypeError("release claim and inventory status disagree");
  const claims = new Map(status.releaseClaims.map((entry) => [entry.id, entry]));
  if (status.privateDraftReceipts.some((entry) => !day(entry.civilDay) || entry.youtubeChannelId !== line.youtubeChannelId || !text(entry.youtubeVideoId) || entry.privacyStatus !== "private" || entry.publishAt !== null || !Number.isFinite(Date.parse(entry.uploadedAt)) || (entry.releaseClaim !== null && (!claims.has(entry.releaseClaim) || claims.get(entry.releaseClaim).inventory !== entry.inventory)))) throw new TypeError("private draft lacks exact channel, claim, inventory, or private-only evidence");
  if (new Set(status.privateDraftReceipts.map((entry) => entry.youtubeVideoId)).size !== status.privateDraftReceipts.length) throw new TypeError("private draft receipts reuse a venue video");
  if (status.publicationReceipts.some((entry) => !day(entry.civilDay) || !claims.has(entry.releaseClaim) || claims.get(entry.releaseClaim).inventory !== entry.inventory || claims.get(entry.releaseClaim).civilDay !== entry.civilDay || !text(entry.venueEvidence) || typeof entry.publicUrl !== "string" || !entry.publicUrl.startsWith("https://") || !Number.isFinite(Date.parse(entry.publishedAt)) || chicagoCivilDay(entry.publishedAt) !== entry.civilDay)) throw new TypeError("publication receipt lacks exact release-plan and venue evidence");
  if (new Set(status.publicationReceipts.map((entry) => entry.releaseClaim)).size !== status.publicationReceipts.length) throw new TypeError("publication receipts reuse a release plan");
  const publicationDays = new Map(); for (const entry of status.publicationReceipts) publicationDays.set(entry.civilDay, (publicationDays.get(entry.civilDay) ?? 0) + 1); if ([...publicationDays].some(([entryDay, count]) => count > target(line, entryDay, "dailyReleaseTarget"))) throw new TypeError("channel status contains historical target-zero or daily publication excess");
  const ordered = [...status.inventory].filter((entry) => entry.releaseEligible === "held").sort((a, b) => Date.parse(a.admittedAt) - Date.parse(b.admittedAt) || a.id.localeCompare(b.id));
  for (let index = 0; index < ordered.length; index += 1) if (ordered[index].releaseClaimCivilDay !== null && ordered.slice(0, index).some((entry) => entry.releaseClaimCivilDay === null)) throw new TypeError("channel inventory violates FIFO release order");
  const available = ordered.filter((entry) => entry.releaseClaimCivilDay === null).length;
  return { channel: line.channel, youtubeChannelId: line.youtubeChannelId, youtubeHandle: line.youtubeHandle, line: line.line, format: line.format, status: status.id, eligibleToday: generationTarget === 1, generatedToday: todayGenerations.length, generationDeficit: generationTarget - todayGenerations.length, releasePlansToday: todayReleasePlans.length, releasePlanDeficit: releaseTarget - todayReleasePlans.length, privateDraftsToday: todayPrivateDrafts.length, publishedToday: todayPublications.length, publicationDeficit: releaseTarget - todayPublications.length, availableEligibleInventory: available, bufferTargetDays: covenant().startupBufferDays, bufferDeficitDays: Math.max(0, covenant().startupBufferDays - available), fifoConformant: true };
}

async function record(value, options) {
  const category = "emsweb-video-federation.portfolio-snapshot", at = options.at ?? new Date().toISOString();
  if (options.settlement) { await recordSettlementRecord({ agentUrl: options.witnessJournalAgentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT, settlement: options.settlement, actor: ACTOR, category, recordedAt: at, record: { ...value } }); return; }
  const store = createSettlementStore({ settlementRoot: NODE_ROOT, agentUrl: options.witnessJournalAgentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT }); await store.record({ category, recordedAt: at, record: { ...value } });
}

export async function admitPortfolioSnapshot({ civilDay, deliveries = [] } = {}, options = {}) {
  const contract = covenant(); if (!day(civilDay) || deliveries.length !== contract.lines.length || typeof options.verifyDelivery !== "function") throw new TypeError("portfolio snapshot requires one verifier-backed delivery per covenant line");
  const actors = deliveries.map((delivery) => delivery?.actor); if (new Set(actors).size !== contract.lines.length || contract.lines.some((line) => !actors.includes(line.channel))) throw new TypeError("portfolio snapshot has missing, duplicate, or foreign channels");
  const reports = [];
  for (const line of contract.lines) {
    const delivery = deliveries.find((entry) => entry.actor === line.channel);
    if (!exactChannelPortfolioRecord(delivery) || delivery.type !== "Accept" || delivery.target !== ACTOR || (await options.verifyDelivery(delivery)) !== true) throw new TypeError("portfolio status lacks exact authenticated channel delivery");
    reports.push(validateStatus(delivery.object, line, civilDay));
  }
  const dataRoot = resolve(options.dataRoot ?? join(NODE_ROOT, "data")), runtimeRoot = resolve(options.runtimeRoot ?? join(NODE_ROOT, "content/runtime/snapshot-locks"));
  mkdirSync(runtimeRoot, { recursive: true }); const lock = join(runtimeRoot, civilDay); try { mkdirSync(lock); } catch (error) { if (error?.code === "EEXIST") throw new TypeError("portfolio civil day is concurrently snapshotting"); throw error; }
  try {
    const prior = (await querySettlementRecords("emsweb-video-federation.portfolio-snapshot")).filter((entry) => entry.civilDay === civilDay);
    if (prior.length) {
      const rows = prior;
      if (prior.length > 1 || rows.some((row) => !exactId(row)) || new Set(rows.map((row) => row.id)).size !== 1) throw new TypeError("portfolio civil day has conflicting snapshot history");
      return rows[0];
    }
    const body = { type: "FiveChannelPortfolioSnapshot", federation: ACTOR, covenantVersion: contract.version, civilDay, timezone: contract.timezone, reports, portfolioDeficits: { generationUnits: reports.reduce((sum, entry) => sum + entry.generationDeficit, 0), releasePlanUnits: reports.reduce((sum, entry) => sum + entry.releasePlanDeficit, 0), publicationUnits: reports.reduce((sum, entry) => sum + entry.publicationDeficit, 0), bufferDays: reports.reduce((sum, entry) => sum + entry.bufferDeficitDays, 0) }, authorityWithheld: [...contract.authorityWithheld], admittedAt: options.at ?? new Date().toISOString() };
    const snapshot = { id: contentId(body), ...body }; await record(snapshot, options); return snapshot;
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

export function formProcurementOpportunities(snapshot, offeredAt = new Date().toISOString()) {
  if (!exactId(snapshot) || snapshot.type !== "FiveChannelPortfolioSnapshot" || snapshot.federation !== ACTOR || !Number.isFinite(Date.parse(offeredAt))) throw new TypeError("opportunities require an exact federation snapshot");
  return snapshot.reports.filter((report) => report.generationDeficit + report.releasePlanDeficit + report.publicationDeficit + report.bufferDeficitDays > 0).map((report) => {
    const object = { type: "ChannelPortfolioProcurementOpportunity", snapshot: snapshot.id, civilDay: snapshot.civilDay, channel: report.channel, line: report.line, deficits: { generationUnits: report.generationDeficit, releasePlanUnits: report.releasePlanDeficit, publicationUnits: report.publicationDeficit, bufferDays: report.bufferDeficitDays }, suggestedResponse: "channel-may-form-own-provider-neutral-procurement", spendingAuthority: "none", dispatchAuthority: "none", channelWriteAuthority: "none" };
    const body = { type: "Offer", actor: ACTOR, target: report.channel, object, published: offeredAt }; return { id: contentId(body), ...body };
  });
}
