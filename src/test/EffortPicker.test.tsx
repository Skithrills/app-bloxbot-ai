import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EffortPicker } from "@/components/EffortPicker";
import type { EffortControl } from "@/types/desktop";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPicker(variants: string[], control?: EffortControl, fastAvailable = false) {
  const onChange = vi.fn();
  function ControlledPicker() {
    const [value, setValue] = useState<string | null>(null);
    const [fast, setFast] = useState(false);
    return (
      <EffortPicker
        variants={variants}
        value={value}
        control={control}
        fast={fastAvailable ? { enabled: fast, onToggle: () => setFast(!fast) } : undefined}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<ControlledPicker />);
  return onChange;
}

function openDragSlider() {
  const onChange = renderPicker(["none", "low", "high", "max"]);
  fireEvent.click(screen.getByRole("button", { name: "Auto effort" }));
  const slider = screen.getByRole("slider");
  const track = slider.parentElement;
  const travel = track?.querySelector(".effort-slider-travel");
  const thumb = track?.querySelector(".effort-slider-thumb");
  if (!track || !travel || !thumb) throw new Error("Slider track did not render");
  vi.spyOn(travel, "getBoundingClientRect").mockReturnValue(new DOMRect(30, 0, 200, 32));
  vi.spyOn(thumb, "getBoundingClientRect").mockReturnValue(new DOMRect(16.5, 0, 27, 32));
  const capture = vi.fn();
  const release = vi.fn();
  Object.assign(track, {
    setPointerCapture: capture,
    hasPointerCapture: () => true,
    releasePointerCapture: release,
  });
  return { onChange, slider, track, capture, release };
}

describe("composer reasoning effort picker", () => {
  it("uses supported effort order and commits exact variant IDs from the range input", async () => {
    const onChange = renderPicker(["ultracode", "xhigh", "off", "medium", "low", "max"]);
    const trigger = screen.getByRole("button", { name: "Auto effort" });
    fireEvent.click(trigger);

    const slider = screen.getByRole("slider", { name: "Reasoning effort" });
    await waitFor(() => expect(slider).toHaveFocus());
    expect(slider).toHaveAttribute("aria-valuetext", "Auto");
    for (const [index, [id, label]] of [
      ["off", "No"],
      ["low", "Low"],
      ["medium", "Medium"],
      ["xhigh", "Extra high"],
      ["max", "Max"],
      ["ultracode", "Ultracode"],
    ].entries()) {
      fireEvent.change(slider, { target: { value: String(index + 1) } });
      expect(onChange).toHaveBeenLastCalledWith(id);
      expect(slider).toHaveAttribute("aria-valuetext", label);
      // Only the top stop of this model's slider takes the accent colour.
      expect(screen.getByText(label, { exact: true })).toHaveClass(
        id === "ultracode" ? "effort-peak-label" : "text-foreground",
      );
    }
    expect(slider.parentElement).toHaveAttribute("data-highest");
    fireEvent.change(slider, { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(slider.parentElement).not.toHaveAttribute("data-highest");
    fireEvent.keyDown(slider, { key: "Escape" });
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("skips unsupported effort stops and keeps provider-specific variants selectable", () => {
    const onChange = renderPicker(["high", "custom-budget", "low"]);
    fireEvent.click(screen.getByRole("button", { name: "Auto effort" }));
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("max", "2");
    expect(screen.queryByText("No")).not.toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "2" } });
    expect(onChange).toHaveBeenLastCalledWith("high");
    fireEvent.click(screen.getByRole("button", { name: "custom-budget" }));
    expect(onChange).toHaveBeenLastCalledWith("custom-budget");
    fireEvent.click(screen.getByRole("button", { name: "Use model default" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("snaps to the nearest stop during a drag and commits it on release", () => {
    const { onChange, slider, track, capture, release } = openDragSlider();
    fireEvent.pointerDown(track, { pointerId: 1, clientX: 40 });
    expect(capture).toHaveBeenCalledWith(1);
    expect(track.style.getPropertyValue("--effort-progress")).toBe("0");

    fireEvent.pointerMove(track, { pointerId: 1, clientX: 126 });
    expect(track.style.getPropertyValue("--effort-progress")).toBe("0.5");
    expect(slider).toHaveAttribute("aria-valuetext", "Low");
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 110 });
    expect(track.style.getPropertyValue("--effort-progress")).toBe("0.25");
    expect(slider).toHaveAttribute("aria-valuetext", "No");
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 116 });
    expect(track.style.getPropertyValue("--effort-progress")).toBe("0.5");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(track, { pointerId: 1, clientX: 116 });
    expect(release).toHaveBeenCalledWith(1);
    expect(track).not.toHaveAttribute("data-dragging");
    expect(track.style.getPropertyValue("--effort-progress")).toBe("0.5");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("low");
  });

  it("fills the Fast icon and animates the gradient only at the highest stop", () => {
    renderPicker(["low", "max"], "slider", true);
    fireEvent.click(screen.getByRole("button", { name: "Auto effort" }));
    const button = screen.getByRole("button", { name: "Fast mode", pressed: false });
    const slider = screen.getByRole("slider");
    const track = slider.parentElement;
    expect(button.querySelector("svg")).toHaveAttribute("fill", "none");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button.querySelector("svg")).toHaveAttribute("fill", "currentColor");
    expect(track).not.toHaveAttribute("data-highest");
    expect(track).not.toHaveAttribute("data-fast");

    fireEvent.change(slider, { target: { value: "2" } });
    expect(track).toHaveAttribute("data-fast");
    fireEvent.click(button);
    expect(track).toHaveAttribute("data-highest");
    expect(track).not.toHaveAttribute("data-fast");
  });

  it("gives Max the accent label and pixels when it is the model's top stop", () => {
    renderPicker(["low", "high", "max"]);
    fireEvent.click(screen.getByRole("button", { name: "Auto effort" }));
    const slider = screen.getByRole("slider");
    const track = slider.parentElement;
    expect(track?.querySelectorAll(".effort-slider-pixel").length).toBeGreaterThan(20);

    fireEvent.change(slider, { target: { value: "2" } });
    expect(screen.getByText("High")).toHaveClass("text-foreground");
    expect(track).not.toHaveAttribute("data-highest");

    fireEvent.change(slider, { target: { value: "3" } });
    expect(screen.getByText("Max")).toHaveClass("effort-peak-label");
    expect(track).toHaveAttribute("data-highest");
  });

  it("slides the selected label in the direction of the effort change", () => {
    renderPicker(["low", "max"]);
    fireEvent.click(screen.getByRole("button", { name: "Auto effort" }));
    const slider = screen.getByRole("slider");
    const label = screen.getByText("Auto").parentElement;
    expect(label).not.toHaveAttribute("data-direction");

    fireEvent.change(slider, { target: { value: "2" } });
    expect(label).toHaveAttribute("data-direction", "up");
    const outgoing = screen.getByText("Auto");
    expect(outgoing).toHaveAttribute("aria-hidden", "true");

    fireEvent.change(slider, { target: { value: "0" } });
    expect(label).toHaveAttribute("data-direction", "down");
    expect(screen.getByText("Max")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Auto")).not.toHaveAttribute("aria-hidden");
  });

  it("ignores other pointers and restores the selected level after a canceled drag", () => {
    const { onChange, slider, track, capture } = openDragSlider();
    fireEvent.pointerDown(track, { pointerId: 1, clientX: 200 });
    fireEvent.pointerDown(track, { pointerId: 2, clientX: 50 });
    fireEvent.pointerMove(track, { pointerId: 2, clientX: 50 });
    fireEvent.pointerUp(track, { pointerId: 2, clientX: 50 });
    expect(capture).toHaveBeenCalledExactlyOnceWith(1);
    expect(slider).toHaveAttribute("aria-valuetext", "High");

    fireEvent.pointerCancel(track, { pointerId: 1 });
    expect(slider).toHaveAttribute("aria-valuetext", "Auto");
    expect(track).not.toHaveAttribute("data-dragging");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(track, { pointerId: 3, clientX: 225 });
    fireEvent.pointerUp(track, { pointerId: 3, clientX: 225 });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("max");
  });

  it("offers Fast mode as a pill switch in the dropdown only, without closing it", () => {
    renderPicker(["low", "max"], "dropdown", true);
    fireEvent.click(screen.getByRole("button", { name: "Auto effort" }));
    expect(screen.queryByRole("button", { name: "Fast mode" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Fast mode", checked: false }));
    expect(screen.getByRole("switch", { name: "Fast mode", checked: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Max" })).toBeInTheDocument();
  });

  it("keeps the original dropdown behavior when selected", () => {
    const onChange = renderPicker(["none", "medium", "max"], "dropdown");
    fireEvent.click(screen.getByRole("button", { name: "Auto effort" }));
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto", pressed: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onChange).toHaveBeenLastCalledWith("none");
    expect(screen.getByRole("button", { name: "No effort", expanded: false })).toBeInTheDocument();
  });

  it("hides the control for models without effort variants", () => {
    renderPicker([]);
    expect(screen.queryByRole("button", { name: /effort/ })).not.toBeInTheDocument();
  });
});
