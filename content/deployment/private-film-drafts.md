# Private receiving of accepted cinematic episodes

This is an operating procedure for the **existing** Public YouTube section and the existing Causeway Public Fiction film producer. It does not expand the five-channel federation's withheld publication, account-credential, calendar or spending authority, and does not infer a media business from a source screenplay. The receiving application is `src/private-video-cli.mjs`, with the reusable YouTube Data API adapter in `src/private-video-draft.mjs`.

## Concrete production handoff

1. Causeway completes the *real* source-bound film: actual reference-guided video takes, performed audio, independent continuity and rights reviews, a final mixed/edited MP4 and the render's SHA-256. The same compiled source should have a measured `MicrodramaProductionYield` showing accepted finished seconds. This instrument does **not** accept screenplay PDFs, SVG animatics, unsupported Google Flow media IDs, or simulated visual references as a professional film.
2. The independent owner reviews the **final edited bytes**, not merely a source take or rendering command. Its review explicitly says `accepted: true`, has `asset.sha256` equal to the final rendition SHA, and includes `authority`, `reviewRef` and `rightsRef`. A supplied string is a claim: the invoking office must establish that source/review authority from its underlying signed records.
3. A **separately authorized YouTube receiving office** decides which real channel may hold a private draft. The owning account's OAuth access token must allow `channels.list?mine=true` and `videos.list`, and be able to upload. No channel credential or refresh token is stored in the spec or GitHub.
4. After materializing actual MP4 custody on the operator host, write an input spec with the existing `MicrodramaLocalRendition` body, independent final review, channel receiving instruction and the original licensed video title/description. The spec must not contain media bytes or OAuth tokens. `privacyStatus` is always private; setting `publishAt` or requesting public/unlisted release is rejected. The existing five-channel covenant alone is **not** an authority to upload a new genre into any of those channels.
5. Inspect locally before the first network call; then create **one** remote resumable session under one durable private state path. The code checks the exact film bytes and verifies the authenticated YouTube channel ID before POST. After POST, save Google's session URI locally and resume using server-acknowledged byte ranges, including after a lost final PUT result. When upload completes, retain the actual YouTube ID even if the provider unexpectedly reports public status or another channel, so remediation is possible. A separately authenticated `videos.list` readback must confirm target channel and private status before the receipt can be treated as received.
6. A private-draft receipt is **not publication**. Public release, audience targeting, thumbnail, accessibility/captions, platform policy review, copyright checks, monetization and audience metrics stay with their own receiving offices. The channel federation observes separately witnessed draft/release receipts rather than treating a private upload as a public view.

## Real operator commands

```sh
# Source spec is produced by Causeway after independent rights/edit review.
node services/public-youtube-channel-federation-service/src/private-video-cli.mjs inspect approved-film-spec.json

# Make no real POST until the specific channel owner authorizes this private draft.
# Supply OAuth from an authorized secure provider, not from a file in this repository.
YOUTUBE_OAUTH_ACCESS_TOKEN='(ephemeral-channel-owner-access-token)' \
  node services/public-youtube-channel-federation-service/src/private-video-cli.mjs \
  start approved-film-spec.json /private/film-001-upload.state --approve-private

# Never replay the start command for an existing state. Query and resume the
# ORIGINAL Google session with the SAME source bytes.
YOUTUBE_OAUTH_ACCESS_TOKEN='(fresh-ephemeral-token)' \
  node services/public-youtube-channel-federation-service/src/private-video-cli.mjs \
  resume approved-film-spec.json /private/film-001-upload.state
```

**Spec shape:** `{ "rendition": <the original MicrodramaLocalRendition>, "review": { "accepted": true, "authority": "...", "reviewRef": "...", "rightsRef": "...", "asset": { "sha256": "<exact-film-hex>" } }, "publication": { "channelId": "<actual UC...>", "consumer": "...", "sourceRef": "sha256:<exact-source-hex>", "authorityRef": "...", "authorizedPrivateDraft": true }, "metadata": { "title": "...", "description": "...", "madeForKids": false, "containsSyntheticMedia": true, "tags": ["original fiction"] } }.` The film path in the original rendition must resolve to actual retained local custody bytes. The operator, not the software, establishes whether its child audience designation is correct.

**Failure boundaries:** If the exclusive state file says `INITIATION_ATTEMPTED` and contains no provider session URI, a POST may have created a remote session before its response was lost. Do not delete the state file or attempt automatic recreation. Reconcile the upload with the account owner; the automated receiver will not guess whether a duplicate video is safe. If a session is saved, `resume` queries that session before uploading any more bytes. If a final video ID was returned but private readback fails, it remains in `BYTES_UPLOADED` with the ID for operator intervention. The session path and OAuth tokens are private; never publish either as GitHub Actions artifacts.

**Account prerequisites:** YouTube uses OAuth 2.0 on behalf of a channel owner (not an ordinary unconfigured Google service account). The upload operation requests the Google Data API's resumable `videos.insert`, with `status.containsSyntheticMedia=true`, explicit audience designation, and private visibility. API projects and channel scopes may require configuration, audit or verification. It is not possible to claim live channel delivery until the authorized credentials, fully accepted original film, and actual readback exist.

## Attach real timed captions and the original poster after PRIVATE video receiving

The current Public Fiction studio also manufactures a private release package (one exact accepted master.mp4, source frame poster.jpg, independently approved multilingual caption SRT/VTT, transcripts, trailer and HLS). The **same existing Public YouTube service** can finish the already private YouTube video with separately admitted original captions and thumbnail, via src/private-film-sidecars.mjs and src/private-film-sidecars-cli.mjs.

This is an additional video metadata/accessibility step, not another publishing route. Every operation requires the source-owned release directory and an actual provider-verified PRIVATE YouTube receipt whose final original-film SHA matches the package. Files are independently rehashed against the existing release manifest before any external POST. The owner must authorize the exact consumer, real YouTube channel ID, final film SHA and original source rights; the OAuth principal's current channel ownership and video's *current private status* are independently checked immediately before upload.

~~~sh
node services/public-youtube-channel-federation-service/src/private-film-sidecars-cli.mjs \
  inspect film-sidecar-spec.json

YOUTUBE_OAUTH_ACCESS_TOKEN='(ephemeral)' \
  node services/public-youtube-channel-federation-service/src/private-film-sidecars-cli.mjs \
  start film-sidecar-spec.json /private/film-en-caption.state --approve-sidecar

YOUTUBE_OAUTH_ACCESS_TOKEN='(fresh-ephemeral)' \
  node services/public-youtube-channel-federation-service/src/private-film-sidecars-cli.mjs \
  reconcile film-sidecar-spec.json /private/film-en-caption.state
~~~

The specification includes releaseRoot (the actual existing private release package directory), privateFilmReceipt (the original verified PRIVATE draft receipt, not a fabricated video ID), kind = captions or poster, language when kind = captions, and authorization with consumer, channelId, authorityRef, approvedPrivateSidecar=true, originalFilmSha256, rightsRef, maxQuotaUnits, and thumbnailEligibilityObserved=true **only when requesting a poster**. Content snippets/tokens are not copied into the spec.

**Caption route:** A source SRT must have a corresponding independent translation/source-language review and rights claim. The uploader chooses a stable original-video + language + exact-caption-SHA name, submits timed media as multipart/related via YouTube captions.insert with isDraft=true, and rechecks captions.list for that source-specific language/name. If the insert response is lost, the exclusive 0600 local attempt is retained and the operator uses reconcile to find the provider track WITHOUT replaying the possibly effective POST. The listed remote caption is evidence of a named track, not proof that YouTube retained identical cue bytes or timecodes; source owner may later compare an actual authorized captions.download response. Captions can be processing/failed; readback status is preserved and additional review may be necessary.

**Poster route:** A source-verified JPEG selected from the actual film is uploaded through YouTube thumbnails.set, but only after the owning channel has independently observed eligibility to use a custom thumbnail. Shorts thumbnails are a conditional feature in 2026 and must not be inferred from YouTube account ownership. A successful thumbnail set response names provider image sizes/URLs; YouTube does not cryptographically attest the uploaded image bytes in readback. If the POST reply is ambiguous, the tool does NOT overwrite/re-upload automatically. Account-owning operations must reconcile the current thumbnail in YouTube Studio.

**Quota and source cost:** A new caption operation requires a currently authorized *estimated* ceiling of at least 502 YouTube Data API quota units (initial captions.list 50, caption insertion 400, confirmation captions.list 50, plus owner/video reads); a poster requires at least an estimated 52 units (thumbnails.set around 50 plus reads). These are NOT Google Flow AI-generation credits and not an actual bank debit. Limits/pricing/eligibility can change; the connected channel account is authoritative. Two caption languages are separate authorized operations. No operation here can publish a video, schedule a release, change privacy to public/unlisted, rewrite the original film, translate dialogue, or generate art. Video publication and real reach still require independent publisher controls.

Official source contracts: https://developers.google.com/youtube/v3/docs/captions/insert ; https://developers.google.com/youtube/v3/docs/captions/list ; https://developers.google.com/youtube/v3/docs/thumbnails/set .

## Science and operational feedback

Reconcile each private draft against **the exact final-film SHA** and producing work, never against a screenshot or plausible title. Compare accepted finished seconds and actual editorial costs with production yields, then independently record public release ID, real channel watch time, completion and next-episode continuation after authorized public distribution. A private video is not public reach and never indicates a sale. Google Flow subscription credits and distinct Gemini Developer API dollars are different cost units; neither determines realized customer profitability without observed conversion and downstream expense.

Official protocol: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol . Published video resource fields, synthetic-media disclosure and private status: https://developers.google.com/youtube/v3/docs/videos .
