"use client";

import { useRef, useState } from "react";
import type { ClaimReading, PolicyReading, Usage } from "@/lib/ai/documents";
import { checkPicked, fetchRemaining, pdfPlan, pdfUseNotice, postForm, prepareUploads, UPLOAD_LIMIT, type UploadPart } from "@/lib/ui/upload";

// MASTER.md 9장 서류 인식 버튼. 파일은 서버로 한 번 보내 읽기만 하고, 이 기기에도 서버에도 저장하지 않는다.
// 읽은 값은 바로 입력칸에 들어가지 않고 "인식된 값 – 확인해 주세요"로 남는다(onRead가 확인 대기 값으로 바꾼다).
// 라운드 8: 한 번에 5건, 한 건 10MB까지 고를 수 있다. 서버로는 한 건씩 차례로 보낸다.
// 라운드 8b: 4MB가 넘는 PDF는 앞 5쪽을 쪽마다 사진으로 바꿔 한 쪽씩 보낸다.
// 라운드 8c: 큰 PDF는 보내기 전에 "이 PDF는 ○회를 씁니다(오늘 남은 횟수 ○회)"를 보여 주고 "읽기"를 눌러야 보낸다.

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
  const [state, setState] = useState<{ status: "idle" | "working" | "done" | "error" | "confirm"; message?: string }>({ status: "idle" });
  // 큰 PDF 안내에서 "읽기"·"취소"를 누를 때까지 기다린다
  const answer = useRef<((go: boolean) => void) | null>(null);
  const ask = (message: string) =>
    new Promise<boolean>((resolve) => {
      answer.current = resolve;
      setState({ status: "confirm", message });
    });
  const reply = (go: boolean) => {
    answer.current?.(go);
    answer.current = null;
  };

  const sendPart = async ({ blob }: UploadPart): Promise<{ ok: boolean; message: string; stop?: boolean }> => {
    if (blob.size > UPLOAD_LIMIT) return { ok: false, message: "이 파일은 4MB가 넘어 보낼 수 없습니다. 필요한 쪽을 사진으로 찍거나 화면을 캡처해 올려 주세요." };
    const form = new FormData();
    form.set("file", blob);
    form.set("kind", kind);
    if (target) form.set("target", target);
    const result = await postForm<Reading>("/api/documents/read", form);
    if (!result.ok) return { ok: false, message: result.message, stop: result.reason !== "invalid" };
    return { ok: true, message: onRead(result) };
  };

  const read = async (files: File[]) => {
    const problem = checkPicked(files);
    if (problem) return setState({ status: "error", message: problem });
    const messages: string[] = [];
    let failed = false;
    files: for (const [i, file] of files.entries()) {
      const name = files.length > 1 ? `${i + 1}번째` : "";
      setState({ status: "working", message: files.length > 1 ? `${i + 1}/${files.length}번째 서류를 읽는 중입니다.` : undefined });
      let parts: UploadPart[];
      try {
        const plan = await pdfPlan(file);
        if (plan && !(await ask(`${name ? `${name}: ` : ""}${pdfUseNotice(plan, await fetchRemaining())}`))) {
          messages.push(`${name ? `${name}: ` : ""}PDF를 읽지 않았습니다.`);
          continue;
        }
        setState({ status: "working", message: files.length > 1 ? `${i + 1}/${files.length}번째 서류를 읽는 중입니다.` : undefined });
        parts = await prepareUploads(file);
      } catch {
        failed = true;
        messages.push(`${name ? `${name}: ` : ""}PDF를 열지 못했습니다. 필요한 쪽을 사진으로 찍어 올려 주세요.`);
        continue;
      }
      const pages = parts[0]?.pages;
      if (pages && pages > parts.length) messages.push(`${name ? `${name}: ` : ""}큰 PDF라 앞 ${parts.length}쪽만 사진으로 바꿔 읽습니다(전체 ${pages}쪽).`);
      for (const part of parts) {
        const label = [name, part.page ? `${part.page}쪽` : ""].filter(Boolean).join(" ");
        if (part.page) setState({ status: "working", message: `${label}을 읽는 중입니다.` });
        const one = await sendPart(part);
        failed ||= !one.ok;
        messages.push(label ? `${label}: ${one.message}` : one.message);
        // 준비 중·횟수 초과면 남은 서류도 같으므로 멈춘다
        if (one.stop) break files;
      }
    }
    setState({ status: failed ? "error" : "done", message: messages.join(" ") });
  };

  return (
    <div className="rounded-2xl border-2 border-dashed border-estimate-line bg-white p-4">
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void read(files);
        }}
      />
      <button type="button" disabled={state.status === "working" || state.status === "confirm"} className="min-h-12 w-full rounded-xl border-2 border-estimate-ink bg-estimate font-bold text-estimate-ink disabled:opacity-60" onClick={() => input.current?.click()}>
        {state.status === "working" ? "읽는 중… (10~30초)" : label}
      </button>
      <p className="mt-2 text-xs font-semibold text-ink-soft">PDF·사진(JPG·PNG·아이폰 HEIC), 한 번에 5건·한 건 10MB까지. 파일은 읽기만 하고 저장하지 않습니다. 주민번호·증권번호·차량번호·전화번호는 가립니다.</p>
      {state.message && <p className={`mt-2 text-sm font-bold ${state.status === "error" ? "text-ink" : "text-estimate-ink"}`} role="status">{state.message}</p>}
      {state.status === "confirm" && (
        <div className="mt-2 grid grid-cols-2 gap-2" data-pdf-confirm>
          <button type="button" className="min-h-11 rounded-lg bg-estimate-ink font-bold text-white" onClick={() => reply(true)}>
            읽기
          </button>
          <button type="button" className="min-h-11 rounded-lg border-2 border-estimate-line bg-white font-bold" onClick={() => reply(false)}>
            취소
          </button>
        </div>
      )}
    </div>
  );
}
