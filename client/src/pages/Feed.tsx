import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Tweet, timeAgo } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquareText, ExternalLink, Heart, Repeat2, MessageCircle } from "lucide-react";

// highlight $cashtags inside tweet text
function renderText(text: string) {
  const parts = text.split(/(\$[A-Za-z]{1,6}(?:\.[A-Za-z]{1,2})?)/g);
  return parts.map((p, i) =>
    /^\$[A-Za-z]/.test(p)
      ? <span key={i} className="text-primary font-medium font-mono">{p}</span>
      : <span key={i}>{p}</span>
  );
}

export default function Feed() {
  const { data: tweets, isLoading } = useQuery<Tweet[]>({ queryKey: ["/api/tweets"], queryFn: async () => (await apiRequest("GET", "/api/tweets?limit=80")).json() });
  const list = Array.isArray(tweets) ? tweets : [];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-xl font-semibold flex items-center gap-2"><MessageSquareText className="h-5 w-5 text-primary" /> 트윗 피드</h1>
        <p className="text-sm text-muted-foreground mt-1">수집된 최신 트윗입니다. $티커는 강조 표시됩니다.</p>
      </header>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : list.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">수집된 트윗이 없습니다.</Card>
      ) : (
        <div className="space-y-2">
          {list.map((t) => (
            <Card key={t.tweetId} className="p-4" data-testid={`feed-tweet-${t.tweetId}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-mono text-primary">@{t.handle}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">{timeAgo(t.tweetedAt)}</span>
                  {t.url && <a href={t.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" /></a>}
                </div>
              </div>
              <p className="text-sm leading-snug">{renderText(t.text)}</p>
              <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground tabular-nums">
                <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{t.likeCount}</span>
                <span className="flex items-center gap-1"><Repeat2 className="h-3 w-3" />{t.retweetCount}</span>
                <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{t.replyCount}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
