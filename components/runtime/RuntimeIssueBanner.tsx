"use client";

export function RuntimeIssueBanner({
  message,
  onRetry,
  retrying = false,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-3 bottom-[max(var(--creatorx-safe-bottom),12px)] z-[100] flex items-center justify-between gap-3 rounded-xl border border-down/30 bg-card px-4 py-3 text-sm text-foreground shadow-xl"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white disabled:cursor-wait disabled:opacity-60"
      >
        다시 시도
      </button>
    </div>
  );
}
