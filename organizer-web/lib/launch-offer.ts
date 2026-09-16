// Pilot messaging is temporary. Enable this at build time to restore the
// existing 14-day launch offer, including trial requests during email signup.
export const organizerTrialEnabled = process.env.NEXT_PUBLIC_ORGANIZER_TRIAL_ENABLED === "true";

// Feedback follows testing; it never gates signup. Without a hosted survey,
// open a questionnaire email draft that the tester reviews and sends.
export const pilotFeedbackUrl = process.env.NEXT_PUBLIC_PILOT_FEEDBACK_URL?.trim() || "";
export const pilotFeedbackHref = pilotFeedbackUrl || `mailto:support@peakle.app?subject=${encodeURIComponent("Peakle pilot feedback")}&body=${encodeURIComponent([
  "My role (organizer / player):",
  "Session or group:",
  "What worked well?",
  "What was confusing or difficult?",
  "Did the queue and court assignments feel fair? Why?",
  "Would you use Peakle for another session? Why or why not?",
  "What should we improve first?",
].join("\n\n"))}`;

export const organizerSignupHref = organizerTrialEnabled ? "/register?offer=14-day-trial" : "/register";
export const organizerCtaLabel = organizerTrialEnabled ? "Start 14-day free trial" : "Join the pilot";
export const organizerSiteDescription = organizerTrialEnabled
  ? "Run open play, bookings, competitions, memberships, staff, and venue performance from one court-ready workspace. Try Peakle Organizer for 14 days with no subscription and no booking cut."
  : "Help test Peakle with your pickleball group. Join the pilot, try real sessions with your players, and share feedback before launch.";
export const organizerRegisterTitle = organizerTrialEnabled ? "Start your 14-day organizer trial" : "Create your pilot organizer account";
export const organizerRegisterDescription = organizerTrialEnabled
  ? "Try Peakle Organizer with a ₱0 subscription and 0% Peakle booking fee for 14 days. No credit card required."
  : "Create your organizer account, set up your group’s sessions, and invite your players to test Peakle with you. Share feedback after you play.";
