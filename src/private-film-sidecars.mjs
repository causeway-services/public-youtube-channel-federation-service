/**
 * Finish an ALREADY VERIFIED PRIVATE YouTube film with real captions and an
 * original source-film poster, through YouTube Data API.
 *
 * The input is Causeway's existing content-addressed private release package.
 * Each actual file is rehashed here. No generated art, translation, publishing,
 * new media inventory, or credential store. The provider does NOT attest
 * uploaded subtitle/media bytes in its list responses.
 *
 * https://developers.google.com/youtube/v3/docs/captions/insert
 * https://developers.google.com/youtube/v3/docs/captions/list
 * https://developers.google.com/youtube/v3/docs/thumbnails/set
 */
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,realpathSync,statSync,openSync,closeSync,writeFileSync,
 renameSync,rmSync} from 'node:fs';
import {resolve,join,relative,sep,isAbsolute} from 'node:path';
import {parseSubtitles,measureSubtitleCue} from '@red-cup-engineering/computer-text-content-engineering-services-section/subtitles';
import {bindMediaCell} from '@red-cup-engineering/signcell/media-cell';
import {address as signCellAddress} from '@red-cup-engineering/signcell/cell';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const insist=(yes,msg)=>{if(!yes)throw new TypeError(msg)};
const text=(v,label,max=2048)=>{
 insist(typeof v==='string'&&v.trim()&&v.length<=max,label+' requires bounded text');
 return v.trim();
};
const SHA=/^[a-f0-9]{64}$/u;
const VIDEO=/^[a-zA-Z0-9_-]{11}$/u;
const CHANNEL=/^UC[a-zA-Z0-9_-]{22}$/u;
const LANG=/^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,3}$/u;
const TITLE=/^561-[a-zA-Z0-9-]{2,30}-[a-f0-9]{16}$/u;
const auth=token=>({Authorization:'Bearer '+text(token,'temporary OAuth access token',10000)});
const json=async(response,label)=>{
 let result;
 try{result=await response.json()}catch{throw new Error(label+' did not return JSON')}
 insist(result!==null&&typeof result==='object'&&!Array.isArray(result),
  'invalid provider '+label+' response');
 return result;
};
const readActualAsset=(root,row)=>{
 insist(row&&typeof row.path==='string'&&!row.path.includes('\\')&&
  !row.path.split('/').some(part=>!part||part==='.'||part==='..'),
  'malformed accepted release asset path');
 const path=realpathSync(join(root,row.path));
 const rel=relative(root,path);
 insist(rel&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel),
  'release asset leaves its own accepted custody root');
 const info=statSync(path);
 insist(info.isFile()&&info.size===row.bytes&&info.size<=50_000_000,
  'source asset has wrong size or provider upload ceiling');
 const bytes=readFileSync(path);
 insist(SHA.test(row.sha256)&&sha(bytes)===row.sha256,
  'source release media bytes changed');
 return {path,bytes};
};
const saveState=(file,object,initial=false)=>{
 const value=JSON.stringify(object,null,2)+'\n';
 if(initial){
  const fd=openSync(file,'wx',0o600);
  try{writeFileSync(fd,value)}finally{closeSync(fd)}
  return;
 }
 const tmp=file+'.tmp-'+randomUUID(),fd=openSync(tmp,'wx',0o600);
 try{writeFileSync(fd,value);renameSync(tmp,file)}
 finally{closeSync(fd);rmSync(tmp,{force:true})}
};
const readState=file=>{
 const obj=JSON.parse(readFileSync(file,'utf8'));
 insist(obj?.type==='YouTubePrivateFilmSidecarAttempt'&&obj.version===1&&
  ['POST_ATTEMPTED','PROVIDER_RESPONDED','PROVIDER_READBACK'].includes(obj.state),
  'unrecognized private film sidecar state');
 return obj;
};
/**
 * Separate channel authorization and quota for captions/thumbnail actions.
 * This does not let the script assume Shorts thumbnail feature entitlement.
 * Caption insert is listed at 400 quota units and each caption listing at 50;
 * thumbnail set around 50. These are estimates, NOT observed account charges.
 */
export function preparePrivateFilmSidecar({releaseRoot,privateFilmReceipt,
 kind,language=null,authorization}={}){
 const root=realpathSync(resolve(text(releaseRoot,'finished film release directory',4000)));
 const source=readFileSync(join(root,'release.json'));
 insist(source.length<=500000,'release manifest too large for private publishing');
 const m=JSON.parse(source.toString('utf8'));
 insist(m?.type==='MicrodramaReleasePackage'&&m.version===1&&
  m.state==='PRIVATE_MANUFACTURED_NOT_PUBLISHED'&&Array.isArray(m.assets),
  'publisher needs the private source-owned release, not a screenplay');
 const receipt=privateFilmReceipt;
 insist(receipt?.type==='YouTubePrivateFilmDraftReceipt'&&
  receipt.state==='PROVIDER_VERIFIED_PRIVATE_NOT_PUBLIC'&&receipt.privacyStatus==='private',
  'sidecar delivery requires actual private YouTube video receiving');
 insist(CHANNEL.test(receipt.channelId)&&VIDEO.test(receipt.videoId),
  'sidecar receipt lacks exact YouTube channel/video identity');
 insist(m.source?.originalFilmSha256===receipt.outputSha256&&SHA.test(receipt.outputSha256),
  'publisher video is not the same accepted final master');
 const owning=text(m.edition?.consumer,'owning film customer');
 insist(authorization?.consumer===owning,'channel approval cannot transfer consumer rights');
 insist(authorization.channelId===receipt.channelId,
  'sidecar channel authority differs from private film receipt');
 text(authorization.authorityRef,'sidecar receiving authority');
 insist(authorization.approvedPrivateSidecar===true,
  'private film sidecar requires explicit separate authorization');
 insist(authorization.originalFilmSha256===receipt.outputSha256,
  'channel approval does not identify the exact finished film');
 insist(authorization.rightsRef===m.source.claims?.rightsRef,
  'sidecar rights authorization differs from original film');
 insist(['captions','poster'].includes(kind),'sidecar is captions or poster');
 const units=kind==='captions'?502:52;
 insist(Number.isSafeInteger(authorization.maxQuotaUnits)&&authorization.maxQuotaUnits>=units,
  'separate authorized YouTube quota is required for this sidecar');
 if(kind==='poster')insist(authorization.thumbnailEligibilityObserved===true,
  'Shorts custom thumbnail eligibility requires actual channel observation');
 let file,track=null,name=null,captionSource=null;
 if(kind==='captions'){
  insist(LANG.test(language),'exact caption language required');
  track=m.subtitleLanguages?.find(x=>x.language===language);
  insist(track&&typeof track.reviewRef==='string'&&track.reviewRef.trim()&&
   typeof track.rightsRef==='string'&&track.rightsRef.trim(),
   'requested language has no independent translation/source rights review');
  const entry=m.assets.filter(x=>x.path==='captions/'+language+'.srt');
  insist(entry.length===1&&entry[0].mimeType==='application/x-subrip',
   'one source-owned reviewed SubRip file is required');
  file=readActualAsset(root,entry[0]);
  insist(file.bytes.length>20&&file.bytes.length<2_000_000,
   'YouTube caption upload requires bounded nonempty timed text');
  // Computer Text owns standard SRT/WebVTT syntax, not this network writer.
  // Decode strictly: replacement characters can otherwise obscure actual dialogue.
  let parsed;
  try {
   const utf8=new TextDecoder('utf-8',{fatal:true}).decode(file.bytes);
   parsed=parseSubtitles(utf8);
  } catch(error) {
   throw new TypeError('source-owned SubRip captions are invalid: '+error.message);
  }
  insist(parsed.format==='srt'&&parsed.cues.length>0,
   'source-owned captions must be a genuine SubRip timed-text track');
  const cueIds=new Set();
  let lastCueStartTimeMilliseconds=-1;
  for(const [index,cue] of parsed.cues.entries()) {
   insist(Number.isSafeInteger(cue.start)&&Number.isSafeInteger(cue.end)&&
    cue.start>=0&&cue.end>cue.start&&cue.start>=lastCueStartTimeMilliseconds,
    'SubRip cue timings must be positive and ordered by start time');
   lastCueStartTimeMilliseconds=cue.start;
   insist(cue.id===String(index+1)&&!cueIds.has(cue.id),
    'SubRip cue numbers must be unique and sequential for YouTube upload');
   cueIds.add(cue.id);
   insist(cue.lines.length>0&&cue.lines.some(line=>line.trim()!==''),
    'SubRip cues cannot be empty');
  }
  // An exact-byte source is separately content-addressed from its typed
  // dcterms:format assertion. No rights claim or syntactic parse is proof
  // that any subtitle words are true or that YouTube retained the bytes.
  const carried=bindMediaCell(Uint8Array.from(file.bytes),{
   mediaType:'application/x-subrip',
   formatPredicate:'http://purl.org/dc/terms/format',
   source:{releaseManifestSha256:sha(source),assetPath:entry[0].path,
    subtitleReviewRef:track.reviewRef,rightsRef:track.rightsRef}
  });
  captionSource=Object.freeze({
   type:'StandardsCaptionSourceBinding',schemaVersion:1,
   mediaType:carried.mediaType,
   formatPredicate:'http://purl.org/dc/terms/format',
   sourceContentNi:carried.resource.address,
   formatClaimNi:signCellAddress(carried.formatCell),
   cueCount:parsed.cues.length,
   firstCueStartTimeMilliseconds:parsed.cues[0].start,
   lastCueEndTimeMilliseconds:Math.max(...parsed.cues.map(cue=>cue.end)),
   maximumCharactersPerSecond:Math.max(...parsed.cues.map(cue=>measureSubtitleCue(cue).charactersPerSecond))
  });
  name='561-'+language.replace(/[^a-zA-Z0-9-]/gu,'-').slice(0,30)+'-'+sha(file.bytes).slice(0,16);
  insist(TITLE.test(name),'caption name is not stable');
 }else{
  insist(language===null||language===undefined,'poster does not accept a caption language');
  const entry=m.assets.filter(x=>x.path==='poster.jpg');
  insist(entry.length===1&&entry[0].mimeType==='image/jpeg',
   'one source-owned original frame poster is required');
  file=readActualAsset(root,entry[0]);
  insist(file.bytes.length>=1024&&file.bytes[0]===255&&file.bytes[1]===216&&
   file.bytes[2]===255,'source poster lacks JPEG signature');
 }
 const selection={
  type:'YouTubePrivateFilmSidecarPlan',version:1,
  status:'PRIVATE_SIDECAR_PROPOSED_NOT_SUBMITTED',
  kind,language:kind==='captions'?language:null,
  captionName:name,channelId:receipt.channelId,videoId:receipt.videoId,
  sourceFilmSha256:receipt.outputSha256,assetSha256:sha(file.bytes),
  assetBytes:file.bytes.length,
  releaseManifestSha256:sha(source),
  sourceClaimRef:m.source.claims.independentEditorialReview,
  rightsClaimRef:m.source.claims.rightsRef,
  ...(track?{subtitleReviewRef:track.reviewRef}:{}),
  ...(captionSource?{captionSource}:{}),
  quotaUnitEstimate:units,
  note:'Provider-listed captions/thumbnail do not prove exact uploaded bytes; private video remains private and unmonetized.'
 };
 return Object.freeze({...selection,filePath:file.path,
  fingerprint:sha(Buffer.from(JSON.stringify(selection)))});
}
async function verifySameFile(plan){
 const {filePath,fingerprint,...selection}=plan;
 insist(sha(Buffer.from(JSON.stringify(selection)))===fingerprint,
  'source-owned sidecar plan changed after preparation');
 const actual=readFileSync(plan.filePath);
 insist(actual.length===plan.assetBytes&&sha(actual)===plan.assetSha256,
  'finished-film sidecar source changed before provider write');
 if(plan.kind==='captions'){
  const claimed=plan.captionSource;
  insist(claimed?.type==='StandardsCaptionSourceBinding'&&claimed.schemaVersion===1&&
   claimed.mediaType==='application/x-subrip'&&
   claimed.formatPredicate==='http://purl.org/dc/terms/format'&&claimed.cueCount>0,
   'caption plan lacks standard-data and SignCell source identity');
  // Binding the unchanged bytes and MIME should reproduce the exact upstream
  // source identity even if an outside caller bypassed pure preparation.
  const media=bindMediaCell(Uint8Array.from(actual),{
   mediaType:'application/x-subrip',
   formatPredicate:'http://purl.org/dc/terms/format'
  });
  insist(claimed.sourceContentNi===media.resource.address&&
   claimed.formatClaimNi===signCellAddress(media.formatCell),
   'caption source-byte or format-cell identity disagrees with actual media');
 }
 return actual;
}
async function verifyPrivateVideo({plan,token,fetch}){
 const channels=await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=50',
  {method:'GET',headers:auth(token),redirect:'error'});
 if(!channels.ok)throw new Error('YouTube owner identity HTTP '+channels.status);
 const owners=await json(channels,'channels.list');
 insist(owners.items?.some(x=>x.id===plan.channelId),'current OAuth owner differs from approved channel');
 const endpoint='https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id='+encodeURIComponent(plan.videoId);
 const video=await fetch(endpoint,{method:'GET',headers:auth(token),redirect:'error'});
 if(!video.ok)throw new Error('YouTube private source readback HTTP '+video.status);
 const data=await json(video,'videos.list');
 const item=data.items?.find(x=>x.id===plan.videoId);
 insist(item?.snippet?.channelId===plan.channelId&&item?.status?.privacyStatus==='private',
  'sidecar upload cannot change or address a nonprivate/foreign film');
}
async function providerCaptions({plan,token,fetch}){
 const url='https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId='+
  encodeURIComponent(plan.videoId);
 const response=await fetch(url,{method:'GET',headers:auth(token),redirect:'error'});
 if(!response.ok)throw new Error('YouTube captions.list HTTP '+response.status);
 const rows=(await json(response,'captions.list')).items??[];
 const matching=rows.filter(x=>x.snippet?.videoId===plan.videoId&&
  x.snippet?.language===plan.language&&x.snippet?.name===plan.captionName);
 insist(matching.length<=1,'multiple indistinguishable remote caption tracks require review');
 return matching[0]??null;
}
function captionReceipt(plan,row){
 insist(typeof row?.id==='string'&&row.id.trim(),
  'YouTube caption has no provider track identifier');
 insist(row.snippet?.language===plan.language&&row.snippet?.name===plan.captionName&&
  row.snippet?.videoId===plan.videoId,
  'captions provider record changed its source-bound identity');
 insist(row.snippet?.isDraft!==false,'sidecar captions were not retained as PRIVATE draft');
 return Object.freeze({type:'YouTubePrivateFilmSidecarReceipt',version:1,
  kind:'captions',status:'PROVIDER_LISTED_DRAFT_BYTES_NOT_ATTESTED',
  channelId:plan.channelId,videoId:plan.videoId,
  assetSha256:plan.assetSha256,language:plan.language,
  captionSource:plan.captionSource,
  providerTrackId:row.id,
  providerStatus:row.snippet?.status??'unknown',captionName:plan.captionName,
  note:'Provider lists a source-named track, not a cryptographic proof that its text bytes are identical to the uploaded SRT.'});
}
function thumbnailReceipt(plan,row){
 const sizes=row?.items?.[0];
 insist(sizes&&Object.values(sizes).some(x=>typeof x?.url==='string'),
  'YouTube thumbnails.set did not return actual image metadata');
 return Object.freeze({type:'YouTubePrivateFilmSidecarReceipt',version:1,
  kind:'poster',status:'PROVIDER_THUMBNAIL_RESPONSE_BYTES_NOT_ATTESTED',
  channelId:plan.channelId,videoId:plan.videoId,
  assetSha256:plan.assetSha256,
  reportedSizes:Object.freeze(Object.keys(sizes).filter(x=>typeof sizes[x]?.url==='string')),
  note:'YouTube accepted a thumbnail request but did not attest original image bytes or guarantee Shorts eligibility.'});
}
const multipartCaption=({plan,bytes})=>{
 const boundary='microdrama_'+plan.assetSha256.slice(0,24);
 const metadata={snippet:{videoId:plan.videoId,language:plan.language,
  name:plan.captionName,isDraft:true}};
 const beginning=Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8'+
  '\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+
  '\r\nContent-Type: application/octet-stream\r\n\r\n');
 const ending=Buffer.from('\r\n--'+boundary+'--\r\n');
 return {body:Buffer.concat([beginning,bytes,ending]),
  mimeType:'multipart/related; boundary='+boundary};
};
/**
 * One effect per exclusive custody file. On ambiguous caption POST, resume
 * interrogates captions.list for the deterministic source-bytes language/name
 * rather than POSTing again. Thumbnail POSTs cannot be byte-attested by its
 * API; ambiguous thumbnails remain held for channel-owner reconciliation.
 */
export async function startPrivateFilmSidecar({plan,stateFile,token,fetch=globalThis.fetch}={}){
 insist(plan?.type==='YouTubePrivateFilmSidecarPlan','prepared real source sidecar required');
 insist(typeof fetch==='function','YouTube provider client required');
 const path=resolve(text(stateFile,'private sidecar state',4000));
 const bytes=await verifySameFile(plan);
 await verifyPrivateVideo({plan,token,fetch});
 if(plan.kind==='captions'){
  const existing=await providerCaptions({plan,token,fetch});
  insist(!existing,'the exact named caption is already present; reconcile it, not a duplicate insert');
 }
 const state={type:'YouTubePrivateFilmSidecarAttempt',version:1,
  state:'POST_ATTEMPTED',sourceFingerprint:plan.fingerprint,kind:plan.kind,
  videoId:plan.videoId,assetSha256:plan.assetSha256,channelId:plan.channelId,
  ...(plan.captionSource?{captionSource:plan.captionSource}:{})};
 saveState(path,state,true);
 let response;
 try{
  const upload=plan.kind==='captions'?multipartCaption({plan,bytes}):
   {body:bytes,mimeType:'image/jpeg'};
  const url=plan.kind==='captions'?
   'https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet':
   'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?uploadType=media&videoId='+
     encodeURIComponent(plan.videoId);
  response=await fetch(url,{method:'POST',redirect:'error',
   headers:{...auth(token),'content-type':upload.mimeType,
    'content-length':String(upload.body.length)},body:upload.body});
 }catch{throw new Error('sidecar provider POST outcome unknown; reconcile, never automatically repeat')}
 if(!response.ok)
  throw new Error('YouTube sidecar POST HTTP '+response.status+
   '; reconcile the possibly effective remote operation');
 const body=await json(response,'sidecar upload response');
 if(plan.kind==='captions'){
  // Provider already returned the exact track ID; record it before the
  // subsequent read, preserving identity if a later GET fails.
  insist(typeof body.id==='string'&&body.id.trim(),
   'YouTube did not return the uploaded caption identity');
  saveState(path,{...state,state:'PROVIDER_RESPONDED',remoteId:body.id});
  return reconcilePrivateFilmSidecar({plan,stateFile:path,token,fetch});
 }
 const receipt=thumbnailReceipt(plan,body);
 saveState(path,{...state,state:'PROVIDER_READBACK',receipt});
 return receipt;
}
export async function reconcilePrivateFilmSidecar({plan,stateFile,token,
 fetch=globalThis.fetch}={}){
 insist(plan?.type==='YouTubePrivateFilmSidecarPlan','source package sidecar required');
 const path=resolve(text(stateFile,'private sidecar state',4000));
 await verifySameFile(plan);
 const lock=path+'.lock',fd=openSync(lock,'wx',0o600);
 try{
  const current=readState(path);
  insist(current.sourceFingerprint===plan.fingerprint&&current.kind===plan.kind&&
   current.videoId===plan.videoId&&current.assetSha256===plan.assetSha256&&
   current.channelId===plan.channelId,
   'sidecar state belongs to another accepted source or channel');
  await verifyPrivateVideo({plan,token,fetch});
  if(plan.kind==='poster'){
   insist(current.state==='PROVIDER_READBACK','thumbnail outcome unknown; owner must reconcile in YouTube Studio');
   return current.receipt;
  }
  const track=await providerCaptions({plan,token,fetch});
  insist(track,'YouTube does not yet list the source-named caption; manual reconciliation required');
  if(current.remoteId)insist(track.id===current.remoteId,
   'the remotely listed caption differs from submitted provider ID');
  const receipt=captionReceipt(plan,track);
  saveState(path,{...current,state:'PROVIDER_READBACK',remoteId:track.id,receipt});
  return receipt;
 }finally{closeSync(fd);rmSync(lock,{force:true})}
}