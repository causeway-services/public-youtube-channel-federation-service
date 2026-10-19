/**
 * One PUBLIC YouTube publication as schema.org VideoObject or ImageObject,
 * downstream of the channel publisher's original video and asset receipts.
 *
 * Neither a private draft nor an image existing on somebody's local disk is
 * public media. A video ID is an external venue coordinate; it is NOT the
 * content address of the video's raw bytes. The receiving CAIRN/Data stack
 * separately NI-addresses the exact published JSON-LD representation.
 *
 * This pure projection is shared by every Causeway channel; it owns no
 * additional archive, L-Space search implementation, media downloader,
 * generated tags, publishing authority or inferred source claims.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{20,}$/u;
const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u;
const types = new Set(["VideoObject", "ImageObject"]);
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const https = value => {
  if (!nonempty(value) || /[\s\\]/u.test(value)) throw new TypeError("public media URL requires plain HTTPS");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname)
    throw new TypeError("public media URL requires uncredentialed HTTPS");
  return url.href;
};
const date = value => {
  if (!DATE.test(value ?? "") || !Number.isFinite(Date.parse(value)))
    throw new TypeError("public media must retain an observed publication timestamp");
  return value;
};
const text = (value, field, max = 15000) => {
  if (!nonempty(value) || value.length > max)
    throw new TypeError("public media needs a bounded " + field);
  return value;
};
const tags = values => {
  if (!Array.isArray(values) || values.length > 40 ||
      values.some(value => !nonempty(value) || value.length > 120))
    throw new TypeError("public media tags must be editorially supplied");
  return Object.freeze([...new Set(values.map(v => v.trim()))]);
};
const publicVideoUrl = id => "https://www.youtube.com/watch?v=" + id;

/** Project an original, actually published episode, not a planned upload.
 * Channel, source paths and provenance are supplied by the publisher owner,
 * never invented from a visitor's text query or guessed from clip filenames.
 */
export function videoPublication({ channel, episode, metadata, transcript = "", provenance } = {}) {
  const channelId = channel?.youtubeChannelId;
  const id = episode?.youtubeVideoId;
  if (!CHANNEL_ID.test(channelId ?? "") || !VIDEO_ID.test(id ?? "") ||
      episode?.stage !== "published" || episode?.thumbnailUploaded !== true ||
      !Array.isArray(provenance?.sources) || provenance.sources.length < 1 ||
      provenance.sources.some(v => !nonempty(v) || v.length > 2048))
    throw new TypeError("public video needs publisher-owned channel, published ID, thumbnail and source lineage");
  const name = text(metadata?.title, "title", 500);
  const description = text(metadata?.description, "description", 18000);
  if (typeof transcript !== "string" || transcript.length > 200000)
    throw new TypeError("public video transcript must be bounded original text");
  const published = date(episode.publishAt);
  const keywords = tags(metadata.tags ?? []);
  const youtube = publicVideoUrl(id);
  const media = Object.freeze({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "@id": youtube,
    identifier: id,
    name, description, uploadDate: published,
    url: youtube,
    embedUrl: "https://www.youtube-nocookie.com/embed/" + id,
    thumbnailUrl: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg",
    ...(keywords.length ? { keywords, about: keywords.map(name => ({ "@type": "Thing", name })) } : {}),
    ...(transcript.trim() ? { transcript } : {}),
    ...(nonempty(channel?.name) ? {
      publisher: { "@type": channel.publisherType === "Organization" ? "Organization" : "Person",
        name: channel.name, identifier: channelId,
        url: "https://www.youtube.com/channel/" + channelId },
    } : {}),
    ...(VIDEO_ID.test(episode.parentVideoId ?? "") ? {
      isPartOf: { "@id": publicVideoUrl(episode.parentVideoId) },
    } : {}),
  });
  return Object.freeze({
    media, provenance: Object.freeze({
      kind: "causeway.youtube.publication",
      channelId, videoId: id,
      sources: Object.freeze([...provenance.sources]),
      publisher: text(channel.name, "channel"),
    }),
  });
}

/** An image joins the same media surface ONLY with a real published URL.
 * Source-local infographic files and receipt IDs remain unserved until a
 * publisher has actually made them publicly accessible.
 */
export function imagePublication({ url, name, description, alternateName,
  keywords = [], datePublished, provenance, encodingFormat } = {}) {
  if (!Array.isArray(provenance?.sources) || provenance.sources.length === 0 ||
      provenance.sources.some(x => !nonempty(x)))
    throw new TypeError("public image needs source lineage and independently published URL");
  const published = https(url);
  if (encodingFormat !== undefined && !/^image\/(?:png|jpeg|webp|avif|gif|svg\+xml)$/u.test(encodingFormat))
    throw new TypeError("public image requires an admitted image media type");
  const media = Object.freeze({
    "@context": "https://schema.org", "@type": "ImageObject",
    "@id": published, url: published, contentUrl: published,
    name: text(name, "image title", 500),
    description: text(description, "image description", 18000),
    ...(alternateName === undefined ? {} : { alternateName: text(alternateName, "image alternative text", 500) }),
    ...(datePublished === undefined ? {} : { datePublished: date(datePublished) }),
    ...(encodingFormat === undefined ? {} : { encodingFormat }),
    ...(keywords.length ? { keywords: tags(keywords) } : {}),
  });
  return Object.freeze({ media, provenance: Object.freeze({
    kind: "causeway.image.publication", sources: Object.freeze([...provenance.sources]),
  }) });
}

export const isPublicationMedia = value => value && typeof value === "object" &&
  value.media?.["@context"] === "https://schema.org" &&
  types.has(value.media?.["@type"]) && value.provenance?.kind?.endsWith(".publication");
