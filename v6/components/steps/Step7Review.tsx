"use client";

import { useEffect, useMemo, useState } from "react";
import { KEY_NOTICE } from "@/lib/ai/anthropic";
import type { Claim } from "@/lib/claim/types";
import { calculateScenarios } from "@/lib/engine/fault-scenarios";
import { PARTIAL_NOTE, TO_COUNTERPARTY_NOTE, UNCALCULATED_STATUS, buildReview, totalText, type Review } from "@/lib/report/review";
import { clearChecked, loadChecked, saveChecked } from "@/lib/state/checklist";
import { askFacts } from "@/lib/ui/askFacts";
import { ASSUMPTION_TEXT, standardFillable, unknownLabels, withAssumptions } from "@/lib/ui/flow";
import { asOfText, lawsByIds, todaySeoul } from "@/lib/law/data";
import { AskTerms, NeedsUpdate } from "../ai/AskTerms";
import { manwon } from "../fields";

// MASTER.md 8장 보상 검토서(7단계). 위에서 결론(세 숫자·받을 곳별), 아래로 근거(담보·시나리오·입력 필요·서류·다음 할 일).
// 화면·엑셀·PDF가 같은 검토서 모델(lib/report/review.ts)을 쓴다. 모델의 글자는 모두 개인정보 가림을 거친다.

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

function Big({ label, value, sub, tone, partial = false }: { label: string; value: number; sub?: string; tone?: "estimate" | "burden"; partial?: boolean }) {
  const color = tone === "estimate" ? "border-estimate-line bg-estimate text-estimate-ink" : tone === "burden" ? "border-ink bg-white text-ink" : "border-ink bg-ink text-white";
  return (
    <div className={`rounded-2xl border-2 px-4 py-3 ${color}`}>
      <p className="text-sm font-bold">{label}</p>
      <p className="text-3xl font-bold tracking-tight">{totalText(manwon(value), partial)}</p>
      <p className="text-sm font-semibold opacity-90">
        {totalText(won(value), partial)}
        {sub ? ` · ${sub}` : ""}
      </p>
      {partial && (
        <p className="text-sm font-bold" data-partial>
          {PARTIAL_NOTE}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-lg font-bold">{title}</h3>
      {children}
    </section>
  );
}

const box = "rounded-2xl border-2 border-line bg-white";

/** 담보 한 줄: 금액 세 칸은 나란히(390px에서도 숫자가 꺾이지 않게), 계산식·조항은 펼쳐 본다. 면책 사유는 늘 보인다 */
/** 라운드 9: 0원이고 사유도 없는 지급 줄은 숨긴다(보여 줄 내용이 없다) */
const emptyLine = (line: Review["cards"][number]["lines"][number]) => line.status === "지급" && !line.exclusion && line.confirmed === 0 && line.withEstimates === 0;

function Line({ line }: { line: Review["cards"][number]["lines"][number] }) {
  return (
    <li className="py-3">
      <p className="font-bold">
        {line.label}{" "}
        <span className="text-sm font-semibold text-ink-soft">
          · {line.payer}
          {line.status !== "지급" ? ` · ${line.status}` : ""}
        </span>
      </p>
      {line.status === UNCALCULATED_STATUS ? (
        // 라운드 9c: 앱이 계산하지 않은 줄은 0원 대신 사유를 보인다
        <p className="mt-2 rounded-lg border-2 border-ink px-3 py-2 text-sm font-bold" data-uncalculated>
          {UNCALCULATED_STATUS}: {line.formula}
        </p>
      ) : (
      <dl className="mt-2 grid grid-cols-3 gap-2 text-right">
        <div>
          <dt className="text-xs font-bold">확정</dt>
          <dd className="font-bold tabular-nums">{line.confirmed.toLocaleString("ko-KR")}</dd>
        </div>
        <div className="text-estimate-ink">
          <dt className="text-xs font-bold">추정 포함</dt>
          <dd className="font-bold tabular-nums">{line.withEstimates.toLocaleString("ko-KR")}</dd>
        </div>
        <div className="text-estimate-ink">
          <dt className="text-xs font-bold">추정분</dt>
          <dd className="font-bold tabular-nums">{line.estimatePart.toLocaleString("ko-KR")}</dd>
        </div>
      </dl>
      )}
      {line.exclusion && <p className="mt-2 text-sm font-bold">면책 사유: {line.exclusion}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-bold">계산식·약관 조항</summary>
        {line.formula && <p className="mt-1 text-sm font-semibold">{line.formula}</p>}
        <p className="mt-1 text-xs font-semibold text-ink-soft">약관 조항: {line.basis}</p>
        {line.flags.map((f) => (
          <p key={f} className="mt-1 text-xs font-bold text-estimate-ink">
            · {f}
          </p>
        ))}
      </details>
    </li>
  );
}

/**
 * 라운드 9e: 카드의 판단에 쓴 법령 조문(review.cards[].laws). 앱에 든 원문(data/laws)이 있으면 원문과 기준일,
 * 없거나 180일이 넘으면 "원문 갱신 필요". 법령 API는 부르지 않는다(칸 PC에서 npm run laws:fetch로 받아 넣는다).
 */
function CardLaws({ ids }: { ids: string[] }) {
  const laws = lawsByIds(ids, todaySeoul());
  if (!laws.length) return null;
  return (
    <div className="mt-3 border-t-2 border-line pt-2 text-sm font-semibold" data-laws>
      <p className="text-xs font-bold text-ink-soft">근거 법령</p>
      <ul className="mt-1 space-y-1">
        {laws.map(({ ref, record, stale }) => (
          <li key={ref.id} data-law={ref.id}>
            {record ? (
              <details>
                <summary className="cursor-pointer font-bold">
                  {record.lawName} {record.heading}
                  {stale && <NeedsUpdate />}
                </summary>
                <p className="mt-1 whitespace-pre-line text-xs">{record.text}</p>
                <p className="mt-1 text-xs text-ink-soft" data-law-asof>
                  {asOfText(record)}
                </p>
              </details>
            ) : (
              <p>
                {ref.lawName} {ref.label}
                <NeedsUpdate />
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

type SaveState = { kind: "xlsx" | "pdf"; status: "working" | "error"; message?: string } | null;

/** 브라우저에서 파일로 내려받는다(인쇄 창이 아니라 다운로드) */
function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function saveReview(review: Review, kind: "xlsx" | "pdf") {
  // 파일 이름에는 사고일과 과실만 넣는다(개인정보 없음)
  const name = `보상검토서_${review.accident.date === "모름" ? "사고일모름" : review.accident.date}_내과실${review.faultPercent}`;
  if (kind === "xlsx") {
    const { reviewToXlsx } = await import("@/lib/export/excel");
    download(await reviewToXlsx(review), `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return;
  }
  const { PDF_FONT_FILES, reviewToPdf } = await import("@/lib/export/pdf");
  const font = async (file: string) => {
    const response = await fetch(`/fonts/${file}`);
    if (!response.ok) throw new Error(`글꼴을 불러오지 못했습니다(${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const [regular, bold] = await Promise.all([font(PDF_FONT_FILES.regular), font(PDF_FONT_FILES.bold)]);
  download(await reviewToPdf(review, { regular, bold }), `${name}.pdf`, "application/pdf");
}

export function Step7Review({ claim: input, goTo }: { claim: Claim; goTo: (screenId: string, anchor?: string) => void }) {
  // 상대 차량 보험의 '모름'은 일반적 가입 기준으로 채워 계산한다(입력값은 그대로, 라운드 9)
  const { claim, assumptions } = useMemo(() => withAssumptions(input), [input]);
  const results = useMemo(() => calculateScenarios(claim), [claim]);
  const [index, setIndex] = useState(0);
  // 이 화면은 브라우저에서만 그려진다(Wizard가 localStorage를 읽은 뒤). 그래서 처음 값으로 바로 읽어도 된다
  const [checked, setChecked] = useState<string[]>(() => loadChecked());
  const [checkSaved, setCheckSaved] = useState(true);
  const review = useMemo(() => buildReview(claim, results, index, unknownLabels(claim), checked, assumptions.map((k) => ASSUMPTION_TEXT[k])), [claim, results, index, checked, assumptions]);
  const toggle = (key: string, on: boolean) => {
    const next = on ? [...checked.filter((k) => k !== key), key] : checked.filter((k) => k !== key);
    setChecked(next);
    setCheckSaved(saveChecked(next));
  };
  const fillable = useMemo(() => standardFillable(claim), [claim]);
  // 라운드 9b: 키 만료 7일 전부터 맨 아래에 작게 안내한다(만료 뒤에는 각 기능이 '준비 중'을 보여 준다)
  const [keySoon, setKeySoon] = useState(false);
  useEffect(() => {
    fetch("/api/ai-status")
      .then((r) => r.json())
      .then((d: { state?: string }) => setKeySoon(d.state === "soon"))
      .catch(() => {});
  }, []);
  const [saving, setSaving] = useState<SaveState>(null);

  const save = async (kind: "xlsx" | "pdf") => {
    setSaving({ kind, status: "working" });
    try {
      await saveReview(review, kind);
      setSaving(null);
    } catch (error) {
      setSaving({ kind, status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="space-y-5">
      {/* 고지는 화면을 내려도 맨 위에 붙어 있다 */}
      <p className="sticky top-0 z-10 rounded-xl border-2 border-estimate-line bg-estimate px-4 py-2 font-bold text-estimate-ink">{review.notice}</p>

      {results.length > 1 && (
        <div>
          <p className="mb-2 text-sm font-bold">과실을 몰라 네 경우로 계산했습니다. 내 과실:</p>
          <div className="grid grid-cols-4 gap-2" role="tablist">
            {results.map((r, i) => (
              <button key={r.faultPercent} type="button" role="tab" aria-selected={i === index} className={`min-h-11 rounded-xl border-2 font-bold ${i === index ? "border-ink bg-ink text-white" : "border-line bg-white"}`} onClick={() => setIndex(i)}>
                {r.faultPercent}%
              </button>
            ))}
          </div>
        </div>
      )}

      {review.blocked ? (
        <p className="rounded-xl border-2 border-ink bg-white p-4 font-bold">{review.blocked}</p>
      ) : (
        <div className="space-y-2">
          <Big label="확정 기준 받을 돈" value={review.top.receiveConfirmed} sub="서류로 확인한 금액만" partial={review.top.receivePartial} />
          <Big label="추정 포함 받을 돈" partial={review.top.receivePartial} value={review.top.receiveWithEstimates} sub={review.top.receiveEstimatePart ? `추정분 ${manwon(review.top.receiveEstimatePart)}` : undefined} tone="estimate" />
          <Big label="내가 낼 돈" value={review.top.burdenWithEstimates} sub={review.top.burdenConfirmed !== review.top.burdenWithEstimates ? `확정 기준 ${manwon(review.top.burdenConfirmed)}` : undefined} tone="burden" />
          {review.top.toCounterparty > 0 && (
            <div data-to-counterparty>
              <p className="text-sm font-bold">내 보험이 상대방에게 줄 돈(추정 포함)*: {totalText(manwon(review.top.toCounterparty), review.top.toCounterpartyPartial)}</p>
              {review.top.toCounterpartyPartial && <p className="text-xs font-bold">{PARTIAL_NOTE}</p>}
              <p className="text-xs font-semibold text-ink-soft">* {TO_COUNTERPARTY_NOTE}</p>
            </div>
          )}
          {review.uncalculated.length > 0 && (
            <p className="rounded-xl border-2 border-ink bg-white px-4 py-2 text-sm font-bold" data-uncalculated-summary>
              {UNCALCULATED_STATUS} {review.uncalculated.length}건: {review.uncalculated.map((u) => `${u.card} ${u.label} — ${u.text}`).join(" / ")}
            </p>
          )}
        </div>
      )}

      {/* 지급기준으로 채울 수 있는 칸(라운드 5 보완 B) */}
      {fillable.length > 0 && (
        <div className="rounded-2xl border-2 border-estimate-line bg-estimate p-4 text-estimate-ink">
          <p className="font-bold">지급기준으로 채울 수 있는 칸이 {fillable.length}개 있어요</p>
          <p className="mt-1 text-sm font-semibold">{fillable.map((f) => f.label).join(" · ")}</p>
          <button type="button" className="mt-3 min-h-11 rounded-xl bg-estimate-ink px-4 font-bold text-white" onClick={() => goTo(fillable[0].screenId, `loss-${fillable[0].code}`)}>
            지급기준으로 채우기
          </button>
        </div>
      )}

      <div>
        <div className="grid grid-cols-2 gap-2">
          {(["xlsx", "pdf"] as const).map((kind) => (
            <button key={kind} type="button" disabled={saving?.status === "working"} className="min-h-12 rounded-xl border-2 border-ink bg-white font-bold disabled:opacity-50" onClick={() => save(kind)}>
              {saving?.kind === kind && saving.status === "working" ? "만드는 중…" : kind === "xlsx" ? "엑셀로 저장" : "PDF로 저장"}
            </button>
          ))}
        </div>
        {saving?.status === "error" && <p className="mt-2 text-sm font-bold">저장하지 못했습니다: {saving.message}</p>}
        <p className="mt-2 text-xs font-semibold text-ink-soft">파일은 이 기기에만 저장됩니다. 주민번호·증권번호·차량번호·전화번호는 가려서 넣습니다.</p>
      </div>

      <Section title="계산 기준">
        <ul className={`${box} space-y-1 p-4 text-sm font-semibold`}>
          {review.standards.map((s) => (
            <li key={s}>· {s}</li>
          ))}
        </ul>
      </Section>

      <Section title={review.byPayer.some((p) => p.partial) ? `받을 곳별 · ${PARTIAL_NOTE}` : "받을 곳별"}>
        <ul className={`divide-y-2 divide-line ${box}`}>
          {review.byPayer.map((p) => (
            <li key={p.payer} className="px-4 py-3 font-bold">
              <span className="block">{p.payer}</span>
              <span className="mt-1 flex justify-between text-sm">
                <span>확정</span>
                <span>{totalText(manwon(p.confirmed), p.partial)}</span>
              </span>
              <span className="flex justify-between text-sm text-estimate-ink">
                <span>추정 포함</span>
                <span>{totalText(manwon(p.withEstimates), p.partial)}</span>
              </span>
            </li>
          ))}
          {review.uncalculated.map((u) => (
            <li key={`${u.card}:${u.label}`} className="px-4 py-3 font-bold" data-uncalculated-payer>
              <span className="block">
                {u.payer} <span className="text-sm font-semibold text-ink-soft">({u.card})</span>
              </span>
              <span className="mt-1 flex justify-between text-sm">
                <span>{u.label}</span>
                <span>{UNCALCULATED_STATUS}</span>
              </span>
            </li>
          ))}
          {review.byPayer.length === 0 && review.uncalculated.length === 0 && <li className="px-4 py-3 font-semibold">아직 받을 돈이 계산되지 않았습니다.</li>}
        </ul>
      </Section>

      <Section title="사람·물건별 담보">
        <div className="space-y-3">
          {review.cards.map((card) => (
            <section key={card.label} className={`${box} p-4`} data-card={card.label}>
              <h4 className="text-lg font-bold">{card.label}</h4>
              <p className="text-sm font-semibold text-ink-soft">
                실제손해 {manwon(card.actualLoss.confirmed)}
                {card.actualLoss.withEstimates !== card.actualLoss.confirmed && <span className="text-estimate-ink"> / {manwon(card.actualLoss.withEstimates)}</span>}
                {/* 라운드 9c: 미계산 줄이 있으면 남은 손해를 '보상 안 됨'으로 보이지 않는다 */}
                {card.lines.some((l) => l.status === UNCALCULATED_STATUS)
                  ? ` · 나머지 ${manwon(card.uncovered.withEstimates)}은 ${UNCALCULATED_STATUS}`
                  : card.uncovered.withEstimates > 0 && ` · 보상 안 되는 손해 ${manwon(card.uncovered.withEstimates)}`}
              </p>
              <ul className="mt-1 divide-y-2 divide-line">
                {card.lines.filter((line) => !emptyLine(line)).map((line) => (
                  <Line key={`${line.label}:${line.payer}`} line={line} />
                ))}
              </ul>
              {card.notes.map((n) => (
                <p key={n} className="mt-2 text-sm font-semibold text-estimate-ink">
                  · {n}
                </p>
              ))}
              <CardLaws ids={card.laws} />
            </section>
          ))}
        </div>
      </Section>

      {review.burdens.length > 0 && (
        <Section title="내가 낼 돈 내역">
          <ul className={`divide-y-2 divide-line ${box}`}>
            {review.burdens.map((b) => (
              <li key={b.label} className="px-4 py-3">
                <p className="flex justify-between gap-2 font-bold">
                  <span>{b.label}</span>
                  <span className="shrink-0">{manwon(b.withEstimates)}</span>
                </p>
                <p className="text-xs font-semibold text-ink-soft">
                  {b.formula} · {b.basis}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {review.scenarios.length > 1 && (
        <Section title="과실 시나리오">
          <div className={`${box} overflow-hidden text-sm`}>
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 border-b-2 border-ink px-3 py-2 text-xs font-bold">
              <span>경우</span>
              <span className="text-right">받을 돈 확정</span>
              <span className="text-right text-estimate-ink">추정 포함</span>
              <span className="text-right">내가 낼 돈</span>
            </div>
            {review.scenarios.map((s) => (
              <div key={s.label} className={`grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 border-b border-line px-3 py-2 font-bold tabular-nums last:border-b-0 ${s.faultPercent === review.faultPercent ? "bg-surface" : ""}`}>
                <span>{s.label.replace("내 과실 ", "")}</span>
                <span className="text-right">{totalText(manwon(s.receiveConfirmed), s.receivePartial)}</span>
                <span className="text-right text-estimate-ink">{totalText(manwon(s.receiveWithEstimates), s.receivePartial)}</span>
                <span className="text-right">{manwon(s.burdenWithEstimates)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {review.missing.length > 0 && (
        <Section title="입력 필요">
          <ul className={`${box} space-y-1 p-4 text-sm font-semibold`}>
            {review.missing.map((m) => (
              <li key={m}>· {m}</li>
            ))}
          </ul>
        </Section>
      )}

      {review.checklist.length > 0 && (
        <Section title="필요 서류 체크리스트">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-ink-soft">{checkSaved ? "체크한 서류는 이 기기에 저장됩니다." : "이 기기에 저장하지 못했습니다. 체크는 이 화면에서만 유지됩니다."}</p>
              <button
                type="button"
                className="min-h-11 shrink-0 rounded-xl border-2 border-line bg-white px-3 text-sm font-bold disabled:opacity-40"
                disabled={checked.length === 0}
                onClick={() => {
                  setChecked([]);
                  setCheckSaved(clearChecked());
                }}
              >
                체크 초기화
              </button>
            </div>
            {review.checklist.map((group) => (
              <fieldset key={`${group.payer}:${group.coverage}`} className={`${box} p-4`}>
                <legend className="px-1 font-bold">
                  {group.payer} · {group.coverage}
                </legend>
                {group.docs.map((d) => (
                  <label key={d.key} className="flex min-h-11 items-start gap-3 py-1 text-sm font-semibold">
                    <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-ink" checked={d.checked} onChange={(e) => toggle(d.key, e.target.checked)} />
                    <span>
                      {d.label} <span className="text-ink-soft">(약관 제27조 {d.clause27}호)</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </Section>
      )}

      <Section title="다음 할 일">
        <ol className={`${box} list-decimal space-y-1 py-4 pr-4 pl-9 text-sm font-semibold`}>
          {review.nextSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </Section>

      <AskTerms facts={askFacts(claim, assumptions, review)} productLine={claim.myPolicy.productLine} />

      {review.notices.length > 0 && (
        <section className="space-y-1 text-sm font-semibold text-ink-soft">
          {review.notices.map((n) => (
            <p key={n}>※ {n}</p>
          ))}
        </section>
      )}
      {keySoon && (
        <p className="text-xs font-semibold text-ink-soft" data-key-notice>
          {KEY_NOTICE}
        </p>
      )}
    </div>
  );
}
