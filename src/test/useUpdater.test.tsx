import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  install: vi.fn(),
  message: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/desktop", () => ({
  desktop: { checkForUpdate: mocks.check, installUpdate: mocks.install },
}));
vi.mock("@/lib/notifications", () => ({
  notify: { message: mocks.message, error: mocks.error },
}));

import { UpdateButton } from "@/components/UpdateButton";
import { qk } from "@/lib/queryKeys";

const available = {
  status: "available",
  update: { version: "0.15.5", body: null },
};

function renderUpdateButton() {
  const client = new QueryClient();
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <UpdateButton />
      </QueryClientProvider>
    </StrictMode>,
  );
  return { client, ...view };
}

describe("titlebar app update", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.check.mockResolvedValue(available);
    mocks.install.mockResolvedValue(undefined);
  });

  it("checks once, then only installs after the button is clicked", async () => {
    renderUpdateButton();

    const button = await screen.findByRole("button", {
      name: "Download and install BloxBot 0.15.5",
    });
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.message).toHaveBeenCalledOnce();
    expect(mocks.install).not.toHaveBeenCalled();

    const toastAction = mocks.message.mock.calls[0][1].action;
    act(() => {
      fireEvent.click(button);
      toastAction.onClick();
      fireEvent.click(button);
    });

    const installing = await screen.findByRole("button", { name: "Installing BloxBot 0.15.5" });
    expect(installing).toBeDisabled();
    expect(installing).toHaveAttribute("aria-busy", "true");
    expect(mocks.install).toHaveBeenCalledOnce();
  });

  it.each([
    { status: "no-releases" },
    { status: "up-to-date", version: "0.15.4" },
  ])("keeps the titlebar clear for a $status result", async (status) => {
    mocks.check.mockResolvedValue(status);
    const { client } = renderUpdateButton();
    await waitFor(() => expect(client.getQueryData(qk.appUpdate)).toEqual(status));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("lets the user retry a failed download", async () => {
    mocks.install.mockRejectedValueOnce(new Error("Could not download the BloxBot update."));
    renderUpdateButton();
    fireEvent.click(await screen.findByRole("button", { name: /Download and install/ }));
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("Update failed", {
        description: "Could not download the BloxBot update.",
      }),
    );
    const retry = screen.getByRole("button", { name: /Download and install/ });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.install).toHaveBeenCalledTimes(2));
  });

  it("does not notify when a check completes after unmount", async () => {
    let finishCheck!: (result: typeof available) => void;
    mocks.check.mockReturnValue(
      new Promise((resolve) => {
        finishCheck = resolve;
      }),
    );
    const { client, unmount } = renderUpdateButton();
    unmount();

    await act(async () => finishCheck(available));
    await waitFor(() => expect(client.getQueryData(qk.appUpdate)).toEqual(available));
    expect(mocks.message).not.toHaveBeenCalled();
  });
});
