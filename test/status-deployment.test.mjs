import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const PUBLIC_SERVICES = "/home/emsenn/info/lib/emsenn/services/561-group/services/public-services-section/services";
const UNITS = [
  ["public-education-services-section/services/mathematics-education-services-section/services/mathematics-education-media-services-section/services/mathematics-education-youtube-services-section", "emsweb-mathematics-portfolio-status.service"],
  ["personal-services-section/emsenn-services-section/services/emsenn-web-services-section/services/emsenn-youtube-services-section", "emsweb-emsenn0-portfolio-status.service"],
  ["public-ecological-services-section/services/public-ecological-media-services-section/services/public-ecological-youtube-services", "emsweb-climate-portfolio-status.service"],
  ["public-education-services-section/services/computer-education-services-section/services/artificial-intelligence-education-services-section/services/artificial-intelligence-education-media-services-section/services/artificial-intelligence-education-youtube-services-section", "emsweb-artificial-intelligence-portfolio-status.service"],
  ["public-education-services-section/services/business-education-services-section/services/business-education-media-services-section/services/business-education-youtube-services-section", "emsweb-modern-business-portfolio-status.service"],
];

test("each durable status face can persist its exact A2A and WitnessJournal effects", () => {
  for (const [directory, unit] of UNITS) {
    const serviceRoot = resolve(PUBLIC_SERVICES, directory);
    const source = readFileSync(resolve(serviceRoot, "content/deployment/systemd-user", unit), "utf8");
    assert.match(source, /^ProtectSystem=strict$/mu);
    const grant = source.match(/^ReadWritePaths=(.+)$/mu)?.[1] ?? "";
    for (const path of ["data/a2a", "data/witnessJournal", "data/rmn", "data/projections"]) {
      assert.ok(grant.split(/\s+/u).includes(resolve(serviceRoot, path)), `${unit} lacks ${path}`);
    }
    assert.ok(!grant.split(/\s+/u).includes(resolve(serviceRoot, "data")), `${unit} grants ambient settlement-data writes`);
  }
});
