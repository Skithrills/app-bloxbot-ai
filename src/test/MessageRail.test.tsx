import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MESSAGE_RAIL_ROW_HEIGHT, MessageRail } from "@/components/MessageRail";
import { clearMessageFavorites } from "@/lib/messageFavorites";

const entries = [
  {
    id: "first",
    label: "You",
    preview: "Build a new stage",
    reply: "I built the stage.",
    index: 0,
  },
  { id: "second", label: "You", preview: "Add a start area", index: 2 },
];

afterEach(() => {
  vi.useRealTimers();
  clearMessageFavorites("session-a");
  clearMessageFavorites("session-b");
});

describe("MessageRail", () => {
  it("shows the prompt and reply together in one marker preview", () => {
    render(<MessageRail entries={entries} sessionId="session-a" onJump={vi.fn()} />);
    const markers = screen.getAllByRole("button", { name: /from You/ });
    expect(markers).toHaveLength(2);
    fireEvent.pointerOver(markers[0], { pointerType: "mouse" });
    expect(screen.getByRole("button", { name: "Jump to message 1" })).toHaveTextContent(
      /Build a new stage.*I built the stage/,
    );
  });

  it("renders the preview card as compact, non-interactive markdown", () => {
    const formatted = [
      {
        id: "md",
        label: "You",
        preview: "Make **bold** and `code`",
        reply: "- one\n- two\n\n```lua\nprint(1)\n```\n\nSee [docs](https://example.com)",
        index: 0,
      },
    ];
    render(<MessageRail entries={formatted} sessionId="session-a" onJump={vi.fn()} />);
    fireEvent.pointerOver(screen.getByRole("button", { name: /from You/ }), {
      pointerType: "mouse",
    });
    const jump = screen.getByRole("button", { name: "Jump to message 1" });
    expect(jump.querySelector(".md-preview-code")).toHaveTextContent("code");
    expect(jump.querySelector("strong")).toHaveTextContent("bold");
    expect(jump.querySelectorAll(".md-preview-item")).toHaveLength(2);
    expect(jump.querySelector(".md-preview-pre")).toHaveTextContent("print(1)");
    expect(jump.querySelector(".md-preview-link")).toHaveTextContent("docs");
    expect(jump.querySelector("a, p, ul, pre, div")).toBeNull();
    expect(jump.textContent).not.toContain("**");
  });

  it("scrolls through a long rail while mounting only a small marker window", () => {
    const many = Array.from({ length: 500 }, (_, index) => ({
      id: String(index),
      label: "You",
      preview: String(index),
      index,
    }));
    render(<MessageRail entries={many} sessionId="session-a" onJump={vi.fn()} />);
    const first = screen.getByRole("button", { name: "Message 1 from You" });
    const viewport = first.closest(".message-rail-viewport");
    if (!viewport) throw new Error("Message rail viewport is missing");
    expect(screen.getAllByRole("button", { name: /from You/ }).length).toBeLessThanOrEqual(31);
    fireEvent.scroll(viewport, { target: { scrollTop: 300 * MESSAGE_RAIL_ROW_HEIGHT } });
    expect(screen.getByRole("button", { name: "Message 301 from You" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /from You/ }).length).toBeLessThanOrEqual(31);
    expect(screen.queryByRole("button", { name: "Message 1 from You" })).toBeNull();
  });

  it("highlights a reply's marker and bumps the marks around the preview", () => {
    const onJump = vi.fn();
    const { rerender } = render(
      <MessageRail
        entries={entries}
        sessionId="session-a"
        onJump={onJump}
        visibleRange={{ startIndex: 1, endIndex: 1 }}
      />,
    );
    const first = screen.getByRole("button", { name: "Message 1 from You" });
    const second = screen.getByRole("button", { name: "Message 2 from You" });
    expect(first).toHaveAttribute("data-visible", "true");
    expect(second).not.toHaveAttribute("data-visible");
    fireEvent.pointerOver(second, { pointerType: "mouse" });
    expect(second).toHaveAttribute("data-bump", "0");
    expect(first).toHaveAttribute("data-bump", "1");

    rerender(
      <MessageRail
        entries={entries}
        sessionId="session-a"
        onJump={onJump}
        visibleRange={{ startIndex: 2, endIndex: 2 }}
      />,
    );
    expect(first).not.toHaveAttribute("data-visible");
    expect(second).toHaveAttribute("data-visible", "true");
  });

  it("keeps the card open on pointer entry and restores a favorite only for its chat", () => {
    vi.useFakeTimers();
    const onJump = vi.fn();
    const { rerender } = render(
      <MessageRail entries={entries} sessionId="session-a" onJump={onJump} />,
    );

    const marker = screen.getByRole("button", { name: "Message 2 from You" });
    fireEvent.pointerOver(marker, { pointerType: "mouse" });
    const favorite = screen.getByRole("button", { name: "Favorite message" });
    fireEvent.pointerOut(marker, { pointerType: "mouse", relatedTarget: favorite });
    act(() => vi.advanceTimersByTime(200));
    expect(favorite).toBeVisible();
    fireEvent.click(favorite);
    expect(favorite).toHaveAttribute("aria-pressed", "true");
    expect(marker).toHaveAttribute("data-favorite", "true");
    expect(onJump).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Jump to message 2" }));
    expect(onJump).toHaveBeenCalledExactlyOnceWith(2);

    rerender(<MessageRail entries={entries} sessionId="session-b" onJump={onJump} />);
    expect(screen.getByRole("button", { name: "Message 2 from You" })).not.toHaveAttribute(
      "data-favorite",
    );
    expect(screen.queryByRole("button", { name: "Favorite message" })).toBeNull();

    rerender(<MessageRail entries={entries} sessionId="session-a" onJump={onJump} />);
    expect(screen.getByRole("button", { name: "Message 2 from You, favorited" })).toHaveAttribute(
      "data-favorite",
      "true",
    );
  });

  it("uses one rail tab stop, opens a keyboard preview and returns focus on Escape", () => {
    render(<MessageRail entries={entries} sessionId="session-a" onJump={vi.fn()} />);
    const first = screen.getByRole("button", { name: "Message 1 from You" });
    const second = screen.getByRole("button", { name: "Message 2 from You" });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    expect(first).toHaveAttribute("tabindex", "-1");
    expect(second).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Add a start area")).toBeVisible();

    const favorite = screen.getByRole("button", { name: "Favorite message" });
    act(() => favorite.focus());
    fireEvent.keyDown(favorite, { key: "Escape" });
    expect(second).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Favorite message" })).toBeNull();
  });
});
