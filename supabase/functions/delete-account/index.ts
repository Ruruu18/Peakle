import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CORS_HEADERS, handleCorsPreflight } from '../_shared/cors.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS };

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function removeProfilePhotos(admin: ReturnType<typeof createClient>, userId: string) {
  const paths: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await admin.storage.from('profile-photos').list(userId, {
      limit: 100,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    const page = data || [];
    paths.push(...page.filter((item) => item.name).map((item) => `${userId}/${item.name}`));
    if (page.length < 100) break;
    offset += page.length;
  }
  if (paths.length) {
    const { error } = await admin.storage.from('profile-photos').remove(paths);
    if (error) throw error;
  }
}

async function removeChatMedia(admin: ReturnType<typeof createClient>, userId: string) {
  const paths: string[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from('team_messages')
      .select('media_path')
      .eq('sender_id', userId)
      .not('media_path', 'is', null)
      .range(from, from + 499);
    if (error) throw error;
    const page = data || [];
    paths.push(...page.map((row) => row.media_path).filter(Boolean));
    if (page.length < 500) break;
    from += page.length;
  }
  if (paths.length) {
    const { error } = await admin.storage.from('team-chat-media').remove([...new Set(paths)]);
    if (error) throw error;
  }
}

Deno.serve(async (request) => {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;
  if (!['POST', 'DELETE'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Account deletion is not configured' }, 500);

  const authorization = request.headers.get('Authorization') || '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Authentication required' }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  try {
    await Promise.all([
      removeProfilePhotos(admin, userData.user.id),
      removeChatMedia(admin, userData.user.id),
    ]);

    const { error: prepareError } = await admin.rpc('prepare_account_deletion', { p_user_id: userData.user.id });
    if (prepareError) throw prepareError;

    const { error: deleteError } = await admin.auth.admin.deleteUser(userData.user.id, false);
    if (deleteError) throw deleteError;
    return json({ deleted: true });
  } catch (error) {
    console.error('Account deletion failed', error);
    return json({ error: 'Account deletion could not be completed. Please try again or contact support@peakle.app.' }, 500);
  }
});
