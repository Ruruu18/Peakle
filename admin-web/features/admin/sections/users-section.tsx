"use client";

import { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import { SearchInput, Badge } from "@/components/admin-ui";
import { fetchUsers } from "@/lib/admin-data";
import type { AdminUser } from "@/lib/types";
import UserDetailDrawer from "./user-detail-drawer";

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

export default function UsersSection() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUsers(q);
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => { void load(search); }, 300);
    return () => clearTimeout(timer);
  }, [search, load]);

  return (
    <div className="section-content">
      <div className="page-head">
        <div>
          <p className="eyebrow">PLATFORM USERS</p>
          <h1>
            Users
            {!loading && (
              <span className="page-head-count">{users.length}</span>
            )}
          </h1>
          <p>Search and manage all registered Peakle users.</p>
        </div>
      </div>

      <div className="table-toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by display name or email…"
        />
      </div>

      {error && (
        <div className="notice warning" style={{ marginBottom: 20 }}>
          <strong>Error</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="table-loading">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="table-skeleton-row">
                <div className="skeleton" style={{ width: "34px", height: "34px", borderRadius: "50%" }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: "40%", height: "13px" }} />
                </div>
                <div className="skeleton" style={{ width: "80px", height: "13px" }} />
                <div className="skeleton" style={{ width: "40px", height: "13px" }} />
                <div className="skeleton" style={{ width: "60px", height: "22px", borderRadius: "20px" }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Joined</th>
                  <th>Rating</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="data-table-empty">
                      <Users size={32} style={{ opacity: 0.3, display: "block", margin: "0 auto 8px" }} />
                      {search ? `No users found for "${search}"` : "No users yet."}
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr
                      key={user.id}
                      className="data-table-row-clickable"
                      onClick={() => setSelectedUser(user)}
                    >
                      <td>
                        <div className="user-cell">
                          <div className="avatar avatar-sm">
                            {user.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={user.avatar_url} alt={user.display_name} />
                            ) : (
                              (user.display_name ?? "?")
                                .split(" ")
                                .map((w) => w[0])
                                .slice(0, 2)
                                .join("")
                                .toUpperCase()
                            )}
                          </div>
                          <span className="user-name">{user.display_name}</span>
                        </div>
                      </td>
                      <td>{formatDate(user.created_at)}</td>
                      <td>{user.rating !== null ? user.rating.toFixed(1) : "—"}</td>
                      <td>
                        <Badge status={user.is_banned ? "banned" : "active"} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <UserDetailDrawer
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
        onUpdated={() => void load(search)}
      />
    </div>
  );
}
