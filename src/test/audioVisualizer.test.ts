import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AudioSpectrum,
  FunSettings,
  useRestoreAudioVisualizer,
} from "@/components/AudioVisualizer";
import {
  spectrumBandEdges,
  startAudioVisualizer,
  stopAudioVisualizer,
  useAudioVisualizer,
} from "@/lib/audioVisualizer";
import { loadConfig } from "@/lib/config";

const getDisplayMedia = vi.fn();
const close = vi.fn();
const video = { stop: vi.fn() };
const audio = { stop: vi.fn(), addEventListener: vi.fn() };
const stream = {
  getVideoTracks: () => [video],
  getAudioTracks: () => [audio],
  getTracks: () => [audio, video],
};
const analyser = {};

it("covers adjacent FFT bins without duplicates at common output sample rates", () => {
  for (const sampleRate of [44_100, 48_000, 96_000]) {
    const edges = spectrumBandEdges(
      { context: { sampleRate }, fftSize: 2048, frequencyBinCount: 1024 } as AnalyserNode,
      44,
    );
    expect(edges).toHaveLength(45);
    expect(edges.every((edge, index) => index === 0 || edge > edges[index - 1])).toBe(true);
    const binHz = sampleRate / 2048;
    expect(edges[0] * binHz).toBeLessThan(55);
    expect(edges.at(-1)).toBe(Math.round(12_000 / binHz));
  }
});

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Windows");
  vi.stubGlobal("bloxbot", {});
  vi.stubGlobal("MediaStream", class {});
  vi.stubGlobal(
    "AudioContext",
    class {
      createAnalyser = () => analyser;
      createMediaStreamSource = () => ({ connect: vi.fn() });
      resume = vi.fn().mockResolvedValue(undefined);
      close = close.mockResolvedValue(undefined);
    },
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getDisplayMedia },
  });
});

afterEach(() => {
  cleanup();
  stopAudioVisualizer();
  Reflect.deleteProperty(navigator, "mediaDevices");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("releases the video track on start and stops system audio on request", async () => {
  const { result } = renderHook(useAudioVisualizer);
  getDisplayMedia.mockResolvedValueOnce(stream);
  await act(startAudioVisualizer);
  expect(video.stop).toHaveBeenCalled();
  expect(audio.stop).not.toHaveBeenCalled();
  expect(result.current).toEqual({ status: "active", analyser });
  act(stopAudioVisualizer);
  expect(audio.stop).toHaveBeenCalledExactlyOnceWith();
  expect(close).toHaveBeenCalledExactlyOnceWith();
  expect(result.current.status).toBe("idle");
});

it("releases late tracks if stopped while the capture request is pending", async () => {
  const { result } = renderHook(useAudioVisualizer);
  let resolveCapture: (value: typeof stream) => void = () => {};
  getDisplayMedia.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveCapture = resolve;
    }),
  );
  let starting: Promise<void> | undefined;
  act(() => {
    starting = startAudioVisualizer();
  });
  expect(result.current.status).toBe("starting");
  act(stopAudioVisualizer);
  await act(async () => {
    resolveCapture(stream);
    await starting;
  });
  expect(video.stop).toHaveBeenCalledExactlyOnceWith();
  expect(audio.stop).toHaveBeenCalledExactlyOnceWith();
  expect(result.current.status).toBe("idle");
});

it("persists the enabled setting across remounts and can turn it off again", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

  function TestSettings() {
    useRestoreAudioVisualizer();
    return createElement(FunSettings);
  }

  const mount = () =>
    render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(TestSettings),
      ),
    );

  const first = mount();
  const start = await screen.findByRole("button", { name: "Start visualizer" });
  await waitFor(() => expect(start).toBeEnabled());
  getDisplayMedia.mockResolvedValueOnce(stream);
  fireEvent.click(start);
  await screen.findByRole("button", { name: "Stop visualizer" });
  await expect(loadConfig()).resolves.toMatchObject({ audioVisualizerEnabled: true });

  first.unmount();
  stopAudioVisualizer();
  mount();
  const stop = await screen.findByRole("button", { name: "Stop visualizer" });
  expect(getDisplayMedia).toHaveBeenCalledTimes(1);
  fireEvent.click(stop);
  await screen.findByRole("button", { name: "Start visualizer" });
  await expect(loadConfig()).resolves.toMatchObject({ audioVisualizerEnabled: false });
});

it("hides bars after sustained silence and restores them when audio resumes", () => {
  const draw = { clearRect: vi.fn(), fillRect: vi.fn(), globalAlpha: 0 };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    draw as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "clientWidth", "get").mockReturnValue(30);
  vi.spyOn(HTMLCanvasElement.prototype, "clientHeight", "get").mockReturnValue(90);
  let frame: FrameRequestCallback = () => {};
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  let signal = 0;
  const input = {
    context: { sampleRate: 48_000 },
    fftSize: 2048,
    frequencyBinCount: 1024,
    getFloatTimeDomainData: (samples: Float32Array) => samples.fill(signal),
    getByteFrequencyData: vi.fn(),
  } as unknown as AnalyserNode;

  const { container } = render(createElement(AudioSpectrum, { analyser: input }));
  const canvas = container.querySelector("canvas");
  frame(50);
  expect(draw.fillRect).not.toHaveBeenCalled();
  expect(canvas).not.toHaveAttribute("data-audio-visible");

  signal = 0.003;
  frame(100);
  expect(draw.fillRect).toHaveBeenCalled();
  expect(canvas).toHaveAttribute("data-audio-visible");
  expect(draw.globalAlpha).toBeCloseTo(0.2);

  signal = 0;
  frame(1450);
  expect(draw.globalAlpha).toBeGreaterThan(0);
  expect(draw.globalAlpha).toBeLessThan(0.2);
  draw.fillRect.mockClear();
  draw.clearRect.mockClear();
  frame(1600);
  expect(draw.clearRect).toHaveBeenCalled();
  expect(draw.fillRect).not.toHaveBeenCalled();
  expect(canvas).not.toHaveAttribute("data-audio-visible");

  signal = 0.003;
  frame(1650);
  expect(draw.fillRect).toHaveBeenCalled();
});
