import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import { MESSAGE_RAIL_ROW_HEIGHT } from "@/components/MessageRail";
import {
  spectrumBandEdges,
  startAudioVisualizer,
  stopAudioVisualizer,
  supportsAudioVisualizer,
  useAudioVisualizer,
} from "@/lib/audioVisualizer";
import { type AppConfig, loadConfig, patchConfig } from "@/lib/config";
import { qk } from "@/lib/queryKeys";

const SILENCE_RMS = 0.001;
const SILENCE_HOLD_MS = 1200;
const SILENCE_FADE_MS = 250;

function useAudioVisualizerPreference() {
  return useQuery({
    queryKey: qk.config,
    queryFn: loadConfig,
    select: (config) => config.audioVisualizerEnabled,
  });
}

export function useRestoreAudioVisualizer() {
  const { data: enabled } = useAudioVisualizerPreference();
  const { status } = useAudioVisualizer();

  useEffect(() => {
    if (!enabled || status !== "idle" || !supportsAudioVisualizer()) return;

    // Chromium requires a user activation for display-media capture.
    const resume = (event: Event) => {
      if (!event.isTrusted || !navigator.userActivation?.isActive) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-audio-visualizer-control]")
      ) {
        return;
      }
      void startAudioVisualizer();
    };
    window.addEventListener("click", resume);
    window.addEventListener("keydown", resume);
    return () => {
      window.removeEventListener("click", resume);
      window.removeEventListener("keydown", resume);
    };
  }, [enabled, status]);
}

export function AudioSpectrum({
  analyser,
  viewport,
}: {
  analyser: AnalyserNode;
  viewport?: RefObject<HTMLDivElement>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const drawing = element?.getContext("2d");
    if (!element || !drawing) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const samples = new Float32Array(analyser.fftSize);
    const color = getComputedStyle(element).color;
    let frame = 0;
    let last = 0;
    let bandCount = 0;
    let edges: number[] = [];
    let lastAudible = Number.NEGATIVE_INFINITY;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 33) return;
      last = now;
      const { clientWidth: width, clientHeight: height } = element;
      if (width < 8 || height < 12) return;
      if (element.width !== width) element.width = width;
      if (element.height !== height) element.height = height;
      drawing.clearRect(0, 0, width, height);
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      if (energy >= samples.length * SILENCE_RMS ** 2) lastAudible = now;
      const silenceOpacity = Math.min(
        1,
        1 - (now - lastAudible - SILENCE_HOLD_MS) / SILENCE_FADE_MS,
      );
      element.toggleAttribute("data-audio-visible", silenceOpacity > 0);
      if (silenceOpacity <= 0) return;

      drawing.fillStyle = color;
      analyser.getByteFrequencyData(data);
      const rowHeight = MESSAGE_RAIL_ROW_HEIGHT;
      const offset = (viewport?.current?.scrollTop ?? 0) % rowHeight;
      const count = viewport
        ? Math.ceil(height / rowHeight) + 1
        : Math.min(44, Math.floor(height / 6));
      if (count !== bandCount) {
        bandCount = count;
        edges = spectrumBandEdges(analyser, count);
      }
      const bars = edges.length - 1;
      const stride = viewport ? rowHeight : height / bars;
      const restingWidth = viewport ? 6 : Math.min(4, width / 4);
      for (let i = 0; i < bars; i++) {
        let peak = 0;
        for (let bin = edges[i]; bin < edges[i + 1]; bin++) {
          peak = Math.max(peak, data[bin]);
        }
        const level = peak / 255;
        const center = (i + 0.5) * stride - offset;
        const position = Math.min(1, Math.max(0, center / height));
        const taper = viewport ? 0.32 + 0.68 * Math.sin(Math.PI * position) : 1;
        drawing.globalAlpha = (0.2 + 0.8 * level) * silenceOpacity;
        drawing.fillRect(
          0,
          Math.round(center - 1),
          (restingWidth + (width - 2 - restingWidth) * level) * taper,
          2,
        );
      }
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      element.removeAttribute("data-audio-visible");
    };
  }, [analyser, viewport]);
  return <canvas ref={canvas} className="block h-full w-full text-primary" />;
}

export function FunSettings() {
  const state = useAudioVisualizer();
  const { data: enabled } = useAudioVisualizerPreference();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (audioVisualizerEnabled: boolean) => patchConfig({ audioVisualizerEnabled }),
    onSuccess: (_result, audioVisualizerEnabled) => {
      if (!audioVisualizerEnabled) stopAudioVisualizer();
      queryClient.setQueryData<AppConfig>(qk.config, (config) =>
        config ? { ...config, audioVisualizerEnabled } : config,
      );
    },
    onError: (_error, audioVisualizerEnabled) => {
      if (audioVisualizerEnabled) stopAudioVisualizer();
    },
  });
  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 @xl:px-6 @xl:py-8">
      <h4 className="text-lg font-medium">Fun</h4>
      <section className="mt-6 rounded-lg border bg-card p-3.5">
        <div className="flex items-start gap-3">
          <AudioLines
            aria-hidden="true"
            size={18}
            className="mt-0.5 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <h5 className="text-sm font-medium">Audio visualizer</h5>
            <p className="mt-1 text-xs text-muted-foreground">
              Show the sound from your default audio output along the left edge of the chat.
            </p>
            {supportsAudioVisualizer() ? (
              <button
                type="button"
                data-audio-visualizer-control
                disabled={enabled === undefined || save.isPending}
                className="mt-3 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
                onClick={() => {
                  if (!enabled) void startAudioVisualizer();
                  save.mutate(!enabled);
                }}
              >
                {enabled ? "Stop visualizer" : "Start visualizer"}
              </button>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Available in the Windows desktop app.
              </p>
            )}
            {state.status === "starting" && (
              <output className="mt-2 block text-xs">Starting audio capture…</output>
            )}
            {state.status === "error" && (
              <output className="mt-2 block text-xs text-destructive">
                Couldn’t capture system audio.
              </output>
            )}
            {save.isError && (
              <output className="mt-2 block text-xs text-destructive">
                Couldn’t save the audio visualizer setting.
              </output>
            )}
          </div>
          {state.status === "active" && (
            <div className="h-20 w-7 shrink-0" title="Live audio preview">
              <AudioSpectrum analyser={state.analyser} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
