"use client";

import { useState } from "react";
import { COVERAGE_LABELS, DRIVER_SCOPES, DRIVER_SCOPE_LABELS, PRODUCT_LINES, PRODUCT_LINE_LABELS, type Coverage, type Deductible, type Limit } from "@/lib/claim/types";
import { isRead, limitFields, periodCheck, setCoverage, toggleCoverage } from "@/lib/ui/flow";
import { addRecognitions, confirmPolicy, isPolicyRecognition, policyRecognitions, randomId, recognitionRow } from "@/lib/ui/recognize";
import { DocumentUpload } from "../ai/DocumentUpload";
import { Check, Select } from "../fields";
import type { ScreenProps } from "./types";

// 라운드 9: 1단계 증권·사고일. 증권을 먼저 읽고(표 한 장 + [모두 확인]), 사고일을 묻고, 증권에서 못 읽은 칸만 드롭다운으로 묻는다.

const won = (n: number) => (n >= 100_000_000 ? `${n / 100_000_000}억 원` : `${(n / 10_000).toLocaleString("ko-KR")}만 원`);
const amounts = (values: number[]) => values.map((v) => ({ value: v as Limit, label: won(v) }));

/** 자기부담금: 약관이 안내하는 조합(손해액의 20%·30%, 최저·최고) */
const DEDUCTIBLES: { label: string; value: Deductible }[] = [
  { label: "20% (최저 20만·최고 50만)", value: { type: "rate", ratePercent: 20, min: 200_000, max: 500_000 } },
  { label: "20% (최저 10만·최고 50만)", value: { type: "rate", ratePercent: 20, min: 100_000, max: 500_000 } },
  { label: "20% (최저 30만·최고 100만)", value: { type: "rate", ratePercent: 20, min: 300_000, max: 1_000_000 } },
  { label: "30% (최저 30만·최고 100만)", value: { type: "rate", ratePercent: 30, min: 300_000, max: 1_000_000 } },
  { label: "30% (최저 50만·최고 200만)", value: { type: "rate", ratePercent: 30, min: 500_000, max: 2_000_000 } },
];
const deductibleKey = (d: Deductible | null) => (d === null ? null : d.type === "rate" ? `${d.ratePercent}-${d.min}-${d.max}` : `fixed-${d.amount}`);

/** 증권에서 읽은 값 표 한 장: 담보 | 가입금액 | 확인. [모두 확인] 한 번으로 체크한 줄을 넣는다 */
function PolicyTable({ claim, update }: Pick<ScreenProps, "claim" | "update">) {
  const rows = claim.recognized.filter(isPolicyRecognition);
  const [off, setOff] = useState<string[]>([]);
  if (!rows.length) return null;
  return (
    <section className="rounded-2xl border-2 border-estimate-line bg-estimate p-3 text-estimate-ink" data-policy-table>
      <p className="text-sm font-bold">증권에서 읽은 값 – 틀린 줄은 체크를 빼세요</p>
      <table className="mt-1 w-full table-fixed text-left text-[13px] leading-snug">
        <thead>
          <tr className="border-b-2 border-estimate-line">
            <th className="w-[46%] py-1 pr-2 font-bold">담보</th>
            <th className="py-1 pr-2 font-bold">가입금액</th>
            <th className="w-11 py-1 text-center font-bold">확인</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const row = recognitionRow(r);
            return (
              <tr key={r.id} className="border-b border-estimate-line/60 last:border-b-0">
                <td className="py-0.5 pr-2 align-top font-bold">{row.name}</td>
                <td className="py-0.5 pr-1 align-top font-semibold">{row.value}</td>
                <td className="py-0.5 text-center align-top">
                  <input type="checkbox" aria-label={`${row.name} 확인`} className="size-5 accent-[#0b1220]" checked={!off.includes(r.id)} onChange={(e) => setOff((o) => (e.target.checked ? o.filter((x) => x !== r.id) : [...o, r.id]))} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        className="mt-2 min-h-12 w-full rounded-xl bg-estimate-ink font-bold text-white"
        onClick={() => {
          update((c) => confirmPolicy(c, rows.filter((r) => !off.includes(r.id)).map((r) => r.id)));
          setOff([]);
        }}
      >
        모두 확인
      </button>
    </section>
  );
}

export function StepPolicy({ screen, claim, update, next }: ScreenProps) {
  const policy = claim.myPolicy;
  const has = (coverage: Coverage) => policy.coverages.some((c) => c.coverage === coverage);
  const get = (coverage: Coverage) => policy.coverages.find((c) => c.coverage === coverage);
  const setPolicy = (change: Partial<typeof policy>) => update((c) => ({ ...c, myPolicy: { ...c.myPolicy, ...change } }));

  switch (screen.kind) {
    case "policy": {
      const read = (claim.policyRead ?? []).length;
      const pending = claim.recognized.some(isPolicyRecognition);
      return (
        <div className="space-y-3">
          {/* 읽은 값 표가 확인을 기다리는 동안은 올리기 칸을 접어 한 화면에 보이게 한다 */}
          {!pending && (
          <DocumentUpload
            kind="policy"
            label="증권·가입증명서 올리기"
            onRead={(result) => {
              if (result.kind !== "policy") return "";
              const found = policyRecognitions(result.reading, randomId);
              update((c) => addRecognitions(c, found));
              return found.length ? `${found.length}개를 읽었습니다.` : "자동차보험 증권으로 읽히지 않았습니다. 직접 입력해 주세요.";
            }}
          />
          )}
          <PolicyTable claim={claim} update={update} />
          {read > 0 && !pending && <p className="rounded-xl border-2 border-line bg-white p-3 font-bold" data-policy-done>증권에서 {read}개 칸을 넣었습니다. 다음 화면부터는 못 읽은 것만 묻습니다.</p>}
          {!pending && (
            <button type="button" className="min-h-12 w-full rounded-xl border-2 border-line bg-white font-bold" onClick={next}>
              {read > 0 ? "다음" : "없으면 직접 입력"}
            </button>
          )}
        </div>
      );
    }
    case "date": {
      const check = periodCheck(claim);
      return (
        <div className="space-y-3">
          <input
            type="date"
            aria-label="사고일"
            className="min-h-12 w-full rounded-xl border-2 border-line bg-white px-4 text-lg font-bold"
            value={claim.accident.occurredAt?.slice(0, 10) ?? ""}
            max="2100-12-31"
            onChange={(e) => update((c) => ({ ...c, accident: { ...c.accident, occurredAt: e.target.value === "" ? null : e.target.value } }))}
          />
          <p className="text-sm font-semibold text-ink-soft">사고일로 적용 약관 판과 지급기준 금액이 정해집니다.</p>
          {check === "inside" && (
            <p className="rounded-xl border-2 border-line bg-white p-3 font-bold" data-period="inside">
              보험기간({policy.periodStart} ~ {policy.periodEnd}) 안의 사고입니다.
            </p>
          )}
          {check === "outside" && (
            <p className="rounded-xl border-2 border-ink bg-white p-3 font-bold" data-period="outside">
              사고일이 보험기간({policy.periodStart} ~ {policy.periodEnd}) 밖입니다. 보험기간 밖의 사고는 이 보험으로 보상하지 않습니다. 사고일과 증권을 다시 확인하세요.
            </p>
          )}
        </div>
      );
    }
    case "myPolicy":
      return (
        <div className="space-y-4">
          {!isRead(claim, "productLine") && (
            <Select
              label="보험 종류"
              options={PRODUCT_LINES.map((p) => ({ value: p, label: PRODUCT_LINE_LABELS[p] }))}
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
          )}
          {!isRead(claim, "driverScope") && <Select label="운전자 범위 한정특약" options={DRIVER_SCOPES.map((d) => ({ value: d, label: DRIVER_SCOPE_LABELS[d] }))} value={policy.driverScope} onChange={(driverScope) => setPolicy({ driverScope })} />}
        </div>
      );
    case "coverages": {
      const personal = has("auto_injury") ? "auto_injury" : has("self_injury") ? "self_injury" : null;
      return (
        <div className="space-y-2">
          <Check label={COVERAGE_LABELS.liability_bodily_1} checked disabled onChange={() => {}} />
          {(["liability_bodily_2", "liability_property", "uninsured", "own_damage"] as const).map((coverage) => (
            <Check key={coverage} label={COVERAGE_LABELS[coverage]} checked={has(coverage)} onChange={(on) => update((c) => toggleCoverage(c, coverage, on))} />
          ))}
          <div className="pt-2">
            <Select
              label="자기신체사고 또는 자동차상해(둘 중 하나)"
              unknown="가입 안 함 / 모름"
              options={[
                { value: "auto_injury" as const, label: COVERAGE_LABELS.auto_injury },
                { value: "self_injury" as const, label: COVERAGE_LABELS.self_injury },
              ]}
              value={personal}
              onChange={(choice) => update((c) => (choice === null ? toggleCoverage(toggleCoverage(c, "auto_injury", false), "self_injury", false) : toggleCoverage(c, choice, true)))}
            />
          </div>
        </div>
      );
    }
    case "limits": {
      const fields = limitFields(claim);
      const personal: Coverage = has("auto_injury") ? "auto_injury" : "self_injury";
      const auto = personal === "auto_injury";
      const entry = get(personal);
      return (
        <div className="space-y-3">
          {fields.includes("property") && <Select label="대물배상 가입금액" options={amounts([20_000_000, 30_000_000, 50_000_000, 100_000_000, 200_000_000, 300_000_000, 500_000_000, 1_000_000_000])} value={get("liability_property")?.limit ?? null} onChange={(limit) => update((c) => setCoverage(c, "liability_property", { limit }))} />}
          {fields.includes("injury") && (
            <Select
              label={`${COVERAGE_LABELS[personal]} 부상 가입금액`}
              options={amounts(auto ? [15_000_000, 30_000_000, 50_000_000, 100_000_000, 200_000_000] : [15_000_000, 30_000_000, 50_000_000])}
              value={entry?.injuryLimit ?? null}
              onChange={(injuryLimit) => update((c) => setCoverage(c, personal, { injuryLimit }))}
            />
          )}
          {fields.includes("death") && (
            <Select
              label={`${COVERAGE_LABELS[personal]} 사망·후유장애 가입금액`}
              options={amounts(auto ? [100_000_000, 200_000_000, 300_000_000, 500_000_000, 1_000_000_000] : [15_000_000, 30_000_000, 50_000_000, 100_000_000])}
              value={entry?.deathLimit ?? null}
              onChange={(deathLimit) => update((c) => setCoverage(c, personal, { deathLimit, disabilityLimit: deathLimit }))}
            />
          )}
          {fields.includes("uninsured") && <Select label="무보험자동차에 의한 상해 가입금액" options={amounts([200_000_000, 500_000_000])} value={get("uninsured")?.limit ?? null} onChange={(limit) => update((c) => setCoverage(c, "uninsured", { limit }))} />}
          {fields.includes("deductible") && (
            <Select
              label="자기차량손해 자기부담금"
              options={DEDUCTIBLES.map((d) => ({ value: deductibleKey(d.value) as string, label: d.label }))}
              value={deductibleKey(policy.deductible)}
              onChange={(key) => setPolicy({ deductible: key === null ? null : DEDUCTIBLES.find((d) => deductibleKey(d.value) === key)!.value })}
            />
          )}
        </div>
      );
    }
    default:
      return null;
  }
}
