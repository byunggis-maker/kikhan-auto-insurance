// 통합 점검용 가짜 제공자(LLM·음성). 실제 키 없이 화면 흐름 전체를 확인하기 위한 것이다. 운영 코드에서는 쓰지 않는다.
// 쓰는 법:
//   node scripts/e2e/mock-services.mjs 4010 /tmp/requests.log
//   E2E_MOCK_URL=http://127.0.0.1:4010 NODE_OPTIONS="--import ./scripts/e2e/mock-fetch.mjs" npx next start
// 받은 요청 본문(그림 데이터는 길이만)을 두 번째 인자의 파일에 한 줄씩 적는다. 신원정보가 제공자에게 갔는지 점검할 때 본다.
// 일부러 지시를 어긴 판독 결과(이름·증권번호·차량번호·주민번호)를 돌려준다. 앱이 그것을 가리는지 보기 위해서다.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4010);
const logFile = process.argv[3];

const POLICY = {
  insurer: "가상화재해상보험",
  productName: "가상 개인용 자동차보험",
  productLine: "personal",
  periodStart: "2026-01-01",
  periodEnd: "2027-01-01",
  vehicleModel: "가상세단 2.0",
  driverScope: "부부한정",
  driverAgeLimit: "만 30세 이상",
  coverages: [
    { name: "대인배상Ⅰ", limit: "자배법 시행령에서 정한 금액", deductible: "" },
    { name: "대인배상Ⅱ", limit: "무한", deductible: "" },
    { name: "대물배상", limit: "1사고당 5억원", deductible: "" },
    { name: "자동차상해", limit: "사망·후유장애 2억원, 부상 3천만원", deductible: "" },
    { name: "자기차량손해 (피보험자 홍길동)", limit: "2,500만원", deductible: "손해액의 20% (최소 20만원, 최대 50만원)" },
  ],
  riders: ["긴급출동서비스 특약 (연락처 010-1234-5678)", "블랙박스 장착 할인 특약"],
  // 스키마에 없는 칸. 앱의 검증에서 버려져야 한다.
  policyNumber: "가상-2026-000123",
  insuredName: "홍길동",
  vehicleNumber: "12가3456",
  residentFront6: "800505",
};

const FACTS = {
  accident: { date: "2026-09-01", time: "15:00", place: "가상시 중앙 사거리", kind: "car_car", vehicleDamage: "뒤 범퍼 파손", inferred: [] },
  people: [
    { role: "driver", injury: "목과 허리를 다침", diagnosis: "경추 염좌", surgery: true, hospitalStay: "10일", outpatientVisits: "5일", faultPercent: 30, occupation: "회사원", age: 42, inferred: [] },
    { role: "passenger", injury: "무릎 타박상", diagnosis: null, surgery: null, hospitalStay: null, outpatientVisits: "3일", faultPercent: null, occupation: null, age: null, inferred: [] },
  ],
};

const EXPLANATION = { sentences: ["이 담보는 치료비와 위자료 같은 손해를 더한 뒤 과실만큼 줄여 계산했습니다.", "자세한 금액은 위 항목별 내역에 있습니다."] };

function answerFor(name) {
  if (name === "record_policy") return POLICY;
  if (name === "record_accident") return FACTS;
  return EXPLANATION;
}

function log(path, body) {
  if (!logFile) return;
  const text = body.replace(/"data":"[A-Za-z0-9+/=]{100,}"/g, (m) => `"data":"<image ${m.length}>"`).replace(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g, "<image>");
  appendFileSync(logFile, `${path} ${text.slice(0, 20000)}\n`);
}

// 0.1초 남짓의 무음 mp3(헤더만)
const SILENT_MP3 = Buffer.from("SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", "base64");

createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const raw = Buffer.concat(chunks);
    const path = request.url ?? "";
    const isText = (request.headers["content-type"] ?? "").includes("json");
    log(path, isText ? raw.toString("utf8") : `<${request.headers["content-type"]} ${raw.length} bytes>`);
    if (path.endsWith("/v1/audio/transcriptions")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(JSON.stringify({ text: "어제 오후 세 시 중앙 사거리에서 뒤차가 받았습니다. 제 이름은 성명 홍길동이고 전화는 010-1234-5678입니다." }));
    }
    if (path.endsWith("/v1/audio/speech")) {
      response.writeHead(200, { "Content-Type": "audio/mpeg" });
      return response.end(SILENT_MP3);
    }
    let body = {};
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      // 본문이 JSON이 아니면 빈 값으로 본다.
    }
    if (path.startsWith("/llm/anthropic")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(JSON.stringify({ content: [{ type: "tool_use", input: answerFor(body.tool_choice?.name) }] }));
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answerFor(body.response_format?.json_schema?.name)) } }] }));
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`mock services on http://127.0.0.1:${port}`);
});
