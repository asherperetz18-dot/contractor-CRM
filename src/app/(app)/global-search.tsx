"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { searchDirectory, type DirectoryHit } from "@/lib/actions/search";

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryHit[]>([]);
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
      setResults([]);
      return;
    }

    setLoading(true);
    const requestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(() => {
      searchDirectory(q).then((hits) => {
        if (requestIdRef.current !== requestId) return;
        setResults(hits);
        setLoading(false);
        setSearched(true);
      });
    }, 300);
  }

  function openResult(id: string) {
    setOpen(false);
    setQuery("");
    setResults([]);
    setSearched(false);
    router.push(`/contacts?openLead=${id}`);
  }

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
            ) : results.length === 0 && searched ? (
              <div className="gsearch-empty">
                No matches for name, phone, or address.
              </div>
            ) : (
              results.map((r) => (
                <div
                  key={r.id}
                  className="gsearch-item"
                  onClick={() => openResult(r.id)}
                >
                  <div className="gsearch-item-main">
                    <div className="gsearch-item-name">{r.name}</div>
                    <div className="gsearch-item-sub">
                      {[r.phone, r.address].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <Badge color={r.color}>{r.stage}</Badge>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
