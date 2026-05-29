import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings as SettingsT, SyncLog, timeAgo } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Settings as SettingsIcon, KeyRound, Database, CheckCircle2, XCircle, Sparkles } from "lucide-react";

export default function Settings() {
  const { toast } = useToast();
  const { data: settings } = useQuery<SettingsT>({ queryKey: ["/api/settings"] });
  const { data: logsData } = useQuery<SyncLog[]>({ queryKey: ["/api/sync-logs"], queryFn: async () => (await apiRequest("GET", "/api/sync-logs?limit=10")).json() });
  const logs = Array.isArray(logsData) ? logsData : [];

  const [token, setToken] = useState("");
  const [actor, setActor] = useState("");
  const [maxPer, setMaxPer] = useState(30);

  useEffect(() => { if (settings) { setActor(settings.actor); setMaxPer(settings.maxTweetsPerHandle); } }, [settings]);

  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/settings", {
      ...(token ? { apifyToken: token } : {}), actor, maxTweetsPerHandle: maxPer,
    })).json(),
    onSuccess: () => { setToken(""); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); toast({ title: "저장됨", description: "설정이 저장되었습니다." }); },
  });

  const seed = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/seed")).json(),
    onSuccess: (r: any) => { queryClient.invalidateQueries(); toast({ title: "더미 데이터 생성", description: `계정 ${r.accounts}개 · 새 트윗 ${r.tweetsNew}건 · 언급 ${r.mentionsNew}건` }); },
  });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-xl font-semibold flex items-center gap-2"><SettingsIcon className="h-5 w-5 text-primary" /> 설정</h1>
        <p className="text-sm text-muted-foreground mt-1">Apify 연동과 수집 옵션을 설정합니다.</p>
      </header>

      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Apify 연동</span>
          {settings?.hasToken
            ? <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> 토큰 {settings.tokenSource === "env" ? "(환경변수)" : "설정됨"}</Badge>
            : <Badge variant="secondary" className="gap-1"><XCircle className="h-3 w-3" /> 토큰 없음</Badge>}
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Apify API 토큰</Label>
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={settings?.hasToken ? "••••••• (저장됨, 변경 시에만 입력)" : "apify_api_..."} data-testid="input-token" />
            <p className="text-[11px] text-muted-foreground mt-1">토큰은 서버 DB에 저장되어 actor 실행에만 사용됩니다. 환경변수 APIFY_TOKEN이 있으면 그것이 우선합니다.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Actor</Label>
              <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="apidojo~tweet-scraper" data-testid="input-actor" />
            </div>
            <div>
              <Label className="text-xs">핸들당 최대 트윗 수</Label>
              <Input type="number" value={maxPer} onChange={(e) => setMaxPer(Number(e.target.value))} data-testid="input-maxper" />
            </div>
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-settings">저장</Button>
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">테스트용 더미 데이터</span>
        </div>
        <p className="text-sm text-muted-foreground mb-3">Apify 호출 없이 동작을 확인할 수 있도록 가짜 계정·트윗·종목 언급을 생성합니다(NVDA 급상승 시나리오 포함).</p>
        <Button variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending} data-testid="button-seed">더미 데이터 생성</Button>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Database className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">최근 수집 로그</span>
        </div>
        {logs.length === 0 ? (
          <div className="text-sm text-muted-foreground">아직 수집 기록이 없습니다.</div>
        ) : (
          <div className="space-y-1.5">
            {logs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-border/50 last:border-0" data-testid={`log-${l.id}`}>
                <StatusBadge status={l.status} />
                <span className="text-muted-foreground text-xs w-20">{timeAgo(l.startedAt)}</span>
                <span className="tabular-nums text-xs flex-1">
                  요청 {l.handlesRequested} · 수집 {l.tweetsFetched} · 신규 {l.tweetsNew} · 언급 {l.mentionsNew}
                  {l.attempts > 1 && <span className="text-amber-500"> · 재시도 {l.attempts}회</span>}
                </span>
                {l.error && <span className="text-[11px] text-destructive truncate max-w-[180px]" title={l.error}>{l.error}</span>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: any }> = {
    success: { label: "성공", variant: "default" },
    partial: { label: "부분", variant: "secondary" },
    failed: { label: "실패", variant: "destructive" },
    running: { label: "실행중", variant: "secondary" },
  };
  const s = map[status] ?? { label: status, variant: "secondary" };
  return <Badge variant={s.variant} className="text-[10px] w-12 justify-center">{s.label}</Badge>;
}
