"use client";

import { useMemo, useState } from "react";
import { lossItemDef } from "@/lib/claim/lossItems";
import { PAYERS, PAYER_LABELS, type Claim } from "@/lib/claim/types";
import { calculateScenarios } from "@/lib/engine/fault-scenarios";
import type { Result, ResultLine } from "@/lib/engine/types";
import { skippedLabels } from "@/lib/ui/flow";
import { manwon } from "../fields";

// MASTER.md 7장 7단계 결과 미리보기: 맨 위 세 숫자 + 담보 표. 정식 보상 검토서(8장)는 라운드 6.

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

const STATUS_TEXT: Record<ResultLine["status"], string> = { paid: "", excluded: "보상 안 됨", needs_input: "입력 필요", not_implemented: "계산 준비 중" };

function Big({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "estimate" | "burden" }) {
  const color = tone === "estimate" ? "border-estimate-line bg-estimate text-estimate-ink" : tone === "burden" ? "border-ink bg-white text-ink" : "border-ink bg-ink text-white";
  return (
    <div className={`rounded-2xl border-2 p-4 ${color}`}>
      <p className="text-sm font-bold">{label}</p>
      <p className="text-3xl font-bold tracking-tight">{manwon(value)}</p>
      <p className="text-sm font-semibold opacity-90">{won(value)}{sub ? ` · ${sub}` : ""}</p>
    </div>
  );
}

function Summary({ result, claim }: { result: Result; claim: Claim }) {
  if (result.blocked) return <p className="rounded-xl border-2 border-ink bg-white p-4 font-bold">{result.blocked}</p>;
  const { totals } = result;
  const missing = [
    ...skippedLabels(claim).map((label) => `건너뜀: ${label}`),
    ...result.cards.flatMap((card) => card.missing.map((code) => `${card.label}: ${lossItemDef(code)?.label ?? code} 금액(서류)`)),
    ...result.lines.filter((l) => l.status === "needs_input").map((l) => `${l.cardLabel} ${l.label}: ${l.formula}`),
  ];
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Big label="확정 기준 받을 돈" value={totals.receive.confirmed} sub="서류로 확인한 금액만" />
        <Big label="추정 포함 받을 돈" value={totals.receive.withEstimates} sub={`추정분 ${manwon(totals.receive.estimatePart)}`} tone="estimate" />
        <Big label="내가 낼 돈" value={totals.burden.withEstimates} sub={`확정 기준 ${manwon(totals.burden.confirmed)}`} tone="burden" />
        {totals.toCounterparty.withEstimates > 0 && <p className="text-sm font-bold">내 보험이 상대방에게 줄 돈(추정 포함): {manwon(totals.toCounterparty.withEstimates)}</p>}
      </div>

      <section>
        <h3 className="mb-2 text-lg font-bold">받을 곳별</h3>
        <ul className="divide-y-2 divide-line rounded-2xl border-2 border-line bg-white">
          {PAYERS.filter((p) => totals.byPayer[p].withEstimates > 0).map((p) => (
            <li key={p} className="px-4 py-3 font-bold">
              <span className="block">{PAYER_LABELS[p]}</span>
              <span className="mt-1 flex justify-between text-sm">
                <span>확정</span>
                <span>{manwon(totals.byPayer[p].confirmed)}</span>
              </span>
              <span className="flex justify-between text-sm text-estimate-ink">
                <span>추정 포함</span>
                <span>{manwon(totals.byPayer[p].withEstimates)}</span>
              </span>
            </li>
          ))}
          {PAYERS.every((p) => totals.byPayer[p].withEstimates === 0) && <li className="px-4 py-3 font-semibold">아직 받을 돈이 계산되지 않았습니다.</li>}
        </ul>
      </section>

      {result.cards.map((card) => {
        const lines = result.lines.filter((l) => l.cardId === card.cardId);
        return (
          <section key={card.cardId} className="rounded-2xl border-2 border-line bg-white p-4">
            <h3 className="text-lg font-bold">{card.label}</h3>
            <p className="text-sm font-semibold text-ink-soft">
              실제손해 {manwon(card.actualLoss.confirmed)} <span className="text-estimate-ink">/ {manwon(card.actualLoss.withEstimates)}</span> · 보상 안 되는 손해 {manwon(card.uncovered.withEstimates)}
            </p>
            {/* 좁은 화면에서도 숫자가 꺾이지 않게, 담보마다 한 덩어리로 두고 금액 세 칸을 나란히 둔다 */}
            <ul className="mt-3 divide-y-2 divide-line">
              {lines.map((l) => (
                <li key={l.key} className="py-3">
                  <p className="font-bold">
                    {l.label} <span className="text-sm font-semibold text-ink-soft">· {PAYER_LABELS[l.payer]}{l.status !== "paid" ? ` · ${STATUS_TEXT[l.status]}` : ""}</span>
                  </p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-right">
                    <div>
                      <dt className="text-xs font-bold">확정</dt>
                      <dd className="font-bold tabular-nums">{l.confirmed.toLocaleString("ko-KR")}</dd>
                    </div>
                    <div className="text-estimate-ink">
                      <dt className="text-xs font-bold">추정 포함</dt>
                      <dd className="font-bold tabular-nums">{l.withEstimates.toLocaleString("ko-KR")}</dd>
                    </div>
                    <div className="text-estimate-ink">
                      <dt className="text-xs font-bold">추정분</dt>
                      <dd className="font-bold tabular-nums">{l.estimatePart.toLocaleString("ko-KR")}</dd>
                    </div>
                  </dl>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-bold">계산식·근거</summary>
                    <p className="mt-1 text-sm font-semibold">{l.formula}</p>
                    <p className="mt-1 text-xs font-semibold text-ink-soft">{l.basis}</p>
                    {l.flags.map((f) => (
                      <p key={f} className="mt-1 text-xs font-bold text-estimate-ink">· {f}</p>
                    ))}
                  </details>
                </li>
              ))}
            </ul>
            {result.notes.filter((n) => n.cardId === card.cardId).map((n) => (
              <p key={n.key} className="mt-2 text-sm font-semibold">· {n.text}</p>
            ))}
            {card.notes.map((n) => (
              <p key={n} className="mt-2 text-sm font-semibold text-estimate-ink">· {n}</p>
            ))}
          </section>
        );
      })}

      {result.burdens.length > 0 && (
        <section>
          <h3 className="mb-2 text-lg font-bold">내가 낼 돈</h3>
          <ul className="divide-y-2 divide-line rounded-2xl border-2 border-line bg-white">
            {result.burdens.map((b) => (
              <li key={b.key} className="px-4 py-3">
                <p className="flex justify-between font-bold">
                  <span>{b.label}</span>
                  <span>{manwon(b.withEstimates)}</span>
                </p>
                <p className="text-xs font-semibold text-ink-soft">{b.formula} · {b.basis}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {missing.length > 0 && (
        <section>
          <h3 className="mb-2 text-lg font-bold">입력 필요</h3>
          <ul className="space-y-1 rounded-2xl border-2 border-line bg-white p-4 text-sm font-semibold">
            {missing.map((m) => (
              <li key={m}>· {m}</li>
            ))}
          </ul>
        </section>
      )}

      {result.notices.length > 0 && (
        <section className="space-y-1 text-sm font-semibold text-ink-soft">
          {result.notices.map((n) => (
            <p key={n}>※ {n}</p>
          ))}
        </section>
      )}
    </div>
  );
}

export function Step7Review({ claim }: { claim: Claim }) {
  const results = useMemo(() => calculateScenarios(claim), [claim]);
  const [index, setIndex] = useState(0);
  const result = results[Math.min(index, results.length - 1)];
  return (
    <div className="space-y-4">
      <p className="rounded-xl border-2 border-estimate-line bg-estimate px-4 py-3 font-bold text-estimate-ink">추정액이며 확정 금액은 보험사가 정합니다.</p>
      {results.length > 1 && (
        <div>
          <p className="mb-2 font-bold">과실을 몰라 네 경우로 계산했습니다. 내 과실:</p>
          <div className="grid grid-cols-4 gap-2" role="tablist">
            {results.map((r, i) => (
              <button key={r.faultPercent} type="button" role="tab" aria-selected={i === index} className={`min-h-12 rounded-xl border-2 font-bold ${i === index ? "border-ink bg-ink text-white" : "border-line bg-white"}`} onClick={() => setIndex(i)}>
                {r.faultPercent}%
              </button>
            ))}
          </div>
        </div>
      )}
      <Summary result={result} claim={claim} />
    </div>
  );
}
