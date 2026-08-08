import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ACTOR = "urn:ame:emsweb-video-federation";
