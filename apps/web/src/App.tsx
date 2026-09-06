import { useEffect, useState } from "react";

type Health = "checking" | "ok" | "unavailable";

export function App() {
  const [health, setHealth] = useState<Health>("checking");
  useEffect(() => {
    let cancelled = false;
    fetch("/healthz")
      .then((r) => r.json())
      .then((j: { status: string }) => { if (!cancelled) setHealth(j.status === "ok" ? "ok" : "unavailable"); })
      .catch(() => { if (!cancelled) setHealth("unavailable"); });
    return () => { cancelled = true; };
  }, []);
  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Storylane</h1>
      <p className="text-sm text-neutral-600">Self-hosted tracker — rewrite in progress.</p>
      <p data-testid="health" className="font-mono text-sm">server: {health}</p>
    </main>
  );
}
