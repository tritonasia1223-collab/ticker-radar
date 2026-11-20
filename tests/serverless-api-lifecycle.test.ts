import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  release: vi.fn(),
  work: Promise.resolve(),
  entered: () => {},
}));
vi.mock("../server/storage.js", () => ({
  configureServerlessDatabase: () => {},
  databasePoolMode: () => "transaction",
  withDatabaseRequest: async (work: () => Promise<void>) => { try { await work(); } finally { fixture.release(); } },
}));
vi.mock("../server/routes.js", () => ({
  registerRoutes: (app: any) => app.get("/test", async (_req: any, res: any) => {
    fixture.entered();
    await fixture.work;
    res.json({ ok: true });
  }),
}));
import handler from "../api/index";

afterEach(() => fixture.release.mockClear());

async function setup() {
  let finishWork!: () => void, entered!: () => void;
  fixture.work = new Promise<void>(resolve => { finishWork = resolve; });
  const routeEntered = new Promise<void>(resolve => { entered = resolve; });
  fixture.entered = entered;
  let invocation: Promise<void> | undefined;
  const server = createServer((req, res) => { invocation = handler(req as any, res as any); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}/test`, routeEntered, finishWork,
    invocation: () => invocation!,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

it("keeps the serverless promise and DB lease alive until the async Express route ends", async () => {
  const t = await setup();
  try {
    const response = fetch(t.url);
    await t.routeEntered;
    let returned = false;
    void t.invocation().then(() => { returned = true; });
    await Promise.resolve();
    expect(returned).toBe(false);
    expect(fixture.release).not.toHaveBeenCalled();
    t.finishWork();
    expect(await (await response).json()).toEqual({ ok: true });
    await t.invocation();
    expect(fixture.release).toHaveBeenCalled();
  } finally { await t.close(); }
});

it("does not release a running DB operation just because the browser disconnected", async () => {
  const t = await setup(), abort = new AbortController();
  try {
    const response = fetch(t.url, { signal: abort.signal });
    await t.routeEntered;
    abort.abort();
    await expect(response).rejects.toThrow();
    expect(fixture.release).not.toHaveBeenCalled();
    t.finishWork();
    await t.invocation();
    expect(fixture.release).toHaveBeenCalled();
  } finally { await t.close(); }
});
