"use client";

import { useRef, useState } from "react";
import type { ClaimReading, PolicyReading, Usage } from "@/lib/ai/documents";
import { postForm, prepareUpload } from "@/lib/ui/upload";

// MASTER.md 9장 서류 인식 버튼. 파일은 서버로 한 번 보내 읽기만 하고, 이 기기에도 서버에도 저장하지 않는다.
// 읽은 값은 바로 입력칸에 들어가지 않고 "인식된 값 – 확인해 주세요"로 남는다(onRead가 확인 대기 값으로 바꾼다).

type Reading = { kind: "policy"; reading: PolicyReading; usage: Usage } | { kind: "claim"; reading: ClaimReading; usage: Usage };

type Props = {
  kind: "policy" | "claim";
  target?: "person" | "property";
  label: string;
  /** 읽은 결과를 받아 확인 대기 값을 만들고, 화면에 보일 한 줄 안내를 돌려준다 */
  onRead: (result: Reading) => string;
};

export function DocumentUpload({ kind, target, label, onRead }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ status: "idle" | "working" | "done" | "error"; message?: string }>({ status: "idle" });

  const read = async (file: File) => {
    setState({ status: "working" });
    const form = new FormData();
    form.set("file", await prepareUpload(file));
    form.set("kind", kind);
    if (target) form.set("target", target);
    const result = await postForm<Reading>("/api/documents/read", form);
    if (!result.ok) return setState({ status: "error", message: result.message });
    setState({ status: "done", message: onRead(result) });
  };

  return (
    <div className="rounded-2xl border-2 border-dashed border-estimate-line bg-white p-4">
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void read(file);
        }}
      />
      <button type="button" disabled={state.status === "working"} className="min-h-12 w-full rounded-xl border-2 border-estimate-ink bg-estimate font-bold text-estimate-ink disabled:opacity-60" onClick={() => input.current?.click()}>
        {state.status === "working" ? "읽는 중… (10~30초)" : label}
      </button>
      <p className="mt-2 text-xs font-semibold text-ink-soft">PDF·사진(JPG·PNG·아이폰 HEIC). 파일은 읽기만 하고 저장하지 않습니다. 주민번호·증권번호·차량번호·전화번호는 가립니다.</p>
      {state.message && <p className={`mt-2 text-sm font-bold ${state.status === "error" ? "text-ink" : "text-estimate-ink"}`} role="status">{state.message}</p>}
    </div>
  );
}
