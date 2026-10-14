// data/rules/standard/*.json(지급기준), data/rules/{motorcycle,business,commercial}.json(보험 종류별 차이), data/rules/sources.json을 만든다.
// 아래 숫자는 모두 현대해상 Hicar 개인용자동차보험 약관(2025-11-26 개정) PDF의 해당 쪽에서 읽어 옮긴 것이다.
// 쪽 번호는 약관에 인쇄된 번호다(PDF 쪽 번호는 2가 크다). 약관에 없는 숫자는 value를 null, status를 needs_check로 둔다.
// 실행: node scripts/build-person-rules.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import Decimal from "decimal.js";

const SOURCE_ID = "hi-personal-20251126";
const DOCUMENT = "현대해상 Hicar 개인용자동차보험 약관 (2025-11-26 개정)";
const EFFECTIVE_FROM = "2025-11-26";
// 출처 표기. 별표(붙임의 시행령 별표 포함)에서 읽은 값과 약관 본문·특별약관·안내 쪽에서 읽은 값을 구분해 적는다.
const SOURCE_LABEL = "현대해상 개인용 약관 2025-11-26 개정";
const sourceText = (appendix, page) => `${SOURCE_LABEL} ${/^<(별표|붙임)/.test(appendix) ? "별표" : "본문"} ${page}쪽`;
const MAN = 10_000;

const files = new Map();
function file(name, title) {
  const items = [];
  files.set(name, { id: name, title, items });
  /** 규칙 항목 하나를 더한다. */
  return (id, value, unit, appendix, clause, page, extra = {}) =>
    items.push({
      id,
      value,
      unit,
      productLines: ["personal"],
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      basis: { sourceId: SOURCE_ID, source: sourceText(appendix, page), document: DOCUMENT, appendix, clause, page },
      status: extra.status ?? (value === null ? "needs_check" : "confirmed"),
      note: extra.note ?? "",
    });
}

const A1 = "<별표1> 대인배상, 무보험자동차에 의한 상해 보험금 지급기준";
const A3 = "<별표3> 자기신체사고 보험금 지급기준";
const A4 = "<별표4> 과실상계 등";
const LAW1 = "<붙임> 자동차손해배상보장법 시행령 [별표 1]";
const LAW2 = "<붙임> 자동차손해배상보장법 시행령 [별표 2]";

// ── 대인배상Ⅰ 한도 ─────────────────────────────────────────────
{
  const add = file("bodily-limits", "대인배상Ⅰ(책임보험) 한도");
  add("liability1.death.limit", 150_000_000, "KRW", "자동차보험의 구성 「대인배상Ⅰ, 대인배상Ⅱ」", "보험금의 종류 및 한도: 사망 보험금 최대 1억 5천만원", 21, {
    note: "법령상 근거는 자동차손해배상보장법 시행령 제3조제1항제1호. 약관의 안내 쪽에 적힌 금액을 옮겼다.",
  });
  add("liability1.death.minimum", 20_000_000, "KRW", A4, "1. 과실상계 가.(2) 상계 후 금액이 2,000만원에 미달하면 2,000만원", 83);
  const injury = [3000, 1500, 1200, 1000, 900, 700, 500, 300, 240, 200, 160, 120, 80, 50];
  const injuryPages = [85, 85, 85, 86, 86, 87, 88, 88, 89, 89, 89, 90, 90, 90];
  injury.forEach((man, i) => add(`liability1.injury.limit.grade${i + 1}`, man * MAN, "KRW", LAW1, `1. 상해 구분별 한도금액 ${i + 1}급`, injuryPages[i]));
  const disability = [15000, 13500, 12000, 10500, 9000, 7500, 6000, 4500, 3800, 2700, 2300, 1900, 1500, 1000];
  const disabilityPages = [93, 93, 93, 93, 93, 93, 94, 94, 94, 95, 95, 95, 95, 96];
  disability.forEach((man, i) =>
    add(`liability1.disability.limit.grade${i + 1}`, man * MAN, "KRW", LAW2, `후유장애의 구분과 책임보험금의 한도금액 ${i + 1}급`, disabilityPages[i]),
  );
}

// ── 위자료 ─────────────────────────────────────────────────────
{
  const add = file("solatium", "위자료 (부상·사망·후유장애)");
  [200, 176, 152, 128, 75, 50, 40, 30, 25, 20, 20, 15, 15, 15].forEach((man, i) =>
    add(`solatium.injury.grade${i + 1}`, man * MAN, "KRW", A1, `나. 부상 2. 위자료 나. 지급기준 ${i + 1}급`, 77),
  );
  add("solatium.ageThreshold", 65, "years", A1, "가. 사망 2. 위자료 / 다. 후유장애 1. 위자료 (65세 미만·이상)", 73);
  add("solatium.death.under", 80_000_000, "KRW", A1, "가. 사망 2. 위자료 가.(1) 65세 미만", 73);
  add("solatium.death.over", 50_000_000, "KRW", A1, "가. 사망 2. 위자료 가.(2) 65세 이상", 73);
  add("solatium.disability.highThresholdPercent", 50, "percent", A1, "다. 후유장애 1. 위자료 나.(1) 노동능력상실률 50% 이상", 78);
  add("solatium.disability.high.under", 45_000_000, "KRW", A1, "다. 후유장애 1. 위자료 나.(1)(가) 65세 미만", 78);
  add("solatium.disability.high.over", 40_000_000, "KRW", A1, "다. 후유장애 1. 위자료 나.(1)(나) 65세 이상", 78);
  add("solatium.disability.high.factorPercent", 85, "percent", A1, "다. 후유장애 1. 위자료 나.(1) × 노동능력상실률 × 85%", 78);
  add(
    "solatium.disability.lowBands",
    [
      [45, 50, 400],
      [35, 45, 240],
      [27, 35, 200],
      [20, 27, 160],
      [14, 20, 120],
      [9, 14, 100],
      [5, 9, 80],
      [0, 5, 50],
    ].map(([fromPercent, toPercent, man]) => ({ fromPercent, toPercent, amount: man * MAN })),
    "table",
    A1,
    "다. 후유장애 1. 위자료 나.(2) 노동능력상실률 50% 미만",
    79,
    { note: "각 구간은 fromPercent 이상 toPercent 미만. 맨 아래 구간만 0 초과 5 미만." },
  );
  add("solatium.disability.overlap", "larger_only", "enum", A1, "다. 후유장애 1. 위자료 다. 부상 위자료 해당액이 더 많은 경우 그 금액을 후유장애 위자료로 지급", 79, {
    status: "needs_check",
    note: "후유장애 위자료를 줄 때 부상 위자료를 따로 또 주는지는 약관 문구만으로 확실하지 않다. 최소·예상은 둘 중 큰 금액 하나만 주는 것으로 계산한다.",
  });
  add("solatium.disability.overlapMax", "sum_both", "enum", A1, "다. 후유장애 1. 위자료 다. 부상 위자료 해당액이 더 많은 경우 그 금액을 후유장애 위자료로 지급", 79, {
    status: "needs_check",
    note: "해석이 갈리는 부분이라 최대값은 부상 위자료와 후유장애 위자료를 둘 다 더한 금액으로 계산한다(2026-10-13 사용자 지시). 결과에 '해석에 따라 금액 차이 있음'을 표시한다.",
  });
}

// ── 사망·후유장애 상실수익액 ───────────────────────────────────
{
  const add = file("lost-earnings", "장례비, 상실수익액, 호프만 계수");
  add("funeral.amount", 5_000_000, "KRW", A1, "가. 사망 1. 장례비", 73);
  add("lostEarnings.livingCostRatio", { numerator: 1, denominator: 3 }, "ratio", A1, "가. 사망 3. 상실수익액 다. 생활비율: 1/3", 75);
  add("lostEarnings.retirementAge", 65, "years", A1, "가. 사망 3. 상실수익액 라.(1) 취업가능연한 65세", 75, {
    note: "정년 규정이 따로 있거나 농어업인(70세)인 경우는 계산하지 않는다.",
  });
  add("lostEarnings.workStartAge", 19, "years", A1, "가. 사망 3. 상실수익액 라.(4) 취업시기는 19세", 75);
  add(
    "lostEarnings.elderMonths",
    [
      { fromAge: 62, toAge: 67, months: 36 },
      { fromAge: 67, toAge: 76, months: 24 },
      { fromAge: 76, toAge: null, months: 12 },
    ],
    "table",
    A1,
    "가. 사망 3. 상실수익액 라.(2) 62세 이상 피해자의 취업가능월수",
    75,
  );
  add("lostEarnings.hoffmanCap", 240, "coefficient", A1, "가. 사망 3. 상실수익액 가. 호프만계수의 총합은 240을 한도로 함", 73);
  // 일용근로자 임금(dailyWage.amount)은 약관에 숫자가 없다. 사람이 값을 넣는 data/rules/daily-wage.json에 따로 두고 이 스크립트는 건드리지 않는다.
  add("dailyWage.daysPerMonth", 25, "days", A1, "가. 사망 3. 상실수익액 나.(1)(나)1)나) 용어풀이 ② 월 임금 산출 시 25일을 기준으로 산정", 74);

  // 호프만 계수: 약관의 산식(법정이율 월 5/12%, 단리)으로 만든 표. 손으로 옮긴 값이 아니다.
  // 약관의 예시 두 개(112개월 91.7592, 406개월 237.324)와 맞는지 아래에서 확인한다.
  Decimal.set({ precision: 60 });
  const rate = new Decimal(5).div(12).div(100);
  const table = [];
  let sum = new Decimal(0);
  for (let n = 1; sum.lt(240); n++) {
    sum = sum.plus(new Decimal(1).div(new Decimal(1).plus(rate.times(n))));
    table.push(sum.toFixed(4, Decimal.ROUND_DOWN));
  }
  if (table[111] !== "91.7592" || !table[405].startsWith("237.324")) throw new Error("호프만 계수가 약관의 예시와 다릅니다");
  add("hoffman.table", table, "table", A1, "가. 사망 3. 상실수익액 마. 호프만 계수 (법정이율 월 5/12%, 단리) 및 용어해설 105·110의 예시", 76, {
    note: `n번째 값이 n개월의 계수다(1개월부터 ${table.length}개월까지, 그 뒤는 한도 240). 약관의 산식으로 계산해 소수 넷째 자리 아래를 버렸다. 약관에 계수표는 없고, 예시 두 개(112개월 91.7592, 406개월 237.324)와 일치한다.`,
  });
}

// ── 부상: 휴업손해, 그 밖의 손해배상금, 간병비 ─────────────────
{
  const add = file("injury-losses", "휴업손해, 그 밖의 손해배상금, 간병비");
  add("lostIncome.payRatePercent", 85, "percent", A1, "나. 부상 3. 휴업손해 가. 실제 수입감소액의 85%", 77);
  add("lostIncome.daysPerMonth", 30, "days", A1, "나. 부상 3. 휴업손해 가. 산식: 1일 수입감소액 × 휴업일수 × 85/100", 77, {
    status: "needs_check",
    note: "월소득을 1일 수입감소액으로 바꾸는 방법은 약관에 없다. 한 달을 30일로 나눈 값은 임시 기준이다. 1일 수입감소액을 직접 입력하면 이 값을 쓰지 않는다.",
  });
  add("lostIncome.noLossOccupations", ["unemployed", "student", "pensioner", "minor"], "list", A1, "나. 부상 3. 휴업손해 다.(3) 무직자: 수입의 감소가 없는 것으로 함", 77);
  add("lostIncome.dailyWageOccupations", ["homemaker"], "list", A1, "나. 부상 3. 휴업손해 다.(2) 가사종사자: 일용근로자 임금", 77);
  add("incidental.mealPerMeal", 4_030, "KRW", A1, "나. 부상 5. 그 밖의 손해배상금 가. 입원기간 중 한 끼당 4,030원", 78);
  add("incidental.outpatientPerDay", 8_000, "KRW", A1, "나. 부상 5. 그 밖의 손해배상금 나. 실제 통원한 일수에 대하여 1일 8,000원", 78);
  [60, 60, 30, 30, 15].forEach((days, i) => add(`nursing.maxDays.grade${i + 1}`, days, "days", A1, `나. 부상 4. 간병비 다. 지급 기준 상해등급별 인정일수 ${i + 1}급`, 78));
  add("nursing.maxGrade", 5, "grade", A1, "나. 부상 4. 간병비 나.(1) 책임보험 상해구분상 1~5급", 78, {
    note: "부모가 사망·중상인 7세 미만 자녀의 간병비(최대 60일)는 계산하지 않는다.",
  });
}

// ── 과실상계 ───────────────────────────────────────────────────
{
  const add = file("fault", "과실상계와 치료비 보장");
  add("fault.medicalFloor", true, "flag", A4, "1. 과실상계 가.(2)·(3) 상계 후 금액이 치료관계비와 간병비의 합산액에 미달하면 치료관계비(입원환자 식대 포함)와 간병비를 보상", 83);
  add("fault.minorInjuryGrades", [12, 13, 14], "list", A4, "1. 과실상계 가.(3) 단서: 차량운전자가 12급 내지 14급의 상해를 입은 경우", 83, {
    note: "상계 전 치료관계비가 대인배상Ⅰ 한도를 넘으면 넘는 금액에 본인 과실비율을 곱한 금액을 보험회사가 청구할 수 있다. 이 금액을 대인배상Ⅱ·무보험자동차상해의 치료비 보장액에서 뺀다.",
  });
  add("rounding.won", "floor", "enum", A4, "1. 과실상계 가.(1)", 83, {
    status: "needs_check",
    note: "과실상계·비율 계산에서 원 미만이 생길 때의 처리 방식은 약관에 없다. 버림으로 계산하고, 실제로 원 미만이 버려진 칸에만 확인 필요 표시를 붙인다.",
  });
}

// ── 자기신체사고 ───────────────────────────────────────────────
{
  const add = file("self-injury-limits", "자기신체사고 급별 보험가입금액표");
  const injury = {
    15_000_000: [1500, 800, 750, 700, 500, 400, 250, 180, 140, 120, 120, 120, 80, 50],
    30_000_000: [3000, 1600, 1500, 1400, 1000, 800, 500, 360, 280, 240, 200, 180, 130, 80],
    50_000_000: [5000, 2700, 2500, 2300, 1650, 1300, 800, 600, 450, 400, 300, 290, 210, 130],
  };
  for (const [joined, rows] of Object.entries(injury))
    rows.forEach((man, i) => add(`selfInjury.injury.limit.${joined}.grade${i + 1}`, man * MAN, "KRW", A3, `1) 상해구분 및 급별 보험가입금액표 (가입금액 ${Number(joined) / MAN}만원) ${i + 1}급`, 82));
  const disability = {
    15_000_000: [1500, 1350, 1200, 1050, 900, 750, 600, 450, 360, 270, 210, 150, 90, 60],
    30_000_000: [3000, 2700, 2400, 2100, 1800, 1500, 1200, 900, 720, 540, 420, 300, 180, 120],
    50_000_000: [5000, 4500, 4000, 3500, 3000, 2500, 2000, 1500, 1200, 900, 700, 500, 300, 200],
    100_000_000: [10000, 9000, 8000, 7000, 6000, 5000, 4000, 3000, 2400, 1800, 1400, 1000, 600, 400],
  };
  for (const [joined, rows] of Object.entries(disability))
    rows.forEach((man, i) =>
      add(`selfInjury.disability.amount.${joined}.grade${i + 1}`, man * MAN, "KRW", A3, `2) 후유장애구분 및 급별 보험가입금액표 (가입금액 ${Number(joined) / MAN}만원) ${i + 1}급`, 83),
    );
}

// ── 담보별 지급보험금 계산 조항 ────────────────────────────────
{
  const add = file("coverage-clauses", "담보별 지급보험금 계산 조항");
  add("clause.liability_bodily_1", "지급보험금 = 보험금지급기준에 의해 산출한 금액 + 비용 − 공제액. 한도: 자동차손해배상보장법령에서 정한 기준에 따라 산출한 금액", "text", "보통약관 제10조(지급보험금의 계산)", "① 1. 대인배상Ⅰ", 49);
  add("clause.liability_bodily_2", "지급보험금 = 보험금지급기준에 의해 산출한 금액 + 비용 − 공제액(대인배상Ⅰ에서 지급되는 금액). 한도: 보험증권에 기재된 보험가입금액", "text", "보통약관 제10조(지급보험금의 계산)", "① 2. 대인배상Ⅱ, ④ 1.", 49);
  add("clause.self_injury", "지급보험금 = 실제손해액 + 비용 − 공제액. 공제액이 없으면 사망은 사망보험가입금액, 부상은 실제로 지출한 치료비, 후유장애는 장애등급별 보험금액", "text", "보통약관 제15조(보험금의 종류와 한도), 제16조(지급보험금의 계산)", "제16조 ① 1.~4.", 51);
  add("clause.uninsured", "지급보험금 = 보험금지급기준에 의해 산출한 금액 + 비용 − 공제액. 한도: 보험증권에 기재된 보험가입금액", "text", "보통약관 제20조(지급보험금의 계산)", "1.~3.", 53);
  add("clause.auto_injury", "지급보험금 = 실제손해액 + 비용 − 공제액. 실제손해액은 과실상계 및 보상한도를 적용하기 전의 금액. 한도: 보험증권에 기재된 보험가입금액", "text", "자동차상해 특별약관", "2. 보상하는 손해 (2)", 118);
}


// ── 대물배상 ───────────────────────────────────────────────────
const A2 = "<별표2> 대물배상 보험금 지급기준";
{
  const add = file("property", "대물배상 지급기준 (수리비, 대차료, 휴차료, 시세하락손해)");
  add("clause.liability_property", "지급보험금 = 보험금지급기준에 의해 산출한 금액 + 비용 − 공제액. 한도: 보험증권에 기재된 보험가입금액", "text", "보통약관 제10조(지급보험금의 계산)", "① 2. 대인배상Ⅱ, 대물배상", 49);
  add("fault.propertyOffset", true, "flag", A4, "1. 과실상계 가.(1) 대물배상에 의하여 산출한 금액에 대하여 피해자 측의 과실비율에 따라 상계", 83);
  add("property.repair.capPercent", 120, "percent", A2, "1. 수리비용 나.(3) 수리비 및 열처리 도장료의 합계액은 피해물의 사고 직전 가액의 120%를 한도", 80);
  add("property.repair.capPercentExtended", 130, "percent", A2, "1. 수리비용 나.(3) 단서: 내용연수가 지난 경우, 차량충당연한을 적용받는 승용·승합·화물자동차는 130%", 80);
  add("property.rental.maxDays", 25, "days", A2, "3. 대차료 다.(1) 수리 가능한 경우 25일을 한도", 81);
  add("property.rental.maxDaysLongRepair", 30, "days", A2, "3. 대차료 다.(1) 실제 정비작업시간이 160시간을 초과하는 경우에는 30일", 81);
  add("property.rental.totalLossDays", 10, "days", A2, "3. 대차료 다.(2) 수리 불가능한 경우: 10일", 81);
  add("property.rental.notRentedPercent", 35, "percent", A2, "3. 대차료 나.(2) 대차를 하지 않는 경우: 통상의 요금의 35% 상당액", 81);
  add("property.idle.maxDays", 30, "days", A2, "4. 휴차료 다.(1)(가) 수리 가능한 경우 30일을 한도", 82);
  add("property.idle.totalLossDays", 10, "days", A2, "4. 휴차료 다.(2) 수리 불가능한 경우: 10일", 82);
  add("property.depreciation.maxVehicleAgeYears", 5, "years", A2, "6. 자동차시세하락손해 가. 출고 후 5년 이하인 자동차에 한함", 82);
  add("property.depreciation.minRepairRatioPercent", 20, "percent", A2, "6. 자동차시세하락손해 가. 수리비용이 사고 직전 자동차가액의 20%를 초과하는 경우", 82);
  add(
    "property.depreciation.bands",
    [
      { overYears: 0, upToYears: 1, percent: 20 },
      { overYears: 1, upToYears: 2, percent: 15 },
      { overYears: 2, upToYears: 5, percent: 10 },
    ],
    "table",
    A2,
    "6. 자동차시세하락손해 나. 인정기준액: 출고 후 1년 이하 수리비용의 20%, 1년 초과 2년 이하 15%, 2년 초과 5년 이하 10%",
    82,
    { note: "각 구간은 출고 후 overYears년 초과 upToYears년 이하. 맨 위 구간은 1년 이하 전부." },
  );
}

// ── 자기차량손해 ───────────────────────────────────────────────
{
  const add = file("own-damage", "자기차량손해 지급보험금과 자기부담금");
  const C24 = "보통약관 제24조(지급보험금의 계산)";
  add("clause.own_damage", "지급보험금 = 피보험자동차에 생긴 손해액 + 비용 − 보험증권에 기재된 자기부담금. 손해액은 보험가입금액을 한도로 하고, 보험가입금액이 보험가액보다 많으면 보험가액을 한도로 한다", "text", C24, "① 1. 가.~나.", 55);
  add("ownDamage.deductible.waivedOnTotalLoss", true, "flag", C24, "① 3. 전부손해이거나 보상할 금액이 보험가입금액 전액 이상이면 자기부담금을 공제하지 않음", 56);
  add("ownDamage.deductible.onNetOfRecovery", true, "flag", C24, "① 5. 자기부담금은 실제 손해액에서 구상금을 제외한 금액을 전제로 산정하며, 최종 자기부담금은 최소 자기부담금 이상", 56, {
    note: "과실이 양쪽에 있는 사고에서는 상대방 대물배상이 처리하는 금액(구상금)을 뺀 나머지 손해액에 자기부담금 비율을 적용한다.",
  });
  add(
    "ownDamage.deductible.options",
    [
      [20, 5, 50],
      [20, 10, 50],
      [20, 15, 50],
      [20, 20, 50],
      [20, 30, 100],
      [30, 30, 100],
      [30, 50, 200],
    ].map(([ratePercent, min, max]) => ({ ratePercent, min: min * MAN, max: max * MAN })),
    "table",
    "자동차보험의 구성 「자기차량손해」",
    "자기부담금: 손해액의 20%(최소 5/10/15/20만원·최대 50만원, 최소 30만원·최대 100만원) 또는 30%(최소 30만원·최대 100만원, 최소 50만원·최대 200만원)",
    24,
    { note: "약관이 안내하는 자기부담금 조합이다. 실제 비율·최소·최대는 증권에 적힌 값을 쓰고, 이 표에 없는 조합이면 확인 필요 표시를 붙인다." },
  );
}

// ── 특별약관 ───────────────────────────────────────────────────
{
  const add = file("riders", "특별약관: 렌트비용지원, 법률비용 지원");
  const RENT = "렌트비용지원 특별약관";
  const LEGAL = "법률비용 지원 특별약관";
  add("clause.rider_rental", "자기차량손해 보험금이 지급되는 경우 렌트비용을 지급. 배상의무자의 대물배상(대차료 등)으로 지급될 수 있는 금액은 공제", "text", RENT, "2. 보상하는 손해 (1), (3)", 126);
  Object.entries({ small: 70_000, mid: 110_000, large: 210_000, xlarge: 350_000, multi: 140_000 }).forEach(([key, limit]) =>
    add(`rider.rental.dailyLimit.${key}`, limit, "KRW", RENT, "2.(2)① 가. 1일당 차종별 렌트비용 한도금액", 126, {
      note: "small: (초)소형승용 1,600cc 이하, mid: 중형승용 2,000cc 이하, large: 대형승용 2,800cc 이하, xlarge: 대형승용 2,800cc 초과, multi: 다인승승용 7~10인",
    }),
  );
  add("rider.rental.notRentedPercent", 35, "percent", RENT, "2.(2)① 나. 대차를 하지 않는 경우 통상의 요금의 35%, 1일 지급한도는 한도금액의 35%", 126);
  add("rider.rental.maxDays", 30, "days", RENT, "2.(2)② 가. 수리 가능한 경우 30일을 한도", 127);
  add("rider.rental.totalLossDays", 10, "days", RENT, "2.(2)② 나. 수리 불가능한 경우: 10일", 127);

  add("clause.rider_legal", "피보험자동차의 사고로 다른 사람을 죽게 하거나 다치게 한 경우 형사합의금, 변호사선임비용, 벌금비용을 매 사고마다 지급", "text", LEGAL, "2. 보상하는 손해 (1), (2)", 132);
  // 형사합의금 한도표: 사망, 1급, 2~3급, 4~5급, 6~7급, 8~14급 (만원). "-"는 보상하지 않는 칸이라 0으로 둔다.
  const table = { basic: [3000, 2000, 1000, 500, 300, 0], premium: [3000, 3000, 2000, 700, 500, 0], top: [3000, 3000, 3000, 700, 500, 100], top2: [5000, 5000, 5000, 1000, 700, 200] };
  const names = { basic: "기본형", premium: "고급형", top: "최고급형", top2: "최고급형Ⅱ" };
  const column = (grade) => (grade === 1 ? 1 : grade <= 3 ? 2 : grade <= 5 ? 3 : grade <= 7 ? 4 : 5);
  for (const [plan, row] of Object.entries(table)) {
    add(`rider.legal.settlement.${plan}.death`, row[0] * MAN, "KRW", LEGAL, `2.(2)① (3)① 형사합의금 한도 ${names[plan]} 사망`, 133);
    for (let grade = 1; grade <= 14; grade++) add(`rider.legal.settlement.${plan}.grade${grade}`, row[column(grade)] * MAN, "KRW", LEGAL, `2.(2)① (3)① 형사합의금 한도 ${names[plan]} 상해등급 ${grade}급`, 133);
  }
  add("rider.legal.plans", Object.keys(table), "list", LEGAL, "2.(2)① (3)① 형사합의금 한도표의 가입 유형: 기본형, 고급형, 최고급형, 최고급형Ⅱ", 133, { note: "증권의 가입 유형이 이 목록에 없으면 계산하지 않는다." });
  add("rider.legal.settlement.seriousInjury", 30_000_000, "KRW", LEGAL, "2.(2)① (3)② 중상해를 입혀 송치·공소제기된 사고: 3천만원", 133);
  add("rider.legal.lawyer.limit", 5_000_000, "KRW", LEGAL, "2.(2)② 변호사선임비용 (1) 1사고마다 5백만원 한도", 133);
  add("rider.legal.fine.limit", 20_000_000, "KRW", LEGAL, "2.(2)③ 벌금비용 (2) 2,000만원을 한도", 133);
  add("rider.legal.fine.schoolZoneLimit", 30_000_000, "KRW", LEGAL, "2.(2)③ 벌금비용 (2) 단서: 어린이 보호구역 사고는 3,000만원 한도", 133);
}

// ── 보험 종류별 담보 구성 ──────────────────────────────────────
const ALL_COVERAGES = ["liability_bodily_1", "liability_bodily_2", "liability_property", "self_injury", "auto_injury", "uninsured", "own_damage"];
{
  const add = file("product", "개인용자동차보험의 담보 구성");
  add("product.coverages", ALL_COVERAGES, "list", "보통약관 제2조(Hicar 개인용자동차보험의 구성)", "① 6가지 보장종목과 특별약관(자동차상해 특별약관 포함)", 45);
  add("product.riders", ["rider_legal", "rider_rental"], "list", "특별약관 목차", "렌트비용지원 특별약관(126쪽), 법률비용 지원 특별약관(132쪽)", 126, { note: "계산 규칙을 등록한 특별약관의 목록이다. 여기에 없는 특약은 '증권에 있으나 계산 규칙 미등록'으로 표시한다." });
}

// ── 이륜차·업무용·영업용: 개인용과 다른 점만 ────────────────────
// 같은 값인 항목은 여기에 다시 적지 않는다. scripts/check-product-terms.mjs가 세 약관 PDF와 대조한 결과(data/rules/product-check.json)를
// lib/rules/person-rules.ts가 읽어, 같은 값임을 확인한 항목에 그 약관의 쪽 번호를 붙인다.
// 세 약관 PDF(표지 "Terms and Conditions 1025")에는 개정일이 적혀 있지 않다. 그래서 적용 시작일은 개인용 약관의 날짜를 임시로 쓰고 모두 needs_check로 둔다.
// data/rules/product-revisions.json에 개정일을 넣으면 그 날짜가 적용 시작일이 되고 확정된다.
const others = new Map();
function productFile(name, productLine, title, source) {
  const items = [];
  others.set(name, { id: name, title, items });
  return (id, value, unit, appendix, clause, page, note = "") =>
    items.push({
      id,
      value,
      unit,
      productLines: [productLine],
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      basis: { sourceId: source.id, source: `${source.label} ${/^<(별표|붙임)/.test(appendix) ? "별표" : "본문"} ${page}쪽`, document: source.document, appendix, clause, page },
      status: "needs_check",
      note: `약관 PDF에 개정일이 없어 적용 시작일을 확인하지 못했다(개인용 약관의 날짜를 임시로 씀). ${note}`.trim(),
    });
}
const OTHER_SOURCES = [
  { id: "hi-motorcycle-1025", label: "현대해상 이륜자동차보험 약관 (개정일 미확인)", document: "현대해상 이륜자동차보험 약관 (표지 1025)", productLine: "motorcycle", sha256: "4b40b1fc303416683d35fca9829efb5a5fe1f610464fceaa04e2718400515aa0" },
  { id: "hi-business-1025", label: "현대해상 업무용 약관 (개정일 미확인)", document: "현대해상 Hicar 업무용자동차보험 약관 (표지 1025)", productLine: "business", sha256: "cbb1da8d75571c2ac557ff6004606296d098b51825121519d46e8028d6124779" },
  { id: "hi-commercial-1025", label: "현대해상 영업용 약관 (개정일 미확인)", document: "현대해상 Hicar 영업용자동차보험 약관 (표지 1025)", productLine: "commercial", sha256: "f313c52089022a2475af87f09db10fb0fd45faa2038a082948b983b5904f783d" },
];
const LEGAL_RIDER = "법률비용 지원 특별약관";
{
  const add = productFile("motorcycle", "motorcycle", "이륜자동차보험: 담보 구성과 개인용과 다른 점", OTHER_SOURCES[0]);
  add("product.coverages", ALL_COVERAGES.filter((key) => key !== "auto_injury"), "list", "보통약관 제2조(이륜자동차보험의 구성)", "① 6가지 보장종목. 특별약관 목록에 자동차상해 특별약관이 없음", 6, "자동차상해는 이 약관에 없어 계산하지 않는다.");
  add("product.riders", ["rider_legal"], "list", "특별약관", "법률비용 지원 특별약관(64쪽). 렌트비용지원 특별약관은 없음", 64);
  add("rider.legal.plans", ["basic"], "list", LEGAL_RIDER, "2.(2)① (3) 형사합의금 한도표에 가입 유형 구분이 없음(지급보험금 한 줄)", 64, "한도는 1급 2,000만원, 2~3급 1,000만원, 4~5급 500만원, 6~7급 300만원, 사망 3천만원으로 개인용 약관의 기본형과 같다.");
  add("rider.legal.defaultPlan", "basic", "enum", LEGAL_RIDER, "2.(2)① (3) 형사합의금 한도표에 가입 유형 구분이 없음", 64, "증권에 가입 유형이 없어도 이 한도표(개인용의 기본형과 같은 값)를 쓴다.");
  add("rider.legal.fine.schoolZoneLimit", 20_000_000, "KRW", LEGAL_RIDER, "2.(2)③ 벌금비용: 2,000만원을 한도로 지급. 어린이 보호구역 사고의 3,000만원 단서가 없음", 65, "개인용 약관과 다르다. 어린이 보호구역 사고여도 한도가 늘지 않는다.");
  add("product.minorInjuryDriverRule", false, "flag", "<별표4> 과실상계 등", "1. 과실상계 가.(3) 용어풀이: 차량운전자의 '차량'에서 이륜자동차는 제외", 43, "이륜자동차 운전자에게는 경상환자(12~14급) 치료비 과실 부담 규정을 적용하지 않는다. 입력의 vehicleDriver를 false로 둔다.");
}
{
  const add = productFile("business", "business", "업무용자동차보험: 개인용과 다른 점", OTHER_SOURCES[1]);
  add("product.coverages", ALL_COVERAGES, "list", "보통약관 제2조(Hicar 업무용자동차보험의 구성)", "① 6가지 보장종목과 특별약관(자동차상해 특별약관 85쪽)", 6, "담보 구성은 개인용과 같다.");
  add("product.riders", ["rider_legal", "rider_rental"], "list", "특별약관", "렌트비용지원 특별약관(97쪽), 법률비용 지원 특별약관(104쪽)", 97, "대조한 지급기준과 두 특약의 한도가 모두 개인용과 같았다. 이 파일에 다른 값은 없다.");
}
{
  const add = productFile("commercial", "commercial", "영업용자동차보험: 개인용과 다른 점", OTHER_SOURCES[2]);
  add("product.coverages", ALL_COVERAGES, "list", "보통약관 제2조(Hicar 영업용자동차보험의 구성)", "① 5가지 보장종목(대인배상Ⅰ·Ⅱ, 대물배상, 자기신체사고, 자기차량손해)과 특별약관", 6, "무보험자동차에 의한 상해는 보통약관에 없고 특별약관으로 가입한다. 자동차상해 특별약관은 있다(74쪽).");
  add("product.riders", ["rider_legal"], "list", "특별약관", "법률비용 지원 특별약관(89쪽). 렌트비용지원 특별약관은 없음", 89);
  add("rider.legal.plans", ["basic", "premium"], "list", LEGAL_RIDER, "2.(2)① (3) 형사합의금 한도표의 가입 유형: 기본형, 고보장형", 90, "고보장형의 한도(1급 3,000만원, 2~3급 2,000만원, 4~5급 700만원, 6~7급 500만원)는 개인용 약관의 고급형과 같아 premium으로 다룬다. 최고급형은 없다. 사망 사고는 유형과 관계없이 3천만원.");
}
for (const [name, body] of others) writeFileSync(`data/rules/${name}.json`, `${JSON.stringify(body, null, 2)}\n`);

mkdirSync("data/rules/standard", { recursive: true });
for (const [name, body] of files) writeFileSync(`data/rules/standard/${name}.json`, `${JSON.stringify(body, null, 2)}\n`);
writeFileSync(
  "data/rules/sources.json",
  `${JSON.stringify(
    {
      sources: [
        {
          id: SOURCE_ID,
          document: DOCUMENT,
          insurer: "현대해상",
          productLine: "personal",
          revisedOn: "2025-11-26",
          sha256: "47258f585384beb5a619a4f917362a0b8979c4562972bfa41de29b4bebb5a3ad",
          note: "보험사 약관이다. 금융감독원 자동차보험 표준약관 원문(docs/source/)과는 아직 대조하지 않았다. 쪽 번호는 약관에 인쇄된 번호다.",
        },
        ...OTHER_SOURCES.map(({ id, document, productLine, sha256 }) => ({
          id,
          document,
          insurer: "현대해상",
          productLine,
          revisedOn: null,
          sha256,
          note: "PDF에 개정일이 없다. 이 약관에서 읽은 항목은 모두 needs_check다. 쪽 번호는 약관에 인쇄된 번호다.",
        })),
      ],
    },
    null,
    2,
  )}\n`,
);
const all = [...files.values()].flatMap((f) => f.items);
console.log(`항목 ${all.length}개 (confirmed ${all.filter((i) => i.status === "confirmed").length}, needs_check ${all.filter((i) => i.status === "needs_check").length})`);
