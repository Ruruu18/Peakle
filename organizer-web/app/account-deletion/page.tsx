import type { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Delete your Peakle account",
  description: "How to permanently delete a Peakle account and associated personal data.",
};

export default function AccountDeletionPage() {
  return <main className={styles.page}><div className={styles.shell}>
    <Link href="/" className={styles.brand}><span className={styles.mark}>●</span>Peakle</Link>
    <header className={styles.hero}><p className={styles.eyebrow}>Account control</p><h1>Delete your account</h1><p className={styles.lead}>Peakle lets every user — player or organizer — permanently delete their account and associated personal data.</p></header>
    <div className={styles.content}>
      <section className={styles.section}><h2>Delete inside the mobile app</h2><ol><li>Open Peakle and sign in.</li><li>Open <strong>Profile</strong> and select <strong>Settings</strong>.</li><li>Select <strong>Delete account</strong>.</li><li>Type <strong>DELETE</strong>, then confirm <strong>Delete permanently</strong>.</li></ol><p>The app signs you out when deletion completes.</p></section>
      <section className={styles.section}><h2>Organizer web accounts, or if you cannot access the app</h2><p>The organizer web portal does not yet have a self-serve delete option. Email Peakle support from the address registered to your account. Put “Account deletion request” in the subject. Support may verify account ownership before completing the request.</p><a className={styles.action} href="mailto:support@peakle.app?subject=Account%20deletion%20request">Email support@peakle.app</a></section>
      <section className={styles.section}><h2>What is deleted</h2><ul><li>Your authentication account and profile</li><li>Private messages and team-chat content associated with your account</li><li>Presence, matching, push-token, preference, report, and block records</li><li>User-owned profile and chat media</li></ul></section>
      <section className={styles.section}><h2>Limited records that may remain</h2><p>Payment, refund, fraud-prevention, dispute, and tax records may be retained only where required by law or an active dispute. Peakle removes or minimizes the deleted account identity wherever possible. Shared teams are transferred to another member when possible; a team with no other member is removed.</p><div className={styles.links}><Link href="/privacy">Privacy Policy</Link><Link href="/terms">Terms of Service</Link></div></section>
    </div>
    <p className={styles.footer}>Peakle · Account deletion requests are normally processed immediately in the app. Support-assisted requests are handled after ownership verification.</p>
  </div></main>;
}
