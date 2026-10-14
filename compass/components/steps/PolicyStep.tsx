"use client";

import { useRef, useState, type ReactNode } from "react";
import { StepShell } from "@/components/StepShell";
import { TicketBadge, TicketGate } from "@/components/TicketGate";
import { Card, outlineButton } from "@/components/ui";
import { paidFetch } from "@/lib/guard/paid-client";
import { usePaid } from "@/lib/guard/use-paid";
import { cachedReading, fileDigest, rememberReading } from "@/lib/upload/reading-cache";
import { applyReading } from "@/lib/draft/apply-reading";
import { newCoverage } from "@/lib/draft/store";
import { PRODUCT_LINE_LABELS, type CoverageDraft, type PolicyDraft, type ProductLine } from "@/lib/draft/types";
import { readResponseSchema, type PolicyReading } from "@/lib/schemas/policy-reading";
import { UPLOAD_LIMIT, shrinkIfLarge } from "@/lib/upload/shrink";

const LINES = (Object.keys(PRODUCT_LINE_LABELS) as ProductLine[]).map((value) => ({
  value,
  label: PRODUCT_LINE_LABELS[value].replace(" 자동차보험", "").replace("자동차보험", ""),
}));
const SOURCE_LABELS = { "pdf-text": "PDF의 글자", "pdf-scan": "PDF 스캔본", image: "사진" };

function Flag() {
  return <span className="ml-1 inline-block rounded bg-warn px-1.5 py-0.5 text-xs font-bold text-warn-ink">확인 필요</span>;
}

const cellInput = "min-h-12 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-lg placeholder:text-muted/70 focus:border-navy";

// 금액 표현은 길어질 수 있어 여러 줄로 보여 준다.
const cellArea = "block w-full min-w-0 resize-none rounded-lg border border-transparent bg-transparent px-2 py-2 text-lg leading-snug placeholder:text-muted/70 focus:border-navy [field-sizing:content]";

/** 표의 한 줄: 왼쪽은 항목 이름, 오른쪽은 고칠 수 있는 값. 읽지 못한 칸은 노란색으로 표시한다. */
function Row({ label, flag, children }: { label: string; flag?: boolean; children: ReactNode }) {
  return (
    <tr className={flag ? "bg-warn-soft" : undefined}>
      <th scope="row" className="w-[6.5rem] border border-line px-2 py-2 text-left align-middle text-base font-semibold">
        {label}
        {flag && <Flag />}
      </th>
      <td className={`border p-1 ${flag ? "border-warn-ink/40" : "border-line"}`}>{children}</td>
    </tr>
  );
}

function Pick<T extends string>(props: { label: string; value: T | ""; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={props.label} className="flex flex-wrap gap-1.5">
      {props.options.map((option) => {
        const on = props.value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => props.onChange(option.value)}
            className={`min-h-11 flex-1 rounded-lg border px-2 text-base font-semibold ${on ? "border-navy bg-navy text-white" : "border-line bg-white text-ink"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

type ReadState =
  | { status: "idle" }
  | { status: "reading" }
  | { status: "done"; source: keyof typeof SOURCE_LABELS; missing: number; reused?: boolean }
  | { status: "error"; message: string; needPassword: boolean };

function countMissing(reading: PolicyReading) {
  const top = Object.entries(reading).filter(([key, value]) => key !== "coverages" && key !== "riders" && value === null).length;
  const inRows = reading.coverages.reduce((sum, c) => sum + [c.name, c.limit, c.deductible].filter((v) => v === null).length, 0);
  return top + inRows + (reading.coverages.length === 0 ? 1 : 0);
}

function hasInput(policy: PolicyDraft) {
  return !!(policy.insurer || policy.productName || policy.coverages.some((c) => c.joined));
}

export function PolicyStep() {
  // 증권 읽기는 유료 기능이라 문지기를 통과할 때만 쓴다. 직접 입력은 누구나 할 수 있다.
  const guest = !usePaid("policy-read").ready;
  const [read, setRead] = useState<ReadState>({ status: "idle" });
  const [password, setPassword] = useState("");
  // 비밀번호를 물어야 할 때 같은 파일을 다시 보내기 위해 들고 있는다. 화면을 떠나면 사라진다.
  const picked = useRef<File | null>(null);

  return (
    <StepShell step={1} lead="증권이나 가입증명서를 올리고, 읽어온 담보를 확인합니다.">
      {(draft, update) => {
        const policy = draft.policy;
        const setPolicy = (change: Partial<PolicyDraft>) => update((d) => ({ ...d, policy: { ...d.policy, ...change } }));
        const setCoverage = (id: string, change: Partial<CoverageDraft>) =>
          setPolicy({ coverages: policy.coverages.map((c) => (c.id === id ? { ...c, ...change } : c)) });
        const flag = (key: keyof PolicyDraft) => policy.unread.includes(key) && !policy[key];
        const text = (key: "insurer" | "productName" | "vehicleModel" | "driverScope" | "driverAgeLimit", label: string, placeholder?: string) => (
          <Row label={label} flag={flag(key)}>
            <input aria-label={label} className={cellInput} value={policy[key]} placeholder={placeholder} onChange={(e) => setPolicy({ [key]: e.target.value })} />
          </Row>
        );
        const date = (key: "periodStart" | "periodEnd", label: string) => (
          <Row label={label} flag={flag(key)}>
            <input aria-label={label} type="date" className={cellInput} value={policy[key]} onChange={(e) => setPolicy({ [key]: e.target.value })} />
          </Row>
        );

        async function send(file: File, pdfPassword: string) {
          setRead({ status: "reading" });
          try {
            const upload = await shrinkIfLarge(file);
            if (upload.size > UPLOAD_LIMIT) {
              return setRead({ status: "error", needPassword: false, message: "파일이 너무 큽니다. 4MB 이하의 파일을 올리거나 화면을 캡처해 올려 주세요." });
            }
            // 이 탭에서 이미 읽은 파일이면 서버에 다시 보내지 않는다.
            const digest = await fileDigest(upload);
            const cached = cachedReading(digest);
            if (cached) {
              update((d) => ({ ...d, policy: { ...applyReading(d.policy, cached.reading, () => crypto.randomUUID()), fileName: file.name } }));
              picked.current = null;
              setPassword("");
              return setRead({ status: "done", source: cached.source, missing: countMissing(cached.reading), reused: true });
            }
            const form = new FormData();
            form.set("file", upload);
            if (pdfPassword) form.set("password", pdfPassword);
            const response = await paidFetch("policy-read", "/api/policies/read", { method: "POST", body: form });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
              const code = body?.code as string | undefined;
              return setRead({
                status: "error",
                needPassword: code === "PDF_PASSWORD" || code === "PDF_PASSWORD_WRONG",
                message: body?.error ?? "증권을 읽지 못했습니다. 아래에 직접 입력해 주세요.",
              });
            }
            const result = readResponseSchema.safeParse(body);
            if (!result.success) return setRead({ status: "error", needPassword: false, message: "증권을 읽지 못했습니다. 아래에 직접 입력해 주세요." });
            rememberReading(digest, result.data);
            update((d) => ({ ...d, policy: { ...applyReading(d.policy, result.data.reading, () => crypto.randomUUID()), fileName: file.name } }));
            picked.current = null;
            setPassword("");
            setRead({ status: "done", source: result.data.source, missing: countMissing(result.data.reading) });
          } catch {
            setRead({ status: "error", needPassword: false, message: "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." });
          }
        }

        function choose(file: File | undefined) {
          if (!file) return;
          if (hasInput(policy) && !window.confirm("읽어온 값으로 아래 내용을 바꿉니다. 직접 입력한 내용은 지워집니다. 계속할까요?")) return;
          picked.current = file;
          void send(file, "");
        }

        return (
          <>
            <Card title="증권·가입증명서 올리기">
              {guest ? (
                <>
                  <TicketGate route="policy-read" what="증권 자동 읽기" />
                  <p className="text-muted">아래에 직접 입력할 수 있습니다.</p>
                </>
              ) : (
                <>
                  <label className={`${outlineButton} cursor-pointer ${read.status === "reading" ? "pointer-events-none opacity-40" : ""}`}>
                    {read.status === "reading" ? "읽는 중… (30초쯤 걸립니다)" : "사진 또는 PDF 고르기"}
                    <input
                      type="file"
                      accept="image/*,application/pdf,.pdf,.heic,.heif"
                      className="sr-only"
                      disabled={read.status === "reading"}
                      onChange={(e) => {
                        choose(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <p className="text-sm text-muted">PDF, 아이폰 사진(HEIC), JPG, PNG를 읽습니다. 이름·주민번호·증권번호·차량번호는 가리고 찍으면 더 안전합니다.</p>
                  <TicketBadge route="policy-read" />
                  <div role="status" aria-live="polite" className="flex flex-col gap-3">
                    {read.status === "done" && (
                      <p className="rounded-xl bg-navy-soft px-4 py-3 text-navy">
                        {read.reused ? "앞서 읽은 같은 파일의 결과를 다시 썼습니다(이용권 횟수를 쓰지 않았습니다). " : `${SOURCE_LABELS[read.source]}에서 읽었습니다. `}
                        {read.missing > 0
                          ? `읽지 못한 칸 ${read.missing}곳을 노란색으로 표시했습니다. 나머지도 증권과 같은지 확인해 주세요.`
                          : "아래 표가 증권과 같은지 확인하고, 다르면 고쳐 주세요."}
                      </p>
                    )}
                    {read.status === "error" && <p className="rounded-xl bg-warn-soft px-4 py-3 font-semibold text-warn-ink">{read.message}</p>}
                    {read.status === "error" && read.needPassword && (
                      <form
                        className="flex flex-col gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (picked.current && password) void send(picked.current, password);
                        }}
                      >
                        <label className="flex flex-col gap-1.5">
                          <span className="font-semibold">PDF 비밀번호</span>
                          <input
                            type="password"
                            autoComplete="off"
                            className="min-h-13 w-full rounded-xl border border-line px-4 text-lg focus:border-navy"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                        </label>
                        <button type="submit" className={outlineButton} disabled={!password}>
                          비밀번호로 다시 읽기
                        </button>
                        <p className="text-sm text-muted">비밀번호는 PDF를 여는 데만 쓰고 저장하지 않습니다.</p>
                      </form>
                    )}
                  </div>
                  {policy.fileName && read.status !== "reading" && <p className="break-all text-sm text-muted">마지막으로 읽은 파일: {policy.fileName}</p>}
                </>
              )}
            </Card>

            <Card title="기본 정보">
              <table id="f-policy-productLine" className="w-full scroll-mt-28 table-fixed border-collapse">
                <tbody>
                  {text("insurer", "보험회사")}
                  {text("productName", "상품 이름")}
                  <Row label="보험 종류" flag={flag("productLine")}>
                    <Pick label="보험 종류" value={policy.productLine} options={LINES} onChange={(productLine) => setPolicy({ productLine })} />
                  </Row>
                  {date("periodStart", "보험 시작일")}
                  {date("periodEnd", "보험 종료일")}
                  {text("vehicleModel", "차종")}
                  {text("driverScope", "운전자 범위", "예: 부부한정")}
                  {text("driverAgeLimit", "연령 한정", "예: 만 30세 이상")}
                </tbody>
              </table>
              <p className="text-sm text-muted">이름·주민등록번호·생년월일·증권번호·차량번호는 받지 않고 저장하지 않습니다. 보험 정보만 남깁니다.</p>
            </Card>

            <Card title="담보 확인·수정">
              <p id="f-policy-coverages" className="scroll-mt-28 text-muted">증권에 있는 담보만 &ldquo;가입&rdquo;으로 두고, 금액은 증권에 적힌 그대로 적어 주세요.</p>
              {policy.unread.includes("coverages") && !policy.coverages.some((c) => c.joined) && (
                <p className="rounded-xl bg-warn-soft px-4 py-3 font-semibold text-warn-ink">담보를 읽지 못했습니다. 증권을 보고 가입한 담보를 직접 표시해 주세요.</p>
              )}
              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  <col className="w-[6.5rem]" />
                  <col />
                </colgroup>
                {policy.coverages.map((coverage) => {
                  const miss = (key: "name" | "limit" | "deductible") => !!coverage.unread?.includes(key) && !coverage[key];
                  return (
                    <tbody key={coverage.id} className="border-b-8 border-white">
                      <tr className={miss("name") ? "bg-warn-soft" : "bg-navy-soft"}>
                        <td colSpan={2} className="border border-line p-1">
                          <div className="flex items-center gap-2">
                            <input
                              aria-label="담보 이름"
                              className={`${cellInput} font-bold`}
                              value={coverage.name}
                              placeholder="담보 이름"
                              onChange={(e) => setCoverage(coverage.id, { name: e.target.value })}
                            />
                            {miss("name") && <Flag />}
                            <button
                              type="button"
                              aria-pressed={coverage.joined}
                              onClick={() => setCoverage(coverage.id, { joined: !coverage.joined })}
                              className={`min-h-11 shrink-0 rounded-full border px-4 text-base font-semibold ${
                                coverage.joined ? "border-navy bg-navy text-white" : "border-line bg-white text-muted"
                              }`}
                            >
                              {coverage.joined ? "가입" : "미가입"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {coverage.joined && (
                        <>
                          <Row label="가입금액·한도" flag={miss("limit")}>
                            <textarea
                              aria-label={`${coverage.name} 가입금액·한도`}
                              rows={2}
                              className={cellArea}
                              value={coverage.limit}
                              placeholder="증권에 적힌 그대로"
                              onChange={(e) => setCoverage(coverage.id, { limit: e.target.value })}
                            />
                          </Row>
                          <Row label="자기부담금" flag={miss("deductible")}>
                            <textarea
                              aria-label={`${coverage.name} 자기부담금`}
                              rows={2}
                              className={cellArea}
                              value={coverage.deductible}
                              placeholder={miss("deductible") ? "증권을 보고 적어 주세요. 없으면 '없음'" : "없으면 비워 두세요"}
                              onChange={(e) => setCoverage(coverage.id, { deductible: e.target.value })}
                            />
                          </Row>
                          <tr>
                            <td colSpan={2} className="text-right">
                              <button
                                type="button"
                                className="min-h-11 px-2 text-base font-semibold text-muted underline"
                                onClick={() => setPolicy({ coverages: policy.coverages.filter((c) => c.id !== coverage.id) })}
                              >
                                이 담보 지우기
                              </button>
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  );
                })}
              </table>
              <button
                type="button"
                className={outlineButton}
                onClick={() => setPolicy({ coverages: [...policy.coverages, { ...newCoverage(crypto.randomUUID()), joined: true }] })}
              >
                + 담보 추가
              </button>
            </Card>

            <Card title="특약">
              {policy.riders.length === 0 && <p className="text-muted">특약이 없거나 아직 입력하지 않았습니다.</p>}
              <ul className="flex flex-col gap-2">
                {policy.riders.map((rider, index) => (
                  <li key={index} className="flex items-center gap-2 rounded-xl border border-line p-1">
                    <input
                      aria-label={`특약 ${index + 1}`}
                      className={cellInput}
                      value={rider}
                      placeholder="특약 이름"
                      onChange={(e) => setPolicy({ riders: policy.riders.map((r, i) => (i === index ? e.target.value : r)) })}
                    />
                    <button
                      type="button"
                      className="min-h-11 shrink-0 px-2 text-base font-semibold text-muted underline"
                      onClick={() => setPolicy({ riders: policy.riders.filter((_, i) => i !== index) })}
                    >
                      지우기
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className={outlineButton} onClick={() => setPolicy({ riders: [...policy.riders, ""] })}>
                + 특약 추가
              </button>
            </Card>
          </>
        );
      }}
    </StepShell>
  );
}
