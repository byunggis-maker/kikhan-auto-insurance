// 녹음이 서버가 한 번에 받는 크기(4MB)를 넘으면 이 기기에서 60초씩 나눈다.
// webm·mp4는 바이트로 자르면 뒤 조각에 머리말이 없어 제공자가 읽지 못한다. 그래서 소리를 풀어(decode)
// 16kHz 한 채널 WAV로 다시 만든다(60초 ≈ 1.9MB). 녹음은 이 기기의 메모리에서만 다루고 저장하지 않는다.

export const SEND_LIMIT = 4 * 1024 * 1024;
export const SEGMENT_SECONDS = 60;
const RATE = 16000;

/** 서버(lib/speech/transcribe.ts)가 그대로 받는 형식 */
const KNOWN = ["audio/webm", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg", "video/webm", "video/mp4"];

const baseType = (type: string) => type.split(";")[0].trim().toLowerCase();

/** 그대로 보내도 되는지. 크면 나누고, 서버가 모르는 형식(이름만 .m4a이고 형식이 빈 파일 등)은 WAV로 바꾼다. */
export function needsSplit(blob: Blob) {
  return blob.size > SEND_LIMIT || !KNOWN.includes(baseType(blob.type));
}

/** 16비트 PCM WAV */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 한 채널
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** 한 채널 소리를 segmentSeconds씩 잘라 WAV 조각으로 만든다. */
export function sliceToWav(samples: Float32Array, rate: number, segmentSeconds = SEGMENT_SECONDS): Blob[] {
  const step = rate * segmentSeconds;
  const pieces: Blob[] = [];
  for (let start = 0; start < samples.length; start += step) pieces.push(encodeWav(samples.subarray(start, start + step), rate));
  return pieces;
}

type AudioContextClass = typeof AudioContext;

/** 보낼 조각들. 나눌 필요가 없으면 받은 그대로 하나만 돌려준다. 풀지 못하면 Error(화면에 보여 줄 문장)를 던진다. */
export async function splitAudio(blob: Blob): Promise<Blob[]> {
  if (!needsSplit(blob)) return [blob];
  const Context = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext) as AudioContextClass | undefined;
  if (!Context || typeof OfflineAudioContext === "undefined") throw new Error("이 브라우저에서는 긴 녹음을 나눌 수 없습니다. 5분 안쪽 녹음으로 다시 올려 주세요.");
  const context = new Context();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error("이 녹음 파일을 열지 못했습니다. m4a·mp3·wav 파일로 올리거나 아래에 직접 적어 주세요.");
  } finally {
    void context.close().catch(() => undefined);
  }
  // 16kHz 한 채널로 바꾼다(여러 채널은 한 채널로 섞인다).
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const mono = (await offline.startRendering()).getChannelData(0);
  return sliceToWav(mono, RATE);
}
