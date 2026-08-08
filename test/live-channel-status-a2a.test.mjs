import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { agentCardSignatureEvidence, discoverAgentCard } from "@red-cup-engineering/a2a-agent-card-discovery-service";
import { serveContractedAgent } from "@red-cup-engineering/a2a-contracted-agent-service";
import { ephemeralAgentCardSigning } from "@red-cup-engineering/a2a-agent-card-key-service/testing";
import { startWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-rdf-projection-service/test-provider";
import { createChannelStatusClient } from "../src/channel-status-client.mjs";
import { admitPortfolioSnapshot } from "../src/federation.mjs";

const DAY="2096-07-21",SETTLEMENT="eip155:31337:0x5555555555555555555555555555555555555555",EMSWEB=resolve(import.meta.dirname,"../..");
const CHANNELS=[
  ["urn:ame:mathematics-youtube-channel-enterprise","mathematics-youtube-channel-enterprise"],
  ["urn:ame:youtube-channel-enterprise","youtube-channel-enterprise"],
  ["urn:ame:climate-youtube-channel-enterprise","climate-youtube-channel-enterprise"],
  ["urn:ame:artificial-intelligence-youtube-channel-enterprise","artificial-intelligence-youtube-channel-enterprise"],
  ["urn:ame:modern-business-youtube-channel-enterprise","modern-business-youtube-channel-enterprise"]
];
async function freePort(){const server=createServer();await new Promise(resolvePromise=>server.listen(0,"127.0.0.1",resolvePromise));const port=server.address().port;await new Promise(resolvePromise=>server.close(resolvePromise));return port;}
test("five sovereign signed channel agents deliver one authenticated live portfolio snapshot",async t=>{const root=mkdtempSync(join(tmpdir(),"five-channel-a2a-")),witnessJournal=await startWitnessJournalProviderProcess(),running=[];process.env.CHANNEL_DATA_ROOT=join(root,"empty-channel-data");process.env.PORTFOLIO_REPORTED_AT=`${DAY}T12:00:00.000Z`;t.after(async()=>{delete process.env.CHANNEL_DATA_ROOT;delete process.env.PORTFOLIO_REPORTED_AT;for(const provider of running)await new Promise(resolvePromise=>provider.server.close(resolvePromise));await witnessJournal.close();rmSync(root,{recursive:true,force:true});});const descriptors=[];
  for(const[actor,directory]of CHANNELS){const port=await freePort(),baseUrl=`http://127.0.0.1:${port}`,channelRoot=join(EMSWEB,directory),provider=await serveContractedAgent({port,host:"127.0.0.1",baseUrl,agentCard:join(channelRoot,"content/agent-cards/portfolio-status.json"),executor:process.execPath,executorArgs:[join(channelRoot,"src/a2a-status-executor.mjs")],...ephemeralAgentCardSigning(baseUrl,`${directory}-status`)});running.push(provider);const agentUrl=`${baseUrl}/.well-known/agent-card.json`,card=await discoverAgentCard({agentUrl,requireSignature:true,signal:AbortSignal.timeout(10_000)});descriptors.push({channel:actor,agentUrl,expectedAgentCardIdentity:agentCardSignatureEvidence(card).card});}
  const client=createChannelStatusClient({descriptors,timeoutMs:10_000}),deliveries=await client.collectPortfolioDeliveries(DAY),snapshot=await admitPortfolioSnapshot({civilDay:DAY,deliveries},{dataRoot:join(root,"federation-data"),runtimeRoot:join(root,"runtime"),witnessJournalAgentUrl:witnessJournal.agentCardUrl,settlement:SETTLEMENT,at:`${DAY}T16:00:00.000Z`,verifyDelivery:client.verifyDelivery});assert.equal(deliveries.length,5);assert.deepEqual(snapshot.portfolioDeficits,{generationUnits:4,releasePlanUnits:4,publicationUnits:4,bufferDays:15});assert.equal(snapshot.reports.find(row=>row.channel.includes("artificial-intelligence")).eligibleToday,false);
});
