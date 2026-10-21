"use client";

// MASTER.md 7장: 각 단계 아래 "모르면 건너뛰기". 건너뛴 값은 7단계의 "입력 필요" 목록에 모은다.

export function SkipButton({ onSkip, skipped }: { onSkip: () => void; skipped: boolean }) {
  return (
    <button type="button" onClick={onSkip} className="min-h-12 w-full rounded-xl border-2 border-dashed border-line bg-transparent font-bold text-ink-soft">
      {skipped ? "건너뜀 — 7단계 '입력 필요'에 모아 둡니다" : "모르면 건너뛰기"}
    </button>
  );
}
