import assert from "node:assert/strict";
import test from "node:test";
import { extractRmnPart, parseA2aMessage, rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";

const A2A_JSON_OBJECT_KIND = "rsc-quiescent.a2a-json";
const semanticBytes = (value) => identifyJsonSemanticContent({ objectKind: A2A_JSON_OBJECT_KIND, value, witnessRoot: EMPTY_WITNESS_ROOT }).bytes;
const decodeSemantic = (bytes) => admitJsonSemanticContent({ bytes, objectKind: A2A_JSON_OBJECT_KIND }).value;
import { observationProtocol } from "@red-cup-engineering/youtube-public-channel-feed-observation-cell/protocol";
import { createPublicFeedClient } from "../src/public-feed-client.mjs";

const CHANNEL = "UCVk_gd1Tv320tj6ofCTiLMw", CARD = `ni:///sha-256;${"A".repeat(43)}`, URL = "https://provider.example/.well-known/agent-card.json";
const binding = { type: "YouTubePublicFeedObservationProviderBinding", provider: "urn:ame:youtube-public-channel-feed-observation-cell", agentUrl: URL, expectedAgentCardIdentity: CARD, operation: "observe-youtube-public-channel-feed" };

function sender({ changedCard = false } = {}) {
  return async ({ agentUrl, message, requireSignature }) => {
    assert.equal(agentUrl, URL); assert.equal(requireSignature, true);
    const input = extractRmnPart(parseA2aMessage(message).parts), request = observationProtocol.decodeRequest(decodeSemantic(input.bytes));
    const result = { provider: binding.provider, channelId: request.input.channelId, feedTitle: "MathematicsInRelation", latest: null };
    const response = observationProtocol.encodeResponse({ request: input.ni, disposition: "accepted", result });
    const output = rmnPart(semanticBytes(response.term), "response.rmn.cbor");
    return { result: { parts: [output] }, inputNi: input.ni, outputNi: output.metadata.ni, agentCard: { fixture: changedCard ? `ni:///sha-256;${"Z".repeat(43)}` : CARD } };
  };
}

test("federation hires and authenticates the atomic public-feed observer", async () => {
  const client = createPublicFeedClient({ binding, send: sender(), cardEvidence: (card) => ({ card: card.fixture }) });
  const delivery = await client.observe(CHANNEL, "request-one");
  assert.equal(delivery.result.channelId, CHANNEL);
  assert.equal(delivery.evidence.agentCardIdentity, CARD);
  assert.ok(NI(delivery.evidence.inputNi));
});

test("federation refuses a changed observer identity", async () => {
  const client = createPublicFeedClient({ binding, send: sender({ changedCard: true }), cardEvidence: (card) => ({ card: card.fixture }) });
  await assert.rejects(() => client.observe(CHANNEL, "request-two"), /Agent Card identity changed/u);
});

function NI(value) { return /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(value); }
