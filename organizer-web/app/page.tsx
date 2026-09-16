import type { Metadata } from "next";
import MarketingPage from "@/components/marketing-page";
import { organizerSiteDescription, organizerTrialEnabled } from "@/lib/launch-offer";

export const metadata: Metadata = {
  title: "Organizer software for better-run venues",
  description: organizerSiteDescription,
  alternates: { canonical: "/" },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Peakle Organizer",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: "Venue operations software for pickleball clubs: open play, bookings, players, competitions, memberships, staff, and analytics in one workspace.",
  ...(organizerTrialEnabled ? { offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "PHP",
    description: "14-day free trial with no subscription and no Peakle booking fee.",
  } } : {}),
};

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <MarketingPage />
    </>
  );
}
