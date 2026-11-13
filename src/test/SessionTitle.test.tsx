import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SessionTitle from "@/components/SessionTitle";
import { useSessions } from "@/hooks/useSessions";
import { notify } from "@/lib/notifications";
import { qk } from "@/lib/queryKeys";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";

const session = { id: "session-1", title: "Original title" };

function CachedSessionTitle() {
  const { data } = useSessions();
  return <SessionTitle sessionId={session.id} title={data?.[0]?.title ?? null} />;
}

function renderTitle() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(qk.sessions, [session]);
  const update = vi.fn(async ({ title }: { title: string }) => ({ data: { ...session, title } }));

  render(
    <QueryClientProvider client={queryClient}>
      <OpenCodeClientContext.Provider
        value={{
          client: { session: { update } } as never,
          ready: true,
          status: "ready",
          port: 4096,
          initError: null,
        }}
      >
        <CachedSessionTitle />
      </OpenCodeClientContext.Provider>
    </QueryClientProvider>,
  );

  return { queryClient, update };
}

function editTitle() {
  fireEvent.click(screen.getByTitle("Rename chat"));
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Chat title" });
}

describe("SessionTitle", () => {
  it("focuses the existing title and saves a trimmed title on Enter", async () => {
    const { queryClient, update } = renderTitle();
    const input = editTitle();

    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(session.title.length);
    fireEvent.change(input, { target: { value: "  Updated title  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("button", { name: "Updated title" })).toHaveFocus();
    await waitFor(() => {
      expect(queryClient.getQueryData(qk.sessions)).toEqual([
        { ...session, title: "Updated title" },
      ]);
    });
    expect(update).toHaveBeenCalledExactlyOnceWith(
      { sessionID: session.id, title: "Updated title" },
      { throwOnError: true },
    );
  });

  it("cancels on Escape, skips blank titles, and saves changes on blur", async () => {
    const { queryClient, update } = renderTitle();

    let input = editTitle();
    fireEvent.change(input, { target: { value: "Discard this" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("button", { name: session.title })).toHaveFocus();

    input = editTitle();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: session.title })).toBeVisible();
    expect(update).not.toHaveBeenCalled();

    input = editTitle();
    fireEvent.change(input, { target: { value: "Saved on blur" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(queryClient.getQueryData(qk.sessions)).toEqual([
        { ...session, title: "Saved on blur" },
      ]);
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("restores the previous title and reports a rejected rename", async () => {
    const error = vi.spyOn(notify, "error");
    try {
      const { queryClient, update } = renderTitle();
      update.mockRejectedValueOnce(new Error("Update failed"));
      const input = editTitle();
      fireEvent.change(input, { target: { value: "Rejected title" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(await screen.findByRole("button", { name: session.title })).toBeVisible();
      expect(queryClient.getQueryData(qk.sessions)).toEqual([session]);
      expect(error).toHaveBeenCalledWith("Could not rename chat.");
    } finally {
      error.mockRestore();
    }
  });
});
