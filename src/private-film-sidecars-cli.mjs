#!/usr/bin/env node
/** Private film caption/thumbnail finishing, using existing Public YouTube.
 * inspect SPEC.json
 * start SPEC.json PRIVATE_STATE.json --approve-sidecar
 * reconcile SPEC.json PRIVATE_STATE.json
 *
 * Spec references an actual source-owned private release directory and an
 * exact YouTube PRIVATE draft receipt. No OAuth token is stored in that JSON.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {preparePrivateFilmSidecar,startPrivateFilmSidecar,
 reconcilePrivateFilmSidecar} from './private-film-sidecars.mjs';

export async function runPrivateFilmSidecarsCli(argv,{
 env=process.env,write=s=>process.stdout.write(s+'\n'),
 fetch=globalThis.fetch
}={}){
 const [action,specFile,stateFile,approval]=argv;
 if(!['inspect','start','reconcile'].includes(action)||!specFile)
  throw new TypeError('usage: inspect SPEC.json | start SPEC.json PRIVATE_STATE.json --approve-sidecar | reconcile SPEC.json PRIVATE_STATE.json');
 if(action==='inspect'&&argv.length!==2||
  action==='start'&&(argv.length!==4||approval!=='--approve-sidecar')||
  action==='reconcile'&&argv.length!==3)
  throw new TypeError('invalid private film sidecar command/approval');
 const spec=readFileSync(resolve(specFile),'utf8');
 if(spec.length>100000)throw new TypeError('sidecar receiving spec exceeds 100KB');
 const prepared=preparePrivateFilmSidecar(JSON.parse(spec));
 const descriptor={type:prepared.type,status:prepared.status,kind:prepared.kind,
  language:prepared.language,channelId:prepared.channelId,videoId:prepared.videoId,
  sourceFilmSha256:prepared.sourceFilmSha256,assetSha256:prepared.assetSha256,
  assetBytes:prepared.assetBytes,quotaUnitEstimate:prepared.quotaUnitEstimate,
  note:prepared.note};
 if(action==='inspect'){write(JSON.stringify(descriptor,null,2));return descriptor}
 const token=env.YOUTUBE_OAUTH_ACCESS_TOKEN;
 if(typeof token!=='string'||!token.trim())
  throw new TypeError('YOUTUBE_OAUTH_ACCESS_TOKEN must be provided ephemerally');
 const options={plan:prepared,stateFile,token,fetch};
 const result=action==='start'?
  await startPrivateFilmSidecar(options):await reconcilePrivateFilmSidecar(options);
 write(JSON.stringify(result,null,2));return result;
}
if(import.meta.main){
 runPrivateFilmSidecarsCli(process.argv.slice(2)).catch(error=>{
  process.stderr.write((error?.message??'Sidecar held')+'\n');
  process.exitCode=1;
 });
}