import Link from "next/link";
import { Zap, ArrowRight } from "lucide-react";

export default function DashboardNotFound() {
  return (
    <div className="card empty-state">
      <div>
        <span className="empty-icon"><Zap size={21} /></span>
        <h3>Page not found</h3>
        <p>That part of the organizer workspace doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Link className="button button-accent" href="/overview">
          Back to overview <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}
