import path from "node:path";
import { fileURLToPath } from "node:url";

export function artifactPath(input) {
  const original = input instanceof URL ? fileURLToPath(input) : input;
  return process.env.TEST_ARTIFACT_DIR
    ? path.join(process.env.TEST_ARTIFACT_DIR, path.basename(original))
    : original;
}
