// 라운드 7 서류 인식 실제 호출 시험. 실행 전 `npm run build`.
//   PLAYWRIGHT_BROWSERS_PATH 등은 필요 없다. node scripts/live-ai-check.mjs
// - 키는 v6/.env.local에서만 읽는다(next start가 읽음). 이 스크립트는 키가 "있음/없음"만 보고 값은 어디에도 출력하지 않는다.
// - 시험 파일은 tests/fixtures/ai/의 가상 서류뿐이다(scripts/make-ai-fixtures.mjs). 실제 개인정보가 없다.
// - 칸마다 기대값과 맞춰 정확도(맞은 칸/전체 칸), 개인정보 노출, 토큰·비용을 출력한다. 파일은 쓰지 않는다.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const present = /^ANTHROPIC_API_KEY=\S+/m.test(env);
console.log(`ANTHROPIC_API_KEY: ${present ? "있음" : "없음"}`);
if (!present) process.exit(1);

// 셸의 같은 이름 변수가 .env.local을 덮지 않게 뺀다
const childEnv = { ...process.env };
for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "STT_MODEL"]) delete childEnv[name];
const server = spawn("npx", ["next", "start", "-p", "3458"], { stdio: "pipe", env: childEnv });
await new Promise((resolve) => server.stdout.on("data", (d) => String(d).includes("Ready") && resolve()));

/** 가상 서류에 일부러 넣은 개인정보 조각. 응답 어디에도 나오면 안 된다 */
const LEAKS = ["900101", "1234567", "010-1234", "1234-5678", "12가3456", "2026-123456789", "800202", "2345678", "9876-5432"];

const amount = (reading, code) => reading.amounts.filter((a) => a.code === code).reduce((s, a) => s + a.amount, 0) || null;
const cov = (reading, key) => reading.coverages.find((c) => c.coverage === key);
const RECEIPT = (r) => [
  ["치료비 2,000,000", amount(r, "treatment") === 2_000_000],
  ["입원일수 5", r.facts.hospitalDays === 5],
  ["통원일수 4", r.facts.outpatientDays === 4],
  ["월 소득 없음(null)", r.facts.monthlyIncome === null],
  ["다른 금액 없음", r.amounts.every((a) => a.code === "treatment")],
];
const CASES = [
  { label: "PDF 진료비 영수증", file: "receipt.pdf", type: "application/pdf", kind: "claim", target: "person", checks: RECEIPT },
  { label: "JPEG 진료비 영수증", file: "receipt.jpg", type: "image/jpeg", kind: "claim", target: "person", checks: RECEIPT },
  {
    label: "HEIC 수리비 견적서",
    file: "estimate.heic",
    type: "image/heic",
    kind: "claim",
    target: "property",
    checks: (r) => [
      ["수리비 1,980,000", amount(r, "repair") === 1_980_000],
      ["견인비 100,000", amount(r, "towing") === 100_000],
      ["대차료·휴차료 없음", !r.amounts.some((a) => a.code === "rental" || a.code === "idle")],
    ],
  },
  {
    label: "JPEG 증권",
    file: "policy.jpg",
    type: "image/jpeg",
    kind: "policy",
    checks: (r) => [
      ["증권으로 인식", r.isPolicy === true],
      ["보험회사", r.insurer === "가상화재해상보험"],
      ["개인용", r.productLine === "personal"],
      ["가족한정", r.driverScope === "family"],
      ["가입 담보 6개(자기신체사고 미가입 제외)", ["liability_bodily_1", "liability_bodily_2", "liability_property", "auto_injury", "uninsured", "own_damage"].every((k) => cov(r, k)) && !cov(r, "self_injury")],
      ["대인Ⅱ 무한", cov(r, "liability_bodily_2")?.unlimited === true],
      ["대물 2억", cov(r, "liability_property")?.limit === 200_000_000],
      ["자동차상해 부상 3천만", cov(r, "auto_injury")?.injuryLimit === 30_000_000],
      ["자동차상해 사망 2억", cov(r, "auto_injury")?.deathLimit === 200_000_000],
      ["자동차상해 후유장애 2억", cov(r, "auto_injury")?.disabilityLimit === 200_000_000],
      ["무보험차상해 2억", cov(r, "uninsured")?.limit === 200_000_000],
      ["자기부담금 20%·20만·50만", r.ownDamageDeductible?.ratePercent === 20 && r.ownDamageDeductible?.min === 200_000 && r.ownDamageDeductible?.max === 500_000],
    ],
  },
];

let right = 0;
let total = 0;
for (const c of CASES) {
  const form = new FormData();
  form.set("file", new Blob([readFileSync(`tests/fixtures/ai/${c.file}`)], { type: c.type }));
  form.set("kind", c.kind);
  if (c.target) form.set("target", c.target);
  const started = Date.now();
  const response = await fetch("http://localhost:3458/api/documents/read", { method: "POST", body: form });
  const body = await response.json();
  const text = JSON.stringify(body);
  const leaks = LEAKS.filter((s) => text.includes(s));
  console.log(`\n== ${c.label}: HTTP ${response.status}, ${Date.now() - started}ms, 개인정보 노출 ${leaks.length ? leaks.join(",") : "없음"}, 가린 표시(●) ${text.includes("●") ? "있음" : "없음"}`);
  if (!body.ok) {
    console.log(body.message);
    continue;
  }
  const checks = c.checks(body.reading);
  right += checks.filter(([, ok]) => ok).length;
  total += checks.length;
  for (const [name, ok] of checks) console.log(`  ${ok ? "○" : "×"} ${name}`);
  console.log(`  정확도 ${checks.filter(([, ok]) => ok).length}/${checks.length}, 토큰 입력 ${body.usage.inputTokens} 출력 ${body.usage.outputTokens}, 추정 비용 $${body.usage.costUsd.toFixed(4)}`);
  console.log(`  읽은 값: ${JSON.stringify(body.reading)}`);
}
console.log(`\n전체 정확도 ${right}/${total}`);
server.kill();
