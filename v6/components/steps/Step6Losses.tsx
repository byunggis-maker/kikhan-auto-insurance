"use client";

import { useState } from "react";
import { COVERAGE_DOCUMENTS, DOCUMENTS, type DocumentId } from "@/lib/claim/lossItems";
import { dailyWageFor } from "@/lib/claim/standards";
import { OCCUPATIONS, OCCUPATION_LABELS, VEHICLE_CLASSES, VEHICLE_CLASS_LABELS, type Property, type Victim } from "@/lib/claim/types";
import { estimateVehicleValue, modelYears } from "@/lib/claim/vehicleValue";
import { claimDate, setItem, visibleItems } from "@/lib/ui/flow";
import { addRecognitions, claimRecognitions, lossGroup, randomId } from "@/lib/ui/recognize";
import { DocumentUpload } from "../ai/DocumentUpload";
import { RecognizedList } from "../ai/Recognized";
import { Check, IntInput, MoneyInput, Select, manwon } from "../fields";
import { LossCard } from "../LossCard";
import type { ScreenProps } from "./types";

// MASTER.md 7장 6단계 손해 입력. 가입한 담보에 해당하는 항목만, 항목마다 확정·추정 두 칸, 카드 맨 아래 합계 칸.
// "치료·휴업 정보"는 사람마다 한 화면에 묶었다(질문 7개를 7화면으로 나누면 너무 길다).

/** 자주 쓰지 않는 항목. 값을 넣지 않았으면 "다른 항목 더 보기" 아래에 접어 둔다 */
const RARE = new Set(["rescue_cost", "future_treatment", "nursing", "home_nursing", "business_loss", "depreciation", "towing", "replacement_value"]);

export function Step6Losses({ screen, claim, update }: ScreenProps) {
  const [more, setMore] = useState(false);
  const victim = claim.victims.find((v) => v.id === screen.cardId);
  const property = claim.properties.find((p) => p.id === screen.cardId);
  const setVictim = (change: Partial<Victim>) => update((c) => ({ ...c, victims: c.victims.map((v) => (v.id === screen.cardId ? { ...v, ...change } : v)) }));
  const setProperty = (change: Partial<Property>) => update((c) => ({ ...c, properties: c.properties.map((p) => (p.id === screen.cardId ? { ...p, ...change } : p)) }));

  const yesNo = [
    { value: "yes" as const, label: "예" },
    { value: "no" as const, label: "아니오" },
  ];
  const toChoice = (value: boolean | null) => (value === true ? "yes" : value === false ? "no" : null);
  const fromChoice = (choice: string | null) => (choice === "yes" ? true : choice === "no" ? false : null);

  const pending = claim.recognized.filter((r) => (r.kind === "loss" || r.kind === "fact") && r.cardId === screen.cardId);
  const pendingFacts = pending.filter((r) => r.kind === "fact");

  if (screen.kind === "facts" && victim) {
    const wage = dailyWageFor(claimDate(claim));
    return (
      <div className="space-y-4">
        <RecognizedList title="서류에서 읽은 치료·소득 정보" items={pendingFacts} update={update} />
        <div className="grid grid-cols-2 gap-3">
          <IntInput label="입원일수" unit="일" value={victim.hospitalDays} onChange={(hospitalDays) => setVictim({ hospitalDays })} />
          <IntInput label="통원일수" unit="일" value={victim.outpatientDays} onChange={(outpatientDays) => setVictim({ outpatientDays })} />
          <IntInput label="병원 식사를 받지 않은 끼니" unit="끼" max={109_500} value={victim.mealsNotProvided} onChange={(mealsNotProvided) => setVictim({ mealsNotProvided })} />
          <IntInput label="일하지 못한 날(휴업일수)" unit="일" value={victim.daysOffWork} onChange={(daysOffWork) => setVictim({ daysOffWork })} />
        </div>
        <Select label="사고 당시 하던 일" options={OCCUPATIONS.map((o) => ({ value: o, label: OCCUPATION_LABELS[o] }))} value={victim.occupation} onChange={(occupation) => setVictim({ occupation })} />
        {(victim.occupation === "employed" || victim.occupation === null) && (
          <>
            <div>
              <MoneyInput label="월 소득(세금 뗀 금액)" value={victim.monthlyIncome} onChange={(monthlyIncome) => setVictim({ monthlyIncome })} />
              {/* 라운드 8d: 상여금 등은 약관상 과거 1년 기준이다(별표1 가. 3. 나.(1)(가)①, 인쇄 72쪽). 자동 계산하지 않고 안내만 한다 */}
              <p className="mt-1 text-sm font-semibold text-ink-soft" data-bonus-note>
                상여금이 있으면 약관상 1년 기준이라 금액이 달라질 수 있어요.
              </p>
            </div>
            <div>
              <Select label="월 소득 금액을 세금 서류로 증명할 수 있나요?" options={yesNo} value={toChoice(victim.incomeAmountProven)} onChange={(choice) => setVictim({ incomeAmountProven: fromChoice(choice) })} />
              <p className="mt-1 text-sm font-semibold text-ink-soft">
                원천징수영수증·소득금액증명 등. 증명하기 어려우면 일용근로자 임금{wage ? `(1일 ${wage.value.toLocaleString("ko-KR")}원)` : ""}으로 계산합니다(약관 별표1, 인쇄 74쪽).
              </p>
            </div>
          </>
        )}
        <div>
          <Select label="수입 감소를 서류로 증명할 수 있나요?" options={yesNo} value={toChoice(victim.incomeProven)} onChange={(choice) => setVictim({ incomeProven: fromChoice(choice) })} />
          <p className="mt-1 text-sm font-semibold text-ink-soft">휴업손해는 수입 감소를 증명할 수 있을 때만 받습니다(약관 별표1 나. 3. 가., 인쇄 76쪽).</p>
        </div>
      </div>
    );
  }

  const card = victim ?? property;
  if (!card) return null;
  const all = visibleItems(claim, card.id);
  const hasValue = (code: string) => card.losses.some((i) => i.code === code) || pending.some((r) => r.kind === "loss" && r.code === code);
  const items = all.filter((def) => more || !RARE.has(def.code) || hasValue(def.code));
  const hidden = all.length - items.length;
  const common = [...new Set(all.flatMap((def) => def.coverages).filter((c) => claim.myPolicy.coverages.some((x) => x.coverage === c) || c === "liability_bodily_1" || c === "liability_property").flatMap((c) => COVERAGE_DOCUMENTS[c]))] as DocumentId[];
  const total = card.losses.reduce((sum, item) => sum + (item.confirmed ?? item.estimated ?? 0), 0);
  return (
    <div className="space-y-3">
      <DocumentUpload
        kind="claim"
        target={victim ? "person" : "property"}
        label={victim ? "영수증·진단서 사진으로 채우기" : "견적서·영수증 사진으로 채우기"}
        onRead={(result) => {
          if (result.kind !== "claim") return "";
          const { recognitions, dropped } = claimRecognitions(claim, card.id, result.reading, randomId);
          update((c) => addRecognitions(c, recognitions));
          if (!recognitions.length) return "읽을 금액을 찾지 못했습니다. 직접 입력해 주세요.";
          const facts = recognitions.filter((r) => r.kind === "fact").length;
          return `${recognitions.length}개를 읽었습니다. 아래 칸에서 확인해 주세요.${facts ? ` 입원·통원일수 등 ${facts}개는 '치료·휴업 정보'에도 보입니다.` : ""}${dropped ? ` 이 카드에 해당하지 않는 금액 ${dropped}개는 넣지 않았습니다.` : ""}`;
        }}
      />
      <RecognizedList title="서류에서 읽은 치료·소득 정보" items={pendingFacts} update={update} />
      {property && property.role !== "counterparty_property" && <VehicleValue claim={claim} property={property} setProperty={setProperty} />}
      {property?.role === "my_vehicle" && <Check label="사업용 차(택시·화물 등)" hint="렌트비 대신 휴차료로 계산합니다" checked={property.commercialUse === true} onChange={(commercialUse) => setProperty({ commercialUse })} />}
      {items.map((def) => (
        <LossCard key={def.code} date={claimDate(claim)} pending={lossGroup(claim, card.id, def.code)} update={update} def={def} item={card.losses.find((i) => i.code === def.code)} victim={victim} onChange={(change) => update((c) => setItem(c, card.id, def.code, change))} />
      ))}
      {hidden > 0 && (
        <button type="button" className="min-h-12 w-full rounded-xl border-2 border-line bg-white font-bold" onClick={() => setMore(true)}>
          다른 항목 {hidden}개 더 보기
        </button>
      )}
      <p className="text-xs font-semibold text-ink-soft">모든 항목 공통 서류(약관 제27조): {common.map((id) => DOCUMENTS[id].label).join(" · ")}</p>
      <section className="rounded-2xl border-2 border-ink bg-white p-4">
        <h3 className="text-lg font-bold">합계</h3>
        <p className="text-sm font-semibold text-ink-soft">항목에 넣은 금액(확정 우선): {manwon(total)}</p>
        <div className="mt-3">
          <MoneyInput
            label="항목을 나누기 어려우면 손해 합계만 대략 넣으세요(추정)"
            tone="estimate"
            value={card.userTotal}
            onChange={(userTotal) => (victim ? setVictim({ userTotal }) : setProperty({ userTotal }))}
          />
        </div>
        {card.userTotal !== null && card.losses.length > 0 && card.userTotal !== total && <p className="mt-2 text-sm font-bold text-estimate-ink">합계 칸과 항목 합계가 {manwon(Math.abs(card.userTotal - total))} 다릅니다. 계산은 항목으로 합니다.</p>}
        {card.userTotal !== null && card.losses.length === 0 && <p className="mt-2 text-sm font-bold text-estimate-ink">항목 없이 합계만으로 계산합니다(치료관계비 하한은 적용하지 않음). 항목을 나누면 더 정확해집니다.</p>}
      </section>
    </div>
  );
}

/**
 * 라운드 9: 사고 직전 가액을 묻지 않는다. 내 차는 증권의 차량가액을 쓰고, 그 밖의 차는 차종 등급·연식 드롭다운으로 앱이 추정한다.
 * 수리비용 한도(사고 직전 가액의 120%) 판단은 계산이 한다(lib/engine/losses.ts repairCap).
 */
function VehicleValue({ claim, property, setProperty }: { claim: ScreenProps["claim"]; property: Property; setProperty: (change: Partial<Property>) => void }) {
  if (property.valueSource === "policy" && property.valueAtAccident !== null)
    return <p className="text-sm font-bold" data-vehicle-value="policy">사고 직전 가액: 증권 차량가액 {manwon(property.valueAtAccident)}</p>;
  const year = Number(claimDate(claim).slice(0, 4));
  const apply = (vehicleClass: Property["vehicleClass"], modelYear: Property["modelYear"]) => {
    const estimate = vehicleClass && modelYear ? estimateVehicleValue(vehicleClass, modelYear, year) : null;
    setProperty({ vehicleClass, modelYear, valueAtAccident: estimate?.value ?? null, valueSource: estimate ? "estimate" : null });
  };
  const estimate = property.vehicleClass && property.modelYear ? estimateVehicleValue(property.vehicleClass, property.modelYear, year) : null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <Select label="차종 등급" options={VEHICLE_CLASSES.map((c) => ({ value: c, label: VEHICLE_CLASS_LABELS[c] }))} value={property.vehicleClass ?? null} onChange={(c) => apply(c, property.modelYear ?? null)} />
        <Select label="연식" options={modelYears(year).map((y) => ({ value: y, label: `${y}년식` }))} value={property.modelYear ?? null} onChange={(y) => apply(property.vehicleClass ?? null, y)} />
      </div>
      {estimate && (
        <p className="rounded-xl border-2 border-estimate-line bg-estimate p-2 text-sm font-bold text-estimate-ink" data-vehicle-value="estimate">
          사고 직전 가액(추정) {manwon(estimate.value)} · {estimate.formula}
        </p>
      )}
    </div>
  );
}
