import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageText } from "@/components/ChatMessages";
import { ReferenceText } from "@/components/ReferenceChip";
import {
  instanceReferenceLabels,
  serializeInstanceReference,
  splitInstanceReferences,
} from "@/lib/instanceReferences";
import {
  ExplorerReferenceProvider,
  useExplorerReference,
} from "@/providers/ExplorerReferenceProvider";
import type { StudioTarget } from "@/types/studioTarget";

const explorer = vi.hoisted(() => ({
  objects: [] as import("@/lib/explorer").ExplorerNode[],
  studio: {
    selected: null as StudioTarget | null,
    recordedTarget: vi.fn<(sessionID: string) => StudioTarget | undefined>(),
  },
}));
vi.mock("@/hooks/useExplorerTreeSync", () => ({
  useExplorerTreeSync: () => ({ objects: explorer.objects }),
}));
vi.mock("@/providers/StudioTargetProvider", () => ({
  useStudioTargetOptional: () => explorer.studio,
}));

const object = {
  name: "AnimalDiscoSession",
  path: "game.Workspace.AnimalDiscoSession",
  className: "Model",
  hasChildren: false,
  children: [],
};
const legacy = '<Instance reference="Workspace.AnimalDiscoSession">@AnimalDiscoSession</Instance>';
const place = { key: "studio", placeId: "101", label: "Disco", detail: null };
const otherPlace = { ...place, key: "other", placeId: "102" };

function FocusedPath() {
  const { focusRequest } = useExplorerReference();
  return <span>{focusRequest}</span>;
}

describe("references in a sent message", () => {
  beforeEach(() => {
    explorer.objects = [];
    explorer.studio.selected = null;
    explorer.studio.recordedTarget.mockReset();
    localStorage.clear();
  });

  it("decodes escaped paths and field labels without interpreting them as HTML", () => {
    render(
      <ExplorerReferenceProvider>
        <ReferenceText
          text={
            'See <Instance reference="game.Workspace.A &amp; B &quot;quoted&quot;" tag="a&lt;b">@A &amp; B.a&lt;b &amp;lt;</Instance>'
          }
        />
      </ExplorerReferenceProvider>,
    );

    expect(screen.getByText("A & B.a<b &lt;")).toHaveAttribute(
      "title",
      'Tag on game.Workspace.A & B "quoted"',
    );
  });

  it("tells objects, properties and attributes apart", () => {
    render(
      <ExplorerReferenceProvider>
        <MessageText
          text={
            'Check <Instance reference="game.Workspace.Part">@Part</Instance> ' +
            '<Instance reference="game.Workspace.Part" property="Anchored">@Part.Anchored</Instance> ' +
            '<Instance reference="game.Workspace.Part" attribute="Team">@Part.Team</Instance> ' +
            '<Instance reference="game.Workspace.Part" tag="Enemy">@Part.Enemy</Instance>'
          }
        />
      </ExplorerReferenceProvider>,
    );

    expect(screen.getByText("Part")).toHaveAttribute("title", "game.Workspace.Part");
    expect(screen.getByText("Part.Anchored")).toHaveAttribute(
      "title",
      "Property of game.Workspace.Part",
    );
    expect(screen.getByText("Part.Team")).toHaveAttribute(
      "title",
      "Attribute of game.Workspace.Part",
    );
    expect(screen.getByText("Part.Enemy")).toHaveAttribute("title", "Tag on game.Workspace.Part");
    expect(screen.queryByText(/<Instance/)).not.toBeInTheDocument();
  });

  it("keeps assistant instance chips inline with all Markdown table rows", () => {
    const references = ["MCPTest", "TestPart", "TestScript"].map((name) =>
      serializeInstanceReference({ path: `game.Workspace.${name}`, label: name }),
    );
    render(
      <ExplorerReferenceProvider>
        <MessageText
          text={[
            "| Call | Result |",
            "| --- | --- |",
            `| \`search_game_tree\` | Returned **${references[0]}**, ${references[1]}, and ${references[2]} |`,
            "| `inspect_instance` | Inspected properties |",
            "",
            "Done.",
          ].join("\n")}
        />
      </ExplorerReferenceProvider>,
    );

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(3);
    const [call, result] = within(rows[1]).getAllByRole("cell");
    expect(call).toHaveTextContent("search_game_tree");
    expect(result).toHaveTextContent("Returned MCPTest, TestPart, and TestScript");
    expect(
      within(result).getByRole("button", { name: "MCPTest" }).closest("strong"),
    ).not.toBeNull();
    const chip = within(result).getByRole("button", { name: "TestPart" });
    fireEvent.click(chip);
    expect(within(result).getByRole("button", { expanded: true }).textContent).toBe(references[1]);
    expect(rows[2]).toHaveTextContent("inspect_instance");
    expect(rows[2]).toHaveTextContent("Inspected properties");
    expect(screen.getByText("Done.")).toBeVisible();
  });

  it("keeps literal reference markup in inline and fenced code", () => {
    const { container } = render(
      <ExplorerReferenceProvider>
        <MessageText text={[`Inline: \`${legacy}\``, "", "```", legacy, "```"].join("\n")} />
      </ExplorerReferenceProvider>,
    );

    expect(screen.queryByRole("button", { name: object.name })).not.toBeInTheDocument();
    expect(container.querySelector("code")).toHaveTextContent(legacy);
    expect(container.querySelector("pre code")).toHaveTextContent(legacy);
  });

  it("restores the icon and exact markup from stored text without Studio", () => {
    const raw = serializeInstanceReference({
      path: 'game.Workspace.A & B "quoted" < >',
      className: "Model",
      label: "@A & B.a<b> &lt;",
      field: { kind: "tag", name: 'a<b> "name"' },
    });
    const stored: string = JSON.parse(JSON.stringify(raw));
    expect(stored).toBe(
      '<Instance reference="game.Workspace.A &amp; B &quot;quoted&quot; &lt; &gt;" class="Model" tag="a&lt;b&gt; &quot;name&quot;">@A &amp; B.a&lt;b&gt; &amp;lt;</Instance>',
    );
    expect(splitInstanceReferences(stored)).toMatchObject([
      { field: { kind: "tag", name: 'a<b> "name"' } },
    ]);
    expect(instanceReferenceLabels(stored)).toBe("A & B.a<b> &lt;");
    render(<ReferenceText text={stored} focusable />);

    const chip = screen.getByRole("button", { name: "A & B.a<b> &lt;" });
    expect(chip.querySelector("img")).toHaveAttribute("src", "bloxbot-icon://studio/light/Model");
    chip.focus();
    fireEvent.click(chip);
    const markup = screen.getByRole("button", { expanded: true });
    expect(markup.textContent).toBe(raw);
    expect(markup).toHaveFocus();
    fireEvent.click(markup);
    expect(screen.getByRole("button", { name: "A & B.a<b> &lt;" })).toHaveFocus();
  });

  it("opens a resolved assistant reference and exposes its raw markup separately", () => {
    explorer.objects = [object];
    explorer.studio.selected = place;
    explorer.studio.recordedTarget.mockReturnValue(place);
    const raw =
      '<Instance class="Model" reference="game.Workspace.AnimalDiscoSession">@AnimalDiscoSession</Instance>';
    render(
      <ExplorerReferenceProvider>
        <MessageText text={raw} source={{ sessionID: "s1", partID: "assistant" }} />
        <FocusedPath />
      </ExplorerReferenceProvider>,
    );

    const chip = screen.getByRole("button", { name: "AnimalDiscoSession" });
    expect(chip).toHaveAttribute("title", object.path);
    const image = chip.querySelector("img");
    expect(image).toHaveAttribute("src", "bloxbot-icon://studio/light/Model");
    fireEvent.click(chip);
    expect(screen.getByText(object.path)).toBeInTheDocument();
    if (!image) throw new Error("Missing Studio class icon");
    fireEvent.error(image);
    expect(chip.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const reveal = screen.getByRole("button", { name: "Show raw reference" });
    reveal.focus();
    fireEvent.click(reveal);
    const markup = screen.getByRole("button", { expanded: true });
    expect(markup.textContent).toBe(raw);
    expect(markup).toHaveFocus();
    fireEvent.click(markup);
    expect(screen.getByRole("button", { name: "Show raw reference" })).toHaveFocus();
  });

  it("keeps a legacy icon after Studio closes and isolates other transcripts and parts", () => {
    explorer.objects = [object];
    explorer.studio.selected = place;
    explorer.studio.recordedTarget.mockImplementation((sessionID) =>
      sessionID === "s1" ? place : otherPlace,
    );
    const view = (sessionID: string, partID: string) => (
      <ExplorerReferenceProvider>
        <ReferenceText text={legacy} focusable source={{ sessionID, partID }} />
      </ExplorerReferenceProvider>
    );
    const icon = () => screen.getByRole("button", { name: object.name }).querySelector("img");
    const mounted = render(view("s1", "part"));
    expect(icon()).toHaveAttribute("src", "bloxbot-icon://studio/light/Model");

    explorer.studio.selected = null;
    explorer.objects = [];
    mounted.rerender(view("s1", "part"));
    expect(icon()).toHaveAttribute("src", "bloxbot-icon://studio/light/Model");
    mounted.unmount();
    const reopened = render(view("s1", "part"));
    expect(icon()).toHaveAttribute("src", "bloxbot-icon://studio/light/Model");
    reopened.rerender(view("s1", "different-part"));
    expect(icon()).toHaveAttribute("src", "bloxbot-icon://studio/light/Placeholder");

    explorer.studio.selected = place;
    explorer.objects = [object];
    reopened.rerender(view("subagent", "part"));
    expect(icon()).toHaveAttribute("src", "bloxbot-icon://studio/light/Placeholder");

    explorer.studio.selected = otherPlace;
    explorer.objects = [{ ...object, className: "Folder" }];
    reopened.rerender(view("s1", "part"));
    expect(icon()).toHaveAttribute("src", "bloxbot-icon://studio/light/Model");
    expect(screen.queryByRole("button", { name: "Open in Explorer" })).not.toBeInTheDocument();
  });

  it("does not use invalid class metadata or an ambiguous path", () => {
    explorer.studio.selected = place;
    explorer.studio.recordedTarget.mockReturnValue(place);
    explorer.objects = [{ ...object, occurrences: 2 }];
    render(
      <ExplorerReferenceProvider>
        <MessageText
          text={legacy.replace("reference=", 'class="bad/../Model" reference=')}
          source={{ sessionID: "s1", partID: "ambiguous" }}
        />
      </ExplorerReferenceProvider>,
    );
    const chip = screen.getByRole("button", { name: object.name });
    expect(chip.querySelector("img")).toHaveAttribute(
      "src",
      "bloxbot-icon://studio/light/Placeholder",
    );
    expect(screen.queryByRole("button", { name: "Open in Explorer" })).not.toBeInTheDocument();
  });
});
