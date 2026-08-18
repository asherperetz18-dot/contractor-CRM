"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { APP_ROLES, isSuperAdmin, type AppRole, type Profile } from "@/lib/data/types";
import {
  addUserToCompany,
  createUser,
  findUserByEmail,
  removeUserFromCompany,
  toggleUserStatus,
  updateIsDispatchSupervisor,
  updateCanDeleteLeads,
  updateCanCreateEstimates,
  updateCanViewEstimates,
  updateUserProfile,
  updateUserRoles,
} from "@/lib/actions/users";
import { ReassignWorkModal, type ReassignMode } from "./reassign-work-modal";

type StatusTab = "Active" | "Archived" | "All";

const NEW_USER_BLANK = { name: "", email: "", phone: "", password: "" };

/**
 * Whether the table is currently hiding columns off its right edge.
 *
 * Only used to say so out loud. A permission switch that is off-screen
 * is indistinguishable from one that was never built -- an admin looking
 * for "View Estimates" and not finding it concludes the feature is
 * missing, so the page has to admit there is more to the right.
 */
function useHasHiddenColumns(): [(el: HTMLDivElement | null) => void, boolean] {
  const [hidden, setHidden] = useState(false);
  // A callback ref held in state rather than useRef: the measurement
  // needs to re-run when the node arrives, and a plain ref does not
  // trigger that.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => setNode(el), []);

  useEffect(() => {
    if (!node) return;
    // Whichever element is actually doing the scrolling. On a wide
    // screen it is this box; on a phone the table itself becomes
    // display:block with its own overflow-x, so the box fits perfectly
    // while the table hides 960px of columns inside it. Measuring only
    // the box meant the hint never appeared on mobile -- the very case
    // where the columns are hardest to find.
    const measure = () => {
      const table = node.querySelector("table");
      setHidden(
        node.scrollWidth > node.clientWidth + 1 ||
          (!!table && table.scrollWidth > table.clientWidth + 1)
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const table = node.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [node]);

  return [attach, hidden];
}

export function UsersRolesTable({
  users,
  isAdmin,
}: {
  users: Profile[];
  /** Admin role itself. Office may manage people but not mint Admins. */
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [tableScrollRef, hasHiddenColumns] = useHasHiddenColumns();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("Active");
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState(NEW_USER_BLANK);
  const [newUserRoles, setNewUserRoles] = useState<AppRole[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [reassign, setReassign] = useState<{ user: Profile; mode: ReassignMode } | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [foundUser, setFoundUser] = useState<{ id: string; name: string | null; email: string } | null>(null);
  const [addRoles, setAddRoles] = useState<AppRole[]>([]);
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState("");

  // Office can assign every role except Admin -- offering a chip that
  // the server will reject is worse than not offering it.
  const assignableRoles = isAdmin ? APP_ROLES : APP_ROLES.filter((r) => r !== "Admin");

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

  // Archiving someone who still owns live work strands it exactly as
  // removal does, so the handover prompt runs first either way. Turning
  // an archived user back on has nothing to hand over.
  async function handleToggleStatus(u: Profile) {
    if (u.status === "Active") {
      setReassign({ user: u, mode: "archive" });
      return;
    }
    await toggleUserStatus(u.id, u.status);
    refresh();
  }

  async function finishReassign() {
    const target = reassign;
    setReassign(null);
    if (!target) return;
    if (target.mode === "archive") await toggleUserStatus(target.user.id, target.user.status);
    if (target.mode === "remove") await removeUserFromCompany(target.user.id);
    refresh();
  }

  async function handleToggleRole(u: Profile, role: AppRole) {
    const next = u.roles.includes(role)
      ? u.roles.filter((r) => r !== role)
      : [...u.roles, role];
    await updateUserRoles(u.id, next);
    refresh();
  }

  async function handleToggleDispatchSupervisor(u: Profile) {
    await updateIsDispatchSupervisor(u.id, !u.is_dispatch_supervisor);
    router.refresh();
  }

  async function handleToggleCanDelete(u: Profile) {
    await updateCanDeleteLeads(u.id, !u.can_delete_leads);
    refresh();
  }

  async function handleToggleViewEstimates(u: Profile) {
    await updateCanViewEstimates(u.id, !u.can_view_estimates);
    refresh();
  }

  async function handleToggleCreateEstimates(u: Profile) {
    await updateCanCreateEstimates(u.id, !u.can_create_estimates);
    refresh();
  }

  function openEdit(u: Profile) {
    setEditingUser(u);
    setEditForm({ name: u.name ?? "", email: u.email ?? "", phone: u.phone ?? "", password: "" });
    setEditError("");
  }

  async function handleSaveEdit() {
    if (!editingUser) return;
    if (!editForm.name.trim() || !editForm.email.trim()) {
      setEditError("Name and email are required.");
      return;
    }
    if (editForm.password && editForm.password.length < 6) {
      setEditError("New password must be at least 6 characters.");
      return;
    }
    setEditPending(true);
    setEditError("");
    const result = await updateUserProfile(editingUser.id, editForm);
    setEditPending(false);
    if (result?.error) {
      setEditError(result.error);
      return;
    }
    setEditingUser(null);
    refresh();
  }

  function closeAdd() {
    setShowAdd(false);
    setAddEmail("");
    setFoundUser(null);
    setAddRoles([]);
    setAddError("");
  }

  async function handleFindUser() {
    setAddPending(true);
    setAddError("");
    const result = await findUserByEmail(addEmail);
    setAddPending(false);
    if (result.error) {
      setAddError(result.error);
      return;
    }
    setFoundUser(result.user ?? null);
  }

  async function handleAddToCompany() {
    if (!foundUser) return;
    setAddPending(true);
    setAddError("");
    const result = await addUserToCompany(foundUser.id, addRoles);
    setAddPending(false);
    if (result?.error) {
      setAddError(result.error);
      return;
    }
    closeAdd();
    refresh();
  }

  function handleRemoveFromCompany(u: Profile) {
    setReassign({ user: u, mode: "remove" });
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
        <div className="chip-row no-margin">
          <button className="btn-ghost" onClick={() => setShowAdd(true)}>
            + Add Existing User
          </button>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + Create New User
          </button>
        </div>
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
        <>
        {/* Its own scroll box. The permission columns sit past the right
            edge on anything narrower than a wide desktop, and without
            this the only way to reach them is the page's own scrollbar
            pinned to the bottom of a long table -- so the switches read
            as missing rather than as off-screen. */}
        {hasHiddenColumns && (
          <p className="ur-scroll-hint">
            More columns to the right — <strong>Can Delete Leads</strong>,{" "}
            <strong>Dispatch Supervisor</strong>, <strong>View Estimates</strong> and{" "}
            <strong>Create Estimates</strong>. Scroll the table sideways to reach them.
          </p>
        )}
        <div className="ur-table-scroll" ref={tableScrollRef}>
        <table className="data-table ur-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Roles</th>
              <th>Can Delete Leads</th>
              <th>Dispatch Supervisor</th>
              <th>View Estimates</th>
              <th>Create Estimates</th>
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
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => openEdit(u)}
                      aria-label="Edit user"
                      title="Edit name, email, phone"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setReassign({ user: u, mode: "standalone" })}
                      aria-label="Reassign work"
                      title="Hand this person's leads, appointments and tasks to someone else"
                    >
                      ⇄
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => handleRemoveFromCompany(u)}
                      aria-label="Remove from company"
                      title="Remove from this company"
                    >
                      🏢✕
                    </button>
                  </div>
                </td>
                <td>{u.email}</td>
                <td>{u.phone || <span className="ur-add-phone">+ Add phone</span>}</td>
                <td>
                  <div className="ur-role-badges">
                    {APP_ROLES.map((role) => {
                      const active = u.roles.includes(role);
                      // Shown but not operable, so it is clear the role
                      // exists and who holds it -- just not yours to grant.
                      const locked = (role === "Admin" && !isAdmin) || isSuperAdmin(u);
                      return (
                        <button
                          key={role}
                          type="button"
                          className="ur-toggle-btn"
                          disabled={locked}
                          onClick={() => !locked && handleToggleRole(u, role)}
                          title={
                            isSuperAdmin(u)
                              ? "Protected account — roles can only be changed in the database"
                              : locked
                                ? "Only an Admin can grant or remove the Admin role"
                              : active
                                ? `Remove ${role}`
                                : `Add ${role}`
                          }
                        >
                          <Badge color={active ? "#2D5F8A" : "#B9B3A3"}>
                            {role}
                          </Badge>
                        </button>
                      );
                    })}
                    {isSuperAdmin(u) && (
                      <Badge color="#6b46c1">Protected</Badge>
                    )}
                    {u.roles.length === 0 && (
                      <span className="ur-add-phone">No roles</span>
                    )}
                  </div>
                </td>
                <td>
                  {u.roles.includes("Office") ? (
                    <span className="ur-add-phone">Always (Office)</span>
                  ) : u.roles.includes("Sales") ? (
                    <button
                      type="button"
                      className="ur-toggle-btn"
                      onClick={() => handleToggleCanDelete(u)}
                      title={
                        u.can_delete_leads
                          ? "Turn off delete access"
                          : "Turn on delete access"
                      }
                    >
                      <span
                        className={
                          "toggle-track" + (u.can_delete_leads ? " toggle-on" : "")
                        }
                      >
                        <span className="toggle-thumb" />
                      </span>
                    </button>
                  ) : (
                    <span className="ur-add-phone">—</span>
                  )}
                </td>
                {/* Only offered on Dispatch users: the flag means "a
                    dispatcher who runs the desk" -- whole book, new leads,
                    new sources, assigning dispatchers -- and the database
                    checks for the Dispatch role alongside it, so on anyone
                    else the switch would appear to do nothing. */}
                <td>
                  {u.roles.includes("Dispatch") &&
                  !u.roles.includes("Office") &&
                  !u.roles.includes("Admin") ? (
                    <button
                      type="button"
                      className="ur-toggle-btn"
                      onClick={() => handleToggleDispatchSupervisor(u)}
                      title={
                        u.is_dispatch_supervisor
                          ? "Back to own leads only"
                          : "Supervisor: sees every lead, enters new leads and sources, assigns dispatchers"
                      }
                    >
                      <span
                        className={
                          "toggle-track" + (u.is_dispatch_supervisor ? " toggle-on" : "")
                        }
                      >
                        <span className="toggle-thumb" />
                      </span>
                    </button>
                  ) : u.roles.includes("Office") || u.roles.includes("Admin") ? (
                    <span className="ur-add-phone">Always</span>
                  ) : (
                    <span className="ur-add-phone">—</span>
                  )}
                </td>
                {/* Office and Admin hold both rights unconditionally, so
                    they show as fixed rather than as a switch that would
                    appear to do nothing when flipped. */}
                <td>
                  {u.roles.includes("Office") || u.roles.includes("Admin") ? (
                    <span className="ur-add-phone">Always</span>
                  ) : (
                    <button
                      type="button"
                      className="ur-toggle-btn"
                      onClick={() => handleToggleViewEstimates(u)}
                      title={
                        u.can_view_estimates
                          ? "Turn off access to estimates"
                          : "Let this person open estimates"
                      }
                    >
                      <span
                        className={
                          "toggle-track" + (u.can_view_estimates ? " toggle-on" : "")
                        }
                      >
                        <span className="toggle-thumb" />
                      </span>
                    </button>
                  )}
                </td>
                <td>
                  {u.roles.includes("Office") || u.roles.includes("Admin") ? (
                    <span className="ur-add-phone">Always</span>
                  ) : (
                    <button
                      type="button"
                      className="ur-toggle-btn"
                      onClick={() => handleToggleCreateEstimates(u)}
                      title={
                        u.can_create_estimates
                          ? "Turn off writing estimates"
                          : "Let this person write estimates (also grants view)"
                      }
                    >
                      <span
                        className={
                          "toggle-track" + (u.can_create_estimates ? " toggle-on" : "")
                        }
                      >
                        <span className="toggle-thumb" />
                      </span>
                    </button>
                  )}
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
        </div>
        </>
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
              {assignableRoles.map((role) => (
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

      {showAdd && (
        <Modal title="Add Existing User" onClose={closeAdd}>
          <p className="hint-note">
            Grant access to this company for someone who already has an
            account — e.g. a teammate who works at another company you also
            manage.
          </p>
          {!foundUser ? (
            <>
              <Field label="Email">
                <input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleFindUser();
                    }
                  }}
                  placeholder="their@email.com"
                  autoFocus
                />
              </Field>
              {addError && <p className="error-note">{addError}</p>}
              <div className="modal-actions">
                <div />
                <div>
                  <button className="btn-ghost" onClick={closeAdd}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={handleFindUser} disabled={addPending}>
                    {addPending ? "Searching…" : "Find User"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="hint-note">
                Found <strong>{foundUser.name || foundUser.email}</strong> ({foundUser.email}).
                Choose their roles in this company:
              </p>
              <Field label="Roles">
                <div className="segmented">
                  {assignableRoles.map((role) => (
                    <button
                      key={role}
                      type="button"
                      className={"segmented-btn" + (addRoles.includes(role) ? " active" : "")}
                      onClick={() =>
                        setAddRoles((prev) =>
                          prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
                        )
                      }
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </Field>
              {addError && <p className="error-note">{addError}</p>}
              <div className="modal-actions">
                <div />
                <div>
                  <button className="btn-ghost" onClick={() => setFoundUser(null)} disabled={addPending}>
                    Back
                  </button>
                  <button className="btn-primary" onClick={handleAddToCompany} disabled={addPending}>
                    {addPending ? "Adding…" : "Add to Company"}
                  </button>
                </div>
              </div>
            </>
          )}
        </Modal>
      )}

      {reassign && (
        <ReassignWorkModal
          user={reassign.user}
          // Never offer to hand work to the person losing it, or to
          // someone archived who can't act on it.
          others={users.filter((u) => u.id !== reassign.user.id && u.status === "Active")}
          mode={reassign.mode}
          onCancel={() => setReassign(null)}
          onConfirmed={finishReassign}
        />
      )}

      {editingUser && (
        <Modal title="Edit User" onClose={() => setEditingUser(null)}>
          <div className="form-grid">
            <Field label="Name">
              <input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              />
            </Field>
            <Field label="Phone">
              <input
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </Field>
            <Field label="New Password">
              <input
                type="text"
                value={editForm.password}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="Leave blank to keep current password"
              />
            </Field>
          </div>
          <p className="hint-note">
            Changing email updates their login email too — they&apos;ll sign
            in with the new address going forward. Only fill in New Password
            if you want to reset it.
          </p>
          {editError && <p className="error-note">{editError}</p>}
          <div className="modal-actions">
            <div />
            <div>
              <button className="btn-ghost" onClick={() => setEditingUser(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleSaveEdit}
                disabled={editPending}
              >
                {editPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
