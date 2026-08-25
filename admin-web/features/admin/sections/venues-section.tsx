"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { Tabs, Badge } from "@/components/admin-ui";
import { fetchVenues } from "@/lib/admin-data";
import type { AdminVenue } from "@/lib/types";
import VenueDetailDrawer from "./venue-detail-drawer";

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-AU", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export default function VenuesSection() {
  const [allVenues, setAllVenues] = useState<AdminVenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "pending">("all");
  const [selectedVenue, setSelectedVenue] = useState<AdminVenue | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchVenues("all");
      setAllVenues(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load venues.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const pendingVenues = allVenues.filter((v) => v.verification_status === "pending");
  const displayedVenues = activeTab === "pending" ? pendingVenues : allVenues;

  const tabs = [
    { id: "all", label: "All Venues", count: allVenues.length },
    { id: "pending", label: "Pending Approval", count: pendingVenues.length },
  ] as const;

  return (
    <div className="section-content">
      <div className="page-head">
        <div>
          <p className="eyebrow">VENUE MANAGEMENT</p>
          <h1>Venues</h1>
          <p>Review applications, approve venues, and manage their platform status.</p>
        </div>
      </div>

      <Tabs
        tabs={[...tabs]}
        active={activeTab}
        onChange={(id) => setActiveTab(id as "all" | "pending")}
      />

      {error && (
        <div className="notice warning" style={{ margin: "16px 0" }}>
          <strong>Error</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        {loading ? (
          <div className="table-loading">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="table-skeleton-row">
                <div className="skeleton" style={{ flex: 2, height: "13px" }} />
                <div className="skeleton" style={{ width: "80px", height: "13px" }} />
                <div className="skeleton" style={{ width: "40px", height: "13px" }} />
                <div className="skeleton" style={{ width: "70px", height: "22px", borderRadius: "20px" }} />
                <div className="skeleton" style={{ width: "80px", height: "13px" }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Area</th>
                  <th>Courts</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {displayedVenues.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="data-table-empty">
                      <Building2 size={32} style={{ opacity: 0.3, display: "block", margin: "0 auto 8px" }} />
                      {activeTab === "pending"
                        ? "No venues pending approval."
                        : "No venues found."}
                    </td>
                  </tr>
                ) : (
                  displayedVenues.map((venue) => (
                    <tr
                      key={venue.id}
                      className="data-table-row-clickable"
                      onClick={() => setSelectedVenue(venue)}
                    >
                      <td>
                        <div className="venue-name-cell">
                          <Building2 size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                          <span>{venue.name}</span>
                        </div>
                      </td>
                      <td>{venue.area ?? "—"}</td>
                      <td>{venue.court_count}</td>
                      <td><Badge status={venue.verification_status} /></td>
                      <td>{formatDate(venue.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <VenueDetailDrawer
        venue={selectedVenue}
        onClose={() => setSelectedVenue(null)}
        onUpdated={() => void load()}
      />
    </div>
  );
}
