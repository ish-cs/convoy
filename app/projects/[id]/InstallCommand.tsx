'use client';
export default function InstallCommand({ token }: { token: string }) {
  const cmd = `npx convoy-cli@latest connect ${token}`;
  return (
    <section className="space-y-2">
      <h2 className="font-medium">Connect Claude Code</h2>
      <p className="text-sm text-gray-600">Run once in your terminal, then restart your Claude Code sessions. Never put secrets in shared context.</p>
      <div className="flex gap-2">
        <code className="flex-1 overflow-x-auto rounded bg-gray-100 p-3 text-xs">{cmd}</code>
        <button onClick={() => navigator.clipboard.writeText(cmd)} className="rounded border px-3">Copy</button>
      </div>
    </section>
  );
}
