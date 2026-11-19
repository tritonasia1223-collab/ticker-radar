// 블록체인 학습 탭 — 돈의 행방 패널(§5). 이 탭의 정체성. 수수료가 수취인별로 쪼개져 흐르는
//   생키 스타일. 좌측 '수수료 총액' → 우측 수취인 노드(레이어 색상). 리본 두께 ∝ 비중, 흐름 draw-in.
//   차분한 톤: 과한 반복 애니메이션 대신 값 변경 시 한 번 그려짐. reduced-motion 시 정적.
import { motion, useReducedMotion } from "framer-motion";
import type { FeeSplit } from "@/lib/blockchain-edu/feeEngine";
import { recipientPalette, RECIPIENT_META } from "@/lib/blockchain-edu/layers";
import { fmtUSDprecise, fmtPct } from "@/lib/blockchain-edu/format";

const W = 600, H = 220, PAD = 16;
const SRC_X = 136, DST_X = 452, NODE_W = 132;

export default function MoneyFlowPanel({ splits, flowKey }: { splits: FeeSplit[]; flowKey: string }) {
  const reduce = useReducedMotion();
  const nodes = [...splits].filter((s) => s.amountUSD > 0).sort((a, b) => b.amountUSD - a.amountUSD);
  const total = nodes.reduce((s, x) => s + x.amountUSD, 0);

  if (total <= 0) {
    return <div className="flex h-[120px] items-center justify-center text-[12px] text-muted-foreground">아직 흐를 수수료가 없습니다.</div>;
  }

  const n = nodes.length;
  const slot = (H - 2 * PAD) / n;
  const srcY = H / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 240 }} role="img" aria-label="수수료의 행방 흐름도">
      {/* 리본(흐름) — 먼저 그려 노드 아래 깔림 */}
      {nodes.map((s, i) => {
        const share = s.amountUSD / total;
        const y = PAD + slot * (i + 0.5);
        const pal = recipientPalette(s.recipient);
        const sw = 1.5 + share * 26;
        const d = `M ${SRC_X},${srcY} C ${(SRC_X + DST_X) / 2},${srcY} ${(SRC_X + DST_X) / 2},${y} ${DST_X},${y}`;
        return (
          <motion.path key={`${flowKey}-${s.recipient}`} d={d} fill="none" stroke={pal.solid} strokeWidth={sw}
            strokeOpacity={0.55} strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.55 }}
            transition={{ duration: reduce ? 0 : 0.6, ease: "easeOut", delay: reduce ? 0 : i * 0.06 }} />
        );
      })}

      {/* 좌측: 수취인 총액(소스) */}
      <rect x={16} y={srcY - 24} width={120} height={48} rx={8} fill="hsl(var(--foreground))" opacity={0.9} />
      <text x={76} y={srcY - 5} textAnchor="middle" fontSize={10.5} fill="hsl(var(--background))" opacity={0.85}>수수료 총액</text>
      <text x={76} y={srcY + 12} textAnchor="middle" fontSize={13} fontWeight={700} fill="hsl(var(--background))">{fmtUSDprecise(total)}</text>

      {/* 우측: 수취인 노드 */}
      {nodes.map((s, i) => {
        const share = s.amountUSD / total;
        const y = PAD + slot * (i + 0.5);
        const pal = recipientPalette(s.recipient);
        const meta = RECIPIENT_META[s.recipient];
        return (
          <g key={s.recipient}>
            <rect x={DST_X} y={y - 13} width={NODE_W} height={26} rx={6} fill={pal.soft} stroke={pal.solid} strokeWidth={1} />
            <rect x={DST_X} y={y - 13} width={4} height={26} rx={2} fill={pal.solid} />
            <text x={DST_X + 10} y={y - 1} fontSize={10.5} fontWeight={600} fill={pal.ink}>{meta.label}</text>
            <text x={DST_X + 10} y={y + 10} fontSize={9} fill={pal.ink} opacity={0.8}>
              {fmtUSDprecise(s.amountUSD)} · {fmtPct(share)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
