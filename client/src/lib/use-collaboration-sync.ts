import { useEffect } from "react";
import { acquireCollaboration } from "./cap-collab-client";
export function useCollaborationSync(scope: "capitalism" | "comparison" | "international", ready = true) {
  useEffect(() => ready ? acquireCollaboration(scope) : undefined, [scope, ready]);
}
