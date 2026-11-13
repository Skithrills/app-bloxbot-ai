import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import PanelResizeHandle from "@/components/PanelResizeHandle";

function Panel({ edge }: { edge: "left" | "right" }) {
  const [width, setWidth] = useState(280);
  return (
    <div>
      <div id="panel" />
      <PanelResizeHandle
        label="Resize test panel"
        controls="panel"
        edge={edge}
        width={width}
        min={220}
        max={400}
        onResize={setWidth}
      />
    </div>
  );
}

describe("PanelResizeHandle", () => {
  it.each([
    ["left", 296],
    ["right", 264],
  ] as const)("uses arrow keys on the %s edge and clamps to the bounds", (edge, afterLeft) => {
    render(<Panel edge={edge} />);
    const handle = screen.getByRole("separator", { name: "Resize test panel" });
    expect(handle).toHaveAttribute("aria-controls", "panel");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", String(afterLeft));
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "280");
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: edge === "left" ? "ArrowRight" : "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "220");
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.keyDown(handle, { key: edge === "left" ? "ArrowLeft" : "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "400");
  });

  it("captures the drag pointer and stops resizing when the drag is canceled", () => {
    render(<Panel edge="left" />);
    const handle = screen.getByRole("separator", { name: "Resize test panel" });
    const capture = vi.fn();
    handle.setPointerCapture = capture;
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300 });
    expect(capture).toHaveBeenCalledWith(1);
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 220 });
    expect(handle).toHaveAttribute("aria-valuenow", "280");
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 250 });
    expect(handle).toHaveAttribute("aria-valuenow", "330");
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 });
    expect(handle).toHaveAttribute("aria-valuenow", "330");
  });
});
