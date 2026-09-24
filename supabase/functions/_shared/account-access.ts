// Do not trust auth.getUser() alone for revocation: an already-issued JWT can
// outlive a ban. Use the caller-scoped client, never a service-role client.
type AccessClient = {
  rpc: (name: string) => PromiseLike<{ error: { code?: string; message?: string } | null }>;
};

export async function checkAccountAccess(client: AccessClient): Promise<{ status: number; error: string } | null> {
  try {
    const { error } = await client.rpc('enforce_account_access');
    if (!error) return null;
    if (error.code === 'PT403') {
      return { status: 403, error: 'Account access is suspended or this session has been revoked. Please sign in again or contact support@peakle.app.' };
    }
  } catch { /* An unavailable permission check must fail closed. */ }
  return { status: 503, error: 'Account access could not be verified. Please try again.' };
}
