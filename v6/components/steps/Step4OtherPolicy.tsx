"use client";

import type { Limit } from "@/lib/claim/types";
import { counterpartyOf } from "@/lib/ui/flow";
import { Choice } from "../fields";
import type { ScreenProps } from "./types";

// MASTER.md 7장 4단계 상대 보험("모름"을 고를 수 있다).

const won = (n: number) => (n >= 100_000_000 ? `${n / 100_000_000}억 원` : `${(n / 10_000).toLocaleString("ko-KR")}만 원`);

export function Step4OtherPolicy({ screen, claim, update }: ScreenProps) {
  const cp = claim.counterpartyPolicy;
  const statusKey = cp === null ? null : cp.status === "full" && cp.hasBodily2 === null ? "full_unknown" : cp.status;
  const setLimit = (coverage: "liability_bodily_2" | "liability_property", limit: Limit) =>
    update((c) => (c.counterpartyPolicy ? { ...c, counterpartyPolicy: { ...c.counterpartyPolicy, coverages: c.counterpartyPolicy.coverages.map((x) => (x.coverage === coverage ? { ...x, limit } : x)) } } : c));

  switch (screen.kind) {
    case "counterpartyStatus":
      return (
        <Choice
          options={[
            { value: "full", label: "종합보험", hint: "대인배상Ⅱ까지 있음" },
            { value: "full_unknown", label: "보험은 있는데 대인배상Ⅱ는 모름", hint: "있음·없음 두 경우로 계산합니다" },
            { value: "mandatory_only", label: "책임보험만", hint: "대인배상Ⅰ·대물 2천만 원" },
            { value: "uninsured", label: "보험 없음(무보험)" },
            { value: "hit_and_run", label: "뺑소니(상대를 모름)" },
            { value: "unknown", label: "모름" },
          ]}
          value={statusKey}
          onChange={(key) =>
            update((c) => ({ ...c, counterpartyPolicy: key === "full_unknown" ? counterpartyOf(c, "full", null) : counterpartyOf(c, key) }))
          }
        />
      );
    case "counterpartyBodily2":
      return (
        <Choice
          columns={2}
          options={[{ value: "unlimited" as Limit, label: "무한" }, ...[100_000_000, 200_000_000, 300_000_000].map((v) => ({ value: v as Limit, label: won(v) }))]}
          value={cp?.coverages.find((c) => c.coverage === "liability_bodily_2")?.limit ?? null}
          onChange={(limit) => setLimit("liability_bodily_2", limit)}
        />
      );
    case "counterpartyProperty":
      return (
        <Choice
          columns={2}
          options={[20_000_000, 30_000_000, 50_000_000, 100_000_000, 200_000_000, 300_000_000, 500_000_000, 1_000_000_000].map((v) => ({ value: v as Limit, label: won(v) }))}
          value={cp?.coverages.find((c) => c.coverage === "liability_property")?.limit ?? null}
          onChange={(limit) => setLimit("liability_property", limit)}
        />
      );
    default:
      return null;
  }
}
