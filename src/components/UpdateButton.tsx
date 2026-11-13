import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";

import { UpdateReleaseNotes } from "@/components/UpdateReleaseNotes";
import { MENU_TRIGGER } from "@/components/ui/menu";
import { useUpdater } from "@/hooks/useUpdater";
import { notify } from "@/lib/notifications";

export function UpdateButton() {
  const { update, downloading, installError, installUpdate } = useUpdater(true);
  const installRef = useRef(installUpdate);
  installRef.current = installUpdate;
  const announcedVersion = useRef<string | null>(null);
  const version = update?.version;
  const notes = update?.body ?? null;

  useEffect(() => {
    if (!version || announcedVersion.current === version) return;
    announcedVersion.current = version;
    notify.message(`BloxBot ${version} is available`, {
      name: "update_available",
      className: "update-available-toast",
      description: <UpdateReleaseNotes body={notes} />,
      system: { body: "Open BloxBot to install it." },
      action: { label: "Install & Restart", onClick: () => installRef.current() },
    });
  }, [version, notes]);

  useEffect(() => {
    if (installError) notify.error("Update failed", { description: installError });
  }, [installError]);

  if (!version) return null;
  const label = downloading
    ? `Installing BloxBot ${version}`
    : `Download and install BloxBot ${version}`;
  return (
    <button
      type="button"
      className={`${MENU_TRIGGER} shrink-0 text-foreground`}
      aria-label={label}
      aria-busy={downloading}
      title={label}
      disabled={downloading}
      onClick={installUpdate}
    >
      {downloading ? (
        <LoaderCircle size={14} className="motion-safe:animate-spin" aria-hidden="true" />
      ) : (
        <Download size={14} aria-hidden="true" />
      )}
    </button>
  );
}
