import Modal from '../components/ResponsiveModal';
import { webLayout, webDialog } from '../utils/webLayout';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  Alert,
  AppState,
  BackHandler,
  Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import AppIcon from '../components/AppIcon';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useFocusEffect } from '@react-navigation/native';
import { DEMO_MODE } from '../config/demoMode';
import { PRIVATE_MESSAGES_ENABLED } from '../config/features';
import { DEMO_TEAM_ID, DEMO_TEAM_MESSAGE_DRIP } from '../config/demoData';
import ProfilePhoto from '../components/ProfilePhoto';
import MessageFocusModal, { canCopyText, copyText, unselectable } from '../components/MessageFocusModal';
import ResilientImage from '../components/ResilientImage';
import LocationPicker from '../components/LocationPicker';
import ScrollView from '../components/FocusResetScrollView';
import useResponsiveWidth from '../hooks/useResponsiveWidth';
import { webLongPress } from '../utils/webLongPress';
import useStableHandlers from '../hooks/useStableHandlers';
import { saveDirectMedia } from '../components/DirectMessageMedia';
import ChatInfoScreen, { ChatInfoSection, ChatSearchModal, NicknamesModal, chatInfoColors, extractChatLinks } from '../components/ChatInfoScreen';
import { listChatNicknames, listTeamChatMutes, muteTeamChat, setChatNickname, unmuteTeamChat } from '../services/chatInfo';
import { PH_LOCATIONS, formatLocation, locationMatchesSearch, parseLocation } from '../data/phLocations';
import { useAuth } from '../context/AuthContext';
import { distanceInKm, formatDistance, geocodeArea, useUserLocation } from '../context/LocationContext';
import { acknowledgeChatSafety, blockChatUser, cancelTeamJoin, createTeamRecord, deleteTeamChatMedia, editTeamMessage, getChatSafetyStatus, getTeamChatLastActive, getTeamMessage, hideTeamMessage, inviteTeamMember, listBlockedChatUsers, listMyTeamInvitations, listMyTeamRequests, listPinnedTeamMessages, listTeamConversationSummaries, listTeamMessageReadStates, listTeamMessages, listTeamRequests, listTeamSharedMedia, listTeams, markTeamConversationRead, moderateTeamMessage, removeTeamMember, reportTeamMessage, requestTeamJoin, respondTeamInvitation, reviewTeamRequest, searchTeamInviteCandidates, sendTeamMessage, toggleTeamMessagePin, toggleTeamMessageReaction, unblockChatUser, unsendTeamMessage, updateTeamMemberRole, updateTeamRecord, uploadTeamChatMedia, uploadTeamImage } from '../services/database';
import { completeTeamMatch, completeTeamMatchGame, getAcceptedTeamChallenges, getTeamMatch, handoffTeamMatchScorer, recordTeamMatchRally, startTeamMatch, undoTeamMatchRally } from '../services/pickleball';
import { supabase } from '../lib/supabase';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import { peekCachedData, readCachedData, withTimeout, writeCachedData } from '../lib/asyncData';
import { teamScreenCacheKey } from '../lib/cacheKeys';
import { TEAM_SKILL_LEVELS, skillCategoryForRating } from '../utils/skillCategories';
import { isMuteActive, listDirectConversations, muteStatusLabel } from '../services/directMessages';
import { getFeatureVote, setFeatureVote } from '../services/featureInterest';
import { speakScoreAnnouncement, stopScoreAnnouncement } from '../utils/scoreAccessibility';
import { createReactionTracker, toggleOwnReaction } from '../utils/reactions';
import { ACCOUNT_MENU_NAV, HeaderAvatar } from '../components/AccountMenu';

const LIGHT_C = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA' };
let C = LIGHT_C;
const canEditTeam = (team) => ['Owner', 'Admin'].includes(team?.role);
const canReviewRequests = (team) => ['Owner', 'Admin', 'Co-admin'].includes(team?.role);
const TEAM_ROLE_VALUES = { Admin: 'admin', 'Co-admin': 'co_admin', Member: 'member' };
const TEAM_ROLE_DETAILS = {
  Admin: 'Manage team settings, requests, invitations, and eligible members.',
  'Co-admin': 'Help manage requests, invitations, and standard members.',
  Member: 'Standard access to team chat, activity, and matches.',
};
const canManageRosterMember = (team, member, currentUserId) => {
  if (!team || !member || member.id === currentUserId || member.role === 'Owner') return false;
  if (team.role === 'Owner') return true;
  if (team.role === 'Admin') return ['Co-admin', 'Member'].includes(member.role);
  return team.role === 'Co-admin' && member.role === 'Member';
};
const makeTag = (name) => {
  const words = name.replace(/[^a-z0-9 ]/gi, '').split(/\s+/).filter(Boolean);
  const initials = words.map((word) => word[0]).join('').toUpperCase();
  if (initials.length >= 2) return initials.slice(0, 4);
  const compact = words.join('').toUpperCase();
  return (compact.slice(0, 4) || 'TM').padEnd(2, 'X');
};
const teamStatusText = (team) => team?.status === 'active' ? 'ACTIVE' : `FORMING ${Math.min(team?.members || 0, 4)}/4`;
const servingPlayer = (match) => (match?.servingTeam === 'home' ? match?.homePlayers?.[match.servingPlayerIndex] : match?.awayPlayers?.[match.servingPlayerIndex]) || (match?.servingTeam === 'home' ? match?.home : match?.away);
const servingTeamName = (match) => match?.servingTeam === 'home' ? match.home : match?.away;
const REACTION_OPTIONS = ['👍', '❤️', '😂', '🔥', '👏', '🎉'];
const TYPING_IDLE_MS = 1400;
const TYPING_HEARTBEAT_MS = 900;
const TYPING_EXPIRY_MS = 2600;
const CHAT_REPORT_REASONS = [
  { value: 'harassment', label: 'Harassment or bullying', icon: 'person-remove-outline' },
  { value: 'hate', label: 'Hate or discrimination', icon: 'warning-outline' },
  { value: 'sexual_content', label: 'Sexual content', icon: 'eye-off-outline' },
  { value: 'violence', label: 'Threats or violence', icon: 'alert-circle-outline' },
  { value: 'spam', label: 'Spam or scam', icon: 'megaphone-outline' },
  { value: 'privacy', label: 'Private information', icon: 'lock-closed-outline' },
  { value: 'child_safety', label: 'Child safety concern', icon: 'shield-outline' },
  { value: 'other', label: 'Something else', icon: 'ellipsis-horizontal-circle-outline' },
];
const TEAM_GRADIENTS = [
  ['#0E2321', '#1C6B66', '#69A89A'],
  ['#2B1B45', '#6D3FA0', '#C779D0'],
  ['#1A3152', '#246B8E', '#56B4C4'],
  ['#4A211B', '#B6472E', '#E6A15B'],
  ['#24311C', '#62823A', '#C0D65C'],
];

const teamGradient = (team) => {
  const stableIdentity = team?.tag || team?.name || 'TEAM';
  const seed = stableIdentity.split('').reduce((total, character) => total + character.charCodeAt(0), 0);
  return TEAM_GRADIENTS[seed % TEAM_GRADIENTS.length];
};

const formatRequestAge = (createdAt) => {
  if (!createdAt) return 'Recently';
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d ago`;
  return new Date(createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const normalizeJoinRequest = (row) => {
  const name = row.profiles?.display_name || 'Peakle player';
  return {
    id: row.id,
    team_id: row.team_id,
    user_id: row.user_id,
    name,
    initials: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    avatar: row.profiles?.avatar_url || null,
    rating: row.profiles?.skill_rating ?? null,
    location: row.profiles?.home_area || 'Location not provided',
    preference: row.profiles?.play_preference || 'Play preference not set',
    note: row.note?.trim() || '',
    createdAt: row.created_at,
    color: C.teal,
  };
};

const groupJoinRequests = (rows) => rows.reduce((groups, row) => {
  const request = normalizeJoinRequest(row);
  groups[request.team_id] = [...(groups[request.team_id] || []), request];
  return groups;
}, {});

const normalizeTeamMessage = (row, currentUserId) => ({
  id: row.id,
  teamId: row.team_id,
  kind: row.kind || 'message',
  senderId: row.sender_id,
  sender: row.profiles?.display_name || (row.sender_id === currentUserId ? 'You' : 'Player'),
  initials: (row.profiles?.display_name || (row.sender_id === currentUserId ? 'You' : 'Player')).split(/\s+/).map((part) => part[0]).join('').slice(0, 2),
  avatar: row.profiles?.avatar_url || null,
  mine: row.sender_id === currentUserId,
  text: row.deleted_at ? null : row.body,
  image: row.deleted_at ? null : (['image', 'gif'].includes(row.media_type) ? (row.media_url || row.image_url) : row.image_url),
  video: row.deleted_at ? null : (row.media_type === 'video' ? row.media_url : null),
  mediaType: row.media_type || (row.image_url ? 'image' : null),
  mediaKind: row.media_name?.startsWith('sticker:') ? 'stickers' : null,
  mediaName: row.media_name || null,
  mediaMime: row.media_mime || null,
  mediaSize: row.media_size || null,
  pinned: Array.isArray(row.team_message_pins) ? row.team_message_pins.length > 0 : Boolean(row.team_message_pins),
  pinnedAt: Array.isArray(row.team_message_pins) ? row.team_message_pins[0]?.pinned_at : row.team_message_pins?.pinned_at,
  createdAt: row.created_at,
  editedAt: row.edited_at,
  deletedAt: row.deleted_at,
  moderatedAt: row.moderated_at,
  moderationReason: row.moderation_reason || null,
  reactions: row.team_message_reactions || [],
  time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
});

const upsertTeamMessage = (items, message) => {
  if (!message) return items;
  const index = items.findIndex((item) => item.id === message.id);
  if (index < 0) return [...items, message].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const next = [...items];
  next[index] = message;
  return next;
};

const optimisticTeamMessage = ({ teamId, currentUserId, text = null, image = null, video = null, mediaType = null, mediaKind = null, deliveryState = 'sending' }) => {
  const createdAt = new Date().toISOString();
  return {
    id: `pending-${Crypto.randomUUID()}`,
    teamId,
    senderId: currentUserId,
    sender: 'You',
    initials: 'YO',
    mine: true,
    text,
    image,
    video,
    mediaType,
    mediaKind,
    createdAt,
    editedAt: null,
    deletedAt: null,
    reactions: [],
    deliveryState,
    time: new Date(createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
};

function Icon({ name, size = 20, color = C.ink }) { return <AppIcon name={name} size={size} color={color} />; }
function TeamCover({ team, height = 148, children }) {
  const colors = teamGradient(team);
  const gradientId = `team-gradient-${String(team.id || team.tag || 'preview').replace(/[^a-z0-9]/gi, '')}`;
  return (
    <View style={[styles.teamCover, { height }]}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
        <Defs><SvgLinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors[0]} /><Stop offset="0.56" stopColor={colors[1]} /><Stop offset="1" stopColor={colors[2]} /></SvgLinearGradient></Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
        <Circle cx="88%" cy="8%" r="74" fill="rgba(255,255,255,.09)" />
        <Circle cx="12%" cy="105%" r="88" fill="rgba(214,233,74,.12)" />
      </Svg>
      {team.coverImage ? <ResilientImage uri={team.coverImage} fallback={null} fallbackColor="transparent" showLoadingIndicator={false} style={StyleSheet.absoluteFillObject} /> : null}
      {team.coverImage && <View style={[StyleSheet.absoluteFillObject, styles.coverScrim]} />}
      <View pointerEvents="none" style={styles.coverCourt}><View style={styles.coverCourtLine} /><View style={[styles.coverCourtLine, styles.coverCourtLineVertical]} /></View>
      {children}
    </View>
  );
}
function Crest({ team, size = 54, onPress, showEdit }) {
  const fallback = <View style={styles.crestFallback}><Icon name={team.icon || 'people-outline'} size={size * .42} color={C.surface} /><Text style={[styles.crestTag, { fontSize: size * .12 }]}>{team.tag}</Text></View>;
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={[styles.crest, { width: size, height: size, borderRadius: size * .34, borderBottomLeftRadius: size * .14, borderBottomRightRadius: size * .14, backgroundColor: team.color || C.teal }]}>
      <ResilientImage uri={team.image} fallback={fallback} fallbackColor="transparent" showLoadingIndicator={false} style={StyleSheet.absoluteFillObject} />
      {showEdit && <View style={styles.crestEdit}><Icon name="camera" size={Math.max(10, size * .17)} color={C.ink} /></View>}
    </Pressable>
  );
}

function KitchenLine({ style }) { return <View style={[styles.kitchen, style]}><View style={styles.solid} /><View style={styles.dashed} /></View>; }

// "Coming soon" teaser with a quick thumbs up/down to gauge interest before building it.
function ClubWarsTeaser() {
  const [vote, setVote] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    getFeatureVote('club_wars').then((value) => { if (active) setVote(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const choose = async (value) => {
    if (saving) return;
    const previous = vote;
    const next = previous === value ? null : value;
    setVote(next);
    setSaving(true);
    try { await setFeatureVote('club_wars', next); } catch { setVote(previous); } finally { setSaving(false); }
  };
  return (
    <View style={styles.clubWars}>
      <View style={styles.clubWarsIcon}><Icon name="shield-half-outline" color={C.teal} /></View>
      <View accessible accessibilityLabel="Club Wars, coming soon. Club versus club seasons with standings." style={styles.exploreCopy}>
        <View style={styles.clubWarsTitleRow}><Text style={styles.clubWarsTitle}>Club Wars</Text><View style={styles.clubWarsBadge}><Text style={styles.clubWarsBadgeText}>SOON</Text></View></View>
        <Text style={styles.footText}>Take your team into club-vs-club seasons and climb the standings.</Text>
      </View>
      <View style={styles.clubWarsVotes}>
        {[[1, 'thumbs-up', 'I want Club Wars'], [-1, 'thumbs-down', 'Not interested in Club Wars']].map(([value, icon, label]) => (
          <Pressable key={value} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: vote === value }} disabled={saving} onPress={() => choose(value)} hitSlop={6} style={({ pressed }) => [styles.clubWarsVote, vote === value && styles.clubWarsVoteActive, pressed && styles.pressed]}>
            <Icon name={vote === value ? icon : `${icon}-outline`} size={15} color={vote === value ? '#0E2321' : C.ink70} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function TeamCard({ team, joined, invited, requested, requesting, cancelling, summary, muted = false, onJoin, onCancel, onOpen, onChat }) {
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.teamCard, pressed && styles.pressed]}>
      <TeamCover team={team}>
        <View style={styles.coverTop}><View style={[styles.coverStatus, team.status === 'active' && styles.coverStatusActive]}><Text style={styles.coverStatusText}>{teamStatusText(team)}</Text></View><View style={styles.coverBadges}>{joined && <View style={styles.coverJoined}><Icon name="checkmark" size={10} color="#0E2321" /><Text style={styles.coverJoinedText}>JOINED</Text></View>}<View style={styles.coverPrivacy}><Icon name={team.isDiscoverable ? 'globe-outline' : 'lock-closed-outline'} size={12} color={C.surface} /></View></View></View>
        <View style={styles.coverBottom}><Crest team={team} size={44} /><View style={styles.coverCopy}><Text numberOfLines={1} style={styles.coverTitle}>{team.name}</Text><View style={styles.coverLocation}><Icon name="location-outline" size={13} color="rgba(255,255,255,.82)" /><Text numberOfLines={1} style={styles.coverLocationText}>{team.location}{team.distance ? ` · ${team.distance}` : ''}</Text></View></View></View>
      </TeamCover>
      <View style={styles.stats}><View style={styles.stat}><Text style={styles.statValue}>{team.rating}</Text><Text style={styles.statLabel}>RATING</Text></View><View style={styles.stat}><Text style={styles.statValue}>{team.members}/{team.capacity}</Text><Text style={styles.statLabel}>MEMBERS</Text></View><View style={[styles.level, team.level === 'Advanced' && styles.levelAdvanced]}><Text style={[styles.levelText, team.level === 'Advanced' && styles.levelTextAdvanced]}>{team.level}</Text></View></View>
      {joined && <Pressable accessibilityLabel={`Open ${team.name} chat`} onPress={(event) => { event.stopPropagation?.(); onChat?.(); }} style={styles.conversationRow}><View style={[styles.conversationIcon, summary?.unread_count > 0 && styles.conversationIconUnread]}><Icon name="chatbubble-outline" size={17} color={C.teal} /></View><View style={styles.conversationCopy}><Text numberOfLines={1} style={styles.conversationText}>{summary?.last_body || (summary?.last_has_image ? 'Shared a photo' : 'Start the team conversation')}</Text><Text style={styles.conversationMeta}>{summary?.last_sender_name ? `${summary.last_sender_name} · ` : ''}{summary?.last_created_at ? new Date(summary.last_created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'TEAM CHAT'}</Text></View>{muted ? <Icon name="notifications-off" size={14} color={C.ink40} /> : null}{summary?.unread_count > 0 ? <View style={[styles.unreadBadge, muted && styles.unreadBadgeMuted]}><Text style={styles.unreadBadgeText}>{summary.unread_count > 99 ? '99+' : summary.unread_count}</Text></View> : <Icon name="chevron-forward" size={17} color={C.teal} />}</Pressable>}
      {!joined && (requested ? <View style={styles.pendingRequestActions}><View style={styles.requestSentStatus}><Icon name="checkmark-circle-outline" size={17} color={C.teal} /><Text style={styles.requestSentStatusText}>Request sent</Text></View><Pressable onPress={(event) => { event.stopPropagation?.(); onCancel(); }} disabled={cancelling} style={[styles.cancelRequestButton, cancelling && styles.saveButtonDisabled]}>{cancelling ? <ActivityIndicator size="small" color={C.brick} /> : <Icon name="close-circle-outline" size={17} color={C.brick} />}<Text style={styles.cancelRequestText}>{cancelling ? 'Cancelling…' : 'Cancel'}</Text></Pressable></View> : <Pressable onPress={(event) => { event.stopPropagation?.(); onJoin(); }} disabled={requesting} style={[styles.joinButton, requesting && styles.requestedButton]}>{requesting ? <ActivityIndicator size="small" color="#0E2321" /> : <Icon name="add" size={17} color="#0E2321" />}<Text style={[styles.joinButtonText, requesting && styles.requestedText]}>{requesting ? (invited ? 'Joining…' : 'Sending request…') : invited ? 'Accept invite' : 'Ask to join'}</Text></Pressable>)}
    </Pressable>
  );
}

function TeamDetail({ team, joined, invited, requested, requesting, cancelling, onBack, onJoin, onCancel, onViewHub, onChat, onUpdateImage, onShare }) {
  const editable = canEditTeam(team);
  const width = useResponsiveWidth();
  const compactPhone = width <= 440;
  return (
    <ScrollView contentContainerStyle={[styles.content, compactPhone && styles.contentCompact]} showsVerticalScrollIndicator={false}>
      <View style={[styles.detailHeader, compactPhone && styles.detailHeaderCompact]}><Pressable onPress={onBack} accessibilityLabel="Go back" hitSlop={8} style={styles.backButton}><Icon name="arrow-back" /></Pressable><View style={styles.detailHeaderCopy}><Text style={styles.eyebrow}>TEAM PROFILE</Text><Text numberOfLines={1} style={styles.detailHeaderTitle}>{team.name}</Text></View><Pressable accessibilityLabel={`Share ${team.name}`} onPress={onShare} style={styles.iconButton}><Icon name="share-social-outline" /></Pressable></View><KitchenLine style={compactPhone && styles.headerLineCompact} />
      <Pressable disabled={!editable} onPress={editable ? () => onUpdateImage(team.id) : undefined} style={styles.detailCoverPressable}><TeamCover team={team} height={218}><View style={styles.detailCoverTop}><View />{editable && <View style={styles.editCoverBadge}><Icon name="camera" size={13} color={C.surface} /><Text style={styles.editCoverText}>Edit cover</Text></View>}</View><View style={styles.detailCoverBottom}><View style={styles.detailIdentity}><Crest team={team} size={62} /><View style={styles.detailIdentityCopy}><Text style={styles.heroTitle}>{team.name}</Text><View style={styles.heroLocation}><Icon name="location-outline" size={15} color="rgba(255,255,255,.78)" /><Text style={styles.heroLocationText}>{team.location}</Text></View></View></View></View></TeamCover></Pressable>
      <View style={[styles.detailStats, compactPhone && styles.detailStatsCompact]}><View style={styles.detailStat}><Text style={styles.detailStatValue}>{team.rating}</Text><Text style={styles.statLabel}>TEAM RATING</Text></View><View style={styles.detailStat}><Text style={styles.detailStatValue}>{team.members}</Text><Text style={styles.statLabel}>MEMBERS</Text></View><View style={styles.detailStat}><Text style={styles.detailStatValue}>{team.winRate || '—'}</Text><Text style={styles.statLabel}>WIN RATE</Text></View></View>
      <Text style={[styles.sectionLabel, compactPhone && styles.sectionLabelCompact]}>ABOUT THE TEAM</Text><Text style={styles.about}>{team.about || 'A friendly local team looking for reliable players and great games.'}</Text>
      <View style={[styles.requirement, compactPhone && styles.requirementCompact]}><Icon name="checkmark-circle-outline" color={C.teal} /><View style={styles.requirementCopy}><Text style={styles.requirementTitle}>Good fit for you</Text><Text style={styles.footText}>{team.level} · Doubles · Weekday evenings</Text></View></View>
      <View style={styles.sectionHead}><Text style={[styles.sectionLabel, compactPhone && styles.sectionLabelCompact]}>MEMBERS</Text><Text style={styles.sectionLink}>{team.members} total</Text></View><View style={[styles.members, compactPhone && styles.membersCompact]}>{(team.roster || []).slice(0, 4).map((member, index) => <ProfilePhoto key={member.id} photo={member.avatar} name={member.name} size={42} style={[styles.avatar, index > 0 && styles.avatarOffset]} />)}</View>
      {joined ? <View style={[styles.memberActions, compactPhone && styles.detailActionsCompact]}><Pressable onPress={onChat} style={[styles.messageButton, compactPhone && styles.detailActionButtonCompact]}><Icon name="chatbubble-outline" size={18} color={C.teal} /><Text style={styles.messageText}>Team chat</Text></Pressable><Pressable onPress={onViewHub} style={[styles.primaryButton, compactPhone && styles.detailActionButtonCompact]}><Text style={styles.primaryText}>View team hub</Text><Icon name="arrow-forward" size={17} color="#0E2321" /></Pressable></View> : requested ? <View style={[styles.pendingRequestActions, compactPhone && styles.detailActionsCompact]}><View style={[styles.requestSentStatus, styles.requestSentStatusLarge, compactPhone && styles.detailActionButtonCompact]}><Icon name="checkmark-circle-outline" color={C.teal} /><Text style={styles.requestSentStatusText}>Request sent</Text></View><Pressable disabled={cancelling} onPress={onCancel} style={[styles.cancelRequestButton, styles.cancelRequestLarge, compactPhone && styles.detailActionButtonCompact, cancelling && styles.saveButtonDisabled]}>{cancelling ? <ActivityIndicator size="small" color={C.brick} /> : <Icon name="close-circle-outline" color={C.brick} />}<Text style={styles.cancelRequestText}>{cancelling ? 'Cancelling…' : 'Cancel request'}</Text></Pressable></View> : <Pressable disabled={requesting} onPress={onJoin} style={[styles.primaryButton, compactPhone && styles.detailActionButtonCompact, compactPhone && styles.detailActionsCompact, requesting && styles.requestedLarge]}>{requesting ? <ActivityIndicator size="small" color="#0E2321" /> : <Icon name="people-outline" color="#0E2321" />}<Text style={styles.primaryText}>{requesting ? (invited ? 'Joining team…' : 'Sending request…') : invited ? 'Accept invitation' : 'Ask to join team'}</Text></Pressable>}
    </ScrollView>
  );
}

function JoinRequestScreen({ team, user, submitting, onBack, onSubmit }) {
  const [introduction, setIntroduction] = useState('');
  const cleanIntroduction = introduction.trim();

  return (
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.detailHeader}><Pressable disabled={submitting} onPress={onBack} accessibilityLabel="Go back" hitSlop={8} style={styles.backButton}><Icon name="arrow-back" /></Pressable><View style={styles.detailHeaderCopy}><Text style={styles.eyebrow}>JOIN REQUEST</Text><Text style={styles.detailHeaderTitle}>Introduce yourself</Text></View></View><KitchenLine />
        <View style={styles.joinRequestTeam}><Crest team={team} size={50} /><View style={styles.joinRequestTeamCopy}><Text style={styles.joinRequestTeamLabel}>APPLYING TO</Text><Text numberOfLines={1} style={styles.joinRequestTeamName}>{team.name}</Text><Text numberOfLines={1} style={styles.footText}>{team.location} · {team.level}</Text></View></View>
        <View style={styles.joinRequestProfile}><ProfilePhoto photo={user?.picture} name={user?.name} size={58} style={styles.joinRequestAvatar} /><View style={styles.joinRequestProfileCopy}><Text style={styles.joinRequestProfileLabel}>YOUR PLAYER PROFILE</Text><Text style={styles.joinRequestProfileName}>{user?.name || 'Peakle player'}</Text><Text numberOfLines={1} style={styles.footText}>{user?.location || 'Location not set'} · {user?.skill ? `${user.skill} rating` : 'Unrated'} · {user?.preference || 'Preference not set'}</Text></View></View>
        <View style={styles.joinRequestIntroHead}><View><Text style={styles.formLabel}>INTRODUCTION</Text><Text style={styles.joinRequestHint}>Tell the team why you’d be a good fit.</Text></View><Text style={styles.joinRequestCount}>{introduction.length}/300</Text></View>
        <TextInput accessibilityLabel="Introduction" value={introduction} onChangeText={setIntroduction} placeholder="Hi! Share your playing experience, availability, and what you’re looking for in a team." placeholderTextColor={C.ink40} maxLength={300} multiline autoCapitalize="sentences" textAlignVertical="top" style={styles.joinRequestInput} />
        <View style={styles.joinRequestPrivacy}><Icon name="eye-outline" size={17} color={C.teal} /><Text style={styles.joinRequestPrivacyText}>Your introduction and player profile will be visible only to this team’s admins while they review your request.</Text></View>
        <View style={styles.joinRequestActions}><Pressable disabled={submitting} onPress={onBack} style={styles.joinRequestCancel}><Text style={styles.declineText}>Cancel</Text></Pressable><Pressable disabled={!cleanIntroduction || submitting} accessibilityState={{ disabled: !cleanIntroduction || submitting, busy: submitting }} onPress={() => onSubmit(cleanIntroduction)} style={[styles.joinRequestSubmit, (!cleanIntroduction || submitting) && styles.joinRequestSubmitDisabled]}>{submitting ? <ActivityIndicator size="small" color="#0E2321" /> : <Icon name="paper-plane-outline" size={17} color="#0E2321" />}<Text style={styles.primaryText}>{submitting ? 'Sending…' : 'Send request'}</Text></Pressable></View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const peopleSummary = (people = []) => {
  const names = people.map((person) => person.name).filter(Boolean);
  if (!names.length) return '';
  const visible = names.slice(0, 3);
  const remaining = names.length - visible.length;
  return `${visible.join(', ')}${remaining > 0 ? ` +${remaining}` : ''}`;
};

// Messenger-style typing bubble: pops in, then the dots rise and darken in a
// continuous wave with a short rest between cycles.
function TypingBubble({ people = [] }) {
  const useNativeDriver = Platform.OS !== 'web';
  const entrance = useRef(new Animated.Value(0)).current;
  const dotAnimations = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.spring(entrance, { toValue: 1, friction: 6, tension: 140, useNativeDriver }).start();
    const animation = Animated.loop(Animated.sequence([
      Animated.stagger(160, dotAnimations.map((dot) => Animated.sequence([
        Animated.timing(dot, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver }),
        Animated.timing(dot, { toValue: 0, duration: 280, easing: Easing.in(Easing.quad), useNativeDriver }),
      ]))),
      Animated.delay(260),
    ]));
    animation.start();
    return () => animation.stop();
  }, [dotAnimations, entrance, useNativeDriver]);
  if (!people.length) return null;
  const first = people[0];
  const label = people.length === 1 ? `${first.name} is typing` : `${peopleSummary(people)} are typing`;
  return (
    <View accessibilityLiveRegion="polite" accessibilityLabel={label} style={styles.typingRow}>
      <Text style={[styles.sender, styles.messageIndent]}>{label}</Text>
      <View style={styles.bubbleActionRow}>
        <ProfilePhoto photo={first.avatar} name={first.name} size={31} style={styles.chatAvatar} />
        <Animated.View style={[styles.bubble, styles.typingBubble, { opacity: entrance, transform: [{ scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
          {dotAnimations.map((dot, index) => (
            <Animated.View
              key={index}
              style={[styles.typingDot, {
                opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] }),
                transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
              }]}
            />
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

function LiveMatchCard({ match, onPress }) {
  if (!match) return null;
  return (
    <Pressable onPress={onPress} style={styles.liveCard}>
      <View style={styles.liveCardHead}><View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveBadgeText}>LIVE MATCH</Text></View><Text style={styles.liveGame}>GAME {match.game}</Text></View>
      <Text style={styles.livePlayers}>{match.players}</Text>
      <View style={styles.liveScoreRow}><View style={styles.liveTeam}><Text style={styles.liveTag}>{match.homeTag}</Text><Text numberOfLines={1} style={styles.liveTeamName}>{match.home}</Text></View><Text style={styles.liveScore}>{match.homeScore}</Text><Text style={styles.liveDash}>–</Text><Text style={styles.liveScore}>{match.awayScore}</Text><View style={[styles.liveTeam, styles.liveTeamAway]}><Text style={styles.liveTag}>{match.awayTag}</Text><Text numberOfLines={1} style={styles.liveTeamName}>{match.away}</Text></View></View>
      <View style={styles.cardServing}><View style={styles.servingDot} /><Text style={styles.cardServingText}>{servingPlayer(match)} serving for {servingTeamName(match)} · Server {match.serviceNumber}</Text></View>
      <View style={styles.liveCardFoot}><Text numberOfLines={1} style={styles.liveLastPlay}>{match.lastPlay}</Text><View style={styles.watchLive}><Text style={styles.watchLiveText}>Watch live</Text><Icon name="arrow-forward" size={14} color={C.ink} /></View></View>
    </Pressable>
  );
}

function VideoAttachment({ uri, mediaOnly = false, style }) {
  const player = useVideoPlayer(uri, (videoPlayer) => { videoPlayer.loop = false; });
  return <VideoView player={player} nativeControls contentFit="contain" style={[styles.chatAttachmentVideo, mediaOnly && styles.chatAttachmentMediaOnly, style]} />;
}

function PopImage({ uri, sticker = false, style, onPress, onLongPress }) {
  const reveal = useRef(new Animated.Value(0)).current;
  const [failed, setFailed] = useState(false);
  const show = () => Animated.spring(reveal, {
    toValue: 1, damping: 16, stiffness: 190, mass: .7, useNativeDriver: Platform.OS !== 'web',
  }).start();
  const image = (
    <Animated.View style={[style, {
      opacity: reveal,
      transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [.9, 1] }) }],
    }]}>
      <ExpoImage source={{ uri }} contentFit={sticker ? 'contain' : 'cover'} transition={110} onLoad={show} onError={() => { setFailed(true); show(); }} style={StyleSheet.absoluteFillObject} />
      {failed && <View style={styles.attachmentFallback}><Icon name="image-outline" color={C.ink40} /><Text style={styles.attachmentFallbackText}>Media unavailable</Text></View>}
    </Animated.View>
  );
  return onPress ? <Pressable accessibilityLabel="Open media preview" onPress={onPress} onLongPress={onLongPress} delayLongPress={240} {...webLongPress(onLongPress)}>{image}</Pressable> : image;
}

function PeopleModal({ details, onClose }) {
  const people = details?.people || [];
  return (
    <Modal visible={Boolean(details)} transparent animationType="fade" onRequestClose={onClose}>
      <View {...webDialog('backdrop')} style={styles.peopleModalBackdrop}>
        <Pressable accessibilityLabel="Close people list" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View {...webDialog('surface')} style={styles.peopleModalCard}>
          <View style={styles.peopleModalHeader}><Text style={styles.peopleModalTitle}>{details?.title || 'People'}</Text><Pressable accessibilityLabel="Close people list" onPress={onClose} style={styles.peopleModalClose}><Icon name="close" size={19} color={C.ink70} /></Pressable></View>
          <Text style={styles.peopleModalSummary}>{peopleSummary(people)}</Text>
          <ScrollView style={styles.peopleModalList} contentContainerStyle={styles.peopleModalListContent} showsVerticalScrollIndicator={false}>
            {people.map((person) => <View key={person.id} style={styles.peopleModalRow}><ProfilePhoto photo={person.avatar} name={person.name} size={42} /><Text style={styles.peopleModalName}>{person.name}</Text>{person.emoji ? <Text style={styles.peopleModalEmoji}>{person.emoji}</Text> : <Icon name="checkmark-circle" size={18} color={C.teal} />}</View>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// The chat header's "more" menu. Members opens in place so players can check
// who is in the conversation without leaving it.
function TeamChatMenu({ team, visible, currentUserId, onClose, onInfo, onMessageMember }) {
  const [view, setView] = useState('menu');
  useEffect(() => { if (visible) setView('menu'); }, [visible]);
  const roster = team?.roster || [];
  const showMembers = view === 'members';
  const rows = [
    { key: 'members', icon: 'people-outline', label: 'Members', detail: `${team?.members || roster.length} ${(team?.members || roster.length) === 1 ? 'member' : 'members'}`, onPress: () => setView('members') },
    { key: 'info', icon: 'information-circle-outline', label: 'Chat info', detail: 'Nicknames, media, search, and mute', onPress: () => { onClose(); onInfo(); } },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View {...webDialog('backdrop')} style={styles.peopleModalBackdrop}>
        <Pressable accessibilityLabel="Close chat options" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View {...webDialog('surface')} style={styles.peopleModalCard}>
          <View style={styles.peopleModalHeader}>
            {showMembers ? <Pressable accessibilityLabel="Back to chat options" onPress={() => setView('menu')} style={styles.peopleModalClose}><Icon name="chevron-back" size={19} color={C.ink70} /></Pressable> : null}
            <Text numberOfLines={1} style={[styles.peopleModalTitle, styles.chatMenuTitle]}>{showMembers ? 'Members' : team?.name}</Text>
            <Pressable accessibilityLabel="Close chat options" onPress={onClose} style={styles.peopleModalClose}><Icon name="close" size={19} color={C.ink70} /></Pressable>
          </View>
          <Text style={styles.peopleModalSummary}>{showMembers ? `${roster.length} ${roster.length === 1 ? 'person' : 'people'} in this team chat` : 'Team conversation'}</Text>
          {showMembers ? (
            <ScrollView style={styles.peopleModalList} contentContainerStyle={styles.peopleModalListContent} showsVerticalScrollIndicator={false}>
              {roster.map((member, index) => <View key={member.id || `${member.name}-${index}`} style={styles.peopleModalRow}><ProfilePhoto photo={member.avatar} name={member.name} size={42} /><View style={styles.rosterCopy}><Text numberOfLines={1} style={styles.rosterName}>{member.name}{member.id === currentUserId ? ' (You)' : ''}</Text><Text style={styles.footText}>{member.role || 'Member'}</Text></View>{PRIVATE_MESSAGES_ENABLED && member.id && member.id !== currentUserId ? <Pressable accessibilityLabel={`Message ${member.name} privately`} onPress={() => { onClose(); onMessageMember(member); }} style={styles.memberMessageButton}><Icon name="chatbubble-outline" size={17} color={C.teal} /></Pressable> : null}</View>)}
            </ScrollView>
          ) : (
            <View accessibilityRole="menu">
              {rows.map((row) => <Pressable key={row.key} accessibilityRole="menuitem" accessibilityLabel={`${row.label}. ${row.detail}`} onPress={row.onPress} style={({ pressed }) => [styles.peopleModalRow, pressed && styles.chatMenuRowPressed]}><View style={styles.memberMessageButton}><Icon name={row.icon} size={18} color={C.teal} /></View><View style={styles.rosterCopy}><Text style={styles.rosterName}>{row.label}</Text><Text numberOfLines={1} style={styles.footText}>{row.detail}</Text></View><Icon name="chevron-forward" size={16} color={C.ink40} /></Pressable>)}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SeenReceipt({ people, onPress }) {
  if (!people.length) return null;
  return (
    <Pressable accessibilityLabel={`Seen by ${peopleSummary(people)}`} onPress={onPress} style={styles.seenReceipt}>
      <View style={styles.seenAvatars}>
        {people.slice(0, 3).map((person, index) => <ProfilePhoto key={person.id} photo={person.avatar} name={person.name} size={18} style={[styles.seenAvatar, index > 0 && styles.seenAvatarOverlap]} />)}
      </View>
      <Text numberOfLines={1} style={styles.seenNames}>{peopleSummary(people)}</Text>
    </Pressable>
  );
}

function ChatSafetyScreen({ team, status, busy, onConfirm, onBack }) {
  const suspended = status?.suspended || (status?.suspendedUntil && new Date(status.suspendedUntil) > new Date());
  return (
    <View style={styles.chatSafetyScreen}>
      <View style={[styles.detailHeader, styles.chatHeader]}>
        <Pressable onPress={onBack} accessibilityLabel="Go back" hitSlop={8} style={styles.backButton}><Icon name="arrow-back" /></Pressable>
        <View style={styles.detailHeaderCopy}><Text style={styles.eyebrow}>TEAM CHAT</Text><Text style={styles.detailHeaderTitle}>{team?.name || 'Chat safety'}</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.chatSafetyContent} showsVerticalScrollIndicator={false}>
        <View style={styles.chatSafetyShield}><Icon name={suspended ? 'lock-closed' : 'shield-checkmark'} size={38} color="#0E2321" /></View>
        <Text style={styles.chatSafetyTitle}>{suspended ? 'Chat access is suspended.' : status?.acknowledged && !status?.isAdult ? 'Chat is for adults only.' : 'Before you join the chat.'}</Text>
        <Text style={styles.chatSafetyBody}>
          {suspended
            ? `Your chat access is unavailable${status.suspendedUntil ? ` until ${new Date(status.suspendedUntil).toLocaleString()}` : ''}. You can still use the rest of Peakle.`
            : 'Peakle team chat is currently available only to players who confirm they are 18 or older. Messages are subject to safety filtering and review after a report.'}
        </Text>
        {!suspended && <View style={styles.chatSafetyRules}>
          {[
            ['heart-outline', 'Be respectful', 'Harassment, hate, threats, and sexual content are not allowed.'],
            ['lock-closed-outline', 'Protect private information', 'Avoid posting phone numbers, addresses, passwords, or financial details.'],
            ['flag-outline', 'Report safety concerns', 'Report a message or block its sender from the message options.'],
          ].map(([icon, title, body]) => <View key={title} style={styles.chatSafetyRule}><View style={styles.chatSafetyRuleIcon}><Icon name={icon} size={18} color={C.teal} /></View><View style={styles.rosterCopy}><Text style={styles.chatSafetyRuleTitle}>{title}</Text><Text style={styles.chatSafetyRuleBody}>{body}</Text></View></View>)}
        </View>}
        {!suspended && <>
          <Pressable disabled={busy} onPress={() => onConfirm(true)} style={[styles.chatSafetyPrimary, busy && styles.saveButtonDisabled]}>{busy ? <ActivityIndicator color="#0E2321" /> : <><Text style={styles.chatSafetyPrimaryText}>I confirm I’m 18 or older</Text><Icon name="arrow-forward" color="#0E2321" /></>}</Pressable>
          <Pressable disabled={busy} onPress={() => onConfirm(false)} style={styles.chatSafetySecondary}><Text style={styles.chatSafetySecondaryText}>I’m under 18</Text></Pressable>
          <Text style={styles.chatSafetyFoot}>This safety acknowledgement is saved to your account. Peakle does not store your birth date for this check.</Text>
        </>}
      </ScrollView>
    </View>
  );
}

function ChatReportModal({ message, onClose, onSubmit }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!message) {
      setReason('');
      setDetails('');
      setBusy(false);
    }
  }, [message]);
  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await onSubmit(message, reason, details);
      onClose();
    } catch (error) {
      Alert.alert('Report not sent', error.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal visible={Boolean(message)} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <View {...webDialog('backdrop')} style={styles.reportBackdrop}>
        <Pressable accessibilityLabel="Close report form" disabled={busy} onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View {...webDialog('surface')} style={styles.reportSheet}>
          <View {...webDialog('handle')} style={styles.actionSheetHandle} />
          <View style={styles.reportHead}><View style={styles.reportHeadIcon}><Icon name="flag" color={C.brick} /></View><View style={styles.rosterCopy}><Text style={styles.reportTitle}>Report message</Text><Text style={styles.reportSubtitle}>The message will be hidden while the report is reviewed.</Text></View><Pressable disabled={busy} onPress={onClose} style={styles.peopleModalClose}><Icon name="close" size={18} color={C.ink70} /></Pressable></View>
          <ScrollView style={styles.reportScroll} contentContainerStyle={styles.reportContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.reportLabel}>WHAT HAPPENED?</Text>
            <View style={styles.reportReasons}>{CHAT_REPORT_REASONS.map((item) => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: reason === item.value }} disabled={busy} onPress={() => setReason(item.value)} style={[styles.reportReason, reason === item.value && styles.reportReasonActive]}><Icon name={item.icon} size={17} color={reason === item.value ? C.teal : C.ink40} /><Text style={[styles.reportReasonText, reason === item.value && styles.reportReasonTextActive]}>{item.label}</Text><Icon name={reason === item.value ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={reason === item.value ? C.teal : C.line} /></Pressable>)}</View>
            <Text style={styles.reportLabel}>OPTIONAL DETAILS</Text>
            <TextInput value={details} onChangeText={setDetails} editable={!busy} maxLength={1000} multiline placeholder="Add context that will help the safety team review this." placeholderTextColor={C.ink40} style={styles.reportInput} />
            <Text style={styles.reportPrivacy}>Reports include the selected message, sender, team, and your account ID. Reports are not shown to the reported player.</Text>
          </ScrollView>
          <Pressable disabled={!reason || busy} onPress={submit} style={[styles.reportSubmit, (!reason || busy) && styles.sendDisabled]}>{busy ? <ActivityIndicator color="#FFFFFF" /> : <><Icon name="flag" size={17} color="#FFFFFF" /><Text style={styles.reportSubmitText}>Submit report</Text></>}</Pressable>
        </View>
      </View>
    </Modal>
  );
}

function MessageInteractionModal({ message, visible, canModerate, currentUserId, onClose, onReact, onPin, onEdit, onDelete, onUnsend, onReport, onBlock, onModerate }) {
  if (!message) return null;
  const visibleText = message.text && !/^Shared a (photo|video|GIF|sticker)$/i.test(message.text) ? message.text : null;
  const actions = [
    canCopyText && visibleText ? { key: 'copy', label: 'Copy', icon: 'copy-outline', onPress: () => copyText(visibleText) } : null,
    { key: 'pin', label: message.pinned ? 'Unpin' : 'Pin', icon: message.pinned ? 'pin' : 'pin-outline', onPress: () => onPin(message.id) },
    message.mine && visibleText ? { key: 'edit', label: 'Edit', icon: 'create-outline', onPress: () => onEdit(message) } : null,
    !message.mine ? { key: 'report', label: 'Report', icon: 'flag-outline', destructive: true, separated: true, onPress: () => onReport(message) } : null,
    !message.mine ? { key: 'block', label: `Block ${message.sender}`, icon: 'ban-outline', destructive: true, onPress: () => onBlock(message) } : null,
    !message.mine && canModerate ? { key: 'moderate', label: 'Remove as moderator', icon: 'shield-outline', destructive: true, onPress: () => onModerate(message) } : null,
    { key: 'delete', label: 'Delete for you', icon: 'trash-outline', separated: message.mine, onPress: () => onDelete(message) },
    message.mine ? { key: 'unsend', label: 'Delete for everyone', icon: 'return-up-back-outline', destructive: true, onPress: () => onUnsend(message) } : null,
  ].filter(Boolean);
  return (
    <MessageFocusModal
      visible={visible}
      mine={message.mine}
      dark={C !== LIGHT_C}
      reactions={REACTION_OPTIONS}
      selectedReactions={(message.reactions || []).filter((reaction) => reaction.user_id === currentUserId).map((reaction) => reaction.emoji)}
      onReact={(emoji) => onReact(message.id, emoji)}
      actions={actions}
      onClose={onClose}
    >
      <View style={[styles.bubble, message.mine && styles.bubbleMine, !visibleText && styles.mediaBubble, !visibleText && message.mine && styles.mediaBubbleMine]}>
        {message.image ? <ExpoImage source={{ uri: message.image }} contentFit="cover" style={[styles.chatAttachmentImage, !visibleText && styles.chatAttachmentMediaOnly]} /> : null}
        {!message.image && message.video ? <View style={styles.deletedMessageRow}><Icon name="videocam-outline" size={14} color={message.mine ? C.surface : C.ink70} /><Text style={[styles.bubbleText, message.mine && styles.bubbleTextMine]}>Video</Text></View> : null}
        {visibleText ? <Text numberOfLines={12} style={[styles.bubbleText, message.mine && styles.bubbleTextMine]}>{visibleText}</Text> : null}
      </View>
    </MessageFocusModal>
  );
}

// Full-screen photo or video from a team chat, with a save button (a download on
// web, the photo library on phones).
function TeamMediaPreview({ message, onClose }) {
  const [saving, setSaving] = useState(false);
  const uri = message?.video || message?.image;
  const save = async () => {
    setSaving(true);
    try { await saveDirectMedia({ id: message.id, mediaUrl: uri, mediaType: message.video ? 'video' : 'image' }); } finally { setSaving(false); }
  };
  return (
    <Modal visible={Boolean(message)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.mediaPreviewBackdrop}>
        {uri ? <Pressable accessibilityRole="button" accessibilityLabel={message.video ? 'Save video' : 'Save photo'} disabled={saving} onPress={save} style={[styles.mediaPreviewClose, styles.mediaPreviewSave]}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <Icon name="download-outline" size={22} color="#FFFFFF" />}</Pressable> : null}
        <Pressable accessibilityLabel="Close media preview" onPress={onClose} style={styles.mediaPreviewClose}><Icon name="close" size={22} color="#FFFFFF" /></Pressable>
        {message?.image && !message.video ? <ExpoImage source={{ uri: message.image }} contentFit="contain" style={styles.mediaPreviewImage} /> : null}
        {message?.video ? <VideoAttachment uri={message.video} style={styles.mediaPreviewVideo} /> : null}
      </View>
    </Modal>
  );
}

const NO_PEOPLE = [];
const NO_MESSAGES = [];
const NO_NICKNAMES = {};

// Memoized so opening the reaction menu (or typing) doesn't re-render every bubble;
// TeamChat passes stable handlers from useStableHandlers.
const ChatMessage = React.memo(function ChatMessage({ message, grouped, highlighted, seenBy, showDeliveryStatus, delivered, currentUserId, peopleById, onMessageLayout, onOpenActions, onReact, onShowPeople, onPreview }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 190, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [enter]);
  const reactionGroups = REACTION_OPTIONS.map((emoji) => ({
    emoji,
    people: message.reactions
      .filter((reaction) => reaction.emoji === emoji)
      .map((reaction) => ({ ...(peopleById[reaction.user_id] || { id: reaction.user_id, name: 'Peakle player', avatar: null }), emoji })),
  })).filter((reaction) => reaction.people.length);
  const hasMedia = Boolean(message.image || message.video);
  const visibleText = message.text && !/^Shared a (photo|video|GIF|sticker)$/i.test(message.text) ? message.text : null;
  const mediaOnly = hasMedia && !visibleText;
  const status = message.deliveryState === 'uploading' ? 'Uploading…' : message.deliveryState === 'sending' ? 'Sending…' : delivered ? 'Delivered' : 'Sent';
  return (
    <Animated.View onLayout={({ nativeEvent }) => onMessageLayout(message.id, nativeEvent.layout.y)} style={[styles.messageRow, message.mine && styles.messageRowMine, grouped && styles.messageGrouped, {
      opacity: enter,
      transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
    }]}>
      <View style={[styles.messageBlock, message.mine && styles.messageBlockMine]}>
        {!message.mine && !grouped && <Text style={[styles.sender, styles.messageIndent]}>{message.sender}</Text>}
        <View style={[styles.bubbleActionRow, message.mine && styles.bubbleActionRowMine]}>
          {!message.mine && !grouped && <ProfilePhoto photo={message.avatar} name={message.sender} size={31} style={styles.chatAvatar} />}
          {!message.mine && grouped && <View style={styles.chatAvatarSpacer} />}
          <Pressable accessibilityHint="Tap or long press for reactions and message options." disabled={Boolean(message.deletedAt || message.deliveryState)} onPress={() => onOpenActions(message.id)} onLongPress={() => onOpenActions(message.id)} delayLongPress={240} {...webLongPress(!message.deletedAt && !message.deliveryState ? () => onOpenActions(message.id) : null)} style={[styles.bubble, unselectable, message.mine && styles.bubbleMine, mediaOnly && styles.mediaBubble, mediaOnly && message.mine && styles.mediaBubbleMine, message.deletedAt && styles.deletedBubble, highlighted && styles.highlightedMessageBubble]}>
            {message.image && <PopImage uri={message.image} sticker={message.mediaKind === 'stickers'} style={[styles.chatAttachmentImage, message.mediaType === 'gif' && styles.chatAttachmentGif, mediaOnly && styles.chatAttachmentMediaOnly]} onPress={() => onPreview(message)} onLongPress={() => onOpenActions(message.id)} />}
            {message.video && <VideoAttachment uri={message.video} mediaOnly={mediaOnly} />}
            {message.deletedAt ? <View style={styles.deletedMessageRow}><Icon name="ban-outline" size={14} color={C.ink40} /><Text style={styles.deletedMessageText}>{message.moderatedAt ? 'Message removed by a moderator' : 'Message unsent'}</Text></View> : visibleText ? <Text selectable={false} style={[styles.bubbleText, unselectable, message.mine && styles.bubbleTextMine]}>{visibleText}</Text> : null}
            {message.deliveryState && hasMedia && <View style={styles.mediaProgress}><ActivityIndicator size="small" color={C.surface} /></View>}
          </Pressable>
        </View>
        <View style={[styles.messageExtras, message.mine ? styles.messageExtrasMine : styles.messageIndent]}>
        {reactionGroups.length > 0 && <View style={[styles.reactionSummary, message.mine && styles.reactionSummaryMine]}>{reactionGroups.map((reaction) => <Pressable key={reaction.emoji} disabled={message.deletedAt} accessibilityLabel={`${reaction.emoji} from ${peopleSummary(reaction.people)}`} onPress={() => onShowPeople(`Reacted ${reaction.emoji}`, reaction.people)} style={[styles.reactionChip, reaction.people.some((person) => person.id === currentUserId) && styles.reactionChipMine]}><Text style={styles.reactionEmoji}>{reaction.emoji}</Text><Text style={styles.reactionCount}>{reaction.people.length}</Text></Pressable>)}</View>}
        <View style={[styles.messageMetaRow, message.mine && styles.messageMetaRowMine]}>{message.pinned && <View style={styles.pinnedMessageBadge}><Icon name="pin" size={9} color={C.teal} /><Text style={styles.pinnedMessageBadgeText}>PINNED</Text></View>}<Text style={[styles.messageTime, message.mine && styles.messageTimeMine]}>{message.time}{message.editedAt ? ' · Edited' : ''}{message.mine && showDeliveryStatus && !seenBy.length ? ` · ${status}` : ''}</Text></View>
        {message.mine && <SeenReceipt people={seenBy} onPress={() => onShowPeople('Seen by', seenBy)} />}
        </View>
      </View>
    </Animated.View>
  );
});

function TeamChat({ team, messages, readStates, currentUser, typing, liveMatch, hasEarlier, loadingEarlier, focusMessageId, onFocusHandled, onLoadEarlier, onBack, onSend, onEdit, onDelete, onUnsend, onReact, onPin, onReport, onBlock, onModerate, onTypingChange, onWatchLive, onInfo, onMessageMember, onJumpToMessage, onAttach }) {
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSafetyBanner, setShowSafetyBanner] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShowSafetyBanner(false), 10000);
    return () => clearTimeout(timer);
  }, []);
  const [editingMessage, setEditingMessage] = useState(null);
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [previewMessage, setPreviewMessage] = useState(null);
  const [peopleDetails, setPeopleDetails] = useState(null);
  const [reportingMessage, setReportingMessage] = useState(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const scrollRef = useRef(null);
  const messageLayoutsRef = useRef({});
  const handledFocusMessageRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const suppressAutoScrollRef = useRef(false);
  const suppressAutoScrollTimerRef = useRef(null);
  const nearBottomRef = useRef(true);
  const typingStopTimer = useRef(null);
  const typingHeartbeatTimer = useRef(null);
  const typingActiveRef = useRef(false);
  const currentUserId = currentUser?.id;
  const pinnedMessages = useMemo(() => messages.filter((m) => m.pinned).sort((a, b) => new Date(b.pinnedAt || 0) - new Date(a.pinnedAt || 0)), [messages]);
  const latestPinned = pinnedMessages[0];
  const rowHandlers = useStableHandlers({
    onMessageLayout: (messageId, y) => { messageLayoutsRef.current[messageId] = y; revealMessage(messageId, y); },
    onOpenActions: (messageId) => openMessageActions(messageId),
    onReact: (...args) => onReact(...args),
    onShowPeople: (title, people) => setPeopleDetails({ title, people }),
  });
  const peopleById = useMemo(() => {
    const people = {};
    (team.roster || []).forEach((member) => {
      people[member.id] = { id: member.id, name: member.name, avatar: member.avatar || null };
    });
    if (currentUserId) people[currentUserId] = { id: currentUserId, name: currentUser?.name || 'You', avatar: currentUser?.picture || null };
    (readStates || []).forEach((state) => {
      const profile = state.profiles || {};
      people[state.user_id] = {
        ...(people[state.user_id] || {}),
        id: state.user_id,
        name: profile.display_name || people[state.user_id]?.name || 'Peakle player',
        avatar: profile.avatar_url || people[state.user_id]?.avatar || null,
      };
    });
    return people;
  }, [currentUser?.name, currentUser?.picture, currentUserId, readStates, team.roster]);
  const seenByMessage = useMemo(() => {
    const receipts = {};
    const mine = messages.filter((message) => message.mine && !message.deliveryState);
    (readStates || []).filter((state) => state.user_id !== currentUserId).forEach((state) => {
      const readAt = new Date(state.last_read_at).getTime();
      const lastSeenMessage = [...mine].reverse().find((message) => new Date(message.createdAt).getTime() <= readAt);
      if (!lastSeenMessage) return;
      receipts[lastSeenMessage.id] = [...(receipts[lastSeenMessage.id] || []), peopleById[state.user_id]];
    });
    return receipts;
  }, [currentUserId, messages, peopleById, readStates]);
  const latestMine = [...messages].reverse().find((message) => message.mine && message.kind !== 'member_joined');
  const latestMineId = latestMine?.id;
  // Sent becomes Delivered once another member's app checks in after the
  // message; no realtime event reports check-ins, so re-read while open.
  const [teamLastActive, setTeamLastActive] = useState(null);
  useEffect(() => {
    let active = true;
    const load = () => getTeamChatLastActive(team.id).then((at) => { if (active) setTeamLastActive(at); });
    load();
    const timer = setInterval(load, 20 * 1000);
    return () => { active = false; clearInterval(timer); };
  }, [team.id, messages.length]);
  const latestMineDelivered = Boolean(latestMine && !latestMine.deliveryState && teamLastActive && new Date(teamLastActive) >= new Date(latestMine.createdAt));
  const selectedMessage = messages.find((message) => message.id === selectedMessageId) || null;
  const revealMessage = useCallback((messageId, y) => {
    if (!focusMessageId || focusMessageId !== messageId || y == null || handledFocusMessageRef.current === messageId) return;
    handledFocusMessageRef.current = messageId;
    nearBottomRef.current = false;
    suppressAutoScrollRef.current = true;
    if (suppressAutoScrollTimerRef.current) clearTimeout(suppressAutoScrollTimerRef.current);
    suppressAutoScrollTimerRef.current = setTimeout(() => { suppressAutoScrollRef.current = false; }, 900);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 72), animated: true }));
    setHighlightedMessageId(messageId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedMessageId(null), 2200);
    onFocusHandled?.(messageId);
  }, [focusMessageId, onFocusHandled]);
  useEffect(() => {
    if (!focusMessageId) handledFocusMessageRef.current = null;
  }, [focusMessageId]);
  useEffect(() => {
    if (!focusMessageId) return;
    const y = messageLayoutsRef.current[focusMessageId];
    if (y == null) return;
    const frame = requestAnimationFrame(() => revealMessage(focusMessageId, y));
    return () => cancelAnimationFrame(frame);
  }, [focusMessageId, messages.length, revealMessage]);
  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    if (suppressAutoScrollTimerRef.current) clearTimeout(suppressAutoScrollTimerRef.current);
  }, []);
  const openMessageActions = (messageId) => {
    setSelectedMessageId(messageId);
  };
  const publishTyping = useCallback((isTyping) => {
    if (typingActiveRef.current === isTyping) return;
    typingActiveRef.current = isTyping;
    onTypingChange?.(isTyping);
  }, [onTypingChange]);
  const startTyping = useCallback(() => {
    publishTyping(true);
    if (typingHeartbeatTimer.current) return;
    typingHeartbeatTimer.current = setInterval(() => {
      if (typingActiveRef.current) onTypingChange?.(true);
    }, TYPING_HEARTBEAT_MS);
  }, [onTypingChange, publishTyping]);
  const stopTyping = useCallback(() => {
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = null;
    if (typingHeartbeatTimer.current) clearInterval(typingHeartbeatTimer.current);
    typingHeartbeatTimer.current = null;
    publishTyping(false);
  }, [publishTyping]);
  const changeDraft = (value) => {
    setDraft(value);
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    if (!value.trim()) {
      stopTyping();
      return;
    }
    startTyping();
    typingStopTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };
  useEffect(() => () => {
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    if (typingHeartbeatTimer.current) clearInterval(typingHeartbeatTimer.current);
    if (typingActiveRef.current) onTypingChange?.(false);
  }, [onTypingChange]);
  const send = () => {
    const clean = draft.trim();
    if (!clean) return;
    if (editingMessage) onEdit(editingMessage.id, clean);
    else onSend(clean);
    stopTyping();
    setDraft('');
    setEditingMessage(null);
  };
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage?.mine && !nearBottomRef.current) return undefined;
    if (focusMessageId || suppressAutoScrollRef.current) return undefined;
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [focusMessageId, lastMessageId, messages]);
  const showAttachmentOptions = () => Alert.alert('Send attachment', 'Choose what to share with your team.', [
    { text: 'Photo', onPress: () => onAttach('image') },
    { text: 'Video', onPress: () => onAttach('video') },
    { text: 'Cancel', style: 'cancel' },
  ]);
  const confirmDelete = (message) => Alert.alert('Delete for you?', 'This message will disappear only from your account.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => onDelete(message.id) },
  ]);
  const confirmUnsend = (message) => Alert.alert('Delete for everyone?', 'The message content and attachment will be removed for every team member.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete for everyone', style: 'destructive', onPress: () => onUnsend(message.id) },
  ]);
  const confirmBlock = (message) => Alert.alert(`Block ${message.sender}?`, 'Their messages will be hidden from your team chats. They will not be notified, and you can unblock them from Chat info.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Block player', style: 'destructive', onPress: () => onBlock(message) },
  ]);
  const confirmModerate = (message) => Alert.alert('Remove message for everyone?', 'This creates a moderation record and removes the content for every team member.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove message', style: 'destructive', onPress: () => onModerate(message, 'Removed by a team moderator after reviewing the message.') },
  ]);
  return (
    <KeyboardAvoidingView style={styles.chatScreen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
      <View style={[styles.detailHeader, styles.chatHeader]}><Pressable onPress={onBack} accessibilityLabel="Go back" hitSlop={8} style={styles.backButton}><Icon name="arrow-back" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`${team.name}. Chat info`} onPress={onInfo} style={({ pressed }) => [styles.chatHeaderIdentity, pressed && styles.pressed]}><Crest team={team} size={43} /><View style={styles.detailHeaderCopy}><Text style={styles.detailHeaderTitle}>{team.name}</Text><View style={styles.onlineRow}><Text style={styles.chatStatus}>{team.members} {team.members === 1 ? 'member' : 'members'}</Text></View></View></Pressable><Pressable accessibilityLabel="Chat options" accessibilityHint="See members or open chat info" onPress={() => setMenuOpen(true)} style={styles.iconButton}><Icon name="ellipsis-horizontal" /></Pressable></View>
      {latestPinned && (
        <Pressable accessibilityLabel="Go to pinned message" accessibilityHint="Scrolls to the original message in this chat" onPress={() => onJumpToMessage(latestPinned)} style={styles.chatPinnedBanner}>
          <Icon name="pin" size={14} color={C.teal} />
          <View style={styles.chatPinnedBannerCopy}>
            <Text style={styles.chatPinnedBannerTitle}>Pinned Message</Text>
            <Text numberOfLines={1} style={styles.chatPinnedBannerText}>{latestPinned.text || (latestPinned.image ? 'Photo' : (latestPinned.video ? 'Video' : 'Attachment'))}</Text>
          </View>
          <Icon name="chevron-forward" size={16} color={C.ink40} />
        </Pressable>
      )}
      <View style={styles.chatRule} />
      {showSafetyBanner && <View style={styles.chatSafetyBanner}><Icon name="shield-checkmark-outline" size={15} color={C.teal} /><Text style={styles.chatSafetyBannerText}>Keep it respectful. Don’t share sensitive personal information.</Text></View>}
      <ScrollView
        ref={scrollRef}
        style={styles.chatMessages}
        contentContainerStyle={styles.chatContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={({ nativeEvent }) => {
          const distanceFromBottom = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y;
          nearBottomRef.current = distanceFromBottom < 120;
        }}
        onContentSizeChange={() => {
          if (!focusMessageId && nearBottomRef.current) scrollRef.current?.scrollToEnd({ animated: true });
        }}
      >
        {hasEarlier && <Pressable disabled={loadingEarlier} onPress={onLoadEarlier} style={styles.loadEarlierButton}>{loadingEarlier ? <ActivityIndicator size="small" color={C.teal} /> : <Text style={styles.loadEarlierText}>Load earlier messages</Text>}</Pressable>}
        <Text style={styles.chatDay}>TODAY</Text>
        <View style={styles.chatTapArea}>
        {messages.map((message, index) => {
          if (message.type === 'live-match') return <View key={message.id} style={styles.autoMatchMessage}><View style={styles.autoMatchLabel}><Icon name="radio-outline" size={14} color={C.teal} /><Text style={styles.autoMatchLabelText}>Peakle Match Center posted automatically</Text></View><LiveMatchCard match={liveMatch} onPress={onWatchLive} /></View>;
          if (message.kind === 'member_joined') return message.text ? <View key={message.id} accessibilityRole="text" style={styles.memberJoinedNotice}><Icon name="person-add-outline" size={13} color={C.teal} /><Text style={styles.memberJoinedText}>{message.mine ? 'You joined the club' : message.text}</Text><Text style={styles.memberJoinedTime}>{message.time}</Text></View> : null;
          const previous = messages[index - 1];
          const grouped = previous?.kind !== 'member_joined' && previous?.sender === message.sender && previous?.mine === message.mine;
          return <ChatMessage key={message.id} message={message} grouped={grouped} highlighted={highlightedMessageId === message.id} seenBy={seenByMessage[message.id] || NO_PEOPLE} showDeliveryStatus={message.id === latestMineId} delivered={message.id === latestMineId && latestMineDelivered} currentUserId={currentUserId} peopleById={peopleById} onMessageLayout={rowHandlers.onMessageLayout} onOpenActions={rowHandlers.onOpenActions} onReact={rowHandlers.onReact} onShowPeople={rowHandlers.onShowPeople} onPreview={setPreviewMessage} />;
        })}
        {typing?.length > 0 && <TypingBubble people={typing} />}
        </View>
      </ScrollView>
      {editingMessage && <View style={styles.editingBanner}><Icon name="create-outline" size={16} color={C.teal} /><View style={styles.editingCopy}><Text style={styles.editingTitle}>Editing message</Text><Text numberOfLines={1} style={styles.editingPreview}>{editingMessage.text}</Text></View><Pressable accessibilityLabel="Cancel editing" onPress={() => { stopTyping(); setEditingMessage(null); setDraft(''); }}><Icon name="close" color={C.ink40} /></Pressable></View>}
      <View style={styles.composer}><Pressable accessibilityLabel="Add photo or video" onPress={showAttachmentOptions} style={styles.addAttachment}><Icon name="add" size={23} color={C.teal} /></Pressable><View style={styles.composerInput}><TextInput value={draft} onChangeText={changeDraft} onBlur={stopTyping} onSubmitEditing={send} returnKeyType="send" multiline maxLength={4000} placeholder={editingMessage ? 'Edit message' : `Message ${team.name}`} placeholderTextColor={C.ink40} style={styles.chatInput} /><Pressable disabled={!draft.trim()} onPress={send} accessibilityLabel={editingMessage ? 'Save edited message' : 'Send message'} style={[styles.sendButton, !draft.trim() && styles.sendDisabled]}><Icon name={editingMessage ? 'checkmark' : 'arrow-up'} size={19} color="#0E2321" /></Pressable></View></View>
      <MessageInteractionModal
        message={selectedMessage}
        visible={Boolean(selectedMessage && !selectedMessage.deletedAt && !selectedMessage.deliveryState)}
        onClose={() => setSelectedMessageId(null)}
        onReact={onReact}
        onPin={onPin}
        canModerate={canReviewRequests(team)}
        currentUserId={currentUserId}
        onEdit={(item) => { setEditingMessage(item); setDraft(item.text || ''); }}
        onDelete={confirmDelete}
        onUnsend={confirmUnsend}
        onReport={setReportingMessage}
        onBlock={confirmBlock}
        onModerate={confirmModerate}
      />
      <ChatReportModal message={reportingMessage} onClose={() => setReportingMessage(null)} onSubmit={onReport} />
      <PeopleModal details={peopleDetails} onClose={() => setPeopleDetails(null)} />
      <TeamChatMenu team={team} visible={menuOpen} currentUserId={currentUserId} onClose={() => setMenuOpen(false)} onInfo={onInfo} onMessageMember={onMessageMember} />
      <TeamMediaPreview message={previewMessage} onClose={() => setPreviewMessage(null)} />
    </KeyboardAvoidingView>
  );
}

function MemberManagementModal({ member, visible, managerRole, onClose, onChangeRole, onRemove }) {
  const [busy, setBusy] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!visible) setBusy(false);
  }, [visible]);
  if (!member) return null;
  const roleChoices = managerRole === 'Owner' ? ['Admin', 'Co-admin', 'Member'] : managerRole === 'Admin' ? ['Co-admin', 'Member'] : [];
  const changeRole = async (role) => {
    if (busy || role === member.role) return;
    setBusy(true);
    try {
      await onChangeRole(member, role);
      onClose();
    } catch (error) {
      Alert.alert('Role not updated', error.message);
    } finally {
      setBusy(false);
    }
  };
  const confirmRemove = () => Alert.alert(
    `Remove ${member.name}?`,
    'They will lose access to the team chat, member-only activity, and team matches. Their previous messages will remain.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove member',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await onRemove(member);
            onClose();
          } catch (error) {
            Alert.alert('Member not removed', error.message);
          } finally {
            setBusy(false);
          }
        },
      },
    ],
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <View {...webDialog('backdrop')} style={styles.memberManagementBackdrop}>
        <Pressable accessibilityLabel="Close member management" disabled={busy} onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View {...webDialog('surface')} style={[styles.memberManagementSheet, { maxHeight: Math.min(680, windowHeight - Math.max(insets.top, 12) - 12) }]}>
          <View {...webDialog('handle')} style={styles.actionSheetHandle} />
          <View style={styles.memberManagementHead}>
            <ProfilePhoto photo={member.avatar} name={member.name} size={48} />
            <View style={styles.rosterCopy}><Text style={styles.memberManagementTitle}>{member.name}</Text><Text style={styles.memberManagementCurrent}>{member.role}</Text></View>
            <Pressable accessibilityLabel="Close" disabled={busy} onPress={onClose} style={styles.peopleModalClose}><Icon name="close" size={18} color={C.ink70} /></Pressable>
          </View>
          <ScrollView style={styles.memberManagementScroll} contentContainerStyle={styles.memberManagementScrollContent} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            {roleChoices.length > 0 && <View style={styles.memberRoleSection}>
              <Text style={styles.memberManagementLabel}>ROLE AND ACCESS</Text>
              {roleChoices.map((role) => {
                const selected = member.role === role;
                return <Pressable key={role} disabled={busy || selected} onPress={() => changeRole(role)} style={({ pressed }) => [styles.memberRoleOption, selected && styles.memberRoleOptionSelected, pressed && !selected && styles.memberRoleOptionPressed]}><View style={[styles.memberRoleIcon, selected && styles.memberRoleIconSelected]}><Icon name={role === 'Admin' ? 'shield-checkmark-outline' : role === 'Co-admin' ? 'key-outline' : 'person-outline'} size={19} color={selected ? C.teal : C.ink70} /></View><View style={styles.rosterCopy}><View style={styles.memberRoleTitleRow}><Text style={styles.memberRoleTitle}>{role}</Text></View><Text style={styles.memberRoleDescription}>{TEAM_ROLE_DETAILS[role]}</Text></View>{selected && <Icon name="checkmark-circle" size={21} color={C.teal} />}</Pressable>;
              })}
            </View>}
            <View style={styles.memberSafetyNote}><Icon name="information-circle-outline" size={17} color={C.teal} /><Text style={styles.memberSafetyText}>Role changes take effect immediately. Team ownership cannot be changed from this menu.</Text></View>
          </ScrollView>
          <View style={[styles.memberManagementFooter, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <Pressable disabled={busy} onPress={confirmRemove} style={({ pressed }) => [styles.removeMemberButton, busy && styles.saveButtonDisabled, pressed && styles.removeMemberButtonPressed]}>
              <View style={styles.removeMemberIcon}>{busy ? <ActivityIndicator size="small" color={C.brick} /> : <Icon name="person-remove-outline" size={18} color={C.brick} />}</View>
              <View style={styles.rosterCopy}><Text style={styles.removeMemberText}>Remove from team</Text><Text style={styles.removeMemberHelp}>Revoke chat and member-only access</Text></View>
              <Icon name="chevron-forward" size={17} color={C.brick} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Messenger-style chat info for a team chat. Nicknames and search open on top
// of this screen; search covers the messages this chat has loaded.
function TeamChatInfo({ team, isDark, currentUserId, messages, nicknames, mutedUntil, pinnedMessages, sharedMedia, blockedUsers, loading, openingMessageId, onBack, onViewTeam, onViewMessage, onPin, onUnblock, onChangeMemberRole, onRemoveMember, onMessageMember, onSaveNickname, onMute, onUnmute }) {
  const [previewMessage, setPreviewMessage] = useState(null);
  const [managedMember, setManagedMember] = useState(null);
  const [panel, setPanel] = useState(null);
  const colors = chatInfoColors(isDark);
  const messagePreview = (message) => {
    if (message.text && !/^Shared a (photo|video|GIF|sticker)$/i.test(message.text)) return message.text;
    if (message.video) return 'Video';
    if (message.mediaType === 'gif') return 'GIF';
    if (message.image) return 'Photo';
    return 'Message';
  };
  const displayName = (member) => nicknames[member.id] || member.name;
  const media = useMemo(() => sharedMedia
    .filter((message) => message.mediaKind !== 'stickers' && (message.image || message.video))
    .map((message) => ({ id: message.id, uri: message.image, kind: message.video ? 'video' : message.mediaType === 'gif' ? 'gif' : 'photo', source: message })), [sharedMedia]);
  const links = useMemo(() => extractChatLinks(messages), [messages]);
  const people = (team.roster || []).filter((member) => member.id).map((member) => ({ id: member.id, name: member.name, avatar: member.avatar, you: member.id === currentUserId, nickname: nicknames[member.id] || null }));
  const muted = isMuteActive(mutedUntil);
  const goToMessage = (message) => {
    setPanel(null);
    setTimeout(() => onViewMessage(message), Platform.OS === 'ios' ? 350 : 0);
  };
  return (
    <View style={styles.chatInfoScreen}>
      <ChatInfoScreen
        colors={colors}
        title={team.name}
        subtitle={`${team.members} ${team.members === 1 ? 'member' : 'members'}`}
        avatar={<Crest team={team} size={112} />}
        quickActions={[
          { key: 'team', icon: 'people-circle-outline', label: 'Team', onPress: onViewTeam },
          { key: 'nicknames', icon: 'text-outline', label: 'Nicknames', onPress: () => setPanel('nicknames') },
          { key: 'search', icon: 'search', label: 'Search', onPress: () => setPanel('search') },
        ]}
        media={media}
        links={links}
        mediaLoading={loading}
        onOpenMedia={(item) => setPreviewMessage(item.source)}
        preview={<TeamMediaPreview message={previewMessage} onClose={() => setPreviewMessage(null)} />}
        mute={{ muted, label: muteStatusLabel(mutedUntil), name: team.name, onMute, onUnmute }}
        onBack={onBack}
        footer={<>
          <ChatInfoSection title="Privacy & support" colors={colors} right={blockedUsers.length > 0 ? <Text style={styles.sectionLink}>{blockedUsers.length} blocked</Text> : null}>
            {blockedUsers.length ? <View style={styles.chatInfoMembers}>{blockedUsers.map((player, index) => <View key={player.id} style={[styles.chatInfoMember, index > 0 && styles.rosterBorder]}><ProfilePhoto photo={player.avatar} name={player.name} size={42} /><View style={styles.rosterCopy}><Text style={styles.rosterName}>{player.name}</Text><Text style={styles.footText}>Messages hidden from your team chats</Text></View><Pressable accessibilityLabel={`Unblock ${player.name}`} onPress={() => onUnblock(player)} style={styles.unblockButton}><Text style={styles.unblockButtonText}>Unblock</Text></Pressable></View>)}</View> : <View style={styles.chatInfoEmpty}><View style={styles.chatInfoEmptyIcon}><Icon name="shield-checkmark-outline" size={22} color={C.teal} /></View><View style={styles.rosterCopy}><Text style={styles.emptyTitle}>No blocked players</Text><Text style={styles.footText}>Use a message’s options to report or block its sender.</Text></View></View>}
          </ChatInfoSection>
          <View style={styles.chatInfoSafetyNote}><Icon name="information-circle-outline" size={17} color={C.teal} /><Text style={styles.chatInfoSafetyText}>If someone may be in immediate danger, contact local emergency services. Reporting in Peakle does not replace emergency help.</Text></View>
        </>}
      >
        <ChatInfoSection title="Pinned messages" colors={colors} right={pinnedMessages.length > 0 ? <Text style={styles.sectionLink}>{pinnedMessages.length}</Text> : null}>
          {loading ? <View style={styles.chatInfoLoading}><ActivityIndicator color={C.teal} /><Text style={styles.footText}>Loading conversation details…</Text></View> : pinnedMessages.length ? (
            <View style={styles.pinnedList}>{pinnedMessages.map((message) => (
              <Pressable key={message.id} accessibilityLabel={`Go to pinned message from ${message.sender}`} accessibilityHint="Opens the original message in team chat" disabled={Boolean(openingMessageId)} onPress={() => onViewMessage(message)} style={styles.pinnedCard}>
                <View style={styles.pinnedCardIcon}><Icon name="pin" size={16} color={C.teal} /></View>
                <View style={styles.pinnedCardCopy}><Text style={styles.pinnedCardSender}>{nicknames[message.senderId] || message.sender}</Text><Text numberOfLines={3} style={styles.pinnedCardText}>{messagePreview(message)}</Text><Text style={styles.pinnedCardTime}>{new Date(message.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · {message.time}</Text></View>
                {openingMessageId === message.id ? <View style={styles.pinnedCardAction}><ActivityIndicator size="small" color={C.teal} /></View> : <Pressable accessibilityLabel="Unpin message" onPress={(event) => { event.stopPropagation?.(); onPin(message.id); }} style={styles.pinnedCardAction}><Icon name="close" size={16} color={C.ink40} /></Pressable>}
              </Pressable>
            ))}</View>
          ) : <View style={styles.chatInfoEmpty}><View style={styles.chatInfoEmptyIcon}><Icon name="pin-outline" size={22} color={C.teal} /></View><View style={styles.rosterCopy}><Text style={styles.emptyTitle}>No pinned messages</Text><Text style={styles.footText}>Long-press a message and choose Pin message to keep it here.</Text></View></View>}
        </ChatInfoSection>

        <ChatInfoSection title="Members" colors={colors} right={<Text style={styles.sectionLink}>{team.members} total</Text>}>
          <View style={styles.chatInfoMembers}>{(team.roster || []).map((member, index) => <View key={member.id || `${member.name}-${index}`} style={[styles.chatInfoMember, index > 0 && styles.rosterBorder]}><ProfilePhoto photo={member.avatar} name={member.name} size={42} /><View style={styles.rosterCopy}><Text style={styles.rosterName}>{displayName(member)}{member.id === currentUserId ? ' (You)' : ''}</Text><Text style={styles.footText}>{nicknames[member.id] ? `${member.name} · ` : ''}{member.role || 'Member'}</Text></View>{PRIVATE_MESSAGES_ENABLED && member.id !== currentUserId && <Pressable accessibilityLabel={`Message ${member.name} privately`} onPress={() => onMessageMember(member)} style={styles.memberMessageButton}><Icon name="chatbubble-outline" size={17} color={C.teal} /></Pressable>}{canManageRosterMember(team, member, currentUserId) && <Pressable accessibilityLabel={`Manage ${member.name}`} accessibilityHint={team.role === 'Co-admin' ? 'Remove this member' : 'Change role or remove this member'} onPress={() => setManagedMember(member)} style={styles.memberMoreButton}><Icon name="ellipsis-horizontal" size={20} color={C.ink70} /></Pressable>}</View>)}</View>
        </ChatInfoSection>
      </ChatInfoScreen>
      <MemberManagementModal member={managedMember} visible={Boolean(managedMember)} managerRole={team.role} onClose={() => setManagedMember(null)} onChangeRole={onChangeMemberRole} onRemove={onRemoveMember} />
      <NicknamesModal visible={panel === 'nicknames'} people={people} colors={colors} onSave={onSaveNickname} onClose={() => setPanel(null)} />
      <ChatSearchModal visible={panel === 'search'} messages={messages} colors={colors} onSelect={goToMessage} onClose={() => setPanel(null)} />
    </View>
  );
}

function TeamScorerPicker({ visible, team, currentUserId, selectedId = null, busy, changing = false, onClose, onSelect }) {
  const players = [...(team?.roster || [])].sort((a, b) => {
    if (a.id === currentUserId) return -1;
    if (b.id === currentUserId) return 1;
    return a.name.localeCompare(b.name);
  });
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <View {...webDialog('backdrop')} style={styles.scorerPickerBackdrop}>
        <Pressable accessibilityLabel="Close scorer selection" disabled={busy} onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View {...webDialog('surface')} style={styles.scorerPickerSheet}>
          <View {...webDialog('handle')} style={styles.actionSheetHandle} />
          <View style={styles.scorerPickerHead}><View><Text style={styles.eyebrow}>{changing ? 'LIVE MATCH' : 'MATCH SETUP'}</Text><Text style={styles.scorerPickerTitle}>{changing ? 'Change the scorer' : 'Choose the scorer'}</Text></View><Pressable accessibilityLabel="Close" disabled={busy} onPress={onClose} style={styles.peopleModalClose}><Icon name="close" size={18} color={C.ink70} /></Pressable></View>
          <Text style={styles.scorerPickerHelp}>Scoring controls will be available on this player’s phone. You can choose any signed-in member of {team?.name || 'your team'}.</Text>
          <ScrollView style={styles.scorerPickerList} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            {players.map((player) => { const selected = player.id === selectedId; return <Pressable key={player.id} accessibilityLabel={`Assign ${player.name} as match scorer`} disabled={busy || selected} onPress={() => onSelect(player.id)} style={({ pressed }) => [styles.scorerPickerRow, selected && styles.scorerPickerRowSelected, pressed && !selected && styles.pressed]}><ProfilePhoto photo={player.avatar} name={player.name} size={43} /><View style={styles.rosterCopy}><Text style={styles.scorerPickerName}>{player.name}{player.id === currentUserId ? ' (You)' : ''}</Text><Text style={styles.footText}>{selected ? 'Current scorer' : `${player.role || 'Team member'} · Signed-in scorer`}</Text></View><Icon name={selected ? 'checkmark-circle' : 'chevron-forward'} size={selected ? 20 : 17} color={C.teal} /></Pressable>; })}
          </ScrollView>
          {busy ? <View style={styles.scorerPickerBusy}><ActivityIndicator color={C.teal} /><Text style={styles.footText}>Starting the match…</Text></View> : null}
        </View>
      </View>
    </Modal>
  );
}

function LiveScore({ team, match, scoringMode, busy, currentUserId, onBack, onRally, onUndo, onFinishGame, onFinishMatch, onChangeScorer }) {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const spokenStateRef = useRef(null);
  useEffect(() => () => stopScoreAnnouncement(), []);
  useEffect(() => {
    if (!voiceEnabled || !match) return;
    const stateKey = `${match.game}:${match.homeScore}:${match.awayScore}:${match.servingTeam}:${match.serviceNumber}`;
    if (!spokenStateRef.current || spokenStateRef.current === stateKey) {
      spokenStateRef.current = stateKey;
      return;
    }
    spokenStateRef.current = stateKey;
    speakScoreAnnouncement({
      action: match.lastPlay,
      score: `${match.homeScore} – ${match.awayScore}`,
      nextServe: `${servingTeamName(match)} serving, server ${match.serviceNumber}`,
    });
  }, [match?.awayScore, match?.game, match?.homeScore, match?.lastPlay, match?.serviceNumber, match?.servingTeam, voiceEnabled]);
  if (!match) return null;
  const canControl = scoringMode && match.canScore;
  const games = [...(match.completedGames || []), { home: match.homeScore, away: match.awayScore, current: true }];
  const homeGamesWon = (match.completedGames || []).filter((game) => game.home > game.away).length;
  const awayGamesWon = (match.completedGames || []).filter((game) => game.away > game.home).length;
  const gamePoint = Math.max(match.homeScore, match.awayScore) >= 11 && Math.abs(match.homeScore - match.awayScore) >= 2;
  const toggleVoice = () => {
    if (voiceEnabled) {
      stopScoreAnnouncement();
      setVoiceEnabled(false);
      return;
    }
    spokenStateRef.current = `${match.game}:${match.homeScore}:${match.awayScore}:${match.servingTeam}:${match.serviceNumber}`;
    speakScoreAnnouncement({ action: 'Voice score announcements on', score: `${match.homeScore} – ${match.awayScore}`, nextServe: `${servingTeamName(match)} serving, server ${match.serviceNumber}` });
    setVoiceEnabled(true);
  };
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.detailHeader}><Pressable onPress={onBack} accessibilityLabel="Back to team chat" hitSlop={8} style={styles.backButton}><Icon name="arrow-back" /></Pressable><View style={styles.detailHeaderCopy}><Text style={styles.eyebrow}>LIVE SCORING</Text><Text style={styles.detailHeaderTitle}>{team.name}</Text></View><View style={styles.liveHeaderBadge}><View style={styles.liveDot} /><Text style={styles.liveHeaderText}>LIVE</Text></View></View><KitchenLine />
      <View style={styles.scoreHero}>
        <Text style={styles.scoreVenue}>{match.venue}</Text><Text style={styles.scoreGame}>GAME {match.game}</Text>
        <View style={styles.scoreTeams}><View style={styles.scoreTeam}><View style={[styles.scoreCrest, { backgroundColor: C.teal }]}><Text style={styles.scoreCrestText}>{match.homeTag}</Text></View><Text style={styles.scoreTeamName}>{match.home}</Text></View><View style={styles.scoreNumbers}><Text style={styles.scoreNumber}>{match.homeScore}</Text><Text style={styles.scoreSeparator}>:</Text><Text style={styles.scoreNumber}>{match.awayScore}</Text></View><View style={styles.scoreTeam}><View style={[styles.scoreCrest, { backgroundColor: C.brick }]}><Text style={styles.scoreCrestText}>{match.awayTag}</Text></View><Text style={styles.scoreTeamName}>{match.away}</Text></View></View>
        <View style={styles.servingRow}><View style={styles.servingDot} /><Text style={styles.servingText}>{servingTeamName(match)} serving · Server {match.serviceNumber}</Text></View>
      </View>
      {canControl ? <View style={styles.scorerPanel}><View style={styles.scorerHead}><View><Text style={styles.eyebrow}>SCORER CONTROLS</Text><Text style={styles.scorerTitle}>{match.scorer} is scoring</Text></View><View style={styles.scorerHeadActions}><Pressable accessibilityRole="switch" accessibilityState={{ checked: voiceEnabled }} accessibilityLabel={`Voice score announcements ${voiceEnabled ? 'on' : 'off'}`} onPress={toggleVoice} style={[styles.voiceScoreButton, voiceEnabled && styles.voiceScoreButtonActive]}><Icon name={voiceEnabled ? 'volume-high' : 'volume-mute-outline'} size={13} color={C.teal} /><Text style={styles.voiceScoreText}>VOICE {voiceEnabled ? 'ON' : 'OFF'}</Text></Pressable>{match.canAssignScorer ? <Pressable accessibilityLabel="Change match scorer" onPress={onChangeScorer} style={styles.voiceScoreButton}><Icon name="swap-horizontal-outline" size={13} color={C.teal} /><Text style={styles.voiceScoreText}>CHANGE</Text></Pressable> : <View style={styles.scorerBadge}><Icon name="create-outline" size={13} color={C.teal} /><Text style={styles.scorerBadgeText}>SCORER</Text></View>}</View></View>
        {gamePoint ? <><Text style={styles.scorerHelp}>This game is ready to finish at {match.homeScore}–{match.awayScore}.</Text><Pressable disabled={busy} onPress={onFinishGame} style={styles.switchServeButton}><Icon name="checkmark-done" size={19} color={C.surface} /><Text style={styles.switchServeText}>Finish game & continue</Text></Pressable></> : <>
          <Text style={styles.scorerHelp}>Choose the rally winner. Turn Voice on to hear every score and the next server aloud.</Text>
          <View style={styles.rallyButtons}><Pressable disabled={busy} onPress={() => onRally('home')} style={[styles.rallyButton, match.servingTeam === 'home' && styles.rallyButtonServing]}><Text style={styles.rallyTag}>{match.homeTag}</Text><Text style={styles.rallyButtonText}>Won rally</Text>{match.servingTeam === 'home' && <Text style={styles.rallyServingText}>SERVING</Text>}</Pressable><Pressable disabled={busy} onPress={() => onRally('away')} style={[styles.rallyButton, match.servingTeam === 'away' && styles.rallyButtonServing]}><Text style={styles.rallyTag}>{match.awayTag}</Text><Text style={styles.rallyButtonText}>Won rally</Text>{match.servingTeam === 'away' && <Text style={styles.rallyServingText}>SERVING</Text>}</Pressable></View>
        </>}
        <Pressable disabled={busy || !match.canUndo} onPress={onUndo} style={[styles.switchServeButton, !match.canUndo && styles.pressed]}><Icon name="arrow-undo" size={19} color={C.surface} /><Text style={styles.switchServeText}>Undo last rally</Text></Pressable>
        {games.length > 1 || match.completedGames?.length ? <Pressable disabled={busy} onPress={onFinishMatch} style={styles.declineButton}><Text style={styles.declineText}>Finish match</Text></Pressable> : null}
      </View> : <View style={styles.viewerNotice}><Icon name="eye-outline" color={C.teal} /><View style={styles.rosterCopy}><Text style={styles.rosterName}>View-only live coverage</Text><Text style={styles.footText}>Only the assigned scorer {match.scorer} can update points and serving.</Text></View><View style={styles.viewerBadge}><Text style={styles.viewerBadgeText}>VIEWER</Text></View></View>}
      <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>BOX SCORE</Text><Text style={styles.h2}>Score by set</Text></View><Text style={styles.sectionLink}>{homeGamesWon}–{awayGamesWon} sets</Text></View>
      <View style={styles.boxScore}><View style={styles.boxScoreRow}><Text style={[styles.boxTeam, styles.boxHeader]}>TEAM</Text>{games.map((game, index) => <Text key={`head-${index}`} style={[styles.boxValue, styles.boxHeader]}>S{index + 1}{game.current ? '*' : ''}</Text>)}<Text style={[styles.boxValue, styles.boxHeader]}>W</Text></View><View style={[styles.boxScoreRow, styles.boxScoreBorder]}><Text numberOfLines={1} style={styles.boxTeam}>{match.homeTag} · {match.home}</Text>{games.map((game, index) => <Text key={`home-${index}`} style={[styles.boxValue, game.current && styles.boxCurrent]}>{game.home}</Text>)}<Text style={[styles.boxValue, styles.boxWon]}>{homeGamesWon}</Text></View><View style={[styles.boxScoreRow, styles.boxScoreBorder]}><Text numberOfLines={1} style={styles.boxTeam}>{match.awayTag} · {match.away}</Text>{games.map((game, index) => <Text key={`away-${index}`} style={[styles.boxValue, game.current && styles.boxCurrent]}>{game.away}</Text>)}<Text style={[styles.boxValue, styles.boxWon]}>{awayGamesWon}</Text></View><Text style={styles.boxFootnote}>* Current set</Text></View>
      <View style={styles.liveInfoCard}><Icon name="people-outline" color={C.teal} /><View style={styles.rosterCopy}><Text style={styles.rosterName}>{match.players}</Text><Text style={styles.footText}>Format on court</Text></View></View>
      <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>POINT BY POINT</Text><Text style={styles.h2}>Match activity</Text></View><View style={styles.syncBadge}><Icon name="sync" size={12} color={C.teal} /><Text style={styles.syncText}>Scorer-synced</Text></View></View>
      <View style={styles.liveActivity}><View style={styles.liveActivityIcon}><Icon name="tennisball-outline" size={18} color={C.teal} /></View><View style={styles.rosterCopy}><Text style={styles.rosterName}>{match.lastPlay}</Text><Text style={styles.footText}>Just now · Score {match.homeScore}–{match.awayScore}</Text></View></View>
      <View style={styles.liveNotice}><Icon name="notifications-outline" color={C.teal} /><Text style={styles.liveNoticeText}>Every rally is recorded to {team.name}'s match history so anyone can catch up or review a disputed call later.</Text></View>
    </ScrollView>
  );
}

function FormField({ label, value, onChangeText, placeholder, multiline, keyboardType }) {
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={C.ink40} multiline={multiline} keyboardType={keyboardType} style={[styles.formInput, multiline && styles.formTextarea]} />
    </View>
  );
}

function TeamReview({ preview, name, about, location, selectedBase, level, capacity, isDiscoverable, image, coverImage, onEdit }) {
  return (
    <>
      <View style={styles.stepIntro}><Text style={styles.stepTitle}>Confirm your team profile</Text><Text style={styles.stepBody}>This is how players will see your team. Check every section before saving.</Text></View>
      <View style={styles.reviewPreviewHead}><View><Text style={styles.reviewPreviewEyebrow}>PLAYER VIEW</Text><Text style={styles.reviewPreviewTitle}>Team card preview</Text></View><View style={styles.reviewPreviewMode}><Icon name={coverImage ? 'image-outline' : 'color-palette-outline'} size={13} color={C.teal} /><Text style={styles.reviewPreviewModeText}>{coverImage ? 'PHOTO COVER' : 'GRADIENT COVER'}</Text></View></View>
      <View style={styles.reviewCover}><TeamCover team={preview} height={184}><View style={styles.reviewPreviewTop}><View /><View style={styles.coverPrivacy}><Icon name={isDiscoverable ? 'globe-outline' : 'lock-closed-outline'} size={12} color={C.surface} /></View></View><View style={styles.reviewPreviewBottom}><Crest team={preview} size={58} /><View style={styles.reviewPreviewCopy}><Text numberOfLines={1} style={styles.reviewPreviewName}>{name}</Text><View style={styles.coverLocation}><Icon name="location-outline" size={13} color="rgba(255,255,255,.82)" /><Text numberOfLines={1} style={styles.coverLocationText}>{location}</Text></View></View></View></TeamCover></View>
      <View style={styles.reviewAbout}><View style={styles.reviewSectionHead}><Text style={styles.reviewSectionLabel}>ABOUT THE TEAM</Text><Pressable accessibilityLabel="Edit team identity" onPress={() => onEdit(0)} style={styles.reviewEditButton}><Icon name="create-outline" size={13} color={C.teal} /><Text style={styles.reviewEdit}>Edit</Text></Pressable></View><Text style={styles.reviewAboutText}>{about}</Text></View>
      <View style={styles.reviewCard}>
        <View style={styles.reviewRow}><View style={styles.reviewIcon}><Icon name="images-outline" color={C.teal} /></View><View style={styles.reviewCopy}><Text style={styles.reviewLabel}>BRAND ASSETS</Text><Text style={styles.reviewValue}>{image ? 'Main photo uploaded' : 'Generated team crest'}</Text><Text style={styles.reviewMeta}>{coverImage ? 'Custom cover photo uploaded' : 'Generated gradient cover'}</Text></View><Pressable accessibilityLabel="Edit team images" onPress={() => onEdit(0)} style={styles.reviewEditButton}><Text style={styles.reviewEdit}>Edit</Text></Pressable></View>
        <View style={[styles.reviewRow, styles.reviewBorder]}><View style={styles.reviewIcon}><Icon name="location-outline" color={C.teal} /></View><View style={styles.reviewCopy}><Text style={styles.reviewLabel}>HOME BASE</Text><Text style={styles.reviewValue}>{selectedBase?.city}</Text><Text style={styles.reviewMeta}>{selectedBase?.region} · {selectedBase?.country} · Public general area</Text></View><Pressable accessibilityLabel="Edit home base" onPress={() => onEdit(1)} style={styles.reviewEditButton}><Text style={styles.reviewEdit}>Edit</Text></Pressable></View>
        <View style={[styles.reviewRow, styles.reviewBorder]}><View style={styles.reviewIcon}><Icon name="people-outline" color={C.teal} /></View><View style={styles.reviewCopy}><Text style={styles.reviewLabel}>MEMBERSHIP</Text><Text style={styles.reviewValue}>{level} · Maximum {capacity} members</Text><Text style={styles.reviewMeta}>Competition unlocks at four confirmed members</Text></View><Pressable accessibilityLabel="Edit team setup" onPress={() => onEdit(2)} style={styles.reviewEditButton}><Text style={styles.reviewEdit}>Edit</Text></Pressable></View>
        <View style={[styles.reviewRow, styles.reviewBorder]}><View style={styles.reviewIcon}><Icon name={isDiscoverable ? 'globe-outline' : 'lock-closed-outline'} color={C.teal} /></View><View style={styles.reviewCopy}><Text style={styles.reviewLabel}>ACCESS & DISCOVERY</Text><Text style={styles.reviewValue}>{isDiscoverable ? 'Public team' : 'Private team'}</Text><Text style={styles.reviewMeta}>{isDiscoverable ? 'Players can discover the team and request to join' : 'Only invited players can access and join the team'}</Text></View><Pressable accessibilityLabel="Edit team visibility" onPress={() => onEdit(2)} style={styles.reviewEditButton}><Text style={styles.reviewEdit}>Edit</Text></Pressable></View>
      </View>
      <View style={styles.reviewReady}><Icon name="checkmark-circle" size={20} color={C.teal} /><View style={styles.reviewReadyCopy}><Text style={styles.reviewReadyTitle}>Ready to save</Text><Text style={styles.reviewReadyText}>Saving publishes these details to the team profile. Owners and admins can edit them later.</Text></View></View>
    </>
  );
}

function TeamForm({ team, onBack, onSave }) {
  const editing = Boolean(team);
  const { userLocation } = useUserLocation();
  const formScrollRef = useRef(null);
  const submissionId = useRef(null);
  const submitLock = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(team?.name || '');
  const [about, setAbout] = useState(team?.about || '');
  const [location, setLocation] = useState(team?.location || '');
  const [locationQuery, setLocationQuery] = useState('');
  const [capacity, setCapacity] = useState(String(team?.capacity || 12));
  const [level, setLevel] = useState(team?.level || 'Open level');
  const [image, setImage] = useState(team?.image);
  const [coverImage, setCoverImage] = useState(team?.coverImage);
  const [isDiscoverable, setIsDiscoverable] = useState(team?.isDiscoverable ?? false);
  const initialImage = team?.image || null;
  const initialCoverImage = team?.coverImage || null;
  const imageChanged = (image || null) !== initialImage;
  const coverImageChanged = (coverImage || null) !== initialCoverImage;
  const hasUnsavedChanges = imageChanged
    || coverImageChanged
    || name.trim() !== (team?.name || '').trim()
    || about.trim() !== (team?.about || '').trim()
    || location.trim() !== (team?.location || '').trim()
    || capacity.trim() !== String(team?.capacity || 12)
    || level !== (team?.level || 'Open level')
    || isDiscoverable !== (team?.isDiscoverable ?? false);
  const requestLeave = useCallback(() => {
    if (submitting) return;
    if (!hasUnsavedChanges) {
      onBack();
      return;
    }
    Alert.alert(
      editing ? 'Discard changes?' : 'Discard new team?',
      editing ? 'Your edits to the team settings have not been saved.' : 'The team details you entered will be lost.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onBack },
      ],
    );
  }, [editing, hasUnsavedChanges, onBack, submitting]);
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step > 0) setStep(step - 1);
      else requestLeave();
      return true;
    });
    return () => subscription.remove();
  }, [requestLeave, step]);
  const steps = ['Identity', 'Home base', 'Team setup', 'Review'];
  const selectedBase = useMemo(() => parseLocation(location), [location]);
  const currentBase = useMemo(() => parseLocation(userLocation.label), [userLocation.label]);
  const locationMatches = useMemo(() => {
    const clean = locationQuery.trim().toLocaleLowerCase();
    if (!clean) return PH_LOCATIONS.slice(0, 6);
    return PH_LOCATIONS.filter((place) => locationMatchesSearch(place, clean)).slice(0, 7);
  }, [locationQuery]);

  const pickMainImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (!result.canceled) setImage(result.assets[0].uri);
  };
  const pickCoverImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 9], quality: 1 });
    if (!result.canceled) setCoverImage(result.assets[0].uri);
  };
  const goToStep = (nextStep) => {
    setStep(nextStep);
    requestAnimationFrame(() => formScrollRef.current?.scrollTo({ y: 0, animated: true }));
  };
  const validateIdentity = () => {
    if (!name.trim() || !about.trim()) {
      Alert.alert('Complete team identity', 'Add a team name and a clear description before continuing.');
      return false;
    }
    return true;
  };
  const validateBase = () => {
    if (!selectedBase?.city || !selectedBase?.region || !selectedBase?.country) {
      Alert.alert('Select a specific home base', 'Choose a city from the results so the team is saved in City · Region · Country format.');
      return false;
    }
    return true;
  };
  const validateSetup = () => {
    const maxMembers = Number.parseInt(capacity, 10);
    const minimumCapacity = Math.max(4, team?.members || 1);
    if (!Number.isFinite(maxMembers) || maxMembers < minimumCapacity || maxMembers > 100) {
      Alert.alert('Check team capacity', `Capacity must be between ${minimumCapacity} and 100.`);
      return false;
    }
    return true;
  };
  const continueForm = () => {
    if (step === 0 && !validateIdentity()) return;
    if (step === 1 && !validateBase()) return;
    if (step === 2 && !validateSetup()) return;
    goToStep(Math.min(steps.length - 1, step + 1));
  };
  const submit = async () => {
    if (submitLock.current) return;
    const cleanName = name.trim();
    const cleanLocation = location.trim();
    const maxMembers = Number.parseInt(capacity, 10);
    if (!validateIdentity() || !validateBase()) return;
    if (!validateSetup()) return;
    submitLock.current = true;
    setSubmitting(true);
    submissionId.current ||= team?.id || Crypto.randomUUID();
    try {
      await onSave({
        ...team,
        creationRequestId: submissionId.current,
        name: cleanName,
        tag: team?.tag || makeTag(cleanName),
        location: cleanLocation,
        about: about.trim(),
        capacity: maxMembers,
        level,
        image,
        coverImage,
        isDiscoverable,
      });
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const preview = { name: name || 'New Team', tag: makeTag(name), icon: 'people-outline', color: team?.color || C.teal, image, coverImage };
  return (
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={formScrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.detailHeader}><Pressable disabled={submitting} onPress={step > 0 ? () => goToStep(step - 1) : requestLeave} accessibilityLabel={step > 0 ? 'Previous step' : 'Go back'} hitSlop={8} style={styles.backButton}><Icon name="arrow-back" /></Pressable><View style={styles.detailHeaderCopy}><Text style={styles.eyebrow}>{editing ? 'TEAM SETTINGS' : 'START A TEAM'} · STEP {step + 1} OF {steps.length}</Text><Text style={styles.detailHeaderTitle}>{steps[step]}</Text></View></View><KitchenLine />
        <View style={styles.wizardProgress}>{steps.map((item, index) => <View key={item} style={styles.wizardStep}><View style={[styles.wizardDot, index <= step && styles.wizardDotActive]}>{index < step ? <Icon name="checkmark" size={11} color={C.ink} /> : <Text style={[styles.wizardDotText, index <= step && styles.wizardDotTextActive]}>{index + 1}</Text>}</View><Text numberOfLines={1} style={[styles.wizardStepText, index === step && styles.wizardStepTextActive]}>{item}</Text>{index < steps.length - 1 && <View style={[styles.wizardLine, index < step && styles.wizardLineActive]} />}</View>)}</View>

        {step === 0 && <><View style={styles.stepIntro}><Text style={styles.stepTitle}>Build a recognizable identity</Text><Text style={styles.stepBody}>Add a primary team photo or logo, a separate cover, and a clear description. Image changes are only applied after Review and Save.</Text></View><View style={styles.formPhoto}><Pressable onPress={pickCoverImage} accessibilityLabel={coverImage ? 'Change team cover photo' : 'Add team cover photo'} style={styles.formCoverPressable}><TeamCover team={preview} height={164}><View style={styles.previewCoverContent}><View style={styles.previewCameraCover}><Icon name="camera" size={13} color={C.surface} /></View><View style={styles.previewCoverBottom}><View style={styles.previewCrestWrapper}><Crest team={preview} size={60} onPress={pickMainImage} /><View style={styles.previewCrestCamera}><Icon name="camera" size={10} color={C.ink} /></View></View><View style={styles.previewCoverText}><Text style={styles.previewCoverTitle}>{preview.name}</Text><Text style={styles.previewCoverHint}>{coverImage ? 'Tap to change cover photo' : 'Gradient cover · tap to add a photo'}</Text></View></View></View></TeamCover></Pressable></View><View style={styles.imageControlPanel}><View style={styles.imageControlRow}><View style={styles.imageControlIcon}><Icon name="person-circle-outline" size={19} color={C.teal} /></View><View style={styles.imageControlCopy}><Text style={styles.imageControlTitle}>Main photo or logo</Text><Text style={styles.imageControlMeta}>Square identity image</Text></View><Pressable onPress={pickMainImage} style={styles.imageControlPrimary}><Text style={styles.imageControlPrimaryText}>{image ? 'Change' : 'Upload'}</Text></Pressable>{imageChanged ? <Pressable accessibilityLabel="Undo main photo change" onPress={() => setImage(initialImage)} style={styles.imageControlSecondary}><Text style={styles.imageControlUndoText}>{initialImage ? 'Undo' : 'Cancel'}</Text></Pressable> : image ? <Pressable accessibilityLabel="Remove main team photo" onPress={() => setImage(null)} style={styles.imageControlSecondary}><Text style={styles.imageControlRemoveText}>Remove</Text></Pressable> : null}</View><View style={[styles.imageControlRow, styles.imageControlBorder]}><View style={styles.imageControlIcon}><Icon name="image-outline" size={19} color={C.teal} /></View><View style={styles.imageControlCopy}><Text style={styles.imageControlTitle}>Cover photo</Text><Text style={styles.imageControlMeta}>16:9 card and profile banner</Text></View><Pressable onPress={pickCoverImage} style={styles.imageControlPrimary}><Text style={styles.imageControlPrimaryText}>{coverImage ? 'Change' : 'Upload'}</Text></Pressable>{coverImageChanged ? <Pressable accessibilityLabel="Undo cover photo change" onPress={() => setCoverImage(initialCoverImage)} style={styles.imageControlSecondary}><Text style={styles.imageControlUndoText}>{initialCoverImage ? 'Undo' : 'Cancel'}</Text></Pressable> : coverImage ? <Pressable accessibilityLabel="Remove team cover photo" onPress={() => setCoverImage(null)} style={styles.imageControlSecondary}><Text style={styles.imageControlRemoveText}>Remove</Text></Pressable> : null}</View></View><Text style={styles.imageSaveHint}>Removing the cover restores the generated gradient. Changes remain reversible until you save.</Text><FormField label="TEAM NAME" value={name} onChangeText={setName} placeholder="e.g. Manila Smashers" /><FormField label="ABOUT THE TEAM" value={about} onChangeText={setAbout} placeholder="Describe your play style, usual schedule, and who should join" multiline /></>}

        {step === 1 && <><View style={styles.stepIntro}><Text style={styles.stepTitle}>Set your team’s home base</Text><Text style={styles.stepBody}>This general area powers nearby discovery and distance estimates. It is visible to players, so choose the city where your team normally meets—not a private street address.</Text></View>{selectedBase?.region ? <View style={styles.selectedBaseCard}><View style={styles.selectedBaseIcon}><Icon name="location" color={C.teal} /></View><View style={styles.selectedBaseCopy}><Text style={styles.selectedBaseLabel}>SELECTED HOME BASE</Text><Text style={styles.selectedBaseCity}>{selectedBase.city}</Text><Text style={styles.selectedBaseMeta}>{selectedBase.region} · {selectedBase.country}</Text></View><Icon name="checkmark-circle" color={C.teal} /></View> : <View style={styles.baseRequired}><Icon name="alert-circle-outline" color={C.brick} /><Text style={styles.baseRequiredText}>A verified city and region are required.</Text></View>}{userLocation.source !== 'default' && currentBase?.region && <Pressable onPress={() => { setLocation(formatLocation(currentBase)); setLocationQuery(''); }} style={styles.useCurrentBase}><Icon name="navigate-outline" color="#0E2321" /><View style={styles.useCurrentBaseCopy}><Text style={styles.useCurrentBaseTitle}>Use my current search area</Text><Text numberOfLines={1} style={styles.useCurrentBaseMeta}>{formatLocation(currentBase)}</Text></View></Pressable>}<Text style={styles.formLabel}>SEARCH CITY OR REGION</Text><View style={styles.baseSearch}><Icon name="search-outline" color={C.ink40} /><TextInput value={locationQuery} onChangeText={setLocationQuery} autoCapitalize="words" autoCorrect={false} placeholder="e.g. Makati, Cebu, Region VII" placeholderTextColor={C.ink40} style={styles.baseSearchInput} />{!!locationQuery && <Pressable accessibilityLabel="Clear location search" onPress={() => setLocationQuery('')}><Icon name="close-circle" color={C.ink40} /></Pressable>}</View><View style={styles.baseResults}>{locationMatches.map((place, index) => { const active = selectedBase?.city === place.city && selectedBase?.region === place.region; return <Pressable key={`${place.city}-${place.region}`} onPress={() => { setLocation(formatLocation(place)); setLocationQuery(''); }} style={[styles.baseResult, index > 0 && styles.baseResultBorder]}><View style={styles.baseResultIcon}><Icon name="location-outline" size={17} color={C.teal} /></View><View style={styles.baseResultCopy}><Text style={styles.baseResultCity}>{place.city}</Text><Text style={styles.baseResultMeta}>{place.region} · {place.country}</Text></View><Icon name={active ? 'checkmark-circle' : 'chevron-forward'} size={18} color={active ? C.teal : C.ink40} /></Pressable>; })}{!locationMatches.length && <View style={styles.baseEmpty}><Text style={styles.baseEmptyTitle}>No matching location</Text><Text style={styles.footText}>Try searching for a nearby city or Philippine region.</Text></View>}</View><View style={styles.locationPrivacy}><Icon name="shield-checkmark-outline" color={C.teal} /><Text style={styles.locationPrivacyText}>Only the selected city, region, and country are stored. Never enter a home or street address.</Text></View></>}

        {step === 2 && <><View style={styles.stepIntro}><Text style={styles.stepTitle}>Define how the team operates</Text><Text style={styles.stepBody}>Set expectations for skill level, roster size, and who can discover the team.</Text></View><FormField label="MAX MEMBERS" value={capacity} onChangeText={setCapacity} placeholder="12" keyboardType="number-pad" /><Text style={styles.formLabel}>SKILL LEVEL</Text><View style={styles.levelOptions}>{TEAM_SKILL_LEVELS.map((item) => <Pressable key={item} onPress={() => setLevel(item)} style={[styles.levelOption, level === item && styles.levelOptionActive]}><Text style={[styles.levelOptionText, level === item && styles.levelOptionTextActive]}>{item}</Text></Pressable>)}</View><Text style={styles.formLabel}>TEAM VISIBILITY</Text><View style={styles.visibilityOptions}><Pressable onPress={() => setIsDiscoverable(false)} style={[styles.visibilityOption, !isDiscoverable && styles.visibilityOptionActive]}><Icon name="lock-closed-outline" color={!isDiscoverable ? C.surface : C.teal} /><View style={styles.visibilityCopy}><Text style={[styles.visibilityTitle, !isDiscoverable && styles.visibilityTitleActive]}>Private</Text><Text style={[styles.visibilityHelp, !isDiscoverable && styles.visibilityHelpActive]}>Only invited players can join.</Text></View></Pressable><Pressable onPress={() => setIsDiscoverable(true)} style={[styles.visibilityOption, isDiscoverable && styles.visibilityOptionActive]}><Icon name="globe-outline" color={isDiscoverable ? C.surface : C.teal} /><View style={styles.visibilityCopy}><Text style={[styles.visibilityTitle, isDiscoverable && styles.visibilityTitleActive]}>Public</Text><Text style={[styles.visibilityHelp, isDiscoverable && styles.visibilityHelpActive]}>Players can discover and request to join.</Text></View></Pressable></View><View style={styles.formNotice}><Icon name="shield-checkmark-outline" color={C.teal} /><Text style={styles.formNoticeText}>{editing ? 'Visibility never enables automatic joining. Owners and admins still control membership.' : 'You become the Owner. Competition unlocks when four confirmed players have joined.'}</Text></View></>}

        {step === 3 && <TeamReview preview={preview} name={name} about={about} location={location} selectedBase={selectedBase} level={level} capacity={capacity} isDiscoverable={isDiscoverable} image={image} coverImage={coverImage} onEdit={goToStep} />}

        <View style={styles.wizardActions}>{step > 0 && <Pressable disabled={submitting} onPress={() => goToStep(step - 1)} style={styles.wizardBack}><Text style={styles.wizardBackText}>Back</Text></Pressable>}<Pressable disabled={submitting} accessibilityState={{ disabled: submitting, busy: submitting }} onPress={step === steps.length - 1 ? submit : continueForm} style={[styles.saveButton, styles.wizardPrimary, submitting && styles.saveButtonDisabled]}>{submitting ? <ActivityIndicator size="small" color="#0E2321" /> : <Icon name={step === steps.length - 1 ? (editing ? 'checkmark' : 'people') : 'arrow-forward'} size={18} color="#0E2321" />}<Text style={styles.primaryText}>{submitting ? (editing ? 'Saving…' : 'Creating…') : step === steps.length - 1 ? (editing ? 'Save team' : 'Create team') : 'Continue'}</Text></Pressable></View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PlayerInviteScreen({ team, onBack }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [sent, setSent] = useState([]);
  const memberIds = useMemo(() => new Set((team.roster || []).map((member) => member.id)), [team.roster]);

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchTeamInviteCandidates(clean)
        .then((players) => setResults(players.filter((player) => !memberIds.has(player.id))))
        .catch((error) => Alert.alert('Player search unavailable', error.message))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, memberIds]);

  const invite = async (player) => {
    try {
      await inviteTeamMember(team.id, player.id);
      setSent((current) => current.includes(player.id) ? current : [...current, player.id]);
    } catch (error) {
      Alert.alert('Invitation not sent', error.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.detailHeader}><Pressable onPress={onBack} accessibilityLabel="Go back" hitSlop={8} style={styles.backButton}><Icon name="arrow-back" /></Pressable><View style={styles.detailHeaderCopy}><Text style={styles.eyebrow}>PRIVATE INVITATIONS</Text><Text style={styles.detailHeaderTitle}>Invite players</Text></View></View><KitchenLine />
      <View style={styles.inviteProgress}><View style={styles.inviteProgressIcon}><Icon name="people" color={C.teal} /></View><View style={styles.rosterCopy}><Text style={styles.inviteProgressTitle}>{teamStatusText(team)}</Text><Text style={styles.footText}>{team.status === 'active' ? `${team.name} is active. You can keep building the roster.` : `Invite ${Math.max(0, 4 - team.members)} more confirmed ${Math.max(0, 4 - team.members) === 1 ? 'player' : 'players'} to activate the team.`}</Text></View></View>
      <View style={styles.search}><Icon name="search-outline" color={C.ink40} /><TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search by player name" placeholderTextColor={C.ink40} style={styles.searchInput} /></View>
      <Text style={styles.invitePrivacy}><Icon name="lock-closed-outline" size={12} color={C.teal} /> Invitations are tied to the selected Peakle account, expire after seven days, and cannot be forwarded.</Text>
      {searching && <Text style={styles.searchingText}>Searching players…</Text>}
      {!searching && query.trim().length >= 2 && !results.length && <View style={styles.emptyRequests}><Icon name="person-outline" size={34} color={C.ink40} /><Text style={styles.emptyTitle}>No matching players</Text><Text style={styles.footText}>Check the player’s Peakle display name and try again.</Text></View>}
      <View style={styles.playerResults}>{results.map((player, index) => {
        const invited = sent.includes(player.id);
        return <View key={player.id} style={[styles.playerResult, index > 0 && styles.rosterBorder]}><ProfilePhoto photo={player.avatar_url} name={player.display_name} size={42} style={styles.rosterAvatar} /><View style={styles.rosterCopy}><Text style={styles.rosterName}>{player.display_name}</Text><Text style={styles.footText}>{player.home_area || 'Peakle player'} · ID {player.id.slice(0, 6).toUpperCase()}</Text></View><Pressable disabled={invited} onPress={() => invite(player)} style={[styles.invitePlayerButton, invited && styles.invitePlayerButtonSent]}><Icon name={invited ? 'checkmark' : 'person-add-outline'} size={15} color={invited ? C.teal : C.ink} /><Text style={[styles.invitePlayerText, invited && styles.invitePlayerTextSent]}>{invited ? 'Sent' : 'Invite'}</Text></Pressable></View>;
      })}</View>
    </ScrollView>
  );
}

function TeamInvitationCard({ invitation, onAccept, onDecline }) {
  const team = invitation.teams;
  if (!team) return null;
  return (
    <View style={styles.invitationCard}>
      <View style={styles.teamHead}><Crest team={{ tag: team.tag, name: team.name, image: team.image_url, icon: 'people-outline', color: team.color || C.teal }} /><View style={styles.teamCopy}><Text style={styles.invitationEyebrow}>PRIVATE TEAM INVITATION</Text><Text style={styles.teamName}>{team.name}</Text><Text style={styles.footText}>{team.location || 'Location not set'}</Text></View><Icon name="lock-closed" size={18} color={C.teal} /></View>
      <View style={styles.invitationMeta}><Icon name="location-outline" size={14} color={C.ink40} /><Text style={styles.footText}>{team.location || 'Location not set'} · {team.skill_level || 'Open level'}</Text></View>
      <Text style={styles.invitationExpiry}>This invitation expires {new Date(invitation.expires_at).toLocaleDateString()}.</Text>
      <View style={styles.requestActions}><Pressable onPress={onDecline} style={styles.declineButton}><Text style={styles.declineText}>Decline</Text></Pressable><Pressable onPress={onAccept} style={styles.acceptButton}><Icon name="checkmark" size={17} color="#0E2321" /><Text style={styles.primaryText}>Join team</Text></Pressable></View>
    </View>
  );
}

function TeamHub({ team, requests, liveMatch, nextChallenges = [], matchBusy, onOpenMatch, onStartMatch, onBack, onUpdateImage, onEdit, onAccept, onDecline, onRefreshRequests, onInvite, onChallenges }) {
  const [section, setSection] = useState('Roster');
  const editable = canEditTeam(team);
  const reviewer = canReviewRequests(team);
  const roster = team.roster || [];
  const tabs = reviewer ? ['Roster', 'Requests', 'Matches', 'Activity'] : ['Roster', 'Matches', 'Activity'];
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} stickyHeaderIndices={[1]}>
      <View>
      <View style={styles.detailHeader}><Pressable onPress={onBack} accessibilityLabel="Go back" hitSlop={8} style={styles.backButton}><Icon name="arrow-back" /></Pressable><View style={styles.detailHeaderCopy}><Text style={styles.eyebrow}>YOUR TEAM · {team.role?.toUpperCase()}</Text><Text style={styles.detailHeaderTitle}>{team.name}</Text></View>{editable && <Pressable onPress={onEdit} accessibilityLabel="Edit team" style={styles.iconButton}><Icon name="settings-outline" /></Pressable>}</View><KitchenLine />
      <View style={styles.hubHero}><Pressable disabled={!editable} onPress={editable ? () => onUpdateImage(team.id) : undefined}><TeamCover team={team} height={168}><View style={styles.hubCoverContent}>{editable && <View style={styles.hubCoverTop}><View style={styles.editCoverBadge}><Icon name="camera" size={12} color={C.surface} /><Text style={styles.editCoverText}>Cover</Text></View></View>}<View style={styles.hubIdentity}><Crest team={team} size={56} /><View style={styles.hubIdentityCopy}><Text numberOfLines={1} style={styles.hubTitle}>{team.name}</Text><View style={styles.hubMetaRow}><View style={styles.rolePill}><Icon name="shield-checkmark" size={11} color={C.surface} /><Text style={styles.rolePillText}>{team.role}</Text></View><Text style={styles.hubMeta}> · {team.members} {team.members === 1 ? 'member' : 'members'} · </Text><Icon name={team.isDiscoverable ? 'globe-outline' : 'lock-closed-outline'} size={11} color="rgba(255,255,255,.85)" /><Text style={styles.hubMeta}> {team.isDiscoverable ? 'Public' : 'Private'}</Text></View></View></View></View></TeamCover></Pressable><View style={styles.hubRecord}><View><Text style={styles.hubRecordValue}>{team.wins || team.losses ? `${team.wins}-${team.losses}` : '—'}</Text><Text style={styles.hubRecordLabel}>RECORD</Text></View><View><Text style={styles.hubRecordValue}>{team.winRate || '—'}</Text><Text style={styles.hubRecordLabel}>WIN RATE</Text></View><View><Text style={styles.hubRecordValue}>—</Text><Text style={styles.hubRecordLabel}>LOCAL RANK</Text></View></View></View>
      {team.status !== 'active' && <View style={styles.formingNotice}><Icon name="people-outline" color={C.teal} /><View style={styles.rosterCopy}><Text style={styles.requirementTitle}>Team is still forming</Text><Text style={styles.footText}>Reach four confirmed members to unlock team competition. You need {Math.max(0, 4 - team.members)} more.</Text></View>{reviewer && <Pressable onPress={onInvite} style={styles.noticeInvite}><Text style={styles.inviteButtonText}>Invite</Text></Pressable>}</View>}
      </View>
      <View style={styles.hubTabsSticky}><View style={styles.hubTabs}>{tabs.map((item) => <Pressable key={item} onPress={() => { setSection(item); if (item === 'Requests') onRefreshRequests?.(); }} style={[styles.hubTab, section === item && styles.hubTabActive]}><Text style={[styles.hubTabText, section === item && styles.hubTabTextActive]}>{item}{item === 'Requests' && requests.length ? ` (${requests.length})` : ''}</Text></Pressable>)}</View></View>
      {section === 'Roster' && <><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>LINEUP</Text><Text style={styles.h2}>Team roster</Text></View><Pressable accessibilityLabel={`Invite players to ${team.name}`} onPress={onInvite} style={styles.inviteButton}><Icon name="person-add-outline" size={16} color={C.teal} /><Text style={styles.inviteButtonText}>Invite</Text></Pressable></View><View style={styles.rosterCard}>{roster.map((player, index) => <View key={player.name} style={[styles.rosterRow, index > 0 && styles.rosterBorder]}><ProfilePhoto photo={player.avatar} name={player.name} size={42} style={styles.rosterAvatar} /><View style={styles.rosterCopy}><Text style={styles.rosterName}>{player.name}</Text><Text style={styles.footText}>{player.role}</Text></View><View style={styles.rosterRating}><Text style={styles.rosterRatingValue}>{player.rating}</Text><Text style={styles.statLabel}>RATING</Text></View></View>)}</View></>}
      {section === 'Requests' && <><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>MEMBERSHIP</Text><Text style={styles.h2}>Join requests</Text></View><Text style={styles.sectionLink}>{requests.length} pending</Text></View>{requests.length ? requests.map((request) => <View key={request.id} style={styles.requestCard}><View style={styles.requestTimeRow}><Text style={styles.requestTimeLabel}>REQUESTED TO JOIN</Text><Text style={styles.requestTime}>{formatRequestAge(request.createdAt)}</Text></View><View style={styles.requestHead}><ProfilePhoto photo={request.avatar} name={request.name} size={46} style={styles.requestAvatar} /><View style={styles.rosterCopy}><Text style={styles.requestName}>{request.name}</Text><Text style={styles.requestAccount}>Peakle player profile</Text></View></View><View style={styles.requestFacts}><View style={styles.requestFact}><Icon name="location-outline" size={14} color={C.teal} /><Text numberOfLines={1} style={styles.requestFactText}>{request.location}</Text></View><View style={styles.requestFact}><Icon name="star-outline" size={14} color={C.teal} /><Text style={styles.requestFactText}>{request.rating == null ? 'Unrated' : `${request.rating} rating`}</Text></View><View style={styles.requestFact}><Icon name="tennisball-outline" size={14} color={C.teal} /><Text style={styles.requestFactText}>{request.preference}</Text></View></View><View style={styles.requestMessage}><Icon name="chatbubble-ellipses-outline" size={16} color={request.note ? C.teal : C.ink40} /><View style={styles.requestMessageCopy}><Text style={styles.requestMessageLabel}>INTRODUCTION</Text><Text style={[styles.requestNoteCompact, !request.note && styles.requestNoteEmpty]}>{request.note || 'No introduction was included with this request.'}</Text></View></View><View style={styles.requestActions}><Pressable onPress={() => onDecline(request.id)} style={styles.declineButton}><Text style={styles.declineText}>Decline</Text></Pressable><Pressable onPress={() => onAccept(request)} style={styles.acceptButton}><Icon name="checkmark" size={17} color="#0E2321" /><Text style={styles.primaryText}>Accept player</Text></Pressable></View></View>) : <View style={styles.emptyRequests}><Icon name="checkmark-circle-outline" size={34} color={C.teal} /><Text style={styles.emptyTitle}>You're all caught up</Text><Text style={styles.footText}>New join requests will appear here automatically.</Text></View>}</>}
      {section === 'Matches' && <><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>SCHEDULE</Text><Text style={styles.h2}>Team matches</Text></View></View>{team.status === 'active' && <Pressable onPress={onChallenges} style={styles.teamChallengeEntry}><View style={styles.competitionBannerIcon}><Icon name="trophy-outline" color={C.teal} /></View><View style={styles.joinedIntroCopy}><Text style={styles.competitionBannerTitle}>Challenges and team competition</Text><Text style={styles.competitionBannerMeta}>Send a private scrimmage challenge or review incoming fixtures.</Text></View><Icon name="chevron-forward" color={C.teal} /></Pressable>}
      {liveMatch ? <Pressable onPress={onOpenMatch} style={styles.nextTeamMatch}><View style={styles.matchDate}><Text style={styles.matchMonth}>LIVE</Text><Text style={styles.matchDay}>{liveMatch.homeScore}–{liveMatch.awayScore}</Text></View><View style={styles.matchCopy}><Text style={styles.matchLabel}>GAME {liveMatch.game} · IN PROGRESS</Text><Text numberOfLines={1} style={styles.matchTitle}>{liveMatch.home} vs {liveMatch.away}</Text><Text style={styles.footText}>{liveMatch.canScore ? 'Tap to continue scoring' : `${liveMatch.scorer} is scoring · tap to watch live`}</Text></View><Icon name="chevron-forward" color={C.teal} /></Pressable>
        : nextChallenges.length ? nextChallenges.map((challenge) => {
          const opponent = challenge.challenger_team_id === team.id ? challenge.challenged : challenge.challenger;
          const date = new Date(challenge.starts_at);
          return <Pressable key={challenge.id} disabled={matchBusy} onPress={() => onStartMatch(challenge.id)} style={styles.nextTeamMatch}><View style={styles.matchDate}><Text style={styles.matchMonth}>{Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</Text><Text style={styles.matchDay}>{Number.isNaN(date.getTime()) ? '—' : date.getDate()}</Text></View><View style={styles.matchCopy}><Text style={styles.matchLabel}>VS {(opponent?.name || 'OPPONENT').toUpperCase()}</Text><Text numberOfLines={1} style={styles.matchTitle}>{matchBusy ? 'Starting match…' : 'Tap to start scoring'}</Text><Text style={styles.footText}>{challenge.venues?.name || 'Venue to be confirmed'}</Text></View><Icon name="play-circle-outline" size={20} color={C.teal} /></Pressable>;
        })
        : <View style={styles.empty}><Icon name={team.status === 'active' ? 'calendar-outline' : 'lock-closed-outline'} size={35} color={C.ink40} /><Text style={styles.emptyTitle}>{team.status === 'active' ? 'No team matches recorded' : 'Competition unlocks at four'}</Text><Text style={styles.footText}>{team.status === 'active' ? 'Accepted challenges will appear here ready to score.' : 'Invite or approve more players before entering team matches and rankings.'}</Text></View>}</>}
      {section === 'Activity' && <><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>RECENT</Text><Text style={styles.h2}>Team activity</Text></View></View><View style={styles.empty}><Icon name="pulse-outline" size={35} color={C.ink40} /><Text style={styles.emptyTitle}>No team activity yet</Text><Text style={styles.footText}>Real membership and match updates will appear here.</Text></View></>}
    </ScrollView>
  );
}

const SCREEN_HEIGHT = Dimensions.get('window').height;

export default function TeamScreen({ navigation, route }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { user } = useAuth();
  const { userLocation } = useUserLocation();
  const dataCacheKey = teamScreenCacheKey(user?.id || 'guest');
  const initialSnapshot = useRef(peekCachedData(dataCacheKey)).current;
  const cacheApplied = useRef(Boolean(initialSnapshot));
  const [tab, setTab] = useState(() => initialSnapshot?.tab || (initialSnapshot?.teams?.some((team) => team.role) ? 'Joined' : initialSnapshot ? 'Discover' : null));
  const [filter, setFilter] = useState('For you');
  const [query, setQuery] = useState('');
  const [requested, setRequested] = useState(() => initialSnapshot?.pending || []);
  const [requesting, setRequesting] = useState([]);
  const [cancellingRequests, setCancellingRequests] = useState([]);
  const [joined, setJoined] = useState(() => (initialSnapshot?.teams || []).filter((team) => team.role));
  const [availableTeams, setAvailableTeams] = useState(() => (initialSnapshot?.teams || []).filter((team) => !team.role && team.isDiscoverable));
  const [selected, setSelected] = useState(null);
  const [joinTeam, setJoinTeam] = useState(null);
  const [hubTeam, setHubTeam] = useState(null);
  const [chatTeam, setChatTeam] = useState(null);
  const [chatInfoTeam, setChatInfoTeam] = useState(null);
  // The tab a team chat was opened from (Chats). While set, the chat belongs to
  // that tab in the navigation and Back returns there instead of the team page.
  const [chatReturnTo, setChatReturnTo] = useState(null);
  const [chatInfo, setChatInfo] = useState({ loading: false, pinned: [], media: [], blocked: [] });
  const [chatSafetyTeam, setChatSafetyTeam] = useState(null);
  const [chatSafetyStatus, setChatSafetyStatus] = useState(null);
  const [chatSafetyBusy, setChatSafetyBusy] = useState(false);
  const chatSafetyStatusRef = useRef(null);
  chatSafetyStatusRef.current = chatSafetyStatus;
  const [openingPinnedMessageId, setOpeningPinnedMessageId] = useState(null);
  const [focusMessageId, setFocusMessageId] = useState(null);
  const [liveScoreTeam, setLiveScoreTeam] = useState(null);
  const [liveScoreMode, setLiveScoreMode] = useState('viewer');
  const [typingByTeam, setTypingByTeam] = useState({});
  const [liveMatches, setLiveMatches] = useState({});
  const [teamChallenges, setTeamChallenges] = useState({});
  const [matchBusy, setMatchBusy] = useState(false);
  const [scorerChallengeId, setScorerChallengeId] = useState(null);
  const [scorerChangeMatchId, setScorerChangeMatchId] = useState(null);
  const typingExpiryTimers = useRef({});
  const chatChannelRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const reactionTracker = useRef(createReactionTracker()).current;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => { appStateRef.current = nextState; });
    return () => subscription.remove();
  }, []);
  const [creating, setCreating] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [invitingTeam, setInvitingTeam] = useState(null);
  const [invitations, setInvitations] = useState(() => initialSnapshot?.incomingInvitations || []);
  const createSlide = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  const openCreate = useCallback(() => {
    createSlide.setValue(SCREEN_HEIGHT);
    setCreating(true);
    Animated.timing(createSlide, {
      toValue: 0,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [createSlide]);

  const closeCreate = useCallback(() => {
    Animated.timing(createSlide, {
      toValue: SCREEN_HEIGHT,
      duration: 300,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => setCreating(false));
  }, [createSlide]);
  const [joinRequests, setJoinRequests] = useState({});
  const [locationOpen, setLocationOpen] = useState(false);
  const [messages, setMessages] = useState({});
  const [messagePagination, setMessagePagination] = useState({});
  const teamDripIndex = useRef(0);
  useEffect(() => {
    if (!DEMO_MODE || chatTeam?.id !== DEMO_TEAM_ID) return undefined;
    const timer = setInterval(() => {
      const next = DEMO_TEAM_MESSAGE_DRIP[teamDripIndex.current % DEMO_TEAM_MESSAGE_DRIP.length];
      teamDripIndex.current += 1;
      const row = { ...next, id: `${next.id}-${Date.now()}`, created_at: new Date().toISOString() };
      const message = normalizeTeamMessage(row, user?.id);
      setMessages((current) => ({ ...current, [DEMO_TEAM_ID]: [...(current[DEMO_TEAM_ID] || []), message] }));
    }, 4500);
    return () => clearInterval(timer);
  }, [chatTeam?.id]);
  const [messageReadStates, setMessageReadStates] = useState({});
  const [conversationSummaries, setConversationSummaries] = useState(() => initialSnapshot?.conversationSummaries || {});
  const [directConversations, setDirectConversations] = useState([]);
  const handledOpenChatToken = useRef(null);
  const chatOpenRequestRef = useRef(0);

  const resetTeamNavigation = useCallback(() => {
    chatOpenRequestRef.current += 1;
    const activeChat = chatChannelRef.current;
    if (activeChat && user?.id) {
      activeChat.channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          userId: user.id,
          name: user.name || 'Someone',
          avatar: user.picture || null,
          isTyping: false,
        },
      }).catch(() => {});
    }

    createSlide.stopAnimation();
    createSlide.setValue(SCREEN_HEIGHT);
    stopScoreAnnouncement();
    setSelected(null);
    setJoinTeam(null);
    setHubTeam(null);
    setChatTeam(null);
    setChatInfoTeam(null);
    setChatReturnTo(null);
    setChatSafetyTeam(null);
    setLiveScoreTeam(null);
    setEditingTeam(null);
    setInvitingTeam(null);
    setCreating(false);
    setLocationOpen(false);
    setOpeningPinnedMessageId(null);
    setFocusMessageId(null);
    setScorerChallengeId(null);
    setScorerChangeMatchId(null);
    setChatSafetyBusy(false);
  }, [createSlide, user?.id, user?.name, user?.picture]);

  useEffect(() => {
    const unsubscribeBlur = navigation.addListener('blur', resetTeamNavigation);
    const unsubscribeTabPress = navigation.addListener('tabPress', () => {
      if (navigation.isFocused()) resetTeamNavigation();
    });
    return () => {
      unsubscribeBlur();
      unsubscribeTabPress();
    };
  }, [navigation, resetTeamNavigation]);

  useEffect(() => {
    if (!user?.id) {
      setChatSafetyStatus(null);
      return;
    }
    let active = true;
    getChatSafetyStatus()
      .then((status) => { if (active) setChatSafetyStatus(status); })
      .catch(() => { if (active) setChatSafetyStatus(null); });
    return () => { active = false; };
  }, [user?.id]);
  const refreshChatInfo = useCallback(async (teamId) => {
    if (!teamId) return;
    setChatInfo({ loading: true, pinned: [], media: [], blocked: [] });
    try {
      const [pinnedRows, mediaRows, blocked] = await Promise.all([listPinnedTeamMessages(teamId), listTeamSharedMedia(teamId), listBlockedChatUsers()]);
      setChatInfo({
        loading: false,
        pinned: pinnedRows.map((row) => normalizeTeamMessage(row, user?.id)),
        media: mediaRows.map((row) => normalizeTeamMessage(row, user?.id)),
        blocked,
      });
    } catch (error) {
      setChatInfo((current) => ({ ...current, loading: false }));
      Alert.alert('Chat info unavailable', error.message);
    }
  }, [user?.id]);
  useEffect(() => {
    if (chatInfoTeam?.id) refreshChatInfo(chatInfoTeam.id);
  }, [chatInfoTeam?.id, refreshChatInfo]);
  // Nicknames rename senders in the open team chat and its chat info.
  const nicknameTeamId = chatInfoTeam?.id || chatTeam?.id;
  const [teamNicknames, setTeamNicknames] = useState({});
  const [teamMutes, setTeamMutes] = useState({});
  useEffect(() => {
    if (!nicknameTeamId) return undefined;
    let active = true;
    listChatNicknames('team', nicknameTeamId).then((names) => {
      if (active) setTeamNicknames((current) => ({ ...current, [nicknameTeamId]: names }));
    }).catch(() => {});
    return () => { active = false; };
  }, [nicknameTeamId, chatInfoTeam?.id]);
  const joinedTeamKey = joined.map((team) => team.id).join(',');
  useEffect(() => {
    if (!joinedTeamKey) return;
    listTeamChatMutes().then(setTeamMutes).catch(() => {});
  }, [joinedTeamKey]);
  const activeNicknames = teamNicknames[nicknameTeamId] || NO_NICKNAMES;
  const nicknamedChatMessages = useMemo(() => {
    const rows = messages[nicknameTeamId] || NO_MESSAGES;
    if (!Object.keys(activeNicknames).length) return rows;
    return rows.map((message) => (activeNicknames[message.senderId] ? { ...message, sender: activeNicknames[message.senderId] } : message));
  }, [activeNicknames, messages, nicknameTeamId]);
  useEffect(() => {
    const teamUnreadCount = chatSafetyStatus?.eligible
      ? Object.values(conversationSummaries).reduce((total, item) => total + Number(item?.unread_count || 0), 0)
      : 0;
    const directUnreadCount = chatSafetyStatus?.eligible
      ? directConversations.reduce((total, item) => total + Number(item?.unreadCount || 0), 0)
      : 0;
    navigation.setParams({ unreadCount: teamUnreadCount + directUnreadCount });
  }, [chatSafetyStatus?.eligible, conversationSummaries, directConversations, navigation]);
  const refreshDirectConversations = useCallback(() => {
    if (!PRIVATE_MESSAGES_ENABLED || !user?.id || !chatSafetyStatus?.eligible) {
      setDirectConversations([]);
      return Promise.resolve([]);
    }
    return listDirectConversations()
      .then((items) => { setDirectConversations(items); return items; })
      .catch(() => []);
  }, [chatSafetyStatus?.eligible, user?.id]);
  useEffect(() => {
    refreshDirectConversations();
  }, [refreshDirectConversations]);
  useEffect(() => {
    if (!PRIVATE_MESSAGES_ENABLED || !supabase || !user?.id || !chatSafetyStatus?.eligible) return undefined;
    let refreshTimer;
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshDirectConversations, 120);
    };
    const channel = supabase.channel(`team-direct-inbox-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_conversations' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_conversation_reads' }, refresh)
      .subscribe();
    return () => {
      clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [chatSafetyStatus?.eligible, refreshDirectConversations, user?.id]);

  const refreshJoinRequests = useCallback(async (teamIds) => {
    if (!teamIds.length) return;
    const rows = await listTeamRequests(teamIds);
    const groups = groupJoinRequests(rows);
    setJoinRequests((current) => {
      const next = { ...current };
      teamIds.forEach((teamId) => { next[teamId] = groups[teamId] || []; });
      return next;
    });
  }, []);

  const applyTeamSnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    const teams = snapshot.teams || [];
    const mine = teams.filter((team) => team.role);
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const syncOpenTeam = (current) => current ? teamsById.get(current.id) || current : current;
    setJoined(mine);
    setSelected(syncOpenTeam);
    setHubTeam(syncOpenTeam);
    setChatTeam(syncOpenTeam);
    setChatInfoTeam(syncOpenTeam);
    setChatSafetyTeam(syncOpenTeam);
    setLiveScoreTeam(syncOpenTeam);
    setTab((current) => current || snapshot.tab || (mine.length ? 'Joined' : 'Discover'));
    setAvailableTeams(teams.filter((team) => !team.role && team.isDiscoverable));
    setRequested(snapshot.pending || []);
    setInvitations(snapshot.incomingInvitations || []);
    setConversationSummaries(snapshot.conversationSummaries || {});
  }, []);

  const loadTeamData = useCallback(async () => {
    let cached = peekCachedData(dataCacheKey);
    if (!cacheApplied.current) {
      cached = await readCachedData(dataCacheKey);
      if (cached) applyTeamSnapshot(cached);
      cacheApplied.current = true;
    }
    try {
      // Invitations load on their own: if the team list is slow or fails, a
      // pending invite must still show instead of the stale cached list.
      const invitationsRequest = listMyTeamInvitations().then((items) => {
        setInvitations(items || []);
        return items || [];
      }, () => null);
      const [teams, pending] = await withTimeout(
        Promise.all([listTeams(), listMyTeamRequests()]),
        12000,
        'Team data took too long to refresh.',
      );
      const incomingInvitations = (await invitationsRequest) ?? cached?.incomingInvitations ?? [];
      const mine = teams.filter((team) => team.role);
      const manageable = mine.filter(canReviewRequests).map((team) => team.id);
      refreshJoinRequests(manageable).catch(() => {});
      let nextConversationSummaries = cached?.conversationSummaries || {};
      try {
        const conversations = await listTeamConversationSummaries(mine.map((team) => team.id));
        nextConversationSummaries = Object.fromEntries(conversations.map((item) => [item.team_id, item]));
      } catch (_) {}
      const snapshot = {
        teams,
        pending,
        incomingInvitations,
        conversationSummaries: nextConversationSummaries,
        tab: mine.length ? 'Joined' : 'Discover',
      };
      applyTeamSnapshot(snapshot);
      await writeCachedData(dataCacheKey, snapshot);
    } catch (error) {
      if (!cached) throw error;
    }
  }, [applyTeamSnapshot, dataCacheKey, refreshJoinRequests]);

  const refreshTeamConversationSummary = useCallback(async (teamId) => {
    const [summary] = await listTeamConversationSummaries([teamId]);
    if (summary) setConversationSummaries((current) => ({ ...current, [teamId]: summary }));
  }, []);

  useFocusEffect(useCallback(() => {
    loadTeamData().catch((error) => {
      setTab((current) => current || 'Discover');
      Alert.alert('Teams unavailable', error.message);
    });
  }, [loadTeamData]));

  const manageableTeamIds = useMemo(() => joined.filter(canReviewRequests).map((team) => team.id).sort(), [joined]);
  const manageableTeamKey = manageableTeamIds.join(',');
  useEffect(() => {
    if (!manageableTeamIds.length || !supabase) return undefined;
    let refreshRunning = false;
    const refresh = () => {
      if (refreshRunning) return;
      refreshRunning = true;
      refreshJoinRequests(manageableTeamIds).catch(() => {}).finally(() => { refreshRunning = false; });
    };
    refresh();
    const channel = supabase.channel(`team-requests-${user?.id || 'manager'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_join_requests' }, (payload) => {
        const changedTeamId = payload.new?.team_id || payload.old?.team_id;
        if (manageableTeamIds.includes(changedTeamId)) loadTeamData().catch(() => {});
      })
      .subscribe();
    const fallbackTimer = setInterval(refresh, 15000);
    return () => {
      clearInterval(fallbackTimer);
      supabase.removeChannel(channel);
    };
  }, [loadTeamData, manageableTeamKey, refreshJoinRequests, user?.id]);

  // Joins, approvals, removals and new invitations show up without a manual
  // refresh: for the new member, the captain, the rest of the team, and the
  // invited player. Bursts of changes collapse into one reload.
  const joinedTeamIdsRef = useRef([]);
  joinedTeamIdsRef.current = joined.map((team) => team.id);
  useEffect(() => {
    if (!user?.id || !supabase) return undefined;
    let reloadTimer = null;
    const scheduleReload = () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { loadTeamData().catch(() => {}); }, 400);
    };
    const channel = supabase.channel(`my-team-membership-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, (payload) => {
        const row = payload.new?.team_id ? payload.new : payload.old;
        if (row?.user_id === user.id || joinedTeamIdsRef.current.includes(row?.team_id)) scheduleReload();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_invitations', filter: `invited_user_id=eq.${user.id}` }, scheduleReload)
      .subscribe();
    return () => {
      clearTimeout(reloadTimer);
      supabase.removeChannel(channel);
    };
  }, [loadTeamData, user?.id]);

  useEffect(() => {
    if (!user?.id || !supabase) return undefined;
    const channel = supabase.channel(`my-team-request-status-${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'team_join_requests',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        loadTeamData().catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadTeamData, user?.id]);

  useEffect(() => {
    const teamIds = joined.map((team) => team.id);
    if (!teamIds.length || !supabase) return undefined;
    const channel = supabase.channel(`team-inbox-${user?.id || 'player'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_messages' }, (payload) => {
        if (!teamIds.includes(payload.new?.team_id) || payload.new?.team_id === chatTeam?.id) return;
        listTeamConversationSummaries(teamIds).then((conversations) => {
          setConversationSummaries(Object.fromEntries(conversations.map((item) => [item.team_id, item])));
        }).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, () => {
        loadTeamData().catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chatTeam?.id, joined, loadTeamData, user?.id]);

  useEffect(() => {
    if (!chatTeam?.id || messages[chatTeam.id]) return;
    const teamId = chatTeam.id;
    setMessagePagination((current) => ({ ...current, [teamId]: { hasMore: false, loading: true } }));
    markTeamConversationRead(teamId).then(() => Promise.all([listTeamMessages(teamId), listTeamMessageReadStates(teamId)]))
      .then(([page, reads]) => {
        setMessages((current) => ({ ...current, [teamId]: page.rows.map((row) => normalizeTeamMessage(row, user?.id)) }));
        setMessagePagination((current) => ({ ...current, [teamId]: { hasMore: page.hasMore, loading: false, cursor: page.cursor } }));
        setMessageReadStates((current) => ({ ...current, [teamId]: reads }));
      })
      .catch((error) => {
        setMessagePagination((current) => ({ ...current, [teamId]: { hasMore: false, loading: false } }));
        Alert.alert('Chat unavailable', error.message);
      });
  }, [chatTeam?.id, messages, user?.id]);
  useEffect(() => {
    if (!chatTeam?.id || !supabase) return undefined;
    const teamId = chatTeam.id;
    const syncMessage = (messageId, markRead = false) => {
      if (!messageId) return;
      getTeamMessage(messageId).then((row) => {
        if (!row || row.team_id !== teamId) return;
        const message = normalizeTeamMessage(row, user?.id);
        setMessages((current) => ({ ...current, [teamId]: upsertTeamMessage(current[teamId] || [], message) }));
        const isActivelyViewing = navigation.isFocused() && appStateRef.current === 'active';
        if (markRead && row.sender_id !== user?.id && isActivelyViewing) markTeamConversationRead(teamId).catch(() => {});
      }).catch(() => {});
    };
    const refreshReads = () => listTeamMessageReadStates(teamId).then((reads) => setMessageReadStates((current) => ({ ...current, [teamId]: reads }))).catch(() => {});
    const removeTyper = (typingUserId) => {
      setTypingByTeam((current) => {
        const teamTyping = { ...(current[teamId] || {}) };
        delete teamTyping[typingUserId];
        return { ...current, [teamId]: teamTyping };
      });
    };
    const channel = supabase.channel(`team-chat-${teamId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_messages', filter: `team_id=eq.${teamId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setMessages((current) => ({ ...current, [teamId]: (current[teamId] || []).filter((message) => message.id !== payload.old?.id) }));
          return;
        }
        syncMessage(payload.new?.id, payload.eventType === 'INSERT');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_message_reactions' }, (payload) => {
        // Our own in-flight toggles reconcile when their RPC settles.
        const messageId = payload.new?.message_id || payload.old?.message_id;
        if (!reactionTracker.isPending(messageId)) syncMessage(messageId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_message_pins', filter: `team_id=eq.${teamId}` }, (payload) => {
        syncMessage(payload.new?.message_id || payload.old?.message_id);
        if (chatInfoTeam?.id === teamId) refreshChatInfo(teamId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_message_reads', filter: `team_id=eq.${teamId}` }, refreshReads)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload?.userId || payload.userId === user?.id) return;
        const timerKey = `${teamId}:${payload.userId}`;
        if (typingExpiryTimers.current[timerKey]) clearTimeout(typingExpiryTimers.current[timerKey]);
        if (!payload.isTyping) {
          delete typingExpiryTimers.current[timerKey];
          removeTyper(payload.userId);
          return;
        }
        setTypingByTeam((current) => ({
          ...current,
          [teamId]: {
            ...(current[teamId] || {}),
            [payload.userId]: {
              id: payload.userId,
              name: payload.name || 'Someone',
              avatar: payload.avatar || null,
            },
          },
        }));
        typingExpiryTimers.current[timerKey] = setTimeout(() => {
          delete typingExpiryTimers.current[timerKey];
          removeTyper(payload.userId);
        }, TYPING_EXPIRY_MS);
      })
      .subscribe();
    chatChannelRef.current = { teamId, channel };
    return () => {
      if (chatChannelRef.current?.channel === channel) chatChannelRef.current = null;
      Object.keys(typingExpiryTimers.current).filter((key) => key.startsWith(`${teamId}:`)).forEach((key) => {
        clearTimeout(typingExpiryTimers.current[key]);
        delete typingExpiryTimers.current[key];
      });
      setTypingByTeam((current) => ({ ...current, [teamId]: {} }));
      supabase.removeChannel(channel);
    };
  }, [chatInfoTeam?.id, chatTeam?.id, refreshChatInfo, user?.id]);
  useEffect(() => {
    const teamId = hubTeam?.id || chatTeam?.id;
    if (!teamId) return;
    loadTeamMatchState(teamId);
  }, [hubTeam?.id, chatTeam?.id]);
  useEffect(() => {
    const activeTeamId = liveScoreTeam?.id || hubTeam?.id || chatTeam?.id;
    const matchId = liveMatches[activeTeamId]?.id;
    if (!activeTeamId || !matchId || !supabase) return undefined;
    const channel = supabase.channel(`team-match-${matchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_matches', filter: `id=eq.${matchId}` }, () => loadTeamMatchState(activeTeamId))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_match_score_events', filter: `match_id=eq.${matchId}` }, () => loadTeamMatchState(activeTeamId))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [liveScoreTeam?.id, hubTeam?.id, chatTeam?.id, liveMatches[liveScoreTeam?.id || hubTeam?.id || chatTeam?.id]?.id]);
  const broadcastTeamTyping = useCallback((teamId, isTyping) => {
    const active = chatChannelRef.current;
    if (!active || active.teamId !== teamId || !user?.id) return;
    active.channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        userId: user.id,
        name: user.name || 'Someone',
        avatar: user.picture || null,
        isTyping,
      },
    }).catch(() => {});
  }, [user?.id, user?.name, user?.picture]);
  const changeChatTyping = useCallback((isTyping) => {
    if (chatTeam?.id) broadcastTeamTyping(chatTeam.id, isTyping);
  }, [broadcastTeamTyping, chatTeam?.id]);
  const enterTeamChat = useCallback((team) => {
    setFocusMessageId(null);
    setChatSafetyTeam(null);
    setChatTeam(team);
    setSelected(null);
    setConversationSummaries((current) => current[team.id] ? { ...current, [team.id]: { ...current[team.id], unread_count: 0 } } : current);
    markTeamConversationRead(team.id)
      .then(() => listTeamMessageReadStates(team.id))
      .then((reads) => setMessageReadStates((current) => ({ ...current, [team.id]: reads })))
      .catch(() => {});
  }, []);
  const openTeamChat = useCallback(async (team) => {
    if (!team) return;
    const requestId = chatOpenRequestRef.current + 1;
    chatOpenRequestRef.current = requestId;
    // Already confirmed this session: open straight away and re-check quietly,
    // so the chat appears without waiting on the network.
    const knownEligible = Boolean(chatSafetyStatusRef.current?.eligible);
    if (knownEligible) enterTeamChat(team);
    setChatSafetyBusy(true);
    try {
      const status = await getChatSafetyStatus();
      if (requestId !== chatOpenRequestRef.current || !navigation.isFocused()) return;
      setChatSafetyStatus(status);
      if (status.eligible) {
        if (!knownEligible) enterTeamChat(team);
      } else {
        setChatTeam(null);
        setChatSafetyTeam(team);
      }
    } catch (error) {
      if (knownEligible) return;
      if (requestId === chatOpenRequestRef.current && navigation.isFocused()) {
        Alert.alert('Chat safety unavailable', error.message || 'Peakle could not verify chat access.');
      }
    } finally {
      if (requestId === chatOpenRequestRef.current) setChatSafetyBusy(false);
    }
  }, [enterTeamChat, navigation]);
  useEffect(() => {
    const token = route?.params?.openChatToken;
    const teamId = route?.params?.openChatTeamId;
    if (!token || !teamId || handledOpenChatToken.current === token || !joined.length) return;
    const team = joined.find((item) => item.id === teamId);
    handledOpenChatToken.current = token;
    if (!team) {
      // No longer on this team: fall back to the Teams list.
      navigation.setParams({ openChatTeamId: undefined, openChatToken: undefined, chatReturnTo: undefined });
      return;
    }
    const returnTo = route.params.chatReturnTo || null;
    setChatReturnTo(returnTo);
    openTeamChat(team);
    // Hand ownership straight from chatReturnTo to chatOwner so the tab bar
    // never flips to Teams in between.
    navigation.setParams({ openChatTeamId: undefined, openChatToken: undefined, chatReturnTo: undefined, chatOwner: returnTo || undefined });
  }, [joined, navigation, openTeamChat, route?.params?.openChatTeamId, route?.params?.openChatToken, route?.params?.chatReturnTo]);
  // A chat requested from Chats that isn't on screen yet (teams still loading
  // or the safety check in flight) shows a loading chat, never the Teams list.
  const openingChatFromInbox = Boolean(route?.params?.chatReturnTo && route?.params?.openChatToken && handledOpenChatToken.current !== route.params.openChatToken)
    || Boolean(chatReturnTo && chatSafetyBusy && !chatTeam && !chatSafetyTeam);
  const chatOwner = chatReturnTo && (chatTeam || chatInfoTeam || chatSafetyTeam || chatSafetyBusy) ? chatReturnTo : undefined;
  useEffect(() => {
    // Lets the tab bar highlight Chats rather than Teams for a chat opened there.
    if (route?.params?.chatOwner !== chatOwner) navigation.setParams({ chatOwner });
  }, [chatOwner, navigation, route?.params?.chatOwner]);
  // Tapping a team invite notification lands on the Teams list with the
  // invitation cards on top, fetched fresh so a just-sent invite is there.
  const handledOpenInvitationToken = useRef(null);
  useEffect(() => {
    const token = route?.params?.openInvitationToken;
    if (!token || handledOpenInvitationToken.current === token) return;
    handledOpenInvitationToken.current = token;
    setSelected(null);
    setHubTeam(null);
    setTab((current) => current || 'Joined');
    loadTeamData().catch(() => {});
    navigation.setParams({ openInvitationTeamId: undefined, openInvitationToken: undefined });
  }, [loadTeamData, navigation, route?.params?.openInvitationToken]);
  const confirmChatSafety = useCallback(async (isAdult) => {
    if (!chatSafetyTeam || chatSafetyBusy) return;
    const team = chatSafetyTeam;
    const requestId = chatOpenRequestRef.current + 1;
    chatOpenRequestRef.current = requestId;
    setChatSafetyBusy(true);
    try {
      const status = await acknowledgeChatSafety(isAdult);
      if (requestId !== chatOpenRequestRef.current || !navigation.isFocused()) return;
      setChatSafetyStatus(status);
      if (status.eligible) enterTeamChat(team);
    } catch (error) {
      if (requestId === chatOpenRequestRef.current && navigation.isFocused()) {
        Alert.alert('Chat preference not saved', error.message || 'Please try again.');
      }
    } finally {
      if (requestId === chatOpenRequestRef.current) setChatSafetyBusy(false);
    }
  }, [chatSafetyBusy, chatSafetyTeam, enterTeamChat, navigation]);
  useEffect(() => {
    if (!chatTeam?.id) return undefined;
    let active = true;
    const verify = () => getChatSafetyStatus().then((status) => {
      if (!active) return;
      setChatSafetyStatus(status);
      if (!status.eligible) {
        changeChatTyping(false);
        setChatSafetyTeam(chatTeam);
        setChatInfoTeam(null);
        setChatTeam(null);
      }
    }).catch(() => {});
    const timer = setInterval(verify, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [changeChatTyping, chatTeam]);
  const loadEarlierMessages = async () => {
    if (!chatTeam?.id) return;
    const teamId = chatTeam.id;
    const existing = messages[teamId] || [];
    if (!existing.length || messagePagination[teamId]?.loading) return;
    setMessagePagination((current) => ({ ...current, [teamId]: { ...(current[teamId] || {}), loading: true } }));
    try {
      const cursor = messagePagination[teamId]?.cursor || { createdAt: existing[0].createdAt, id: existing[0].id };
      const page = await listTeamMessages(teamId, { before: cursor });
      const older = page.rows.map((row) => normalizeTeamMessage(row, user?.id));
      setMessages((current) => ({ ...current, [teamId]: [...older, ...(current[teamId] || [])] }));
      setMessagePagination((current) => ({ ...current, [teamId]: { hasMore: page.hasMore, loading: false, cursor: page.cursor } }));
    } catch (error) {
      setMessagePagination((current) => ({ ...current, [teamId]: { ...(current[teamId] || {}), loading: false } }));
      Alert.alert('Earlier messages unavailable', error.message);
    }
  };
  useEffect(() => {
    return () => {
      Object.values(typingExpiryTimers.current).forEach(clearTimeout);
    };
  }, []);
  const openJoinRequest = (team) => {
    if (!team || requested.includes(team.id) || requesting.includes(team.id)) return;
    const invitation = invitations.find((item) => item.team_id === team.id);
    if (invitation) {
      setRequesting((value) => [...value, team.id]);
      respondInvitation(invitation, true).finally(() => setRequesting((value) => value.filter((id) => id !== team.id)));
      return;
    }
    // The local list can lag behind a just-sent invite; check before asking to join.
    setRequesting((value) => [...value, team.id]);
    listMyTeamInvitations()
      .then((items) => {
        setInvitations(items || []);
        const fresh = (items || []).find((item) => item.team_id === team.id);
        if (fresh) return respondInvitation(fresh, true);
        setJoinTeam(team);
        return undefined;
      }, () => setJoinTeam(team))
      .finally(() => setRequesting((value) => value.filter((id) => id !== team.id)));
  };
  const requestJoin = async (introduction) => {
    const id = joinTeam?.id;
    if (!id) return;
    if (requested.includes(id) || requesting.includes(id)) return;
    setRequesting((value) => [...value, id]);
    try {
      await requestTeamJoin(id, introduction);
      setRequested((value) => value.includes(id) ? value : [...value, id]);
      setJoinTeam(null);
    } catch (error) {
      Alert.alert('Request not sent', error.message);
    } finally {
      setRequesting((value) => value.filter((teamId) => teamId !== id));
    }
  };
  const cancelJoinRequest = (team) => {
    if (!team || !requested.includes(team.id) || cancellingRequests.includes(team.id)) return;
    Alert.alert('Cancel join request?', `Your request to join ${team.name} will be withdrawn. You can apply again later.`, [
      { text: 'Keep request', style: 'cancel' },
      {
        text: 'Cancel request',
        style: 'destructive',
        onPress: async () => {
          setCancellingRequests((current) => [...current, team.id]);
          try {
            await cancelTeamJoin(team.id);
            setRequested((current) => current.filter((teamId) => teamId !== team.id));
          } catch (error) {
            Alert.alert('Request not cancelled', error.message);
          } finally {
            setCancellingRequests((current) => current.filter((teamId) => teamId !== team.id));
          }
        },
      },
    ]);
  };
  const respondInvitation = async (invitation, accept) => {
    try {
      await respondTeamInvitation(invitation.id, accept);
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      if (accept) {
        await loadTeamData();
        setTab('Joined');
      }
    } catch (error) {
      Alert.alert(accept ? 'Could not join team' : 'Could not decline invitation', error.message);
    }
  };
  const discoverTeams = useMemo(() => availableTeams.map((team) => {
    const distanceKm = distanceInKm(userLocation, team);
    return { ...team, distanceKm, distance: formatDistance(distanceKm) };
  }).filter((team) => {
    const matchesSearch = `${team.name} ${team.location} ${team.level}`.toLowerCase().includes(query.toLowerCase());
    const playerLevel = skillCategoryForRating(user?.skill)?.label;
    const matchesFilter = filter === 'For you' || (filter === 'Nearby' && team.distanceKm != null && team.distanceKm <= 25) || (filter === 'My level' && (team.level === 'Open level' || playerLevel != null && team.level === playerLevel)) || (filter === 'Open spots' && team.members < team.capacity);
    return matchesSearch && matchesFilter;
  }).sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY)), [availableTeams, filter, query, user?.skill, userLocation]);
  const sendMessage = async (text) => {
    if (!chatTeam) return;
    const teamId = chatTeam.id;
    const optimistic = optimisticTeamMessage({ teamId, currentUserId: user?.id, text });
    setMessages((current) => ({ ...current, [teamId]: upsertTeamMessage(current[teamId] || [], optimistic) }));
    try {
      const row = await sendTeamMessage(teamId, text);
      const message = normalizeTeamMessage(row, user?.id);
      setMessages((current) => ({ ...current, [teamId]: upsertTeamMessage((current[teamId] || []).filter((item) => item.id !== optimistic.id), message) }));
      setConversationSummaries((current) => ({ ...current, [teamId]: { ...(current[teamId] || {}), team_id: teamId, last_body: row.body, last_has_image: Boolean(row.image_url || row.media_path), last_created_at: row.created_at, last_sender_name: row.profiles?.display_name || 'You', unread_count: 0 } }));
    } catch (error) {
      setMessages((current) => ({ ...current, [teamId]: (current[teamId] || []).filter((item) => item.id !== optimistic.id) }));
      Alert.alert('Message not sent', error.message);
    }
  };
  const editMessage = async (messageId, text) => {
    if (!chatTeam) return;
    try {
      const row = await editTeamMessage(messageId, text);
      const message = normalizeTeamMessage(row, user?.id);
      setMessages((current) => ({ ...current, [chatTeam.id]: upsertTeamMessage(current[chatTeam.id] || [], message) }));
      refreshTeamConversationSummary(chatTeam.id).catch(() => {});
    } catch (error) { Alert.alert('Message not edited', error.message); }
  };
  const deleteMessageForMe = async (messageId) => {
    if (!chatTeam) return;
    try {
      await hideTeamMessage(messageId);
      setMessages((current) => ({ ...current, [chatTeam.id]: (current[chatTeam.id] || []).filter((message) => message.id !== messageId) }));
      refreshTeamConversationSummary(chatTeam.id).catch(() => {});
    } catch (error) { Alert.alert('Message not deleted', error.message); }
  };
  const reportMessage = async (message, reason, details) => {
    if (!chatTeam || !message) return;
    await reportTeamMessage(message.id, reason, details);
    setMessages((current) => ({ ...current, [chatTeam.id]: (current[chatTeam.id] || []).filter((item) => item.id !== message.id) }));
    refreshTeamConversationSummary(chatTeam.id).catch(() => {});
    Alert.alert('Report received', reason === 'child_safety' ? 'This was marked urgent for safety review. The message is now hidden.' : 'The message is now hidden and queued for safety review.');
  };
  const blockMessageSender = async (message) => {
    if (!message?.senderId) return;
    try {
      await blockChatUser(message.senderId);
      setMessages((current) => Object.fromEntries(Object.entries(current).map(([teamId, items]) => [teamId, items.filter((item) => item.senderId !== message.senderId)])));
      setChatInfo((current) => ({
        ...current,
        blocked: current.blocked.some((player) => player.id === message.senderId)
          ? current.blocked
          : [...current.blocked, { id: message.senderId, name: message.sender, avatar: message.avatar }],
      }));
      listTeamConversationSummaries(joined.map((team) => team.id)).then((rows) => setConversationSummaries(Object.fromEntries(rows.map((item) => [item.team_id, item])))).catch(() => {});
      Alert.alert('Player blocked', `${message.sender}’s messages are now hidden from your team chats.`);
    } catch (error) {
      Alert.alert('Player not blocked', error.message);
    }
  };
  const unblockPlayer = (player) => Alert.alert(`Unblock ${player.name}?`, 'Their messages will be visible in shared team chats again.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Unblock',
      onPress: async () => {
        try {
          await unblockChatUser(player.id);
          setChatInfo((current) => ({ ...current, blocked: current.blocked.filter((item) => item.id !== player.id) }));
          const teamId = chatInfoTeam?.id || chatTeam?.id;
          if (teamId) {
            const page = await listTeamMessages(teamId);
            setMessages((current) => ({ ...current, [teamId]: page.rows.map((row) => normalizeTeamMessage(row, user?.id)) }));
            setMessagePagination((current) => ({ ...current, [teamId]: { hasMore: page.hasMore, loading: false, cursor: page.cursor } }));
          }
        } catch (error) {
          Alert.alert('Player not unblocked', error.message);
        }
      },
    },
  ]);
  const moderateMessage = async (message, reason) => {
    if (!chatTeam || !message) return;
    try {
      await moderateTeamMessage(message.id, reason);
      const row = await getTeamMessage(message.id);
      const moderated = normalizeTeamMessage(row, user?.id);
      setMessages((current) => ({ ...current, [chatTeam.id]: upsertTeamMessage(current[chatTeam.id] || [], moderated) }));
      refreshTeamConversationSummary(chatTeam.id).catch(() => {});
    } catch (error) {
      Alert.alert('Message not removed', error.message);
    }
  };
  const unsendMessage = async (messageId) => {
    if (!chatTeam) return;
    try {
      const row = await unsendTeamMessage(messageId);
      const message = normalizeTeamMessage(row, user?.id);
      setMessages((current) => ({ ...current, [chatTeam.id]: upsertTeamMessage(current[chatTeam.id] || [], message) }));
      refreshTeamConversationSummary(chatTeam.id).catch(() => {});
    } catch (error) { Alert.alert('Message not unsent', error.message); }
  };
  const reactToMessage = async (messageId, emoji) => {
    if (!chatTeam || !user?.id) return;
    const teamId = chatTeam.id;
    const applyRow = (row) => {
      if (row) setMessages((current) => ({ ...current, [teamId]: upsertTeamMessage(current[teamId] || [], normalizeTeamMessage(row, user.id)) }));
    };
    setMessages((current) => ({
      ...current,
      [teamId]: (current[teamId] || []).map((item) => (item.id === messageId ? { ...item, reactions: toggleOwnReaction(item.reactions, user.id, emoji) } : item)),
    }));
    reactionTracker.start(messageId);
    let row = null;
    let failure = null;
    try { row = await toggleTeamMessageReaction(messageId, emoji); }
    catch (error) { failure = error; }
    if (!reactionTracker.finish(messageId)) return;
    if (failure) {
      getTeamMessage(messageId).then(applyRow).catch(() => {});
      Alert.alert('Reaction not saved', failure.message);
      return;
    }
    applyRow(row);
  };
  const pinMessage = async (messageId) => {
    if (!chatTeam) return;
    try {
      const row = await toggleTeamMessagePin(messageId);
      const message = normalizeTeamMessage(row, user?.id);
      setMessages((current) => ({ ...current, [chatTeam.id]: upsertTeamMessage(current[chatTeam.id] || [], message) }));
      if (chatInfoTeam?.id === chatTeam.id) await refreshChatInfo(chatTeam.id);
    } catch (error) { Alert.alert('Pin not updated', error.message); }
  };
  const saveTeamNickname = async (person, nickname) => {
    const teamId = chatInfoTeam?.id;
    if (!teamId) return;
    const saved = await setChatNickname('team', teamId, person.id, nickname);
    setTeamNicknames((current) => {
      const names = { ...(current[teamId] || {}) };
      if (saved) names[person.id] = saved;
      else delete names[person.id];
      return { ...current, [teamId]: names };
    });
  };
  const muteTeam = async (minutes) => {
    const teamId = chatInfoTeam?.id;
    if (!teamId) return;
    const previous = teamMutes[teamId] || null;
    const localUntil = minutes == null ? 'infinity' : new Date(Date.now() + minutes * 60000).toISOString();
    setTeamMutes((current) => ({ ...current, [teamId]: localUntil }));
    try {
      const mutedUntil = await muteTeamChat(teamId, minutes);
      setTeamMutes((current) => ({ ...current, [teamId]: mutedUntil || localUntil }));
    } catch (error) {
      setTeamMutes((current) => ({ ...current, [teamId]: previous }));
      setTimeout(() => Alert.alert('Chat not muted', error.message), Platform.OS === 'ios' ? 350 : 0);
    }
  };
  const unmuteTeam = async () => {
    const teamId = chatInfoTeam?.id;
    if (!teamId) return;
    const previous = teamMutes[teamId] || null;
    setTeamMutes((current) => ({ ...current, [teamId]: null }));
    try {
      await unmuteTeamChat(teamId);
    } catch (error) {
      setTeamMutes((current) => ({ ...current, [teamId]: previous }));
      Alert.alert('Chat not unmuted', error.message);
    }
  };
  const jumpToPinnedMessage = async (message) => {
    const team = chatInfoTeam || chatTeam;
    if (!team?.id || !message?.id || openingPinnedMessageId) return;
    const teamId = team.id;
    setOpeningPinnedMessageId(message.id);
    try {
      let loaded = [...(messages[teamId] || [])];
      let hasMore = messagePagination[teamId]?.hasMore ?? true;
      let cursor = messagePagination[teamId]?.cursor
        || (loaded[0] ? { createdAt: loaded[0].createdAt, id: loaded[0].id } : null);
      const visitedCursors = new Set();

      if (!loaded.length) {
        const page = await listTeamMessages(teamId, { limit: 100 });
        loaded = page.rows.map((row) => normalizeTeamMessage(row, user?.id));
        hasMore = page.hasMore;
        cursor = page.cursor;
      }

      while (!loaded.some((item) => item.id === message.id) && hasMore && cursor) {
        const cursorKey = `${cursor.createdAt}:${cursor.id || ''}`;
        if (visitedCursors.has(cursorKey)) break;
        visitedCursors.add(cursorKey);
        const page = await listTeamMessages(teamId, { before: cursor, limit: 100 });
        const older = page.rows.map((row) => normalizeTeamMessage(row, user?.id));
        const byId = new Map([...older, ...loaded].map((item) => [item.id, item]));
        loaded = [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        hasMore = page.hasMore;
        cursor = page.cursor;
      }

      if (!loaded.some((item) => item.id === message.id)) {
        if (navigation.isFocused()) Alert.alert('Message unavailable', 'This pinned message may have been deleted or is no longer visible to you.');
        return;
      }

      if (!navigation.isFocused()) return;
      setMessages((current) => {
        const byId = new Map([...(current[teamId] || []), ...loaded].map((item) => [item.id, item]));
        return { ...current, [teamId]: [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) };
      });
      setMessagePagination((current) => ({ ...current, [teamId]: { hasMore, loading: false, cursor } }));
      setFocusMessageId(message.id);
      setChatTeam(team);
      setChatInfoTeam(null);
    } catch (error) {
      if (navigation.isFocused()) Alert.alert('Message unavailable', error.message);
    } finally {
      setOpeningPinnedMessageId(null);
    }
  };
  const shareTeam = (team, invite = false) => Share.share({
    title: invite ? `Join ${team.name} on Peakle` : team.name,
    message: invite
      ? `Join ${team.name} on Peakle. ${team.location} · ${team.members}/${team.capacity} members.`
      : `Check out ${team.name} on Peakle. ${team.location} · Rating ${team.rating}.`,
  });
  const attachMedia = async (type) => {
    if (!chatTeam) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: type === 'video' ? ['videos'] : ['images'], quality: 1, videoMaxDuration: 60 });
    if (result.canceled) return;
    const teamId = chatTeam.id;
    const asset = result.assets[0];
    const label = type === 'video' ? 'Shared a video' : 'Shared a photo';
    const optimistic = optimisticTeamMessage({
      teamId,
      currentUserId: user?.id,
      text: label,
      image: type === 'image' ? asset.uri : null,
      video: type === 'video' ? asset.uri : null,
      mediaType: type,
      deliveryState: 'uploading',
    });
    setMessages((current) => ({ ...current, [teamId]: upsertTeamMessage(current[teamId] || [], optimistic) }));
    let uploaded = null;
    try {
      uploaded = await uploadTeamChatMedia(teamId, asset, type);
      setMessages((current) => ({ ...current, [teamId]: (current[teamId] || []).map((item) => item.id === optimistic.id ? { ...item, deliveryState: 'sending' } : item) }));
      const row = await sendTeamMessage(teamId, label, uploaded);
      const message = normalizeTeamMessage(row, user?.id);
      setMessages((current) => ({ ...current, [teamId]: upsertTeamMessage((current[teamId] || []).filter((item) => item.id !== optimistic.id), message) }));
      setConversationSummaries((current) => ({ ...current, [teamId]: { ...(current[teamId] || {}), team_id: teamId, last_body: row.body, last_has_image: true, last_created_at: row.created_at, last_sender_name: row.profiles?.display_name || 'You', unread_count: 0 } }));
    } catch (error) {
      if (uploaded?.path) deleteTeamChatMedia(uploaded.path).catch(() => {});
      setMessages((current) => ({ ...current, [teamId]: (current[teamId] || []).filter((item) => item.id !== optimistic.id) }));
      Alert.alert(`${type === 'video' ? 'Video' : 'Photo'} not sent`, error.message);
    }
  };
  const toClientTeamMatch = (payload) => {
    if (!payload) return null;
    const home = payload.home_team || {};
    const away = payload.away_team || {};
    return {
      id: payload.id,
      challengeId: payload.challenge_id,
      home: home.name || 'Home team',
      away: away.name || 'Away team',
      homeTag: (home.tag || 'HME').toUpperCase(),
      awayTag: (away.tag || 'AWY').toUpperCase(),
      venue: payload.venue_name || 'Venue to be confirmed',
      game: payload.game,
      homeScore: payload.home_score,
      awayScore: payload.away_score,
      completedGames: (payload.completed_games || []).map((entry) => ({ home: entry.home, away: entry.away })),
      servingTeam: payload.server_side === 1 ? 'away' : 'home',
      servingPlayerIndex: payload.serving_position || 0,
      serviceNumber: payload.service_number,
      scorerId: payload.scorer_id,
      scorer: payload.scorer_name,
      canScore: Boolean(payload.can_score),
      canAssignScorer: Boolean(payload.can_assign_scorer),
      canUndo: false,
      status: payload.status === 'completed' ? 'COMPLETE' : 'LIVE',
      players: `${(payload.match_format || 'doubles').replace(/^\w/, (letter) => letter.toUpperCase())} match`,
      lastPlay: 'Match live. Waiting for the first rally.',
    };
  };
  const applyRallyEvent = (match, event) => {
    if (!match || !event) return match;
    const servingTeam = event.server_side === 1 ? 'away' : 'home';
    const winnerName = event.winning_side === 1 ? match.away : match.home;
    const lastPlay = event.action === 'point'
      ? `${winnerName} wins a point.`
      : event.action === 'undo'
        ? `Last rally undone. Score corrected to ${event.home_score}–${event.away_score}.`
        : `${winnerName} won the rally. ${servingTeam === 'home' ? match.home : match.away} now has the serve.`;
    return {
      ...match,
      homeScore: event.home_score,
      awayScore: event.away_score,
      servingTeam,
      servingPlayerIndex: event.serving_position || 0,
      serviceNumber: event.service_number,
      game: event.game || match.game,
      canUndo: Boolean(event.can_undo),
      lastPlay,
    };
  };
  const loadTeamMatchState = async (teamId) => {
    try {
      const payload = await getTeamMatch(teamId);
      const mapped = toClientTeamMatch(payload);
      setLiveMatches((current) => ({ ...current, [teamId]: mapped }));
      if (!mapped) {
        const challenges = await getAcceptedTeamChallenges(teamId).catch(() => []);
        setTeamChallenges((current) => ({ ...current, [teamId]: challenges }));
      }
    } catch (error) {
      console.warn('Team match state could not be loaded:', error.message);
    }
  };
  const startMatchForChallenge = async (teamId, challengeId, scorerId = user?.id) => {
    if (matchBusy) return;
    setMatchBusy(true);
    try {
      const payload = await startTeamMatch(challengeId, scorerId);
      setLiveMatches((current) => ({ ...current, [teamId]: toClientTeamMatch(payload) }));
      setTeamChallenges((current) => ({ ...current, [teamId]: (current[teamId] || []).filter((item) => item.id !== challengeId) }));
      setScorerChallengeId(null);
    } catch (error) {
      Alert.alert('Match could not be started', error.message || 'Try again.');
    } finally { setMatchBusy(false); }
  };
  const changeTeamMatchScorer = async (teamId, matchId, scorerId) => {
    if (matchBusy) return;
    setMatchBusy(true);
    try {
      const payload = await handoffTeamMatchScorer(matchId, scorerId);
      setLiveMatches((current) => ({ ...current, [teamId]: toClientTeamMatch(payload) }));
      setScorerChangeMatchId(null);
    } catch (error) {
      Alert.alert('Scorer could not be changed', error.message || 'Try again.');
    } finally { setMatchBusy(false); }
  };
  const recordRally = async (teamId, winner) => {
    const match = liveMatches[teamId];
    if (!match?.canScore || matchBusy) return;
    setMatchBusy(true);
    try {
      const event = await recordTeamMatchRally(match.id, winner === 'home' ? 0 : 1);
      setLiveMatches((current) => ({ ...current, [teamId]: applyRallyEvent(current[teamId], event) }));
    } catch (error) {
      Alert.alert('Rally not recorded', error.message || 'Try again.');
    } finally { setMatchBusy(false); }
  };
  const undoRally = async (teamId) => {
    const match = liveMatches[teamId];
    if (!match?.canScore || !match?.canUndo || matchBusy) return;
    setMatchBusy(true);
    try {
      const event = await undoTeamMatchRally(match.id);
      setLiveMatches((current) => ({ ...current, [teamId]: applyRallyEvent(current[teamId], event) }));
    } catch (error) {
      Alert.alert('Could not undo', error.message || 'Try again.');
    } finally { setMatchBusy(false); }
  };
  const finishGame = async (teamId) => {
    const match = liveMatches[teamId];
    if (!match?.canScore || matchBusy) return;
    setMatchBusy(true);
    try {
      const payload = await completeTeamMatchGame(match.id, match.homeScore, match.awayScore);
      setLiveMatches((current) => ({ ...current, [teamId]: toClientTeamMatch(payload) }));
    } catch (error) {
      Alert.alert('Game could not be recorded', error.message || 'Try again.');
    } finally { setMatchBusy(false); }
  };
  const finishMatch = async (teamId) => {
    const match = liveMatches[teamId];
    if (!match?.canScore || matchBusy) return;
    setMatchBusy(true);
    try {
      await completeTeamMatch(match.id);
      setLiveMatches((current) => { const next = { ...current }; delete next[teamId]; return next; });
      setLiveScoreTeam(null);
    } catch (error) {
      Alert.alert('Match could not be finished', error.message || 'Try again.');
    } finally { setMatchBusy(false); }
  };
  const replaceTeam = (updated) => {
    setJoined((current) => current.map((team) => team.id === updated.id ? updated : team));
    if (selected?.id === updated.id) setSelected(updated);
    if (hubTeam?.id === updated.id) setHubTeam(updated);
    if (chatTeam?.id === updated.id) setChatTeam(updated);
    if (chatInfoTeam?.id === updated.id) setChatInfoTeam(updated);
  };
  const changeMemberRole = async (member, role) => {
    const team = chatInfoTeam || chatTeam;
    const roleValue = TEAM_ROLE_VALUES[role];
    if (!team || !roleValue) throw new Error('Choose a valid team role.');
    await updateTeamMemberRole(team.id, member.id, roleValue);
    replaceTeam({ ...team, roster: (team.roster || []).map((item) => item.id === member.id ? { ...item, role } : item) });
  };
  const removeMember = async (member) => {
    const team = chatInfoTeam || chatTeam;
    if (!team) throw new Error('Open the team before managing its members.');
    await removeTeamMember(team.id, member.id);
    const roster = (team.roster || []).filter((item) => item.id !== member.id);
    const members = roster.length;
    replaceTeam({
      ...team,
      roster,
      members,
      status: members >= 4 ? 'active' : 'forming',
      acceptedMembers: (team.acceptedMembers || []).filter((item) => item.id !== member.id && item.user_id !== member.id),
    });
  };
  const createTeam = async (details) => {
    try {
    const coords = await geocodeArea(details.location.replace(/ · /g, ', '));
    if (!coords) throw new Error('We could not locate that team area. Try a city and country.');
    details = { ...details, ...coords };
    const row = await createTeamRecord(details);
    const image = await uploadTeamImage(row.id, details.image, 'profile');
    const coverImage = await uploadTeamImage(row.id, details.coverImage, 'cover');
    if (image !== details.image || coverImage !== details.coverImage) await updateTeamRecord(row.id, { ...details, image, coverImage });
    const created = { ...details, image, coverImage, id: row.id, members: 1, rating: '—', color: C.teal, icon: 'people-outline', role: 'Owner', status: row.status || 'forming', isDiscoverable: row.is_discoverable, roster: [{ id: user.id, name: user.name, initials: user.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), avatar: user.picture || null, role: 'Owner', rating: 'Unrated', color: C.teal }], acceptedMembers: [] };
    setJoined((current) => current.some((team) => team.id === created.id) ? current.map((team) => team.id === created.id ? created : team) : [...current, created]);
    setJoinRequests((current) => ({ ...current, [row.id]: [] }));
    setMessages((current) => ({ ...current, [row.id]: [] }));
    setCreating(false);
    setTab('Joined');
    setHubTeam(created);
    } catch (error) { Alert.alert('Team not created', error.message); }
  };
  const saveTeam = async (updated) => {
    if (!canEditTeam(editingTeam)) return;
    try {
    if (updated.location !== editingTeam.location || ![updated.latitude, updated.longitude].every(Number.isFinite)) {
      const coords = await geocodeArea(updated.location.replace(/ · /g, ', '));
      if (!coords) throw new Error('We could not locate that team area. Try a city and country.');
      updated = { ...updated, ...coords };
    }
    const image = await uploadTeamImage(updated.id, updated.image, 'profile');
    const coverImage = await uploadTeamImage(updated.id, updated.coverImage, 'cover');
    updated = { ...updated, image, coverImage };
    await updateTeamRecord(updated.id, updated);
    replaceTeam(updated);
    setEditingTeam(null);
    setHubTeam(updated);
    } catch (error) { Alert.alert('Team not saved', error.message); }
  };
  const acceptRequest = async (team, request) => {
    if (!canReviewRequests(team) || team.members >= team.capacity) {
      if (team.members >= team.capacity) Alert.alert('Team is full', 'Increase the team capacity before accepting another player.');
      return;
    }
    try { await reviewTeamRequest(request, true); } catch (error) { Alert.alert('Request not accepted', error.message); return; }
    const alreadyInRoster = (team.roster || []).some((member) => member.id === request.user_id);
    const roster = alreadyInRoster ? team.roster : [...(team.roster || []), {
      id: request.user_id,
      name: request.name,
      initials: request.initials,
      avatar: request.avatar || null,
      role: 'Member',
      rating: request.rating ?? 'Unrated',
      color: request.color || C.teal,
    }];
    const nextMemberCount = team.members + (alreadyInRoster ? 0 : 1);
    const updated = { ...team, roster, members: nextMemberCount, status: nextMemberCount >= 4 ? 'active' : 'forming', acceptedMembers: [...(team.acceptedMembers || []), request] };
    replaceTeam(updated);
    setJoinRequests((current) => ({ ...current, [team.id]: (current[team.id] || []).filter((item) => item.id !== request.id) }));
  };
  const declineRequest = async (team, requestId) => {
    if (!canReviewRequests(team)) return;
    const request = (joinRequests[team.id] || []).find((item) => item.id === requestId);
    try { await reviewTeamRequest(request, false); } catch (error) { Alert.alert('Request not declined', error.message); return; }
    setJoinRequests((current) => ({ ...current, [team.id]: (current[team.id] || []).filter((item) => item.id !== requestId) }));
  };
  const updateTeamImage = async (teamId) => {
    const team = joined.find((item) => item.id === teamId);
    if (!canEditTeam(team)) {
      Alert.alert('Admin permission required', 'Only the team creator or an admin can change the team cover.');
      return;
    }
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 1,
    });
    if (!result.canceled) {
      try {
        const coverImage = await uploadTeamImage(teamId, result.assets[0].uri, 'cover');
        const updated = { ...team, coverImage };
        await updateTeamRecord(teamId, updated);
        replaceTeam(updated);
      } catch (error) { Alert.alert('Cover not saved', error.message); }
    }
  };
  if (editingTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><TeamForm team={editingTeam} onBack={() => { setEditingTeam(null); setHubTeam(editingTeam); }} onSave={saveTeam} /></SafeAreaView>;
  if (invitingTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><PlayerInviteScreen team={invitingTeam} onBack={() => { setInvitingTeam(null); setHubTeam(invitingTeam); }} /></SafeAreaView>;
  if (liveScoreTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><LiveScore team={liveScoreTeam} match={liveMatches[liveScoreTeam.id]} scoringMode={liveScoreMode === 'scorer'} busy={matchBusy} currentUserId={user?.id} onRally={(winner) => recordRally(liveScoreTeam.id, winner)} onUndo={() => undoRally(liveScoreTeam.id)} onFinishGame={() => finishGame(liveScoreTeam.id)} onFinishMatch={() => finishMatch(liveScoreTeam.id)} onChangeScorer={() => setScorerChangeMatchId(liveMatches[liveScoreTeam.id]?.id)} onBack={() => { setScorerChangeMatchId(null); setLiveScoreTeam(null); setLiveScoreMode('viewer'); }} /><TeamScorerPicker visible={Boolean(scorerChangeMatchId)} team={liveScoreTeam} currentUserId={user?.id} selectedId={liveMatches[liveScoreTeam.id]?.scorerId} busy={matchBusy} changing onClose={() => setScorerChangeMatchId(null)} onSelect={(scorerId) => changeTeamMatchScorer(liveScoreTeam.id, scorerChangeMatchId, scorerId)} /></SafeAreaView>;
  if (openingChatFromInbox) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><View accessibilityLabel="Opening team chat" accessibilityLiveRegion="polite" style={styles.chatOpening}><ActivityIndicator color={C.teal} /></View></SafeAreaView>;
  if (chatSafetyTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><ChatSafetyScreen team={chatSafetyTeam} status={chatSafetyStatus} busy={chatSafetyBusy} onConfirm={confirmChatSafety} onBack={() => { setChatSafetyTeam(null); if (chatReturnTo) navigation.navigate(chatReturnTo); }} /></SafeAreaView>;
  if (chatInfoTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><TeamChatInfo team={chatInfoTeam} isDark={isDark} currentUserId={user?.id} messages={nicknamedChatMessages} nicknames={activeNicknames} mutedUntil={teamMutes[chatInfoTeam.id]} onSaveNickname={saveTeamNickname} onMute={muteTeam} onUnmute={unmuteTeam} pinnedMessages={chatInfo.pinned} sharedMedia={chatInfo.media} blockedUsers={chatInfo.blocked} loading={chatInfo.loading} openingMessageId={openingPinnedMessageId} onViewMessage={jumpToPinnedMessage} onPin={pinMessage} onUnblock={unblockPlayer} onChangeMemberRole={changeMemberRole} onRemoveMember={removeMember} onMessageMember={(member) => navigation.navigate('DirectChat', { player: { id: member.id, name: member.name, avatar: member.avatar }, ownerTab: 'Team' })} onBack={() => setChatInfoTeam(null)} onViewTeam={() => { setChatReturnTo(null); setSelected(chatInfoTeam); setChatInfoTeam(null); setChatTeam(null); }} /></SafeAreaView>;
  if (chatTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><TeamChat team={chatTeam} messages={nicknamedChatMessages} readStates={messageReadStates[chatTeam.id] || []} currentUser={user} typing={Object.values(typingByTeam[chatTeam.id] || {})} liveMatch={liveMatches[chatTeam.id]} hasEarlier={messagePagination[chatTeam.id]?.hasMore} loadingEarlier={messagePagination[chatTeam.id]?.loading} focusMessageId={focusMessageId} onFocusHandled={() => setFocusMessageId(null)} onLoadEarlier={loadEarlierMessages} onWatchLive={() => { setLiveScoreMode('viewer'); setLiveScoreTeam(chatTeam); }} onSend={sendMessage} onEdit={editMessage} onDelete={deleteMessageForMe} onUnsend={unsendMessage} onReact={reactToMessage} onPin={pinMessage} onReport={reportMessage} onBlock={blockMessageSender} onModerate={moderateMessage} onTypingChange={changeChatTyping} onAttach={attachMedia} onJumpToMessage={jumpToPinnedMessage} onInfo={() => { changeChatTyping(false); setChatInfoTeam(chatTeam); }} onMessageMember={(member) => { changeChatTyping(false); navigation.navigate('DirectChat', { player: { id: member.id, name: member.name, avatar: member.avatar }, ownerTab: 'Team' }); }} onBack={() => { changeChatTyping(false); setFocusMessageId(null); if (chatReturnTo) { navigation.navigate(chatReturnTo); return; } setSelected(chatTeam); setChatTeam(null); }} /></SafeAreaView>;
  if (joinTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><JoinRequestScreen team={joinTeam} user={user} submitting={requesting.includes(joinTeam.id)} onBack={() => setJoinTeam(null)} onSubmit={requestJoin} /></SafeAreaView>;
  if (hubTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><TeamHub team={hubTeam} requests={joinRequests[hubTeam.id] || []} liveMatch={liveMatches[hubTeam.id]} nextChallenges={teamChallenges[hubTeam.id] || []} matchBusy={matchBusy} onOpenMatch={() => { setLiveScoreMode(liveMatches[hubTeam.id]?.canScore ? 'scorer' : 'viewer'); setLiveScoreTeam(hubTeam); }} onStartMatch={(challengeId) => setScorerChallengeId(challengeId)} onRefreshRequests={() => refreshJoinRequests([hubTeam.id]).catch(() => {})} onBack={() => { setScorerChallengeId(null); setHubTeam(null); setSelected(hubTeam); }} onUpdateImage={updateTeamImage} onEdit={() => { if (canEditTeam(hubTeam)) { setEditingTeam(hubTeam); setHubTeam(null); } }} onInvite={() => { setInvitingTeam(hubTeam); setHubTeam(null); }} onChallenges={() => navigation.navigate('Pickleball', { openTab: 'Compete', ownerTab: 'Team' })} onAccept={(request) => acceptRequest(hubTeam, request)} onDecline={(requestId) => declineRequest(hubTeam, requestId)} /><TeamScorerPicker visible={Boolean(scorerChallengeId)} team={hubTeam} currentUserId={user?.id} busy={matchBusy} onClose={() => setScorerChallengeId(null)} onSelect={(scorerId) => startMatchForChallenge(hubTeam.id, scorerChallengeId, scorerId)} /></SafeAreaView>;
  if (selected) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><TeamDetail team={selected} joined={joined.some((team) => team.id === selected.id)} invited={invitations.some((item) => item.team_id === selected.id)} requested={requested.includes(selected.id)} requesting={requesting.includes(selected.id)} cancelling={cancellingRequests.includes(selected.id)} onBack={() => setSelected(null)} onJoin={() => openJoinRequest(selected)} onCancel={() => cancelJoinRequest(selected)} onShare={() => shareTeam(selected)} onChat={() => openTeamChat(selected)} onViewHub={() => { setHubTeam(selected); setSelected(null); }} onUpdateImage={updateTeamImage} /></SafeAreaView>;
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={styles.eyebrow}>FIND YOUR PEOPLE</Text>
            <Text numberOfLines={1} style={styles.h1}>Teams</Text>
          </View>
          <View style={styles.headerActions}>
            {!ACCOUNT_MENU_NAV && <Pressable accessibilityLabel="Open chats" onPress={() => navigation.navigate('Inbox')} style={styles.inboxButton}>
              <Icon name="chatbubbles-outline" size={18} color={C.teal} />
              {directConversations.reduce((total, item) => total + Number(item.unreadCount || 0), 0) > 0 && <View style={styles.inboxBadge}><Text style={styles.inboxBadgeText}>{Math.min(99, directConversations.reduce((total, item) => total + Number(item.unreadCount || 0), 0))}</Text></View>}
            </Pressable>}
            <Pressable accessibilityLabel="Create team" onPress={openCreate} style={styles.createButton}><Icon name="add" size={20} color="#000000" /></Pressable>
            <HeaderAvatar size={40} />
          </View>
        </View>
        <KitchenLine style={styles.headerLine} />
        {!tab ? <View style={styles.teamLoading}><ActivityIndicator color={C.teal} /><Text style={styles.footText}>Loading your teams…</Text></View> : <View style={styles.tabs}>{['Joined', 'Discover'].map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text>{item === 'Joined' && <View style={[styles.count, tab === item && styles.countActive]}><Text style={[styles.countText, tab === item && styles.countTextActive]}>{joined.length}</Text></View>}</Pressable>)}</View>}
        {tab && invitations.length > 0 && <><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>ACTION REQUIRED</Text><Text style={styles.h2}>Team invitations</Text></View><Text style={styles.sectionLink}>{invitations.length} pending</Text></View>{invitations.map((invitation) => <TeamInvitationCard key={invitation.id} invitation={invitation} onAccept={() => respondInvitation(invitation, true)} onDecline={() => respondInvitation(invitation, false)} />)}</>}
        {tab === 'Discover' && <><View style={styles.search}><Icon name="search-outline" color={C.ink40} /><TextInput value={query} onChangeText={setQuery} placeholder="Search teams, area, or level" placeholderTextColor={C.ink40} style={styles.searchInput} /></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{['For you', 'Nearby', 'My level', 'Open spots'].map((item) => <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.filterActive]}><Text style={filter === item ? styles.filterActiveText : styles.filterText}>{item}</Text></Pressable>)}</ScrollView><View style={styles.sectionHead}><View style={styles.discoverSectionCopy}><Text numberOfLines={1} style={styles.eyebrow}>NEAREST TO {userLocation.label.toUpperCase()}</Text><Text style={styles.h2}>{discoverTeams.length} teams to explore</Text></View><Pressable accessibilityLabel="Change team search location" onPress={() => setLocationOpen(true)} style={styles.discoveryLocationChange}><Icon name="location-outline" size={14} color={C.teal} /><Text style={styles.discoveryLocationChangeText}>Change</Text></Pressable></View><View {...webLayout('two-columns')}>{discoverTeams.map((team) => <TeamCard key={team.id} team={team} invited={invitations.some((item) => item.team_id === team.id)} requested={requested.includes(team.id)} requesting={requesting.includes(team.id)} cancelling={cancellingRequests.includes(team.id)} onJoin={() => openJoinRequest(team)} onCancel={() => cancelJoinRequest(team)} onOpen={() => setSelected(team)} />)}</View>{!discoverTeams.length && <View style={styles.empty}><Icon name="people-outline" size={35} color={C.ink40} /><Text style={styles.emptyTitle}>No teams found</Text><Text style={styles.footText}>Try another filter or change your search location.</Text></View>}</>}
        {tab === 'Joined' && <><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>TEAM INBOX</Text><Text style={styles.h2}>Your teams</Text></View></View><View {...webLayout('two-columns')}>{joined.map((team) => <TeamCard key={team.id} team={team} joined summary={chatSafetyStatus?.eligible ? conversationSummaries[team.id] : undefined} muted={isMuteActive(teamMutes[team.id])} onOpen={() => setSelected(team)} onChat={() => openTeamChat(team)} />)}</View><ClubWarsTeaser /><Pressable onPress={() => setTab('Discover')} style={styles.exploreButton}><Icon name="compass-outline" color={C.teal} /><View style={styles.exploreCopy}><Text style={styles.exploreTitle}>Find another team</Text><Text style={styles.footText}>Browse public teams with open spots.</Text></View><Icon name="arrow-forward" color={C.teal} /></Pressable></>}
      </ScrollView>
      <LocationPicker visible={locationOpen} onClose={() => setLocationOpen(false)} />

      {/* Slide-up Create Team sheet */}
      {Platform.OS === 'web' ? (
        <Modal visible={creating} transparent animationType="fade" onRequestClose={closeCreate}>
          <View {...webDialog('backdrop')} style={{ flex: 1, backgroundColor: 'rgba(14,35,33,.5)' }}>
            <SafeAreaView {...webDialog('surface')} style={styles.safe}>
              <TeamForm onBack={closeCreate} onSave={createTeam} />
            </SafeAreaView>
          </View>
        </Modal>
      ) : creating && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { transform: [{ translateY: createSlide }] },
          ]}
        >
          <SafeAreaView style={styles.safe}>
            <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
            <TeamForm onBack={closeCreate} onSave={createTeam} />
          </SafeAreaView>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: .08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 } });
const lightStyles = createMobileStyleSheet({
  safe: { flex: 1, backgroundColor: C.paper }, content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 126 }, contentCompact: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 140 }, header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, headerCopy: { flex: 1, minWidth: 0 }, headerActions: { height: 40, flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: 6 }, inboxButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, inboxBadge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: C.brick }, inboxBadgeText: { color: C.surface, fontSize: 7, fontWeight: '900' }, eyebrow: { color: C.ink40, fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1 }, h1: { marginTop: 2, color: C.ink, fontSize: 26, lineHeight: 31, fontWeight: '900', letterSpacing: -.55 }, h2: { marginTop: 3, color: C.ink, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -.5 }, createButton: { width: 40, height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.optic }, createText: { color: '#000000', fontSize: 11, fontWeight: '800' }, kitchen: { height: 7, marginTop: 18, marginBottom: 22 }, headerLine: { marginTop: 10, marginBottom: 16 }, headerLineCompact: { marginTop: 18, marginBottom: 24 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 },
  competitionBanner: { minHeight: 72, marginBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, teamChallengeEntry: { minHeight: 76, marginBottom: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: C.surface }, competitionBannerIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' }, competitionBannerTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, competitionBannerMeta: { marginTop: 3, color: C.ink40, fontSize: 8 },
  tabs: { padding: 4, flexDirection: 'row', borderRadius: 13, backgroundColor: '#E5E9E3' }, tab: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10 }, tabActive: { backgroundColor: C.optic, ...shadow }, tabText: { color: C.ink40, fontSize: 12, fontWeight: '800' }, tabTextActive: { color: C.ink }, count: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.line }, countActive: { backgroundColor: C.ink }, countText: { color: C.ink40, fontSize: 8, fontWeight: '800' }, countTextActive: { color: C.paper }, search: { height: 50, marginTop: 15, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, searchInput: { flex: 1, color: C.ink, fontSize: 13 }, filters: { gap: 8, paddingVertical: 12 }, filter: { minHeight: 35, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, filterActive: { borderColor: C.ink, backgroundColor: C.ink }, filterText: { color: C.ink70, fontSize: 10, fontWeight: '700' }, filterActiveText: { color: C.paper, fontSize: 10, fontWeight: '800' }, sectionHead: { marginTop: 9, marginBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, discoverSectionCopy: { flex: 1, minWidth: 0, paddingRight: 10 }, discoveryLocationChange: { minHeight: 34, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, discoveryLocationChangeText: { color: C.teal, fontSize: 9, fontWeight: '800' }, sectionLink: { color: C.teal, fontSize: 9, fontWeight: '700' },
  teamCard: { marginBottom: 15, paddingBottom: 14, overflow: 'hidden', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, teamCover: { position: 'relative', overflow: 'hidden', backgroundColor: C.teal }, coverScrim: { backgroundColor: 'rgba(5,18,17,.34)' }, coverCourt: { position: 'absolute', width: 130, height: 105, right: -24, bottom: -34, borderWidth: 1, borderColor: 'rgba(255,255,255,.16)', transform: [{ rotate: '-8deg' }] }, coverCourtLine: { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: 'rgba(255,255,255,.16)' }, coverCourtLineVertical: { top: 0, bottom: 0, left: '50%', width: 1, height: '100%' }, coverTop: { paddingHorizontal: 14, paddingTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, coverTag: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(8,24,22,.45)' }, coverTagText: { color: C.surface, fontSize: 8, fontWeight: '900', letterSpacing: 1 }, coverBadges: { flexDirection: 'row', alignItems: 'center', gap: 6 }, coverJoined: { paddingHorizontal: 7, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, backgroundColor: C.optic }, coverJoinedText: { color: '#0E2321', fontSize: 7, fontWeight: '900' }, coverPrivacy: { width: 27, height: 27, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: 'rgba(8,24,22,.42)' }, coverBottom: { position: 'absolute', left: 14, right: 14, bottom: 13, flexDirection: 'row', alignItems: 'flex-end', gap: 8 }, coverCopy: { flex: 1, minWidth: 0 }, coverTitle: { color: C.surface, fontSize: 22, lineHeight: 27, fontWeight: '900', letterSpacing: -.5 }, coverLocation: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 3 }, coverLocationText: { flexShrink: 1, color: 'rgba(255,255,255,.82)', fontSize: 9 }, coverStatus: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(182,71,46,.88)' }, coverStatusActive: { backgroundColor: 'rgba(28,107,102,.92)' }, coverStatusText: { color: C.surface, fontSize: 6, fontWeight: '900', letterSpacing: .4 }, teamHead: { flexDirection: 'row', alignItems: 'center', gap: 11 }, crest: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, crestFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' }, crestTag: { position: 'absolute', top: 4, color: 'rgba(255,255,255,.68)', fontWeight: '900', letterSpacing: .5 }, crestEdit: { position: 'absolute', right: 3, top: 3, width: 21, height: 21, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.optic }, teamCopy: { flex: 1 }, nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, teamName: { maxWidth: '70%', color: C.ink, fontSize: 16, fontWeight: '800' }, stats: { marginHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1, borderColor: C.line }, stat: { paddingRight: 14, borderRightWidth: 1, borderColor: C.line }, statValue: { color: C.ink, fontSize: 15, fontWeight: '800' }, statLabel: { marginTop: 2, color: C.ink40, fontSize: 7, fontWeight: '800', letterSpacing: .7 }, level: { marginLeft: 'auto', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 7, backgroundColor: C.paper }, levelAdvanced: { backgroundColor: '#F7EAE6' }, levelText: { color: C.teal, fontSize: 8, fontWeight: '800' }, levelTextAdvanced: { color: C.brick }, footText: { color: C.ink40, fontSize: 9, lineHeight: 14 }, conversationRow: { minHeight: 57, marginHorizontal: 14, marginTop: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 13, backgroundColor: '#E5F0ED' }, conversationIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.surface }, conversationIconUnread: { backgroundColor: C.optic }, conversationCopy: { flex: 1, minWidth: 0 }, conversationText: { color: C.ink, fontSize: 10, fontWeight: '800' }, conversationMeta: { marginTop: 3, color: C.ink40, fontSize: 7, fontWeight: '700' }, unreadBadge: { minWidth: 24, height: 24, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.brick }, unreadBadgeText: { color: C.surface, fontSize: 7, fontWeight: '900' }, joinButton: { minHeight: 42, marginHorizontal: 14, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 11, backgroundColor: C.optic }, joinButtonText: { color: '#0E2321', fontSize: 11, fontWeight: '800' }, requestedButton: { borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' }, requestedText: { color: C.teal }, pressed: { opacity: .78, transform: [{ scale: .985 }] },
  teamLoading: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10 }, joinedIntroCopy: { flex: 1 }, clubWars: { minHeight: 68, marginBottom: 10, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: '#E5F0ED' }, clubWarsIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.surface }, clubWarsTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, clubWarsTitle: { color: C.ink, fontSize: 12, fontWeight: '800' }, clubWarsBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#D6E94A' }, clubWarsBadgeText: { color: '#0E2321', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 }, clubWarsVotes: { flexDirection: 'row', gap: 6 }, clubWarsVote: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.surface }, clubWarsVoteActive: { backgroundColor: '#D6E94A' }, exploreButton: { minHeight: 68, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed' }, exploreCopy: { flex: 1 }, exploreTitle: { color: C.teal, fontSize: 12, fontWeight: '800' }, empty: { paddingVertical: 60, alignItems: 'center' }, emptyTitle: { marginTop: 10, marginBottom: 3, color: C.ink, fontSize: 17, fontWeight: '800' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, detailHeaderCompact: { minHeight: 52, gap: 12 }, iconButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface }, detailHeaderCopy: { minWidth: 0, flex: 1 }, detailHeaderTitle: { marginTop: 2, color: C.ink, fontSize: 20, fontWeight: '800' }, detailCoverPressable: { overflow: 'hidden', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 }, detailCoverTop: { padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, detailCoverBottom: { position: 'absolute', left: 17, right: 17, bottom: 18 }, editCoverBadge: { paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 9, backgroundColor: 'rgba(8,24,22,.5)' }, editCoverText: { color: C.surface, fontSize: 8, fontWeight: '800' }, heroTitle: { color: C.surface, fontSize: 28, lineHeight: 33, fontWeight: '900', letterSpacing: -.6 }, heroLocation: { marginTop: 7, flexDirection: 'row', alignItems: 'center', gap: 4 }, heroLocationText: { flexShrink: 1, color: 'rgba(255,255,255,.78)', fontSize: 10 }, detailStats: { marginTop: 13, padding: 15, flexDirection: 'row', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, detailStatsCompact: { marginTop: 17, paddingHorizontal: 12, paddingVertical: 18 }, detailStat: { flex: 1, alignItems: 'center', borderRightWidth: 1, borderColor: C.line }, detailStatValue: { color: C.ink, fontSize: 22, fontWeight: '800' }, sectionLabel: { marginTop: 23, marginBottom: 8, color: C.ink, fontSize: 10, fontWeight: '800', letterSpacing: .9 }, sectionLabelCompact: { marginTop: 28, marginBottom: 10 }, about: { color: C.ink70, fontSize: 12, lineHeight: 19 }, requirement: { marginTop: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 13, backgroundColor: '#E5F0ED' }, requirementCompact: { marginTop: 18, padding: 15, gap: 11 }, requirementCopy: { flex: 1 }, requirementTitle: { color: C.ink, fontSize: 11, fontWeight: '800' }, members: { flexDirection: 'row', marginBottom: 22 }, membersCompact: { marginBottom: 26 }, avatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: C.paper, alignItems: 'center', justifyContent: 'center' }, avatarOffset: { marginLeft: -9 }, avatarText: { color: C.surface, fontSize: 9, fontWeight: '800' }, primaryButton: { minHeight: 52, paddingHorizontal: 17, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: C.optic }, primaryText: { color: '#0E2321', fontSize: 12, fontWeight: '800' }, requestedLarge: { backgroundColor: '#D9E8E3' }, memberActions: { flexDirection: 'row', gap: 9 }, detailActionsCompact: { marginHorizontal: 0, marginTop: 0, marginBottom: 8, gap: 11 }, detailActionButtonCompact: { minHeight: 56 }, messageButton: { minHeight: 52, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, messageText: { color: C.teal, fontSize: 11, fontWeight: '800' },
  hubHero: { overflow: 'hidden', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, hubCoverContent: { position: 'absolute', left: 16, right: 16, top: 14, bottom: 14, justifyContent: 'space-between' }, hubCoverTop: { flexDirection: 'row', justifyContent: 'flex-end' }, hubIdentity: { flexDirection: 'row', alignItems: 'center', gap: 11 }, hubIdentityCopy: { flex: 1 }, hubTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, hubTitle: { flexShrink: 1, color: C.surface, fontSize: 24, fontWeight: '900' }, hubMetaRow: { marginTop: 4, flexDirection: 'row', alignItems: 'center' }, hubMeta: { color: 'rgba(255,255,255,.74)', fontSize: 10 }, rolePill: { paddingHorizontal: 7, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, backgroundColor: 'rgba(255,255,255,.16)' }, rolePillText: { color: C.surface, fontSize: 8, fontWeight: '800' }, hubRecord: { paddingHorizontal: 17, paddingVertical: 15, flexDirection: 'row', justifyContent: 'space-between' }, hubRecordValue: { color: C.ink, fontSize: 20, fontWeight: '800' }, hubRecordLabel: { marginTop: 2, color: C.ink40, fontSize: 7, fontWeight: '800', letterSpacing: .6 }, formingNotice: { marginTop: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 13, backgroundColor: '#E5F0ED' }, noticeInvite: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, backgroundColor: C.surface }, hubTabsSticky: { marginHorizontal: -1, paddingTop: 10, paddingBottom: 7, backgroundColor: C.paper, zIndex: 5 }, hubTabs: { padding: 4, flexDirection: 'row', borderRadius: 13, backgroundColor: '#E5E9E3' }, hubTab: { flex: 1, minHeight: 40, paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, hubTabActive: { backgroundColor: C.optic, ...shadow }, hubTabText: { color: C.ink40, fontSize: 9, fontWeight: '800' }, hubTabTextActive: { color: C.ink }, inviteButton: { minHeight: 38, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, inviteButtonText: { color: C.teal, fontSize: 10, fontWeight: '800' }, rosterCard: { overflow: 'hidden', borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, rosterRow: { minHeight: 67, marginHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, rosterBorder: { borderTopWidth: 1, borderColor: C.line }, rosterAvatar: { width: 39, height: 39, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, rosterCopy: { flex: 1 }, rosterName: { color: C.ink, fontSize: 11, fontWeight: '800' }, rosterRating: { alignItems: 'flex-end' }, rosterRatingValue: { color: C.teal, fontSize: 16, fontWeight: '800' }, requestCard: { marginBottom: 11, padding: 14, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, requestHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, requestNote: { marginTop: 11, color: C.ink70, fontSize: 10, lineHeight: 16 }, requestActions: { marginTop: 13, flexDirection: 'row', gap: 8 }, declineButton: { minHeight: 40, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line }, declineText: { color: C.ink70, fontSize: 10, fontWeight: '800' }, acceptButton: { minHeight: 40, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 11, backgroundColor: C.optic }, emptyRequests: { paddingVertical: 55, alignItems: 'center' }, matchDate: { width: 48, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.optic }, matchMonth: { color: C.ink, fontSize: 7, fontWeight: '900' }, matchDay: { color: C.ink, fontSize: 20, fontWeight: '900' }, matchCopy: { flex: 1 }, matchLabel: { color: C.teal, fontSize: 7, fontWeight: '800', letterSpacing: .7 }, matchTitle: { marginVertical: 3, color: C.ink, fontSize: 13, fontWeight: '800' }, nextTeamMatch: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }, resultCard: { marginTop: 10, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, resultMark: { width: 34, height: 34, paddingTop: 9, borderRadius: 9, overflow: 'hidden', color: C.teal, backgroundColor: '#E5F0ED', textAlign: 'center', fontSize: 11, fontWeight: '900' }, resultScore: { color: C.teal, fontSize: 16, fontWeight: '900' }, activityCard: { overflow: 'hidden', borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, activityRow: { minHeight: 76, marginHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, activityIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, activityText: { color: C.ink70, fontSize: 11, lineHeight: 16 },
  wizardProgress: { marginBottom: 22, flexDirection: 'row' }, wizardStep: { position: 'relative', flex: 1, alignItems: 'center' }, wizardDot: { width: 27, height: 27, zIndex: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, wizardDotActive: { borderColor: C.optic, backgroundColor: C.optic }, wizardDotText: { color: C.ink40, fontSize: 8, fontWeight: '900' }, wizardDotTextActive: { color: C.ink }, wizardStepText: { maxWidth: 72, marginTop: 6, color: C.ink40, textAlign: 'center', fontSize: 7, fontWeight: '700' }, wizardStepTextActive: { color: C.ink, fontWeight: '900' }, wizardLine: { position: 'absolute', top: 13, left: '62%', right: '-38%', height: 1, backgroundColor: C.line }, wizardLineActive: { backgroundColor: C.optic }, stepIntro: { marginBottom: 18 }, stepTitle: { color: C.ink, fontSize: 23, lineHeight: 28, fontWeight: '900', letterSpacing: -.5 }, stepBody: { marginTop: 6, color: C.ink70, fontSize: 11, lineHeight: 17 }, selectedBaseCard: { minHeight: 82, marginBottom: 12, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 16, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' }, selectedBaseIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.surface }, selectedBaseCopy: { flex: 1 }, selectedBaseLabel: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, selectedBaseCity: { marginTop: 2, color: C.ink, fontSize: 15, fontWeight: '900' }, selectedBaseMeta: { marginTop: 2, color: C.ink40, fontSize: 9 }, baseRequired: { minHeight: 48, marginBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 13, backgroundColor: '#F7EAE6' }, baseRequiredText: { flex: 1, color: C.brick, fontSize: 9, fontWeight: '700' }, useCurrentBase: { minHeight: 58, marginBottom: 18, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, backgroundColor: C.optic }, useCurrentBaseCopy: { flex: 1 }, useCurrentBaseTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, useCurrentBaseMeta: { marginTop: 2, color: C.ink70, fontSize: 8 }, baseSearch: { minHeight: 52, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, baseSearchInput: { flex: 1, minHeight: 50, color: C.ink, fontSize: 12 }, baseResults: { marginTop: 9, overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, baseResult: { minHeight: 59, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 }, baseResultBorder: { borderTopWidth: 1, borderColor: C.line }, baseResultIcon: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#E5F0ED' }, baseResultCopy: { flex: 1 }, baseResultCity: { color: C.ink, fontSize: 11, fontWeight: '900' }, baseResultMeta: { marginTop: 2, color: C.ink40, fontSize: 8 }, baseEmpty: { minHeight: 92, alignItems: 'center', justifyContent: 'center' }, baseEmptyTitle: { marginBottom: 3, color: C.ink, fontSize: 11, fontWeight: '800' }, locationPrivacy: { marginTop: 12, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 13, backgroundColor: '#E5F0ED' }, locationPrivacyText: { flex: 1, color: C.ink70, fontSize: 9, lineHeight: 14 }, reviewCover: { overflow: 'hidden', borderRadius: 20 }, reviewCard: { marginTop: 12, overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, reviewRow: { minHeight: 82, paddingHorizontal: 13, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, reviewBorder: { borderTopWidth: 1, borderColor: C.line }, reviewIcon: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, reviewCopy: { flex: 1 }, reviewLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, reviewValue: { marginTop: 2, color: C.ink, fontSize: 11, fontWeight: '900' }, reviewMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 }, reviewEdit: { padding: 6, color: C.teal, fontSize: 9, fontWeight: '900' }, wizardActions: { marginTop: 22, flexDirection: 'row', gap: 9 }, wizardBack: { width: 92, minHeight: 53, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, wizardBackText: { color: C.ink70, fontSize: 11, fontWeight: '800' }, wizardPrimary: { flex: 1 },
  formPhoto: { marginBottom: 20, padding: 10, borderRadius: 20, backgroundColor: '#E5F0ED' }, formCoverPressable: { overflow: 'hidden', borderRadius: 15 }, previewCoverContent: { position: 'relative', flex: 1 }, previewCameraCover: { position: 'absolute', top: 11, right: 11, width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(8,24,22,0.52)' }, previewCoverBottom: { position: 'absolute', left: 13, right: 13, bottom: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, previewCrestWrapper: { position: 'relative' }, previewCrestCamera: { position: 'absolute', bottom: -4, right: -4, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 2, borderColor: '#E5F0ED', backgroundColor: C.optic }, previewCoverText: { flex: 1 }, previewCoverTitle: { color: C.surface, fontSize: 18, fontWeight: '900' }, previewCoverHint: { marginTop: 2, color: 'rgba(255,255,255,.76)', fontSize: 8 }, coverChoiceRow: { paddingHorizontal: 4, paddingTop: 11, paddingBottom: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }, coverChoiceActions: { alignItems: 'flex-end', gap: 4 }, formPhotoCopy: { flex: 1 }, formPhotoTitle: { color: C.ink, fontSize: 13, fontWeight: '800' }, photoActionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 4, paddingBottom: 6 }, photoButton: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, backgroundColor: C.surface }, photoButtonText: { color: C.teal, fontSize: 9, fontWeight: '800' }, gradientButton: { paddingHorizontal: 4, paddingVertical: 4 }, gradientButtonText: { color: C.ink40, fontSize: 8, fontWeight: '700' }, formField: { marginBottom: 15 }, formLabel: { marginBottom: 7, color: C.ink70, fontSize: 9, fontWeight: '800', letterSpacing: .8 }, formInput: { minHeight: 50, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: C.line, color: C.ink, backgroundColor: C.surface, fontSize: 12 }, formTextarea: { minHeight: 100, paddingTop: 13, textAlignVertical: 'top' }, levelOptions: { marginBottom: 17, flexDirection: 'row', gap: 7 }, levelOption: { minHeight: 38, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, levelOptionActive: { borderColor: C.ink, backgroundColor: C.ink }, levelOptionText: { color: C.ink70, fontSize: 8, fontWeight: '800' }, levelOptionTextActive: { color: C.surface }, visibilityOptions: { marginBottom: 17, flexDirection: 'row', gap: 8 }, visibilityOption: { minHeight: 82, flex: 1, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, visibilityOptionActive: { borderColor: C.ink, backgroundColor: C.ink }, visibilityCopy: { flex: 1 }, visibilityTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, visibilityTitleActive: { color: C.surface }, visibilityHelp: { marginTop: 4, color: C.ink40, fontSize: 8, lineHeight: 12 }, visibilityHelpActive: { color: 'rgba(255,255,255,.65)' }, formNotice: { marginBottom: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#E5F0ED' }, formNoticeText: { flex: 1, color: C.ink70, fontSize: 9, lineHeight: 14 }, saveButton: { minHeight: 53, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: C.optic }, saveButtonDisabled: { opacity: .62 },
  inviteProgress: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: '#E5F0ED' }, inviteProgressIcon: { width: 43, height: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface }, inviteProgressTitle: { color: C.ink, fontSize: 12, fontWeight: '900' }, invitePrivacy: { marginTop: 12, color: C.ink40, fontSize: 9, lineHeight: 14 }, searchingText: { paddingVertical: 24, color: C.ink40, textAlign: 'center', fontSize: 10 }, playerResults: { marginTop: 12, overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, playerResult: { minHeight: 70, marginHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, invitePlayerButton: { minHeight: 37, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, backgroundColor: C.optic }, invitePlayerButtonSent: { borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' }, invitePlayerText: { color: C.ink, fontSize: 9, fontWeight: '900' }, invitePlayerTextSent: { color: C.teal }, invitationCard: { marginBottom: 12, padding: 15, borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: C.surface, ...shadow }, invitationEyebrow: { marginBottom: 3, color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, invitationMeta: { marginTop: 13, paddingTop: 11, flexDirection: 'row', alignItems: 'center', gap: 4, borderTopWidth: 1, borderColor: C.line }, invitationExpiry: { marginTop: 5, color: C.ink40, fontSize: 8 },
  chatScreen: { flex: 1 }, chatHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }, onlineRow: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 4 }, onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.teal }, chatStatus: { color: C.ink40, fontSize: 8 }, chatRule: { height: 1, backgroundColor: C.line }, chatMessages: { flex: 1 }, chatContent: { flexGrow: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 16 }, chatTapArea: { flexGrow: 1 }, loadEarlierButton: { minHeight: 34, marginBottom: 12, alignSelf: 'center', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#E5F0ED' }, loadEarlierText: { color: C.teal, fontSize: 9, fontWeight: '800' }, chatDay: { marginBottom: 13, color: C.ink40, textAlign: 'center', fontSize: 7, fontWeight: '900', letterSpacing: .8 }, memberJoinedNotice: { marginVertical: 10, alignSelf: 'center', maxWidth: '90%', paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 14, backgroundColor: '#E5F0ED' }, memberJoinedText: { flexShrink: 1, color: C.teal, fontSize: 10, fontWeight: '800' }, memberJoinedTime: { color: C.ink40, fontSize: 8 }, messageRow: { marginTop: 12, flexDirection: 'row' }, messageRowMine: { justifyContent: 'flex-end' }, messageGrouped: { marginTop: 4 }, messageRowActive: { zIndex: 2 }, chatAvatar: { width: 31, height: 31, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, chatAvatarSpacer: { width: 31 }, messageBlock: { maxWidth: '90%', alignItems: 'flex-start' }, messageBlockMine: { alignItems: 'flex-end' }, sender: { marginLeft: 4, marginBottom: 3, color: C.ink40, fontSize: 8, fontWeight: '800' }, bubble: { flexShrink: 1, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 15, borderBottomLeftRadius: 4, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }, bubbleMine: { borderBottomLeftRadius: 15, borderBottomRightRadius: 4, borderColor: C.teal, backgroundColor: C.teal }, deletedBubble: { borderColor: C.line, backgroundColor: C.paper }, deletedMessageRow: { flexDirection: 'row', alignItems: 'center', gap: 5 }, deletedMessageText: { color: C.ink40, fontSize: 10, fontStyle: 'italic' }, bubbleText: { color: C.ink, fontSize: 11, lineHeight: 16 }, bubbleTextMine: { color: C.surface }, messageTime: { marginTop: 3, marginLeft: 4, color: C.ink40, fontSize: 7 }, messageTimeMine: { marginLeft: 0, marginRight: 4 }, reactionSummary: { marginTop: -3, marginLeft: 5, flexDirection: 'row', flexWrap: 'wrap', gap: 3 }, reactionSummaryMine: { marginLeft: 0, marginRight: 5, justifyContent: 'flex-end' }, reactionChip: { minHeight: 24, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, reactionChipMine: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, reactionEmoji: { fontSize: 11 }, reactionCount: { color: C.ink70, fontSize: 8, fontWeight: '800' }, messageActions: { marginTop: 6, padding: 7, maxWidth: 290, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, messageActionsMine: { alignItems: 'flex-end' }, reactionPicker: { flexDirection: 'row', gap: 2 }, reactionOption: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper }, reactionOptionText: { fontSize: 16 }, messageActionButtons: { marginTop: 6, flexDirection: 'row', gap: 5 }, messageActionButton: { minHeight: 31, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 9, backgroundColor: C.paper }, messageActionText: { color: C.ink70, fontSize: 8, fontWeight: '800' }, editingBanner: { paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1, borderColor: C.line, backgroundColor: '#E5F0ED' }, editingCopy: { flex: 1 }, editingTitle: { color: C.teal, fontSize: 8, fontWeight: '900' }, editingPreview: { marginTop: 2, color: C.ink70, fontSize: 9 }, composer: { paddingHorizontal: 12, paddingTop: 9, paddingBottom: 9, flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.surface }, addAttachment: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, composerInput: { minHeight: 43, flex: 1, paddingLeft: 13, paddingRight: 4, flexDirection: 'row', alignItems: 'center', borderRadius: 22, backgroundColor: C.paper }, chatInput: { flex: 1, maxHeight: 92, paddingVertical: 10, color: C.ink, fontSize: 11 }, sendButton: { width: 35, height: 35, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, sendDisabled: { opacity: .35 },
  highlightedMessageBubble: { borderWidth: 2, borderColor: C.optic },
  chatPinnedBanner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12 },
  chatPinnedBannerCopy: { marginLeft: 10, flex: 1 },
  chatPinnedBannerTitle: { color: C.teal, fontSize: 10, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  chatPinnedBannerText: { color: C.ink, fontSize: 12, marginTop: 2 },
  chatAttachmentImage: { width: 210, height: 150, marginBottom: 7, borderRadius: 10 }, attachmentFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 7 }, attachmentFallbackText: { color: C.ink40, fontSize: 8, fontWeight: '800' }, chatAttachmentVideo: { width: 230, height: 150, marginBottom: 7, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000' }, typingRow: { marginTop: 9, alignItems: 'flex-start' }, typingBubble: { width: 62, height: 38, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 19, borderBottomLeftRadius: 19, transformOrigin: 'left bottom' }, typingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.ink70 }, autoMatchMessage: { marginTop: 17 }, autoMatchLabel: { marginBottom: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }, autoMatchLabelText: { color: C.ink40, fontSize: 7, fontWeight: '700' }, liveCard: { overflow: 'hidden', borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: C.surface, ...shadow }, liveCardHead: { paddingHorizontal: 13, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, liveBadge: { paddingHorizontal: 7, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 7, backgroundColor: '#F7EAE6' }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.brick }, liveBadgeText: { color: C.brick, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, liveGame: { color: C.ink40, fontSize: 7, fontWeight: '800', letterSpacing: .6 }, livePlayers: { marginTop: 9, color: C.ink40, textAlign: 'center', fontSize: 8 }, liveScoreRow: { minHeight: 75, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }, liveTeam: { width: 65, alignItems: 'center' }, liveTeamAway: { alignItems: 'center' }, liveTag: { color: C.teal, fontSize: 8, fontWeight: '900' }, liveTeamName: { marginTop: 3, color: C.ink70, textAlign: 'center', fontSize: 7 }, liveScore: { width: 38, color: C.ink, textAlign: 'center', fontSize: 29, fontWeight: '900' }, liveDash: { color: C.ink40, fontSize: 16 }, cardServing: { marginHorizontal: 12, marginBottom: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 9, backgroundColor: '#E5F0ED' }, cardServingText: { color: C.teal, fontSize: 7, fontWeight: '800' }, liveCardFoot: { minHeight: 43, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderColor: C.line, backgroundColor: '#F8F9F5' }, liveLastPlay: { flex: 1, color: C.ink40, fontSize: 7 }, watchLive: { flexDirection: 'row', alignItems: 'center', gap: 3 }, watchLiveText: { color: C.ink, fontSize: 8, fontWeight: '900' },
  mediaBubble: { paddingHorizontal: 3, paddingVertical: 3, overflow: 'hidden', borderColor: 'transparent', backgroundColor: 'transparent' },
  mediaBubbleMine: { borderColor: 'transparent', backgroundColor: 'transparent' },
  mediaProgress: { position: 'absolute', right: 9, bottom: 9, width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: 'rgba(14,35,33,.62)' },
  chatAttachmentGif: { height: 174, backgroundColor: 'transparent' },
  chatAttachmentMediaOnly: { marginBottom: 0 },
  mediaPreviewBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,14,13,.94)' },
  mediaPreviewClose: { position: 'absolute', zIndex: 2, top: 54, right: 18, width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: 'rgba(255,255,255,.14)' },
  mediaPreviewSave: { right: 72 },
  chatOpening: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mediaPreviewImage: { width: '94%', height: '76%' },
  mediaPreviewVideo: { width: '94%', height: '76%', marginBottom: 0, borderRadius: 0 },
  messageMetaRow: { marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 5 },
  messageMetaRowMine: { justifyContent: 'flex-end' },
  pinnedMessageBadge: { paddingHorizontal: 5, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 6, backgroundColor: '#E5F0ED' },
  pinnedMessageBadgeText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .4 },
  chatInfoScreen: { flex: 1, backgroundColor: C.paper },
  unreadBadgeMuted: { backgroundColor: C.ink40 },
  chatHeaderIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatInfoCount: { minWidth: 25, height: 25, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.optic },
  chatInfoCountText: { color: '#0E2321', fontSize: 8, fontWeight: '900' },
  chatInfoLoading: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 8 },
  chatInfoEmpty: { minHeight: 88, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 16, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed', backgroundColor: C.surface },
  chatInfoEmptyIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#E5F0ED' },
  pinnedList: { overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  pinnedCard: { minHeight: 82, marginHorizontal: 13, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: C.line },
  pinnedCardIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' },
  pinnedCardCopy: { flex: 1 },
  pinnedCardSender: { color: C.teal, fontSize: 8, fontWeight: '900' },
  pinnedCardText: { marginTop: 3, color: C.ink, fontSize: 11, lineHeight: 16 },
  pinnedCardTime: { marginTop: 4, color: C.ink40, fontSize: 7 },
  pinnedCardAction: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: C.paper },
  chatInfoMembers: { overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  chatInfoMember: { minHeight: 65, marginHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberMoreButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: C.paper },
  memberMessageButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#E5F0ED' },
  memberManagementBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,14,13,.58)' },
  memberManagementSheet: { overflow: 'hidden', paddingHorizontal: 16, paddingTop: 8, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: C.surface, ...shadow },
  memberManagementHead: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11 },
  memberManagementTitle: { color: C.ink, fontSize: 17, fontWeight: '900' },
  memberManagementCurrent: { marginTop: 3, color: C.ink40, fontSize: 9, fontWeight: '700' },
  memberManagementScroll: { flexShrink: 1 },
  memberManagementScrollContent: { paddingTop: 8, paddingBottom: 12 },
  memberRoleSection: { marginTop: 4 },
  memberManagementLabel: { marginBottom: 6, color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 },
  memberRoleOption: { minHeight: 68, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderColor: C.line },
  memberRoleOptionSelected: { marginHorizontal: -4, paddingHorizontal: 14, borderTopColor: 'transparent', borderRadius: 14, backgroundColor: '#E5F0ED' },
  memberRoleOptionPressed: { backgroundColor: C.paper },
  memberRoleIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.paper },
  memberRoleIconSelected: { backgroundColor: C.surface },
  memberRoleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberRoleTitle: { color: C.ink, fontSize: 11, fontWeight: '900' },
  memberRoleDescription: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 },
  currentRolePill: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, backgroundColor: C.teal },
  currentRolePillText: { color: C.surface, fontSize: 5, fontWeight: '900', letterSpacing: .45 },
  memberSafetyNote: { marginTop: 12, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, backgroundColor: '#E5F0ED' },
  memberSafetyText: { flex: 1, color: C.ink70, fontSize: 8, lineHeight: 13 },
  memberManagementFooter: { paddingTop: 10, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  removeMemberButton: { minHeight: 58, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: '#F7EAE6' },
  removeMemberButtonPressed: { opacity: .82, transform: [{ scale: .99 }] },
  removeMemberIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.surface },
  removeMemberText: { color: C.brick, fontSize: 11, fontWeight: '900' },
  removeMemberHelp: { marginTop: 2, color: C.ink40, fontSize: 7 },
  seenReceipt: { maxWidth: 235, minHeight: 24, marginTop: 3, marginRight: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  seenAvatars: { flexDirection: 'row', alignItems: 'center' },
  seenAvatar: { borderWidth: 1.5, borderColor: C.surface },
  seenAvatarOverlap: { marginLeft: -6 },
  seenNames: { flexShrink: 1, color: C.ink40, fontSize: 7, fontWeight: '700' },
  peopleModalBackdrop: { flex: 1, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,14,13,.56)' },
  peopleModalCard: { width: '100%', maxWidth: 420, maxHeight: '72%', padding: 16, borderRadius: 24, backgroundColor: C.surface, ...shadow },
  peopleModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  peopleModalTitle: { color: C.ink, fontSize: 18, fontWeight: '900' },
  peopleModalClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: C.paper },
  peopleModalSummary: { marginTop: 3, marginBottom: 10, color: C.ink40, fontSize: 9 },
  peopleModalList: { maxHeight: 380 },
  peopleModalListContent: { paddingBottom: 3 },
  peopleModalRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 11, borderTopWidth: 1, borderColor: C.line },
  peopleModalName: { flex: 1, color: C.ink, fontSize: 12, fontWeight: '800' },
  peopleModalEmoji: { fontSize: 20 },
  chatMenuTitle: { flex: 1, marginHorizontal: 8 },
  backButton: { width: 32, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  chatMenuRowPressed: { backgroundColor: C.paper },
  interactionBackdrop: { flex: 1, paddingHorizontal: 18, justifyContent: 'center', backgroundColor: 'rgba(5,14,13,.58)' },
  floatingReactionPicker: { minHeight: 54, marginBottom: 10, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 1, borderRadius: 28, backgroundColor: C.surface, ...shadow },
  floatingReactionOption: { width: 43, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23 },
  floatingReactionOptionActive: { backgroundColor: '#E5F0ED', transform: [{ scale: 1.18 }] },
  floatingReactionText: { fontSize: 25 },
  // The avatar sits beside the bubble itself, so controls and reactions
  // opening underneath never push it down.
  bubbleActionRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  messageExtras: { maxWidth: '100%', alignItems: 'flex-start' },
  messageExtrasMine: { alignItems: 'flex-end' },
  messageIndent: { marginLeft: 38 },
  bubbleActionRowMine: { flexDirection: 'row-reverse' },
  quickMessageActions: { maxWidth: '100%', marginTop: 2, flexDirection: 'row', alignItems: 'center' },
  quickMessageAction: { width: 36, minWidth: 26, flexShrink: 1, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  quickMessageActionPressed: { backgroundColor: 'rgba(28,107,102,.14)' },
  quickMessageEmoji: { fontSize: 22 },
  messageActionSheet: { position: 'absolute', left: 10, right: 10, bottom: 10, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12, borderRadius: 24, backgroundColor: C.surface, ...shadow },
  actionSheetHandle: { width: 38, height: 4, alignSelf: 'center', marginBottom: 10, borderRadius: 2, backgroundColor: C.line },
  actionSheetTitle: { marginBottom: 5, color: C.ink, fontSize: 16, fontWeight: '900' },
  actionSheetReactionPicker: { alignSelf: 'center', marginTop: 5, marginBottom: 8, backgroundColor: C.paper, shadowOpacity: 0, elevation: 0 },
  actionSheetRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 11, borderTopWidth: 1, borderColor: C.line },
  actionSheetIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: C.paper },
  actionSheetIconDanger: { backgroundColor: '#F7EAE6' },
  actionSheetCopy: { flex: 1 },
  actionSheetRowTitle: { color: C.ink, fontSize: 12, fontWeight: '900' },
  actionSheetRowText: { marginTop: 2, color: C.ink40, fontSize: 8 },
  actionSheetDangerText: { color: C.brick },
  actionSheetCancel: { minHeight: 48, marginTop: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: C.paper },
  actionSheetCancelText: { color: C.ink70, fontSize: 11, fontWeight: '900' },
  scorerPickerBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,14,13,.58)' },
  scorerPickerSheet: { maxHeight: '82%', paddingHorizontal: 17, paddingTop: 9, paddingBottom: 18, borderTopLeftRadius: 27, borderTopRightRadius: 27, backgroundColor: C.surface, ...shadow },
  scorerPickerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scorerPickerTitle: { marginTop: 2, color: C.ink, fontSize: 20, fontWeight: '900' },
  scorerPickerHelp: { marginTop: 8, marginBottom: 8, color: C.ink70, fontSize: 9, lineHeight: 14 },
  scorerPickerList: { maxHeight: 390 },
  scorerPickerRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderColor: C.line },
  scorerPickerRowSelected: { marginHorizontal: -8, paddingHorizontal: 8, borderTopColor: 'transparent', borderRadius: 14, backgroundColor: '#E5F0ED' },
  scorerPickerName: { color: C.ink, fontSize: 11, fontWeight: '900' },
  scorerPickerBusy: { minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  scorerHeadActions: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  voiceScoreButton: { paddingHorizontal: 7, minHeight: 27, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper },
  voiceScoreButtonActive: { borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' },
  voiceScoreText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .3 },
  liveHeaderBadge: { paddingHorizontal: 9, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 9, backgroundColor: '#F7EAE6' }, liveHeaderText: { color: C.brick, fontSize: 8, fontWeight: '900' }, scoreHero: { padding: 18, alignItems: 'center', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: C.ink }, scoreVenue: { color: 'rgba(255,255,255,.6)', fontSize: 9 }, scoreGame: { marginTop: 8, color: C.optic, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, scoreTeams: { width: '100%', marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scoreTeam: { width: 82, alignItems: 'center' }, scoreCrest: { width: 49, height: 49, borderRadius: 17, borderBottomLeftRadius: 7, borderBottomRightRadius: 7, alignItems: 'center', justifyContent: 'center' }, scoreCrestText: { color: C.surface, fontSize: 9, fontWeight: '900' }, scoreTeamName: { marginTop: 7, color: C.surface, textAlign: 'center', fontSize: 9, fontWeight: '800' }, scoreNumbers: { flexDirection: 'row', alignItems: 'center' }, scoreNumber: { width: 48, color: C.surface, textAlign: 'center', fontSize: 43, fontWeight: '900' }, scoreSeparator: { color: 'rgba(255,255,255,.35)', fontSize: 24 }, servingRow: { marginTop: 17, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.1)' }, servingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.optic }, servingText: { color: C.surface, fontSize: 8, fontWeight: '800' }, scorerPanel: { marginTop: 13, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: C.surface }, scorerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scorerTitle: { color: C.ink, fontSize: 14, fontWeight: '800' }, scorerBadge: { paddingHorizontal: 7, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, backgroundColor: '#E5F0ED' }, scorerBadgeText: { color: C.teal, fontSize: 7, fontWeight: '900' }, scorerHelp: { marginTop: 9, color: C.ink40, fontSize: 9, lineHeight: 14 }, rallyButtons: { marginTop: 12, flexDirection: 'row', gap: 8 }, rallyButton: { minHeight: 70, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, rallyButtonServing: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, rallyTag: { color: C.teal, fontSize: 8, fontWeight: '900' }, rallyButtonText: { marginTop: 3, color: C.ink, fontSize: 10, fontWeight: '800' }, rallyServingText: { marginTop: 4, color: C.brick, fontSize: 6, fontWeight: '900', letterSpacing: .7 }, switchServeButton: { minHeight: 50, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, backgroundColor: C.teal, ...shadow }, switchServeText: { color: C.surface, fontSize: 11, fontWeight: '900', letterSpacing: .3 }, liveInfoCard: { marginTop: 13, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, syncBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 }, syncText: { color: C.teal, fontSize: 8, fontWeight: '800' }, liveActivity: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, liveActivityIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, liveNotice: { marginTop: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 13, backgroundColor: '#E5F0ED' }, liveNoticeText: { flex: 1, color: C.ink70, fontSize: 9, lineHeight: 14 },
  viewerNotice: { marginTop: 13, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, viewerBadge: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7, backgroundColor: C.paper }, viewerBadgeText: { color: C.ink40, fontSize: 7, fontWeight: '900' }, boxScore: { overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, boxScoreRow: { minHeight: 45, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' }, boxScoreBorder: { borderTopWidth: 1, borderColor: C.line }, boxTeam: { flex: 1, color: C.ink, fontSize: 9, fontWeight: '800' }, boxValue: { width: 35, color: C.ink, textAlign: 'center', fontSize: 13, fontWeight: '900' }, boxHeader: { color: C.ink40, fontSize: 7, letterSpacing: .5 }, boxCurrent: { color: C.teal, backgroundColor: '#E5F0ED', borderRadius: 6, overflow: 'hidden', lineHeight: 25 }, boxWon: { color: C.teal }, boxFootnote: { paddingHorizontal: 12, paddingBottom: 9, color: C.ink40, fontSize: 7 }, scorerAssignment: { marginBottom: 11, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: C.surface }, scorerAssignmentHead: { marginBottom: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, openScorerButton: { minHeight: 43, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: C.optic },
  detailIdentity: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  detailIdentityCopy: { flex: 1 },
  hubIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mainPhotoCard: { minHeight: 112, marginBottom: 13, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  mainPhotoCopy: { flex: 1 },
  photoActionRow: { marginTop: 9, flexDirection: 'row', alignItems: 'center', gap: 9 },
  removePhotoButton: { paddingHorizontal: 5, paddingVertical: 7 },
  removePhotoText: { color: C.brick, fontSize: 8, fontWeight: '800' },
  imageControlPanel: { marginBottom: 9, overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  imageControlRow: { minHeight: 66, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  imageControlBorder: { borderTopWidth: 1, borderColor: C.line },
  imageControlIcon: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#E5F0ED' },
  imageControlCopy: { flex: 1, minWidth: 0 },
  imageControlTitle: { color: C.ink, fontSize: 10, fontWeight: '900' },
  imageControlMeta: { marginTop: 2, color: C.ink40, fontSize: 7 },
  imageControlPrimary: { minHeight: 32, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#E5F0ED' },
  imageControlPrimaryText: { color: C.teal, fontSize: 8, fontWeight: '900' },
  imageControlSecondary: { minHeight: 32, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  imageControlUndoText: { color: C.ink70, fontSize: 8, fontWeight: '800' },
  imageControlRemoveText: { color: C.brick, fontSize: 8, fontWeight: '800' },
  imageSaveHint: { marginBottom: 17, paddingHorizontal: 3, color: C.ink40, fontSize: 8, lineHeight: 12 },
  reviewPreviewHead: { marginBottom: 9, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 },
  reviewPreviewEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .8 },
  reviewPreviewTitle: { marginTop: 2, color: C.ink, fontSize: 14, fontWeight: '900' },
  reviewPreviewMode: { paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 9, backgroundColor: '#E5F0ED' },
  reviewPreviewModeText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .45 },
  reviewPreviewTop: { padding: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewPreviewBottom: { position: 'absolute', left: 14, right: 14, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewPreviewCopy: { flex: 1, minWidth: 0 },
  reviewPreviewName: { color: C.surface, fontSize: 22, lineHeight: 26, fontWeight: '900', letterSpacing: -.4 },
  reviewAbout: { marginTop: 11, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  reviewSectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewSectionLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .8 },
  reviewEditButton: { minHeight: 32, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 9, backgroundColor: '#E5F0ED' },
  reviewAboutText: { marginTop: 8, color: C.ink70, fontSize: 10, lineHeight: 16 },
  reviewReady: { marginTop: 12, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 14, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' },
  reviewReadyCopy: { flex: 1 },
  reviewReadyTitle: { color: C.ink, fontSize: 10, fontWeight: '900' },
  reviewReadyText: { marginTop: 3, color: C.ink70, fontSize: 8, lineHeight: 13 },
  pendingRequestActions: { marginHorizontal: 14, marginTop: 10, flexDirection: 'row', gap: 8 },
  requestSentStatus: { minHeight: 42, flex: 1, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 11, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' },
  requestSentStatusLarge: { minHeight: 52, borderRadius: 14 },
  requestSentStatusText: { color: C.teal, fontSize: 11, fontWeight: '900' },
  cancelRequestButton: { minHeight: 42, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 11, borderWidth: 1, borderColor: '#E5B8AE', backgroundColor: '#F7EAE6' },
  cancelRequestLarge: { minHeight: 52, flex: 1, borderRadius: 14 },
  cancelRequestText: { color: C.brick, fontSize: 11, fontWeight: '900' },
  joinRequestTeam: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  joinRequestTeamCopy: { flex: 1, minWidth: 0 },
  joinRequestTeamLabel: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .75 },
  joinRequestTeamName: { marginTop: 2, color: C.ink, fontSize: 16, fontWeight: '900' },
  joinRequestProfile: { marginTop: 13, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, backgroundColor: '#E5F0ED' },
  joinRequestAvatar: { borderWidth: 3, borderColor: C.surface },
  joinRequestProfileCopy: { flex: 1, minWidth: 0 },
  joinRequestProfileLabel: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 },
  joinRequestProfileName: { marginTop: 2, color: C.ink, fontSize: 14, fontWeight: '900' },
  joinRequestIntroHead: { marginTop: 23, marginBottom: 8, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  joinRequestHint: { marginTop: -3, color: C.ink40, fontSize: 9 },
  joinRequestCount: { color: C.ink40, fontSize: 8, fontWeight: '700' },
  joinRequestInput: { minHeight: 156, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 16, borderWidth: 1, borderColor: C.line, color: C.ink, backgroundColor: C.surface, fontSize: 12, lineHeight: 19 },
  joinRequestPrivacy: { marginTop: 12, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 13, backgroundColor: '#E5F0ED' },
  joinRequestPrivacyText: { flex: 1, color: C.ink70, fontSize: 9, lineHeight: 14 },
  joinRequestActions: { marginTop: 18, flexDirection: 'row', gap: 9 },
  joinRequestCancel: { minHeight: 52, flex: .7, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  joinRequestSubmit: { minHeight: 52, flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: C.optic },
  joinRequestSubmitDisabled: { opacity: .45 },
  requestTimeRow: { marginBottom: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  requestTimeLabel: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .75 },
  requestTime: { color: C.ink40, fontSize: 8, fontWeight: '700' },
  requestAvatar: { borderWidth: 2, borderColor: '#BFD8D2' },
  requestName: { color: C.ink, fontSize: 13, fontWeight: '900' },
  requestAccount: { marginTop: 2, color: C.ink40, fontSize: 8 },
  requestFacts: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  requestFact: { minHeight: 31, maxWidth: '100%', paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, backgroundColor: '#E5F0ED' },
  requestFactText: { flexShrink: 1, color: C.ink70, fontSize: 8, fontWeight: '700' },
  requestMessage: { marginTop: 12, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper },
  requestMessageCopy: { flex: 1 },
  requestMessageLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .6 },
  requestNoteCompact: { marginTop: 3, color: C.ink70, fontSize: 10, lineHeight: 16 },
  requestNoteEmpty: { color: C.ink40, fontStyle: 'italic' },
  chatSafetyScreen: { flex: 1, backgroundColor: C.paper },
  chatSafetyContent: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 38, paddingBottom: 38 },
  chatSafetyShield: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: C.optic },
  chatSafetyTitle: { maxWidth: 330, marginTop: 22, color: C.ink, fontSize: 29, lineHeight: 34, fontWeight: '900', letterSpacing: -.7 },
  chatSafetyBody: { maxWidth: 390, marginTop: 10, color: C.ink70, fontSize: 12, lineHeight: 19 },
  chatSafetyRules: { marginTop: 24, overflow: 'hidden', borderRadius: 19, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  chatSafetyRule: { minHeight: 82, marginHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderTopWidth: 1, borderColor: C.line },
  chatSafetyRuleIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' },
  chatSafetyRuleTitle: { color: C.ink, fontSize: 11, fontWeight: '900' },
  chatSafetyRuleBody: { marginTop: 3, color: C.ink40, fontSize: 9, lineHeight: 14 },
  chatSafetyPrimary: { minHeight: 56, marginTop: 22, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, backgroundColor: C.optic },
  chatSafetyPrimaryText: { color: '#0E2321', fontSize: 12, fontWeight: '900' },
  chatSafetySecondary: { minHeight: 48, marginTop: 7, alignItems: 'center', justifyContent: 'center' },
  chatSafetySecondaryText: { color: C.ink70, fontSize: 10, fontWeight: '800' },
  chatSafetyFoot: { marginTop: 8, color: C.ink40, textAlign: 'center', fontSize: 8, lineHeight: 13 },
  chatSafetyBanner: { minHeight: 38, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderBottomWidth: 1, borderColor: C.line, backgroundColor: '#E5F0ED' },
  chatSafetyBannerText: { flexShrink: 1, color: C.ink70, fontSize: 8, fontWeight: '700' },
  reportBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,14,13,.58)' },
  reportSheet: { maxHeight: '90%', paddingHorizontal: 17, paddingTop: 9, paddingBottom: 18, borderTopLeftRadius: 27, borderTopRightRadius: 27, backgroundColor: C.surface, ...shadow },
  reportHead: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 10 },
  reportHeadIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#F7EAE6' },
  reportTitle: { color: C.ink, fontSize: 17, fontWeight: '900' },
  reportSubtitle: { marginTop: 2, color: C.ink40, fontSize: 8, lineHeight: 12 },
  reportScroll: { flexShrink: 1 },
  reportContent: { paddingTop: 8, paddingBottom: 12 },
  reportLabel: { marginTop: 9, marginBottom: 7, color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 },
  reportReasons: { overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: C.line },
  reportReason: { minHeight: 49, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  reportReasonActive: { borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' },
  reportReasonText: { flex: 1, color: C.ink70, fontSize: 10, fontWeight: '800' },
  reportReasonTextActive: { color: C.ink },
  reportInput: { minHeight: 92, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 14, borderWidth: 1, borderColor: C.line, color: C.ink, backgroundColor: C.paper, fontSize: 10, lineHeight: 16, textAlignVertical: 'top' },
  reportPrivacy: { marginTop: 9, color: C.ink40, fontSize: 8, lineHeight: 13 },
  reportSubmit: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 15, backgroundColor: C.brick },
  reportSubmitText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  unblockButton: { minHeight: 35, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#E5F0ED' },
  unblockButtonText: { color: C.teal, fontSize: 8, fontWeight: '900' },
  chatInfoSafetyNote: { marginTop: 12, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 13, backgroundColor: '#E5F0ED' },
  chatInfoSafetyText: { flex: 1, color: C.ink70, fontSize: 8, lineHeight: 13 },
});
const darkStyles = {
  ...createDarkStyleSheet(lightStyles),
  chatSafetyPrimaryText: lightStyles.chatSafetyPrimaryText,
};
let styles = lightStyles;
