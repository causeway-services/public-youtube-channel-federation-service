#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicFeedClient } from "./public-feed-client.mjs";
import { NODE_ROOT } from "./federation.mjs";

export async function observeFivePublicChannelIdentities({ client = createPublicFeedClient() } = {}) {
  const covenant = JSON.parse(readFileSync(join(NODE_ROOT, "content/config/covenant.json"), "utf8"));
  const observations = [];
  for (const line of covenant.lines) {
    const delivery = await client.observe(line.youtubeChannelId, `emsweb-video-federation:${line.channel}:${new Date().toISOString()}`);
    observations.push({
      channel: line.channel,
      expectedYouTubeChannelId: line.youtubeChannelId,
      expectedYouTubeHandle: line.youtubeHandle,
      observedFeedTitle: delivery.result.feedTitle,
      latest: delivery.result.latest,
      venueObservedAt: delivery.result.observedAt,
      provider: delivery.result.provider,
      ...delivery.evidence,
      authenticated: true,
    });
  }
  return {
    type: "FiveChannelPublicIdentityHealthObservation",
    federation: "urn:ame:emsweb-video-federation",
    channels: observations,
    authorityWithheld: ["youtube-credentials", "youtube-private-state", "search", "ranking", "interpretation", "analytics", "publication", "scheduling", "youtube-write"],
    observedAt: new Date().toISOString(),
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.stdout.write(`${JSON.stringify(await observeFivePublicChannelIdentities(), null, 2)}\n`);
