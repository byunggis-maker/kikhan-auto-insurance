"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { StepShell } from "@/components/StepShell";
import { TicketBadge, TicketGate } from "@/components/TicketGate";
import { Card, Choice, TextField, outlineButton, type FieldMark } from "@/components/ui";
import { paidFetch } from "@/lib/guard/paid-client";
import { usePaid } from "@/lib/guard/use-paid";
import { useConsent } from "@/lib/privacy/consent";
import { applyFacts } from "@/lib/draft/apply-facts";
import { ACCIDENT_KIND_LABELS, COUNTERPARTY_INSURANCE_LABELS, type AccidentDraft, type AccidentKind, type CounterpartyInsurance, type YesNo } from "@/lib/draft/types";
import { redact } from "@/lib/privacy/redact";
import { accidentFactsSchema } from "@/lib/schemas/accident-facts";
import { AudioController, type AudioState, type RecorderClass } from "@/lib/speech/audio-controller";
import { splitAudio } from "@/lib/speech/split";
import { MIN_INTERVAL_MS } from "@/lib/guard/config";
import { detectInApp, externalOpenUrl } from "@/lib/browser/in-app";

const KINDS = (Object.keys(ACCIDENT_KIND_LABELS) as AccidentKind[]).map((value) => ({ value, label: ACCIDENT_KIND_LABELS[value] }));
const INSURANCES = (Object.keys(COUNTERPARTY_INSURANCE_LABELS) as CounterpartyInsurance[]).map((value) => ({ value, label: COUNTERPARTY_INSURANCE_LABELS[value] }));
const BUSY = ["starting", "stopping", "transcribing"];
const HAD = [
  { value: "yes" as const, label: "했음" },
  { value: "no" as const, label: "안 했음" },
];
const EXISTS = [
  { value: "yes" as const, label: "있음" },
  { value: "no" as const, label: "없음 (단독·주차 중 등)" },
];
/** 녹음은 했지만 이용권이 없을 때. 녹음은 이 화면의 메모리에 남겨 두고, 이용권을 받으면 같은 녹음으로 다시 보낸다. */
const NEED_TICKET = "녹음은 이 화면에 잠시 보관했습니다. 아래에서 이용권을 받은 뒤 '다시 시도'를 누르면 글로 바꿉니다.";

/** 녹음 경과 시간 m:ss */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const MIN_TEXT = 10;

type ExtractState = { status: "idle" | "working" } | { status: "done" | "error"; message: string };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 조각 하나를 서버로 보낸다. 너무 빨리 보냈다고 하면(TOO_FAST) 잠깐 쉬고 한 번 더 보낸다. */
async function sendPiece(piece: Blob, again = true): Promise<string> {
  const form = new FormData();
  form.set("audio", piece, "speech");
  let response: Response;
  try {
    response = await paidFetch("stt", "/api/stt", { method: "POST", body: form });
  } catch {
    throw new Error("서버에 연결하지 못했습니다. 다시 눌러 같은 녹음으로 다시 시도할 수 있습니다.");
  }
  const body = await response.json().catch(() => null);
  if (response.status === 429 && body?.code === "TOO_FAST" && again) {
    await wait(MIN_INTERVAL_MS.stt + 500);
    return sendPiece(piece, false);
  }
  if (!response.ok || typeof body?.text !== "string") throw new Error(body?.error ?? "음성을 글로 바꾸지 못했습니다.");
  return body.text;
}

/** 4MB를 넘는 녹음은 60초씩 나눠 차례로 보내고, 받은 글을 이어 붙인다. 중간에 실패하면 거기까지의 글을 남긴다. */
async function sendAudio(blob: Blob, onProgress: (done: number, total: number) => void): Promise<{ text: string; note?: string }> {
  const pieces = await splitAudio(blob);
  const texts: string[] = [];
  try {
    for (const [index, piece] of pieces.entries()) {
      onProgress(index, pieces.length);
      // 서버는 같은 이용권의 연속 요청 사이에 간격을 둔다.
      if (index > 0) await wait(MIN_INTERVAL_MS.stt + 200);
      texts.push(await sendPiece(piece));
    }
  } catch (error) {
    if (texts.length === 0) throw error;
    return {
      text: texts.join(" "),
      note: `앞부분 ${texts.length}분만 글로 바꿨습니다. ${(error as Error).message} 나머지는 아래에 직접 적어 주세요.`,
    };
  } finally {
    onProgress(0, 0);
  }
  return { text: texts.join(" ") };
}

const noSubscribe = () => () => {};
const inAppName = () => detectInApp(navigator.userAgent)?.name ?? null;
const micMissing = () => !(window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof window.MediaRecorder === "function");

/** 카카오톡 등 인앱 브라우저에서 마이크를 쓸 수 없을 때: Safari·Chrome으로 다시 열게 안내한다. */
function OpenOutside({ app }: { app: string }) {
  const [copied, setCopied] = useState(false);
  function open() {
    const url = externalOpenUrl(navigator.userAgent, window.location.href);
    if (url) {
      window.location.href = url;
      return;
    }
    // 바깥 브라우저로 여는 주소를 받지 않는 앱: 주소를 복사해 붙여 넣게 한다.
    void navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  }
  return (
    <div role="alert" className="flex w-full flex-col gap-3 rounded-xl bg-warn-soft p-4 text-warn-ink">
      <p className="font-semibold">{app} 안의 브라우저에서는 마이크를 쓸 수 없어요. Safari나 Chrome으로 열어주세요.</p>
      <button type="button" className={outlineButton} onClick={open}>
        외부 브라우저로 열기
      </button>
      {copied && <p className="font-semibold">주소를 복사했습니다. Safari나 Chrome 주소창에 붙여 넣어 주세요.</p>}
      <p className="text-sm">아이폰은 화면 아래의 ⋯ 또는 공유 단추에서 &ldquo;Safari로 열기&rdquo;를 눌러도 됩니다. 새 브라우저에는 여기에 적어 둔 내용이 옮겨지지 않습니다. 녹음 파일을 올리거나 아래에 직접 적어도 됩니다.</p>
    </div>
  );
}

export function AccidentStep() {
  const { id } = useParams<{ id: string }>();
  const consent = useConsent();
  // 음성 변환과 사실 추출은 유료 기능이라 문지기를 통과할 때만 쓴다. 직접 적는 것은 누구나 할 수 있다.
  const stt = usePaid("stt");
  const guest = !stt.ready;
  const extractReady = usePaid("extract").ready;
  // 다친 내용을 말하게 되므로 건강정보 동의가 있어야 서버로 보낸다. 동의가 없으면 이용권보다 동의를 먼저 안내한다.
  const needsConsent = !!stt.view.status?.enabled && consent !== undefined && !consent.health;
  const allowed = !guest && !!consent?.health;
  const extractAllowed = extractReady && !!consent?.health;

  const [audio, setAudio] = useState<AudioState>({ phase: "idle", message: "", canRetry: false });
  const [pressed, setPressed] = useState(false);
  const [extract, setExtract] = useState<ExtractState>({ status: "idle" });
  // 나눠 보내는 중이면 몇 번째 조각인지
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const app = useSyncExternalStore(noSubscribe, inAppName, () => null);
  const noMic = useSyncExternalStore(noSubscribe, micMissing, () => false);
  const controller = useRef<AudioController | null>(null);
  // 녹음이 끝났을 때 이용권이 있는지(녹음은 이용권 없이도 시작한다).
  const allowedNow = useRef(false);
  useEffect(() => {
    allowedNow.current = allowed;
  }, [allowed]);
  // 녹음 경과 시간(초)과 한 번이라도 글로 바꿨는지
  const [elapsed, setElapsed] = useState(0);
  const [converted, setConverted] = useState(false);
  // 녹음이 끝났을 때 최신 입력 초안에 글을 붙이기 위해 들고 있는다.
  const appendText = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    const created = new AudioController({
      mediaDevices: navigator.mediaDevices,
      Recorder: window.MediaRecorder as unknown as RecorderClass | undefined,
      secure: window.isSecureContext,
      send: async (blob) => {
        if (!allowedNow.current) throw new Error(NEED_TICKET);
        return sendAudio(blob, (done, total) => setProgress({ done, total }));
      },
      onState: (state) => {
        setAudio(state);
        if (state.phase === "recording") {
          setConverted(false);
          setElapsed(0);
        }
      },
      onText: (text) => {
        setConverted(true);
        appendText.current(text);
      },
    });
    controller.current = created;
    const leave = () => created.dispose();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      created.dispose();
    };
  }, []);

  const recording = audio.phase === "recording";
  const busy = BUSY.includes(audio.phase);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [recording]);

  const serviceOn = !!stt.view.status?.enabled;

  return (
    <StepShell step={2} lead="사고가 어떻게 났는지 말로 설명하고, 바뀐 글을 확인합니다.">
      {(draft, update) => {
        const accident = draft.accident;
        const setAccident = (change: Partial<AccidentDraft>) =>
          update((d) => ({
            ...d,
            // 사용자가 고친 칸은 더 이상 추정도, 음성에서 인식한 값도 아니다.
            accident: {
              ...d.accident,
              ...change,
              inferred: d.accident.inferred.filter((key) => !(key in change)),
              heard: d.accident.heard.filter((key) => !(key in change)),
            },
          }));
        // 음성에서 인식한 칸은 "음성에서 인식됨", 사실 추출 뒤에도 비어 있는 칸은 "확인 필요"
        const mark = (key: keyof AccidentDraft): FieldMark | undefined =>
          accident.heard.includes(key) ? "heard" : accident.extracted && accident[key] === "" ? "check" : undefined;
        const yesNo = (value: YesNo | "") => (value === "" ? null : value);
        const guess = (key: keyof AccidentDraft) =>
          accident.inferred.includes(key)
            ? () => update((d) => ({ ...d, accident: { ...d.accident, inferred: d.accident.inferred.filter((k) => k !== key) } }))
            : undefined;
        appendText.current = (text) => {
          const next = accident.text.trim() ? `${accident.text.trim()}\n${text}` : text;
          update((d) => ({ ...d, accident: { ...d.accident, text: next } }));
          // 바뀐 글에서 사고 사실을 바로 뽑아 채운다. 이미 적어 둔 사람 카드가 있으면 덮어쓰지 않고 단추로 묻는다.
          if (extractAllowed && draft.people.length === 0 && next.trim().length >= MIN_TEXT) void pull(next);
        };

        function mic() {
          setPressed(true);
          // 인앱 브라우저에 녹음 기능이 없으면 이용권보다 바깥 브라우저 안내를 먼저 보인다.
          if (app && noMic) return;
          if (recording || (audio.phase === "error" && audio.canRetry)) return void controller.current?.stop();
          // 서버에 음성 변환이 설정되지 않았거나, 건강정보 동의가 없으면 녹음하지 않고 안내만 보인다.
          // 이용권은 녹음을 마친 뒤에 받아도 된다(녹음은 이 화면에 남는다).
          if (!serviceOn || needsConsent || consent === undefined) return;
          void controller.current?.start();
        }

        /** 글 속의 이름·전화번호·주민번호·차량번호를 가린다. 가린 원래 값은 저장하지 않는다. */
        function maskText() {
          const masked = redact(accident.text);
          if (masked.count > 0) update((d) => ({ ...d, accident: { ...d.accident, text: masked.text } }));
        }

        async function pull(source = accident.text) {
          const text = redact(source).text;
          setExtract({ status: "working" });
          try {
            const response = await paidFetch("extract", "/api/extract/accident", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text }),
            });
            const body = await response.json().catch(() => null);
            const result = accidentFactsSchema.safeParse(body?.facts);
            if (!response.ok || !result.success) {
              return setExtract({ status: "error", message: body?.error ?? "사실을 뽑지 못했습니다. 다음 화면에서 직접 입력해 주세요." });
            }
            update((d) => applyFacts(d, result.data, () => crypto.randomUUID()));
            const count = result.data.people.length;
            setExtract({
              status: "done",
              message:
                count > 0
                  ? `사람 ${count}명과 사고 정보를 미리 채웠습니다. "음성에서 인식됨" 칸은 맞는지, "확인 필요" 칸은 말에 없던 내용이니 아래와 다음 화면에서 직접 채워 주세요.`
                  : "다친 사람에 대한 내용은 찾지 못했습니다. \"확인 필요\" 칸을 채우고, 다음 화면에서 사람을 직접 추가해 주세요.",
            });
          } catch {
            setExtract({ status: "error", message: "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." });
          }
        }

        return (
          <>
            <div className="flex flex-col items-center gap-4 py-4">
              <button
                type="button"
                onClick={mic}
                disabled={busy}
                aria-pressed={recording}
                className={`flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-full text-white shadow-lg disabled:opacity-50 ${
                  recording ? "animate-pulse bg-red-700" : "bg-navy active:bg-navy-dark"
                }`}
              >
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  {recording ? (
                    <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
                  ) : (
                    <>
                      <rect x="9" y="3" width="6" height="11" rx="3" />
                      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
                    </>
                  )}
                </svg>
                <span className="text-base font-bold">
                  {recording
                    ? "눌러서 멈추기"
                    : audio.phase === "transcribing"
                      ? "글로 바꾸는 중…"
                      : audio.phase === "error" && audio.canRetry
                        ? "다시 시도"
                        : converted
                          ? "완료 · 더 말하기"
                          : "눌러서 말하기"}
                </span>
                {recording && <span className="text-sm font-semibold tabular-nums">녹음 중 {clock(elapsed)}</span>}
              </button>
              <p className="text-center text-xl font-bold">사고 내용 말로 설명하기</p>
              <p className="text-center text-muted">언제, 어디서, 어떻게 났는지와 누가 어디를 다쳤는지 말해 주세요. 5분까지 녹음됩니다.</p>
              <p className="text-center text-sm font-semibold text-navy">이름은 말하지 않아도 됩니다. &ldquo;나&rdquo;, &ldquo;아내&rdquo;, &ldquo;상대 운전자&rdquo;처럼 말해 주세요.</p>
              {app && <OpenOutside app={app} />}
              {(pressed || audio.canRetry) && guest && !needsConsent && (
                <>
                  <TicketGate route="stt" what="음성을 글로 바꾸기" />
                  <p className="text-muted">아래에 직접 적을 수 있습니다.</p>
                </>
              )}
              {allowed && <TicketBadge route="stt" />}
              {pressed && needsConsent && (
                <div className="flex w-full flex-col gap-3 rounded-xl bg-navy-soft p-4">
                  <p className="font-semibold text-navy">다친 내용을 말하게 되므로, 음성 입력을 쓰려면 건강정보 처리 동의가 필요합니다.</p>
                  <Link href={`/consent?next=/cases/${id}/accident`} className={outlineButton}>
                    동의하러 가기
                  </Link>
                </div>
              )}
              <p role="status" aria-live="polite" className={`text-center font-semibold ${audio.phase === "error" ? "rounded-xl bg-warn-soft px-4 py-3 text-warn-ink" : "text-navy"}`}>
                {audio.message}
                {allowed && audio.phase === "transcribing" && progress.total > 1 && ` (${progress.done + 1}/${progress.total})`}
              </p>
              <label
                className={`${outlineButton} cursor-pointer ${busy || recording ? "pointer-events-none opacity-40" : ""}`}
                onClick={(e) => {
                  // 이용권·동의가 없으면 파일을 고르기 전에 안내부터 보인다.
                  if (!allowed) {
                    e.preventDefault();
                    setPressed(true);
                  }
                }}
              >
                녹음 파일 올리기 (음성메모 등)
                <input
                  type="file"
                  accept="audio/*"
                  className="sr-only"
                  disabled={busy || recording}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void controller.current?.transcribeFile(file);
                  }}
                />
              </label>
            </div>

            <Card title="바뀐 글 확인·수정">
              <label className="flex flex-col gap-1.5">
                <span className="font-semibold">사고 내용</span>
                <textarea
                  className="min-h-48 w-full rounded-xl border border-line p-4 text-lg placeholder:text-muted/70 focus:border-navy"
                  value={accident.text}
                  readOnly={audio.phase === "transcribing"}
                  onBlur={maskText}
                  placeholder="언제, 어디서, 어떻게 사고가 났는지 적어 주세요."
                  onChange={(e) => update((d) => ({ ...d, accident: { ...d.accident, text: e.target.value } }))}
                />
              </label>
              {!extractAllowed && !!consent?.health && accident.text.trim().length >= MIN_TEXT && !(pressed && guest) && (
                <TicketGate route="extract" what="사고 사실 뽑아 채우기" />
              )}
              <p className="text-sm text-muted">이름·전화번호·주민번호·차량번호는 저장하지 않고 ******로 가립니다.</p>
              {extractAllowed && (
                <>
                  <button
                    type="button"
                    className={outlineButton}
                    disabled={extract.status === "working" || busy || recording || accident.text.trim().length < MIN_TEXT}
                    onClick={() => {
                      if (draft.people.length > 0 && !window.confirm("뽑은 내용으로 다음 화면의 사람 카드를 새로 채웁니다. 적어 둔 사람 카드는 지워집니다. 계속할까요?")) return;
                      void pull();
                    }}
                  >
                    {extract.status === "working" ? "사실을 뽑는 중…" : "이 글에서 사고 사실 뽑아 채우기"}
                  </button>
                  <p className="text-sm text-muted">글에서 날짜·장소·사람·다친 내용을 뽑아 입력 칸을 미리 채웁니다. 계산은 확인한 값으로만 합니다.</p>
                </>
              )}
              <p role="status" aria-live="polite">
                {(extract.status === "done" || extract.status === "error") && (
                  <span className={`block rounded-xl px-4 py-3 ${extract.status === "error" ? "bg-warn-soft font-semibold text-warn-ink" : "bg-navy-soft text-navy"}`}>
                    {extract.message}
                  </span>
                )}
              </p>
            </Card>

            <Card title="사고 정보">
              <TextField anchor="f-accident-date" label="사고 날짜" type="date" value={accident.date} onChange={(date) => setAccident({ date })} onConfirmGuess={guess("date")} mark={mark("date")} />
              <TextField label="사고 시각" type="time" value={accident.time} onChange={(time) => setAccident({ time })} onConfirmGuess={guess("time")} mark={mark("time")} />
              <TextField label="사고 장소" value={accident.place} placeholder="예: ○○사거리" onChange={(place) => setAccident({ place })} onConfirmGuess={guess("place")} mark={mark("place")} />
              <Choice label="사고 유형" value={accident.kind || null} options={KINDS} onChange={(kind) => setAccident({ kind })} onConfirmGuess={guess("kind")} mark={mark("kind")} />
              <TextField
                label="내 차량 운전자"
                value={accident.myDriver}
                placeholder="예: 본인, 아내"
                hint="이름은 적지 마세요."
                onChange={(myDriver) => setAccident({ myDriver: redact(myDriver).text })}
                onConfirmGuess={guess("myDriver")}
                mark={mark("myDriver")}
              />
              <Choice label="상대방" value={yesNo(accident.counterpartyExists)} options={EXISTS} onChange={(counterpartyExists) => setAccident({ counterpartyExists })} onConfirmGuess={guess("counterpartyExists")} mark={mark("counterpartyExists")} />
              <TextField
                label="과실 관련 진술"
                value={accident.faultStatement}
                placeholder="예: 신호 대기 중 뒤차가 추돌"
                hint="말한 그대로입니다. 과실비율은 다음 화면에서 사람마다 적습니다."
                onChange={(faultStatement) => setAccident({ faultStatement: redact(faultStatement).text })}
                onConfirmGuess={guess("faultStatement")}
                mark={mark("faultStatement")}
              />
              <Choice label="경찰 신고" value={yesNo(accident.policeReport)} options={HAD} onChange={(policeReport) => setAccident({ policeReport })} onConfirmGuess={guess("policeReport")} mark={mark("policeReport")} />
              <Choice label="보험 접수" value={yesNo(accident.insuranceReport)} options={HAD} onChange={(insuranceReport) => setAccident({ insuranceReport })} onConfirmGuess={guess("insuranceReport")} mark={mark("insuranceReport")} />
            </Card>

            {accident.kind !== "single" && (
              <Card title="상대 차량의 보험">
                <p className="text-muted">상대방에게서 받을 금액은 상대 차량의 보험으로 정해집니다. 모르면 비워 두세요. 내 증권의 한도를 대신 쓰지 않습니다.</p>
                <Choice
                  anchor="f-accident-counterpartyInsurance"
                  label="상대 차량은"
                  value={accident.counterpartyInsurance || null}
                  options={INSURANCES}
                  onChange={(counterpartyInsurance) => setAccident({ counterpartyInsurance })}
                />
                <TextField
                  anchor="f-accident-counterpartyBodily2Limit"
                  label="상대방 대인배상Ⅱ 가입금액"
                  value={accident.counterpartyBodily2Limit}
                  placeholder="예: 무한, 1억원"
                  hint="상대 보험사에서 들은 그대로 적어 주세요."
                  onChange={(counterpartyBodily2Limit) => setAccident({ counterpartyBodily2Limit })}
                />
                <TextField
                  anchor="f-accident-counterpartyPropertyLimit"
                  label="상대방 대물배상 가입금액"
                  value={accident.counterpartyPropertyLimit}
                  placeholder="예: 2억원"
                  onChange={(counterpartyPropertyLimit) => setAccident({ counterpartyPropertyLimit })}
                />
              </Card>
            )}
          </>
        );
      }}
    </StepShell>
  );
}
