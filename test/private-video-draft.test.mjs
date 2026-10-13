import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 prepareYouTubePrivateDraft,verifyYouTubeDraftFilm,
 startYouTubePrivateDraft,resumeYouTubePrivateDraft
} from '../src/private-video-draft.mjs';
import {runYouTubePrivateDraftCli} from '../src/private-video-cli.mjs';

const channel='UC'+'A'.repeat(22);
const id='AaBbCcDdEe1';
const session='https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&upload_id=test-session';
const digest=x=>createHash('sha256').update(x).digest('hex');

function inputs(root){
 // File fixture only. Real film provider generations are never invoked.
 const movie=Buffer.alloc(730_000,0x17);
 Buffer.from('000000186674797069736F6D00000000','hex').copy(movie,0);
 const path=join(root,'already-rendered.mp4');
 writeFileSync(path,movie);
 const sha=digest(movie);
 const rendition={type:'MicrodramaLocalRendition',
  state:'RENDERED_REQUIRES_INDEPENDENT_REVIEW',
  videoPath:path,sha256:sha,source:{seriesId:'house-story',episodeId:'episode-one'}};
 const review={accepted:true,asset:{sha256:sha},authority:'review:separate-editor',
  reviewRef:'review:accepted-film',rightsRef:'source:owned-story-license'};
 const publication={channelId:channel,authorizedPrivateDraft:true,
  consumer:'public-fiction',authorityRef:'youtube:owned-channel-authorization',
  sourceRef:'sha256:'+('f'.repeat(64))};
 const metadata={title:'One original AI drama',description:'Original fictional performance. Synthetic media.',
  tags:['AI drama','original fiction'],containsSyntheticMedia:true,madeForKids:false};
 return {movie,path,rendition,review,publication,metadata};
}
const prepare=entry=>prepareYouTubePrivateDraft(entry);
const json=(content,status=200,headers={})=>({
 status,ok:status>=200&&status<300,headers:new Headers(headers),
 json:async()=>content
});
const pending=position=>({
 status:308,ok:false,headers:new Headers(position?{range:'bytes=0-'+(position-1)}:{}),
 json:async()=>null
});
function provider({wrongChannel=false,failFinalAck=false,uploadResponsePublic=false,readbackPublic=false,
  readbackSynthetic=true,readbackMissing=false}={}){
 const calls=[],state={posted:0,committed:0,finished:false,lastRequested:null};
 const fetch=async(url,args)=>{
  calls.push({url,method:args.method,range:args.headers?.['content-range']??null});
  if(url.includes('/youtube/v3/channels')){
   return json({items:wrongChannel?[]:[{id:channel}]});
  }
  if(url.includes('/upload/youtube/v3/videos')&&args.method==='POST'){
   state.posted++;
   assert.equal(args.headers['x-upload-content-type'],'video/mp4');
   const metadata=JSON.parse(args.body);
   assert.equal(metadata.status.privacyStatus,'private');
   assert.equal(metadata.status.containsSyntheticMedia,true);
   assert.equal(metadata.status.selfDeclaredMadeForKids,false);
   return json({},200,{location:session});
  }
  if(url.startsWith(session)&&args.method==='PUT'){
   if(args.headers['content-range'].startsWith('bytes */')){
    if(state.finished)return json({id,status:{privacyStatus:uploadResponsePublic?'public':'private'},snippet:{channelId:channel}},201);
    return pending(state.committed);
   }
   const m=/^bytes (\d+)-(\d+)\/(\d+)$/u.exec(args.headers['content-range']);
   assert.ok(m,'client must send exact byte ranges');
   const first=Number(m[1]),last=Number(m[2]),total=Number(m[3]);
   assert.equal(first,state.committed);
   assert.equal(last-first+1,args.body.byteLength);
   state.lastRequested=last+1;
   assert.ok(total>last);
   state.committed=last+1;
   if(state.committed===total){
    state.finished=true;
    if(failFinalAck){
     failFinalAck=false;
     throw new Error('lost final packet acknowledgement');
    }
    return json({id,status:{privacyStatus:uploadResponsePublic?'public':'private'},snippet:{channelId:channel}},201);
   }
   return pending(state.committed);
  }
  if(url.includes('/youtube/v3/videos')&&args.method==='GET'){
   return json({items:readbackMissing?[]:[{
    id,snippet:{channelId:channel},status:{
     privacyStatus:readbackPublic?'public':'private',
     containsSyntheticMedia:readbackSynthetic,uploadStatus:'uploaded'
    }
   }]});
  }
  throw new Error('unexpected provider request '+url+' '+args.method);
 };
 return {fetch,state,calls};
}

test('only a real final reviewed film and separately authorized private channel passes the gate',async()=>{
 const root=mkdtempSync(join(tmpdir(),'youtube-original-film-'));
 try{
  const entry=inputs(root);
  const packet=prepare(entry);
  assert.equal(packet.state,'PREPARED_NOT_SUBMITTED');
  assert.equal(packet.bytes,entry.movie.length);
  assert.equal(packet.uploadBody.status.privacyStatus,'private');
  assert.equal(packet.uploadBody.status.containsSyntheticMedia,true);
  assert.equal((await verifyYouTubeDraftFilm(packet)).sha256,entry.rendition.sha256);
  assert.throws(()=>prepare({...entry,review:{...entry.review,asset:{sha256:'0'.repeat(64)}}}),
   /exact rendered MP4/u);
  assert.throws(()=>prepare({...entry,publication:{...entry.publication,authorizedPrivateDraft:false}}),
   /authorized a private draft/u);
  assert.throws(()=>prepare({...entry,metadata:{...entry.metadata,privacyStatus:'public'}}),
   /refuses publication/u);
  assert.throws(()=>prepare({...entry,metadata:{...entry.metadata,containsSyntheticMedia:false}}),
   /synthetic-media declaration/u);
  assert.throws(()=>prepare({...entry,metadata:{...entry.metadata,madeForKids:undefined}}),
   /explicitly classify/u);
  writeFileSync(entry.path,Buffer.alloc(730_000));
  await assert.rejects(()=>verifyYouTubeDraftFilm(packet),/source media bytes differ/u);
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('real protocol: private-only single POST, resumable bytes, owned-channel readback and no duplicate on rerun',
 async()=>{
 const root=mkdtempSync(join(tmpdir(),'youtube-private-roundtrip-'));
 try{
  const packet=prepare(inputs(root)),stateFile=join(root,'private-upload.state');
  const p=provider();
  const verified=await startYouTubePrivateDraft({prepared:packet,stateFile,
   token:'mock-OAuth-owner-token',fetch:p.fetch,chunkBytes:262144});
  assert.equal(verified.type,'YouTubePrivateFilmDraftReceipt');
  assert.equal(verified.state,'PROVIDER_VERIFIED_PRIVATE_NOT_PUBLIC');
  assert.equal(verified.privacyStatus,'private');
  assert.equal(verified.sourceFingerprint,packet.sourceFingerprint);
  assert.equal(verified.outputSha256,packet.filmSha256);
  assert.equal(verified.channelId,channel);
  assert.equal(verified.syntheticMediaDisclosure,'provider-confirmed');
  assert.equal(p.state.posted,1);
  assert.equal(p.state.committed,packet.bytes);
  const persisted=JSON.parse(readFileSync(stateFile));
  assert.equal(persisted.state,'PRIVATE_RECEIVED');
  assert.equal(persisted.receipt.videoId,id);
  assert.ok(!JSON.stringify(persisted).includes('mock-OAuth-owner-token'));
  const second=await resumeYouTubePrivateDraft({prepared:packet,stateFile,
   token:'mock-OAuth-owner-token',fetch:p.fetch});
  assert.equal(second.videoId,id);
  assert.equal(p.state.posted,1,'resumes never replay a possibly effective create');
  await assert.rejects(()=>startYouTubePrivateDraft({prepared:packet,stateFile,
   token:'mock-OAuth-owner-token',fetch:p.fetch}),/already exists|EEXIST/u);
  assert.equal(p.state.posted,1,'exclusive local claim also prevents repeated POST');
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('ambiguous last PUT is reconciled by provider status probe, never replaying POST or video bytes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'youtube-uncertain-final-'));
 try{
  const packet=prepare(inputs(root)),stateFile=join(root,'private-upload.state');
  const p=provider({failFinalAck:true});
  await assert.rejects(()=>startYouTubePrivateDraft({
   prepared:packet,stateFile,token:'mock-token',fetch:p.fetch
  }),/outcome unknown/u);
  assert.equal(p.state.committed,packet.bytes);
  assert.equal(p.state.posted,1);
  assert.equal(JSON.parse(readFileSync(stateFile)).state,'SESSION_KNOWN');
  assert.equal(existsSync(stateFile+'.lock'),false,'lock cleaned after ambiguous call');
  const result=await resumeYouTubePrivateDraft({
   prepared:packet,stateFile,token:'mock-token',fetch:p.fetch});
  assert.equal(result.videoId,id);
  assert.equal(p.state.posted,1);
  assert.equal(p.calls.filter(x=>x.method==='PUT'&&
   x.range.startsWith('bytes 0-')).length,1,
   'provider completion query prevents replaying entire media');
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('wrong OAuth channel and provider-public readback are hard failures, not publication successes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'youtube-channel-guard-'));
 try{
  const packet=prepare(inputs(root)),stateFile=join(root,'private-upload.state');
  const bad=provider({wrongChannel:true});
  await assert.rejects(()=>startYouTubePrivateDraft({
   prepared:packet,stateFile,token:'mock',fetch:bad.fetch
  }),/does not own/u);
  assert.equal(existsSync(stateFile),false);
  assert.equal(bad.state.posted,0);
  const wrong=provider({readbackPublic:true});
  await assert.rejects(()=>startYouTubePrivateDraft({
   prepared:packet,stateFile,token:'mock',fetch:wrong.fetch
  }),/did not verify private/u);
  assert.equal(wrong.state.posted,1);
  assert.equal(JSON.parse(readFileSync(stateFile)).state,'BYTES_UPLOADED',
   'upload is retained but NOT declared an accepted private draft');
  const missing=provider({readbackMissing:true});
  await assert.rejects(()=>resumeYouTubePrivateDraft({
   prepared:packet,stateFile,token:'mock',fetch:missing.fetch
  }),/not yet observable/u);
  assert.equal(missing.state.posted,0,'unknown readback does not duplicate creation');
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('uncertain original initiation blocks any automatic replacement upload',async()=>{
 const root=mkdtempSync(join(tmpdir(),'youtube-initiation-unknown-'));
 try{
  const packet=prepare(inputs(root)),stateFile=join(root,'private-upload.state');
  let posts=0;
  const fetch=async(url,args)=>{
   if(url.includes('/channels'))return json({items:[{id:channel}]});
   if(args.method==='POST'){posts++;throw new Error('POST reply lost')}
   throw new Error('No other request possible');
  };
  await assert.rejects(()=>startYouTubePrivateDraft({
   prepared:packet,stateFile,token:'mock',fetch
  }),/initiation outcome unknown/u);
  assert.equal(JSON.parse(readFileSync(stateFile)).state,'INITIATION_ATTEMPTED');
  await assert.rejects(()=>resumeYouTubePrivateDraft({
   prepared:packet,stateFile,token:'mock',fetch
  }),/initiation outcome unknown/u);
  assert.equal(posts,1);
 }finally{rmSync(root,{recursive:true,force:true})}
});
test('operator inspect uses the actual approved MP4 SHA but cannot initiate a video or read secrets',
 async()=>{
 const root=mkdtempSync(join(tmpdir(),'youtube-private-cli-'));
 try{
  const source=inputs(root),spec=join(root,'approved.json');
  const {rendition,review,publication,metadata}=source;
  writeFileSync(spec,JSON.stringify({rendition,review,publication,metadata}));
  const messages=[];
  const result=await runYouTubePrivateDraftCli(['inspect',spec],{
   env:{},write:x=>messages.push(JSON.parse(x))
  });
  assert.equal(result.state,'PREPARED_NOT_SUBMITTED');
  assert.equal(result.sha256,source.review.asset.sha256);
  assert.equal(messages[0].targetPrivacy,'private');
  assert.equal(messages[0].syntheticMediaDeclared,true);
  assert.equal(messages[0].bytes,source.movie.length);
  const onDiskCli=JSON.parse(execFileSync(process.execPath,[
   new URL('../src/private-video-cli.mjs',import.meta.url).pathname,
   'inspect',spec
  ],{encoding:'utf8',timeout:15000}));
  assert.equal(onDiskCli.sha256,result.sha256);
  assert.equal(onDiskCli.targetPrivacy,'private');
  assert.ok(!JSON.stringify(result).includes(source.path),
   'operator preview must not expose private source paths');
  await assert.rejects(()=>runYouTubePrivateDraftCli(['start',spec,
   join(root,'state.json'),'--approve-private'],{env:{},write:()=>{}}),
   /YOUTUBE_OAUTH_ACCESS_TOKEN/u);
  assert.equal(existsSync(join(root,'state.json')),false);
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('unexpected provider PUBLIC upload response persists remote video identity and stops release',async()=>{
 const root=mkdtempSync(join(tmpdir(),'youtube-remote-public-'));
 try{
  const prepared=prepare(inputs(root)),stateFile=join(root,'private-upload.state');
  const p=provider({uploadResponsePublic:true,readbackPublic:true});
  await assert.rejects(()=>startYouTubePrivateDraft({prepared,stateFile,
   token:'mock',fetch:p.fetch}),/VIDEO ID RETAINED/u);
  const saved=JSON.parse(readFileSync(stateFile,'utf8'));
  assert.equal(saved.state,'BYTES_UPLOADED');
  assert.equal(saved.videoId,id);
  assert.equal(saved.observedUploadPrivacy,'public');
  assert.equal(p.state.posted,1);
  await assert.rejects(()=>resumeYouTubePrivateDraft({prepared,stateFile,
   token:'mock',fetch:p.fetch}),/did not verify private/u);
  assert.equal(p.state.posted,1,'never duplicate a dangerous remotely public upload');
 }finally{rmSync(root,{recursive:true,force:true})}
});
