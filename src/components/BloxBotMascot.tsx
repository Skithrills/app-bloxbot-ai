export function BloxBotMascot({ size, animated = true }: { size: number; animated?: boolean }) {
  const asset = animated ? "bloxbot-logo.svg" : "bloxbot-icon.svg";

  return (
    <img
      src={`${import.meta.env.BASE_URL}${asset}`}
      width={size}
      height={size}
      className="shrink-0"
      alt=""
      draggable={false}
    />
  );
}
