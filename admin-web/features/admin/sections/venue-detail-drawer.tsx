"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MapPin, Building2, Hash } from "lucide-react";
import { Drawer, Badge, ConfirmDialog } from "@/components/admin-ui";
import { updateVenueStatus } from "@/lib/admin-data";
import type { AdminVenue } from "@/lib/types";

type VenueAction = "approve" | "reject" | "suspend";

const ACTION_CONFIG: Record<VenueAction, { label: string; confirm: string; danger: boolean; status: AdminVenue["verification_status"] }> = {
  approve: {
    label: "Approve",
    confirm: "This will allow the venue to host sessions on Peakle.",
    danger: false,
    status: "verified",
  },
  reject: {
    label: "Reject",
    confirm: "This will decline the venue application. The organizer will need to reapply.",
    danger: true,
    status: "rejected",
  },
  suspend: {
    label: "Suspend",
    confirm: "This will immediately suspend the venue and prevent new bookings.",
    danger: true,
    status: "suspended",
  },
};

export default function VenueDetailDrawer({
  venue,
  onClose,
  onUpdated,
}: {
  venue: AdminVenue | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [pendingAction, setPendingAction] = useState<VenueAction | null>(null);
  const [busy, setBusy] = useState(false);

  if (!venue) return null;

  const handleAction = async (action: VenueAction) => {
    setBusy(true);
    try {
      const cfg = ACTION_CONFIG[action];
      await updateVenueStatus(venue.id, cfg.status);
      toast.success(`Venue ${action}d successfully.`);
      setPendingAction(null);
      onUpdated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action} venue.`);
    } finally {
      setBusy(false);
    }
  };

  const isApproved = venue.verification_status === "verified" || venue.verification_status === "approved";
  const isRejected = venue.verification_status === "rejected";
  const isSuspended = venue.verification_status === "suspended";

  const createdDate = new Date(venue.created_at).toLocaleDateString("en-AU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <Drawer open={!!venue} onClose={onClose} title="Venue Details">
        <div className="drawer-venue-header">
          <div className="venue-icon">
            <Building2 size={24} />
          </div>
          <div>
            <h3 className="drawer-profile-name">{venue.name}</h3>
            <Badge status={venue.verification_status} />
          </div>
        </div>

        <div className="drawer-fields">
          {venue.area && (
            <div className="drawer-field">
              <span className="drawer-field-label">AREA</span>
              <span className="drawer-field-value">
                <MapPin size={12} style={{ display: "inline", marginRight: 4 }} />
                {venue.area}
              </span>
            </div>
          )}

          {venue.address && (
            <div className="drawer-field drawer-field-full">
              <span className="drawer-field-label">ADDRESS</span>
              <span className="drawer-field-value">{venue.address}</span>
            </div>
          )}

          <div className="drawer-field">
            <span className="drawer-field-label">COURTS</span>
            <span className="drawer-field-value">
              <Hash size={12} style={{ display: "inline", marginRight: 4 }} />
              {venue.court_count}
            </span>
          </div>

          <div className="drawer-field">
            <span className="drawer-field-label">APPLIED</span>
            <span className="drawer-field-value">{createdDate}</span>
          </div>

          {venue.organizer_name && (
            <div className="drawer-field">
              <span className="drawer-field-label">ORGANIZER</span>
              <span className="drawer-field-value">{venue.organizer_name}</span>
            </div>
          )}

          {venue.organizer_email && (
            <div className="drawer-field">
              <span className="drawer-field-label">ORGANIZER EMAIL</span>
              <span className="drawer-field-value">{venue.organizer_email}</span>
            </div>
          )}
        </div>

        <div className="drawer-actions">
          {!isApproved && (
            <button
              className="button button-accent"
              onClick={() => setPendingAction("approve")}
              disabled={busy}
            >
              Approve
            </button>
          )}
          {!isRejected && (
            <button
              className="button button-ghost"
              onClick={() => setPendingAction("reject")}
              disabled={busy}
            >
              Reject
            </button>
          )}
          {!isSuspended && (
            <button
              className="button button-danger"
              onClick={() => setPendingAction("suspend")}
              disabled={busy}
            >
              Suspend
            </button>
          )}
        </div>
      </Drawer>

      {pendingAction && (
        <ConfirmDialog
          open
          title={`${ACTION_CONFIG[pendingAction].label} "${venue.name}"?`}
          message={ACTION_CONFIG[pendingAction].confirm}
          confirmLabel={busy ? "Processing…" : ACTION_CONFIG[pendingAction].label}
          danger={ACTION_CONFIG[pendingAction].danger}
          onConfirm={() => handleAction(pendingAction)}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </>
  );
}
