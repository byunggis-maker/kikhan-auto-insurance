"use client";

import { COVERAGE_LABELS, PRODUCT_LINES, PRODUCT_LINE_LABELS, type Coverage, type Deductible, type Limit } from "@/lib/claim/types";
import { setCoverage, toggleCoverage } from "@/lib/ui/flow";
import { Check, Choice } from "../fields";
import type { ScreenProps } from "./types";

// MASTER.md 7장 3단계 내 보험(직접 입력. 증권 사진 인식은 라운드 7).

const won = (n: number) => (n >= 100_000_000 ? `${n / 100_000_000}억 원` : `${(n / 10_000).toLocaleString("ko-KR")}만 원`);
const amounts = (values: number[]) => values.map((v) => ({ value: v as number | "unlimited", label: won(v) }));

/** 자기부담금: 약관이 안내하는 조합(손해액의 20%·30%, 최소·최대) */
const DEDUCTIBLES: { label: string; value: Deductible }[] = [
  { label: "20% (최소 20만·최대 50만)", value: { type: "rate", ratePercent: 20, min: 200_000, max: 500_000 } },
  { label: "20% (최소 10만·최대 50만)", value: { type: "rate", ratePercent: 20, min: 100_000, max: 500_000 } },
  { label: "20% (최소 30만·최대 100만)", value: { type: "rate", ratePercent: 20, min: 300_000, max: 1_000_000 } },
  { label: "30% (최소 30만·최대 100만)", value: { type: "rate", ratePercent: 30, min: 300_000, max: 1_000_000 } },
  { label: "30% (최소 50만·최대 200만)", value: { type: "rate", ratePercent: 30, min: 500_000, max: 2_000_000 } },
];
const deductibleKey = (d: Deductible | null) => (d === null ? null : d.type === "rate" ? `${d.ratePercent}-${d.min}-${d.max}` : `fixed-${d.amount}`);

export function Step3MyPolicy({ screen, claim, update }: ScreenProps) {
  const policy = claim.myPolicy;
  const has = (coverage: Coverage) => policy.coverages.some((c) => c.coverage === coverage);
  const get = (coverage: Coverage) => policy.coverages.find((c) => c.coverage === coverage);

  switch (screen.kind) {
    case "productLine":
      return (
        <Choice
          options={PRODUCT_LINES.map((p) => ({ value: p, label: PRODUCT_LINE_LABELS[p], hint: p === "personal" ? "자가용 승용차 대부분" : p === "business" ? "법인·업무용 차" : p === "commercial" ? "택시·버스·화물 등 영업용" : "오토바이" }))}
          value={policy.productLine}
          onChange={(productLine) =>
            update((c) => ({
              ...c,
              myPolicy: { ...c.myPolicy, productLine },
              // 내가 이륜차를 운전했으면 경상 구상의 "차량운전자"가 아니다(별표4 (*1))
              victims: c.victims.map((v) => (v.role === "driver" ? { ...v, vehicleDriver: productLine !== "motorcycle" } : v)),
            }))
          }
        />
      );
    case "coverages": {
      const personal = has("auto_injury") ? "auto_injury" : has("self_injury") ? "self_injury" : "none";
      return (
        <div className="space-y-2">
          <Check label={COVERAGE_LABELS.liability_bodily_1} hint="의무보험" checked disabled onChange={() => {}} />
          {(["liability_bodily_2", "liability_property", "uninsured", "own_damage"] as const).map((coverage) => (
            <Check key={coverage} label={COVERAGE_LABELS[coverage]} hint={coverage === "liability_property" ? "2천만 원까지는 의무보험" : coverage === "uninsured" ? "무보험차상해" : coverage === "own_damage" ? "자차" : undefined} checked={has(coverage)} onChange={(on) => update((c) => toggleCoverage(c, coverage, on))} />
          ))}
          <p className="pt-3 font-bold">내 몸의 손해(둘 중 하나만 가입합니다)</p>
          <Choice
            options={[
              { value: "auto_injury", label: "자동차상해", hint: "실제 손해 기준(더 넓음)" },
              { value: "self_injury", label: "자기신체사고", hint: "급수별 정해진 한도" },
              { value: "none", label: "둘 다 없음 / 모름" },
            ]}
            value={personal}
            onChange={(choice) => update((c) => (choice === "none" ? toggleCoverage(toggleCoverage(c, "auto_injury", false), "self_injury", false) : toggleCoverage(c, choice, true)))}
          />
        </div>
      );
    }
    case "propertyLimit":
      return <Choice columns={2} options={amounts([20_000_000, 30_000_000, 50_000_000, 100_000_000, 200_000_000, 300_000_000, 500_000_000, 1_000_000_000])} value={get("liability_property")?.limit ?? null} onChange={(limit) => update((c) => setCoverage(c, "liability_property", { limit }))} />;
    case "personalInjuryLimit": {
      if (has("auto_injury")) {
        const entry = get("auto_injury");
        return (
          <div className="space-y-4">
            <p className="font-bold">부상 가입금액</p>
            <Choice columns={2} options={amounts([15_000_000, 30_000_000, 50_000_000, 100_000_000, 200_000_000])} value={entry?.injuryLimit ?? null} onChange={(injuryLimit: Limit) => update((c) => setCoverage(c, "auto_injury", { injuryLimit }))} />
            <p className="font-bold">사망·후유장애 가입금액</p>
            <Choice columns={2} options={amounts([100_000_000, 200_000_000, 300_000_000, 500_000_000, 1_000_000_000])} value={entry?.deathLimit ?? null} onChange={(deathLimit: Limit) => update((c) => setCoverage(c, "auto_injury", { deathLimit, disabilityLimit: deathLimit }))} />
          </div>
        );
      }
      const entry = get("self_injury");
      return (
        <div className="space-y-4">
          <p className="font-bold">부상 가입금액(별표3)</p>
          <Choice columns={3} options={amounts([15_000_000, 30_000_000, 50_000_000])} value={entry?.injuryLimit ?? null} onChange={(injuryLimit: Limit) => update((c) => setCoverage(c, "self_injury", { injuryLimit }))} />
          <p className="font-bold">사망·후유장애 가입금액</p>
          <Choice columns={2} options={amounts([15_000_000, 30_000_000, 50_000_000, 100_000_000])} value={entry?.deathLimit ?? null} onChange={(deathLimit: Limit) => update((c) => setCoverage(c, "self_injury", { deathLimit, disabilityLimit: deathLimit }))} />
        </div>
      );
    }
    case "uninsuredLimit":
      return <Choice columns={2} options={amounts([200_000_000, 500_000_000])} value={get("uninsured")?.limit ?? null} onChange={(limit) => update((c) => setCoverage(c, "uninsured", { limit }))} />;
    case "ownDamage":
      return (
        <Choice
          options={DEDUCTIBLES.map((d) => ({ value: deductibleKey(d.value) as string, label: d.label }))}
          value={deductibleKey(policy.deductible)}
          onChange={(key) => update((c) => ({ ...c, myPolicy: { ...c.myPolicy, deductible: DEDUCTIBLES.find((d) => deductibleKey(d.value) === key)!.value } }))}
        />
      );
    case "driverScope":
      return (
        <Choice
          columns={2}
          options={[
            { value: "anyone", label: "누구나" },
            { value: "family", label: "가족" },
            { value: "couple", label: "부부" },
            { value: "named_only", label: "본인 1인" },
            { value: "named_plus_one", label: "본인 + 1인" },
            { value: "employees", label: "임직원" },
            { value: "other", label: "그 밖" },
          ]}
          value={policy.driverScope}
          onChange={(driverScope) => update((c) => ({ ...c, myPolicy: { ...c.myPolicy, driverScope } }))}
        />
      );
    default:
      return null;
  }
}
