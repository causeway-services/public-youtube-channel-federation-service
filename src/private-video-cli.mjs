#!/usr/bin/env node
/**
 * Actual PRIVATE film delivery only, not a public release operation.
 *
 * inspect SPEC.json
 * start SPEC.json PRIVATE_STATE.json --approve-private
 * resume SPEC.json PRIVATE_STATE.json
 *
 * SPEC is a transport input from approved producing and receiving offices.
 * File names and review claims may be sensitive. OAuth bearer token must be
 * provided ephemerally as YOUTUBE_OAUTH_ACCESS_TOKEN, never inside spec/CLI.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
 prepareYouTubePrivateDraft,verifyYouTubeDraftFilm,
 startYouTubePrivateDraft,resumeYouTubePrivateDraft
} from './private-video-draft.mjs';

function loadSpec(path){
 const filename=resolve(path);
 const text=readFileSync(filename,'utf8');
 if(text.length>100000)throw new TypeError('film receiving spec exceeds 100 KB');
 return JSON.parse(text);
}
export async function runYouTubePrivateDraftCli(argv,{
 env=process.env,write=s=>process.stdout.write(s+'\n')
}={}){
 const [command,specPath,statePath,flag,...remaining]=argv;
 if(!['inspect','start','resume'].includes(command)||!specPath)
  throw new TypeError('usage: inspect SPEC.json | start SPEC.json PRIVATE_STATE.json --approve-private | resume SPEC.json PRIVATE_STATE.json');
 if(command==='inspect'&&argv.length!==2)
  throw new TypeError('usage: inspect SPEC.json');
 if(command==='start'&&(argv.length!==4||flag!=='--approve-private'))
  throw new TypeError('usage: start SPEC.json PRIVATE_STATE.json --approve-private');
 if(command==='resume'&&argv.length!==3)
  throw new TypeError('usage: resume SPEC.json PRIVATE_STATE.json');
 const prepared=prepareYouTubePrivateDraft(loadSpec(specPath));
 await verifyYouTubeDraftFilm(prepared);
 if(command==='inspect'){
  const result={
   type:prepared.type,state:prepared.state,
   channelId:prepared.channelId,sha256:prepared.filmSha256,
   bytes:prepared.bytes,sourceFingerprint:prepared.sourceFingerprint,
   targetPrivacy:prepared.uploadBody.status.privacyStatus,
   syntheticMediaDeclared:prepared.uploadBody.status.containsSyntheticMedia,
   note:'Read-only exact film validation. Does not verify claims of artistic authority, contact YouTube, or publish anything.'
  };
  write(JSON.stringify(result,null,2));
  return result;
 }
 const token=env.YOUTUBE_OAUTH_ACCESS_TOKEN;
 if(typeof token!=='string'||!token.trim())
  throw new TypeError('YOUTUBE_OAUTH_ACCESS_TOKEN is required; never put OAuth credentials in GitHub or manifest');
 const options={prepared,stateFile:statePath,token};
 const receipt=command==='start'?
  await startYouTubePrivateDraft(options):
  await resumeYouTubePrivateDraft(options);
 write(JSON.stringify(receipt,null,2));
 return receipt;
}
if(import.meta.main){
 runYouTubePrivateDraftCli(process.argv.slice(2))
  .catch(error=>{process.stderr.write((error?.message??'Private upload held')+'\n');process.exitCode=1});
}