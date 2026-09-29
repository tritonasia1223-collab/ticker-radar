import { createHash } from "node:crypto";
import { config } from "../../shared/credit/schema.js";

export const configHash = () => createHash("sha256").update(JSON.stringify(config)).digest("hex");
