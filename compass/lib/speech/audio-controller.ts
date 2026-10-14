// 브라우저 녹음 제어. 원본 앱(frontend/audio-controller.js)에서 잘 되던 코드를 옮기고 타입을 붙였다.
// 달라진 점: 음질을 낮춰 5분까지 담기게 했고, 5분이 되면 스스로 멈춘다.
// 아이폰 Safari는 조각 간격(timeslice)을 주면 조각난 mp4를 만들어 제공자가 읽지 못할 때가 있다. 그래서 간격 없이 녹음하고
// 멈출 때 한 덩어리로 받는다. 5분 자동 멈춤은 타이머가 맡는다.
// 서버가 한 번에 받는 크기(4MB)를 넘는 녹음은 보내는 쪽(lib/speech/split.ts)이 60초씩 나눠 보낸다.

export type AudioPhase = "idle" | "starting" | "recording" | "stopping" | "transcribing" | "error";
/** 마이크를 쓸 수 없는 이유. denied: 권한 거부, unsupported: 이 브라우저에 녹음 기능이 없음(카카오톡 등 인앱 브라우저) */
export type MicBlocked = "denied" | "unsupported";
export type AudioState = { phase: AudioPhase; message: string; canRetry: boolean; blocked?: MicBlocked };

/** 녹음·올린 파일을 받는 최대 크기. 이 기기에서 풀어 나눌 수 있는 정도로 둔다. */
export const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
export const MAX_RECORDING_MS = 5 * 60 * 1000;
const MIN_RECORDING_MS = 2000;
// 형식을 고정하지 않고 브라우저가 되는 것을 webm → mp4 순으로 고른다(크롬·안드로이드는 webm, 아이폰 Safari는 mp4).
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

const START_ERRORS: Record<string, string> = {
  NotAllowedError:
    "마이크 사용이 허용되지 않았습니다. 마이크 권한을 허용한 뒤 다시 눌러 주세요. 아이폰은 주소창의 가가(aA) → 웹 사이트 설정 → 마이크, 또는 설정 → Safari → 마이크에서 허용합니다.",
  NotFoundError: "마이크를 찾지 못했습니다. 아래에 직접 적어 주세요.",
  NotReadableError: "마이크를 쓸 수 없습니다. 다른 녹음 앱을 끈 뒤 다시 시도해 주세요.",
};

type RecorderLike = {
  state: string;
  mimeType: string;
  ondataavailable: ((event: { data?: Blob }) => void) | null;
  onerror: (() => void) | null;
  onstop: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
};
export type RecorderClass = {
  new (stream: MediaStream, options?: { mimeType?: string; audioBitsPerSecond?: number }): RecorderLike;
  isTypeSupported(type: string): boolean;
};

export type AudioControllerOptions = {
  mediaDevices: Pick<MediaDevices, "getUserMedia"> | undefined;
  Recorder: RecorderClass | undefined;
  /** 녹음을 서버로 보내 글을 받아 온다. 실패하면 사용자에게 보여 줄 문구로 Error를 던진다. */
  send: (blob: Blob) => Promise<{ text: string; note?: string }>;
  onState: (state: AudioState) => void;
  onText: (text: string) => void;
  now?: () => number;
  secure?: boolean;
};

export class AudioController {
  phase: AudioPhase = "idle";
  private blob: Blob | null = null;
  private stream: MediaStream | null = null;
  private recorder: RecorderLike | null = null;
  private disposed = false;
  private started = 0;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: AudioControllerOptions) {
    this.now = options.now ?? (() => performance.now());
  }

  private update(phase: AudioPhase, message = "", blocked?: MicBlocked) {
    this.phase = phase;
    this.options.onState({ phase, message, canRetry: phase === "error" && Boolean(this.blob), ...(blocked ? { blocked } : {}) });
  }

  private clean() {
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }

  private fail(message: string, blocked?: MicBlocked) {
    this.clean();
    this.update("error", message, blocked);
  }

  async start() {
    if (this.disposed || !["idle", "error"].includes(this.phase)) return;
    this.blob = null;
    this.update("starting", "마이크를 준비하고 있습니다");
    const { mediaDevices, Recorder } = this.options;
    if (this.options.secure === false || !mediaDevices?.getUserMedia || !Recorder) {
      return this.fail("이 브라우저에서는 녹음을 쓸 수 없습니다. 녹음 파일을 올리거나 아래에 직접 적어 주세요.", "unsupported");
    }
    try {
      this.stream = await mediaDevices.getUserMedia({ audio: true });
      if (this.disposed) return this.clean();
      const type = TYPES.find((candidate) => Recorder.isTypeSupported(candidate));
      let recorder: RecorderLike;
      try {
        recorder = new Recorder(this.stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
      } catch {
        // 음질 지정을 받지 않는 브라우저는 기본 음질로 녹음한다(길면 split.ts가 나눠 보낸다).
        recorder = new Recorder(this.stream, type ? { mimeType: type } : {});
      }
      this.recorder = recorder;
      const chunks: Blob[] = [];
      let size = 0;
      let cancelled = false;
      recorder.ondataavailable = (event) => {
        if (cancelled || !event.data?.size) return;
        size += event.data.size;
        if (size > MAX_RECORDING_BYTES) {
          cancelled = true;
          this.blob = null;
          this.fail("녹음이 너무 깁니다. 더 짧게 나눠서 다시 녹음해 주세요.");
          if (recorder.state === "recording") recorder.stop();
          return;
        }
        chunks.push(event.data);
        // 한도 시간이 되면 스스로 멈추고 거기까지를 글로 바꾼다.
        if (this.phase === "recording" && this.now() - this.started >= MAX_RECORDING_MS) this.stop();
      };
      recorder.onerror = () => {
        cancelled = true;
        this.blob = null;
        this.fail("녹음이 중단됐습니다. 마이크를 확인하고 다시 눌러 주세요.");
      };
      recorder.onstop = async () => {
        if (cancelled || this.disposed) return;
        this.clean();
        const blob = new Blob(chunks, { type: recorder.mimeType || type || chunks[0]?.type || "" });
        if (!blob.size || this.now() - this.started < MIN_RECORDING_MS) {
          return this.fail("녹음이 비어 있거나 너무 짧습니다. 2초 이상 말한 뒤 멈춰 주세요.");
        }
        this.blob = blob;
        await this.convert();
      };
      // 간격 없이 녹음하고, 멈출 때 받은 한 덩어리를 onstop에서 한 번만 보낸다.
      recorder.start();
      this.started = this.now();
      this.limitTimer = setTimeout(() => {
        if (this.phase === "recording") this.stop();
      }, MAX_RECORDING_MS);
      this.update("recording", "듣고 있습니다. 다 말했으면 다시 눌러 주세요");
    } catch (error) {
      const name = (error as { name?: string })?.name ?? "";
      const blocked: MicBlocked | undefined = name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "TypeError" ? "unsupported" : undefined;
      this.fail(START_ERRORS[name] ?? "녹음을 시작하지 못했습니다. 아래에 직접 적어 주세요.", blocked);
    }
  }

  /** 녹음 중이면 멈추고 글로 바꾼다. 변환에 실패한 녹음이 남아 있으면 같은 녹음으로 다시 시도한다. */
  stop() {
    if (this.phase === "error" && this.blob) return this.convert();
    if (this.phase !== "recording" || this.recorder?.state !== "recording") return;
    this.update("stopping", "녹음을 정리하고 있습니다");
    try {
      this.recorder.stop();
    } catch {
      this.blob = null;
      this.fail("녹음을 멈추지 못했습니다. 다시 눌러 주세요.");
    }
  }

  /** 휴대폰 음성메모처럼 이미 있는 녹음 파일을 글로 바꾼다. 실패하면 마이크 단추로 같은 파일을 다시 시도할 수 있다. */
  async transcribeFile(file: Blob) {
    if (this.disposed || !["idle", "error"].includes(this.phase)) return;
    if (!file.size) return this.update("error", "빈 파일입니다. 다른 녹음 파일을 골라 주세요.");
    if (file.size > MAX_RECORDING_BYTES) return this.update("error", "녹음 파일이 너무 큽니다(25MB까지). 짧게 나눈 파일을 올려 주세요.");
    this.blob = file;
    await this.convert();
  }

  private async convert() {
    if (this.disposed || this.phase === "transcribing") return;
    if (!this.blob?.size || this.blob.size > MAX_RECORDING_BYTES) return this.fail("녹음이 비어 있거나 너무 깁니다. 다시 녹음해 주세요.");
    this.update("transcribing", "말한 내용을 글로 바꾸고 있습니다");
    try {
      const result = await this.options.send(this.blob);
      if (this.disposed) return;
      if (typeof result.text !== "string" || !result.text.trim()) throw new Error("말소리를 알아듣지 못했습니다.");
      this.options.onText(result.text.trim());
      this.blob = null;
      this.update("idle", result.note ?? "글로 바꿨습니다. 아래 글을 확인하고 틀린 곳을 고쳐 주세요.");
    } catch (error) {
      if (!this.disposed) this.update("error", `${(error as Error).message || "음성을 글로 바꾸지 못했습니다."} 적어 둔 사고 내용은 그대로 있습니다.`);
    }
  }

  dispose() {
    this.disposed = true;
    const recorder = this.recorder;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state === "recording") recorder.stop();
    }
    this.clean();
    this.blob = null;
  }
}
