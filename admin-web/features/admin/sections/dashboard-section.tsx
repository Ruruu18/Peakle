"use client";

import { useEffect, useState } from "react";
import { Users, Building2, Calendar, TrendingUp, UserPlus, CheckCircle, Clock, UserX } from "lucide-react";
import { StatCard } from "@/components/admin-ui";
import { fetchAdminStats, fetchRecentActivity, fetchSessionsTrend } from "@/lib/admin-data";
import type { AdminStats, ActivityItem, MonthlySessionCount } from "@/lib/types";

function Skeleton({
  width,
  height,
  style,
}: {
  width?: string;
  height?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="skeleton"
      style={{ width: width ?? "100%", height: height ?? "16px", ...style }}
    />
  );
}

function ActivityIcon({ type }: { type: ActivityItem["type"] }) {
  switch (type) {
    case "user_joined": return <UserPlus size={14} />;
    case "venue_approved": return <CheckCircle size={14} />;
    case "venue_pending": return <Clock size={14} />;
    case "user_banned": return <UserX size={14} />;
  }
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString("en-AU", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function MiniBarChart({ months }: { months: MonthlySessionCount[] }) {
  const max = Math.max(...months.map((m) => m.value), 1);

  return (
    <div className="mini-chart">
      <div className="mini-chart-bars">
        {months.map((m) => (
          <div key={m.label} className="mini-chart-col">
            <div
              className="mini-chart-bar"
              style={{ height: `${Math.max((m.value / max) * 100, 4)}%` }}
              title={`${m.value} sessions`}
            />
            <span className="mini-chart-label">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardSection() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [trend, setTrend] = useState<MonthlySessionCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchAdminStats(), fetchRecentActivity(), fetchSessionsTrend()])
      .then(([s, a, t]) => {
        if (!alive) return;
        setStats(s);
        setActivity(a);
        setTrend(t);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard data.");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <div className="section-content">
      <div className="page-head">
        <div>
          <p className="eyebrow">PLATFORM OVERVIEW</p>
          <h1>Dashboard</h1>
          <p>Real-time platform health, key metrics, and recent activity.</p>
        </div>
      </div>

      {error && (
        <div className="notice warning" style={{ marginBottom: 24 }}>
          <strong>Error loading data</strong>
          <span>{error}</span>
        </div>
      )}

      {/* KPI Grid */}
      <div className="stat-grid">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="stat-card">
              <Skeleton height="32px" width="32px" />
              <Skeleton height="36px" width="60%" style={{ marginTop: 16 }} />
              <Skeleton height="12px" width="80%" style={{ marginTop: 8 }} />
            </div>
          ))
        ) : (
          <>
            <StatCard
              label="Total Users"
              value={fmt(stats?.total_users ?? 0)}
              icon={Users}
              trend="up"
            />
            <StatCard
              label="Active Venues"
              value={fmt(stats?.active_venues ?? 0)}
              icon={Building2}
              trend="neutral"
            />
            <StatCard
              label="Sessions This Month"
              value={fmt(stats?.sessions_this_month ?? 0)}
              icon={Calendar}
              trend="up"
            />
            <StatCard
              label="Gross Revenue"
              value={`₱${(stats?.gross_revenue ?? 0).toLocaleString("en-PH")}`}
              sub="This month"
              icon={TrendingUp}
              trend="neutral"
            />
          </>
        )}
      </div>

      <div className="dashboard-row">
        {/* Chart card */}
        <div className="card card-pad chart-card">
          <div className="card-head">
            <h2 className="card-title">Sessions Activity</h2>
            <span className="card-sub">Last 6 months</span>
          </div>
          {loading ? (
            <div className="chart-skeleton">
              <Skeleton height="140px" />
            </div>
          ) : (
            <MiniBarChart months={trend} />
          )}
        </div>

        {/* Activity feed */}
        <div className="card card-pad activity-card">
          <div className="card-head">
            <h2 className="card-title">Recent Activity</h2>
          </div>
          {loading ? (
            <div className="activity-list">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="activity-row">
                  <Skeleton width="32px" height="32px" style={{ borderRadius: "50%", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <Skeleton height="12px" width="70%" />
                    <Skeleton height="10px" width="40%" style={{ marginTop: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="empty-state">No recent activity.</p>
          ) : (
            <div className="activity-list">
              {activity.map((item) => (
                <div key={item.id} className={`activity-row activity-${item.type}`}>
                  <div className="activity-icon">
                    <ActivityIcon type={item.type} />
                  </div>
                  <div className="activity-info">
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <time className="activity-time" dateTime={item.created_at}>
                    {formatDate(item.created_at)}
                  </time>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
