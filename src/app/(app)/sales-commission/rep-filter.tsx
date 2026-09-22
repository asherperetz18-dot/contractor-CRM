"use client";

import { useRouter } from "next/navigation";

/**
 * The Salesperson filter, URL-synced as ?rep= -- the same idiom as the
 * rep filter on Payments and Money to Collect, so a filtered view can
 * be bookmarked or sent to someone. The server component re-renders
 * with everything (stat cards, balance table, jobs, payouts) narrowed
 * to that one person's money.
 */
export function RepFilter({
  options,
  value,
}: {
  options: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();

  return (
    <label className="field" style={{ minWidth: 220 }}>
      <span className="field-label">Salesperson</span>
      <select
        value={value}
        onChange={(e) => {
          const id = e.target.value;
          router.replace(id ? `/sales-commission?rep=${id}` : "/sales-commission");
        }}
      >
        <option value="">Everyone</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
