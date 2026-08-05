"use client";

import Link from "next/link";
import type { OrganizerData, Venue } from "@/lib/types";
import type { CreateType } from "../dialogs/create-activity-dialog";
import { Empty, MembershipCard, Status, money, titleCase } from "../components/portal-ui";

export function MembershipsSection({ data, venue, onCreate, resourceId }: { data: OrganizerData; venue: Venue | null; onCreate: (type: CreateType) => void; resourceId?: string }) {
  if (resourceId) {
    const product = data.memberships.find((item) => item.id === resourceId);
    if (!product) return <Empty title="Membership not found" detail="This product may have been removed or belongs to another venue." />;
    return <div className="management-grid"><div className="card management-card"><div className="card-topline"><span className="card-kicker">{titleCase(product.kind)}</span><Status value={product.active === false ? "closed" : "active"} /></div><h2>{product.name}</h2><p>{money(product.price)} · {product.validity_days || 30} days</p><div className="venue-facts"><div><strong>{product.credits || "—"}</strong><small>CREDITS</small></div><div><strong>{product.player_memberships?.length || 0}</strong><small>ACTIVE</small></div></div><Link className="button button-ghost inline-action" href="/memberships">Back to memberships</Link></div></div>;
  }
  const memberships = data.memberships.filter((item) => !venue || item.venue_id === venue.id);
  return memberships.length ? <div className="product-grid">{memberships.map((product) => <MembershipCard key={product.id} product={product} />)}</div> : <Empty title="No membership products" detail="Create a venue membership, court pack, session pack, credit bundle, or discount." action="Create membership" onAction={() => onCreate("membership")} />;
}
