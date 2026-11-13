export const EFFORT_LEVELS = [
  { ids: ["none", "off", "no"], label: "No" },
  { ids: ["minimal"], label: "Minimal" },
  { ids: ["low"], label: "Low" },
  { ids: ["medium"], label: "Medium" },
  { ids: ["high"], label: "High" },
  { ids: ["xhigh", "extra", "extra-high"], label: "Extra high" },
  { ids: ["max", "maximum"], label: "Max" },
  { ids: ["ultra"], label: "Ultra" },
  { ids: ["ultracode"], label: "Ultracode" },
];

export function effortLabel(variant: string | null) {
  return variant === null
    ? "Auto"
    : (EFFORT_LEVELS.find((level) => level.ids.includes(variant.toLowerCase()))?.label ?? variant);
}
