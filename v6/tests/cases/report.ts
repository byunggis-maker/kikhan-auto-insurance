import { LOSS_SOURCE_LABELS, PAYER_LABELS, VICTIM_ROLE_LABELS, PROPERTY_ROLE_LABELS, COVERAGE_LABELS } from "@/lib/claim/types";
import { lossItemDef } from "@/lib/claim/lossItems";
import type { Result } from "@/lib/engine/types";
import type { Case } from "./cases";

// 보고서용 표(입력값 표 → 결과 표). 테스트를 REPORT=1로 돌릴 때만 쓴다.

const won = (n: number) => n.toLocaleString("ko-KR");
const cell = (s: string) => s.replace(/\|/g, "／").replace(/\n/g, " ");

export function reportMarkdown(cases: Case[], results: Map<number, Result>): string {
  const out: string[] = [];
  for (const c of cases) {
    const r = results.get(c.no)!;
    const { claim } = c;
    const v = claim.accident.violations;
    out.push(`### 사례 (${c.no}) ${c.title}`, "");
    out.push("**입력값**", "");
    out.push("| 구분 | 값 |", "|---|---|");
    out.push(`| 내 과실 | ${claim.fault.mode === "known" ? `${claim.fault.myPercent}%` : "모름"} |`);
    out.push(`| 사고 유형 | ${claim.accident.type ?? "모름"} |`);
    const flags = [v.drunk && "음주", v.unlicensed && "무면허", v.drugs && "마약", v.fledScene && "도주", v.outsideDriverScope && "운전자 범위 위반", v.driverRelation && `운전자 관계 ${v.driverRelation}`].filter(Boolean);
    out.push(`| 면책·제한 사실 | ${flags.length ? flags.join(", ") : "없음"} |`);
    out.push(`| 내 보험 가입담보 | ${claim.myPolicy.coverages.map((x) => `${COVERAGE_LABELS[x.coverage]}${x.limit !== null ? `(${x.limit === "unlimited" ? "무한" : won(x.limit)})` : x.injuryLimit !== null ? `(부상 ${x.injuryLimit === "unlimited" ? "무한" : won(x.injuryLimit)})` : ""}`).join(", ")} |`);
    out.push(`| 상대 보험 | ${claim.counterpartyPolicy ? claim.counterpartyPolicy.status : "없음"} |`);
    out.push("");
    out.push("| 카드 | 구분 | 급수·관계 | 손해 항목 | 확정 | 추정 |", "|---|---|---|---|---|---|");
    for (const p of claim.victims) {
      const head = `${p.label} | ${VICTIM_ROLE_LABELS[p.role]} | ${p.injuryGrade ?? "-"}급, 관계 ${p.relationToNamedInsured ?? "-"}, 차량운전자 ${p.vehicleDriver === null ? "모름" : p.vehicleDriver ? "예" : "아니오"}${p.rideAlongReductionPercent ? `, 호의동승 ${p.rideAlongReductionPercent}%` : ""}`;
      if (p.losses.length === 0) out.push(`| ${head} | (항목 없음) 합계 칸 | - | ${p.userTotal === null ? "-" : won(p.userTotal)} |`);
      for (const i of p.losses) out.push(`| ${head} | ${lossItemDef(i.code)?.label ?? i.code} | ${i.confirmed === null ? "-" : won(i.confirmed)} | ${i.estimated === null ? "-" : `${won(i.estimated)}(${LOSS_SOURCE_LABELS[i.source.estimated ?? "user_estimate"]})`} |`);
    }
    for (const p of claim.properties) for (const i of p.losses) out.push(`| ${p.label} | ${PROPERTY_ROLE_LABELS[p.role]} | 차량가액 ${p.valueAtAccident === null ? "-" : won(p.valueAtAccident)} | ${lossItemDef(i.code)?.label ?? i.code} | ${i.confirmed === null ? "-" : won(i.confirmed)} | ${i.estimated === null ? "-" : won(i.estimated)} |`);
    out.push("");
    out.push("**결과**", "");
    out.push("| 사람·물건 | 담보 | 지급처 | 확정액 | 추정 포함액 | 추정분 | 계산식 | 약관 조항 |", "|---|---|---|---|---|---|---|---|");
    for (const l of r.lines) {
      const status = l.status === "paid" ? "" : l.status === "excluded" ? "면책·해당 없음: " : l.status === "needs_input" ? "입력 필요: " : "미구현: ";
      const flags = l.flags.length ? ` [${l.flags.join(" / ")}]` : "";
      const alt = l.alternative ? ` (다른 경우: ${l.alternative.label} → ${won(l.alternative.confirmed)} / ${won(l.alternative.withEstimates)})` : "";
      out.push(`| ${l.cardLabel} | ${l.label} | ${PAYER_LABELS[l.payer]} | ${won(l.confirmed)} | ${won(l.withEstimates)} | ${won(l.estimatePart)} | ${cell(status + l.formula + flags + alt)} | ${cell(l.basis)} |`);
    }
    for (const b of r.burdens) out.push(`| 내가 낼 돈 | ${cell(b.label)} | - | ${won(b.confirmed)} | ${won(b.withEstimates)} | ${won(b.estimatePart)} | ${cell(b.formula)} | ${cell(b.basis)} |`);
    for (const n of r.notes) out.push(`| ${n.cardId} | ${n.label}(합계 제외) | - | ${won(n.confirmed)} | ${won(n.withEstimates)} | (비움) | ${cell(n.text)} | ${cell(n.basis)} |`);
    for (const card of r.cards) for (const d of card.details) if (d.source !== "서류") out.push(`| ${card.label} | 손해 항목 ${d.label}(${d.source}) | - | ${won(d.confirmed)} | ${won(d.withEstimates)} | ${won(d.estimatePart)} | ${cell(d.formula)} | - |`);
    for (const card of r.cards) out.push(`| ${card.label} | 실제손해 / 지급 합계 / 보상 안 되는 손해 | - | ${won(card.actualLoss.confirmed)} / ${won(card.paid.confirmed)} / ${won(card.uncovered.confirmed)} | ${won(card.actualLoss.withEstimates)} / ${won(card.paid.withEstimates)} / ${won(card.uncovered.withEstimates)} | - | ${cell(card.notes.join(" "))} | - |`);
    if (r.notices.length) out.push("", `안내: ${r.notices.join(" / ")}`);
    out.push("");
  }
  return out.join("\n");
}
