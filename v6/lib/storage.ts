// 진행 상태를 이 브라우저의 localStorage에만 저장한다(MASTER.md 2장). 서버·데이터베이스로 보내지 않는다.
// 사생활 보호 창, 저장 공간 부족, 차단된 사이트 데이터, 서버 렌더링(window 없음)에서는 접근 자체가 실패할 수 있다.
// 그래서 읽기·쓰기·지우기를 모두 try/catch로 감싸고, 실패하면 기본값이나 false를 돌려줄 뿐 앱을 멈추지 않는다.

const PREFIX = "kikhan-v6:";

function storage(): Storage | null {
  try {
    // localStorage에 접근하는 것만으로 예외가 나는 브라우저가 있다.
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * 저장한 값을 읽는다. 없거나, 읽지 못했거나, JSON이 깨졌거나, isValid가 false면 fallback.
 * isValid로 모양을 확인하면 예전 버전의 저장값이 화면을 망가뜨리지 않는다.
 */
export function loadState<T>(key: string, fallback: T, isValid?: (value: unknown) => value is T): T {
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (raw === null || raw === undefined) return fallback;
    const value: unknown = JSON.parse(raw);
    if (isValid && !isValid(value)) return fallback;
    return value as T;
  } catch {
    return fallback;
  }
}

/** 값을 저장한다. 저장했으면 true, 저장하지 못했으면(공간 부족·차단 등) false */
export function saveState(key: string, value: unknown): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** 저장한 값을 지운다. 지웠거나 원래 없었으면 true, 지우지 못했으면 false */
export function removeState(key: string): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.removeItem(PREFIX + key);
    return true;
  } catch {
    return false;
  }
}
