import { describe, expect, it, vi } from "vitest";
import { AudioController, MAX_RECORDING_BYTES, type AudioState, type RecorderClass } from "@/lib/speech/audio-controller";

// 브라우저의 마이크와 녹음기를 가짜로 만들어 녹음 제어의 흐름만 확인한다.
function rig(options: { supported?: string[]; send?: (blob: Blob) => Promise<{ text: string }>; deny?: string } = {}) {
  const states: AudioState[] = [];
  const texts: string[] = [];
  const stopTrack = vi.fn();
  let clock = 0;
  let recorder: FakeRecorder | undefined;
  class FakeRecorder {
    static isTypeSupported = (type: string) => (options.supported ?? ["audio/webm;codecs=opus"]).includes(type);
    state = "inactive";
    mimeType: string;
    ondataavailable: ((event: { data?: Blob }) => void) | null = null;
    onerror: (() => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(
      _stream: MediaStream,
      public options: { mimeType?: string; audioBitsPerSecond?: number } = {},
    ) {
      this.mimeType = options.mimeType ?? "";
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      recorder = this;
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.onstop?.();
    }
    emit(bytes: number) {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
    }
  }
  const send = vi.fn(options.send ?? (async () => ({ text: " 사고가 났습니다 " })));
  const controller = new AudioController({
    mediaDevices: {
      getUserMedia: async () => {
        if (options.deny) throw Object.assign(new Error("x"), { name: options.deny });
        return { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
      },
    },
    Recorder: FakeRecorder as unknown as RecorderClass,
    send,
    onState: (state) => states.push(state),
    onText: (text) => texts.push(text),
    now: () => clock,
  });
  return { controller, states, texts, send, stopTrack, recorder: () => recorder!, tick: (ms: number) => (clock += ms) };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("녹음 제어", () => {
  it("녹음 → 멈춤 → 글로 바꾸기까지 한 번에 이어지고, 녹음은 한 번만 보낸다", async () => {
    const r = rig();
    await r.controller.start();
    expect(r.controller.phase).toBe("recording");
    expect(r.recorder().options).toEqual({ mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 });
    r.recorder().emit(5000);
    r.tick(3000);
    r.recorder().emit(5000);
    r.controller.stop();
    await settle();
    expect(r.send).toHaveBeenCalledTimes(1);
    expect(r.send.mock.calls[0][0].size).toBe(10000);
    expect(r.send.mock.calls[0][0].type).toBe("audio/webm;codecs=opus");
    expect(r.texts).toEqual(["사고가 났습니다"]);
    expect(r.states.map((s) => s.phase)).toEqual(["starting", "recording", "stopping", "transcribing", "idle"]);
    expect(r.stopTrack).toHaveBeenCalled();
  });

  it("사파리처럼 mp4만 되는 브라우저에서는 mp4로 녹음한다", async () => {
    const r = rig({ supported: ["audio/mp4"] });
    await r.controller.start();
    expect(r.recorder().options.mimeType).toBe("audio/mp4");
  });

  it("2초보다 짧은 녹음은 보내지 않는다", async () => {
    const r = rig();
    await r.controller.start();
    r.recorder().emit(100);
    r.tick(500);
    r.controller.stop();
    await settle();
    expect(r.send).not.toHaveBeenCalled();
    expect(r.states.at(-1)).toMatchObject({ phase: "error", canRetry: false });
  });

  it("크기 한도를 넘으면 녹음을 버린다", async () => {
    const r = rig();
    await r.controller.start();
    r.tick(3000);
    r.recorder().emit(MAX_RECORDING_BYTES + 1);
    await settle();
    expect(r.send).not.toHaveBeenCalled();
    expect(r.states.at(-1)?.phase).toBe("error");
  });

  it("5분이 되면 스스로 멈추고 거기까지를 글로 바꾼다", async () => {
    const r = rig();
    await r.controller.start();
    r.tick(5 * 60 * 1000);
    r.recorder().emit(5000);
    await settle();
    expect(r.send).toHaveBeenCalledTimes(1);
    expect(r.texts).toHaveLength(1);
  });

  it("글로 바꾸기에 실패하면 같은 녹음으로 다시 시도할 수 있다", async () => {
    let fail = true;
    const r = rig({
      send: async () => {
        if (fail) throw new Error("서버에 연결하지 못했습니다.");
        return { text: "다시 됐습니다" };
      },
    });
    await r.controller.start();
    r.recorder().emit(5000);
    r.tick(3000);
    r.controller.stop();
    await settle();
    expect(r.states.at(-1)).toMatchObject({ phase: "error", canRetry: true });
    expect(r.states.at(-1)?.message).toContain("적어 둔 사고 내용은 그대로");
    fail = false;
    await r.controller.stop();
    expect(r.send).toHaveBeenCalledTimes(2);
    expect(r.texts).toEqual(["다시 됐습니다"]);
    expect(r.controller.phase).toBe("idle");
  });

  it("마이크 권한이 없으면 무엇을 해야 하는지 알려 준다", async () => {
    const r = rig({ deny: "NotAllowedError" });
    await r.controller.start();
    expect(r.states.at(-1)?.message).toContain("마이크 권한을 허용");
  });

  it("화면을 떠나면 녹음을 버리고 보내지 않는다", async () => {
    const r = rig();
    await r.controller.start();
    r.recorder().emit(5000);
    r.tick(3000);
    r.controller.dispose();
    await settle();
    expect(r.send).not.toHaveBeenCalled();
    expect(r.stopTrack).toHaveBeenCalled();
  });
});
