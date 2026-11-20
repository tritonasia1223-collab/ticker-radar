import {afterEach,expect,it,vi} from "vitest";
import {DatabaseRequestGate} from "../server/database-lifecycle";
afterEach(()=>vi.useRealTimers());
it("coalesces preflight and never recycles a connection while business requests are active",async()=>{
  const probe=vi.fn(async()=>{}), recycle=vi.fn(async()=>{}), gate=new DatabaseRequestGate(probe,recycle);
  const [a,b]=await Promise.all([gate.acquire(),gate.acquire()]);expect(probe).toHaveBeenCalledTimes(1);
  const c=await gate.acquire();expect(probe).toHaveBeenCalledTimes(1);expect(recycle).not.toHaveBeenCalled();
  a();a();b();c();const release=await gate.acquire();expect(probe).toHaveBeenCalledTimes(2);release();
});
it("recycles a stale socket before handing out a business request",async()=>{
  vi.useFakeTimers();const probe=vi.fn().mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValue(undefined), recycle=vi.fn(async()=>{});
  const gate=new DatabaseRequestGate(probe,recycle,50), acquire=gate.acquire();
  await vi.advanceTimersByTimeAsync(50);const release=await acquire;
  expect(recycle).toHaveBeenCalledTimes(1);expect(probe).toHaveBeenCalledTimes(2);release();
});
it("rejects before any business write if both connection probes fail",async()=>{
  const recycle=vi.fn(async()=>{}),gate=new DatabaseRequestGate(async()=>{throw Error("offline");},recycle);
  await expect(gate.acquire()).rejects.toThrow(/기기 초안/);expect(recycle).toHaveBeenCalledTimes(2);
});
