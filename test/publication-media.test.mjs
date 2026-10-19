import test from "node:test";
import assert from "node:assert/strict";
import { videoPublication, imagePublication } from "../src/publication-media.mjs";

const channel = { youtubeChannelId:"UC04l4oe3ZgkgM8H63Pvp9Kg", name:"emsenn", publisherType:"Person" };
const episode = { stage:"published", youtubeVideoId:"7F7dCKMbpmE",
  publishAt:"2026-10-04T15:00:35Z", thumbnailUploaded:true };
const metadata = { title:"The Cold Chain: Who Bears the Risk of Spoilage?",
  description:"How cold-chain refrigeration redistributes spoilage risk.",
  tags:["cold chain","food loss","refrigeration","bargaining power"] };
const provenance = {sources:[
  "causeway-services/emsenn-youtube-services-section/production/episodes/cold-chain-logistics-equity/metadata.json",
  "causeway-services/emsenn-youtube-services-section/production/episodes/cold-chain-logistics-equity/state.json",
  "causeway-services/emsenn-youtube-services-section/production/episodes/cold-chain-logistics-equity/transcript.md",
]};

test("a published explainer retains its editorial language and becomes a standard embeddable VideoObject", () => {
  const record=videoPublication({channel,episode,metadata,transcript:"[00:00:10] Refrigeration redistributes spoilage risk.",provenance});
  assert.equal(record.media["@type"],"VideoObject");
  assert.equal(record.media.identifier,"7F7dCKMbpmE");
  assert.equal(record.media.uploadDate,"2026-10-04T15:00:35Z");
  assert.equal(record.media.embedUrl,"https://www.youtube-nocookie.com/embed/7F7dCKMbpmE");
  assert.equal(record.media.url,"https://www.youtube.com/watch?v=7F7dCKMbpmE");
  assert.equal(record.media.thumbnailUrl,"https://i.ytimg.com/vi/7F7dCKMbpmE/hqdefault.jpg");
  assert.deepEqual(record.media.keywords,metadata.tags);
  assert.match(record.media.transcript,/spoilage risk/u);
  assert.equal(record.provenance.kind,"causeway.youtube.publication");
  assert.deepEqual(record.provenance.sources,provenance.sources);
  assert.equal(JSON.stringify(record).includes("YOUTUBE_OAUTH_REFRESH_TOKEN"),false);
});

test("a published Short relates to its actual full lesson but is a distinct video", () => {
  const short=videoPublication({channel,metadata,provenance,episode:{
    ...episode,youtubeVideoId:"C0L0Xha3N-w",parentVideoId:episode.youtubeVideoId,
  }});
  assert.deepEqual(short.media.isPartOf,{"@id":"https://www.youtube.com/watch?v=7F7dCKMbpmE"});
  assert.equal(short.media.identifier,"C0L0Xha3N-w");
});

test("private, unpublished, unsourced and malformed claims never become public video embeds", () => {
  for (const candidate of [
    {...episode,stage:"private"}, {...episode,thumbnailUploaded:false},
    {...episode, youtubeVideoId:"https://evil.invalid/?id=abc"},
    {...episode,publishAt:"tomorrow"},
  ]) assert.throws(()=>videoPublication({channel,metadata,provenance,episode:candidate}),/public video|publication timestamp/u);
  assert.throws(()=>videoPublication({channel,metadata,episode}),/source lineage/u);
  assert.throws(()=>videoPublication({channel,metadata:{...metadata,tags:["\"><script>"]},provenance,episode}),
    /editorially supplied|public video/u);
});

test("an image with an actually served HTTPS location shares the media vocabulary", () => {
  const image=imagePublication({url:"https://public.example.org/assets/chain.png",
    name:"Cold chain infrastructure",description:"Insulated vehicles and refrigeration",
    alternateName:"Diagram of refrigerated deliveries",encodingFormat:"image/png",
    provenance:{sources:["public-owned-image-source/receipt"]},keywords:["cold chain"]});
  assert.equal(image.media["@type"],"ImageObject");
  assert.equal(image.media.contentUrl,"https://public.example.org/assets/chain.png");
  assert.deepEqual(image.media.keywords,["cold chain"]);
  assert.throws(()=>imagePublication({url:"file:///private/infographic.png",name:"Draft",description:"Draft",provenance:{sources:["draft"]}}),/HTTPS/u);
  assert.throws(()=>imagePublication({url:"https://public.example.org/private.png",name:"Draft",description:"Draft"}),/source lineage/u);
});
