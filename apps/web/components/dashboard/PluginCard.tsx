export function PluginCard({ plugins }: { plugins: Array<{ id: string; displayName: string }> }) {
  return (
    <div className="fade-in rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <h2 className="mb-3 text-sm font-medium text-zinc-300">Plugins activos</h2>
      {plugins.length === 0 ? (
        <p className="text-sm text-zinc-500">Ningún plugin activo.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {plugins.map((plugin) => (
            <li
              key={plugin.id}
              className="flex items-center justify-between rounded-lg bg-zinc-900/60 px-3 py-2 text-sm"
            >
              <span className="text-zinc-200">{plugin.displayName}</span>
              <span className="text-xs text-zinc-500">{plugin.id}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
