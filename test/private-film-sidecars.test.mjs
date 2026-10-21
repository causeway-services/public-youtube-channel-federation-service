import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preparePrivateFilmSidecar,startPrivateFilmSidecar,
 reconcilePrivateFilmSidecar} from '../src/private-film-sidecars.mjs';
import {runPrivateFilmSidecarsCli} from '../src/private-film-sidecars-cli.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const channel='UC'+'A'.repeat(22),video='AaBbCcDdEe1';
const response=(obj,status=200)=>({ok:status>=200&&status<300,status,
 json:async()=>obj});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'film-sidecars-'));
 mkdirSync(join(root,'captions'));
 const master=Buffer.concat([Buffer.from('000000186674797069736f6d','hex'),Buffer.alloc(400,0x20)]);
 const poster=Buffer.concat([Buffer.from([255,216,255,224]),Buffer.alloc(2000,0x49)]);
 const captions=Buffer.from('1\n00:00:00,500 --> 00:00:02,000\nAn original line.\n');
 const assets=[['master.mp4','video/mp4',master],['poster.jpg','image/jpeg',poster],
  ['captions/en.srt','application/x-subrip',captions]].map(([path,mimeType,bytes])=>{
  writeFileSync(join(root,path),bytes);
  return {path,mimeType,sha256:hash(bytes),bytes:bytes.length};
 });
 const manifest={type:'MicrodramaReleasePackage',version:1,
  state:'PRIVATE_MANUFACTURED_NOT_PUBLISHED',
  edition:{consumer:'causeway-fiction',language:'en'},
  source:{originalFilmSha256:hash(master),claims:{
   independentEditorialReview:'review:final',
   rightsRef:'rights:original-source'}},
  subtitleLanguages:[{language:'en',reviewRef:'review:original-dialogue',
   rightsRef:'rights:original-dialogue'}],
  assets};
 writeFileSync(join(root,'release.json'),JSON.stringify(manifest));
 const privateFilmReceipt={type:'YouTubePrivateFilmDraftReceipt',
  state:'PROVIDER_VERIFIED_PRIVATE_NOT_PUBLIC',privacyStatus:'private',
  channelId:channel,videoId:video,outputSha256:hash(master)};
 const authorization={consumer:'causeway-fiction',channelId:channel,
  authorityRef:'owner:permission',approvedPrivateSidecar:true,
  originalFilmSha256:hash(master),rightsRef:'rights:original-source',
  maxQuotaUnits:600,thumbnailEligibilityObserved:true};
 return {root,manifest,privateFilmReceipt,authorization};
}
function provider({loseCaptionsResponse=false,losePosterResponse=false,
 privateVideo=true,ownedChannel=true,captionDraft=true}={}){
 const calls=[],state={caption:null,poster:null,captionPosts:0,posterPosts:0};
 async function fetch(url,request){
  calls.push({url,method:request.method});
  if(url.includes('/youtube/v3/channels?')){
   return response({items:ownedChannel?[{id:channel}]:[]});
  }
  if(url.includes('/youtube/v3/videos?')){
   return response({items:[{id:video,snippet:{channelId:channel},
    status:{privacyStatus:privateVideo?'private':'public'}}]});
  }
  if(url.includes('/youtube/v3/captions?')&&request.method==='GET'){
   return response({items:state.caption?[state.caption]:[]});
  }
  if(url.includes('/upload/youtube/v3/captions')&&request.method==='POST'){
   state.captionPosts++;
   assert.match(request.headers['content-type'],/multipart\/related/u);
   const text=request.body.toString('utf8');
   assert.match(text,/An original line\./u);
   assert.match(text,/"isDraft":true/u);
   const tag=/561-en-[a-f0-9]{16}/u.exec(text)?.[0];
   assert.ok(tag);
   state.caption={id:'provider-caption-one',snippet:{
    videoId:video,language:'en',name:tag,isDraft:captionDraft,status:'serving'
   }};
   if(loseCaptionsResponse){
    loseCaptionsResponse=false;
    throw new Error('lost reply after remote effect');
   }
   return response(state.caption);
  }
  if(url.includes('/upload/youtube/v3/thumbnails/set')&&request.method==='POST'){
   state.posterPosts++;
   assert.match(request.headers['content-type'],/image\/jpeg/u);
   assert.equal(request.body[0],255);
   state.poster={items:[{default:{url:'https://i.ytimg.com/vi/AaBbCcDdEe1/default.jpg'}}]};
   if(losePosterResponse)throw new Error('thumbnail reply lost');
   return response(state.poster);
  }
  throw new Error('unexpected YouTube provider request '+url);
 }
 return {fetch,calls,state};
}
test('only original exact release assets can be proposed for source-owned private video',()=>{
 const f=fixture();
 try{
  const args={releaseRoot:f.root,privateFilmReceipt:f.privateFilmReceipt,
   authorization:f.authorization};
  const captions=preparePrivateFilmSidecar({...args,kind:'captions',language:'en'});
  assert.equal(captions.kind,'captions');
  assert.equal(captions.videoId,video);
  assert.equal(captions.quotaUnitEstimate,502);
  assert.match(captions.captionName,/^561-en-[a-f0-9]{16}$/u);
  assert.equal(captions.captionSource.mediaType,'application/x-subrip');
  assert.match(captions.captionSource.sourceContentNi,/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
  assert.match(captions.captionSource.formatClaimNi,/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
  assert.equal(captions.captionSource.cues,1);
  assert.equal(captions.captionSource.firstCueStartTimeMilliseconds,500);
  assert.equal(captions.captionSource.lastCueEndTimeMilliseconds,2000);
  assert.ok(captions.captionSource.maximumCharactersPerSecond>0);
  const poster=preparePrivateFilmSidecar({...args,kind:'poster'});
  assert.equal(poster.quotaUnitEstimate,52);
  assert.equal(poster.assetSha256,f.manifest.assets[1].sha256);
  assert.throws(()=>preparePrivateFilmSidecar({...args,kind:'captions',language:'zh-Hans'}),
   /no independent translation\/source rights/u);
  assert.throws(()=>preparePrivateFilmSidecar({...args,kind:'poster',authorization:{
   ...f.authorization,thumbnailEligibilityObserved:false}}),/eligibility requires actual channel/u);
  assert.throws(()=>preparePrivateFilmSidecar({...args,kind:'captions',language:'en',
   authorization:{...f.authorization,maxQuotaUnits:100}}),/authorized YouTube quota/u);
  assert.throws(()=>preparePrivateFilmSidecar({...args,kind:'poster',
   authorization:{...f.authorization,consumer:'different-rights-holder'}}),/cannot transfer consumer/u);
  assert.throws(()=>preparePrivateFilmSidecar({...args,kind:'poster',
   privateFilmReceipt:{...f.privateFilmReceipt,privacyStatus:'public'}}),/actual private YouTube video/u);
  writeFileSync(join(f.root,'poster.jpg'),Buffer.alloc(2100));
  assert.throws(()=>preparePrivateFilmSidecar({...args,kind:'poster'}),
   /wrong size|bytes changed/u);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test('private caption receives actual source text through one POST and readback, without new duplicated captions',
 async()=>{
 const f=fixture();
 try{
  const plan=preparePrivateFilmSidecar({releaseRoot:f.root,
   privateFilmReceipt:f.privateFilmReceipt,authorization:f.authorization,
   kind:'captions',language:'en'});
  const p=provider(),stateFile=join(f.root,'original-en.state');
  const completed=await startPrivateFilmSidecar({plan,stateFile,token:'owner-token',fetch:p.fetch});
  assert.equal(completed.status,'PROVIDER_LISTED_DRAFT_BYTES_NOT_ATTESTED');
  assert.equal(completed.assetSha256,plan.assetSha256);
  assert.deepEqual(completed.captionSource,plan.captionSource);
  assert.equal(completed.videoId,video);
  assert.equal(completed.providerTrackId,'provider-caption-one');
  assert.equal(p.state.captionPosts,1);
  const saved=JSON.parse(readFileSync(stateFile,'utf8'));
  assert.equal(saved.state,'PROVIDER_READBACK');
  assert.deepEqual(saved.captionSource,plan.captionSource);
  assert.deepEqual(saved.receipt.captionSource,plan.captionSource);
  assert.ok(!JSON.stringify(saved).includes('owner-token'));
  const recovered=await reconcilePrivateFilmSidecar({plan,stateFile,token:'owner-token',fetch:p.fetch});
  assert.equal(recovered.providerTrackId,completed.providerTrackId);
  assert.equal(p.state.captionPosts,1);
  await assert.rejects(()=>startPrivateFilmSidecar({plan,stateFile:join(f.root,'second.state'),
   token:'owner-token',fetch:p.fetch}),/caption is already present/u);
  assert.equal(p.state.captionPosts,1);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test('uncertain caption insert is discovered through read-only captions.list by its exact source-named track',async()=>{
 const f=fixture();
 try{
  const plan=preparePrivateFilmSidecar({releaseRoot:f.root,
   privateFilmReceipt:f.privateFilmReceipt,authorization:f.authorization,
   kind:'captions',language:'en'});
  const p=provider({loseCaptionsResponse:true}),stateFile=join(f.root,'captions.state');
  await assert.rejects(()=>startPrivateFilmSidecar({plan,stateFile,token:'owner-token',fetch:p.fetch}),
   /POST outcome unknown/u);
  assert.equal(JSON.parse(readFileSync(stateFile)).state,'POST_ATTEMPTED');
  const receipt=await reconcilePrivateFilmSidecar({plan,stateFile,token:'owner-token',fetch:p.fetch});
  assert.equal(receipt.providerTrackId,'provider-caption-one');
  assert.equal(p.state.captionPosts,1,'provider recovery must not repeat a create effect');
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test('separate real thumbnail set remains PRIVATE and never falsely attests image bytes',async()=>{
 const f=fixture();
 try{
  const plan=preparePrivateFilmSidecar({releaseRoot:f.root,
   privateFilmReceipt:f.privateFilmReceipt,authorization:f.authorization,
   kind:'poster'});
  const p=provider(),stateFile=join(f.root,'poster.state');
  const result=await startPrivateFilmSidecar({plan,stateFile,token:'owner-token',fetch:p.fetch});
  assert.equal(result.kind,'poster');
  assert.equal(result.status,'PROVIDER_THUMBNAIL_RESPONSE_BYTES_NOT_ATTESTED');
  assert.ok(result.reportedSizes.includes('default'));
  assert.equal(p.state.posterPosts,1);
  const recovered=await reconcilePrivateFilmSidecar({plan,stateFile,token:'owner-token',fetch:p.fetch});
  assert.equal(recovered.assetSha256,plan.assetSha256);
  assert.equal(p.state.posterPosts,1);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test('failed account/privacy and uncertain thumbnail updates never authorize a second POST',async()=>{
 const f=fixture();
 try{
  const plan=preparePrivateFilmSidecar({releaseRoot:f.root,
   privateFilmReceipt:f.privateFilmReceipt,authorization:f.authorization,
   kind:'poster'});
  const bad=provider({privateVideo:false}),stateFile=join(f.root,'poster.state');
  await assert.rejects(()=>startPrivateFilmSidecar({
   plan,stateFile,token:'owner-token',fetch:bad.fetch}),/nonprivate\/foreign film/u);
  assert.equal(bad.state.posterPosts,0);
  const uncertain=provider({losePosterResponse:true});
  await assert.rejects(()=>startPrivateFilmSidecar({
   plan,stateFile,token:'owner-token',fetch:uncertain.fetch}),/POST outcome unknown/u);
  assert.equal(JSON.parse(readFileSync(stateFile)).state,'POST_ATTEMPTED');
  await assert.rejects(()=>reconcilePrivateFilmSidecar({
   plan,stateFile,token:'owner-token',fetch:uncertain.fetch}),/thumbnail outcome unknown/u);
  assert.equal(uncertain.state.posterPosts,1);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test('the real command-line inspect emits redacted source identities without token or media bytes',async()=>{
 const f=fixture();
 try{
  const sourceFile=join(f.root,'source.json');
  writeFileSync(sourceFile,JSON.stringify({releaseRoot:f.root,
   privateFilmReceipt:f.privateFilmReceipt,authorization:f.authorization,
   kind:'captions',language:'en'}));
  const messages=[];
  const output=await runPrivateFilmSidecarsCli(['inspect',sourceFile],{
   env:{},write:x=>messages.push(JSON.parse(x))});
  assert.equal(output.kind,'captions');
  assert.equal(output.sourceFilmSha256,f.privateFilmReceipt.outputSha256);
  assert.equal(output.quotaUnitEstimate,502);
  assert.ok(!JSON.stringify(output).includes(f.root));
  assert.equal(messages.length,1);
  const stdout=execFileSync(process.execPath,[
   new URL('../src/private-film-sidecars-cli.mjs',import.meta.url).pathname,
   'inspect',sourceFile],{encoding:'utf8',timeout:15000});
  assert.equal(JSON.parse(stdout).assetSha256,output.assetSha256);
  await assert.rejects(()=>runPrivateFilmSidecarsCli([
   'start',sourceFile,join(f.root,'state.json'),'--approve-sidecar'
  ],{env:{},write:()=>{}}),/YOUTUBE_OAUTH_ACCESS_TOKEN/u);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
/** Rewrite a fixture's accepted asset and its source manifest, not merely
 * the file: refusal must occur at actual caption-format admission, after
 * a valid source-hash custody check and before any network effect. */
function replaceAcceptedSubRip(f,bytes){
 const payload=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes,'utf8');
 const asset=f.manifest.assets.find(row=>row.path==='captions/en.srt');
 writeFileSync(join(f.root,asset.path),payload);
 asset.bytes=payload.length;
 asset.sha256=hash(payload);
 writeFileSync(join(f.root,'release.json'),JSON.stringify(f.manifest));
}
test('actual YouTube caption preparation refuses invalid UTF-8, empty cues, unordered times and fake arrow tokens before POST',()=>{
 const invalid=[
  {reason:'invalid UTF-8 bytes',bytes:Buffer.from([0xff,0xfe,0x80,0x2d,0x2d,0x3e,0x20,0x61,0x61,0x61,0x61,0x61,0x61,0x61,0x61,0x61,0x61,0x61,0x61,0x61,0x61,0x61]),pattern:/SubRip captions are invalid/u},
  {reason:'fake arrow',bytes:'a'.repeat(30)+' --> fake time\n',pattern:/SubRip captions are invalid/u},
  {reason:'empty timed text',bytes:'1\n00:00:00,000 --> 00:00:02,000\n',pattern:/SubRip cues cannot be empty/u},
  {reason:'backwards cue',bytes:'1\n00:00:04,000 --> 00:00:01,000\nThis is backwards.\n',pattern:/SubRip captions are invalid/u},
  {reason:'unordered start times',bytes:'1\n00:00:03,000 --> 00:00:04,000\nLater first.\n\n2\n00:00:01,000 --> 00:00:02,000\nEarlier second.\n',pattern:/ordered by start time/u},
  {reason:'duplicate cue numbers',bytes:'1\n00:00:00,500 --> 00:00:01,000\nOne.\n\n1\n00:00:01,500 --> 00:00:02,000\nTwo.\n',pattern:/cue numbers must be unique and sequential/u},
  {reason:'WebVTT masquerades as SRT',bytes:'WEBVTT\n\n00:00:00.500 --> 00:00:02.000\nNot a source-owned SubRip file.\n',pattern:/genuine SubRip/u},
 ];
 for(const item of invalid) {
  const f=fixture();
  try{
   replaceAcceptedSubRip(f,item.bytes);
   assert.throws(()=>preparePrivateFilmSidecar({releaseRoot:f.root,
    privateFilmReceipt:f.privateFilmReceipt,authorization:f.authorization,
    kind:'captions',language:'en'}),item.pattern,item.reason);
  }finally{rmSync(f.root,{recursive:true,force:true})}
 }
});
test('source identical caption attempts give the same SignCell media and format identity',()=>{
 const f=fixture();
 try{
  const args={releaseRoot:f.root,privateFilmReceipt:f.privateFilmReceipt,
   authorization:f.authorization,kind:'captions',language:'en'};
  const a=preparePrivateFilmSidecar(args),b=preparePrivateFilmSidecar(args);
  assert.deepEqual(a.captionSource,b.captionSource);
  assert.equal(a.fingerprint,b.fingerprint);
  assert.equal(a.assetSha256,b.assetSha256);
  const bytes=Buffer.from('1\n00:00:00,500 --> 00:00:02,000\nA different line.\n');
  replaceAcceptedSubRip(f,bytes);
  const changed=preparePrivateFilmSidecar(args);
  assert.notEqual(changed.captionSource.sourceContentNi,a.captionSource.sourceContentNi);
  assert.notEqual(changed.captionSource.formatClaimNi,a.captionSource.formatClaimNi);
  assert.notEqual(changed.fingerprint,a.fingerprint);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});

test('post-preparation caption-plan forgery refuses before any YouTube network call',async()=>{
 const f=fixture();
 try{
  const plan=preparePrivateFilmSidecar({releaseRoot:f.root,
   privateFilmReceipt:f.privateFilmReceipt,authorization:f.authorization,
   kind:'captions',language:'en'});
  const tampered={...plan,captionSource:{...plan.captionSource,mediaType:'text/vtt'}};
  let calls=0;
  await assert.rejects(startPrivateFilmSidecar({
   plan:tampered,stateFile:join(f.root,'forged-caption.state'),token:'token',
   fetch:()=>{calls++;return Promise.resolve(response({}));}
  }),/source-owned sidecar plan changed/u);
  assert.equal(calls,0);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
