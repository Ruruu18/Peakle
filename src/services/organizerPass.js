import { requireSupabase } from '../lib/supabase';

export const ORGANIZER_PASS_TIERS = Object.freeze({
  plus: Object.freeze({
    id: 'plus',
    label: 'Plus',
    capabilities: Object.freeze(['organizer_workspace', 'unlimited_sessions', 'session_history']),
  }),
  pro: Object.freeze({
    id: 'pro',
    label: 'Pro',
    capabilities: Object.freeze(['organizer_workspace', 'unlimited_sessions', 'session_history', 'staff_access', 'advanced_analytics', 'export_reports']),
  }),
});

export const ORGANIZER_PASS_PLANS = Object.freeze([
  {
    id: 'organizer_monthly',
    name: 'Plus Monthly',
    tier: 'plus',
    price: 499,
    currency: 'PHP',
    billingLabel: 'month',
    durationDays: 30,
  },
  {
    id: 'organizer_annual',
    name: 'Plus Annual',
    tier: 'plus',
    price: 4990,
    currency: 'PHP',
    billingLabel: 'year',
    durationDays: 365,
    badge: 'SAVE ₱998',
  },
  {
    id: 'organizer_pro_monthly',
    name: 'Pro Monthly',
    tier: 'pro',
    price: 999,
    currency: 'PHP',
    billingLabel: 'month',
    durationDays: 30,
    badge: 'ALL FEATURES',
  },
]);

export function getOrganizerPassPlan(planId) {
  return ORGANIZER_PASS_PLANS.find((plan) => plan.id === planId) || ORGANIZER_PASS_PLANS[0];
}

export function getOrganizerPassTier(entitlement) {
  if (!entitlement) return null;
  return entitlement.tier || (entitlement.planId ? getOrganizerPassPlan(entitlement.planId).tier : null);
}

export function hasOrganizerPassCapability(tier, capability) {
  if (tier === 'admin') return true;
  return ORGANIZER_PASS_TIERS[tier]?.capabilities.includes(capability) || false;
}

export function createPreviewEntitlement() {
  return {
    status: 'preview',
    planId: null,
    tier: null,
    startedAt: null,
    currentPeriodEnd: null,
    autoRenews: false,
    provider: 'preview',
  };
}

function mapServerEntitlement(row) {
  if (!row) return createPreviewEntitlement();
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    planId: row.product_id,
    tier: row.tier,
    startedAt: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    autoRenews: row.auto_renews,
    provider: row.provider,
    transactionId: row.provider_transaction_id,
    verifiedAt: row.verified_at,
  };
}

export function hasCurrentOrganizerAccess(entitlement, now = Date.now()) {
  if (!entitlement || !['active', 'trialing', 'grace_period'].includes(entitlement.status)) return false;
  if (!entitlement.currentPeriodEnd) return false;
  return new Date(entitlement.currentPeriodEnd).getTime() > now;
}

export function normalizeOrganizerEntitlement(entitlement, now = Date.now()) {
  if (!entitlement) return createPreviewEntitlement();
  if (['active', 'trialing', 'grace_period'].includes(entitlement.status) && !hasCurrentOrganizerAccess(entitlement, now)) {
    return { ...entitlement, status: 'expired', autoRenews: false };
  }
  return entitlement;
}

export async function loadOrganizerPass(userId) {
  if (!userId) return createPreviewEntitlement();
  const { data, error } = await requireSupabase()
    .from('organizer_entitlements')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return normalizeOrganizerEntitlement(mapServerEntitlement(data));
}

async function runEntitlementRpc(name, args) {
  const { data, error } = await requireSupabase().rpc(name, args);
  if (error) throw error;
  return normalizeOrganizerEntitlement(mapServerEntitlement(Array.isArray(data) ? data[0] : data));
}

export async function activateDemoOrganizerPass(userId, planId) {
  if (!userId) throw new Error('Sign in before activating Organizer Pass.');
  const plan = getOrganizerPassPlan(planId);
  return runEntitlementRpc('activate_demo_organizer_pass', { p_product_id: plan.id });
}

export async function cancelDemoOrganizerPass(userId) {
  if (!userId) throw new Error('Sign in before changing Organizer Pass.');
  return runEntitlementRpc('cancel_demo_organizer_pass');
}

export async function expireDemoOrganizerPass(userId) {
  if (!userId) throw new Error('Sign in before changing Organizer Pass.');
  return runEntitlementRpc('expire_demo_organizer_pass');
}

export async function refreshOrganizerPass(userId) {
  if (!userId) return createPreviewEntitlement();
  return loadOrganizerPass(userId);
}

export async function restoreDemoOrganizerPass(userId) {
  if (!userId) throw new Error('Sign in before restoring Organizer Pass.');
  return runEntitlementRpc('restore_demo_organizer_pass');
}
