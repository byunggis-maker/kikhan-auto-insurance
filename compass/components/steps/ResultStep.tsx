"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LawArticles, PrecedentSearch } from "@/components/LawView";
import { ReadAloud } from "@/components/ReadAloud";
import { StepShell } from "@/components/StepShell";
import { TicketBadge, TicketGate } from "@/components/TicketGate";
import { Card, Disclaimer, outlineButton } from "@/components/ui";
import { paidFetch } from "@/lib/guard/paid-client";
import { usePaid } from "@/lib/guard/use-paid";
import { useConsent } from "@/lib/privacy/consent";
import type { CaseDraft } from "@/lib/draft/types";
import { won } from "@/lib/engine/range";
import type { MatrixCell, Range } from "@/lib/engine/types";
import { defaultExplanation, flagText } from "@/lib/explain/default";
import { chunkText, documentSpeech, resultSpeech } from "@/lib/explain/speech-text";
import { buildBook, EXCLUDED_LABEL, STATUS_LABELS } from "@/lib/export/book";
import { computeResult, type Result } from "@/lib/result/compute";
import { COVERAGE_LAWS } from "@/lib/law/catalog";
import { fieldHref } from "@/lib/result/field-link";

// 결과 화면. 금액은 모두 엔진(lib/engine)과 합산 함수(summarize)에서 나온 값을 보여 주기만 한다. 여기서 더하거나 빼지 않는다.

const TTS_CHUNK = 1200;

function Amounts({ amount }: { amount: Range }) {
  // 예상값을 크게 한 줄로, 최소·최대는 그 아래 두 칸에. 좁은 화면에서도 금액이 중간에 끊기지 않는다.
  return (
    <dl className="flex flex-col gap-2">
      <div className="rounded-[14px] bg-navy-soft px-4 py-3">
        <dt className="text-sm text-muted">예상</dt>
        <dd className="num text-2xl font-bold text-navy">{won(amount.expected)}</dd>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(["min", "max"] as const).map((key) => (
          <div key={key} className="rounded-[14px] bg-surface px-3 py-2.5">
            <dt className="text-sm text-muted">{key === "min" ? "최소" : "최대"}</dt>
            <dd className="num whitespace-nowrap text-base font-bold">{won(amount[key])}</dd>
          </div>
        ))}
      </div>
    </dl>
  );
}

/** 맨 위의 총 예상 보험금: 예상값을 크게, 최소~최대를 그 아래에 */
function Total({ title, amount, counted, size = "lg" }: { title: string; amount: Range | null; counted: number; size?: "lg" | "md" }) {
  return (
    <div>
      <p className="text-base font-semibold text-muted">{title}</p>
      {counted === 0 || !amount ? (
        <p className="mt-1 text-lg font-bold">정보 부족: 아직 계산된 담보가 없습니다</p>
      ) : (
        <>
          <p className={`num mt-1 break-all font-bold tracking-tight text-navy ${size === "lg" ? "text-[2.4rem] leading-tight" : "text-3xl"}`}>{won(amount.expected)}</p>
          <p className="num mt-1.5 text-base text-muted">
            {amount.min === amount.max ? "최소·최대가 같습니다" : `최소 ${won(amount.min)} ~ 최대 ${won(amount.max)}`}
          </p>
          <p className="mt-0.5 text-sm text-muted">계산된 담보 {counted}개를 더했습니다</p>
        </>
      )}
    </div>
  );
}

async function download(name: string, type: string, data: BlobPart) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Explained = { status: "idle" | "working" } | { status: "done"; sentences: string[]; source: "llm" | "default" } | { status: "error"; message: string };

/** "왜 이 금액?": 엔진의 내역으로 만든 기본 문장을 보여 주고, 유료 기능을 쓸 수 있고 건강정보 동의가 있으면 쉬운 말 설명을 받을 수 있다 */
function Why({ cell, label, result, canExplain }: { cell: MatrixCell; label: string; result: Result; canExplain: boolean }) {
  const [explained, setExplained] = useState<Explained>({ status: "idle" });
  const basic = defaultExplanation(cell, label);

  async function explain() {
    setExplained({ status: "working" });
    try {
      const response = await paidFetch("explain", "/api/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claim: result.claim, rowId: cell.rowId, columnId: cell.columnId }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.sentences)) throw new Error(typeof body?.error === "string" ? body.error : "설명을 만들지 못했습니다.");
      setExplained({ status: "done", sentences: body.sentences as string[], source: body.source === "llm" ? "llm" : "default" });
    } catch (error) {
      setExplained({ status: "error", message: error instanceof Error ? error.message : "설명을 만들지 못했습니다." });
    }
  }

  return (
    <details className="rounded-xl border border-line">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-navy">왜 이 금액?</summary>
      <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
        {explained.status === "done" && explained.source === "llm" ? (
          <>
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              {explained.sentences.map((sentence, index) => (
                <li key={index}>{sentence}</li>
              ))}
            </ul>
            <p className="text-sm text-muted">쉬운 말 설명입니다. 금액은 계산 결과의 값을 그대로 넣었습니다.</p>
          </>
        ) : (
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            {basic.map((sentence, index) => (
              <li key={index} className="break-words">
                {sentence}
              </li>
            ))}
          </ul>
        )}
        {explained.status === "done" && explained.source === "default" && <p className="text-sm text-muted">쉬운 말 설명을 만들지 못해 계산 내역을 그대로 보여 드립니다.</p>}
        {explained.status === "error" && <p className="rounded-xl bg-warn-soft px-4 py-3 font-semibold text-warn-ink">{explained.message}</p>}
        {canExplain && cell.status === "calculated" && explained.status !== "done" && (
          <button type="button" className={outlineButton} disabled={explained.status === "working"} onClick={explain}>
            {explained.status === "working" ? "설명을 만드는 중…" : "쉬운 말로 풀어 주기"}
          </button>
        )}
      </div>
    </details>
  );
}

function CoverageCard({ cell, label, caseId, result, canExplain }: { cell: MatrixCell; label: string; caseId: string; result: Result; canExplain: boolean }) {
  const amountLines = cell.lines.filter((line) => line.amount);
  return (
    <Card title={label}>
      {cell.status === "calculated" && cell.amount ? (
        <Amounts amount={cell.amount} />
      ) : (
        <div className="rounded-xl bg-navy-soft px-4 py-3">
          <p className="font-bold text-navy">{STATUS_LABELS[cell.status]}</p>
          {cell.reason && <p className="mt-1 break-words">{cell.reason.replace(/^(정보 부족|약관 확인 필요): /, "")}</p>}
        </div>
      )}
      {cell.status === "calculated" && !cell.inTotal && <p className="text-sm text-muted">{EXCLUDED_LABEL}</p>}
      {cell.needsCheckRuleIds.length > 0 && cell.status === "calculated" && (
        <p className="rounded-xl bg-warn-soft px-4 py-2 text-sm font-semibold text-warn-ink">약관 확인 필요: 확인하지 못한 기준이 계산에 들어 있습니다.</p>
      )}
      {cell.flags.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-muted">
          {cell.flags.map((flag) => (
            <li key={flag}>· {flagText(flag)}</li>
          ))}
        </ul>
      )}

      {amountLines.length > 0 && (
        <details className="rounded-xl border border-line">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-navy">항목별 내역</summary>
          <ul className="flex flex-col divide-y divide-line border-t border-line">
            {cell.lines.map((line, index) => (
              <li key={index} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{line.label}</span>
                  <span className="num shrink-0 font-bold">{line.amount ? won(line.amount.expected) : "–"}</span>
                </div>
                <p className="break-words text-sm text-muted">{line.formula}</p>
                {line.flags.map((flag) => (
                  <p key={flag} className="text-sm font-semibold text-warn-ink">
                    {flagText(flag)}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}

      {cell.missing.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">부족 정보</p>
          {cell.missing.map((info, index) => {
            const href = fieldHref(caseId, info.field, cell.rowId);
            return href ? (
              <Link key={index} href={href} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 border-navy px-4 py-2 font-semibold text-navy">
                <span>{info.message}</span>
                <span aria-hidden>→</span>
              </Link>
            ) : (
              <p key={index} className="rounded-xl border border-line px-4 py-2 text-muted">
                {info.message}
              </p>
            );
          })}
        </div>
      )}

      {cell.status !== "not_applicable" && <Why cell={cell} label={label} result={result} canExplain={canExplain} />}

      {cell.basis.length > 0 && (
        <details className="rounded-xl border border-line">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-navy">근거 조항</summary>
          <ul className="flex flex-col gap-1.5 border-t border-line px-4 py-3 text-sm">
            {cell.basis.map((text) => (
              <li key={text} className="break-words">
                {text}
              </li>
            ))}
          </ul>
          {(COVERAGE_LAWS[cell.coverage] ?? []).length > 0 && (
            <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
              <p className="text-sm font-semibold">관련 법령</p>
              <LawArticles refs={COVERAGE_LAWS[cell.coverage] ?? []} />
            </div>
          )}
        </details>
      )}
    </Card>
  );
}

function ResultView({ draft, result }: { draft: CaseDraft; result: Result }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const [notice, setNotice] = useState("");
  // 쉬운 말 설명과 읽어주기는 유료 기능이라 문지기를 통과할 때만 쓴다. 계산 결과와 내려받기는 누구나 쓴다.
  const guest = !usePaid("tts").ready;
  const explainReady = usePaid("explain").ready;
  const consent = useConsent();
  // 설명 요청에는 다친 내용이 들어가므로 건강정보 동의도 있어야 한다.
  const health = explainReady && !!consent?.health;
  const { matrix, summary } = result;
  const [mine, others] = summary.groups;
  const row = matrix.rows.find((candidate) => candidate.id === selected) ?? matrix.rows[0];
  const columnLabel = (id: string) => matrix.columns.find((column) => column.id === id)?.label ?? id;
  // 상대가 있는 사고에서 과실이 한쪽으로 정해지지 않았으면(0%나 100%가 아니거나 아직 모름) 다툼이 될 수 있다.
  const faults = [...result.claim.persons.map((entry) => entry.person.faultPercent), ...result.claim.vehicles.map((entry) => entry.damage.faultPercent)];
  const disputed = draft.accident.kind !== "single" && faults.some((fault) => fault === null || (fault > 0 && fault < 100));

  const summaryChunks = useMemo(() => chunkText(resultSpeech(result), TTS_CHUNK), [result]);
  const documentChunks = useMemo(() => chunkText(documentSpeech(draft.policy), TTS_CHUNK), [draft.policy]);
  const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());

  async function downloadXlsx() {
    setBusy("xlsx");
    setNotice("");
    try {
      const { toXlsx } = await import("@/lib/export/xlsx");
      await download(`예상보험금-${matrix.accidentDate}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", await toXlsx(buildBook(result, today())));
    } catch {
      setNotice("엑셀 파일을 만들지 못했습니다. 다시 눌러 주세요.");
    }
    setBusy(null);
  }

  async function downloadPdf() {
    setBusy("pdf");
    setNotice("");
    try {
      const { summaryLines, summaryPdf } = await import("@/lib/export/pdf");
      const pdf = await summaryPdf(summaryLines(result, today()));
      await download(`예상보험금-${matrix.accidentDate}.pdf`, "application/pdf", pdf.buffer as ArrayBuffer);
    } catch {
      setNotice("PDF 파일을 만들지 못했습니다. 다시 눌러 주세요.");
    }
    setBusy(null);
  }

  return (
    <>
      <Card>
        <Total title="총 예상 보험금 (내가 받을 금액)" amount={mine.total} counted={mine.countedCells} />
        {others.countedCells > 0 && (
          <div className="border-t border-line pt-4">
            <p className="font-semibold text-muted">상대방에게 지급될 예상 금액</p>
            <p className="num mt-1 break-all text-xl font-bold">{won(others.total.expected)}</p>
            <p className="text-sm text-muted">
              최소 {won(others.total.min)} ~ 최대 {won(others.total.max)} · 내가 받을 금액과 더하지 않습니다
            </p>
          </div>
        )}
      </Card>

      {matrix.rows.length === 0 ? (
        <Card>
          <p>정보 부족: 앞 단계에서 다친 사람이나 차량 피해를 입력하면 결과가 표시됩니다.</p>
          <Link href={`/cases/${draft.id}/people`} className={outlineButton}>
            다친 사람·피해 입력하러 가기
          </Link>
        </Card>
      ) : (
        <>
          <div role="tablist" aria-label="사람 선택" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            {matrix.rows.map((candidate) => {
              const on = candidate.id === row?.id;
              return (
                <button
                  key={candidate.id}
                  role="tab"
                  type="button"
                  aria-selected={on}
                  onClick={() => setSelected(candidate.id)}
                  className={`min-h-12 shrink-0 rounded-full border px-5 font-bold ${on ? "border-navy bg-navy text-white shadow-[0_4px_14px_rgb(27_47_107/0.2)]" : "border-line bg-white text-ink"}`}
                >
                  {candidate.label}
                </button>
              );
            })}
          </div>
          {row && (
            <>
              {(() => {
                const group = row.group === "mine" ? mine : others;
                // 사람별 합계와 더한 칸 수는 합산 함수의 값만 쓴다. 여기서 칸을 다시 세거나 다른 합계로 대신하지 않는다.
                const total = group.byRow.find((entry) => entry.rowId === row.id);
                return (
                  <Card>
                    <Total size="md" title={`${row.label} · ${row.group === "mine" ? "받을 예상 금액" : "지급될 예상 금액"}`} amount={total?.amount ?? null} counted={total?.countedCells ?? 0} />
                  </Card>
                );
              })()}
              {matrix.cells
                .filter((cell) => cell.rowId === row.id && cell.status !== "not_applicable")
                .map((cell) => (
                  <CoverageCard key={`${cell.rowId}:${cell.columnId}`} cell={cell} label={columnLabel(cell.columnId)} caseId={draft.id} result={result} canExplain={health} />
                ))}
              {matrix.cells.some((cell) => cell.rowId === row.id && cell.status === "not_applicable") && (
                <Card title="해당 없는 담보">
                  <ul className="flex flex-col gap-2">
                    {matrix.cells
                      .filter((cell) => cell.rowId === row.id && cell.status === "not_applicable")
                      .map((cell) => (
                        <li key={cell.columnId}>
                          <span className="font-semibold">{columnLabel(cell.columnId)}</span>
                          <span className="block text-sm text-muted">{cell.reason}</span>
                        </li>
                      ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </>
      )}

      <Card title="읽어주기">
        {guest ? (
          <TicketGate route="tts" what="읽어주기와 쉬운 말 설명" />
        ) : (
          <>
            <ReadAloud label="결과 요약 듣기" chunks={summaryChunks} />
            {documentChunks.length > 0 && <ReadAloud label="증권에서 읽은 내용 듣기" chunks={documentChunks} />}
            <p className="text-sm text-muted">이름·차량번호·증권번호는 읽지 않습니다.</p>
            <TicketBadge route="tts" />
          </>
        )}
      </Card>

      <Card title="내려받기">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy !== null} className={`${outlineButton} px-2 text-base`} onClick={downloadXlsx}>
            {busy === "xlsx" ? "만드는 중…" : "엑셀 받기"}
          </button>
          <button type="button" disabled={busy !== null} className={`${outlineButton} px-2 text-base`} onClick={downloadPdf}>
            {busy === "pdf" ? "만드는 중…" : "PDF 받기"}
          </button>
        </div>
        {notice && <p className="rounded-xl bg-warn-soft px-4 py-3 font-semibold text-warn-ink">{notice}</p>}
        <p className="text-sm text-muted">결과는 이 브라우저에만 남습니다. 보관하려면 엑셀이나 PDF로 받아 두세요.</p>
        <p className="break-all text-sm text-muted">계산에 쓴 규칙 버전: {result.rulesVersion.slice(0, 19)}… · 엔진 {result.engineVersion}</p>
      </Card>

      {disputed && (
        <Card title="과실비율 참고 판례">
          <PrecedentSearch kind={draft.accident.kind} />
        </Card>
      )}
    </>
  );
}

export function ResultStep() {
  return (
    <StepShell step={4} lead="사람별·담보별 예상 보험금입니다." nextLabel="내 사고 기록으로">
      {(draft) => <Computed draft={draft} />}
    </StepShell>
  );
}

function Computed({ draft }: { draft: CaseDraft }) {
  const computed = useMemo(() => computeResult(draft), [draft]);
  return (
    <>
      {computed.ok ? (
        <ResultView draft={draft} result={computed.result} />
      ) : (
        <Card title="정보 부족">
          <p>아래 내용을 입력하면 계산됩니다. 0원으로 계산한 것이 아닙니다.</p>
          {computed.missing.map((info) => {
            const href = fieldHref(draft.id, info.field, "");
            return href ? (
              <Link key={info.field} href={href} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 border-navy px-4 py-2 font-semibold text-navy">
                <span>{info.message}</span>
                <span aria-hidden>→</span>
              </Link>
            ) : (
              <p key={info.field}>{info.message}</p>
            );
          })}
        </Card>
      )}
      <Disclaimer />
    </>
  );
}
