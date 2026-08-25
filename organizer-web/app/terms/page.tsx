import type { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

export const metadata: Metadata = { title: "Terms of Service · Peakle" };

export default function TermsPage() {
  return <main className={styles.page}><div className={styles.shell}>
    <Link href="/" className={styles.brand}><span className={styles.mark}>●</span>Peakle</Link>
    <header className={styles.hero}><p className={styles.eyebrow}>Peakle legal</p><h1>Terms of Service</h1><p className={styles.effective}>Effective August 20, 2026</p><p className={styles.lead}>These terms govern access to and use of Peakle, including accounts, bookings, payments, teams, messages, scoring, and other player services.</p></header>
    <div className={styles.content}>
      <section className={styles.section}><h2>1. Your account</h2><p>Provide accurate information, protect your credentials, and promptly report unauthorized access. You are responsible for activity performed through your account unless you notify Peakle without unreasonable delay.</p></section>
      <section className={styles.section}><h2>2. Bookings, venues, and payments</h2><p>Availability, prices, operating hours, venue rules, cancellation terms, and booking acceptance are controlled by the applicable venue. Review every booking and payment before confirming. Refund eligibility follows the policy shown for that booking.</p></section>
      <section className={styles.section}><h2>3. Fair use and community safety</h2><p>Do not impersonate others, submit fraudulent information, harass users, violate privacy, interfere with security, or use Peakle unlawfully. Chat is limited to users who confirm they are at least 18 and is subject to reporting, blocking, filtering, and proportionate moderation.</p></section>
      <section className={styles.section}><h2>4. Your content</h2><p>You retain ownership of content you submit and grant Peakle a limited license to host, process, display, and share it only as required to provide the features you select. You are responsible for ensuring content is lawful and respects others’ rights.</p></section>
      <section className={styles.section}><h2>5. Availability, termination, and responsibility</h2><p>Peakle is provided on an as-available basis. Sports activities involve physical risks. Peakle may restrict access to protect users, venues, the service, or the public. You may stop using Peakle and permanently delete your account at any time.</p></section>
      <section className={styles.section}><h2>6. Governing law and contact</h2><p>These terms are governed by the laws of the Republic of the Philippines without limiting mandatory consumer protections. Questions may be sent to <a href="mailto:support@peakle.app">support@peakle.app</a>.</p><div className={styles.links}><Link href="/privacy">Privacy Policy</Link><Link href="/account-deletion">Account deletion</Link></div></section>
    </div>
  </div></main>;
}
