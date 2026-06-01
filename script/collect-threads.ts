// Local/worker Threads collection runner. Collects posts for accounts whose
// platform = "threads" and writes to the same Supabase tables as X.
//
//   npm run collect:threads
//
// Requires DATABASE_URL and APIFY_TOKEN in .env.
import "dotenv/config";
import { collectThreads } from "../server/threads.js";

collectThreads()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  })
  .catch((e) => {
    console.error("collect:threads failed:", e);
    process.exit(1);
  });
