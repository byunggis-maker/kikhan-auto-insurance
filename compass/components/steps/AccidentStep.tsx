"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StepShell } from "@/components/StepShell";
import { TicketBadge, TicketGate } from "@/components/TicketGate";
import { Card, Choice, TextField, outlineButton } from "@/components/ui";
import { paidFetch } from "@/lib/guard/paid-client";
import { usePaid } from "@/lib/guard/use-paid";
import { useConsent } from "@/lib/privacy/consent";
import { applyFacts } from "@/lib/draft/apply-facts";
import { ACCIDENT_KIND_LABELS, COUNTERPARTY_INSURANCE_LABELS, type AccidentDraft, type AccidentKind, type CounterpartyInsurance } from "@/lib/draft/types";
import { accidentFactsSchema } from "@/lib/schemas/accident-facts";
import { AudioController, type AudioState, type RecorderClass } from "@/lib/speech/audio-controller";

const KINDS = (Object.keys(ACCIDENT_KIND_LABELS) as AccidentKind[]).map((value) => ({ value, label: ACCIDENT_KIND_LABELS[value] }));
const INSURANCES = (Object.keys(COUNTERPARTY_INSURANCE_LABELS) as CounterpartyInsurance[]).map((value) => ({ value, label: COUNTERPARTY_INSURANCE_LABELS[value] }));
const BUSY = ["starting", "stopping", "transcribing"];
const MIN_TEXT = 10;

type ExtractState = { status: "idle" | "working" } | { status: "done" | "error"; message: string };

async function sendAudio(blob: Blob): Promise<{ text: string }> {
  const form = new FormData();
  form.set("audio", blob, "speech");
  let response: Response;
  try {
    response = await paidFetch("stt", "/api/stt", { method: "POST", body: form });
  } catch {
    throw new Error("서버에 연결하지 못했습니다. 다시 눌러 같은 녹음으로 다시 시도할 수 있습니다.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.text !== "string") throw new Error(body?.error ?? "음성을 글로 바꾸지 못했습니다.");
  return { text: body.text };
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
  const controller = useRef<AudioController | null>(null);
  // 녹음이 끝났을 때 최신 입력 초안에 글을 붙이기 위해 들고 있는다.
  const appendText = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    const created = new AudioController({
      mediaDevices: navigator.mediaDevices,
      Recorder: window.MediaRecorder as unknown as RecorderClass | undefined,
      secure: window.isSecureContext,
      send: sendAudio,
      onState: setAudio,
      onText: (text) => appendText.current(text),
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

  return (
    <StepShell step={2} lead="사고가 어떻게 났는지 말로 설명하고, 바뀐 글을 확인합니다.">
      {(draft, update) => {
        const accident = draft.accident;
        const setAccident = (change: Partial<AccidentDraft>) =>
          update((d) => ({
            ...d,
            // 사용자가 고친 칸은 더 이상 추정이 아니다.
            accident: { ...d.accident, ...change, inferred: d.accident.inferred.filter((key) => !(key in change)) },
          }));
        const guess = (key: keyof AccidentDraft) =>
          accident.inferred.includes(key)
            ? () => update((d) => ({ ...d, accident: { ...d.accident, inferred: d.accident.inferred.filter((k) => k !== key) } }))
            : undefined;
        appendText.current = (text) =>
          update((d) => ({ ...d, accident: { ...d.accident, text: d.accident.text.trim() ? `${d.accident.text.trim()}\n${text}` : text } }));

        function mic() {
          setPressed(true);
          if (!allowed) return;
          if (recording || (audio.phase === "error" && audio.canRetry)) void controller.current?.stop();
          else void controller.current?.start();
        }

        async function pull() {
          if (draft.people.length > 0 && !window.confirm("뽑은 내용으로 다음 화면의 사람 카드를 새로 채웁니다. 적어 둔 사람 카드는 지워집니다. 계속할까요?")) return;
          setExtract({ status: "working" });
          try {
            const response = await paidFetch("extract", "/api/extract/accident", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: accident.text }),
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
                  ? `사람 ${count}명과 사고 정보를 미리 채웠습니다. 아래와 다음 화면에서 맞는지 확인해 주세요. 짐작한 값은 회색 "추정"으로 표시했습니다.`
                  : "사람에 대한 내용은 찾지 못했습니다. 다음 화면에서 직접 추가해 주세요.",
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
                  {recording ? "눌러서 멈추기" : audio.phase === "transcribing" ? "글로 바꾸는 중…" : audio.phase === "error" && audio.canRetry ? "다시 시도" : "눌러서 말하기"}
                </span>
              </button>
              <p className="text-center text-xl font-bold">사고 내용 말로 설명하기</p>
              <p className="text-center text-muted">언제, 어디서, 어떻게 났는지와 누가 어디를 다쳤는지 말해 주세요. 5분까지 녹음됩니다.</p>
              {pressed && guest && !needsConsent && (
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
                {allowed ? audio.message : ""}
              </p>
            </div>

            <Card title="바뀐 글 확인·수정">
              <label className="flex flex-col gap-1.5">
                <span className="font-semibold">사고 내용</span>
                <textarea
                  className="min-h-48 w-full rounded-xl border border-line p-4 text-lg placeholder:text-muted/70 focus:border-navy"
                  value={accident.text}
                  readOnly={audio.phase === "transcribing"}
                  placeholder="언제, 어디서, 어떻게 사고가 났는지 적어 주세요."
                  onChange={(e) => update((d) => ({ ...d, accident: { ...d.accident, text: e.target.value } }))}
                />
              </label>
              {!extractAllowed && !!consent?.health && accident.text.trim().length >= MIN_TEXT && !(pressed && guest) && (
                <TicketGate route="extract" what="사고 사실 뽑아 채우기" />
              )}
              {extractAllowed && (
                <>
                  <button
                    type="button"
                    className={outlineButton}
                    disabled={extract.status === "working" || busy || recording || accident.text.trim().length < MIN_TEXT}
                    onClick={() => void pull()}
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
              <TextField anchor="f-accident-date" label="사고 날짜" type="date" value={accident.date} onChange={(date) => setAccident({ date })} onConfirmGuess={guess("date")} />
              <TextField label="사고 시각" type="time" value={accident.time} onChange={(time) => setAccident({ time })} onConfirmGuess={guess("time")} />
              <TextField label="사고 장소" value={accident.place} placeholder="예: ○○사거리" onChange={(place) => setAccident({ place })} onConfirmGuess={guess("place")} />
              <Choice label="사고 유형" value={accident.kind || null} options={KINDS} onChange={(kind) => setAccident({ kind })} onConfirmGuess={guess("kind")} />
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
