import type { OpenPlaySession, Registration } from "./types";

export function isLiveOpenPlaySession(session: OpenPlaySession, now = new Date()) {
  if (!("live_started_at" in session)) {
    return session.status === "active"
      && (!session.scheduled_start || new Date(session.scheduled_start) <= now);
  }
  return session.status === "active" && Boolean(session.live_started_at);
}

export function registrationsForSession(registrations: Registration[], sessionId?: string | null) {
  return sessionId ? registrations.filter((registration) => registration.session_id === sessionId) : [];
}
