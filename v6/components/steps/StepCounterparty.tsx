"use client";

import type { Limit } from "@/lib/claim/types";
import { counterpartyOf } from "@/lib/ui/flow";
import { Select } from "../fields";
import type { ScreenProps } from "./types";

// 4단계 상대 차량 보험. 라운드 9: 한 화면의 드롭다운. 모르면 첫 항목 '모름(일반적 가입 기준으로 추정)'.
// '모름'은 입력값을 비워 두고, 계산할 때 일반적 가입 기준으로 채운다(lib/ui/flow.ts withAssumptions).

const UNKNOWN = "모름(일반적 가입 기준으로 추정)";
const won = (n: number) => (n >= 100_000_000 ? `${n / 100_000_000}억 원` : `${(n / 10_000).toLocaleString("ko-KR")}만 원`);
const STATUS = [
  { value: "full" as const, label: "종합보험(대인배상Ⅱ 있음)" },
  { value: "mandatory_only" as const, label: "책임보험만(대인배상Ⅰ·대물 2천만 원)" },
  { value: "uninsured" as const, label: "무보험" },
  { value: "hit_and_run" as const, label: "뺑소니(상대를 모름)" },
];

export function StepCounterparty({ claim, update }: ScreenProps) {
  const cp = claim.counterpartyPolicy;
  const status = cp && STATUS.some((s) => s.value === cp.status) ? (cp.status as (typeof STATUS)[number]["value"]) : null;
  const limitOf = (coverage: "liability_bodily_2" | "liability_property") => cp?.coverages.find((c) => c.coverage === coverage)?.limit ?? null;
  const setLimit = (coverage: "liability_bodily_2" | "liability_property", limit: Limit | null) =>
    update((c) => (c.counterpartyPolicy ? { ...c, counterpartyPolicy: { ...c.counterpartyPolicy, coverages: c.counterpartyPolicy.coverages.map((x) => (x.coverage === coverage ? { ...x, limit } : x)) } } : c));
  return (
    <div className="space-y-3">
      <Select label="상대 차량 보험 가입" unknown={UNKNOWN} options={STATUS} value={status} onChange={(s) => update((c) => ({ ...c, counterpartyPolicy: counterpartyOf(c, s ?? "unknown") }))} />
      {status === "full" && (
        <>
          <Select
            label="상대 차량 대인배상Ⅱ"
            unknown={UNKNOWN}
            options={[{ value: "unlimited" as Limit, label: "무한" }, ...[100_000_000, 200_000_000, 300_000_000].map((v) => ({ value: v as Limit, label: won(v) }))]}
            value={limitOf("liability_bodily_2")}
            onChange={(limit) => setLimit("liability_bodily_2", limit)}
          />
          <Select
            label="상대 차량 대물배상 가입금액"
            unknown={UNKNOWN}
            options={[20_000_000, 30_000_000, 50_000_000, 100_000_000, 200_000_000, 300_000_000, 500_000_000, 1_000_000_000].map((v) => ({ value: v as Limit, label: won(v) }))}
            value={limitOf("liability_property")}
            onChange={(limit) => setLimit("liability_property", limit)}
          />
        </>
      )}
    </div>
  );
}
