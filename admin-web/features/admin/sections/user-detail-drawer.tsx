"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Drawer, Badge, ConfirmDialog } from "@/components/admin-ui";
import { banUser, unbanUser } from "@/lib/admin-data";
import type { AdminUser } from "@/lib/types";

function UserAvatar({ user }: { user: AdminUser }) {
  const initials = user.display_name
    ? user.display_name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  return (
    <div className="avatar avatar-lg">
      {user.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatar_url} alt={user.display_name} />
      ) : (
        initials
      )}
    </div>
  );
}

export default function UserDetailDrawer({
  user,
  onClose,
  onUpdated,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [unbanDialogOpen, setUnbanDialogOpen] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const handleBan = async () => {
    if (!banReason.trim()) {
      toast.error("A ban reason is required.");
      return;
    }
    setBusy(true);
    try {
      await banUser(user.id, banReason.trim());
      toast.success(`${user.display_name} has been banned.`);
      setBanDialogOpen(false);
      setBanReason("");
      onUpdated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to ban user.");
    } finally {
      setBusy(false);
    }
  };

  const handleUnban = async () => {
    setBusy(true);
    try {
      await unbanUser(user.id);
      toast.success(`${user.display_name} has been unbanned.`);
      setUnbanDialogOpen(false);
      onUpdated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unban user.");
    } finally {
      setBusy(false);
    }
  };

  const joinDate = new Date(user.created_at).toLocaleDateString("en-AU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <Drawer open={!!user} onClose={onClose} title="User Details">
        <div className="drawer-profile">
          <UserAvatar user={user} />
          <div>
            <h3 className="drawer-profile-name">{user.display_name}</h3>
            {user.email && <p className="drawer-profile-email">{user.email}</p>}
          </div>
        </div>

        <div className="drawer-fields">
          <div className="drawer-field">
            <span className="drawer-field-label">STATUS</span>
            <Badge status={user.is_banned ? "banned" : "active"} />
          </div>

          <div className="drawer-field">
            <span className="drawer-field-label">MEMBER SINCE</span>
            <span className="drawer-field-value">{joinDate}</span>
          </div>

          {user.rating !== null && (
            <div className="drawer-field">
              <span className="drawer-field-label">RATING</span>
              <span className="drawer-field-value">{user.rating.toFixed(1)}</span>
            </div>
          )}

          {user.membership_tier && (
            <div className="drawer-field">
              <span className="drawer-field-label">MEMBERSHIP</span>
              <span className="drawer-field-value">{user.membership_tier}</span>
            </div>
          )}

          {user.is_banned && user.ban_reason && (
            <div className="drawer-field drawer-field-full">
              <span className="drawer-field-label">BAN REASON</span>
              <span className="drawer-field-value">{user.ban_reason}</span>
            </div>
          )}
        </div>

        <div className="drawer-actions">
          {user.is_banned ? (
            <button
              className="button button-ghost"
              onClick={() => setUnbanDialogOpen(true)}
              disabled={busy}
            >
              Unban User
            </button>
          ) : (
            <button
              className="button button-danger"
              onClick={() => setBanDialogOpen(true)}
              disabled={busy}
            >
              Ban User
            </button>
          )}
        </div>
      </Drawer>

      {/* Ban dialog with reason input */}
      {banDialogOpen && (
        <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) setBanDialogOpen(false); }}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-label="Ban user">
            <h3 className="dialog-title">Ban {user.display_name}?</h3>
            <p className="dialog-message">
              This will prevent the user from accessing Peakle. Please provide a reason.
            </p>
            <div className="form-field" style={{ marginBottom: 16 }}>
              <label htmlFor="ban-reason">BAN REASON</label>
              <textarea
                id="ban-reason"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Describe the reason for banning this user…"
                rows={3}
                style={{ resize: "vertical" }}
              />
            </div>
            <div className="dialog-actions">
              <button className="button button-ghost" onClick={() => { setBanDialogOpen(false); setBanReason(""); }}>
                Cancel
              </button>
              <button
                className="button button-danger"
                onClick={handleBan}
                disabled={busy || !banReason.trim()}
              >
                {busy ? "Banning…" : "Ban User"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={unbanDialogOpen}
        title={`Unban ${user.display_name}?`}
        message="This will restore the user's access to Peakle."
        confirmLabel={busy ? "Unbanning…" : "Unban User"}
        onConfirm={handleUnban}
        onCancel={() => setUnbanDialogOpen(false)}
      />
    </>
  );
}
