import { DEMO_USER_ID } from "./demo-mode";
import type { OrganizerNotification } from "./notifications";

// DEMO MODE — see demo-mode.ts. Timestamps are relative to "now" so the demo
// always groups sensibly under Today / This week / Earlier.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();

export function buildDemoNotifications(): OrganizerNotification[] {
  return [
    { id: "demo-notif-1", user_id: DEMO_USER_ID, session_id: "demo-session-live-night", booking_id: null, kind: "approval", title: "New registration to review", body: "Diane Ocampo requested to join Friday Night Open Play.", data: {}, read_at: null, created_at: hoursAgo(0.3) },
    { id: "demo-notif-2", user_id: DEMO_USER_ID, session_id: "demo-session-live-night", booking_id: null, kind: "waitlist_promotion", title: "Player moved off the waitlist", body: "Pat Rivera was promoted into Friday Night Open Play.", data: {}, read_at: null, created_at: hoursAgo(1) },
    { id: "demo-notif-3", user_id: DEMO_USER_ID, session_id: null, booking_id: "demo-booking-5", kind: "booking_confirmed", title: "New court booking", body: "Mae Chua booked Court 2 for 2 hours today.", data: {}, read_at: null, created_at: hoursAgo(2) },
    { id: "demo-notif-4", user_id: DEMO_USER_ID, session_id: "demo-session-live-night", booking_id: null, kind: "court_assignment", title: "Court assignment updated", body: "Center Court now has Ari Flores, CJ Ramos, Kim Dela Cruz, and Jo Tan.", data: {}, read_at: hoursAgo(3), created_at: hoursAgo(4) },
    { id: "demo-notif-5", user_id: DEMO_USER_ID, session_id: null, booking_id: null, kind: "result", title: "Match result posted", body: "Mika Santos advanced in Open Singles, 11–4.", data: {}, read_at: hoursAgo(2), created_at: hoursAgo(6) },
    { id: "demo-notif-6", user_id: DEMO_USER_ID, session_id: null, booking_id: null, kind: "venue_announcement", title: "Payout scheduled", body: "Your Monday payout of ₱48,250 is on its way to your linked account.", data: {}, read_at: null, created_at: daysAgo(1) },
    { id: "demo-notif-7", user_id: DEMO_USER_ID, session_id: null, booking_id: "demo-booking-3", kind: "cancellation", title: "Booking cancelled", body: "Theo Yu cancelled a Court 3 booking. A refund was issued automatically.", data: {}, read_at: daysAgo(1), created_at: daysAgo(2) },
    { id: "demo-notif-8", user_id: DEMO_USER_ID, session_id: null, booking_id: null, kind: "direct_message", title: "New message from staff", body: "Carlo Villanueva: \"Court 6 resurfacing is booked for next week.\"", data: {}, read_at: daysAgo(2), created_at: daysAgo(3) },
    { id: "demo-notif-9", user_id: DEMO_USER_ID, session_id: "demo-session-live-rookies", booking_id: null, kind: "check_in_reminder", title: "Players waiting to check in", body: "2 players are checked in and waiting for Rookie Rotation to start.", data: {}, read_at: daysAgo(4), created_at: daysAgo(5) },
    { id: "demo-notif-10", user_id: DEMO_USER_ID, session_id: null, booking_id: null, kind: "venue_announcement", title: "Venue verification renewed", body: "Peakle Arena BGC's verification status was renewed for another year.", data: {}, read_at: daysAgo(10), created_at: daysAgo(11) },
  ];
}
