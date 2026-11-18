"use client";

import { useEffect, useRef, useState } from "react";
import { SERVER_SPEECH_ENABLED } from "@/lib/ai/features";
import type { VerifiedAnswer } from "@/lib/ai/ask";
import type { ProductLine } from "@/lib/claim/types";
import { VoiceInput } from "./VoiceInput";

// 라운드 9: 결과 화면 아래 '이 사고로 약관 묻기'. 지금 입력된 사고 사실(facts)을 함께 보내고,
// 결론 → 쟁점 → 해석 → 근거 규정 → 확인할 서류·다음 행동 순서로 보여 준다. 맨 아래 한 줄은 늘 같은 고지다.
// 음성: 서버 음성이 꺼져 있으면(기본, D-40) 브라우저의 음성 인식(휴대폰·브라우저가 처리)을 쓰고, 없으면 키보드 받아쓰기를 안내한다.

type Recognizer = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

function useBrowserSpeech(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognizer = useRef<Recognizer | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 기능은 화면에 붙은 뒤에만 알 수 있다
    setSupported(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    return () => recognizer.current?.stop();
  }, []);
  const toggle = () => {
    if (listening) return recognizer.current?.stop();
    const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "ko-KR";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => onText(Array.from(e.results).map((x) => x[0].transcript).join(" "));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognizer.current = r;
    setListening(true);
    r.start();
  };
  return { supported, listening, toggle };
}

type State = { status: "idle" | "working" | "done" | "error"; answer?: VerifiedAnswer; message?: string };

export function AskTerms({ facts, productLine }: { facts: string; productLine: ProductLine | null }) {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const append = (text: string) => setQuestion((q) => (q ? `${q} ${text}` : text).slice(0, 500));
  const speech = useBrowserSpeech(append);

  const ask = async () => {
    if (!question.trim()) return;
    setState({ status: "working" });
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, facts, productLine }) });
      const data = (await response.json().catch(() => null)) as { ok: true; answer: VerifiedAnswer } | { ok: false; message: string } | null;
      if (data?.ok) setState({ status: "done", answer: data.answer });
      else setState({ status: "error", message: data?.message ?? "이 기능은 준비 중입니다." });
    } catch {
      setState({ status: "error", message: "이 기능은 준비 중입니다." });
    }
  };

  const a = state.answer;
  return (
    <section className="rounded-2xl border-2 border-ink bg-white p-4" data-ask>
      <h3 className="text-lg font-bold">이 사고로 약관 묻기</h3>
      <p className="text-sm font-semibold text-ink-soft">지금 넣은 사고 사실(사고일·과실·상해 급별·운전자 범위·상대 보험·가입담보)을 함께 보내 답합니다.</p>
      <div className="mt-3 flex items-stretch gap-2">
        <textarea
          aria-label="약관 질문"
          className="min-h-20 flex-1 rounded-xl border-2 border-line p-3 font-semibold outline-none focus:border-ink"
          placeholder="예) 상대 차가 무보험인데 무보험자동차에 의한 상해로 얼마 받나요?"
          maxLength={500}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        {!SERVER_SPEECH_ENABLED && speech.supported && (
          <button type="button" aria-label={speech.listening ? "음성 입력 멈추기" : "음성으로 묻기"} className={`w-14 shrink-0 rounded-xl border-2 text-2xl ${speech.listening ? "border-ink bg-ink text-white" : "border-line bg-white"}`} onClick={speech.toggle}>
            🎤
          </button>
        )}
      </div>
      {SERVER_SPEECH_ENABLED && (
        <div className="mt-2">
          <VoiceInput onText={append} />
        </div>
      )}
      {!SERVER_SPEECH_ENABLED && !speech.supported && <p className="mt-1 text-xs font-semibold text-ink-soft">말로 물으려면 키보드의 마이크 버튼을 누르세요.</p>}
      <button type="button" disabled={state.status === "working" || !question.trim()} className="mt-2 min-h-12 w-full rounded-xl bg-ink font-bold text-white disabled:opacity-50" onClick={ask}>
        {state.status === "working" ? "약관을 찾아 답하는 중… (20~40초)" : "묻기"}
      </button>
      {state.status === "error" && (
        <p className="mt-2 text-sm font-bold" role="status">
          {state.message}
        </p>
      )}
      {a && (
        <div className="mt-4 space-y-3 text-sm font-semibold" data-answer>
          <div>
            <h4 className="font-bold">1) 결론</h4>
            <p className="mt-1">{a.conclusion}</p>
          </div>
          <div>
            <h4 className="font-bold">2) 쟁점</h4>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {a.issues.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-bold">3) 해석</h4>
            <p className="mt-1 whitespace-pre-line">{a.interpretation}</p>
          </div>
          <div>
            <h4 className="font-bold">4) 근거 규정</h4>
            <ul className="mt-1 space-y-1" data-basis>
              {a.basis.map((b, i) => (
                <li key={i} data-verified={b.verified}>
                  · [{b.kind}] {b.citation}
                  {b.page !== null ? ` (${a.sources.product} 약관 인쇄 ${b.page}쪽)` : ""}
                  {b.quote && <span className="block pl-3 text-xs text-ink-soft">“{b.quote}”</span>}
                  {b.url && (
                    <a className="block pl-3 text-xs underline" href={b.url} target="_blank" rel="noreferrer">
                      국가법령정보센터
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-bold">5) 확인할 서류·다음 행동</h4>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {a.nextSteps.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          </div>
          <p className="border-t-2 border-line pt-2 font-bold" data-ask-notice>
            {a.notice}
          </p>
        </div>
      )}
    </section>
  );
}
