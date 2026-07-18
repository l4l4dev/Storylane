import { Bot } from "lucide-react";

export function AgentIndicator({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return <Bot role="img" className="size-3.5" aria-label="Agent" />;
  }

  return (
    <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
      <Bot className="size-3" aria-hidden="true" />
      Agent
    </span>
  );
}
