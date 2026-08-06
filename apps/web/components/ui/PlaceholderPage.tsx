export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="fade-in flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-6 py-20 text-center">
      <span className="rounded-full border border-sky-900 bg-sky-950/60 px-3 py-1 text-xs font-medium tracking-wide text-sky-300 uppercase">
        Próximamente
      </span>
      <h1 className="text-xl font-semibold text-zinc-50">{title}</h1>
      <p className="max-w-md text-sm text-zinc-500">{description}</p>
    </div>
  );
}
