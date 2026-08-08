import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NODE_ROOT, contentId } from "./federation.mjs";
const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export function loadExpansion(path = join(NODE_ROOT, "content/proposals/five-channel-expansion.json")) { return JSON.parse(readFileSync(path, "utf8")); }
export function assayExpansion(proposal = loadExpansion(), assayedAt = new Date().toISOString()) {
  if (proposal?.type !== "FiveChannelPortfolioExpansionProposal" || proposal.version !== 1 || !String(proposal.status).startsWith("proposed-") || !Array.isArray(proposal.portfolio) || proposal.portfolio.length !== 5) throw new TypeError("five-channel expansion proposal is malformed or operative");
  const actors = proposal.portfolio.map((line) => line.channel); if (new Set(actors).size !== 5) throw new TypeError("five-channel proposal repeats a channel actor");
  const ai = proposal.portfolio.find((line) => line.line === "artificial-intelligence-history-and-frontiers"), business = proposal.portfolio.find((line) => line.line === "modern-business-practice");
  if (!ai || !business || ai.format !== "explainer" || business.format !== "explainer") throw new TypeError("alternating explainer lines are absent");
  for (const line of [ai, business]) if (line.publicIdentityStatus !== "bound" || !/^UC[A-Za-z0-9_-]{22}$/u.test(line.youtubeChannelId ?? "") || !/^@[A-Za-z0-9_-]+$/u.test(line.youtubeHandle ?? "") || typeof line.title !== "string" || line.title.trim() === "") throw new TypeError("alternating channel public identity is not exactly bound");
  const aiDays = new Set(ai.weekdays), businessDays = new Set(business.weekdays), weekdays = new Set(WEEK.slice(0, 6));
  if ([...aiDays].some((day) => businessDays.has(day)) || new Set([...aiDays, ...businessDays]).size !== weekdays.size || [...weekdays].some((day) => !aiDays.has(day) && !businessDays.has(day)) || aiDays.has("Sunday") || businessDays.has("Sunday")) throw new TypeError("alternating lines must partition Monday through Saturday and exclude Sunday");
  const perDay = Object.fromEntries(WEEK.map((day) => [day, proposal.portfolio.reduce((sum, line) => sum + (line.weekdays.includes(day) ? line.targetPerEligibleDay : 0), 0)]));
  const newPerDay = Object.fromEntries(WEEK.map((day) => [day, Number(ai.weekdays.includes(day)) + Number(business.weekdays.includes(day))]));
  if (Object.values(newPerDay).some((count) => count > 1) || newPerDay.Sunday !== 0) throw new TypeError("expansion adds more than one generation on a day");
  const capacity = proposal.capacity; if (capacity.accountingRule !== "Conservatively count every cinematic inside the total Video Overview allowance." || Math.max(...Object.values(perDay)) > capacity.reportedVideoOverviewsPerDay || 1 > capacity.reportedCinematicSubLimitPerDay) throw new TypeError("proposal exceeds or misstates conservative capacity");
  const weeklyTotal = Object.values(perDay).reduce((sum, count) => sum + count, 0); if (weeklyTotal !== 27 || capacity.weeklyTotal !== weeklyTotal || capacity.minimumDailyHeadroom !== capacity.reportedVideoOverviewsPerDay - Math.max(...Object.values(perDay))) throw new TypeError("proposal weekly or headroom arithmetic is inconsistent");
  const required = ["researchProductId", "owner", "sourceCorpusDigest", "correctionIdentity", "reuseGrant", "priceAndSettlementReceipt"]; if (required.some((field) => !proposal.researchEconomy?.requiredProductFields?.includes(field)) || proposal.notebookTopology?.rule?.includes("distinct persistent-notebook settlement") !== true) throw new TypeError("proposal lacks atomic research reuse or notebook separation");
  if (!Array.isArray(proposal.authorityWithheld) || !proposal.authorityWithheld.includes("no generation, upload, schedule, publication, or Course designation") || !Number.isFinite(Date.parse(assayedAt))) throw new TypeError("proposal does not withhold effects or assay time is invalid");
  const body = { type: "FiveChannelExpansionAssay", proposalVersion: proposal.version, status: "feasible-provisional-not-activated", perDay, newPerDay, weeklyTotal, weeklyCinematic: capacity.weeklyCinematic, minimumDailyHeadroom: capacity.minimumDailyHeadroom, unboundChannels: proposal.portfolio.filter((line) => line.publicIdentityStatus !== "bound").map((line) => line.channel), authorityGranted: [], assayedAt };
  return { id: contentId(body), ...body };
}
