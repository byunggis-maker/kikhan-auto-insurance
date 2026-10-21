"use client";

import type { Claim, Recognition } from "@/lib/claim/types";
import { confirmAll, confirmLossGroup, confirmRecognition, dismissRecognition, duplicateIds, editRecognition, factDiffers, factReadings, groupTotal, hasPretax, recognitionLabel, setExcluded, taxFormula } from "@/lib/ui/recognize";
import { IntInput, MoneyInput } from "../fields";

// "인식된 값 – 확인해 주세요". 금액·날수는 확인 전에 고칠 수 있다. 확인을 눌러야 입력칸에 들어가고 계산에 쓰인다.
// 인식된 값은 연한 청색으로 구별한다(MASTER.md 2장).
// 라운드 8b: 한 항목에 서류가 여러 장이면 서류별 줄과 합계(RecognizedLossGroup), 날수가 서류마다 다르면 각 값을 보여 준다.
// 라운드 8c: 날수를 기간으로 합쳤거나 월 소득 평균을 냈으면 계산식(formula)을 보여 준다.
// 라운드 8d: 월 소득은 서류마다 세금을 뺀 계산식을 보여 주고, 세금 줄이 없는 서류는 "세전 금액이에요"를 붙인다.

type Update = (change: (claim: Claim) => Claim) => void;

export function RecognizedRow({ recognition: r, update }: { recognition: Recognition; update: Update }) {
  const edit = (value: number | null) => value !== null && update((c) => editRecognition(c, r.id, value));
  return (
    <div className="rounded-xl border-2 border-estimate-line bg-estimate p-3 text-estimate-ink" data-recognition={r.kind}>
      <p className="text-sm font-bold">인식된 값 – 확인해 주세요</p>
      {r.kind === "loss" || (r.kind === "fact" && r.field === "monthlyIncome") ? (
        <div className="mt-2">
          <MoneyInput label={recognitionLabel(r).replace(/ [\d,]+원$/, "")} tone="estimate" value={r.value} onChange={edit} />
        </div>
      ) : r.kind === "fact" ? (
        <div className="mt-2">
          <IntInput label={recognitionLabel(r).replace(/ \d+일$/, "")} unit="일" value={r.value} onChange={edit} />
        </div>
      ) : (
        <p className="mt-1 font-bold">{recognitionLabel(r)}</p>
      )}
      <p className="mt-1 text-xs font-semibold">
        읽은 서류: {r.source}
        {r.note ? ` · ${r.note}` : ""}
      </p>
      {r.kind === "fact" &&
        factReadings(r).map((x, i) => {
          const tax = taxFormula(x);
          return (
            tax && (
              <p key={i} className="mt-1 text-sm font-bold" data-tax>
                세금 뺌{factReadings(r).length > 1 ? `(${x.month ? `${Number(x.month.slice(5))}월 ` : ""}${x.source})` : ""}: {tax}
              </p>
            )
          );
        })}
      {r.kind === "fact" && hasPretax(r) && (
        <p className="mt-1 text-sm font-bold" data-pretax>
          세전 금액이에요, 확인해 주세요{factReadings(r).length > 1 ? `(${factReadings(r).filter((x) => !x.tax).map((x) => x.source).join(" · ")})` : ""}.
        </p>
      )}
      {r.kind === "fact" && r.formula && (
        <p className="mt-1 text-sm font-bold" data-formula>
          계산: {r.formula}
        </p>
      )}
      {r.kind === "fact" && factDiffers(r) && (
        <p className="mt-1 text-sm font-bold" data-differs>
          서류마다 다르게 적혀 있어요: {factReadings(r).map((x) => `${x.source} ${r.field === "monthlyIncome" ? `${x.value.toLocaleString("ko-KR")}원` : `${x.value}일`}`).join(" · ")}. 큰 값을 넣었습니다.
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" className="min-h-11 rounded-lg bg-estimate-ink font-bold text-white" onClick={() => update((c) => confirmRecognition(c, r.id))}>
          확인
        </button>
        <button type="button" className="min-h-11 rounded-lg border-2 border-estimate-line bg-white font-bold" onClick={() => update((c) => dismissRecognition(c, r.id))}>
          지우기
        </button>
      </div>
    </div>
  );
}

export function RecognizedList({ items, update, title }: { items: Recognition[]; update: Update; title: string }) {
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">{title}</h3>
        {items.length > 1 && (
          <button type="button" className="min-h-11 rounded-lg border-2 border-estimate-ink bg-white px-3 text-sm font-bold text-estimate-ink" onClick={() => update((c) => confirmAll(c, items.map((r) => r.id)))}>
            모두 확인
          </button>
        )}
      </div>
      {items.map((r) => (
        <RecognizedRow key={r.id} recognition={r} update={update} />
      ))}
    </section>
  );
}

type LossRow = Extract<Recognition, { kind: "loss" }>;

/** 한 항목에 서류가 여러 장일 때: 서류별 줄(체크 해제로 빼기)과 합계. 확인하면 합계가 확정 칸에 들어간다 */
export function RecognizedLossGroup({ rows, update }: { rows: LossRow[]; update: Update }) {
  const duplicates = duplicateIds(rows);
  const total = groupTotal(rows);
  const kept = rows.filter((r) => !r.excluded).length;
  const first = rows[0];
  return (
    <div className="rounded-xl border-2 border-estimate-line bg-estimate p-3 text-estimate-ink" data-recognition="loss-group">
      <p className="text-sm font-bold">인식된 값 – 확인해 주세요 (서류 {rows.length}장)</p>
      <ul className="mt-2 space-y-2">
        {rows.map((r) => (
          <li key={r.id} className={`rounded-lg border-2 bg-white p-2 ${r.excluded ? "border-line opacity-60" : "border-estimate-line"}`} data-row>
            <label className="flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" className="size-5 accent-[#1d4ed8]" checked={!r.excluded} onChange={(e) => update((c) => setExcluded(c, r.id, !e.target.checked))} />
              {r.source}
              {r.issuer ? ` · ${r.issuer}` : ""}
              {r.docDate ? ` · ${r.docDate}` : ""}
            </label>
            <div className="mt-1">
              <MoneyInput label="이 서류의 금액" tone="estimate" value={r.value} onChange={(value) => value !== null && update((c) => editRecognition(c, r.id, value))} />
            </div>
            {duplicates.has(r.id) && (
              <p className="mt-1 text-sm font-bold text-ink" data-duplicate>
                ⚠ 같은 서류로 보여요(날짜·금액·기관명이 같음). 두 번 올렸다면 하나는 체크를 풀어 주세요.
              </p>
            )}
            {r.note && <p className="mt-1 text-xs font-semibold">{r.note}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-2 font-bold" data-total>
        합계 {total.toLocaleString("ko-KR")}원 (체크한 서류 {kept}장)
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" disabled={!kept} className="min-h-11 rounded-lg bg-estimate-ink font-bold text-white disabled:opacity-50" onClick={() => update((c) => confirmLossGroup(c, first.cardId, first.code))}>
          합계로 확인
        </button>
        <button type="button" className="min-h-11 rounded-lg border-2 border-estimate-line bg-white font-bold" onClick={() => update((c) => rows.reduce((acc, r) => dismissRecognition(acc, r.id), c))}>
          모두 지우기
        </button>
      </div>
    </div>
  );
}
