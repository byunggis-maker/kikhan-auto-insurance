// AI 기능 켜고 끄기(화면과 서버가 함께 본다).
// 서버 음성→문자: 라운드 7 마무리 지시 2 (B)로 끈다. 코드(lib/ai/speech.ts, app/api/speech, components/ai/VoiceInput.tsx)는 그대로 두고,
// 켜려면 이 값을 true로 바꾸고 v6/.env.local·Vercel에 OPENAI_API_KEY·STT_MODEL을 넣는다(MASTER.md D-40).
// 꺼져 있으면 /api/speech는 503 "준비 중"이고, 1단계는 휴대폰 키보드의 받아쓰기(마이크 버튼)를 안내한다.
export const SERVER_SPEECH_ENABLED = false;
