// 카카오톡·네이버·인스타그램 같은 앱 안의 브라우저(인앱 브라우저)를 알아보고, 바깥 브라우저로 여는 주소를 만든다.
// 인앱 브라우저는 마이크(getUserMedia)를 막거나 지원하지 않는 경우가 많다.

const APPS: { name: string; pattern: RegExp }[] = [
  { name: "카카오톡", pattern: /KAKAOTALK/i },
  { name: "네이버", pattern: /NAVER\(inapp/i },
  { name: "라인", pattern: /\bLine\//i },
  { name: "인스타그램", pattern: /Instagram/i },
  { name: "페이스북", pattern: /FBAN|FBAV|FB_IAB/i },
  { name: "밴드", pattern: /\bBAND\//i },
  { name: "다음", pattern: /DaumApps/i },
  { name: "에브리타임", pattern: /everytimeApp/i },
];

export type InApp = { name: string; kakao: boolean };

/** 인앱 브라우저면 앱 이름, 아니면 null */
export function detectInApp(userAgent: string): InApp | null {
  const app = APPS.find((candidate) => candidate.pattern.test(userAgent));
  if (app) return { name: app.name, kakao: app.name === "카카오톡" };
  // 이름을 밝히지 않는 안드로이드 웹뷰
  if (/Android/i.test(userAgent) && /; wv\)/.test(userAgent)) return { name: "앱", kakao: false };
  return null;
}

/** 바깥 브라우저(Safari·Chrome)로 여는 주소. 앱이 그런 주소를 받지 않으면 null(주소 복사로 안내한다). */
export function externalOpenUrl(userAgent: string, href: string): string | null {
  const app = detectInApp(userAgent);
  if (!app) return null;
  if (app.kakao) return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
  if (app.name === "라인") {
    const url = new URL(href);
    url.searchParams.set("openExternalBrowser", "1");
    return url.toString();
  }
  if (/Android/i.test(userAgent)) {
    const url = new URL(href);
    return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.replace(":", "")};package=com.android.chrome;end`;
  }
  return null;
}
