/**
 * PRIVATE draft YouTube upload of real, rights-reviewed cinematic media.
 *
 * No video model invocation, no public release and no credential custody.
 * Google resumable upload sessions are recoverable WITHOUT replaying an
 * uncertain session-initiation POST (which could duplicate a private video).
 *
 * https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 */
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,existsSync,openSync,closeSync,readSync,
  readFileSync,writeFileSync,renameSync,rmSync,realpathSync,statSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';

const UPLOAD='https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const VIDEO_URL='https://www.googleapis.com/youtube/v3/videos';
const CHANNEL_URL='https://www.googleapis.com/youtube/v3/channels';
const HEX=/^[a-f0-9]{64}$/u;
const CHANNEL=/^UC[A-Za-z0-9_-]{22}$/u;
const VIDEO=/^[A-Za-z0-9_-]{11}$/u;
const PART=256*1024;
const MAX_BYTES=2*1024*1024*1024;
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const insist=(ok,message)=>{if(!ok)throw new TypeError(message)};
const txt=(v,label,max=2048)=>{
 insist(typeof v==='string'&&v.trim()&&v.length<=max,label+' requires bounded nonempty text');
 return v.trim();
};
const hash=x=>createHash('sha256').update(x).digest('hex');
const shaFile=async file=>{
 const h=createHash('sha256');
 for await(const block of createReadStream(file))h.update(block);
 return h.digest('hex');
};
const auth=token=>({Authorization:'Bearer '+txt(token,'OAuth token',10000)});
const responseJson=async(response,label)=>{
 let row;
 try{row=await response.json()}catch{throw new Error(label+' did not return JSON')}
 insist(isObject(row),label+' returned malformed JSON');
 return row;
};
const requireUploadSession=raw=>{
 let uri;
 try{uri=new URL(raw)}catch{throw new TypeError('invalid session URI')}
 insist(uri.protocol==='https:'&&uri.hostname==='www.googleapis.com'&&!uri.username&&
  !uri.password&&!uri.port&&uri.pathname==='/upload/youtube/v3/videos'&&
  uri.searchParams.get('uploadType')==='resumable'&&!!uri.searchParams.get('upload_id'),
  'upload session URI is not on the Google YouTube allowlist');
 return uri.href;
};
const writeState=(path,value,initial=false)=>{
 const bytes=JSON.stringify(value,null,2)+'\n';
 if(initial){
  const fd=openSync(path,'wx',0o600);
  try{writeFileSync(fd,bytes)}finally{closeSync(fd)}
  return;
 }
 const tmp=path+'.staging-'+randomUUID();
 const fd=openSync(tmp,'wx',0o600);
 try{writeFileSync(fd,bytes);renameSync(tmp,path)}
 finally{closeSync(fd);rmSync(tmp,{force:true})}
};
const readState=path=>{
 const row=JSON.parse(readFileSync(path,'utf8'));
 insist(row?.type==='YouTubePrivateFilmUpload'&&row.version===1,
  'unexpected private YouTube upload state');
 insist(['INITIATION_ATTEMPTED','SESSION_KNOWN','BYTES_UPLOADED','PRIVATE_RECEIVED'].includes(row.state),
  'unknown private YouTube upload stage');
 return row;
};
const observedRange=(range,length)=>{
 if(range===null)return 0;
 const match=/^bytes=0-(\d+)$/u.exec(range);
 insist(match,'invalid Google acknowledged-byte range');
 const next=Number(match[1])+1;
 insist(Number.isSafeInteger(next)&&next<=length,'remote byte position is outside source video');
 return next;
};

/** Require the ACTUAL rendered MP4, a separate approved final review, a
 * separate source/rights claim, and separately authorized private-draft
 * receiving. This does not authenticate those external office claims. */
export function prepareYouTubePrivateDraft({rendition,review,publication,metadata}={}){
 insist(rendition?.type==='MicrodramaLocalRendition'&&
  rendition.state==='RENDERED_REQUIRES_INDEPENDENT_REVIEW',
  'YouTube needs one actually rendered cinematic film');
 const filmSha=txt(rendition.sha256,'film SHA-256',64);
 insist(HEX.test(filmSha),'invalid film SHA-256');
 insist(review?.accepted===true&&review.asset?.sha256===filmSha,
  'independent accepted final-film review must match the exact rendered MP4');
 for(const key of ['authority','reviewRef','rightsRef'])
  txt(review[key],'film review '+key);
 const channelId=txt(publication?.channelId,'target YouTube channel',100);
 insist(CHANNEL.test(channelId),'invalid YouTube channel identity');
 insist(publication.authorizedPrivateDraft===true,
  'owning channel has not authorized a private draft');
 const consumer=txt(publication.consumer,'customer');
 const authorityRef=txt(publication.authorityRef,'YouTube channel authority');
 const sourceRef=txt(publication.sourceRef,'original screenplay source');
 insist(/^(?:sha256:[a-f0-9]{64}|git:[a-f0-9]{40}|ni:\/\/\/sha-256;[A-Za-z0-9_-]{43})$/u.test(sourceRef),
  'source revision must be exact SHA-256 NI, sha256 or git commit');
 const title=txt(metadata?.title,'video title',100);
 const description=txt(metadata?.description,'video description',5000);
 insist(typeof metadata.madeForKids==='boolean',
  'must explicitly classify whether the video is made for kids');
 insist(metadata.containsSyntheticMedia===true,
  'AI film requires explicit realistic synthetic-media declaration');
 insist(metadata.privacyStatus==null||metadata.privacyStatus==='private',
  'private-draft uploader refuses publication');
 insist(metadata.publishAt==null,'private drafts cannot schedule public releases');
 const tags=metadata.tags??[];
 insist(Array.isArray(tags)&&tags.length<=20&&tags.every(x=>typeof x==='string'&&
   x.trim()&&x.length<=100),'tags must be a bounded array');
 const defaultLanguage=metadata.defaultLanguage??'en';
 insist(/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/u.test(defaultLanguage),'invalid language tag');
 const uploadBody={
  snippet:{title,description,categoryId:'24',defaultLanguage,...(tags.length?{tags}:{})},
  status:{privacyStatus:'private',selfDeclaredMadeForKids:metadata.madeForKids,
   containsSyntheticMedia:true,license:'youtube',embeddable:true}
 };
 const film=realpathSync(resolve(txt(rendition.videoPath,'real film location',4000)));
 const info=statSync(film);
 insist(info.isFile()&&info.size>=1024&&info.size<=MAX_BYTES,
  'source film is not one bounded file');
 const fd=openSync(film,'r'),header=Buffer.alloc(12);
 try{insist(readSync(fd,header,0,12,0)===12&&
  header.subarray(4,8).toString('ascii')==='ftyp',
  'source film must be an ISO base media MP4')}finally{closeSync(fd)}
 const claims={type:'YouTubePrivateFilmDraftClaim',version:1,channelId,
  consumer,authorityRef,sourceRef,reviewRef:review.reviewRef,
  rightsRef:review.rightsRef,editorialAuthority:review.authority,
  filmSha256:filmSha,filmBytes:info.size,uploadBody,
  seriesId:rendition.source?.seriesId??null,
  episodeId:rendition.source?.episodeId??null};
 return Object.freeze({type:'YouTubePrivateFilmDraftPlan',
  state:'PREPARED_NOT_SUBMITTED',
  mediaFile:film,bytes:info.size,filmSha256:filmSha,
  channelId,sourceFingerprint:hash(JSON.stringify(claims)),
  uploadBody:Object.freeze(uploadBody),
  note:'A prepared private upload is neither authenticated rights evidence nor an uploaded or published YouTube video.'});
}
export async function verifyYouTubeDraftFilm(prepared){
 insist(prepared?.type==='YouTubePrivateFilmDraftPlan',
  'a prepared original film is required');
 insist(await shaFile(prepared.mediaFile)===prepared.filmSha256,
  'source media bytes differ from the independently reviewed film');
 return {sha256:prepared.filmSha256,bytes:prepared.bytes};
}
async function verifyOwningChannel({prepared,token,fetch}){
 const response=await fetch(CHANNEL_URL+'?part=id&mine=true&maxResults=50',
  {method:'GET',headers:auth(token),redirect:'error'});
 if(!response.ok)throw new Error('YouTube channel owner check HTTP '+response.status);
 const result=await responseJson(response,'YouTube channels.list');
 insist(result.items?.some(x=>x.id===prepared.channelId),
  'OAuth identity does not own the requested YouTube channel');
}
async function privateReadback({id,prepared,token,fetch}){
 insist(VIDEO.test(id),'provider returned invalid video ID');
 const url=VIDEO_URL+'?part=snippet,status&id='+encodeURIComponent(id);
 const response=await fetch(url,{method:'GET',headers:auth(token),redirect:'error'});
 if(!response.ok)throw new Error('YouTube video readback HTTP '+response.status);
 const data=await responseJson(response,'YouTube videos.list');
 const row=data.items?.find(x=>x.id===id);
 insist(row,'video not yet observable through authorized account');
 insist(row.snippet?.channelId===prepared.channelId,
  'provider readback named a different YouTube channel');
 insist(row.status?.privacyStatus==='private',
  'provider readback did not verify private video status');
 insist(row.status?.containsSyntheticMedia!==false,
  'provider explicitly contradicted mandatory synthetic content disclosure');
 return Object.freeze({
  type:'YouTubePrivateFilmDraftReceipt',version:1,
  state:'PROVIDER_VERIFIED_PRIVATE_NOT_PUBLIC',
  channelId:prepared.channelId,videoId:id,
  outputSha256:prepared.filmSha256,outputBytes:prepared.bytes,
  sourceFingerprint:prepared.sourceFingerprint,
  privacyStatus:'private',
  providerUploadStatus:row.status.uploadStatus??'unknown',
  syntheticMediaDisclosure:row.status.containsSyntheticMedia===true?
   'provider-confirmed':'upload-claim-not-confirmed-in-readback',
  watchUrl:'https://www.youtube.com/watch?v='+id,
  note:'PRIVATE receiving only. No public release, paid settlement, channel audience, verified arts or source rights established.'
 });
}
async function finish({state,path,prepared,token,fetch}){
 insist(VIDEO.test(state.videoId),'uploaded video identity absent');
 // A local source file that mutates during PUTs must not be reported as
 // the exact accepted film. YouTube offers no remote original-SHA readback.
 await verifyYouTubeDraftFilm(prepared);
 const receipt=await privateReadback({id:state.videoId,prepared,token,fetch});
 writeState(path,{...state,state:'PRIVATE_RECEIVED',receipt});
 return receipt;
}
async function handleUploadReply({response,state,path,prepared,token,fetch}){
 if(response.status===200||response.status===201){
  const object=await responseJson(response,'YouTube upload result');
  insist(VIDEO.test(object.id),'provider upload did not name an actual video');
  // Persist the provider's ID BEFORE judging any status conflict. This keeps
  // a dangerous unexpected public result discoverable and makes readback and
  // takedown possible without initiating another video.
  const uploaded={...state,state:'BYTES_UPLOADED',videoId:object.id,
   observedUploadChannel:object.snippet?.channelId??null,
   observedUploadPrivacy:object.status?.privacyStatus??null};
  writeState(path,uploaded);
  insist(!object.snippet?.channelId||object.snippet.channelId===prepared.channelId,
   'upload response channel contradicts approved destination; VIDEO ID RETAINED for remediation');
  insist(!object.status?.privacyStatus||object.status.privacyStatus==='private',
   'upload response contradicts private staging; VIDEO ID RETAINED for remediation');
  return finish({state:uploaded,path,prepared,token,fetch});
 }
 if(response.status!==308)
  throw new Error('YouTube upload held at HTTP '+response.status+
   '; resume the existing session rather than submitting another video');
 return observedRange(response.headers.get('range'),prepared.bytes);
}

/** One possibly effective POST, pre-claimed exclusively on the local disk. */
export async function startYouTubePrivateDraft({prepared,stateFile,token,
 fetch=globalThis.fetch}={}){
 insist(typeof fetch==='function','real YouTube HTTP adapter required');
 const path=resolve(txt(stateFile,'private upload state path',4000));
 await verifyYouTubeDraftFilm(prepared);
 // A read-only OAuth/channel check is safe BEFORE the exclusive claim.
 await verifyOwningChannel({prepared,token,fetch});
 const state={type:'YouTubePrivateFilmUpload',version:1,
  state:'INITIATION_ATTEMPTED',sourceFingerprint:prepared.sourceFingerprint,
  sha256:prepared.filmSha256,bytes:prepared.bytes,
  channelId:prepared.channelId,recordedAt:new Date().toISOString()};
 // This O_EXCL file prevents a second possibly billable/duplicate POST.
 writeState(path,state,true);
 let response;
 try{
  response=await fetch(UPLOAD,{
   method:'POST',redirect:'error',
   headers:{...auth(token),'content-type':'application/json; charset=UTF-8',
    'x-upload-content-length':String(prepared.bytes),
    'x-upload-content-type':'video/mp4'},
   body:JSON.stringify(prepared.uploadBody)});
 }catch{throw new Error('YouTube initiation outcome unknown: never create another session automatically')}
 if(!response.ok)
  throw new Error('YouTube session initiation HTTP '+response.status+
   '; possible remote effect must be reconciled before any new POST');
 const location=response.headers.get('location');
 insist(location,'YouTube did not return a session URI; initiation outcome uncertain');
 const sessionUrl=requireUploadSession(location);
 writeState(path,{...state,state:'SESSION_KNOWN',sessionUrl});
 return resumeYouTubePrivateDraft({prepared,stateFile:path,token,fetch});
}
/**
 * Retake NO POSTs. Always query the existing remote upload session first,
 * recover remote committed byte offset from 308 Range, then stream only
 * outstanding bytes. The final PUT is queryable even after a lost response.
 */
export async function resumeYouTubePrivateDraft({prepared,stateFile,token,
 fetch=globalThis.fetch,chunkBytes=8*1024*1024}={}){
 insist(typeof fetch==='function','real YouTube HTTP adapter required');
 insist(Number.isSafeInteger(chunkBytes)&&chunkBytes>=PART&&
  chunkBytes<=32*1024*1024&&chunkBytes%PART===0,
  'chunks must be bounded multiples of 256 KiB');
 const path=resolve(txt(stateFile,'private upload state path',4000));
 await verifyYouTubeDraftFilm(prepared);
 const lock=path+'.lock';
 const fd=openSync(lock,'wx',0o600);
 try{
  const state=readState(path);
  insist(state.sourceFingerprint===prepared.sourceFingerprint&&
   state.sha256===prepared.filmSha256&&state.bytes===prepared.bytes&&
   state.channelId===prepared.channelId,
   'upload custody belongs to another accepted film or channel');
  await verifyOwningChannel({prepared,token,fetch});
  if(state.state==='PRIVATE_RECEIVED'){
   return privateReadback({id:state.receipt.videoId,prepared,token,fetch});
  }
  if(state.state==='BYTES_UPLOADED')
   return finish({state,path,prepared,token,fetch});
  insist(state.state==='SESSION_KNOWN',
   'initiation outcome unknown: DO NOT begin another session');
  const uri=requireUploadSession(state.sessionUrl);
  let response;
  try{
   response=await fetch(uri,{method:'PUT',redirect:'error',
    headers:{...auth(token),'content-length':'0',
     'content-range':'bytes */'+prepared.bytes}});
  }catch{throw new Error('YouTube session status unknown: resume this same upload session')}
  let position=await handleUploadReply({response,state,path,prepared,token,fetch});
  if(typeof position!=='number')return position;
  const file=await open(prepared.mediaFile,'r');
  try{
   while(position<prepared.bytes){
    const length=Math.min(chunkBytes,prepared.bytes-position);
    const buffer=Buffer.allocUnsafe(length);
    let read=0;
    while(read<length){
     const chunk=await file.read(buffer,read,length-read,position+read);
     insist(chunk.bytesRead>0,'source file truncated during upload');
     read+=chunk.bytesRead;
    }
    const end=position+length-1;
    try{
     response=await fetch(uri,{method:'PUT',redirect:'error',
      headers:{...auth(token),'content-type':'video/mp4',
       'content-length':String(length),
       'content-range':'bytes '+position+'-'+end+'/'+prepared.bytes},
      body:buffer});
    }catch{throw new Error('YouTube chunk outcome unknown: resume same session and query remote bytes')}
    const next=await handleUploadReply({response,state,path,prepared,token,fetch});
    if(typeof next!=='number')return next;
    insist(next>position,'remote upload byte count did not advance');
    position=next;
   }
   throw new Error('all bytes acknowledged without video ID; query same session again');
  }finally{await file.close()}
 }finally{
  closeSync(fd);rmSync(lock,{force:true});
 }
}