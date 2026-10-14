// 읽어주기 재생 제어: 나눠 둔 글을 차례로 음성으로 받아 재생한다. 재생·멈춤·속도.
// 브라우저의 Audio와 음성 받기를 인자로 받아 테스트할 수 있게 한다.

export type PlayerState = { phase: "idle" | "loading" | "playing" | "paused" } | { phase: "error"; message: string };

export type AudioLike = {
  src: string;
  playbackRate: number;
  onended: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
};

export type SpeechPlayerOptions = {
  chunks: string[];
  /** 글 한 덩어리를 음성 주소로 바꾼다 */
  fetchAudio: (text: string) => Promise<string>;
  createAudio: () => AudioLike;
  /** 다 쓴 음성 주소를 버린다 */
  release: (url: string) => void;
  onState: (state: PlayerState) => void;
};

const FAILED = "읽어주기에 실패했습니다.";

export class SpeechPlayer {
  private audio: AudioLike | null = null;
  private urls: (string | undefined)[] = [];
  private index = 0;
  private speed = 1;
  private state: PlayerState = { phase: "idle" };
  private disposed = false;

  constructor(private readonly options: SpeechPlayerOptions) {}

  private set(state: PlayerState) {
    this.state = state;
    if (!this.disposed) this.options.onState(state);
  }

  private async playFrom(position: number) {
    if (position >= this.options.chunks.length) {
      this.index = 0;
      this.set({ phase: "idle" });
      return;
    }
    this.index = position;
    try {
      if (!this.urls[position]) {
        this.set({ phase: "loading" });
        const url = await this.options.fetchAudio(this.options.chunks[position]);
        if (this.disposed) return this.options.release(url);
        this.urls[position] = url;
      }
      const audio = this.audio ?? this.options.createAudio();
      this.audio = audio;
      audio.src = this.urls[position] as string;
      audio.playbackRate = this.speed;
      audio.onended = () => void this.playFrom(position + 1);
      await audio.play();
      // 재생 속도는 음성을 바꿔 끼울 때 처음 값으로 돌아가는 브라우저가 있어 다시 넣는다.
      audio.playbackRate = this.speed;
      this.set({ phase: "playing" });
    } catch (error) {
      this.set({ phase: "error", message: error instanceof Error && error.message ? error.message : FAILED });
    }
  }

  /** 재생 ↔ 멈춤. 오류 뒤에는 멈춘 곳부터 다시 시도한다 */
  toggle() {
    if (this.state.phase === "loading") return;
    if (this.state.phase === "playing") {
      this.audio?.pause();
      this.set({ phase: "paused" });
    } else if (this.state.phase === "paused" && this.audio) {
      void this.audio.play().then(
        () => this.set({ phase: "playing" }),
        () => this.set({ phase: "error", message: FAILED }),
      );
    } else void this.playFrom(this.state.phase === "error" ? this.index : 0);
  }

  setSpeed(speed: number) {
    this.speed = speed;
    if (this.audio) this.audio.playbackRate = speed;
  }

  dispose() {
    this.disposed = true;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.pause();
    }
    for (const url of this.urls) if (url) this.options.release(url);
    this.urls = [];
  }
}
