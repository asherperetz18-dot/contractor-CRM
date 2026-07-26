"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { APP_ROLES, type AppRole, type Profile } from "@/lib/data/types";
import { createUser, toggleUserStatus, updateUserRoles } from "@/lib/actions/users";

type StatusTab = "Active" | "Archived" | "All";

const NEW_USER_BLANK = { name: "", email: "", phone: "", password: "" };

export function UsersRolesTable({ users }: { users: Profile[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("Active");
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState(NEW_USER_BLANK);
  const [newUserRoles, setNewUserRoles] = useState<AppRole[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const q = search.trim().toLowerCase();
  const filtered = users.filter((u) => {
    if (statusTab !== "All" && u.status !== statusTab) return false;
    if (q && !`${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function handleCreate() {
    if (!newUser.name.trim() || !newUser.email.trim() || newUser.password.length < 6) {
      setError("Name, email, and a password of at least 6 characters are required.");
      return;
    }
    setPending(true);
    setError("");
    const result = await createUser({ ...newUser, roles: newUserRoles });
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setNewUser(NEW_USER_BLANK);
    setNewUserRoles([]);
    setShowCreate(false);
    refresh();
  }

  async function handleToggleStatus(u: Profile) {
    await toggleUserStatus(u.id, u.status);
    refresh();
  }

  async function handleToggleRole(u: Profile, role: AppRole) {
    const next = u.roles.includes(role)
      ? u.roles.filter((r) => r !== role)
      : [...u.roles, role];
    await updateUserRoles(u.id, next);
    refresh();
  }

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>Users &amp; Roles</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Users &amp; Roles</h1>
          <p className="module-sub">
            Create team members, assign roles, and manage access
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Create New User
        </button>
      </div>

      <div className="ur-filter-bar">
        <input
          className="ur-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users"
        />
        <div className="chip-row no-margin">
          {(["Active", "Archived", "All"] as StatusTab[]).map((s) => (
            <button
              key={s}
              className={"chip" + (statusTab === s ? " chip-active" : "")}
              onClick={() => setStatusTab(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">No users match</p>
          <p className="empty-hint">
            Try a different search or filter, or create a new user.
          </p>
        </div>
      ) : (
        <table className="data-table ur-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Roles</th>
              <th className="right">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="ur-name-cell">
                    <span className="ur-avatar">
                      {(u.name || u.email || "?")[0].toUpperCase()}
                    </span>
                    <div>
                      <div className="ur-name">{u.name || "—"}</div>
                      <Badge color={u.status === "Active" ? "#2F855A" : "#7C8798"}>
                        {u.status}
                      </Badge>
                    </div>
                  </div>
                </td>
                <td>{u.email}</td>
                <td>{u.phone || <span className="ur-add-phone">+ Add phone</span>}</td>
                <td>
                  <div className="ur-role-badges">
                    {APP_ROLES.map((role) => {
                      const active = u.roles.includes(role);
                      return (
                        <button
                          key={role}
                          type="button"
                          className="ur-toggle-btn"
                          onClick={() => handleToggleRole(u, role)}
                          title={active ? `Remove ${role}` : `Add ${role}`}
                        >
                          <Badge color={active ? "#2D5F8A" : "#B9B3A3"}>
                            {role}
                          </Badge>
                        </button>
                      );
                    })}
                    {u.roles.length === 0 && (
                      <span className="ur-add-phone">No roles</span>
                    )}
                  </div>
                </td>
                <td className="right">
                  <button
                    className="ur-toggle-btn"
                    onClick={() => handleToggleStatus(u)}
                  >
                    <span
                      className={
                        "toggle-track" + (u.status === "Active" ? " toggle-on" : "")
                      }
                    >
                      <span className="toggle-thumb" />
                    </span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && (
        <Modal title="Create New User" onClose={() => setShowCreate(false)}>
          <div className="form-grid">
            <Field label="Name">
              <input
                value={newUser.name}
                onChange={(e) => setNewUser((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser((f) => ({ ...f, email: e.target.value }))}
              />
            </Field>
            <Field label="Phone">
              <input
                value={newUser.phone}
                onChange={(e) => setNewUser((f) => ({ ...f, phone: e.target.value }))}
              />
            </Field>
            <Field label="Initial Password">
              <input
                type="text"
                value={newUser.password}
                onChange={(e) =>
                  setNewUser((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="At least 6 characters"
              />
            </Field>
          </div>
          <Field label="Roles">
            <div className="segmented">
              {APP_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  className={
                    "segmented-btn" + (newUserRoles.includes(role) ? " active" : "")
                  }
                  onClick={() =>
                    setNewUserRoles((prev) =>
                      prev.includes(role)
                        ? prev.filter((r) => r !== role)
                        : [...prev, role]
                    )
                  }
                >
                  {role}
                </button>
              ))}
            </div>
          </Field>
          <p className="hint-note">
            They can sign in immediately with this email and password.
          </p>
          {error && <p className="error-note">{error}</p>}
          <div className="modal-actions">
            <div />
            <div>
              <button className="btn-ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreate} disabled={pending}>
                {pending ? "Creating…" : "Create User"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
