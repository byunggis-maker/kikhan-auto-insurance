"use client";

import { useEffect, useRef, useState } from "react";
import { postForm } from "@/lib/ui/upload";

// MASTER.md 9장 음성 입력. 녹음은 이 기기의 메모리에만 있다가 서버로 한 번 보내 글로 바꾸고 버린다(저장하지 않는다).
// 바뀐 글은 바로 경위에 들어가지 않는다. 부르는 쪽이 "확인해 주세요" 상태로 보여 준다.

const MAX_SECONDS = 180;
/** 브라우저마다 녹음 형식이 다르다(크롬 webm, 사파리 mp4) */
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];

export function VoiceInput({ onText }: { onText: (text: string) => void }) {
  const [state, setState] = useState<{ status: "idle" | "recording" | "working" | "error"; message?: string }>({ status: "idle" });
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const send = async (audio: Blob) => {
    setState({ status: "working" });
    const form = new FormData();
    form.set("audio", audio, "speech");
    const result = await postForm<{ text: string }>("/api/speech", form);
    if (!result.ok) return setState({ status: "error", message: result.message });
    setState({ status: "idle" });
    onText(result.text);
  };

  const start = async () => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return setState({ status: "error", message: "이 브라우저는 녹음을 지원하지 않습니다. 직접 적어 주세요." });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setState({ status: "error", message: "마이크를 쓸 수 없습니다. 브라우저 설정에서 마이크를 허용하거나 직접 적어 주세요." });
    }
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      void send(new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }));
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setState({ status: "recording" });
    const startedAt = Date.now();
    timer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
      // 3분이 되면 저절로 끝낸다(서버가 받는 크기 한도 안쪽)
      if (elapsed >= MAX_SECONDS && rec.state === "recording") rec.stop();
    }, 1000);
  };

  return (
    <div>
      {state.status === "recording" ? (
        <button type="button" className="min-h-12 w-full rounded-xl bg-ink font-bold text-white" onClick={() => recorder.current?.stop()}>
          ■ 녹음 끝내기 ({Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")})
        </button>
      ) : (
        <button type="button" disabled={state.status === "working"} className="min-h-12 w-full rounded-xl border-2 border-estimate-ink bg-estimate font-bold text-estimate-ink disabled:opacity-60" onClick={() => void start()}>
          {state.status === "working" ? "글로 바꾸는 중…" : "● 말로 설명하기"}
        </button>
      )}
      <p className="mt-1 text-xs font-semibold text-ink-soft">3분까지. 녹음은 글로 바꾼 뒤 버리고 저장하지 않습니다.</p>
      {state.message && (
        <p className="mt-1 text-sm font-bold" role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}
