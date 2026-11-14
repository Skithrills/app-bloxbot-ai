import { ChevronDown, Copy, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { type ResolvedTheme, useTheme } from "@/components/theme-provider";
import { BUILT_IN_THEMES, type BuiltInTheme } from "@/lib/builtInThemes";
import {
  type CustomTheme,
  createCustomTheme,
  decodeTheme,
  encodeTheme,
  isThemeColor,
  THEME_CODE_FONTS,
  THEME_COLOR_GROUPS,
  THEME_FONT_SCALE_MAX,
  THEME_FONT_SCALE_MIN,
  THEME_LIBRARY_MAX,
  THEME_NAME_MAX,
  THEME_RADIUS_MAX,
  THEME_RADIUS_MIN,
  THEME_SHARE_MAX_LENGTH,
  THEME_UI_FONTS,
  type ThemeColorKey,
  type ThemeLibrary,
  type ThemePalette,
} from "@/types/customTheme";

const surface =
  "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const divider = "border-zinc-200 dark:border-zinc-700";
const muted = "text-zinc-600 dark:text-zinc-400";
const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400";
const input = `min-w-0 rounded-[6px] border ${surface} ${focus} disabled:opacity-50`;
const control = `${input} px-2.5 py-1.5 text-sm`;
const buttonStyle = `inline-flex items-center justify-center rounded-[6px] border text-xs font-medium ${surface} ${focus} hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50`;
const button = `${buttonStyle} min-h-8 gap-1.5 px-2.5 py-1.5`;
const primaryButton = `inline-flex min-h-8 items-center justify-center rounded-[6px] bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white ${focus} hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white disabled:opacity-50`;
const appearances = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

type ColorInputs = Record<ResolvedTheme, ThemePalette>;

export default function ThemeEditor() {
  const {
    defaultAccent,
    appearanceTheme,
    builtInPreview,
    resolvedTheme,
    themeLibrary,
    themeLibraryReady,
    saveThemeLibrary,
    previewTheme,
  } = useTheme();
  const [copyAppearance, setCopyAppearance] = useState<ResolvedTheme>();
  const [draft, setDraft] = useState<CustomTheme | null>(null);
  const [colorInputs, setColorInputs] = useState<ColorInputs>({ light: {}, dark: {} });
  const [mode, setMode] = useState<ResolvedTheme>(resolvedTheme);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [transfer, setTransfer] = useState<"import" | "export" | null>(null);
  const [json, setJson] = useState("");
  const [copied, setCopied] = useState(false);
  const headingId = useId();
  const jsonId = useId();
  const jsonField = useRef<HTMLTextAreaElement>(null);
  const themeSelect = useRef<HTMLSelectElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);
  const activeTheme = themeLibrary.themes.find(({ id }) => id === themeLibrary.activeId);
  const activeBuiltIn = BUILT_IN_THEMES.find(({ id }) => id === themeLibrary.activeBuiltInId);
  const selectedBuiltIn = builtInPreview ?? activeBuiltIn;
  const selectedId = themeLibrary.activeBuiltInId ?? themeLibrary.activeId ?? "";
  const atCapacity = themeLibrary.themes.length >= THEME_LIBRARY_MAX;
  const draftId = draft?.id;
  const invalidColor = appearances.find(({ value: appearance }) =>
    Object.values(colorInputs[appearance]).some(
      (value) => value?.trim() && !isThemeColor(value.trim()),
    ),
  );

  useEffect(() => {
    previewTheme(live ? draft : null, mode);
  }, [draft, live, mode, previewTheme]);

  useEffect(() => () => previewTheme(null), [previewTheme]);

  useEffect(() => {
    if (draftId) nameField.current?.focus();
  }, [draftId]);

  useEffect(() => {
    if (transfer) jsonField.current?.focus();
  }, [transfer]);

  useEffect(() => {
    if (busy || builtInPreview || draftId || transfer || deleting || !restoreFocus.current) return;
    restoreFocus.current = false;
    themeSelect.current?.focus();
  }, [busy, builtInPreview, draftId, transfer, deleting]);

  function startEditing(theme: CustomTheme, fromBuiltIn?: ResolvedTheme) {
    previewTheme(null);
    setCopyAppearance(fromBuiltIn);
    setDraft(theme);
    setMode(fromBuiltIn ?? appearanceTheme);
    setLive(true);
    setColorInputs({ light: {}, dark: {} });
    setError("");
    setTransfer(null);
  }

  function stopEditing() {
    restoreFocus.current = true;
    setDraft(null);
    setColorInputs({ light: {}, dark: {} });
    setError("");
  }

  function updateColor(key: ThemeColorKey, text: string) {
    const value = text.trim().toLowerCase();
    setColorInputs((current) => ({ ...current, [mode]: { ...current[mode], [key]: text } }));
    if (value && !isThemeColor(value)) return;

    setDraft((current) => {
      if (!current) return current;
      const palette = { ...current[mode] };
      if (value) palette[key] = value;
      else delete palette[key];
      return { ...current, [mode]: palette };
    });
  }

  async function persist(next: ThemeLibrary, onSaved?: () => void, appearance?: ResolvedTheme) {
    setBusy(true);
    setError("");
    try {
      await saveThemeLibrary(next, appearance);
      onSaved?.();
    } catch {
      setError("Couldn’t save themes. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    if (!draft || !draft.name.trim() || invalidColor) return;

    const saved = { ...draft, name: draft.name.trim() };
    const exists = themeLibrary.themes.some(({ id }) => id === saved.id);
    const themes = exists
      ? themeLibrary.themes.map((theme) => (theme.id === saved.id ? saved : theme))
      : [...themeLibrary.themes, saved];
    const appearance = copyAppearance !== appearanceTheme ? copyAppearance : undefined;
    void persist({ activeId: saved.id, themes }, stopEditing, appearance);
  }

  function openTransfer(action: "import" | "export") {
    previewTheme(null);
    setError("");
    setJson(action === "export" && activeTheme ? encodeTheme(activeTheme) : "");
    setCopied(false);
    setTransfer(action);
  }

  function importTheme() {
    try {
      startEditing(decodeTheme(json));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t import the theme.");
    }
  }

  async function copyTheme() {
    setError("");
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      jsonField.current?.select();
      setError("Clipboard unavailable. Press Ctrl+C or Cmd+C to copy the selected JSON.");
    }
  }

  function applyTheme(library: ThemeLibrary) {
    void persist(library, () => previewTheme(null));
  }

  function selectTheme(id: string) {
    setError("");
    if (id === selectedId) {
      previewTheme(null);
      return;
    }
    const builtIn = BUILT_IN_THEMES.find((theme) => theme.id === id);
    if (builtIn) previewTheme(builtIn);
    else applyTheme({ activeId: id || null, themes: themeLibrary.themes });
  }

  function editBuiltInCopy(builtIn: BuiltInTheme) {
    startEditing(
      { ...createCustomTheme(`${builtIn.name} (copy)`), [builtIn.mode]: { ...builtIn.palette } },
      builtIn.mode,
    );
  }

  function deleteTheme() {
    if (!activeTheme) return;
    void persist(
      {
        activeId: null,
        themes: themeLibrary.themes.filter(({ id }) => id !== activeTheme.id),
      },
      () => {
        restoreFocus.current = true;
        setDeleting(false);
      },
    );
  }

  return (
    <section aria-labelledby={headingId} className={`mt-6 rounded-[8px] border ${surface}`}>
      <fieldset
        className="min-w-0 p-3"
        disabled={!themeLibraryReady || busy || Boolean(draft || transfer || deleting)}
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label className="grid min-w-0 flex-1 basis-40 gap-1.5">
            <span id={headingId} className="text-sm font-medium">
              Theme
            </span>
            <select
              ref={themeSelect}
              className={control}
              value={builtInPreview?.id ?? selectedId}
              onChange={(event) => selectTheme(event.target.value)}
            >
              <option value="">Default</option>
              <optgroup label="Built-in themes">
                {BUILT_IN_THEMES.map(({ id, name }) => (
                  <option value={id} key={id}>
                    {name}
                  </option>
                ))}
              </optgroup>
              {themeLibrary.themes.length > 0 && (
                <optgroup label="Saved themes">
                  {themeLibrary.themes.map(({ id, name }) => (
                    <option value={id} key={id}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={button}
              disabled={atCapacity}
              onClick={() => startEditing(createCustomTheme("Untitled theme"))}
            >
              <Plus size={14} aria-hidden="true" /> New theme
            </button>
            <button
              type="button"
              className={button}
              disabled={atCapacity}
              onClick={() => openTransfer("import")}
            >
              Import
            </button>
          </div>
        </div>
        {selectedBuiltIn && !draft && (
          <div
            className={`mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 ${divider}`}
          >
            <div className="text-xs">
              {builtInPreview && <p className="font-medium">Previewing {selectedBuiltIn.name}</p>}
              <p className={muted}>
                {selectedBuiltIn.mode === "dark" ? "Dark" : "Light"} palette by{" "}
                <a
                  className={`rounded-sm underline underline-offset-2 ${focus}`}
                  href={selectedBuiltIn.source}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selectedBuiltIn.author}
                </a>
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={button}
                disabled={atCapacity}
                onClick={() => editBuiltInCopy(selectedBuiltIn)}
              >
                <Copy size={13} aria-hidden="true" /> Create editable copy
              </button>
              {builtInPreview && (
                <>
                  <button
                    type="button"
                    className={button}
                    onClick={() => {
                      restoreFocus.current = true;
                      previewTheme(null);
                      setError("");
                    }}
                  >
                    Cancel preview
                  </button>
                  <button
                    type="button"
                    className={primaryButton}
                    onClick={() => {
                      restoreFocus.current = true;
                      applyTheme({
                        activeId: null,
                        activeBuiltInId: builtInPreview.id,
                        themes: themeLibrary.themes,
                      });
                    }}
                  >
                    {busy ? "Applying…" : "Apply theme"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {activeTheme && !builtInPreview && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" className={button} onClick={() => startEditing(activeTheme)}>
              <Pencil size={13} aria-hidden="true" /> Edit
            </button>
            <button
              type="button"
              className={button}
              disabled={atCapacity}
              onClick={() => {
                const copyName = `${activeTheme.name.slice(0, THEME_NAME_MAX - 7).trimEnd()} (copy)`;
                startEditing({
                  ...activeTheme,
                  id: createCustomTheme(copyName).id,
                  name: copyName,
                });
              }}
            >
              <Copy size={13} aria-hidden="true" /> Duplicate
            </button>
            <button type="button" className={button} onClick={() => openTransfer("export")}>
              Export
            </button>
            <button
              type="button"
              className={button}
              onClick={() => {
                setError("");
                setDeleting(true);
              }}
            >
              <Trash2 size={13} aria-hidden="true" /> Delete
            </button>
          </div>
        )}
        {atCapacity && (
          <p className={`mt-2 text-xs ${muted}`}>
            You’ve reached the limit of {THEME_LIBRARY_MAX} saved themes.
          </p>
        )}
      </fieldset>

      {deleting && (
        <div className={`space-y-2 border-t p-3 ${divider}`}>
          <p className="break-words text-sm">Delete “{activeTheme?.name}” and switch to Default?</p>
          <div className="flex gap-2">
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => {
                restoreFocus.current = true;
                setDeleting(false);
                setError("");
              }}
            >
              Cancel
            </button>
            <button type="button" className={primaryButton} disabled={busy} onClick={deleteTheme}>
              Delete theme
            </button>
          </div>
        </div>
      )}

      {transfer && (
        <div className={`space-y-2 border-t p-3 ${divider}`}>
          <label htmlFor={jsonId} className="block text-sm font-medium">
            {transfer === "import" ? "Import theme JSON" : "Export theme JSON"}
          </label>
          <textarea
            id={jsonId}
            ref={jsonField}
            className={`${control} block w-full resize-y font-mono`}
            rows={6}
            maxLength={THEME_SHARE_MAX_LENGTH}
            spellCheck={false}
            readOnly={transfer === "export"}
            value={json}
            onChange={(event) => setJson(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              onClick={() => {
                restoreFocus.current = true;
                setTransfer(null);
                setError("");
              }}
            >
              Close
            </button>
            {transfer === "import" ? (
              <button
                type="button"
                className={primaryButton}
                disabled={!json.trim()}
                onClick={importTheme}
              >
                Import theme
              </button>
            ) : (
              <button type="button" className={primaryButton} onClick={() => void copyTheme()}>
                {copied ? "Copied" : "Copy JSON"}
              </button>
            )}
          </div>
        </div>
      )}

      {draft && (
        <fieldset className="min-w-0" disabled={busy}>
          <div className={`space-y-4 border-t p-3 ${divider}`}>
            <label className="grid min-w-0 gap-1.5 text-sm font-medium">
              Theme name
              <input
                ref={nameField}
                type="text"
                className={control}
                value={draft.name}
                maxLength={THEME_NAME_MAX}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>

            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-sm font-medium">Palette</legend>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {appearances.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    className={`${button} aria-pressed:border-blue-700 aria-pressed:text-blue-700 dark:aria-pressed:border-blue-400 dark:aria-pressed:text-blue-400`}
                    onClick={() => setMode(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <PaletteEditor
                mode={mode}
                accent={defaultAccent}
                palette={draft[mode]}
                inputs={colorInputs[mode]}
                onChange={updateColor}
              />
            </fieldset>

            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-sm font-medium">Typography and corners</legend>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
                <label className="grid gap-1 text-xs">
                  Interface font
                  <select
                    className={control}
                    value={draft.uiFont}
                    onChange={(event) =>
                      setDraft({ ...draft, uiFont: event.target.value as CustomTheme["uiFont"] })
                    }
                  >
                    {THEME_UI_FONTS.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs">
                  Code font
                  <select
                    className={control}
                    value={draft.codeFont}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        codeFont: event.target.value as CustomTheme["codeFont"],
                      })
                    }
                  >
                    {THEME_CODE_FONTS.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <RangeControl
                  label="Text size"
                  suffix="%"
                  value={draft.fontScale}
                  min={THEME_FONT_SCALE_MIN}
                  max={THEME_FONT_SCALE_MAX}
                  onChange={(fontScale) => setDraft({ ...draft, fontScale })}
                />
                <RangeControl
                  label="Corner radius"
                  suffix=" px"
                  value={draft.radius}
                  min={THEME_RADIUS_MIN}
                  max={THEME_RADIUS_MAX}
                  onChange={(radius) => setDraft({ ...draft, radius })}
                />
              </div>
            </fieldset>
          </div>
          <div className={`sticky bottom-0 z-10 rounded-b-[8px] border-t p-3 ${surface}`}>
            {(error || invalidColor) && (
              <p role="alert" className="mb-2 text-xs text-red-700 dark:text-red-400">
                {error ||
                  `Enter a six-digit hex colour in the ${invalidColor?.label} palette, or reset the field.`}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex min-h-8 items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  className={`accent-blue-600 dark:accent-blue-400 ${focus}`}
                  checked={live}
                  onChange={(event) => setLive(event.target.checked)}
                />
                Live app preview
              </label>
              <div className="flex gap-2">
                <button type="button" className={button} onClick={stopEditing}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={primaryButton}
                  disabled={!draft.name.trim() || Boolean(invalidColor)}
                  onClick={saveDraft}
                >
                  {busy ? "Saving…" : "Save and apply"}
                </button>
              </div>
            </div>
            {copyAppearance && copyAppearance !== appearanceTheme && (
              <p className={`mt-2 text-xs ${muted}`}>
                Saving this copy switches Appearance to{" "}
                {copyAppearance === "dark" ? "Dark" : "Light"}.
              </p>
            )}
          </div>
        </fieldset>
      )}
      {!draft && !deleting && !transfer && !builtInPreview && (activeTheme || activeBuiltIn) && (
        <p className={`px-3 pb-3 text-xs ${muted}`}>
          Restore Default with <kbd>Ctrl+Shift+0</kbd> or <kbd>⌘⇧0</kbd>.
        </p>
      )}
      {error && !draft && (
        <p role="alert" className="px-3 pb-3 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

function RangeControl({
  label,
  suffix,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1 text-xs">
      <div className="flex items-center justify-between gap-1">
        <label htmlFor={id}>{label}</label>
        <span className={`tabular-nums ${muted}`}>
          {value}
          {suffix}
        </span>
      </div>
      <input
        id={id}
        className={`w-full accent-blue-600 dark:accent-blue-400 ${focus}`}
        type="range"
        min={min}
        max={max}
        value={value}
        aria-valuetext={`${value}${suffix}`}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </div>
  );
}

function PaletteEditor({
  accent,
  mode,
  palette,
  inputs,
  onChange,
}: {
  accent: string;
  mode: ResolvedTheme;
  palette: ThemePalette;
  inputs: ThemePalette;
  onChange: (key: ThemeColorKey, value: string) => void;
}) {
  const reference = useRef<HTMLDivElement>(null);
  const [swatches, setSwatches] = useState<ThemePalette>({});
  const paletteStyles = Object.fromEntries(
    Object.entries(palette).map(([key, value]) => [`--${key}`, value]),
  ) as CSSProperties;

  // biome-ignore lint/correctness/useExhaustiveDependencies: These values update the reference element's computed styles.
  useLayoutEffect(() => {
    if (!reference.current) return;
    const styles = getComputedStyle(reference.current);
    const colors = Object.fromEntries(
      THEME_COLOR_GROUPS.flatMap(({ tokens }) =>
        tokens.map(({ key }) => [key, styles.getPropertyValue(`--${key}`).trim()]),
      ),
    );
    setSwatches(colors);
  }, [accent, mode, palette]);

  return (
    <div
      className={`divide-y rounded-[6px] border divide-zinc-200 dark:divide-zinc-700 ${divider}`}
    >
      <div
        className={`theme-defaults ${mode === "dark" ? "dark" : ""}`}
        ref={reference}
        data-accent={accent}
        style={paletteStyles}
        hidden
      />
      {THEME_COLOR_GROUPS.map(({ label, tokens }, index) => (
        <details key={label} className="group" open={index === 0}>
          <summary
            className={`flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-xs font-medium hover:bg-zinc-100 group-open:border-b dark:hover:bg-zinc-800 ${divider} ${focus}`}
          >
            {label}
            <ChevronDown size={14} aria-hidden="true" className="shrink-0 group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-x-5 gap-y-2 p-2.5">
            {tokens.map(({ key, label }) => (
              <ColorField
                key={key}
                label={label}
                value={inputs[key] ?? palette[key] ?? ""}
                swatch={palette[key] ?? swatches[key]}
                onChange={(value) => onChange(key, value)}
                mode={mode}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

/** The native picker requires opaque sRGB. Keep the original CSS for the default swatch. */
function pickerColor(cssColor: string | undefined, fallback: string): string {
  if (!cssColor) return fallback;
  if (isThemeColor(cssColor)) return cssColor;
  if (typeof CanvasRenderingContext2D === "undefined") return fallback;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return fallback;
  context.fillStyle = fallback;
  context.fillStyle = cssColor;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  return alpha
    ? `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
    : fallback;
}

function ColorField({
  label,
  value,
  swatch,
  mode,
  onChange,
}: {
  label: string;
  value: string;
  swatch: string | undefined;
  mode: ResolvedTheme;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [pickerValue, setPickerValue] = useState("#000000");
  const invalid = Boolean(value.trim() && !isThemeColor(value.trim()));

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <label className="min-w-0 flex-1 text-xs" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <label
          className={`relative block size-7 shrink-0 cursor-pointer rounded-[5px] border focus-within:outline-2 focus-within:outline-blue-600 dark:focus-within:outline-blue-400 ${divider}`}
          style={{ backgroundColor: swatch || undefined }}
        >
          <input
            type="color"
            aria-label={`Pick ${label.toLowerCase()}`}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            value={isThemeColor(swatch ?? "") ? swatch : pickerValue}
            onFocus={() =>
              setPickerValue(pickerColor(swatch, mode === "dark" ? "#1a1a1d" : "#ffffff"))
            }
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        <input
          id={id}
          type="text"
          className={`${input} h-7 w-[6.5em] px-1.5 font-mono text-xs aria-invalid:border-red-600 dark:aria-invalid:border-red-400`}
          aria-invalid={invalid}
          value={value}
          maxLength={7}
          placeholder="Default"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className={`${buttonStyle} size-7 shrink-0`}
          aria-label={`Reset ${label.toLowerCase()}`}
          title="Use default colour"
          disabled={!value}
          onClick={() => onChange("")}
        >
          <RotateCcw size={12} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
