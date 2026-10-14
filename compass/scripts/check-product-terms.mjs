// 업무용·영업용·이륜차 약관 PDF의 지급기준이 개인용 약관에서 읽은 규칙 값과 같은지 대조하고,
// 결과를 data/rules/product-check.json에 적는다. 값을 손으로 옮기지 않고 PDF의 글자에서 직접 찾는다.
// 실행: node scripts/check-product-terms.mjs "<약관 PDF가 있는 폴더>" "<현대해상 개인용 약관 2025-11-26 PDF 경로>"
//   폴더 안에 "업무용 약관.pdf", "영업용 약관.pdf", "이륜차 약관.pdf"가 있어야 한다.
//   개인용 약관(규칙 값을 읽은 원문)은 대조 방법이 맞는지 확인하는 기준으로 쓴다.
//   docs/source/에 금융감독원 자동차보험 표준약관 PDF가 있으면 그것도 같은 방법으로 대조해 "standard"로 적는다(쪽 번호는 PDF 쪽 번호).
// 실행한 뒤에는 node scripts/build-person-rules.mjs 와 node scripts/rules-version.mjs 를 다시 돌린다.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

const MAN = 10_000;
const [, , dir, personalPath] = process.argv;
if (!dir || !personalPath) throw new Error("약관 PDF가 있는 폴더와 개인용 약관 PDF 경로를 인자로 주세요");
const FILES = { personal: personalPath, business: `${dir}/업무용 약관.pdf`, commercial: `${dir}/영업용 약관.pdf`, motorcycle: `${dir}/이륜차 약관.pdf` };

/** 빈칸을 없애고 괄호·물결표 표기를 맞춘다 */
const norm = (text) => text.replace(/\u0000/g, "").replace(/\s+/g, "").replace(/｢/g, "「").replace(/｣/g, "」").replace(/〈/g, "<").replace(/〉/g, ">").replace(/[∼〜～]/g, "~");

const STANDARD_DIR = "docs/source";
const standardPdf = existsSync(STANDARD_DIR) ? readdirSync(STANDARD_DIR).find((name) => name.toLowerCase().endsWith(".pdf")) : undefined;
if (standardPdf) FILES.standard = `${STANDARD_DIR}/${standardPdf}`;

/** pageOffset: PDF 쪽 번호에서 빼면 인쇄된 쪽 번호가 되는 수 */
async function load(name, pageOffset) {
  const bytes = readFileSync(name);
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { text: pages } = await extractText(doc, { mergePages: false });
  let flat = "";
  const starts = [];
  for (const page of pages) {
    starts.push(flat.length);
    // 쪽 번호, 쪽 머리말, 옆 탭의 세로 글자(한글 한 글자짜리 줄), 용어해설 번호표를 뺀다. 문장 사이에 끼어 대조를 방해한다.
    const lines = page.replace(/\u0000/g, "").split("\n").map((line) => line.trim()).filter((line) => line && !/^[가-힣]$/.test(line) && !/Hicar 개인용자동차보험 약관/.test(line));
    if (/^\d{1,3}$/.test(lines[0] ?? "")) lines.shift();
    if (/^\d{1,3}$/.test(lines.at(-1) ?? "")) lines.pop();
    flat += norm(lines.join("\n")).replace(/(?<=[가-힣])\d{2,3}\)(?=[가-힣(])/g, "").replace(/법규해설\d+쪽\)/g, "");
  }
  /** 글자 위치 → 약관에 인쇄된 쪽 번호 */
  const pageAt = (index) => starts.findLastIndex((start) => start <= index) + 1 - pageOffset;
  return { flat, pageAt, sha256: createHash("sha256").update(bytes).digest("hex") };
}

const sorted = (list) => [...list].sort((a, b) => a - b);
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const manwon = (text) => [...text.matchAll(/([\d,]+)만원/g)].map((m) => Number(m[1].replace(/,/g, "")) * MAN);
/** 문구가 그대로 있는지 */
const has = (pattern) => (doc) => {
  const match = pattern.exec(doc.flat);
  return match ? match.index : -1;
};
/** from부터 to 앞까지의 글에서 check가 참인지 */
const region = (from, to, check) => (doc) => {
  const start = doc.flat.search(from);
  if (start < 0) return -1;
  const end = doc.flat.slice(start).search(to);
  return end > 0 && check(doc.flat.slice(start, start + end)) ? start : -1;
};

// 개인용 약관에서 읽어 data/rules/standard에 넣은 값들. 아래 대조가 이 값을 기준으로 한다.
const INJURY_SOLATIUM = [200, 176, 152, 128, 75, 50, 40, 30, 25, 20, 20, 15, 15, 15];
const INJURY_LIMITS = [3000, 1500, 1200, 1000, 900, 700, 500, 300, 240, 200, 160, 120, 80, 50];
const DISABILITY_LIMITS = [15000, 13500, 12000, 10500, 9000, 7500, 6000, 4500, 3800, 2700, 2300, 1900, 1500, 1000];
const SELF_INJURY = [
  [1500, 800, 750, 700, 500, 400, 250, 180, 140, 120, 120, 120, 80, 50],
  [3000, 1600, 1500, 1400, 1000, 800, 500, 360, 280, 240, 200, 180, 130, 80],
  [5000, 2700, 2500, 2300, 1650, 1300, 800, 600, 450, 400, 300, 290, 210, 130],
];
const SELF_DISABILITY = [
  [1500, 1350, 1200, 1050, 900, 750, 600, 450, 360, 270, 210, 150, 90, 60],
  [3000, 2700, 2400, 2100, 1800, 1500, 1200, 900, 720, 540, 420, 300, 180, 120],
  [5000, 4500, 4000, 3500, 3000, 2500, 2000, 1500, 1200, 900, 700, 500, 300, 200],
  [10000, 9000, 8000, 7000, 6000, 5000, 4000, 3000, 2400, 1800, 1400, 1000, 600, 400],
];

/** "3천만원", "1,200만원", "1억5천만원", "1억3,500만원", "1억500만원"을 만원 단위 숫자로 */
function manValue(amount) {
  const eok = /(\d)억/.exec(amount);
  const man = /([\d,]+)(천)?만?원/.exec(amount.replace(/^\d억/, ""));
  return (eok ? Number(eok[1]) * 10000 : 0) + (man ? Number(man[1].replace(/,/g, "")) * (man[2] ? 1000 : 1) : 0);
}

/** 급마다 "N급 금액"이 적혀 있고, 그 금액이 모두 기대값인지 본다(쪽이 바뀌면 같은 급이 다시 적힌다) */
function gradeAmounts(text, expected) {
  return expected.every((value, index) => {
    // 좁은 칸에서 "만원"이 다음 줄로 밀려 다른 곳에 찍힌 약관이 있다. 그때는 금액 숫자 바로 뒤에 첫 항목 번호 "1."이 온다.
    const found = [...text.matchAll(new RegExp(`(?<!\\d)${index + 1}급((?:\\d억)?(?:[\\d,]+?천?)?)(?:만?원|(?=1\\.[가-힣]))`, "g"))].map((m) => manValue(`${m[1]}만원`));
    return found.length > 0 && found.every((amount) => amount === value);
  });
}

/**
 * 대조 항목. ids: 이 대조가 확인하는 규칙 id(정규식). find: 약관 글에서 찾은 위치(없으면 -1).
 * 문구가 같으면 그 문구에 들어 있는 숫자도 같다.
 */
const PROBES = [
  { name: "장례비", ids: "^funeral\\.amount$", find: has(/1\.장례비지급액:5,000,000원/) },
  { name: "사망 위자료", ids: "^solatium\\.(death\\.|ageThreshold$)", find: has(/65세미만인경우:80,000,000원\(2\)사망당시피해자의나이가65세이상인경우:50,000,000원/) },
  { name: "호프만 계수 한도", ids: "^lostEarnings\\.hoffmanCap$", find: has(/호프만계수(?:\d+\))?의총합은240을한도/) },
  { name: "일용근로자 월 임금 일수", ids: "^dailyWage\\.daysPerMonth$", find: has(/월임금산출시25일을기준으로산정/) },
  { name: "생활비율", ids: "^lostEarnings\\.livingCostRatio$", find: has(/다\.생활비율:1\/3/) },
  { name: "취업가능연한", ids: "^lostEarnings\\.retirementAge$", find: has(/취업가능연한을65세로하여취업가능월수를산정/) },
  { name: "62세 이상 취업가능월수", ids: "^lostEarnings\\.elderMonths$", find: has(/62세부터67세미만67세부터76세미만76세이상36(?:개)?월24(?:개)?월12(?:개)?월/) },
  { name: "취업시기", ids: "^lostEarnings\\.workStartAge$", find: has(/취업시기는19세로함/) },
  { name: "호프만 계수 산식", ids: "^hoffman\\.table$", find: has(/법정이율월5\/12%,단리에따라중간이자를공제/) },
  {
    name: "부상 위자료 급별 인정액",
    ids: "^solatium\\.injury\\.grade\\d+$",
    find: region(/급별로인정함\.\(단위:만원\)/, /다\.과실상계후/, (text) => {
      // 표가 네 급씩 묶여 있다: 급 4개 다음에 인정액 4개(마지막 묶음은 2개씩). 숫자가 붙어 있어 자리수로 나눌 수 없으므로 기대값으로 만든 꼴과 견준다.
      const groups = [0, 4, 8, 12].map((start) => [...Array(Math.min(4, 14 - start)).keys()].map((i) => start + i));
      const expected = groups.map((group) => group.map((i) => i + 1).join("") + group.map((i) => INJURY_SOLATIUM[i]).join("")).join("");
      return text.replace(/급별인정액/g, "").endsWith(expected);
    }),
  },
  { name: "휴업손해 비율", ids: "^lostIncome\\.payRatePercent$", find: has(/실제수입감소액의85%해당액을지급/) },
  { name: "무직자 휴업손해", ids: "^lostIncome\\.noLossOccupations$", find: has(/무직자는수입의감소가없는것으로함/) },
  { name: "가사종사자 휴업손해", ids: "^lostIncome\\.dailyWageOccupations$", find: has(/\(2\)가사종사자(?:\d+)?\(가\)일용근로자임금을수입감소액으로함/) },
  { name: "간병비 인정 대상", ids: "^nursing\\.maxGrade$", find: has(/책임보험상해구분상1~5급에해당하는자중객관적인증빙자료를제출한경우/) },
  { name: "간병비 인정일수", ids: "^nursing\\.maxDays\\.", find: has(/상해등급인정일수1급~2급60일3급~4급30일5급15일/) },
  { name: "입원 식대", ids: "^incidental\\.mealPerMeal$", find: has(/한끼당4,030원/) },
  { name: "통원 1일 금액", ids: "^incidental\\.outpatientPerDay$", find: has(/실제통원한일수에대하여1일8,000원/) },
  {
    name: "후유장애 위자료(50% 이상)",
    ids: "^solatium\\.disability\\.high",
    find: has(/노동능력상실률이50%이상인경우\(가\)후유장애판정당시\(\*1\)피해자의나이가65세미만인경우:45,000,000원×노동능력상실률×85%\(나\)후유장애판정당시\(\*1\)피해자의나이가65세이상인경우:40,000,000원×노동능력상실률×85%/),
  },
  {
    name: "후유장애 위자료(50% 미만)",
    ids: "^solatium\\.disability\\.lowBands$",
    find: region(/\(2\)노동능력상실률이50%미만인경우/, /다\.후유장애상실수익액을지급하는경우/, (text) => {

      // 구간 이름을 지우고 남는 숫자가 인정액을 순서대로 이어 붙인 것과 같은지 본다(표의 배치가 약관마다 달라 숫자가 둘로 나뉘기도 한다).
      const labels = ["45%이상50%미만", "35%이상45%미만", "27%이상35%미만", "20%이상27%미만", "14%이상20%미만", "9%이상14%미만", "5%이상9%미만", "0초과5%미만"];
      if (!labels.every((label) => text.includes(label))) return false;
      let rest = text.replace("(2)노동능력상실률이50%미만인경우", "");
      for (const label of labels) rest = rest.replace(label, "");
      return rest.replace(/\D/g, "") === "4002402001601201008050";
    }),
  },
  { name: "위자료 중복", ids: "^solatium\\.disability\\.overlap", find: has(/부상위자료해당액이더많은경우에는그금액을후유장애위자료로지급함/) },
  { name: "사망 최저 보상", ids: "^liability1\\.death\\.minimum$", find: has(/상계한후의금액이2,000만원에미달하면2,000만원을보상/) },
  { name: "치료비 보장", ids: "^fault\\.medicalFloor$", find: has(/상계한후의금액이치료관계비와간병비의합산액에미달하면/) },
  { name: "경상환자 규정", ids: "^fault\\.minorInjuryGrades$", find: has(/상해급별구분중12급내지14급의상해를입은경우/) },
  { name: "대물배상 과실상계", ids: "^fault\\.propertyOffset$", find: has(/「대물배상」에의하여산출한금액에대하여피해자측의과실비율에따라상계/) },
  { name: "대인배상Ⅰ 상해급별 한도", ids: "^liability1\\.injury\\.limit\\.", find: region(/상해구분별한도금액/, /2개이상의상향또는하향조정의요인/, (text) => gradeAmounts(text, INJURY_LIMITS)) },
  { name: "대인배상Ⅰ 후유장애급별 한도", ids: "^liability1\\.disability\\.limit\\.", find: region(/후유장애의구분과책임보험금의한도금액/, /정상기능의4분의3이상을상실/, (text) => gradeAmounts(text, DISABILITY_LIMITS)) },
  {
    // 표가 두 쪽에 걸쳐 있는 약관이 있어, 상해급별 표와 후유장애급별 표를 한꺼번에 본다.
    name: "자기신체사고 급별 보험가입금액표",
    ids: "^selfInjury\\.(injury\\.limit|disability\\.amount)\\.",
    find: region(/상해등급보험가입금액1,500만원3,000만원5,000만원/, /피해자측의과실비율에따라상계하며/, (text) => {
      const expected = [1500, 3000, 5000, ...SELF_INJURY.flat(), 1500, 3000, 5000, ...SELF_DISABILITY.flat().filter((v) => v !== 10000)].map((v) => v * MAN);
      return same(manwon(text), expected) && (text.match(/1억원/g) ?? []).length === 2;
    }),
  },
  { name: "수리비 한도", ids: "^property\\.repair\\.", find: has(/사고직전가액의120%를한도로지급함\.다만,피해물이다음중어느하나에해당하는경우에는130%를한도로함/) },
  { name: "대차료 인정기간", ids: "^property\\.rental\\.(maxDays|maxDaysLongRepair)$", find: has(/25일\(실제정비작업시간이160시간을초과하는경우에는30일\)을한도로함/) },
  { name: "대차료 수리 불가", ids: "^property\\.rental\\.totalLossDays$", find: has(/통상의수리기간.{0,120}?\(2\)수리불가능한경우:10일/) },
  { name: "대차하지 않는 경우", ids: "^property\\.rental\\.notRentedPercent$", find: has(/통상의요금의35%상당액/) },
  { name: "휴차료 인정기간", ids: "^property\\.idle\\.", find: has(/수리가완료될때까지의기간으로하되,30일을한도로함\..{0,400}?\(2\)수리불가능한경우:10일/) },
  { name: "시세하락손해 대상", ids: "^property\\.depreciation\\.(maxVehicleAgeYears|minRepairRatioPercent)$", find: has(/출고후5년이하인자동차에한함\)의수리비용이사고직전자동차가액의20%를초과하는경우/) },
  { name: "시세하락손해 인정기준액", ids: "^property\\.depreciation\\.bands$", find: has(/출고후1년이하인자동차:수리비용의20%\(2\)출고후1년초과2년이하인자동차:수리비용의15%\(3\)출고후2년초과5년이하인자동차:수리비용의10%/) },
  { name: "대인·대물 지급보험금 조항", ids: "^clause\\.liability_(bodily_[12]|property)$", find: has(/1\.「대인배상Ⅰ」:자동차손해배상보장법령에서정한기준에따라산출한금액2\.「대인배상Ⅱ」,「대물배상」:보험증권에기재된보험가입금액/) },
  { name: "자기신체사고 지급보험금 조항", ids: "^clause\\.self_injury$", find: has(/사망,부상,후유장애의지급보험금은다음과같은방법으로각각계산합니다/) },
  { name: "무보험자동차상해 지급보험금 조항", ids: "^clause\\.uninsured$", find: has(/제20조\(지급보험금의계산\)「?무보험자동차에의한상해/) },
  { name: "자기차량손해 한도", ids: "^clause\\.own_damage$", find: has(/보험가입금액을한도로손해액전액을보상하며,보험가입금액이보험가액보다많은경우에는보험가액을한도로보상/) },
  { name: "자기부담금 면제", ids: "^ownDamage\\.deductible\\.waivedOnTotalLoss$", find: has(/전부손해\(\*1\)가생긴경우또는보험회사가보상하여야할금액이보험가입금액전액이상인경우에는공제하지않습니다/) },
  { name: "자기부담금 구상금 반영", ids: "^ownDamage\\.deductible\\.onNetOfRecovery$", find: has(/실제손해액에서당해구상금을제외한금액을전제로산정된자기부담금/) },
  { name: "변호사선임비용 한도", ids: "^rider\\.legal\\.lawyer\\.limit$", find: has(/변호사선임비용을실제로부담함으로써입은손해를1사고마다(?:5백만원|500만원)한도로지급/) },
  { name: "벌금비용 한도", ids: "^rider\\.legal\\.fine\\.limit$", find: has(/(?:벌금)?에상당하는금액으로서2,000만원을한도로지급/) },
  { name: "벌금비용 한도(어린이 보호구역)", ids: "^rider\\.legal\\.fine\\.schoolZoneLimit$", find: has(/피보험자가부담하여야하는벌금액(?:법규해설\d+쪽\))?을3,000만원한도로지급/) },
  { name: "형사합의금 한도(중상해)", ids: "^rider\\.legal\\.settlement\\.seriousInjury$", find: has(/‘\(1\)’의③의경우:3천만원/) },
  { name: "렌트비용 1일 한도", ids: "^rider\\.rental\\.dailyLimit\\.", find: has(/한도70,000110,000210,000350,000140,000/) },
  { name: "렌트비용 대차하지 않는 경우", ids: "^rider\\.rental\\.notRentedPercent$", find: has(/1일지급한도는1일당차종별렌트비용한도금액의35%로합니다/) },
  { name: "렌트비용 인정기간", ids: "^rider\\.rental\\.(maxDays|totalLossDays)$", find: has(/30일을한도로수리가완료될때까지의기간으로함\..{0,120}?(?:나\.|ㄴ\))수리불가능한경우:10일/) },
  { name: "자동차상해 지급보험금", ids: "^clause\\.auto_injury$", find: has(/실제손해액은.{0,60}보험금지급기준.{0,10}에의해산출한금액.{0,200}?과실상계및보상한도를적용하기전의금액/) },
];

/** 법률비용 지원 특약의 형사합의금 한도표를 글자 그대로 읽는다(약관마다 가입 유형과 칸이 다르다) */
function settlementTable(doc) {
  const start = doc.flat.search(/피해자의상해구분(?:사망)?상해등급1급/);
  if (start < 0) return null;
  const text = doc.flat.slice(start, start + 600);
  const header = /^피해자의상해구분((?:사망|상해등급\d+급(?:~\d+급)?)+)/.exec(text)?.[1] ?? "";
  const columns = [...header.matchAll(/사망|상해등급(\d+)급(?:~(\d+)급)?/g)].map((m) => (m[0] === "사망" ? "death" : `grade${m[1]}-${m[2] ?? m[1]}`));
  const rows = {};
  // "지급보험금"은 가입 유형이 하나뿐인 약관의 줄 이름이다.
  for (const match of text.matchAll(/(기본형|고급형|고보장형|최고급형Ⅱ|최고급형|지급보험금)((?:[\d,]+만원|-)+)/g)) {
    const cells = [...match[2].matchAll(/([\d,]+)만원|-/g)].map((m) => (m[1] ? Number(m[1].replace(/,/g, "")) * MAN : 0));
    rows[match[1]] = cells.slice(0, columns.length);
  }
  // 표에 사망 칸이 없는 약관은 사망 사고의 한도를 문장으로 적는다.
  const death = /‘\(1\)’의①의경우:(\d)천만원/.exec(doc.flat.slice(Math.max(0, start - 400), start + 600));
  return { page: doc.pageAt(start), columns, rows, deathLimit: death ? Number(death[1]) * 1000 * MAN : null };
}

/** 가입 유형 이름 → 규칙 id에 쓰는 이름. "지급보험금"은 가입 유형을 나누지 않는 약관의 줄이다 */
const PLAN_KEYS = { 기본형: "basic", 고급형: "premium", 고보장형: "premium", 최고급형: "top", 최고급형Ⅱ: "top2", 지급보험금: "basic" };

/** 형사합의금 한도표를 급별 값으로 편다. 표에 없는 급은 보상하지 않는 것(0)이다 */
function settlementByGrade(table, name) {
  const row = table.rows[name];
  const values = { death: table.deathLimit ?? 0 };
  for (let grade = 1; grade <= 14; grade++) values[`grade${grade}`] = 0;
  table.columns.forEach((column, index) => {
    if (column === "death") values.death = row[index];
    else {
      const [from, to] = column.replace("grade", "").split("-").map(Number);
      for (let grade = from; grade <= to; grade++) values[`grade${grade}`] = row[index];
    }
  });
  return values;
}

const result = { note: "scripts/check-product-terms.mjs가 만든 파일이다. 손으로 고치지 않는다. page는 약관에 인쇄된 쪽 번호.", products: {} };
let failed = false;
let personalPlans = null;
for (const [product, file] of Object.entries(FILES)) {
  // 현대해상 약관 네 가지는 인쇄된 쪽 번호가 PDF 쪽 번호보다 2 작다. 표준약관은 PDF 쪽 번호를 그대로 적는다.
  const doc = await load(file, product === "standard" ? 0 : 2);
  const probes = PROBES.map((probe) => {
    const index = probe.find(doc);
    return { name: probe.name, ids: probe.ids, same: index >= 0, page: index >= 0 ? doc.pageAt(index) : null };
  });
  // 법률비용 지원 특약의 형사합의금: 가입 유형별로 개인용 약관의 값과 견준다.
  const table = settlementTable(doc);
  const plans = {};
  if (table) for (const name of Object.keys(table.rows)) plans[PLAN_KEYS[name]] = { name, values: settlementByGrade(table, name) };
  if (product === "personal") personalPlans = plans;
  const legalPlans = Object.entries(plans).map(([key, plan]) => {
    const matches = personalPlans[key] !== undefined && JSON.stringify(personalPlans[key].values) === JSON.stringify(plan.values);
    probes.push({ name: `형사합의금 한도(${plan.name})`, ids: `^rider\\.legal\\.settlement\\.${key}\\.`, same: matches, page: table.page });
    return { key, name: plan.name, same: matches };
  });
  const missing = probes.filter((probe) => !probe.same).map((probe) => probe.name);
  console.log(`${product}: ${probes.length - missing.length}/${probes.length} 일치${missing.length ? ` — 찾지 못함: ${missing.join(", ")}` : ""} / 형사합의금 가입 유형: ${legalPlans.map((plan) => plan.name).join(", ") || "없음"}`);
  // 개인용 약관에서 찾지 못하는 대조는 대조 방법이 틀린 것이다.
  if (product === "personal" && missing.length) failed = true;
  result.products[product] = { file: basename(file), sha256: doc.sha256, probes, legalPlans, legalTablePage: table?.page ?? null };
}
if (failed) throw new Error("개인용 약관에서 찾지 못한 대조가 있습니다. 대조 방법을 고쳐야 합니다.");
writeFileSync("data/rules/product-check.json", `${JSON.stringify(result, null, 2)}\n`);
