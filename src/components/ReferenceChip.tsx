import { Code2, FolderOpen, Hash, SlidersHorizontal, Tag } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StudioClassIcon } from "@/components/StudioClassIcon";
import type { ExplorerReferenceKind } from "@/lib/explorer";
import {
  type InstanceReference,
  loadLegacyInstanceClass,
  type MessageReferenceSource,
  rememberLegacyInstanceClass,
  splitInstanceReferences,
  validInstanceClassName,
} from "@/lib/instanceReferences";
import { cn } from "@/lib/utils";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import {
  explorerPlaceKey,
  useExplorerReferenceOptional,
} from "@/providers/ExplorerReferenceProvider";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";

const FIELD_STYLES = {
  property: {
    title: "Property",
    icon: SlidersHorizontal,
    className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  attribute: {
    title: "Attribute",
    icon: Tag,
    className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  tag: {
    title: "Tag on",
    icon: Hash,
    className: "border-pink-500/25 bg-pink-500/10 text-pink-700 dark:text-pink-300",
  },
} as const;

/** How a Studio reference looks in a message. A property, attribute or tag also says which it is. */
export function ReferenceChip({
  label,
  path,
  fieldKind,
  studioClassName,
  onClick,
  expanded,
  action,
  useLiveClass = true,
  className,
}: {
  label: string;
  path: string;
  fieldKind?: ExplorerReferenceKind;
  studioClassName?: string;
  onClick?: () => void;
  expanded?: boolean;
  action?: string;
  useLiveClass?: boolean;
  className?: string;
}) {
  const field = fieldKind ? FIELD_STYLES[fieldKind] : null;
  const explorer = useExplorerReferenceOptional();
  const object =
    explorer?.objectIndex.get(path) ?? explorer?.objectIndex.get(path.replace(/^game\./, ""));
  const instanceClass = studioClassName ?? (useLiveClass ? object?.className : undefined);
  const Chip = onClick ? "button" : "span";
  return (
    <Chip
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-expanded={expanded}
      aria-description={action}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline text-xs font-medium wrap-anywhere",
        field?.className ?? "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        onClick && "cursor-pointer text-left hover:border-current focus-visible:outline-ring",
        className,
      )}
      title={field ? `${field.title}${fieldKind === "tag" ? "" : " of"} ${path}` : path}
    >
      <StudioClassIcon className={instanceClass} size={14} />
      {field && <field.icon aria-hidden="true" size={11} className="shrink-0" />}
      {label.replace(/^@/, "")}
    </Chip>
  );
}

export function MessageReference({
  reference,
  action,
  source,
}: {
  reference: InstanceReference;
  action: "raw" | "explorer";
  source?: MessageReferenceSource;
}) {
  const explorer = useExplorerReferenceOptional();
  const studio = useStudioTargetOptional();
  const { activeSessionId } = useActiveSession();
  const { path, label, className, field, raw } = reference;
  const sessionID = source?.sessionID;
  const partID = source?.partID;
  const [learned, setLearned] = useState<
    | { sessionID: string; partID: string; path: string; place: string; className: string }
    | undefined
  >();
  const cached = useMemo(
    () =>
      learned &&
      learned.sessionID === sessionID &&
      learned.partID === partID &&
      learned.path === path
        ? learned
        : sessionID && partID && !className
          ? loadLegacyInstanceClass({ sessionID, partID }, path)
          : undefined,
    [sessionID, partID, path, className, learned],
  );
  const currentPlace = explorerPlaceKey(studio?.selected);
  const recordedPlace = explorerPlaceKey(sessionID ? studio?.recordedTarget?.(sessionID) : null);
  const knownPlace = cached?.place ?? recordedPlace;
  const matchingPlace = currentPlace && currentPlace === knownPlace;
  const currentClassedReference =
    className && !knownPlace && currentPlace && sessionID === activeSessionId;
  const candidate =
    !source || matchingPlace || currentClassedReference ? explorer?.objectIndex.get(path) : null;
  const object =
    candidate &&
    candidate.path.replace(/^game\./, "") === path.replace(/^game\./, "") &&
    (candidate.occurrences ?? 1) === 1
      ? candidate
      : null;
  const liveClass = validInstanceClassName(object?.className);
  useEffect(() => {
    if (sessionID && partID && !className && !cached && currentPlace && liveClass) {
      const entry = { place: currentPlace, className: liveClass };
      rememberLegacyInstanceClass({ sessionID, partID }, path, entry);
      setLearned({ sessionID, partID, path, ...entry });
    }
  }, [sessionID, partID, path, className, cached, currentPlace, liveClass]);

  const expectedClass = className ?? cached?.className;
  const canFocus = explorer && object && (!expectedClass || liveClass === expectedClass);
  const openExplorer = canFocus ? () => explorer.focusObject(object.path) : undefined;
  const [showRaw, setShowRaw] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const restoreFocus = useRef(false);
  const toggleRaw = () => {
    restoreFocus.current = wrapper.current?.contains(document.activeElement) ?? false;
    setShowRaw((shown) => !shown);
  };
  const opensExplorer = action === "explorer" && openExplorer !== undefined;
  const secondaryAction = opensExplorer ? toggleRaw : openExplorer;
  const secondaryLabel = opensExplorer ? "Show raw reference" : "Open in Explorer";
  const SecondaryIcon = opensExplorer ? Code2 : FolderOpen;
  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    wrapper.current
      ?.querySelector<HTMLButtonElement>(
        !showRaw && opensExplorer ? 'button[aria-label="Show raw reference"]' : "button",
      )
      ?.focus();
  }, [showRaw, opensExplorer]);
  return (
    <span ref={wrapper} className="inline">
      {showRaw ? (
        <button
          type="button"
          onClick={toggleRaw}
          title="Show reference chip"
          aria-expanded="true"
          className="cursor-pointer rounded bg-muted px-1 text-left font-mono text-xs whitespace-pre-wrap wrap-anywhere focus-visible:outline-ring"
        >
          {raw}
        </button>
      ) : (
        <>
          <ReferenceChip
            label={label}
            path={path}
            fieldKind={field?.kind}
            studioClassName={className ?? cached?.className ?? liveClass}
            useLiveClass={false}
            onClick={opensExplorer ? openExplorer : toggleRaw}
            expanded={opensExplorer ? undefined : false}
            action={opensExplorer ? "Open in Explorer" : "Show raw reference"}
          />
          {secondaryAction && (
            <button
              type="button"
              aria-label={secondaryLabel}
              aria-expanded={opensExplorer ? false : undefined}
              title={secondaryLabel}
              onClick={secondaryAction}
              className="inline-flex cursor-pointer rounded p-0.5 align-middle text-muted-foreground hover:text-foreground focus-visible:outline-ring"
            >
              <SecondaryIcon size={12} aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </span>
  );
}

/** Plain message text keeps its original whitespace while Studio references become inline chips. */
export function ReferenceText({
  text,
  focusable,
  source,
}: {
  text: string;
  focusable?: boolean;
  source?: MessageReferenceSource;
}) {
  return splitInstanceReferences(text).map((part, index) =>
    part.type === "instance" ? (
      focusable ? (
        <MessageReference key={index} reference={part} action="raw" source={source} />
      ) : (
        <ReferenceChip
          key={index}
          label={part.label}
          path={part.path}
          fieldKind={part.field?.kind}
          studioClassName={part.className}
        />
      )
    ) : (
      part.value
    ),
  );
}
