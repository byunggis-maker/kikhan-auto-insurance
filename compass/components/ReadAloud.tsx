"use client";

import { useEffect, useRef, useState } from "react";
import { outlineButton } from "@/components/ui";
import { paidFetch } from "@/lib/guard/paid-client";
import { SpeechPlayer, type AudioLike, type PlayerState } from "@/lib/speech/player";

// 읽어주기: 글을 서버에서 음성으로 바꿔 차례로 재생한다. 재생·멈춤·속도를 고를 수 있다.
// 음성은 이 화면의 메모리에만 두고 화면을 떠나면 버린다.

const SPEEDS = [0.8, 1, 1.25, 1.5];
/** 글 덩어리를 하나의 문자열로 이어 붙일 때 쓰는 구분 문자(글에 나오지 않는 문자) */
const SEPARATOR = "\u0000";

async function fetchAudio(text: string): Promise<string> {
  let response: Response;
  try {
    response = await paidFetch("tts", "/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  } catch {
    throw new Error("서버에 연결하지 못했습니다. 다시 눌러 주세요.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.error === "string" ? body.error : "읽어주기에 실패했습니다.");
  }
  return URL.createObjectURL(await response.blob());
}

/** chunks: 한 번에 보낼 수 있는 길이로 나눈 글 */
export function ReadAloud({ label, chunks }: { label: string; chunks: string[] }) {
  const [state, setState] = useState<PlayerState>({ phase: "idle" });
  const [speed, setSpeed] = useState(1);
  const player = useRef<SpeechPlayer | null>(null);
  // 글이 바뀌면 만들어 둔 음성은 쓸 수 없으므로 새로 만든다.
  const key = chunks.join(SEPARATOR);

  useEffect(() => {
    const created = new SpeechPlayer({ chunks: key ? key.split(SEPARATOR) : [], fetchAudio, createAudio: () => new Audio() as unknown as AudioLike, release: (url) => URL.revokeObjectURL(url), onState: setState });
    player.current = created;
    return () => {
      created.dispose();
      player.current = null;
    };
  }, [key]);

  const text = state.phase === "playing" ? "멈춤" : state.phase === "paused" ? "이어서 듣기" : state.phase === "loading" ? "준비 중…" : label;
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className={outlineButton} disabled={chunks.length === 0 || state.phase === "loading"} aria-pressed={state.phase === "playing"} onClick={() => player.current?.toggle()}>
        {state.phase === "playing" ? "❚❚ " : "▶ "}
        {text}
      </button>
      <div role="group" aria-label="읽는 속도" className="flex items-center gap-2">
        <span className="shrink-0 text-sm text-muted">속도</span>
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={speed === value}
            onClick={() => {
              setSpeed(value);
              player.current?.setSpeed(value);
            }}
            className={`min-h-11 flex-1 rounded-xl border text-base font-semibold ${speed === value ? "border-navy bg-navy text-white" : "border-line bg-white text-ink"}`}
          >
            {value === 1 ? "보통" : `${value}배`}
          </button>
        ))}
      </div>
      {state.phase === "error" && <p className="rounded-xl bg-warn-soft px-4 py-3 font-semibold text-warn-ink">{state.message}</p>}
    </div>
  );
}
