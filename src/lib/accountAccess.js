export function isAccountAccessError(error) {
  return Boolean(error && (
    (error.code === 'PT403' && error.message?.startsWith('Account access is suspended'))
    || error.code === 'user_banned'
    || error.code === 'session_not_found'
    || error.code === 'refresh_token_not_found'
  ));
}
