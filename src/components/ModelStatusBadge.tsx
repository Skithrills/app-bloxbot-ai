/** A small tag for a model that isn't generally available yet, or is on its way out. */
export default function ModelStatusBadge({ status }: { status?: string }) {
  if (status === "beta")
    return (
      <span className="shrink-0 rounded bg-warning/15 px-1 text-xs font-medium text-warning">
        beta
      </span>
    );
  if (status === "alpha")
    return (
      <span className="shrink-0 rounded bg-info/15 px-1 text-xs font-medium text-info">alpha</span>
    );
  if (status === "deprecated")
    return (
      <span className="shrink-0 rounded bg-muted px-1 text-xs font-medium text-muted-foreground">
        deprecated
      </span>
    );
  return null;
}
