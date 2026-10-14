"use client";

import { useEffect, useRef, useState } from "react";
import { detectSensitiveBoxes } from "@/components/ocr";
import { outlineButton, primaryButton } from "@/components/ui";
import { heicToJpeg } from "@/lib/upload/heic";

// 증권 사진을 올리기 전에 이름·주민번호·증권번호·차량번호를 손가락으로 칠해 가리는 화면(docs/PLAN.md 5절 "증권 읽기의 처리 순서" 2).
// 사진을 열면 먼저 이 기기 안에서 글자를 읽어 개인정보로 보이는 자리를 미리 칠해 둔다(components/ocr.ts). 사용자는 확인하고 더 칠하거나 되돌린다.
// 칠한 부분은 그림 자체에서 검게 바뀐 뒤에 올라간다. 원본 사진은 이 화면의 메모리에만 있고 어디에도 저장하지 않는다.

const MAX_EDGE = 2000;
const HISTORY = 10;

type Props = {
  file: File;
  /** 칠한 그림(JPEG). painted: 한 군데라도 칠했는지 */
  onDone: (masked: File, painted: boolean) => void;
  onCancel: () => void;
};

type Phase = "loading" | "scanning" | "ready" | "confirm-empty" | "unpaintable" | "saving";
/** 자동 찾기 결과: 미리 칠한 곳 수, 또는 찾지 못함 */
type Auto = { found: number } | "failed" | "skipped" | null;

export function MaskEditor({ file, onDone, onCancel }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [painted, setPainted] = useState(false);
  const [auto, setAuto] = useState<Auto>(null);
  const scan = useRef<AbortController | null>(null);
  const history = useRef<ImageData[]>([]);
  const original = useRef<ImageData | null>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        } catch (error) {
          // HEIC를 직접 그리지 못하는 브라우저(크롬·안드로이드)는 이 기기에서 JPEG로 바꾼 뒤 연다.
          const jpeg = await heicToJpeg(file);
          if (!jpeg) throw error;
          bitmap = await createImageBitmap(jpeg, { imageOrientation: "from-image" });
        }
        if (cancelled) return;
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const element = canvas.current!;
        element.width = Math.round(bitmap.width * scale);
        element.height = Math.round(bitmap.height * scale);
        const context = element.getContext("2d")!;
        context.drawImage(bitmap, 0, 0, element.width, element.height);
        bitmap.close();
        original.current = context.getImageData(0, 0, element.width, element.height);
      } catch {
        // HEIC처럼 이 브라우저가 그리지 못하는 사진
        if (!cancelled) setPhase("unpaintable");
        return;
      }
      setPhase("scanning");
      const controller = new AbortController();
      scan.current = controller;
      try {
        const boxes = await detectSensitiveBoxes(canvas.current!, controller.signal);
        if (cancelled || controller.signal.aborted) return;
        if (boxes.length > 0) {
          const ctx = canvas.current!.getContext("2d")!;
          history.current = [ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)];
          ctx.fillStyle = "#000";
          for (const box of boxes) ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
          setPainted(true);
        }
        setAuto({ found: boxes.length });
      } catch {
        if (!cancelled && !controller.signal.aborted) setAuto("failed");
      }
      if (!cancelled) setPhase((current) => (current === "scanning" ? "ready" : current));
    })();
    return () => {
      cancelled = true;
      scan.current?.abort();
    };
  }, [file]);

  const context = () => canvas.current?.getContext("2d") ?? null;
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width, y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height };
  };
  const brush = () => Math.max(18, Math.round((canvas.current?.width ?? 1000) * 0.035));

  function stroke(from: { x: number; y: number }, to: { x: number; y: number }) {
    const ctx = context();
    if (!ctx) return;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = brush();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y + 0.01);
    ctx.stroke();
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = context();
    if (!ctx || phase !== "ready") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    history.current = [...history.current.slice(-(HISTORY - 1)), ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)];
    const at = point(event);
    drawing.current = at;
    stroke(at, at);
    setPainted(true);
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const at = point(event);
    stroke(drawing.current, at);
    drawing.current = at;
  }
  const end = () => {
    drawing.current = null;
  };

  function skipScan() {
    scan.current?.abort();
    setAuto("skipped");
    setPhase("ready");
  }

  function undo() {
    const ctx = context();
    const last = history.current.pop();
    if (!ctx || !last) return;
    ctx.putImageData(last, 0, 0);
    if (history.current.length === 0) setPainted(false);
  }
  function reset() {
    const ctx = context();
    if (!ctx || !original.current) return;
    ctx.putImageData(original.current, 0, 0);
    history.current = [];
    setPainted(false);
  }

  function upload(force = false) {
    if (!painted && !force) return setPhase("confirm-empty");
    setPhase("saving");
    canvas.current!.toBlob(
      (blob) => {
        if (!blob) return setPhase("ready");
        onDone(new File([blob], "policy.jpg", { type: "image/jpeg" }), painted);
      },
      "image/jpeg",
      0.9,
    );
  }

  return (
    <div className="flex flex-col gap-3" role="group" aria-label="개인정보 칠해 가리기">
      <p className="rounded-2xl bg-navy px-4 py-3 text-lg font-bold leading-snug text-white">이름·주민번호·증권번호·차량번호를 손가락으로 칠해 주세요</p>
      <p className="text-sm text-muted">칠한 곳은 검게 바뀐 그림으로만 올라갑니다. 보험회사·담보·금액은 가리지 마세요.</p>
      <div role="status" aria-live="polite">
        {phase === "scanning" && (
          <div className="flex flex-col gap-2 rounded-xl bg-navy-soft p-4">
            <p className="font-semibold text-navy">개인정보 자리를 찾는 중… 사진은 이 기기 밖으로 나가지 않습니다.</p>
            <button type="button" className={`${outlineButton} text-base`} onClick={skipScan}>
              건너뛰고 직접 칠하기
            </button>
          </div>
        )}
        {phase !== "scanning" && auto !== null && auto !== "skipped" && (
          <p className={`rounded-xl p-4 font-semibold ${auto !== "failed" && auto.found > 0 ? "bg-navy-soft text-navy" : "bg-warn-soft text-warn-ink"}`}>
            {auto === "failed"
              ? "자동으로 찾지 못했습니다. 직접 칠해 주세요."
              : auto.found > 0
                ? `개인정보로 보이는 ${auto.found}곳을 미리 가렸습니다. 빠진 곳이 있으면 더 칠하고, 잘못 가렸으면 "한 번 되돌리기"를 누르세요.`
                : "자동으로 찾은 곳이 없습니다. 보이는 개인정보가 있으면 직접 칠해 주세요."}
          </p>
        )}
      </div>

      {phase === "unpaintable" ? (
        <div className="flex flex-col gap-3 rounded-xl bg-warn-soft p-4 text-warn-ink">
          <p className="font-semibold">이 사진은 이 브라우저에서 칠할 수 없습니다(아이폰 HEIC 사진 등).</p>
          <p>화면을 캡처해 JPG로 올리면 칠해 가릴 수 있습니다. 그대로 올리면 서버가 신원정보를 읽지 않도록 지시하고, 결과에서 한 번 더 지웁니다.</p>
          <button type="button" className={primaryButton} onClick={() => onDone(file, false)}>
            그대로 올리기
          </button>
          <button type="button" className={outlineButton} onClick={onCancel}>
            취소
          </button>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {phase === "loading" && <div className="skeleton aspect-[3/4] w-full" aria-label="사진을 여는 중" />}
            <canvas
              ref={canvas}
              className={`block h-auto w-full touch-none select-none ${phase === "loading" ? "hidden" : ""}`}
              aria-label="증권 사진. 손가락으로 칠하면 검게 가려집니다"
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onPointerLeave={end}
            />
          </div>
          {phase === "confirm-empty" ? (
            <div role="alertdialog" aria-label="가리지 않고 올리기 확인" className="flex flex-col gap-3 rounded-xl bg-warn-soft p-4 text-warn-ink">
              <p className="font-semibold">아무것도 칠하지 않았습니다. 사진에 이름·주민번호·증권번호·차량번호가 보이면 칠해 주세요.</p>
              <button type="button" className={primaryButton} onClick={() => setPhase("ready")}>
                돌아가서 칠하기
              </button>
              <button type="button" className={outlineButton} onClick={() => upload(true)}>
                가리지 않고 그대로 올리기
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={`${outlineButton} text-base`} disabled={!painted || phase !== "ready"} onClick={undo}>
                  한 번 되돌리기
                </button>
                <button type="button" className={`${outlineButton} text-base`} disabled={!painted || phase !== "ready"} onClick={reset}>
                  처음부터
                </button>
              </div>
              <button type="button" className={primaryButton} disabled={phase !== "ready"} onClick={() => upload()}>
                {phase === "saving" ? "준비 중…" : "칠한 대로 올리기"}
              </button>
              <button type="button" className={outlineButton} onClick={onCancel}>
                취소
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
