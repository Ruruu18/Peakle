import type { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy · Peakle",
  description: "How Peakle collects, uses, protects, retains, and deletes personal data.",
};

const sections = [
  ["1. Data we collect", "Peakle collects account information (name, email, authentication provider, profile image, and push token); player details (home area, rating, and play preferences); content and activity (bookings, payments, teams, messages, uploaded media, match scores, reports, blocks, and settings); and limited technical data (app version, device type, crash data, performance traces, and security events)."],
  ["2. Location information", "With permission, Peakle uses approximate or precise foreground location to sort nearby courts, teams, and players and to turn coordinates into a general area label. Nearby Player visibility is optional, works while the app is active, and shows other players approximate distance—not exact coordinates. You may use manual area search and withdraw location permission in Android settings."],
  ["3. Photos, video, microphone, and notifications", "The system photo picker opens only when you choose media to upload. A match card is saved only when you choose Save. When you activate shouted-score recognition, the selected Android speech service processes microphone audio into text; Peakle does not intentionally store the raw recording. Push permission and a device token are used only for Peakle notifications."],
  ["4. How data is used", "Data is used to create and secure accounts; provide bookings, payments, teams, chat, scoring, profiles, matching, and notifications; prevent fraud and abuse; diagnose reliability problems; respond to requests; and meet legal obligations."],
  ["5. Service providers and sharing", "Peakle uses Supabase for authentication, database, storage, and server functions; Expo and Firebase for push delivery; Sentry for limited crash and performance diagnostics; Google for optional sign-in, speech recognition, and map services; and PayMongo plus the applicable venue for requested payments, bookings, memberships, and refunds. Data is shared with other players only through features you choose. Peakle does not sell personal data."],
  ["6. Retention and deletion", "Account, profile, private-message, team-chat, presence, push-token, and user-owned media records are removed when account deletion completes. Crash and performance diagnostics are retained for no longer than 90 days and support correspondence for up to 24 months. Payment, refund, fraud-prevention, dispute, and tax records may be retained only as required by applicable law or an active dispute, with account identity removed or minimized where possible."],
  ["7. Security and international processing", "Peakle uses organizational and technical safeguards, encrypted network connections, access controls, and row-level database security. Providers may process data outside the Philippines under their contractual and data-protection safeguards. No online service can guarantee absolute security."],
  ["8. Your rights and controls", "Subject to applicable law, you may request access, correction, deletion, restriction, objection, portability, or withdrawal of consent. Device permissions can be changed in Android settings. You can permanently delete your account from Peakle under Profile → Settings → Delete account."],
];

export default function PrivacyPage() {
  return <main className={styles.page}><div className={styles.shell}>
    <Link href="/" className={styles.brand}><span className={styles.mark}>●</span>Peakle</Link>
    <header className={styles.hero}><p className={styles.eyebrow}>Your data & choices</p><h1>Privacy Policy</h1><p className={styles.effective}>Effective August 20, 2026</p><p className={styles.lead}>This policy explains how Peakle accesses, collects, uses, shares, protects, retains, and deletes personal data under the Philippine Data Privacy Act of 2012 and other applicable law.</p></header>
    <div className={styles.content}>{sections.map(([title, body]) => <section className={styles.section} key={title}><h2>{title}</h2><p>{body}</p></section>)}</div>
    <section className={styles.section}><h2>9. Contact</h2><p>Peakle is responsible for this policy. Send privacy questions or rights requests to <a href="mailto:support@peakle.app">support@peakle.app</a>. You may also contact the Philippine National Privacy Commission.</p><div className={styles.links}><Link href="/account-deletion">Account deletion</Link><Link href="/terms">Terms of Service</Link></div></section>
    <p className={styles.footer}>Peakle · Philippines · This page is publicly accessible and is the governing privacy policy for the Peakle mobile application.</p>
  </div></main>;
}
