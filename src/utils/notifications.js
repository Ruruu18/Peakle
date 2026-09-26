const ICONS_BY_KIND = {
  approval: 'checkmark-circle-outline',
  waitlist_promotion: 'arrow-up-circle-outline',
  check_in_reminder: 'time-outline',
  court_assignment: 'tennisball-outline',
  match_point: 'flag-outline',
  result: 'trophy-outline',
  cancellation: 'close-circle-outline',
  venue_announcement: 'megaphone-outline',
  booking_confirmed: 'checkmark-circle-outline',
  booking_reminder: 'calendar-outline',
  court_waitlist: 'hourglass-outline',
  booking_changed: 'calendar-outline',
  match_invite: 'people-circle-outline',
  match_invite_response: 'checkmark-circle-outline',
  match_found: 'search-circle-outline',
  organizer_match: 'pulse-outline',
  direct_message: 'chatbubble-outline',
  direct_message_request: 'person-add-outline',
  direct_message_accepted: 'chatbubbles-outline',
  follow_request: 'person-add-outline',
  follow_accepted: 'people-outline',
  community_announcement: 'megaphone-outline',
  game_invite: 'calendar-outline',
  game_response: 'checkmark-circle-outline',
  game_update: 'calendar-clear-outline',
  team_invite: 'shield-outline',
  team_invite_response: 'people-outline',
};

export function presentNotification(notice) {
  const createdAt = new Date(notice.created_at);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const group = createdAt >= today ? 'TODAY' : createdAt >= weekAgo ? 'THIS WEEK' : 'EARLIER';
  const time = Number.isNaN(createdAt.getTime()) ? 'Time unavailable' : createdAt.toLocaleString('en-PH', group === 'TODAY'
    ? { hour: 'numeric', minute: '2-digit' }
    : group === 'THIS WEEK'
      ? { weekday: 'short', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return {
    ...notice,
    group,
    icon: ICONS_BY_KIND[notice.kind] || 'notifications-outline',
    time,
  };
}
