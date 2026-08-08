import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { a2aResultParts, sendRmnTask } from "@red-cup-engineering/a2a-rmn-task-client-service";
import { agentCardSignatureEvidence } from "@red-cup-engineering/a2a-agent-card-discovery-service";
import { extractRmnPart, userRmnMessage } from "@red-cup-engineering/a2a-rmn-part-service";
import {
  addressChannelPortfolioRecord,
  channelPortfolioStatusRequestBytes,
  channelPortfolioStatusResultFromPart,
} from "@red-cup-engineering/a2a-channel-portfolio-status-service";
import { ACTOR, NODE_ROOT } from "./identity.mjs";

const NI=/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
function covenant(){return JSON.parse(readFileSync(join(NODE_ROOT,"content/config/covenant.json"),"utf8"));}
export function loadChannelStatusDescriptors(path=join(NODE_ROOT,"content/config/channel-status-agents.json")){const registry=JSON.parse(readFileSync(path,"utf8"));if(registry?.type!=="FiveChannelStatusAgentRegistry"||registry.version!==1||registry.transport!=="A2A-1.0-canonical-RMN-CBOR"||!Array.isArray(registry.descriptors))throw new TypeError("channel-status Agent registry is malformed");return registry.descriptors.map(value=>({...value}));}
function exact(value){if(!value||typeof value!=="object")return false;const{id,...body}=value;try{return id===addressChannelPortfolioRecord(body).id;}catch{return false;}}
function civilDay(value){return /^\d{4}-\d{2}-\d{2}$/u.test(value??"");}

export function createChannelStatusClient({descriptors=[],send=sendRmnTask,cardEvidence=agentCardSignatureEvidence,timeoutMs=120_000}={}){
  const lines=covenant().lines, expected=new Set(lines.map(line=>line.channel));
  if(!Array.isArray(descriptors)||descriptors.length!==lines.length||new Set(descriptors.map(value=>value?.channel)).size!==lines.length||descriptors.some(value=>!expected.has(value?.channel)))throw new TypeError("channel-status client requires one exact descriptor per covenant channel");
  const byChannel=new Map();
  for(const descriptor of descriptors){if(typeof descriptor.agentUrl!=="string"||!descriptor.agentUrl.endsWith("/.well-known/agent-card.json")||!NI.test(descriptor.expectedAgentCardIdentity??""))throw new TypeError("channel-status descriptor requires a standard Agent Card URL and pinned signed identity");byChannel.set(descriptor.channel,Object.freeze({...descriptor}));}
  const authenticated=new WeakMap();
  async function requestStatus(channel,day){if(!expected.has(channel)||!civilDay(day))throw new TypeError("channel-status request requires an exact covenant channel and civil day");const descriptor=byChannel.get(channel),requestBody={type:"ChannelPortfolioStatusRequest",federation:ACTOR,channel,civilDay:day,timezone:"America/Chicago"},request=addressChannelPortfolioRecord(requestBody),message=userRmnMessage(channelPortfolioStatusRequestBytes(request),"channel-portfolio-status-request.rmn.cbor",randomUUID()),exchange=await send({agentUrl:descriptor.agentUrl,message,requireSignature:true,signal:AbortSignal.timeout(timeoutMs)}),identity=cardEvidence(exchange.agentCard).card;
    if(identity!==descriptor.expectedAgentCardIdentity)throw new TypeError("channel-status Agent Card identity does not match the contracted channel");const output=extractRmnPart(a2aResultParts(exchange.result)),result=channelPortfolioStatusResultFromPart(output),delivery=result?.delivery;if(result?.disposition!=="status"||result.request!==request.id||!exact(delivery)||delivery.type!=="Accept"||delivery.actor!==channel||delivery.target!==ACTOR||!exact(delivery.object)||delivery.object.type!=="ChannelPortfolioStatus"||delivery.object.channel!==channel||delivery.object.civilDay!==day)throw new TypeError("channel-status result does not bind the exact request and delivery");authenticated.set(delivery,{channel,civilDay:day,request:request.id,agentCardIdentity:identity,inputNi:exchange.inputNi,outputNi:exchange.outputNi});return delivery;
  }
  async function collectPortfolioDeliveries(day){if(!civilDay(day))throw new TypeError("portfolio collection requires a civil day");const deliveries=await Promise.all(lines.map(line=>requestStatus(line.channel,day)));if(new Set(deliveries.map(value=>value.actor)).size!==lines.length)throw new TypeError("portfolio collection repeated a channel delivery");return deliveries;}
  async function verifyDelivery(delivery){const evidence=authenticated.get(delivery);return evidence?.channel===delivery?.actor&&evidence?.civilDay===delivery?.object?.civilDay&&evidence?.agentCardIdentity===byChannel.get(delivery?.actor)?.expectedAgentCardIdentity;}
  function evidenceFor(delivery){const evidence=authenticated.get(delivery);return evidence?{...evidence}:null;}
  return Object.freeze({requestStatus,collectPortfolioDeliveries,verifyDelivery,evidenceFor});
}
