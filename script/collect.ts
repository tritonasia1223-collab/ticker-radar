// Local/worker collection runner.
//
// Collection calls Apify's run-sync (tens of seconds to minutes) and writes to
// Supabase, so it cannot run on Vercel's serverless functions. Run it here:
//
//   npm run collect
//
// Requires DATABASE_URL and APIFY_TOKEN in .env. Can be scheduled via cron /
// Windows Task Scheduler / GitHub Actions for periodic collection.
import "dotenv/config";
import { collectAll } from "../server/apify";

collectAll()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  })
  .catch((e) => {
    console.error("collect failed:", e);
    process.exit(1);
  });
