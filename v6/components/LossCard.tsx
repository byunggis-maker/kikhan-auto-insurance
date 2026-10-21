"use client";

import { DOCUMENTS, type LossItemDef } from "@/lib/claim/lossItems";
import { emptyLossItem, type LossItem, type Victim } from "@/lib/claim/types";
import { pickValue } from "@/lib/engine/losses";
import { MoneyInput } from "./fields";

// MASTER.md 7장: 손해 항목 하나 = 카드 하나. 이름·한 줄 설명·확정 칸·추정 칸·작은 글씨의 필요 서류.
// 약관이 금액이나 산식을 정한 항목(위자료·휴업손해·그 밖의 손해배상금·장례비)은 "약관 기준 금액 쓰기"를 누르면
// 빈 칸으로 두고 엔진이 계산한다(결정 기록 D-18). 누르지 않으면 항목이 없는 것으로 본다(합계 칸만 쓰는 경우를 지키기 위해).

type Props = {
  /** 사고일. 약관 기준 금액(일용근로자 임금 등)을 엔진과 같은 날짜로 계산한다 */
  date: string;
  def: LossItemDef;
  item: LossItem | undefined;
  victim?: Victim;
  onChange: (change: { confirmed?: number | null; estimated?: number | null; standard?: boolean }) => void;
};

export function LossCard({ date, def, item, victim, onChange }: Props) {
  const standard = victim ? pickValue(emptyLossItem(def.code, []), "with_estimates", victim, date) : null;
  const usingStandard = item !== undefined && item.confirmed === null && item.estimated === null;
  // 카드에는 이 항목에만 필요한 서류를 적는다. 담보 공통 서류(청구서 등)는 화면 아래에 한 번만(Step6Losses)
  const docs = def.requiredDocs;
  return (
    <article id={`loss-${def.code}`} className="scroll-mt-4 rounded-2xl border-2 border-line bg-white p-4">
      <h3 className="text-lg font-bold">{def.label}</h3>
      <p className="text-sm font-semibold text-ink-soft">{def.description}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MoneyInput label="서류로 확인한 금액(확정)" value={item?.confirmed ?? null} onChange={(confirmed) => onChange({ confirmed })} />
        <MoneyInput label="대략 생각하는 금액(추정)" tone="estimate" value={item?.estimated ?? null} onChange={(estimated) => onChange({ estimated })} />
      </div>
      {standard && (
        <div className="mt-3 rounded-xl border-2 border-estimate-line bg-estimate p-3 text-estimate-ink">
          <p className="text-sm font-bold">약관 기준 {standard.amount.toLocaleString("ko-KR")}원</p>
          <p className="text-xs font-semibold">{standard.formula}</p>
          <button type="button" className={`mt-2 min-h-11 rounded-lg border-2 px-3 text-sm font-bold ${usingStandard ? "border-estimate-ink bg-estimate-ink text-white" : "border-estimate-line bg-white"}`} onClick={() => onChange({ standard: !usingStandard })}>
            {usingStandard ? "약관 기준 금액 쓰는 중(누르면 끔)" : "약관 기준 금액 쓰기"}
          </button>
        </div>
      )}
      <p className="mt-3 text-xs font-semibold text-ink-soft">
        필요 서류: {docs.map((id) => DOCUMENTS[id].label).join(" · ")} · 근거 {def.basis.ref} {def.basis.clause}(인쇄 {def.basis.page}쪽)
      </p>
    </article>
  );
}
