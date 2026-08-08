import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const EMSWEB = "/home/emsenn/info/lib/emsenn/services/561-group/services/public-services-section/services/personal-services-section/emsenn-services-section/services/emsenn-web-services-section/services";
const UNITS = [
  ["mathematics-youtube-channel-enterprise", "emsweb-mathematics-portfolio-status.service"],
  ["youtube-channel-enterprise", "emsweb-emsenn0-portfolio-status.service"],
  ["climate-youtube-channel-enterprise", "emsweb-climate-portfolio-status.service"],
  ["artificial-intelligence-youtube-channel-enterprise", "emsweb-artificial-intelligence-portfolio-status.service"],
  ["modern-business-youtube-channel-enterprise", "emsweb-modern-business-portfolio-status.service"],
];

test("each durable status face can persist its exact A2A and WitnessJournal effects", () => {
  for (const [directory, unit] of UNITS) {
    const source = readFileSync(resolve(EMSWEB, directory, "content/deployment/systemd-user", unit), "utf8");
    assert.match(source, /^ProtectSystem=strict$/mu);
    const grant = source.match(/^ReadWritePaths=(.+)$/mu)?.[1] ?? "";
    for (const path of ["data/a2a", "data/witnessJournal", "data/rmn", "data/projections"]) {
      assert.ok(grant.split(/\s+/u).includes(resolve(EMSWEB, directory, path)), `${unit} lacks ${path}`);
    }
    assert.ok(!grant.split(/\s+/u).includes(resolve(EMSWEB, directory, "data")), `${unit} grants ambient settlement-data writes`);
  }
});
