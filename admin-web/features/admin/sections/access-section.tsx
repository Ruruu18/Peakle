"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/admin-ui";
import { fetchPlatformAdmins, addPlatformAdmin, removePlatformAdmin } from "@/lib/admin-data";
import type { PlatformAdmin } from "@/lib/types";
import { useAuth } from "@/components/providers";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  try {
    return new Date(dateStr).toLocaleDateString("en-AU", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

// ─── Admins Tab ──────────────────────────────────────────────────────────────

function AdminsTab() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<PlatformAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [addInput, setAddInput] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PlatformAdmin | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPlatformAdmins();
      setAdmins(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load admins.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addInput.trim()) return;
    setAddBusy(true);
    try {
      await addPlatformAdmin(addInput.trim());
      toast.success("Admin added.");
      setAddInput("");
      setAddOpen(false);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add admin.");
    } finally {
      setAddBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoveBusy(true);
    try {
      await removePlatformAdmin(removeTarget.user_id);
      toast.success("Admin removed.");
      setRemoveTarget(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove admin.");
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <>
      <div className="section-toolbar">
        <h2 className="section-subtitle">Platform Administrators</h2>
        <button className="button button-accent" onClick={() => setAddOpen(true)}>
          <UserPlus size={15} /> Add Admin
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="table-loading">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="table-skeleton-row">
                <div className="skeleton" style={{ width: "34px", height: "34px", borderRadius: "50%" }} />
                <div className="skeleton" style={{ flex: 1, height: "13px" }} />
                <div className="skeleton" style={{ width: "100px", height: "13px" }} />
                <div className="skeleton" style={{ width: "80px", height: "13px" }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Admin</th>
                  <th>Granted</th>
                  <th>Granted By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {admins.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="data-table-empty">No platform admins found.</td>
                  </tr>
                ) : (
                  admins.map((admin) => {
                    const isSelf = user?.id === admin.user_id;
                    return (
                      <tr key={admin.user_id}>
                        <td>
                          <div className="user-cell">
                            <div className="avatar avatar-sm">
                              {(admin.display_name ?? "?")
                                .split(" ")
                                .map((w) => w[0])
                                .slice(0, 2)
                                .join("")
                                .toUpperCase()}
                            </div>
                            <div>
                              <span className="user-name">{admin.display_name}</span>
                              {isSelf && <span className="self-badge">You</span>}
                            </div>
                          </div>
                        </td>
                        <td>{formatDate(admin.granted_at)}</td>
                        <td>{admin.granted_by_name ?? "—"}</td>
                        <td>
                          <button
                            className="icon-button icon-button-sm icon-button-danger"
                            title={isSelf ? "Cannot remove yourself" : "Remove admin"}
                            disabled={isSelf}
                            onClick={() => !isSelf && setRemoveTarget(admin)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addOpen && (
        <div
          className="dialog-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setAddOpen(false); }}
        >
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Add platform admin">
            <h3 className="dialog-title">Add Platform Admin</h3>
            <p className="dialog-message">
              Enter the email address of the Peakle user to grant admin access.
            </p>
            <form onSubmit={handleAdd}>
              <div className="form-field">
                <label htmlFor="add-admin-input">EMAIL</label>
                <input
                  id="add-admin-input"
                  type="email"
                  value={addInput}
                  onChange={(e) => setAddInput(e.target.value)}
                  placeholder="user@example.com"
                  required
                  autoFocus
                />
              </div>
              <div className="dialog-actions">
                <button type="button" className="button button-ghost" onClick={() => setAddOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-accent" disabled={addBusy}>
                  {addBusy ? "Adding…" : "Add Admin"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!removeTarget}
        title={`Remove ${removeTarget?.display_name} as admin?`}
        message="This will revoke their platform admin privileges immediately."
        confirmLabel={removeBusy ? "Removing…" : "Remove Admin"}
        danger
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </>
  );
}

// ─── Access Section ──────────────────────────────────────────────────────────

export default function AccessSection() {
  return (
    <div className="section-content">
      <div className="page-head">
        <div>
          <p className="eyebrow">ACCESS CONTROL</p>
          <h1>Access</h1>
          <p>Manage platform administrator accounts.</p>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <AdminsTab />
      </div>
    </div>
  );
}
