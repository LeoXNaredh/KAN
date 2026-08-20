"use client";

import { useMemo, useState } from "react";
import { SearchX } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Reveal } from "@/components/ui/Reveal";
import { EmptyState } from "@/components/ui/EmptyState";
import { INPUT_CLASSES, SECONDARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { ACTOR_LABEL, translateAuditEntry, type RawAuditEntry } from "@/lib/status/translateAuditEntry";
import { formatRelativeTime } from "@/lib/status/formatRelativeTime";

type ActorFilter = "all" | keyof typeof ACTOR_LABEL;

const EMPTY_FILTERS = { search: "", actor: "all" as ActorFilter, dateFrom: "", dateTo: "" };

/**
 * Filtros de búsqueda/actor/fecha para /logs — aplican sobre `entries` ya
 * cargados por el server component (page.tsx, un solo fetch a /v1/audit),
 * sin pedir nada nuevo al Gateway por cada cambio de filtro.
 */
export function LogsExplorer({ entries }: { entries: RawAuditEntry[] }) {
  const [search, setSearch] = useState(EMPTY_FILTERS.search);
  const [actor, setActor] = useState<ActorFilter>(EMPTY_FILTERS.actor);
  const [dateFrom, setDateFrom] = useState(EMPTY_FILTERS.dateFrom);
  const [dateTo, setDateTo] = useState(EMPTY_FILTERS.dateTo);

  const hasActiveFilters = search !== "" || actor !== "all" || dateFrom !== "" || dateTo !== "";

  function clearFilters() {
    setSearch(EMPTY_FILTERS.search);
    setActor(EMPTY_FILTERS.actor);
    setDateFrom(EMPTY_FILTERS.dateFrom);
    setDateTo(EMPTY_FILTERS.dateTo);
  }

  const sorted = useMemo(() => entries.slice().sort((a, b) => b.at.localeCompare(a.at)), [entries]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : undefined;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : undefined;

    return sorted.filter((entry) => {
      if (actor !== "all" && entry.actor !== actor) return false;
      if (needle && !translateAuditEntry(entry).toLowerCase().includes(needle)) return false;
      const at = new Date(entry.at);
      if (from && at < from) return false;
      if (to && at > to) return false;
      return true;
    });
  }, [sorted, search, actor, dateFrom, dateTo]);

  return (
    <div className="flex flex-col gap-4">
      <Card padding="sm" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ink-faint">
          Buscar
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar en el historial..."
            className={INPUT_CLASSES}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          Actor
          <select
            value={actor}
            onChange={(event) => setActor(event.target.value as ActorFilter)}
            className={INPUT_CLASSES}
          >
            <option value="all">Todos</option>
            {Object.entries(ACTOR_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          Desde
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className={INPUT_CLASSES}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-faint">
          Hasta
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className={INPUT_CLASSES}
          />
        </label>
        <button
          type="button"
          onClick={clearFilters}
          disabled={!hasActiveFilters}
          className={`press shrink-0 ${SECONDARY_BUTTON_CLASSES}`}
        >
          Limpiar filtros
        </button>
      </Card>

      <Card className="fade-in">
        {filtered.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Sin resultados"
            description="Ninguna entrada coincide con los filtros."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((entry, index) => (
              <Reveal
                key={entry.id}
                as="li"
                delay={Math.min(index, 12) * 30}
                className="flex flex-col gap-1 rounded-xl bg-surface-3/70 px-3 py-2 text-sm transition-all duration-fast hover:translate-x-0.5 hover:bg-surface-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0">
                  <span className="mr-2 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-accent uppercase">
                    {ACTOR_LABEL[entry.actor] ?? entry.actor}
                  </span>
                  <span className="text-ink">{translateAuditEntry(entry)}</span>
                </div>
                <span className="shrink-0 text-xs text-ink-faint">{formatRelativeTime(entry.at)}</span>
              </Reveal>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
