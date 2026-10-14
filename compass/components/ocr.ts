"use client";

import { findMaskBoxes, type Box, type OcrLine } from "@/lib/privacy/image-mask";

// 사진 속 개인정보 자리를 이 기기 안에서 찾는다. 글자 인식(tesseract.js)은 브라우저의 작업 스레드에서 돌고,
// 인식 파일은 이 앱 주소(/ocr/, scripts/copy-ocr-assets.mjs)에서만 받는다. 사진과 인식한 글은 어디에도 보내거나 남기지 않는다.
// 인식 파일(약 5MB)은 처음 한 번 받고 브라우저가 보관한다(사진이 아니라 인식 자료라 개인정보가 없다).

const TIMEOUT_MS = 45_000;

type Page = { blocks: { paragraphs: { lines: { words: { text: string; bbox: Box }[] }[] }[] }[] | null };

/** 칠할 네모(그림 좌표)를 돌려준다. 실패하거나 너무 오래 걸리면 오류를 던진다(화면은 직접 칠하기로 돌아간다). */
export async function detectSensitiveBoxes(image: HTMLCanvasElement, signal: AbortSignal): Promise<Box[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 인식 파일 받기부터 결과까지 전체에 시간 제한을 둔다. 사용자가 건너뛰면(abort) 바로 멈춘다.
  const cut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
    if (signal.aborted) reject(new Error("aborted"));
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  cut.catch(() => undefined);
  const { createWorker, OEM } = await Promise.race([import("tesseract.js"), cut]);
  const starting = createWorker("kor", OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/",
    langPath: "/ocr/",
    gzip: true,
    workerBlobURL: false,
  });
  // 어느 쪽으로 끝나든 작업 스레드는 닫는다.
  const stop = () => void starting.then((worker) => worker.terminate()).catch(() => undefined);
  try {
    const worker = await Promise.race([starting, cut]);
    const { data } = await Promise.race([worker.recognize(image, {}, { blocks: true, text: false }), cut]);
    const lines: OcrLine[] = ((data as unknown as Page).blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => ({ words: line.words.map((word) => ({ text: word.text, bbox: word.bbox })) }))),
    );
    return findMaskBoxes(lines);
  } finally {
    clearTimeout(timer);
    stop();
  }
}
