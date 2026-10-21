// Writes one Terraform draft per cloud and network choice, using the same generator the Worker uses,
// so the CI check validates what users actually receive. Sample values only.
// Usage: node service/worker/scripts/write-terraform-samples.mjs <output-folder>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REGIONS, terraformFor } from "../src/index.mjs";

const out = process.argv[2];
if (!out) throw new Error("Give an output folder.");

for (const cloud of ["google", "aws", "azure"]) {
  for (const network of ["new", "existing"]) {
    const intake = {
      region: REGIONS[cloud][0], network, sign_in: "google",
      compliance: "None", expected_users: 400, residency: "United States",
    };
    const dir = join(out, `${cloud}-${network}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "main.tf"), terraformFor(cloud, intake) + "\n");
    console.log(`wrote ${dir}`);
  }
}
