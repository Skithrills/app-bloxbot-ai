import { useState } from "react";
import { useResolvedTheme } from "@/components/theme-provider";

function StudioIconImage({ src, size }: { src: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" className="shrink-0">
        <rect
          x="3.75"
          y="3.75"
          width="8.5"
          height="8.5"
          rx="1.25"
          transform="rotate(45 8 8)"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        />
      </svg>
    );
  }

  return (
    <img
      alt=""
      src={src}
      width={size}
      height={size}
      className="shrink-0"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export function StudioClassIcon({
  className = "Placeholder",
  size = 16,
}: {
  className?: string;
  size?: number;
}) {
  const theme = useResolvedTheme();
  const src = `bloxbot-icon://studio/${theme}/${encodeURIComponent(className)}`;
  return <StudioIconImage key={src} src={src} size={size} />;
}
