"use client";

import type { Claim, Recognition } from "@/lib/claim/types";
import { confirmAll, confirmRecognition, dismissRecognition, editRecognition, recognitionLabel } from "@/lib/ui/recognize";
import { IntInput, MoneyInput } from "../fields";

// "인식된 값 – 확인해 주세요". 금액·날수는 확인 전에 고칠 수 있다. 확인을 눌러야 입력칸에 들어가고 계산에 쓰인다.
// 인식된 값은 연한 청색으로 구별한다(MASTER.md 2장).

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
