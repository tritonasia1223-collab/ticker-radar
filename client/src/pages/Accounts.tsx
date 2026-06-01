import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Account, timeAgo } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Trash2, AtSign } from "lucide-react";

const PLATFORM_LABEL: Record<string, string> = { x: "X", threads: "Threads" };

export default function Accounts() {
  const { toast } = useToast();
  const [handle, setHandle] = useState("");
  const [bulk, setBulk] = useState("");
  const [platform, setPlatform] = useState("x");
  const { data: accountsData, isLoading } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const accounts = Array.isArray(accountsData) ? accountsData : [];

  const add = useMutation({
    mutationFn: async (h: string) => (await apiRequest("POST", "/api/accounts", { handle: h, platform })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/accounts"] }); queryClient.invalidateQueries({ queryKey: ["/api/stats"] }); setHandle(""); },
    onError: (e: any) => toast({ title: "추가 실패", description: String(e?.message || e).replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });

  const addBulk = useMutation({
    mutationFn: async (handles: string[]) => {
      let ok = 0, fail = 0;
      for (const h of handles) {
        try { await apiRequest("POST", "/api/accounts", { handle: h, platform }); ok++; } catch { fail++; }
      }
      return { ok, fail };
    },
    onSuccess: (r) => { queryClient.invalidateQueries(); setBulk(""); toast({ title: "일괄 추가 완료", description: `추가 ${r.ok}개 · 건너뜀 ${r.fail}개` }); },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => (await apiRequest("PATCH", `/api/accounts/${id}`, { active })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/accounts"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/accounts/${id}`),
    onSuccess: () => { queryClient.invalidateQueries(); },
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-xl font-semibold flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> 추적 계정</h1>
        <p className="text-sm text-muted-foreground mt-1">게시물을 수집할 X(트위터)·Threads 핸들을 관리합니다. 비활성 계정은 수집에서 제외됩니다.</p>
      </header>

      <Card className="p-4 mb-4">
        <div className="text-sm font-medium mb-2">계정 추가</div>
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); if (handle.trim()) add.mutate(handle.trim()); }}
        >
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="w-32 shrink-0" data-testid="select-platform"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="x">X (트위터)</SelectItem>
              <SelectItem value="threads">Threads</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <AtSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="handle (예: elonmusk)" className="pl-8" data-testid="input-handle" />
          </div>
          <Button type="submit" disabled={add.isPending} data-testid="button-add-account"><Plus className="h-4 w-4 mr-1" /> 추가</Button>
        </form>
        <div className="mt-3">
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={`여러 핸들 일괄 추가 (${PLATFORM_LABEL[platform]}) — 줄바꿈 또는 쉼표로 구분`}
            className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 min-h-[64px] resize-y"
            data-testid="input-bulk"
          />
          <Button
            variant="outline" size="sm" className="mt-2" disabled={addBulk.isPending}
            onClick={() => { const hs = bulk.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean); if (hs.length) addBulk.mutate(hs); }}
            data-testid="button-add-bulk"
          >일괄 추가</Button>
        </div>
      </Card>

      {isLoading ? null : accounts.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">아직 추적 계정이 없습니다. 위에서 핸들을 추가하세요.</Card>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <Card key={a.id} className="p-3 flex items-center gap-3" data-testid={`account-${a.handle}`}>
              <Switch checked={a.active} onCheckedChange={(v) => toggle.mutate({ id: a.id, active: v })} data-testid={`switch-${a.handle}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] shrink-0">{PLATFORM_LABEL[a.platform] ?? a.platform}</Badge>
                  <span className="font-mono text-sm">@{a.handle}</span>
                  {a.displayName && <span className="text-xs text-muted-foreground truncate">{a.displayName}</span>}
                  {!a.active && <Badge variant="secondary" className="text-[10px]">비활성</Badge>}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  마지막 수집 {timeAgo(a.lastSyncedAt)} {a.lastTweetId ? `· 커서 …${a.lastTweetId.slice(-6)}` : "· 미수집"}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => remove.mutate(a.id)} data-testid={`button-delete-${a.handle}`}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
