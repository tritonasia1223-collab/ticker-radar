/** Supabase shared pooler: use transaction mode for short-lived Vercel workers. */
export function runtimeDatabaseUrl(connectionString: string, serverless: boolean) {
  if (!serverless) return connectionString;
  const url = new URL(connectionString);
  if (url.hostname.endsWith(".pooler.supabase.com") && (url.port || "5432") === "5432") {
    url.port = "6543";
    return url.toString();
  }
  return connectionString;
}
