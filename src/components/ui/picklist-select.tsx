"use client";

import { useState } from "react";
import { createFieldOption, type OptionTable } from "@/lib/actions/lead-field-options";

const ADD_NEW = "__add_new__";

export function PicklistSelect({
  table,
  value,
  options,
  onChange,
  onOptionAdded,
  disabled,
}: {
  table: OptionTable;
  value: string;
  options: { id: string; name: string }[];
  onChange: (value: string) => void;
  onOptionAdded: (option: { id: string; name: string }) => void;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setPending(true);
    setError("");
    const result = await createFieldOption(table, trimmed);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onOptionAdded({ id: result.id ?? trimmed, name: trimmed });
    onChange(trimmed);
    setNewName("");
    setAdding(false);
  }

  function cancelAdd() {
    setAdding(false);
    setNewName("");
    setError("");
  }

  if (adding) {
    return (
      <div>
        <div className="rep-text-row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="New option name"
            autoFocus
            disabled={pending}
          />
          <button
            type="button"
            className="btn-primary small"
            onClick={handleAdd}
            disabled={pending}
          >
            {pending ? "Adding…" : "Add"}
          </button>
          <button type="button" className="btn-ghost small" onClick={cancelAdd} disabled={pending}>
            Cancel
          </button>
        </div>
        {error && <p className="error-note">{error}</p>}
      </div>
    );
  }

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === ADD_NEW) {
          setAdding(true);
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">— none —</option>
      {options.map((o) => (
        <option key={o.id} value={o.name}>
          {o.name}
        </option>
      ))}
      {value && !options.some((o) => o.name === value) && (
        <option value={value}>{value} (custom)</option>
      )}
      <option value={ADD_NEW}>+ Add new…</option>
    </select>
  );
}
