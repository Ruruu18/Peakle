"use client";

import Link from "next/link";
import type { OrganizerData, Venue } from "@/lib/types";
import type { CreateType } from "../dialogs/create-activity-dialog";
import { Empty, MembershipCard, Status, money, titleCase } from "../components/portal-ui";

export function MembershipsSection({ data, venue, onCreate, resourceId }: { data: OrganizerData; venue: Venue | null; onCreate: (type: CreateType) => void; resourceId?: string }) {
  if (resourceId) {
    const product = data.memberships.find((item) => item.id === resourceId);
    if (!product) return <Empty title="Membership not found" detail="This product may have been removed or belongs to another venue." />;
    const orders = product.player_memberships || [];
    const active = orders.filter((order) => order.status === "active" && order.payment_status === "paid").length;
    const awaiting = orders.filter((order) => order.status === "pending" && order.payment_status === "awaiting_payment").length;
    return <div className="management-grid"><div className="card management-card"><div className="card-topline"><span className="card-kicker">{titleCase(product.kind)}</span><Status value={product.active === false ? "closed" : "active"} /></div><h2>{product.name}</h2><p>{money(product.price)} · {product.validity_days || 30} days</p><div className="venue-facts"><div><strong>{product.credits || "—"}</strong><small>CREDITS</small></div><div><strong>{active}</strong><small>PAID & ACTIVE</small></div><div><strong>{awaiting}</strong><small>AWAITING PAYMENT</small></div></div><Link className="button button-ghost inline-action" href="/memberships">Back to memberships</Link></div>{orders.length ? <div className="card" style={{ overflowX: "auto" }}><table className="data-table"><thead><tr><th>PLAYER</th><th>ACCESS</th><th>PAYMENT</th><th>METHOD</th><th>AMOUNT</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td>{order.profiles?.display_name || "Peakle player"}</td><td><Status value={order.status || "pending"} /></td><td><Status value={order.payment_status || "awaiting_payment"} /></td><td>{titleCase(order.payment_method || "not selected")}</td><td>{money(order.amount_due)}</td></tr>)}</tbody></table></div> : <Empty title="No purchases yet" detail="Player payments and active memberships will appear here." />}</div>;
  }
  const memberships = data.memberships.filter((item) => !venue || item.venue_id === venue.id);
  return memberships.length ? <div className="product-grid">{memberships.map((product) => <MembershipCard key={product.id} product={product} />)}</div> : <Empty title="No membership products" detail="Create a venue membership, court pack, session pack, credit bundle, or discount." action="Create membership" onAction={() => onCreate("membership")} />;
}
