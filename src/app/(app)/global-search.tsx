"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import type { GlobalSearchGroup } from "@/lib/data/global-search";

/**
 * Asks a route handler, not a Server Action. A search fires on every
 * pause in typing, and Next runs server actions one after another
 * through a single queue in the browser -- so each pause used to queue
 * a search ahead of whatever the person clicked next, on every page
 * (DECISIONS #062). A failed or aborted request reads as no matches.
 */
async function searchEverything(q: string): Promise<GlobalSearchGroup[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ groups?: GlobalSearchGroup[] }>) : null))
    .catch(() => null);
  return res?.groups ?? [];
}

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<GlobalSearchGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = value.trim();
    if (q.length < 2) {
      setLoading(false);
      setSearched(false);
      setGroups([]);
      return;
    }

    setLoading(true);
    const requestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(() => {
      searchEverything(q).then((found) => {
        if (requestIdRef.current !== requestId) return;
        setGroups(found);
        setLoading(false);
        setSearched(true);
      });
    }, 300);
  }

  function openResult(href: string) {
    setOpen(false);
    setQuery("");
    setGroups([]);
    setSearched(false);
    router.push(href);
  }

  const empty = groups.length === 0;

  return (
    <div className="gsearch-wrap">
      <input
        className="global-search"
        placeholder="Search for Anything"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && query.trim().length >= 2 && (
        <>
          <div className="gsearch-backdrop" onClick={() => setOpen(false)} />
          <div className="gsearch-panel">
            {loading ? (
              <div className="gsearch-empty">Searching…</div>
            ) : empty && searched ? (
              <div className="gsearch-empty">
                No matches across contacts, estimates, appointments, notes, or bills.
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.label} className="gsearch-group">
                  <div className="gsearch-group-label">{g.label}</div>
                  {g.hits.map((r) => (
                    <div
                      key={r.id}
                      className="gsearch-item"
                      onClick={() => openResult(r.href)}
                    >
                      <div className="gsearch-item-main">
                        <div className="gsearch-item-name">{r.name}</div>
                        <div className="gsearch-item-sub">{r.sub || "—"}</div>
                      </div>
                      {r.badge && <Badge color={r.color}>{r.badge}</Badge>}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
