import { useSyncExternalStore } from "react";

type AudioState =
  | { status: "idle" | "starting" | "error" }
  | { status: "active"; analyser: AnalyserNode };

type Capture = { context: AudioContext; stream?: MediaStream };

let capture: Capture | undefined;
let state: AudioState = { status: "idle" };
const listeners = new Set<() => void>();

function setState(next: AudioState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useAudioVisualizer = () => useSyncExternalStore(subscribe, () => state);

export function supportsAudioVisualizer() {
  return (
    !!window.bloxbot &&
    /Windows/i.test(navigator.userAgent) &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

function stopTracks(tracks: MediaStreamTrack[]) {
  for (const track of tracks) track.stop();
}

/** Boundaries for adjacent log-spaced frequency bands, in FFT bins. */
export function spectrumBandEdges(analyser: AnalyserNode, count: number) {
  const binHz = analyser.context.sampleRate / analyser.fftSize;
  const first = Math.max(1, Math.round(35 / binHz));
  const last = Math.min(analyser.frequencyBinCount, Math.round(12_000 / binHz));
  const bands = Math.min(count, last - first);
  const edges = [first];
  for (let index = 1; index <= bands; index++) {
    const target = Math.round(first * (last / first) ** (index / bands));
    edges.push(Math.min(last - (bands - index), Math.max(edges[index - 1] + 1, target)));
  }
  return edges;
}

export function stopAudioVisualizer() {
  const current = capture;
  capture = undefined;
  if (current?.stream) stopTracks(current.stream.getTracks());
  void current?.context.close().catch(() => {});
  setState({ status: "idle" });
}

export async function startAudioVisualizer() {
  if (capture || !supportsAudioVisualizer()) return;
  let attempt: Capture | undefined;
  try {
    attempt = { context: new AudioContext() };
    capture = attempt;
    setState({ status: "starting" });
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    stopTracks(stream.getVideoTracks());
    if (capture !== attempt) {
      stopTracks(stream.getAudioTracks());
      return;
    }
    attempt.stream = stream;
    const audio = stream.getAudioTracks();
    if (!audio.length) throw new Error("System audio is unavailable");
    for (const track of audio) {
      track.addEventListener("ended", () => {
        if (capture === attempt) stopAudioVisualizer();
      });
    }
    const context = attempt.context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.minDecibels = -106;
    analyser.smoothingTimeConstant = 0.48;
    context.createMediaStreamSource(new MediaStream(audio)).connect(analyser);
    await context.resume();
    if (capture === attempt) setState({ status: "active", analyser });
  } catch {
    if (capture !== attempt) return;
    stopAudioVisualizer();
    setState({ status: "error" });
  }
}

import.meta.hot?.dispose(stopAudioVisualizer);
