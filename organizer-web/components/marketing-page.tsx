"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Gauge,
  Headphones,
  Layers3,
  Mail,
  MapPin,
  Menu,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sun,
  TicketCheck,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "./providers";
import { organizerCtaLabel, organizerSignupHref, organizerTrialEnabled, pilotFeedbackHref, pilotFeedbackUrl } from "@/lib/launch-offer";

const offerSectionId = organizerTrialEnabled ? "pricing" : "pilot";
const offerSectionLabel = organizerTrialEnabled ? "Pricing" : "The pilot";

const heroFeature = {
  icon: Activity,
  eyebrow: "LIVE OPERATIONS",
  title: "Keep every court moving",
  detail: "Run check-in, fair-play queues, lineups, scores, and court status from one calm live monitor.",
};

const supportingFeatures = [
  {
    icon: CalendarCheck2,
    eyebrow: "VENUE CONTROL",
    title: "Turn schedules into bookings",
    detail: "Manage courts, availability, open play, and player registrations without jumping between tools.",
    stat: { value: "22/28", label: "spots filled for tonight's open play" },
  },
  {
    icon: Users,
    eyebrow: "PLAYER EXPERIENCE",
    title: "Know who is on court",
    detail: "Keep player profiles, attendance, approvals, memberships, and communication connected.",
    stat: { value: "64", label: "players returning this week" },
  },
  {
    icon: BarChart3,
    eyebrow: "BUSINESS INSIGHT",
    title: "See what is driving growth",
    detail: "Follow revenue, utilization, repeat players, and program performance with reports you can act on.",
    stat: { value: "86%", label: "court utilization, +12% this month" },
  },
] as const;

export default function MarketingPage() {
  const { mode, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    const menuTrigger = menuButtonRef.current;
    const handleMenuKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = mobileMenuRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleMenuKeys);
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", handleMenuKeys);
      menuTrigger?.focus();
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  const scrollToSection = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    const headerHeight = document.querySelector<HTMLElement>(".marketing-header")?.getBoundingClientRect().height ?? 74;
    const top = target.getBoundingClientRect().top + window.scrollY - (headerHeight + 16);
    window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
    window.history.replaceState(null, "", `#${id}`);
  };

  const handleSectionLink = (id: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (menuOpen) {
      document.body.style.overflow = "";
      closeMenu();
      // The mobile menu is a fixed, full-viewport overlay; a smooth scroll requested while it is
      // still mounted gets silently dropped by the browser. Wait for it to actually leave the DOM.
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToSection(id)));
      return;
    }
    scrollToSection(id);
  };

  return (
    <main className="marketing-page">
      <a className="marketing-skip-link" href="#main-content">Skip to main content</a>
      <div className="marketing-offer-bar">
        {organizerTrialEnabled ? <p><span><Sparkles size={13} /> 14 days free</span> 0% Peakle booking fee · No subscription · No credit card</p> : <p><span><Sparkles size={13} /> Pilot testing</span> For organizers and their players · Help shape Peakle</p>}
        <Link className="marketing-offer-cta" href={organizerSignupHref}>{organizerTrialEnabled ? "Claim offer" : "Join the pilot"} <ArrowRight size={14} /></Link>
      </div>

      <header className="marketing-header">
        <div className="marketing-shell marketing-nav">
          <Link href="/" className="marketing-brand" aria-label="Peakle Organizer home">
            <Image src="/ball_green.png" alt="" width={32} height={32} priority />
            <span>Peakle</span><small>ORGANIZER</small>
          </Link>
          <nav className="marketing-desktop-links" aria-label="Marketing navigation">
            <a href="#product" onClick={handleSectionLink("product")}>Product</a>
            <a href="#how-it-works" onClick={handleSectionLink("how-it-works")}>How it works</a>
            <a href={`#${offerSectionId}`} onClick={handleSectionLink(offerSectionId)}>{offerSectionLabel}</a>
            <a href="#faq" onClick={handleSectionLink("faq")}>FAQ</a>
          </nav>
          <div className="marketing-nav-actions">
            <button className="marketing-theme" type="button" onClick={toggle} aria-label={`Use ${mode === "dark" ? "light" : "dark"} mode`}>
              {mode === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <Link className="marketing-sign-in" href="/login">Sign in</Link>
            <Link className="button button-accent marketing-nav-cta" href={organizerSignupHref}>{organizerTrialEnabled ? "Start free" : "Join the pilot"} <ArrowRight size={15} /></Link>
            <button ref={menuButtonRef} className="marketing-menu-button" type="button" aria-label="Open menu" aria-controls="marketing-mobile-menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          </div>
        </div>
      </header>

      {menuOpen ? (
        <div ref={mobileMenuRef} id="marketing-mobile-menu" className="marketing-mobile-menu" role="dialog" aria-modal="true" aria-label="Marketing menu">
          <div className="marketing-mobile-menu-head">
            <Link href="/" className="marketing-brand" onClick={closeMenu}>
              <Image src="/ball_green.png" alt="" width={32} height={32} />
              <span>Peakle</span><small>ORGANIZER</small>
            </Link>
            <button ref={closeButtonRef} type="button" aria-label="Close menu" onClick={closeMenu}><X size={21} /></button>
          </div>
          <nav>
            <a href="#product" onClick={handleSectionLink("product")}>Product <ChevronRight size={18} /></a>
            <a href="#how-it-works" onClick={handleSectionLink("how-it-works")}>How it works <ChevronRight size={18} /></a>
            <a href={`#${offerSectionId}`} onClick={handleSectionLink(offerSectionId)}>{offerSectionLabel} <ChevronRight size={18} /></a>
            <a href="#faq" onClick={handleSectionLink("faq")}>FAQ <ChevronRight size={18} /></a>
          </nav>
          <div className="marketing-mobile-actions">
            <Link className="button button-accent" href={organizerSignupHref} onClick={closeMenu}>{organizerCtaLabel} <ArrowRight size={16} /></Link>
            <Link className="button button-ghost" href="/login" onClick={closeMenu}>Organizer sign in</Link>
            <button className="button button-ghost marketing-mobile-theme" type="button" onClick={toggle}>
              {mode === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              Use {mode === "dark" ? "light" : "dark"} mode
            </button>
          </div>
        </div>
      ) : null}

      <section className="marketing-hero" id="main-content" tabIndex={-1}>
        <div className="marketing-shell marketing-hero-grid">
          <div className="marketing-hero-copy">
            <p className="marketing-kicker"><span><Zap size={13} /></span> PICKLEBALL VENUE OPERATIONS, ALL IN ONE PLACE</p>
            <h1>Run a better venue.{" "}<span>Keep every court moving.</span></h1>
            <p className="marketing-hero-lead">{organizerTrialEnabled ? "From the first booking to the final score, Peakle keeps your courts, players, staff, and revenue moving in one calm workspace." : "Help us test Peakle with your group. Create your organizer account, invite your players, and tell us what works and what needs improving after your sessions."}</p>
            <div className="marketing-hero-actions">
              <Link className="button button-accent marketing-primary-cta" href={organizerSignupHref}>{organizerTrialEnabled ? "Start free for 14 days" : organizerCtaLabel} <ArrowRight size={17} /></Link>
              <a className="marketing-text-link" href="#preview" onClick={handleSectionLink("preview")}>See it in action <ChevronRight size={16} /></a>
            </div>
            <div className="marketing-trial-proof" aria-label={organizerTrialEnabled ? "Trial benefits" : "Pilot participation"}>
              <span><Check size={14} /> {organizerTrialEnabled ? "₱0 subscription" : "Organizer workspace"}</span>
              <span><Check size={14} /> {organizerTrialEnabled ? "0% Peakle booking fee" : "Player access"}</span>
              <span><Check size={14} /> {organizerTrialEnabled ? "No credit card" : "Your feedback matters"}</span>
            </div>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section className="marketing-proof-strip" aria-label="Peakle Organizer use cases">
        <div className="marketing-shell">
          <p>ONE WORKSPACE. EVERY PART OF THE VENUE.</p>
          <div>
            <span><Activity size={17} /> Open play</span>
            <span><Building2 size={17} /> Venue operations</span>
            <span><Trophy size={17} /> Competitions</span>
            <span><CircleDollarSign size={17} /> Revenue</span>
            <span><Users size={17} /> Player community</span>
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-product" id="product">
        <div className="marketing-shell">
          <SectionHeading eyebrow="BUILT FOR THE BUSY HOURS" title={<>Your front desk, live floor, and back office in <span style={{ color: 'var(--teal)' }}>sync</span>.</>} detail="Give your team one clear view of what is happening now, what needs attention next, and where your venue is growing." />
          <div className="marketing-feature-grid">
            <article className="marketing-feature-hero">
              <div className="marketing-feature-hero-copy">
                <span className="marketing-feature-icon"><heroFeature.icon size={22} /></span>
                <p>{heroFeature.eyebrow}</p>
                <h3>{heroFeature.title}</h3>
                <p>{heroFeature.detail}</p>
              </div>
              <LiveFeatureSignal />
            </article>
            <div className="marketing-feature-row">
              {supportingFeatures.map(({ icon: Icon, eyebrow, title, detail, stat }) => (
                <article className="marketing-feature-card" key={title}>
                  <span className="marketing-feature-icon"><Icon size={18} /></span>
                  <p>{eyebrow}</p>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                  <div className="marketing-feature-stat"><strong>{stat.value}</strong><span>{stat.label}</span></div>
                </article>
              ))}
            </div>
          </div>
          <p className="marketing-sample-note">Illustrative workspace data shown above.</p>
        </div>
      </section>

      <section className="marketing-operations" id="how-it-works">
        <div className="marketing-shell">
          <div className="marketing-operations-heading">
            <p className="marketing-kicker marketing-kicker-dark"><span><Layers3 size={13} /></span> FROM SETUP TO SCALE</p>
            <h2>A simpler operating rhythm for your whole team.</h2>
            <p>Peakle follows the way a venue actually works—prepare the day, run the courts, then learn from the results.</p>
          </div>
          <div className="marketing-steps">
            <article>
              <div className="marketing-step-top"><CalendarCheck2 size={19} /><b>01</b></div>
              <h3>Publish the plan</h3>
              <p>Set court availability, open sessions, capacity, rules, programs, and player registration.</p>
            </article>
            <article>
              <div className="marketing-step-top"><Gauge size={19} /><b>02</b></div>
              <h3>Run the floor live</h3>
              <p>Check players in, balance the queue, assign courts, record scores, and keep staff aligned.</p>
            </article>
            <article>
              <div className="marketing-step-top"><BarChart3 size={19} /><b>03</b></div>
              <h3>Grow with clarity</h3>
              <p>Review utilization, revenue, attendance, retention, and the activities players return for.</p>
            </article>
          </div>
          <div className="marketing-operations-note">
            <span><ShieldCheck size={20} /></span>
            <div><strong>Built around real venue permissions</strong><p>Owners, managers, front desk, court monitors, scorers, and read-only staff can work with the right level of access.</p></div>
            <Link href={organizerSignupHref}>{organizerTrialEnabled ? "Set up your workspace" : "Join the pilot"} <ArrowRight size={15} /></Link>
          </div>
        </div>
      </section>

      {organizerTrialEnabled ? <section className="marketing-section marketing-pricing" id="pricing">
        <div className="marketing-shell">
          <SectionHeading eyebrow="A GENUINELY FREE TRIAL" title="₱0 for 14 days. No booking cut." detail="There is no organizer subscription charge and Peakle takes 0% from paid bookings during your trial. Test the real workflow before a platform fee applies." centered />
          <div className="marketing-fee-layout">
            <article className="marketing-zero-fee">
              <p>YOUR FIRST 14 DAYS</p>
              <div><strong>0%</strong><span>PEAKLE BOOKING FEE</span></div>
              <ul>
                <li><Check size={16} /> Full organizer workspace</li>
                <li><Check size={16} /> Keep 100% of your venue booking price</li>
                <li><Check size={16} /> No monthly subscription</li>
                <li><Check size={16} /> No card and no automatic charge</li>
              </ul>
              <Link className="button button-accent" href={organizerSignupHref}>Start free <ArrowRight size={15} /></Link>
            </article>
            <article className="marketing-fee-explainer">
              <p>AFTER THE TRIAL</p>
              <h3>No monthly plan. A fee only when you earn.</h3>
              <p>After day 14, Peakle’s standard platform fee applies only to completed paid bookings. There is still no monthly organizer subscription.</p>
              <div className="marketing-fee-example">
                <div><span>Monthly organizer subscription</span><strong>₱0</strong></div>
                <div><span>Trial booking fee</span><strong>0% for 14 days</strong></div>
                <div><span>Standard booking fee</span><strong>20% after trial</strong></div>
                <div><span>Multi-venue terms</span><strong>Talk with us</strong></div>
              </div>
              <small>Standard payment-provider processing fees may apply separately to online transactions.</small>
              <a className="marketing-text-link" href="mailto:support@peakle.app?subject=Peakle%20Organizer%20pricing">Discuss multi-venue pricing <ArrowRight size={15} /></a>
            </article>
          </div>
          <p className="marketing-pricing-note"><ShieldCheck size={15} /> It is 14 days free—not a $14 offer. Venue-specific tools remain protected by your assigned venue role.</p>
        </div>
      </section> : <section className="marketing-section marketing-pricing" id="pilot">
        <div className="marketing-shell">
          <SectionHeading eyebrow="HELP SHAPE PEAKLE" title="Test it together. Tell us what you think." detail="We’re inviting organizers and their players to try Peakle before launch. Sign up, run a session with your group, and share your experience afterward." centered />
          <div className="marketing-fee-layout">
            <article className="marketing-zero-fee marketing-pilot-card">
              <p>ACCESS FOR YOUR GROUP</p>
              <h3>One pilot.<br />Both sides of the court.</h3>
              <ul>
                <li><Check size={16} /> Organizer access to manage your sessions</li>
                <li><Check size={16} /> Player access to join and follow the action</li>
                <li><Check size={16} /> Help getting your first test session ready</li>
                <li><Check size={16} /> Feedback from organizers and players</li>
              </ul>
              <Link className="button button-accent" href={organizerSignupHref}>Join the pilot <ArrowRight size={15} /></Link>
              <p className="marketing-pilot-caption">Already have a Peakle account? <Link href="/login">Sign in</Link> to use it for the pilot.</p>
            </article>
            <article className="marketing-fee-explainer">
              <p>HOW THE PILOT WORKS</p>
              <h3>Your sessions help us improve.</h3>
              <p>Create your account and set up a session with your players. After testing, both organizers and players can share what helped, what was difficult, and whether they would use Peakle again.</p>
              <div className="marketing-fee-example">
                <div><span>1. Create your organizer account</span><strong>Sign up</strong></div>
                <div><span>2. Set up a session</span><strong>Invite your players</strong></div>
                <div><span>3. Try the workflow together</span><strong>Play a session</strong></div>
                <div><span>4. Share your experience</span><strong>Honest feedback</strong></div>
              </div>
              <small>{pilotFeedbackUrl ? "Already testing? Share your experience in the feedback survey. Organizers and players are both welcome to respond." : "Already testing? The feedback questions open in your email app. Review your answers and send them to support@peakle.app."}</small>
              <a className="marketing-text-link" href={pilotFeedbackHref}>Share pilot feedback <ArrowRight size={15} /></a>
            </article>
          </div>
          <p className="marketing-pricing-note"><Users size={15} /> Each player uses their own account and joins through your session link or code.</p>
        </div>
      </section>}

      <section className="marketing-section marketing-faq" id="faq">
        <div className="marketing-shell marketing-faq-layout">
          <div>
            <p className="marketing-section-eyebrow">QUESTIONS, ANSWERED</p>
            <h2>Know what you’re getting before you start.</h2>
            <p>{organizerTrialEnabled ? "Need help deciding? Our team can walk through your venue setup and recommend the right starting point." : "Need help getting started? We can walk through your group’s setup and how organizers and players can take part."}</p>
            <a className="marketing-text-link" href="mailto:support@peakle.app?subject=Peakle%20Organizer%20question"><Mail size={15} /> Ask a question</a>
          </div>
          <div className="marketing-faq-list">
            {organizerTrialEnabled ? <>
            <Faq question="What is included in the 14-day free trial?">You get the full organizer workspace with a ₱0 subscription and 0% Peakle booking fee for 14 days. That includes sessions, players, bookings, live monitoring, programs, competitions, memberships, staff, and analytics. Venue actions still follow your assigned permissions.</Faq>
            <Faq question="Do I need a credit card to start?">No. There is no card requirement and no automatic charge. Standard payment-provider processing fees may still apply when a player pays online.</Faq>
            <Faq question="What happens after the trial?">There is no monthly organizer subscription. Peakle’s standard 20% platform fee applies only to completed paid bookings after the trial.</Faq>
            </> : <>
            <Faq question="Who can join the pilot?">Open-play organizers, coaches, community hosts, and venue teams can create an account and test Peakle with their players. Use Join the pilot to sign up, or sign in if you already have an account.</Faq>
            <Faq question="Will my players get access too?">Yes. Players create their own accounts in the player app and join using your session link or code. They can follow their games and share feedback about their experience.</Faq>
            <Faq question="Do I need approval to sign up?">No pilot application is needed to create an account. Managing a venue’s courts and sessions still requires the appropriate venue role. Contact us if you need help setting up your group.</Faq>
            <Faq question="What feedback are you looking for?">Tell us what worked, what was confusing, whether rotations felt fair, and whether you would use Peakle again. Feedback from both organizers and players helps us decide what to improve before launch.</Faq>
            </>}
            <Faq question="Can I use my existing Peakle account?">Yes. Sign in with the same email or Google account you use in the Peakle mobile app—there is no need to create a second identity.</Faq>
            <Faq question="Is Peakle only for open play?">No. Open play is one part of the workspace. Peakle also supports court bookings, programs, competitions, memberships, venue reporting, and staff access.</Faq>
            <Faq question="Can Peakle support more than one venue?">Yes. Multi-venue operators can switch venue context inside the workspace. Contact us for rollout planning and the right commercial setup.</Faq>
          </div>
        </div>
      </section>

      <section className="marketing-contact" id="contact">
        <div className="marketing-shell marketing-contact-card">
          <div className="marketing-contact-copy">
            <p className="marketing-section-eyebrow">READY WHEN YOU ARE</p>
            <h2>Give your next session a better operating system.</h2>
            <p>{organizerTrialEnabled ? "Start free today, or talk with us about your venue, staff setup, and rollout." : "Bring your group into the pilot and help us improve the experience for organizers and players."}</p>
          </div>
          <div className="marketing-contact-actions">
            <Link className="button button-accent marketing-primary-cta" href={organizerSignupHref}>{organizerCtaLabel} <ArrowRight size={17} /></Link>
            <a className="button marketing-contact-button" href="mailto:support@peakle.app?subject=Peakle%20Organizer%20walkthrough"><Headphones size={17} /> Book a walkthrough</a>
          </div>
          <div className="marketing-contact-details">
            <span><Mail size={15} /> support@peakle.app</span>
            <span><MapPin size={15} /> Philippines</span>
            <span><Clock3 size={15} /> Support inside your workspace</span>
            <span><ShieldCheck size={15} /> {organizerTrialEnabled ? "Payments secured by PayMongo" : "Organizer and player access"}</span>
          </div>
        </div>
      </section>

      <footer className="marketing-footer">
        <div className="marketing-shell">
          <div><Link href="/" className="marketing-brand marketing-footer-brand" aria-label="Peakle Organizer home"><Image src="/ball_green.png" alt="" width={30} height={30} /><span>Peakle</span><small>ORGANIZER</small></Link><p>Venue operations built for the pace of pickleball.</p></div>
          <nav aria-label="Footer navigation"><a href="#product" onClick={handleSectionLink("product")}>Product</a><a href={`#${offerSectionId}`} onClick={handleSectionLink(offerSectionId)}>{offerSectionLabel}</a><Link href="/login">Sign in</Link><a href="mailto:support@peakle.app">Contact</a></nav>
          <nav aria-label="Legal navigation"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/account-deletion">Account deletion</Link></nav>
          <p className="marketing-copyright">© {new Date().getFullYear()} Peakle. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}

function LiveFeatureSignal() {
  return (
    <div className="marketing-feature-signal marketing-live-signal" aria-hidden="true">
      <div className="marketing-live-signal-head"><span><i /> SESSION LIVE</span><small>FRIDAY OPEN PLAY</small></div>
      <div className="marketing-live-courts">
        <span><b>01</b><small>11–7</small><em>12:42</em></span>
        <span><b>02</b><small>6–8</small><em>08:16</em></span>
        <span className="is-open"><b>03</b><small>OPEN</small><em>READY</em></span>
      </div>
      <div className="marketing-live-signal-foot"><span>24 checked in</span><span>4 in queue</span><strong>5/6 courts active</strong></div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, detail, centered = false }: { eyebrow: string; title: React.ReactNode; detail: string; centered?: boolean }) {
  return <div className={`marketing-section-heading ${centered ? "centered" : ""}`}><p className="marketing-section-eyebrow">{eyebrow}</p><h2>{title}</h2><p>{detail}</p></div>;
}

function Faq({ question, children }: { question: string; children: React.ReactNode }) {
  return <details name="faq"><summary>{question}<span><ChevronRight size={18} /></span></summary><p>{children}</p></details>;
}

function ProductPreview() {
  return (
    <div id="preview" className="marketing-preview-wrap" role="img" aria-label="The actual Peakle Organizer overview interface, shown with illustrative venue data" tabIndex={-1}>
      <div className="marketing-preview-glow" />
      <div className="marketing-preview marketing-actual-preview">
        <aside className="marketing-actual-sidebar">
          <div className="marketing-actual-brand"><Image src="/ball_green.png" alt="" width={20} height={20} /><strong>Peakle</strong><small>ORGANIZER</small></div>
          <nav>
            <p>WORKSPACE</p>
            <span className="active"><Gauge size={11} /> Overview</span>
            <span><CalendarDays size={11} /> Open Play</span>
            <span><Activity size={11} /> Live Monitor</span>
            <span><Users size={11} /> Players</span>
            <p>RUN YOUR VENUE</p>
            <span><CalendarCheck2 size={11} /> Bookings</span>
            <span><Building2 size={11} /> Venue &amp; Courts</span>
            <span><TicketCheck size={11} /> Programs</span>
            <span><Trophy size={11} /> Competition</span>
          </nav>
        </aside>

        <div className="marketing-actual-workspace">
          <div className="marketing-actual-topbar">
            <div className="marketing-actual-top-brand"><Image src="/ball_green.png" alt="" width={18} height={18} /><strong>Peakle</strong></div>
            <div className="marketing-actual-venue"><span><Building2 size={11} /></span><div><strong>Rally Point Makati</strong><small>Current venue · Makati</small></div></div>
            <div className="marketing-actual-account"><span><Bell size={11} /></span><i>AM</i><div><strong>Alex Morgan</strong><small>Venue owner</small></div></div>
          </div>

          <div className="marketing-actual-content">
            <div className="marketing-actual-page-head">
              <div><small>ORGANIZER WORKSPACE</small><strong>Good morning, Alex.</strong><p>A clean read on today&apos;s courts, players, and venue activity.</p></div>
              <span><RefreshCw size={10} /> Refresh</span>
            </div>
            <div className="marketing-actual-rule" />

            <div className="marketing-actual-metrics">
              <PreviewMetric icon={Users} value="24" label="PLAYERS CHECKED IN" trend="4 pending" />
              <PreviewMetric icon={Activity} value="5/6" label="COURTS IN PLAY" trend="Live" live />
              <PreviewMetric icon={CalendarDays} value="2" label="UPCOMING SESSIONS" trend="Ready" />
              <PreviewMetric icon={CircleDollarSign} value="₱42.8K" label="30-DAY REVENUE" trend="86% util." />
            </div>

            <div className="marketing-actual-section-title"><div><small>HAPPENING NOW</small><strong>Today at your venue</strong></div></div>
            <div className="marketing-actual-dashboard">
              <div className="marketing-actual-session">
                <div><span><i /> LIVE</span><small>CODE FRI728</small></div>
                <strong>Friday Night Open Play</strong>
                <p>Sep 4, 6:00 PM · Doubles</p>
                <div className="marketing-actual-live-stats"><span><b>24</b><small>PLAYERS</small></span><span><b>5</b><small>COURTS LIVE</small></span><span><b>28</b><small>CAPACITY</small></span></div>
                <em>Open monitor <ArrowRight size={9} /></em>
              </div>
              <div className="marketing-actual-activity">
                <PreviewActivity icon={Users} title="24 players checked in" detail="Friday Night Open Play" status="LIVE" live />
                <PreviewActivity icon={Trophy} title="2 competitions" detail="Brackets and registration" status="ACTIVE" />
                <PreviewActivity icon={TicketCheck} title="3 programs" detail="Clinics and coaching" status="OPEN" />
              </div>
            </div>
          </div>
          <div className="marketing-actual-mobile-nav">
            <span className="active"><Gauge size={10} /><small>Overview</small></span>
            <span><CalendarDays size={10} /><small>Open Play</small></span>
            <span><Activity size={10} /><small>Monitor</small></span>
            <span><Users size={10} /><small>Players</small></span>
            <span><Menu size={10} /><small>More</small></span>
          </div>
        </div>
      </div>
      <div className="marketing-preview-caption"><ShieldCheck size={13} /><strong>Actual Organizer overview</strong><span>Illustrative data</span></div>
    </div>
  );
}

function PreviewMetric({ icon: Icon, value, label, trend, live = false }: { icon: typeof Users; value: string; label: string; trend: string; live?: boolean }) {
  return <div><div><span><Icon size={10} /></span><em className={live ? "live" : ""}>{trend}</em></div><strong>{value}</strong><small>{label}</small></div>;
}

function PreviewActivity({ icon: Icon, title, detail, status, live = false }: { icon: typeof Users; title: string; detail: string; status: string; live?: boolean }) {
  return <div><span><Icon size={10} /></span><div><strong>{title}</strong><small>{detail}</small></div><em className={live ? "live" : ""}>{status}</em></div>;
}
