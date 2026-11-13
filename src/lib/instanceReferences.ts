import type { ExplorerReference } from "@/lib/explorer";

const INSTANCE_REFERENCE_PATTERN =
  /<Instance((?:\s+(?:reference|class|property|attribute|tag)="[^"]*")+)[ \t\r\n]*>([^<]+)<\/Instance>/g;
const ATTRIBUTE_PATTERN = /\s+(reference|class|property|attribute|tag)="([^"]*)"/g;
const CLASS_NAME = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const LEGACY_CLASS_PREFIX = "bloxbot-legacy-reference-classes:";
const MAX_LEGACY_CLASSES = 512;

export interface MessageReferenceSource {
  sessionID: string;
  partID: string;
}

interface LegacyClass {
  place: string;
  className: string;
}

export interface InstanceReference {
  type: "instance";
  path: string;
  label: string;
  className?: string;
  field?: ExplorerReference["field"];
  raw: string;
}

type InstanceReferencePart = { type: "text"; value: string } | InstanceReference;

export function validInstanceClassName(value: unknown): string | undefined {
  return typeof value === "string" && CLASS_NAME.test(value) ? value : undefined;
}

function decodeReference(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeReferenceBody(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeReferenceValue(value: string) {
  return escapeReferenceBody(value).replace(/"/g, "&quot;");
}

export function serializeInstanceReference({
  path,
  label,
  className,
  field,
}: Pick<InstanceReference, "path" | "label" | "className" | "field">) {
  const verifiedClass = validInstanceClassName(className);
  const classAttribute = verifiedClass ? ` class="${verifiedClass}"` : "";
  const fieldAttribute = field ? ` ${field.kind}="${escapeReferenceValue(field.name)}"` : "";
  return `<Instance reference="${escapeReferenceValue(path)}"${classAttribute}${fieldAttribute}>${escapeReferenceBody(label)}</Instance>`;
}

export function splitInstanceReferences(text: string): InstanceReferencePart[] {
  const parts: InstanceReferencePart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INSTANCE_REFERENCE_PATTERN)) {
    const attributes = new Map<string, string>();
    let repeated = false;
    for (const [, key, value] of match[1].matchAll(ATTRIBUTE_PATTERN)) {
      if (attributes.has(key)) repeated = true;
      attributes.set(key, decodeReference(value));
    }
    const path = attributes.get("reference");
    const fields = (["property", "attribute", "tag"] as const).filter((kind) =>
      attributes.has(kind),
    );
    if (!path || repeated || fields.length > 1) continue;
    const [fieldKind] = fields;
    const index = match.index;
    if (index > cursor) parts.push({ type: "text", value: text.slice(cursor, index) });
    parts.push({
      type: "instance",
      path,
      className: validInstanceClassName(attributes.get("class")),
      field: fieldKind ? { kind: fieldKind, name: attributes.get(fieldKind) ?? "" } : undefined,
      label: decodeReference(match[2]),
      raw: match[0],
    });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ type: "text", value: text.slice(cursor) });
  return parts;
}

export function instanceReferenceLabels(text: string) {
  return splitInstanceReferences(text)
    .map((part) => (part.type === "instance" ? part.label.replace(/^@/, "") : part.value))
    .join("");
}

function legacyClassKey(source: MessageReferenceSource, path: string) {
  return JSON.stringify([source.partID, path.replace(/^game\./, "")]);
}

function loadLegacyClasses(sessionID: string): Map<string, LegacyClass> {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(LEGACY_CLASS_PREFIX + sessionID) ?? "[]",
    );
    if (Array.isArray(value)) return new Map(value);
  } catch {
    // A corrupt or unavailable cache has no references to restore.
  }
  return new Map();
}

export function loadLegacyInstanceClass(source: MessageReferenceSource, path: string) {
  const cached = loadLegacyClasses(source.sessionID).get(legacyClassKey(source, path));
  const className = validInstanceClassName(cached?.className);
  return className && typeof cached?.place === "string"
    ? { place: cached.place, className }
    : undefined;
}

export function rememberLegacyInstanceClass(
  source: MessageReferenceSource,
  path: string,
  entry: LegacyClass,
) {
  const classes = loadLegacyClasses(source.sessionID);
  const key = legacyClassKey(source, path);
  if (validInstanceClassName(classes.get(key)?.className)) return;
  classes.set(key, entry);
  try {
    localStorage.setItem(
      LEGACY_CLASS_PREFIX + source.sessionID,
      JSON.stringify([...classes].slice(-MAX_LEGACY_CLASSES)),
    );
  } catch {
    // The chip can still use the class it just resolved in Studio.
  }
}

export function clearLegacyInstanceClasses(sessionID: string) {
  try {
    localStorage.removeItem(LEGACY_CLASS_PREFIX + sessionID);
  } catch {
    // Storage may be unavailable.
  }
}
