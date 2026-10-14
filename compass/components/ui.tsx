import { useId, type ReactNode } from "react";

// 화면 부품. 금액을 더하거나 빼지 않는다(CLAUDE.md 코드 규칙).

export const DISCLAIMER = "참고용 추정이며 손해사정이나 보험금 지급 확정이 아닙니다";

export function Disclaimer() {
  return <p className="mt-8 border-t border-line pt-4 text-center text-sm text-muted">{DISCLAIMER}</p>;
}

/** 불러오는 동안 보여 주는 자리 */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="불러오는 중">
      <div className="skeleton h-28 w-full" />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton h-16 w-full" />
      ))}
    </div>
  );
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line/70 bg-white p-5 shadow-[var(--shadow-card)]">
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-lg font-bold tracking-tight">{title}</h2>}
          {action}
        </div>
      )}
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** 사실 추출이 짐작해서 채운 값에 붙는 표시. 누르면 "맞다"고 확인한 것으로 본다. */
export function GuessBadge({ onConfirm }: { onConfirm: () => void }) {
  return (
    <button
      type="button"
      onClick={onConfirm}
      className="ml-2 min-h-8 rounded-full border border-muted/50 bg-white px-2.5 py-1 align-middle text-xs font-bold text-muted"
      title="맞으면 눌러서 확인"
    >
      추정 · 맞으면 누르기
    </button>
  );
}

/** 위쪽 고정 머리말에 가리지 않게 띄우고, 찾아온 칸을 잠깐 표시한다 */
export const ANCHOR_CLASS = "scroll-mt-28 rounded-xl target:outline target:outline-3 target:outline-offset-4 target:outline-navy";

const inputClass =
  "w-full min-h-13 rounded-[14px] border border-line bg-white px-4 text-lg placeholder:text-muted/70 focus:border-navy focus:ring-4 focus:ring-navy/10 focus:outline-none";

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "date" | "time";
  hint?: string;
  /** 짐작으로 채운 값이면 회색으로 보이고 "추정" 표시가 붙는다. */
  onConfirmGuess?: () => void;
  /** 결과 화면의 "부족 정보" 버튼이 찾아오는 이름 */
  anchor?: string;
}) {
  const id = useId();
  // "추정" 버튼은 label 밖에 둔다. label 안에 두면 이름표가 입력 칸이 아니라 버튼에 붙는다.
  return (
    <div id={props.anchor} className={`flex flex-col gap-1.5 ${ANCHOR_CLASS}`}>
      <span>
        <label htmlFor={id} className="font-semibold">
          {props.label}
        </label>
        {props.onConfirmGuess && <GuessBadge onConfirm={props.onConfirmGuess} />}
      </span>
      <input
        id={id}
        className={`${inputClass} ${props.onConfirmGuess ? "text-muted italic" : ""}`}
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint && <span className="text-sm text-muted">{props.hint}</span>}
    </div>
  );
}

/** 비워 두면 null(모름), 0을 넣으면 0(없다고 확인)으로 구분해 돌려준다. */
export function NumberField(props: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  unit: string;
  max?: number;
  hint?: string;
  onConfirmGuess?: () => void;
  anchor?: string;
}) {
  const shown = props.value === null ? "" : props.value.toLocaleString("ko-KR");
  const id = useId();
  return (
    <div id={props.anchor} className={`flex flex-col gap-1.5 ${ANCHOR_CLASS}`}>
      <span>
        <label htmlFor={id} className="font-semibold">
          {props.label}
        </label>
        {props.onConfirmGuess && <GuessBadge onConfirm={props.onConfirmGuess} />}
      </span>
      <span className="relative block">
        <input
          id={id}
          className={`${inputClass} pr-14 text-right ${props.onConfirmGuess ? "text-muted italic" : ""}`}
          inputMode="numeric"
          value={shown}
          placeholder="모르면 비워 두세요"
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 12);
            if (!digits) return props.onChange(null);
            const number = Number(digits);
            props.onChange(props.max !== undefined && number > props.max ? props.max : number);
          }}
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted">{props.unit}</span>
      </span>
      {props.hint && <span className="text-sm text-muted">{props.hint}</span>}
    </div>
  );
}

export function Choice<T extends string>(props: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  onConfirmGuess?: () => void;
  anchor?: string;
}) {
  return (
    <fieldset id={props.anchor} className={`flex flex-col gap-1.5 ${ANCHOR_CLASS}`}>
      <legend className="mb-1.5 font-semibold">{props.label}</legend>
      {props.onConfirmGuess && (
        <span className="-mt-1 mb-0.5">
          <GuessBadge onConfirm={props.onConfirmGuess} />
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        {props.options.map((option) => {
          const on = props.value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => props.onChange(option.value)}
              className={`min-h-12 flex-1 rounded-xl border px-4 font-semibold ${
                on ? (props.onConfirmGuess ? "border-muted bg-muted text-white" : "border-navy bg-navy text-white") : "border-line bg-white text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Pending({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-navy-soft px-4 py-3 text-base text-navy">{children}</p>;
}

export const primaryButton =
  "flex min-h-14 w-full items-center justify-center rounded-2xl bg-navy px-6 text-xl font-bold text-white shadow-[0_6px_18px_rgb(27_47_107/0.22)] hover:bg-navy-dark active:bg-navy-dark disabled:opacity-40 disabled:shadow-none";
export const outlineButton =
  "flex min-h-13 w-full items-center justify-center rounded-2xl border border-navy/30 bg-white px-5 text-lg font-bold text-navy hover:border-navy hover:bg-navy-soft disabled:opacity-40";

// lib/guard/paid.ts의 PAID_UNAVAILABLE_MESSAGE와 같은 문구다.
export const PAID_UNAVAILABLE_MESSAGE = "지금은 자동 기능을 쓸 수 없습니다. 직접 입력해 계산할 수 있어요.";

/** 유료 기능(음성 변환, 증권 읽기, 쉬운 말 설명, 읽어주기)을 쓸 수 없을 때(설정 없음, 서버 장애) 그 자리에 보여 주는 안내. */
export function PaidNotice({ what }: { what: string }) {
  return (
    <p role="note" className="rounded-xl bg-navy-soft p-4 font-semibold text-navy">
      {what}: {PAID_UNAVAILABLE_MESSAGE}
    </p>
  );
}
