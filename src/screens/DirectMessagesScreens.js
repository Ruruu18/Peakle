import Modal from '../components/ResponsiveModal';
import { webDialog } from '../utils/webLayout';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { DEMO_MODE } from '../config/demoMode';
import { DEMO_CONVERSATION_ID, DEMO_DIRECT_MESSAGE_DRIP } from '../config/demoData';
import { PRIVATE_MESSAGES_ENABLED } from '../config/features';
import ScrollView from '../components/FocusResetScrollView';
import ProfilePhoto from '../components/ProfilePhoto';
import { useAuth } from '../context/AuthContext';
import { DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import {
  blockChatUser,
  getChatSafetyStatus,
  acknowledgeChatSafety,
  listTeamConversationSummaries,
  listTeams,
} from '../services/database';
import { listMyCommunityChats } from '../services/communityChat';
import {
  findDirectConversation,
  followPlayer,
  getDirectConversation,
  getDirectMessagePermission,
  getDirectMessage,
  listDirectConversations,
  listFollowingPlayers,
  listPrivateConnections,
  listDirectMessages,
  markDirectConversationRead,
  reportDirectMessage,
  respondDirectMessageRequest,
  searchDirectMessageCandidates,
  sendDirectMessage,
  startDirectConversation,
  toggleDirectMessageReaction,
} from '../services/directMessages';

const LIGHT_C = {
  ink: '#0E2321',
  paper: '#F3F5EF',
  surface: '#FFFFFF',
  optic: '#D6E94A',
  teal: '#1C6B66',
  brick: '#B6472E',
  ink70: '#3C4A45',
  ink40: '#7C8983',
  line: '#DDE3DA',
  tealWash: '#E5F0ED',
  gold: '#D5A928',
};
const DARK_C = {
  ...LIGHT_C,
  ...DARK_CONTENT_COLORS,
  paper: '#0E2321',
  surface: '#17302D',
  tealWash: '#203B37',
};
const TYPING_IDLE_MS = 1400;
const TYPING_HEARTBEAT_MS = 900;
const TYPING_EXPIRY_MS = 2600;
const EMPTY_INBOX_SNAPSHOT = Object.freeze({
  directConversations: [],
  privateConnections: [],
  followingPlayers: [],
  teams: [],
  teamSummaries: {},
});
const inboxCache = new Map();

// Maps player_status values to indicator colours (mirrors ProfileScreen PRESENCE_OPTIONS)
const PRESENCE_DOT_COLOR = {
  free: '#68B96B',
  away: '#D49A32',
  in_play: '#2F80ED',
};
const DIRECT_REACTION_OPTIONS = ['👍', '❤️', '😂', '🔥', '👏', '🎉'];
const REPORT_REASONS = [
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate or discrimination'],
  ['sexual_content', 'Sexual content'],
  ['violence', 'Threats or violence'],
  ['spam', 'Spam or scam'],
  ['privacy', 'Private information'],
  ['child_safety', 'Child safety concern'],
  ['other', 'Something else'],
];

const formatConversationTime = (createdAt) => {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const playerFromRoute = (player) => player ? {
  id: player.id,
  name: player.name || player.display_name || 'Peakle player',
  avatar: player.avatar || player.avatar_url || null,
  area: player.area || player.home_area || null,
} : null;

function Icon({ name, size = 20, color }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function useSkeletonPulse() {
  const pulse = useRef(new Animated.Value(0.42)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.9, duration: 720, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0.42, duration: 720, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse]);
  return pulse;
}

function SkeletonBlock({ pulse, colors, style }) {
  return <Animated.View style={[styles.skeletonBlock, { backgroundColor: colors.line, opacity: pulse }, style]} />;
}

function InboxLoadingSkeleton({ colors }) {
  const pulse = useSkeletonPulse();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.inboxSkeleton}>
      <SkeletonBlock pulse={pulse} colors={colors} style={styles.skeletonSectionLabel} />
      <View style={[styles.conversationList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {[0, 1, 2, 3].map((item) => (
          <View key={item} style={[styles.skeletonConversationRow, { borderColor: colors.line }, item === 3 && styles.conversationRowLast]}>
            <SkeletonBlock pulse={pulse} colors={colors} style={styles.skeletonAvatar} />
            <View style={styles.skeletonConversationCopy}>
              <View style={styles.skeletonConversationTop}>
                <SkeletonBlock pulse={pulse} colors={colors} style={[styles.skeletonLine, styles.skeletonName, item % 2 === 1 && styles.skeletonNameShort]} />
                <SkeletonBlock pulse={pulse} colors={colors} style={styles.skeletonTime} />
              </View>
              <SkeletonBlock pulse={pulse} colors={colors} style={[styles.skeletonLine, styles.skeletonPreview, item % 2 === 0 && styles.skeletonPreviewLong]} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function ChatLoadingSkeleton({ colors }) {
  const pulse = useSkeletonPulse();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.chatSkeleton}>
      <View style={[styles.skeletonEncryption, { borderColor: colors.line }]}>
        <SkeletonBlock pulse={pulse} colors={colors} style={styles.skeletonEncryptionLine} />
      </View>
      <View style={styles.skeletonMessages}>
        <View style={styles.skeletonMessageRow}>
          <SkeletonBlock pulse={pulse} colors={colors} style={styles.skeletonMessageAvatar} />
          <SkeletonBlock pulse={pulse} colors={colors} style={styles.skeletonBubbleWide} />
        </View>
        <View style={[styles.skeletonMessageRow, styles.skeletonMessageMine]}>
          <SkeletonBlock pulse={pulse} colors={colors} style={styles.skeletonBubbleMine} />
        </View>
        <View style={styles.skeletonMessageRow}>
          <View style={styles.skeletonMessageAvatar} />
          <SkeletonBlock pulse={pulse} colors={colors} style={styles.skeletonBubbleShort} />
        </View>
      </View>
      <View style={[styles.skeletonComposer, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <SkeletonBlock pulse={pulse} colors={colors} style={styles.skeletonComposerInput} />
        <SkeletonBlock pulse={pulse} colors={colors} style={styles.skeletonComposerButton} />
      </View>
    </View>
  );
}

function ScreenHeader({ eyebrow, title, onBack, action, colors }) {
  return (
    <>
      <View style={styles.header}>
        {onBack ? <Pressable accessibilityLabel="Go back" hitSlop={8} onPress={onBack} style={[styles.iconButton, { borderColor: colors.line, backgroundColor: colors.surface }]}><Icon name="arrow-back" size={19} color={colors.ink} /></Pressable> : null}
        <View style={styles.headerCopy}><Text style={[styles.eyebrow, { color: colors.teal }]}>{eyebrow}</Text><Text style={[styles.headerTitle, { color: colors.ink }]}>{title}</Text></View>
        {action}
      </View>
      <View style={[styles.rule, { backgroundColor: colors.line }]} />
    </>
  );
}

function ConversationRow({ conversation, currentUserId, onPress, colors, isLast = false }) {
  const incomingRequest = conversation.status === 'pending' && conversation.requesterId !== currentUserId;
  const outboundRequest = conversation.status === 'pending' && conversation.requesterId === currentUserId;
  const blocked = conversation.blockedByMe || conversation.blockedMe;
  const preview = blocked
    ? 'Private messaging unavailable'
    : incomingRequest
      ? 'Wants to message you'
      : outboundRequest
        ? 'Waiting for acceptance'
        : conversation.lastBody || 'Start the conversation';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.conversationRow, { borderColor: colors.line }, isLast && styles.conversationRowLast, pressed && styles.pressed]}>
      <View>
        <ProfilePhoto photo={conversation.peer.avatar} name={conversation.peer.name} size={52} />
        {conversation.status === 'accepted' && !blocked ? <View style={[styles.privateBadge, { backgroundColor: colors.optic }]}><Icon name="lock-closed" size={9} color="#0E2321" /></View> : null}
      </View>
      <View style={styles.conversationCopy}>
        <View style={styles.conversationNameRow}>
          <Text numberOfLines={1} style={[styles.conversationName, { color: colors.ink }]}>{conversation.peer.name}</Text>
          <Text style={[styles.conversationTime, { color: colors.ink40 }]}>{formatConversationTime(conversation.lastMessageAt)}</Text>
        </View>
        <View style={styles.conversationPreviewRow}>
          <Text numberOfLines={1} style={[styles.conversationPreview, { color: incomingRequest ? colors.teal : colors.ink40 }, incomingRequest && styles.requestPreview]}>{preview}</Text>
          {conversation.unreadCount > 0 ? <View style={[styles.unreadBadge, { backgroundColor: colors.brick }]}><Text style={styles.unreadText}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</Text></View> : null}
        </View>
      </View>
    </Pressable>
  );
}

function TeamConversationRow({ team, summary, onPress, colors, isLast = false }) {
  const preview = summary?.last_body || (summary?.last_has_image ? 'Shared an attachment' : 'Start the team conversation');
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.conversationRow, { borderColor: colors.line }, isLast && styles.conversationRowLast, pressed && styles.pressed]}>
      <View style={[styles.teamAvatar, { backgroundColor: team.color || colors.teal }]}><Text style={styles.teamAvatarText}>{team.tag || 'TM'}</Text></View>
      <View style={styles.conversationCopy}>
        <View style={styles.conversationNameRow}><Text numberOfLines={1} style={[styles.conversationName, { color: colors.ink }]}>{team.name}</Text><Text style={[styles.conversationTime, { color: colors.ink40 }]}>{formatConversationTime(summary?.last_created_at)}</Text></View>
        <View style={styles.conversationPreviewRow}><Text numberOfLines={1} style={[styles.conversationPreview, { color: colors.ink40 }]}>{preview}</Text>{summary?.unread_count > 0 ? <View style={[styles.unreadBadge, { backgroundColor: colors.brick }]}><Text style={styles.unreadText}>{summary.unread_count > 99 ? '99+' : summary.unread_count}</Text></View> : null}</View>
      </View>
    </Pressable>
  );
}

function CommunityConversationRow({ chat, onPress, colors, isLast = false }) {
  const preview = chat.lastBody ? `${chat.lastSenderName ? `${chat.lastSenderName}: ` : ''}${chat.lastBody}` : chat.subtitle || 'No messages yet';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.conversationRow, { borderColor: colors.line }, isLast && styles.conversationRowLast, pressed && styles.pressed]}>
      <View style={[styles.teamAvatar, { backgroundColor: colors.tealWash }]}><Icon name={chat.eventKind === 'competition' ? 'trophy' : 'tennisball'} size={18} color={colors.teal} /></View>
      <View style={styles.conversationCopy}>
        <View style={styles.conversationNameRow}>
          <Text numberOfLines={1} style={[styles.conversationName, { color: colors.ink }]}>{chat.title || 'Community chat'}</Text>
          {chat.isHost ? <View style={[styles.hostPill, { backgroundColor: colors.tealWash }]}><Text style={[styles.hostPillText, { color: colors.teal }]}>HOST</Text></View> : null}
          <Text style={[styles.conversationTime, { color: colors.ink40 }]}>{formatConversationTime(chat.lastMessageAt)}</Text>
        </View>
        <View style={styles.conversationPreviewRow}>
          {chat.lastIsAnnouncement ? <Icon name="megaphone" size={11} color={colors.gold} /> : null}
          <Text numberOfLines={1} style={[styles.conversationPreview, { color: chat.unreadCount ? colors.ink : colors.ink40 }]}>{preview}</Text>
          {chat.unreadCount > 0 ? <View style={[styles.unreadBadge, { backgroundColor: colors.brick }]}><Text style={styles.unreadText}>{chat.unreadCount > 99 ? '99+' : chat.unreadCount}</Text></View> : null}
        </View>
      </View>
    </Pressable>
  );
}

function FollowingStrip({ players, onPress, colors }) {
  if (!players || players.length === 0) return null;
  return (
    <View style={[styles.conversationList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <FlatList
        horizontal
        data={players}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.followingStripContent}
        renderItem={({ item }) => (
          <Pressable
            key={item.id}
            accessibilityLabel={`Message ${item.name}`}
            onPress={() => onPress(item)}
            style={({ pressed }) => [styles.followingItem, pressed && styles.pressed]}
          >
            <View style={styles.followingAvatarContainer}>
              <View style={[styles.followingAvatarWrap, { borderColor: colors.teal }]}>
                {item.avatar
                  ? <ProfilePhoto photo={item.avatar} name={item.name} size={44} />
                  : <View style={[styles.followingAvatarFallback, { backgroundColor: colors.tealWash }]}>
                      <Text style={[styles.followingAvatarInitial, { color: colors.teal }]}>
                        {(item.name || '?')[0].toUpperCase()}
                      </Text>
                    </View>
                }
              </View>
              {item.playerStatus ? (
                <View
                  style={[
                    styles.followingOnlineDot,
                    {
                      backgroundColor: PRESENCE_DOT_COLOR[item.playerStatus] || PRESENCE_DOT_COLOR.free,
                      borderColor: colors.surface,
                    },
                  ]}
                />
              ) : null}
            </View>
            <Text numberOfLines={1} style={[styles.followingName, { color: colors.ink70 }]}>{item.name.split(' ')[0]}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

function NewMessageModal({ visible, onClose, onSelect, colors }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [followingId, setFollowingId] = useState(null);
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setResults([]);
      setSearching(false);
      setFollowingId(null);
      return undefined;
    }
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchDirectMessageCandidates(query)
        .then((rows) => { if (active) setResults(rows); })
        .catch((error) => { if (active) Alert.alert('Search unavailable', error.message); })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, visible]);
  const follow = async (player) => {
    if (!player?.id || followingId) return;
    setFollowingId(player.id);
    try {
      const permission = await followPlayer(player.id);
      setResults((current) => current.map((item) => item.id === player.id ? { ...item, ...permission } : item));
    } catch (error) {
      Alert.alert('Could not follow player', error.message);
    } finally {
      setFollowingId(null);
    }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View {...webDialog('backdrop')} style={styles.composeBackdrop}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <SafeAreaView {...webDialog('surface')} style={[styles.composeSheet, { backgroundColor: colors.paper }]}>
          <View style={styles.modalHeader}><View><Text style={[styles.eyebrow, { color: colors.teal }]}>PRIVATE CHAT</Text><Text style={[styles.modalTitle, { color: colors.ink }]}>New message</Text></View><Pressable accessibilityLabel="Close" onPress={onClose} style={[styles.iconButton, { borderColor: colors.line, backgroundColor: colors.surface }]}><Icon name="close" color={colors.ink} /></Pressable></View>
          <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.line }]}><Icon name="search-outline" color={colors.ink40} /><TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search player name" placeholderTextColor={colors.ink40} style={[styles.searchInput, { color: colors.ink }]} /></View>
          <Text style={[styles.searchNote, { color: colors.ink40 }]}>Private chat opens for teammates and players who follow each other.</Text>
          <ScrollView contentContainerStyle={styles.searchResults} keyboardShouldPersistTaps="handled">
          {searching ? <ActivityIndicator color={colors.teal} /> : null}
          {!searching && query.trim().length >= 2 && !results.length ? <View style={styles.empty}><Icon name="person-outline" size={33} color={colors.ink40} /><Text style={[styles.emptyTitle, { color: colors.ink }]}>No players found</Text></View> : null}
          {results.map((player) => {
            const relationship = player.sharesTeam
              ? 'Teammate'
              : player.canMessage
                ? 'Mutual follow'
                : player.followRequestPending
                  ? 'Follow request sent'
                : player.followsYou
                  ? 'Follows you'
                  : player.isFollowing
                    ? 'Waiting for follow back'
                    : player.home_area || 'Peakle player';
            return (
              <View key={player.id} style={[styles.searchPlayer, { borderColor: colors.line }]}>
                <Pressable disabled={!player.canMessage} onPress={() => onSelect(playerFromRoute(player))} style={({ pressed }) => [styles.searchPlayerMain, pressed && styles.pressed]}>
                  <ProfilePhoto photo={player.avatar_url} name={player.display_name} size={45} />
                  <View style={styles.conversationCopy}><Text style={[styles.conversationName, { color: colors.ink }]}>{player.display_name}</Text><Text style={[styles.conversationPreview, { color: player.followsYou || player.canMessage ? colors.teal : colors.ink40 }]}>{relationship}</Text></View>
                </Pressable>
                {player.canMessage ? (
                  <Pressable accessibilityLabel={`Message ${player.display_name}`} onPress={() => onSelect(playerFromRoute(player))} style={[styles.candidateMessageButton, { backgroundColor: colors.tealWash }]}><Icon name="chatbubble-outline" size={17} color={colors.teal} /></Pressable>
                ) : player.isFollowing || player.followRequestPending ? (
                  <View style={[styles.followingPill, { borderColor: colors.line }]}><Text style={[styles.followingText, { color: colors.ink40 }]}>{player.isFollowing ? 'Following' : 'Requested'}</Text></View>
                ) : (
                  <Pressable disabled={Boolean(followingId)} onPress={() => follow(player)} style={[styles.followButton, { backgroundColor: colors.optic }, followingId && styles.sendDisabled]}>{followingId === player.id ? <ActivityIndicator size="small" color="#0E2321" /> : <Text style={styles.followButtonText}>{player.followsYou ? 'Follow back' : 'Follow'}</Text>}</Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export function InboxScreen({ navigation }) {
  const { isDark } = useTheme();
  const colors = isDark ? DARK_C : LIGHT_C;
  const { user } = useAuth();
  const cachedInbox = user?.id ? inboxCache.get(user.id) : null;
  const [segment, setSegment] = useState(PRIVATE_MESSAGES_ENABLED ? 'messages' : 'community');
  const [filter, setFilter] = useState('All');
  const [inbox, setInbox] = useState(() => cachedInbox || EMPTY_INBOX_SNAPSHOT);
  const [loading, setLoading] = useState(() => PRIVATE_MESSAGES_ENABLED && !cachedInbox);
  const [composeOpen, setComposeOpen] = useState(false);
  const [communityChats, setCommunityChats] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(true);
  const hasLoadedRef = useRef(Boolean(cachedInbox));
  const requestIdRef = useRef(0);
  const activeUserIdRef = useRef(user?.id);
  activeUserIdRef.current = user?.id;
  const { directConversations, privateConnections, followingPlayers, teams, teamSummaries } = inbox;

  const loadCommunityChats = useCallback(async () => {
    try {
      const rows = await listMyCommunityChats();
      setCommunityChats(rows);
    } catch {
      // keep whatever was previously loaded
    } finally {
      setCommunityLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { loadCommunityChats(); }, [loadCommunityChats]));
  useEffect(() => {
    if (!supabase || !user?.id) return undefined;
    let refreshTimer;
    const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(loadCommunityChats, 150); };
    const channel = supabase.channel(`community-chats-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_messages' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_conversations' }, refresh)
      .subscribe();
    return () => { clearTimeout(refreshTimer); supabase.removeChannel(channel); };
  }, [loadCommunityChats, user?.id]);
  const communityUnreadCount = communityChats.reduce((total, chat) => total + Number(chat.unreadCount || 0), 0);
  const openCommunityChat = (chat) => navigation.navigate('CommunityChat', { eventKind: chat.eventKind, eventId: chat.eventId, title: chat.title, ownerTab: 'Team' });

  useEffect(() => {
    if (!PRIVATE_MESSAGES_ENABLED) return;
    requestIdRef.current += 1;
    const nextCachedInbox = user?.id ? inboxCache.get(user.id) : null;
    setInbox(nextCachedInbox || EMPTY_INBOX_SNAPSHOT);
    hasLoadedRef.current = Boolean(nextCachedInbox);
    setLoading(Boolean(user?.id) && !nextCachedInbox);
  }, [user?.id]);

  const loadInbox = useCallback(async ({ showSkeleton = false } = {}) => {
    if (!PRIVATE_MESSAGES_ENABLED) return;
    const userId = user?.id;
    if (!userId) {
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    if (showSkeleton && !hasLoadedRef.current && !inboxCache.has(userId)) setLoading(true);
    try {
      const [direct, connections, following, allTeams] = await Promise.all([
        listDirectConversations(),
        listPrivateConnections(),
        listFollowingPlayers(),
        listTeams(),
      ]);
      const mine = allTeams.filter((team) => team.role);
      const summaries = await listTeamConversationSummaries(mine.map((team) => team.id));
      if (requestId !== requestIdRef.current || activeUserIdRef.current !== userId) return;
      const nextInbox = {
        directConversations: direct,
        privateConnections: connections,
        followingPlayers: following,
        teams: mine,
        teamSummaries: Object.fromEntries(summaries.map((item) => [item.team_id, item])),
      };
      inboxCache.set(userId, nextInbox);
      setInbox(nextInbox);
      hasLoadedRef.current = true;
    } catch (error) {
      if (requestId === requestIdRef.current && activeUserIdRef.current === userId && !hasLoadedRef.current) {
        Alert.alert('Messages unavailable', error.message);
      }
    } finally {
      if (requestId === requestIdRef.current && activeUserIdRef.current === userId) setLoading(false);
    }
  }, [user?.id]);
  useFocusEffect(useCallback(() => {
    loadInbox({ showSkeleton: true });
  }, [loadInbox]));
  useEffect(() => {
    if (!PRIVATE_MESSAGES_ENABLED || !supabase || !user?.id) return undefined;
    let refreshTimer;
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(loadInbox, 120);
    };
    const channel = supabase.channel(`direct-inbox-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_conversations' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_conversation_reads' }, refresh)
      .subscribe();
    return () => { clearTimeout(refreshTimer); supabase.removeChannel(channel); };
  }, [loadInbox, user?.id]);

  const incomingRequests = directConversations.filter((item) => item.status === 'pending' && item.requesterId !== user?.id);
  const privateRows = directConversations.filter((item) => !incomingRequests.includes(item));
  const openPrivate = (conversation) => navigation.navigate('DirectChat', { conversationId: conversation.id, player: conversation.peer, ownerTab: 'Team' });
  const openConnection = (player) => {
    const conversation = directConversations.find((item) => item.peer.id === player.id);
    if (conversation) {
      openPrivate(conversation);
      return;
    }
    navigation.navigate('DirectChat', { player, ownerTab: 'Team' });
  };
  const openTeam = (team) => navigation.navigate('Team', { openChatTeamId: team.id, openChatToken: Date.now() });
  const choosePlayer = (player) => {
    setComposeOpen(false);
    navigation.navigate('DirectChat', { player, ownerTab: 'Team' });
  };
  const threads = [
    ...privateRows.map((conversation) => ({
      key: `private-${conversation.id}`,
      kind: 'private',
      timestamp: conversation.lastMessageAt,
      conversation,
    })),
    ...teams.map((team) => ({
      key: `team-${team.id}`,
      kind: 'team',
      timestamp: teamSummaries[team.id]?.last_created_at,
      team,
      summary: teamSummaries[team.id],
    })),
  ]
    .filter((item) => filter === 'All' || (filter === 'Private' ? item.kind === 'private' : item.kind === 'team'))
    .sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTime - aTime;
    });
  const privatePeopleCount = new Set([...directConversations.map((item) => item.peer.id), ...privateConnections.map((item) => item.id)]).size;
  const filterCounts = {
    All: privatePeopleCount + teams.length,
    Private: privatePeopleCount,
    Teams: teams.length,
  };
  const showRequests = filter !== 'Teams' && incomingRequests.length > 0;
  const sectionTitle = filter === 'Private' ? 'PRIVATE MESSAGES' : filter === 'Teams' ? 'TEAM CHATS' : 'RECENT';
  const emptyCopy = filter === 'Private'
    ? ['No private conversations', 'Start one from a player profile or the compose button.']
    : filter === 'Teams'
      ? ['No team chats yet', 'Your team conversations will appear here.']
      : ['Your inbox is ready', 'Private and team conversations will appear here.'];

  const showStrip = followingPlayers.length > 0;
  const onMessages = segment === 'messages';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.paper} />
      <ScreenHeader
        eyebrow="CONVERSATIONS"
        title="Chats"
        onBack={() => navigation.goBack()}
        colors={colors}
        action={onMessages ? <Pressable accessibilityLabel="New private message" hitSlop={8} onPress={() => setComposeOpen(true)} style={[styles.composeButton, { backgroundColor: colors.optic }]}><Icon name="create-outline" size={21} color="#0E2321" /></Pressable> : null}
      />
      {PRIVATE_MESSAGES_ENABLED ? (
        <View style={styles.segmentRow}>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: onMessages }} onPress={() => setSegment('messages')} style={[styles.segmentButton, { borderColor: colors.line, backgroundColor: onMessages ? colors.tealWash : colors.surface }]}>
            <Text style={[styles.segmentText, { color: onMessages ? colors.teal : colors.ink70 }]}>Messages</Text>
          </Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: !onMessages }} onPress={() => setSegment('community')} style={[styles.segmentButton, { borderColor: colors.line, backgroundColor: !onMessages ? colors.tealWash : colors.surface }]}>
            <Text style={[styles.segmentText, { color: !onMessages ? colors.teal : colors.ink70 }]}>Community{communityUnreadCount ? ` (${communityUnreadCount})` : ''}</Text>
          </Pressable>
        </View>
      ) : null}
      {onMessages ? (
        <ScrollView contentContainerStyle={styles.inboxContent} showsVerticalScrollIndicator={false}>
          {!loading && showStrip ? (
            <>
              <View style={styles.sectionHead}><Text style={[styles.sectionLabel, { color: colors.teal }]}>FOLLOWING</Text></View>
              <FollowingStrip players={followingPlayers} onPress={openConnection} colors={colors} />
            </>
          ) : null}
          <View style={[styles.filters, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            {['All', 'Private', 'Teams'].map((item) => {
              const selected = filter === item;
              return (
                <Pressable
                  key={item}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setFilter(item)}
                  style={({ pressed }) => [styles.filter, selected && { backgroundColor: colors.tealWash }, pressed && styles.filterPressed]}
                >
                  <Text style={[styles.filterText, { color: selected ? colors.teal : colors.ink70 }]}>{item}</Text>
                  <Text style={[styles.filterCount, { color: selected ? colors.teal : colors.ink40 }]}>{loading ? '—' : filterCounts[item]}</Text>
                </Pressable>
              );
            })}
          </View>
          {loading ? <InboxLoadingSkeleton colors={colors} /> : null}
          {!loading && showRequests ? (
            <>
              <View style={styles.sectionHead}><Text style={[styles.sectionLabel, { color: colors.brick }]}>MESSAGE REQUESTS</Text><Text style={[styles.sectionMeta, { color: colors.brick }]}>{incomingRequests.length}</Text></View>
              <View style={[styles.conversationList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                {incomingRequests.map((item, index) => <ConversationRow key={item.id} conversation={item} currentUserId={user?.id} onPress={() => openPrivate(item)} colors={colors} isLast={index === incomingRequests.length - 1} />)}
              </View>
            </>
          ) : null}
          {!loading && threads.length ? (
            <>
              <View style={styles.sectionHead}>
                <Text style={[styles.sectionLabel, { color: colors.teal }]}>{sectionTitle}</Text>
                <Text style={[styles.sectionMeta, { color: colors.ink40 }]}>{threads.length} {threads.length === 1 ? 'conversation' : 'conversations'}</Text>
              </View>
              <View style={[styles.conversationList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                {threads.map((item, index) => item.kind === 'private'
                  ? <ConversationRow key={item.key} conversation={item.conversation} currentUserId={user?.id} onPress={() => openPrivate(item.conversation)} colors={colors} isLast={index === threads.length - 1} />
                  : <TeamConversationRow key={item.key} team={item.team} summary={item.summary} colors={colors} onPress={() => openTeam(item.team)} isLast={index === threads.length - 1} />)}
              </View>
            </>
          ) : null}
          {!loading && !threads.length && !showRequests ? <View style={styles.empty}><View style={[styles.emptyIcon, { backgroundColor: colors.surface, borderColor: colors.line }]}><Icon name={filter === 'Private' ? 'chatbubble-outline' : filter === 'Teams' ? 'people-outline' : 'chatbubbles-outline'} size={26} color={colors.teal} /></View><Text style={[styles.emptyTitle, { color: colors.ink }]}>{emptyCopy[0]}</Text><Text style={[styles.emptyText, { color: colors.ink40 }]}>{emptyCopy[1]}</Text></View> : null}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.inboxContent} showsVerticalScrollIndicator={false}>
          {communityLoading ? <InboxLoadingSkeleton colors={colors} /> : null}
          {!communityLoading && communityChats.length ? (
            <>
              <View style={styles.sectionHead}>
                <Text style={[styles.sectionLabel, { color: colors.teal }]}>OPEN PLAY & TOURNAMENTS</Text>
                <Text style={[styles.sectionMeta, { color: colors.ink40 }]}>{communityChats.length} {communityChats.length === 1 ? 'chat' : 'chats'}</Text>
              </View>
              <View style={[styles.conversationList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                {communityChats.map((chat, index) => (
                  <CommunityConversationRow key={chat.conversationId || `${chat.eventKind}:${chat.eventId}`} chat={chat} colors={colors} onPress={() => openCommunityChat(chat)} isLast={index === communityChats.length - 1} />
                ))}
              </View>
            </>
          ) : null}
          {!communityLoading && !communityChats.length ? (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.surface, borderColor: colors.line }]}><Icon name="people-circle-outline" size={26} color={colors.teal} /></View>
              <Text style={[styles.emptyTitle, { color: colors.ink }]}>No community chats yet</Text>
              <Text style={[styles.emptyText, { color: colors.ink40 }]}>Join an open-play session or enter a tournament to unlock its group chat and announcements.</Text>
            </View>
          ) : null}
        </ScrollView>
      )}
      <NewMessageModal visible={composeOpen} onClose={() => setComposeOpen(false)} onSelect={choosePlayer} colors={colors} />
    </SafeAreaView>
  );
}

function AnimatedTypingDots({ colors }) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0.35))).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.stagger(130, values.map((value) => Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(value, { toValue: 0.35, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]))));
    animation.start();
    return () => animation.stop();
  }, [values]);
  return <View style={[styles.typingBubble, { backgroundColor: colors.surface, borderColor: colors.line }]}>{values.map((value, index) => <Animated.View key={index} style={[styles.typingDot, { backgroundColor: colors.ink40, opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0.35, 1], outputRange: [1.5, -1.5] }) }] }]} />)}</View>;
}

function ChatSafetyGate({ status, busy, onConfirm, colors }) {
  const suspended = status?.suspended || (status?.suspendedUntil && new Date(status.suspendedUntil) > new Date());
  return (
    <View style={styles.safetyGate}>
      <View style={[styles.safetyIcon, { backgroundColor: colors.optic }]}><Icon name={suspended ? 'lock-closed' : 'shield-checkmark'} size={32} color="#0E2321" /></View>
      <Text style={[styles.safetyTitle, { color: colors.ink }]}>{suspended ? 'Private chat is unavailable.' : 'Confirm before messaging.'}</Text>
      <Text style={[styles.safetyText, { color: colors.ink40 }]}>{suspended ? 'Your chat access is currently suspended.' : 'Private messaging is currently for players who confirm they are 18 or older. Block and report controls are always available.'}</Text>
      {!suspended ? <Pressable disabled={busy} onPress={() => onConfirm(true)} style={[styles.safetyButton, { backgroundColor: colors.optic }]}>{busy ? <ActivityIndicator color="#0E2321" /> : <Text style={styles.safetyButtonText}>I confirm I’m 18 or older</Text>}</Pressable> : null}
    </View>
  );
}

function MessageRelationshipGate({ peer, permission, busy, onFollow, colors }) {
  const alreadyFollowing = permission?.isFollowing;
  const followsYou = permission?.followsYou;
  const requestPending = permission?.followRequestPending;
  const teammateUnavailable = permission?.sharesTeam && permission?.peerChatEligible === false;
  const title = permission?.blocked
    ? 'Private messaging is unavailable.'
    : teammateUnavailable
      ? `${peer?.name || 'This teammate'} cannot use private chat yet.`
    : followsYou
    ? `Follow ${peer?.name || 'this player'} back to chat.`
    : requestPending
      ? 'Follow request sent.'
    : alreadyFollowing
      ? 'Waiting for a follow back.'
      : 'Follow each other to chat.';
  const body = permission?.blocked
    ? 'One of these accounts has blocked private messages between you.'
    : teammateUnavailable
      ? 'Team membership is confirmed, but private chat requires the teammate account to complete the chat-safety setup.'
    : followsYou
    ? 'They already follow you. Follow them back to open a private conversation.'
    : requestPending
      ? `${peer?.name || 'This player'} can accept or delete your request from their notifications.`
    : alreadyFollowing
      ? `${peer?.name || 'This player'} will become messageable when they follow you back.`
      : 'Private messages are limited to mutual followers and teammates.';
  return (
    <View style={styles.relationshipGate}>
      <ProfilePhoto photo={peer?.avatar} name={peer?.name} size={72} />
      <View style={[styles.relationshipIcon, { backgroundColor: colors.tealWash }]}><Icon name="people-outline" size={20} color={colors.teal} /></View>
      <Text style={[styles.relationshipTitle, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.relationshipText, { color: colors.ink40 }]}>{body}</Text>
      {!permission?.sharesTeam && !permission?.blocked && !alreadyFollowing && !requestPending ? <Pressable disabled={busy} onPress={onFollow} style={[styles.relationshipButton, { backgroundColor: colors.optic }, busy && styles.sendDisabled]}>{busy ? <ActivityIndicator color="#0E2321" /> : <Text style={styles.relationshipButtonText}>{followsYou ? 'Follow back' : `Follow ${peer?.name || 'player'}`}</Text>}</Pressable> : null}
    </View>
  );
}

function DirectMessageInteractionModal({ message, mode, peer, seen, colors, onModeChange, onClose, onReact, onDetails, onReport, onBlock }) {
  if (!message) return null;
  const preview = message.text || 'Message';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View {...webDialog('backdrop')} style={[styles.messageInteractionBackdrop, mode === 'actions' && styles.messageInteractionBackdropBottom]}>
        <Pressable accessibilityLabel="Close message actions" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        {mode === 'reactions' ? (
          <View {...webDialog('surface')} style={[styles.messageInteractionCard, message.mine && styles.messageInteractionCardMine]}>
            <View style={[styles.directReactionPicker, { backgroundColor: colors.surface }]}>
              {DIRECT_REACTION_OPTIONS.map((emoji) => <Pressable key={emoji} accessibilityLabel={`React ${emoji}`} onPress={() => { onReact(message.id, emoji); onClose(); }} style={({ pressed }) => [styles.directReactionOption, pressed && { backgroundColor: colors.tealWash }]}><Text style={styles.directReactionOptionText}>{emoji}</Text></Pressable>)}
            </View>
            <View style={[styles.messageInteractionPreviewRow, message.mine && styles.messageInteractionPreviewRowMine]}>
              <View style={[styles.messageInteractionPreview, { backgroundColor: colors.surface, borderColor: colors.line }, message.mine && styles.messageInteractionPreviewMine, message.mine && { backgroundColor: colors.teal, borderColor: colors.teal }]}>
                <Text numberOfLines={5} style={[styles.messageInteractionPreviewText, { color: message.mine ? '#FFFFFF' : colors.ink }]}>{preview}</Text>
              </View>
              <Pressable accessibilityLabel="More message actions" onPress={() => onModeChange('actions')} style={[styles.messageInteractionMore, { backgroundColor: colors.surface }]}><Icon name="ellipsis-horizontal" size={22} color={colors.ink} /></Pressable>
            </View>
          </View>
        ) : (
          <View style={[styles.directActionSheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.directActionHandle, { backgroundColor: colors.line }]} />
            <Text style={[styles.directActionTitle, { color: colors.ink }]}>Message options</Text>
            <View style={[styles.directReactionPicker, styles.directActionReactions, { backgroundColor: colors.paper, borderColor: colors.line }]}>
              {DIRECT_REACTION_OPTIONS.map((emoji) => <Pressable key={emoji} accessibilityLabel={`React ${emoji}`} onPress={() => { onReact(message.id, emoji); onClose(); }} style={({ pressed }) => [styles.directReactionOption, pressed && { backgroundColor: colors.tealWash }]}><Text style={styles.directReactionOptionText}>{emoji}</Text></Pressable>)}
            </View>
            <Pressable onPress={() => { onClose(); onDetails(message, seen); }} style={[styles.directActionRow, { borderColor: colors.line }]}><View style={[styles.directActionIcon, { backgroundColor: colors.tealWash }]}><Icon name="information-circle-outline" size={20} color={colors.teal} /></View><View style={styles.directActionCopy}><Text style={[styles.directActionRowTitle, { color: colors.ink }]}>Message details</Text><Text style={[styles.directActionRowText, { color: colors.ink40 }]}>{message.mine ? (seen ? `Seen by ${peer?.name || 'player'}` : 'Sent privately') : `Received from ${peer?.name || 'player'}`}</Text></View></Pressable>
            {!message.mine ? <Pressable onPress={() => { onClose(); onReport(message); }} style={[styles.directActionRow, { borderColor: colors.line }]}><View style={[styles.directActionIcon, { backgroundColor: colors.tealWash }]}><Icon name="flag-outline" size={20} color={colors.brick} /></View><View style={styles.directActionCopy}><Text style={[styles.directActionRowTitle, { color: colors.brick }]}>Report message</Text><Text style={[styles.directActionRowText, { color: colors.ink40 }]}>Send it to Peakle’s private safety queue</Text></View></Pressable> : null}
            {!message.mine ? <Pressable onPress={() => { onClose(); onBlock(); }} style={[styles.directActionRow, { borderColor: colors.line }]}><View style={[styles.directActionIcon, { backgroundColor: colors.paper }]}><Icon name="ban-outline" size={20} color={colors.ink70} /></View><View style={styles.directActionCopy}><Text style={[styles.directActionRowTitle, { color: colors.ink }]}>Block {peer?.name || 'player'}</Text><Text style={[styles.directActionRowText, { color: colors.ink40 }]}>Stop private messages from this player</Text></View></Pressable> : null}
            <Pressable onPress={onClose} style={[styles.directActionCancel, { backgroundColor: colors.paper }]}><Text style={[styles.directActionCancelText, { color: colors.ink70 }]}>Cancel</Text></Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

function DirectChatMessage({ message, grouped, active, interactive, peer, seen, currentUserId, colors, onToggleControls, onOpenReactions, onOpenActions, onReact }) {
  const reactionGroups = DIRECT_REACTION_OPTIONS.map((emoji) => ({
    emoji,
    reactions: (message.reactions || []).filter((reaction) => reaction.emoji === emoji),
  })).filter((group) => group.reactions.length);
  return (
    <View style={[styles.messageRow, message.mine && styles.messageRowMine, grouped && styles.messageGrouped]}>
      {!message.mine && !grouped ? <ProfilePhoto photo={message.avatar || peer?.avatar} name={message.sender} size={30} /> : !message.mine ? <View style={styles.avatarSpacer} /> : null}
      <View style={[styles.directMessageBlock, message.mine && styles.directMessageBlockMine]}>
        <View style={[styles.directBubbleActionRow, message.mine && styles.directBubbleActionRowMine]}>
          <Pressable accessibilityHint={interactive ? 'Tap for quick controls. Long press for reactions and message options.' : undefined} disabled={!interactive} onPress={() => onToggleControls(message.id)} onLongPress={() => onOpenReactions(message.id)} delayLongPress={240} style={[styles.messageBubble, { backgroundColor: colors.surface, borderColor: colors.line }, message.mine && { backgroundColor: colors.teal, borderColor: colors.teal }]}><Text style={[styles.messageText, { color: message.mine ? '#FFFFFF' : colors.ink }]}>{message.text}</Text><Text style={[styles.messageTime, { color: message.mine ? 'rgba(255,255,255,.7)' : colors.ink40 }]}>{message.time}</Text></Pressable>
          {active ? <View style={styles.directQuickActions}><Pressable accessibilityLabel="React to message" onPress={() => onOpenReactions(message.id)} style={[styles.directQuickAction, { backgroundColor: colors.surface, borderColor: colors.line }]}><Icon name="happy-outline" size={18} color={colors.ink70} /></Pressable><Pressable accessibilityLabel="More message actions" onPress={() => onOpenActions(message.id)} style={[styles.directQuickAction, { backgroundColor: colors.surface, borderColor: colors.line }]}><Icon name="ellipsis-horizontal" size={19} color={colors.ink70} /></Pressable></View> : null}
        </View>
        {reactionGroups.length ? <View style={[styles.directReactionSummary, message.mine && styles.directReactionSummaryMine]}>{reactionGroups.map((group) => { const mine = group.reactions.some((reaction) => reaction.user_id === currentUserId); return <Pressable key={group.emoji} accessibilityLabel={`${group.emoji}, ${group.reactions.length} reactions`} onPress={() => onReact(message.id, group.emoji)} style={[styles.directReactionChip, { backgroundColor: mine ? colors.tealWash : colors.surface, borderColor: mine ? colors.teal : colors.line }]}><Text style={styles.directReactionEmoji}>{group.emoji}</Text><Text style={[styles.directReactionCount, { color: colors.ink70 }]}>{group.reactions.length}</Text></Pressable>; })}</View> : null}
        {message.mine && seen ? <View accessibilityLabel={`Seen by ${peer?.name || 'player'}`} style={styles.directSeenReceipt}><ProfilePhoto photo={peer?.avatar} name={peer?.name} size={17} /><Icon name="checkmark-done" size={13} color={colors.teal} /><Text style={[styles.directSeenText, { color: colors.ink40 }]}>Seen</Text></View> : null}
      </View>
    </View>
  );
}

export function DirectChatScreen({ route, navigation }) {
  const { isDark } = useTheme();
  const colors = isDark ? DARK_C : LIGHT_C;
  const { user } = useAuth();
  // Web URLs only carry the player id; the conversation lookup fills in the rest.
  const routePlayer = useMemo(
    () => playerFromRoute(route?.params?.player || (route?.params?.playerId ? { id: route.params.playerId } : null)),
    [route?.params?.player, route?.params?.playerId],
  );
  const [conversationId, setConversationId] = useState(route?.params?.conversationId || null);
  const [conversation, setConversation] = useState(null);
  const [peer, setPeer] = useState(routePlayer);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const dmDripIndex = useRef(0);
  useEffect(() => {
    if (!DEMO_MODE || conversationId !== DEMO_CONVERSATION_ID) return undefined;
    const timer = setInterval(() => {
      const next = DEMO_DIRECT_MESSAGE_DRIP[dmDripIndex.current % DEMO_DIRECT_MESSAGE_DRIP.length];
      dmDripIndex.current += 1;
      const createdAt = new Date().toISOString();
      setMessages((current) => [...current, {
        id: `${next.id}-${Date.now()}`, conversationId: DEMO_CONVERSATION_ID, senderId: 'p-priya-shah',
        sender: 'Priya Shah', avatar: null, mine: false, text: next.text, reactions: [], createdAt,
        time: new Date(createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      }]);
    }, 4500);
    return () => clearInterval(timer);
  }, [conversationId]);
  const [sending, setSending] = useState(false);
  const [responding, setResponding] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const [reportingMessage, setReportingMessage] = useState(null);
  const [activeMessageId, setActiveMessageId] = useState(null);
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [interactionMode, setInteractionMode] = useState('reactions');
  const [safetyStatus, setSafetyStatus] = useState(null);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [messagePermission, setMessagePermission] = useState(null);
  const [following, setFollowing] = useState(false);
  const scrollRef = useRef(null);
  const conversationLoadingRef = useRef(false);
  const channelRef = useRef(null);
  const typingActiveRef = useRef(false);
  const typingStopTimer = useRef(null);
  const typingHeartbeatTimer = useRef(null);
  const typingExpiryTimer = useRef(null);

  const upsertMessage = useCallback((message) => {
    if (!message) return;
    setMessages((current) => {
      const existing = current.findIndex((item) => item.id === message.id);
      if (existing < 0) return [...current, message].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const next = [...current];
      next[existing] = message;
      return next;
    });
  }, []);
  const refreshConversation = useCallback(async (id = conversationId) => {
    if (!id) return null;
    const details = await getDirectConversation(id);
    setConversation(details);
    if (details?.peer) setPeer(details.peer);
    return details;
  }, [conversationId]);
  const loadConversation = useCallback(async () => {
    if (!user?.id || conversationLoadingRef.current) return;
    conversationLoadingRef.current = true;
    setLoading(true);
    try {
      const status = await getChatSafetyStatus();
      setSafetyStatus(status);
      if (!status.eligible) return;
      let id = conversationId;
      if (!id && routePlayer?.id) {
        const [found, permission] = await Promise.all([
          findDirectConversation(routePlayer.id),
          getDirectMessagePermission(routePlayer.id),
        ]);
        setMessagePermission(permission);
        if (found) {
          id = found.id;
          setConversationId(found.id);
          setConversation(found);
          setPeer(found.peer);
        }
      }
      if (id) {
        const [details, rows] = await Promise.all([getDirectConversation(id), listDirectMessages(id)]);
        setConversation(details);
        if (details?.peer) setPeer(details.peer);
        setMessages(rows);
        await markDirectConversationRead(id);
      }
    } catch (error) {
      Alert.alert('Conversation unavailable', error.message);
    } finally {
      conversationLoadingRef.current = false;
      setLoading(false);
    }
  }, [conversationId, routePlayer?.id, user?.id]);
  useEffect(() => { loadConversation(); }, [loadConversation]);
  const sendTyping = useCallback((isTyping) => {
    if (!conversationId || conversation?.status !== 'accepted' || !channelRef.current) return;
    channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { userId: user?.id, isTyping } }).catch(() => {});
  }, [conversation?.status, conversationId, user?.id]);
  const stopTyping = useCallback(() => {
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    if (typingHeartbeatTimer.current) clearInterval(typingHeartbeatTimer.current);
    typingStopTimer.current = null;
    typingHeartbeatTimer.current = null;
    if (typingActiveRef.current) sendTyping(false);
    typingActiveRef.current = false;
  }, [sendTyping]);
  const changeDraft = (value) => {
    setDraft(value);
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    if (!value.trim() || conversation?.status !== 'accepted') {
      stopTyping();
      return;
    }
    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      sendTyping(true);
    }
    if (!typingHeartbeatTimer.current) {
      typingHeartbeatTimer.current = setInterval(() => sendTyping(true), TYPING_HEARTBEAT_MS);
    }
    typingStopTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };
  useEffect(() => {
    if (!supabase || !conversationId || !user?.id || !safetyStatus?.eligible) return undefined;
    const channel = supabase.channel(`direct-chat-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` }, ({ new: row }) => {
        getDirectMessage(row.id).then((message) => {
          upsertMessage(message);
          if (message?.senderId !== user.id) markDirectConversationRead(conversationId).catch(() => {});
        }).catch(() => {});
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_conversations', filter: `id=eq.${conversationId}` }, () => refreshConversation())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_conversation_reads', filter: `conversation_id=eq.${conversationId}` }, () => refreshConversation())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_message_reactions' }, (payload) => {
        const messageId = payload.new?.message_id || payload.old?.message_id;
        if (messageId) getDirectMessage(messageId).then(upsertMessage).catch(() => {});
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload?.userId || payload.userId === user.id) return;
        if (typingExpiryTimer.current) clearTimeout(typingExpiryTimer.current);
        setRemoteTyping(Boolean(payload.isTyping));
        if (payload.isTyping) typingExpiryTimer.current = setTimeout(() => setRemoteTyping(false), TYPING_EXPIRY_MS);
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      if (typingExpiryTimer.current) clearTimeout(typingExpiryTimer.current);
      setRemoteTyping(false);
      supabase.removeChannel(channel);
    };
  }, [conversationId, refreshConversation, safetyStatus?.eligible, upsertMessage, user?.id]);
  useEffect(() => () => stopTyping(), [stopTyping]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [messages.length, remoteTyping]);

  const send = async () => {
    const clean = draft.trim();
    if (!clean || sending || !peer?.id) return;
    stopTyping();
    setSending(true);
    try {
      if (!conversationId) {
        const result = await startDirectConversation(peer.id, clean);
        setConversationId(result.conversationId);
        setDraft('');
        const [details, rows] = await Promise.all([getDirectConversation(result.conversationId), listDirectMessages(result.conversationId)]);
        setConversation(details);
        setMessages(rows);
      } else {
        const message = await sendDirectMessage(conversationId, clean);
        upsertMessage(message);
        setDraft('');
        await refreshConversation();
      }
    } catch (error) {
      Alert.alert('Message not sent', error.message);
    } finally {
      setSending(false);
    }
  };
  const respond = async (accept) => {
    if (!conversationId || responding) return;
    setResponding(true);
    try {
      await respondDirectMessageRequest(conversationId, accept);
      await refreshConversation();
      if (!accept) navigation.goBack();
    } catch (error) {
      Alert.alert('Request not updated', error.message);
    } finally {
      setResponding(false);
    }
  };
  const confirmSafety = async (isAdult) => {
    setSafetyBusy(true);
    try {
      const status = await acknowledgeChatSafety(isAdult);
      setSafetyStatus(status);
      if (status.eligible) await loadConversation();
    } catch (error) {
      Alert.alert('Chat preference not saved', error.message);
    } finally {
      setSafetyBusy(false);
    }
  };
  const followPeer = async () => {
    if (!peer?.id || following) return;
    setFollowing(true);
    try {
      setMessagePermission(await followPlayer(peer.id));
    } catch (error) {
      Alert.alert('Could not follow player', error.message);
    } finally {
      setFollowing(false);
    }
  };
  const openMessageInteraction = (messageId, mode) => {
    setActiveMessageId(null);
    setSelectedMessageId(messageId);
    setInteractionMode(mode);
  };
  const reactToMessage = async (messageId, emoji) => {
    try {
      upsertMessage(await toggleDirectMessageReaction(messageId, emoji));
    } catch (error) {
      Alert.alert('Reaction not saved', error.message);
    }
  };
  const showMessageDetails = (message, seen) => {
    const sentAt = new Date(message.createdAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    Alert.alert('Message details', `${message.mine ? 'Sent' : 'Received'} ${sentAt}${message.mine ? `\n${seen ? `Seen by ${peer?.name || 'player'}` : 'Delivered'}` : ''}`);
  };
  const blockPlayer = () => Alert.alert(`Block ${peer?.name || 'this player'}?`, 'They will no longer be able to privately message you. You can unblock them from chat safety settings.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Block', style: 'destructive', onPress: async () => {
      try {
        await blockChatUser(peer.id);
        await refreshConversation();
      } catch (error) {
        Alert.alert('Player not blocked', error.message);
      }
    } },
  ]);
  const submitReport = async (reason) => {
    const message = reportingMessage;
    setReportingMessage(null);
    if (!message) return;
    try {
      await reportDirectMessage(message.id, reason);
      Alert.alert('Report received', 'Thank you. Peakle will review this message.');
    } catch (error) {
      Alert.alert('Report not sent', error.message);
    }
  };
  const incomingRequest = conversation?.status === 'pending' && conversation.requesterId !== user?.id;
  const outboundRequest = conversation?.status === 'pending' && conversation.requesterId === user?.id;
  const blocked = conversation?.blockedByMe || conversation?.blockedMe;
  const composerDisabled = sending || blocked || outboundRequest || conversation?.status === 'declined' || incomingRequest;
  const relationshipLocked = !conversationId && !messagePermission?.canMessage;
  const declined = conversation?.status === 'declined';
  const latestMine = [...messages].reverse().find((message) => message.mine);
  const latestMineSeen = latestMine && conversation?.peerLastReadAt && new Date(conversation.peerLastReadAt) >= new Date(latestMine.createdAt);
  const selectedMessage = messages.find((message) => message.id === selectedMessageId) || null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.paper} />
      <View style={styles.chatHeader}>
        <Pressable accessibilityLabel="Go back" onPress={() => { stopTyping(); navigation.goBack(); }} style={[styles.iconButton, { borderColor: colors.line, backgroundColor: colors.surface }]}><Icon name="arrow-back" color={colors.ink} /></Pressable>
        <ProfilePhoto photo={peer?.avatar} name={peer?.name} size={43} />
        <View style={styles.headerCopy}><Text numberOfLines={1} style={[styles.chatTitle, { color: colors.ink }]}>{peer?.name || 'Private message'}</Text><Text style={[styles.chatStatus, { color: colors.ink40 }]}>{remoteTyping ? 'typing…' : conversation?.status === 'accepted' ? 'Private conversation' : conversation?.status === 'pending' ? 'Message request' : relationshipLocked ? 'Mutual follow required' : peer?.area || 'Peakle player'}</Text></View>
        {conversationId ? <Pressable accessibilityLabel="Conversation options" onPress={() => Alert.alert(peer?.name || 'Conversation', 'Private conversation options', [{ text: 'Block player', style: 'destructive', onPress: blockPlayer }, { text: 'Cancel', style: 'cancel' }])} style={[styles.iconButton, { borderColor: colors.line, backgroundColor: colors.surface }]}><Icon name="ellipsis-horizontal" color={colors.ink} /></Pressable> : null}
      </View>
      <View style={[styles.rule, { backgroundColor: colors.line }]} />
      {!safetyStatus?.eligible && !loading ? <ChatSafetyGate status={safetyStatus} busy={safetyBusy} onConfirm={confirmSafety} colors={colors} /> : loading ? <ChatLoadingSkeleton colors={colors} /> : relationshipLocked ? <MessageRelationshipGate peer={peer} permission={messagePermission} busy={following} onFollow={followPeer} colors={colors} /> : (
        <KeyboardAvoidingView style={styles.chatBody} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
          <View style={[styles.encryptionBanner, { backgroundColor: isDark ? colors.surface : '#E5F0ED', borderColor: colors.line }]}><Icon name="lock-closed-outline" size={14} color={colors.teal} /><Text style={[styles.encryptionText, { color: colors.ink70 }]}>Only you and {peer?.name || 'this player'} can view this conversation.</Text></View>
          <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messageContent} keyboardShouldPersistTaps="handled" onScrollBeginDrag={() => setActiveMessageId(null)} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
            {!messages.length ? <View style={styles.emptyChat}><ProfilePhoto photo={peer?.avatar} name={peer?.name} size={70} /><Text style={[styles.emptyChatTitle, { color: colors.ink }]}>Message {peer?.name || 'this player'}</Text><Text style={[styles.emptyText, { color: colors.ink40 }]}>You can message because you are teammates or mutual followers. Keep personal and sensitive information private.</Text></View> : null}
            {messages.map((message, index) => {
              const grouped = messages[index - 1]?.senderId === message.senderId;
              return <DirectChatMessage key={message.id} message={message} grouped={grouped} active={activeMessageId === message.id && conversation?.status === 'accepted' && !blocked} interactive={conversation?.status === 'accepted' && !blocked} peer={peer} seen={message.id === latestMine?.id && Boolean(latestMineSeen)} currentUserId={user?.id} colors={colors} onToggleControls={(messageId) => setActiveMessageId((current) => current === messageId ? null : messageId)} onOpenReactions={(messageId) => openMessageInteraction(messageId, 'reactions')} onOpenActions={(messageId) => openMessageInteraction(messageId, 'actions')} onReact={reactToMessage} />;
            })}
            {remoteTyping ? <View accessibilityLiveRegion="polite" accessibilityLabel={`${peer?.name || 'Player'} is typing`} style={styles.remoteTypingRow}><ProfilePhoto photo={peer?.avatar} name={peer?.name} size={30} /><AnimatedTypingDots colors={colors} /></View> : null}
          </ScrollView>
          {incomingRequest && !blocked ? <View style={[styles.requestActions, { backgroundColor: colors.surface, borderColor: colors.line }]}><View style={styles.requestCopy}><Text style={[styles.requestTitle, { color: colors.ink }]}>Accept message request?</Text><Text style={[styles.requestText, { color: colors.ink40 }]}>Accept to reply, or decline to close it.</Text></View><Pressable disabled={responding} onPress={() => respond(false)} style={[styles.declineButton, { borderColor: colors.line }]}><Text style={[styles.declineText, { color: colors.brick }]}>Decline</Text></Pressable><Pressable disabled={responding} onPress={() => respond(true)} style={[styles.acceptButton, { backgroundColor: colors.optic }]}>{responding ? <ActivityIndicator size="small" color="#0E2321" /> : <Text style={styles.acceptText}>Accept</Text>}</Pressable></View> : null}
          {outboundRequest && !blocked ? <View style={[styles.pendingBanner, { backgroundColor: isDark ? colors.surface : '#E5F0ED', borderColor: colors.line }]}><Icon name="time-outline" color={colors.teal} /><Text style={[styles.pendingText, { color: colors.ink70 }]}>Message request sent. You can continue after {peer?.name} accepts.</Text></View> : null}
          {declined && !blocked ? <View style={[styles.pendingBanner, { backgroundColor: colors.surface, borderColor: colors.line }]}><Icon name="lock-closed-outline" color={colors.ink40} /><Text style={[styles.pendingText, { color: colors.ink70 }]}>This conversation is closed.</Text></View> : null}
          {blocked ? <View style={[styles.pendingBanner, { backgroundColor: colors.surface, borderColor: colors.line }]}><Icon name="ban-outline" color={colors.brick} /><Text style={[styles.pendingText, { color: colors.ink70 }]}>Private messaging is unavailable for this player.</Text></View> : null}
          {!incomingRequest && !outboundRequest && !declined && !blocked ? <View style={[styles.composer, { backgroundColor: colors.surface, borderColor: colors.line }]}><View style={[styles.composerInput, { backgroundColor: colors.paper }]}><TextInput value={draft} onChangeText={changeDraft} onBlur={stopTyping} onSubmitEditing={send} returnKeyType="send" multiline maxLength={4000} placeholder={`Message ${peer?.name || 'player'}`} placeholderTextColor={colors.ink40} style={[styles.input, { color: colors.ink }]} /><Pressable disabled={!draft.trim() || composerDisabled} accessibilityLabel="Send message" onPress={send} style={[styles.sendButton, { backgroundColor: colors.optic }, (!draft.trim() || composerDisabled) && styles.sendDisabled]}>{sending ? <ActivityIndicator size="small" color="#0E2321" /> : <Icon name="arrow-up" size={18} color="#0E2321" />}</Pressable></View></View> : null}
        </KeyboardAvoidingView>
      )}
      <DirectMessageInteractionModal
        message={selectedMessage}
        mode={interactionMode}
        peer={peer}
        seen={selectedMessage?.id === latestMine?.id && Boolean(latestMineSeen)}
        colors={colors}
        onModeChange={setInteractionMode}
        onClose={() => { setSelectedMessageId(null); setInteractionMode('reactions'); }}
        onReact={reactToMessage}
        onDetails={showMessageDetails}
        onReport={setReportingMessage}
        onBlock={blockPlayer}
      />
      <Modal visible={Boolean(reportingMessage)} transparent animationType="fade" onRequestClose={() => setReportingMessage(null)}>
        <View {...webDialog('backdrop')} style={styles.reportBackdrop}>
          <Pressable accessibilityLabel="Close report menu" onPress={() => setReportingMessage(null)} style={StyleSheet.absoluteFillObject} />
          <View {...webDialog('surface')} style={[styles.reportSheet, { backgroundColor: colors.surface }]}>
            <View style={styles.reportHeader}><View><Text style={[styles.eyebrow, { color: colors.teal }]}>SAFETY</Text><Text style={[styles.reportTitle, { color: colors.ink }]}>Report message</Text></View><Pressable accessibilityLabel="Close" onPress={() => setReportingMessage(null)} style={[styles.iconButton, { borderColor: colors.line, backgroundColor: colors.paper }]}><Icon name="close" color={colors.ink} /></Pressable></View>
            <Text style={[styles.reportLead, { color: colors.ink40 }]}>Choose the reason that best describes the problem. The reported player is not notified.</Text>
            {REPORT_REASONS.map(([reason, label], index) => <Pressable key={reason} onPress={() => submitReport(reason)} style={[styles.reportReason, { borderColor: colors.line }, index === 0 && styles.reportReasonFirst]}><Text style={[styles.reportReasonText, { color: colors.ink }]}>{label}</Text><Icon name="chevron-forward" size={16} color={colors.ink40} /></Pressable>)}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  pressed: { opacity: 0.7 },
  header: { minHeight: 84, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 13 },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  headerTitle: { marginTop: 3, fontSize: 30, lineHeight: 34, fontWeight: '900', letterSpacing: -0.8 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1 },
  composeButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, ...Platform.select({ ios: { shadowColor: '#0E2321', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } }, android: { elevation: 5 } }) },
  rule: { height: 1 },
  filters: { minHeight: 52, marginTop: 16, padding: 4, flexDirection: 'row', borderRadius: 17, borderWidth: 1 },
  filter: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 13 },
  filterPressed: { opacity: 0.72 },
  filterText: { fontSize: 13, fontWeight: '800' },
  filterCount: { fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  inboxContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 44 },
  sectionHead: { minHeight: 28, marginTop: 20, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.25 },
  sectionMeta: { marginLeft: 'auto', fontSize: 11, fontWeight: '700' },
  conversationList: { overflow: 'hidden', borderWidth: 1, borderRadius: 20, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  conversationRow: { minHeight: 84, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: 1 },
  conversationRowLast: { borderBottomWidth: 0 },
  privateBadge: { position: 'absolute', right: -1, bottom: -1, width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  conversationCopy: { flex: 1 },
  conversationNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  conversationName: { flex: 1, fontSize: 15, fontWeight: '900', letterSpacing: -0.2 },
  conversationTime: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  conversationPreviewRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 7 },
  conversationPreview: { flex: 1, fontSize: 13, lineHeight: 18 },
  requestPreview: { fontWeight: '800' },
  unreadBadge: { minWidth: 20, height: 20, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  unreadText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  hostPill: { minHeight: 18, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  hostPillText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },
  segmentRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  segmentButton: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 13 },
  segmentText: { fontSize: 12, fontWeight: '900' },
  teamAvatar: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  teamAvatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', letterSpacing: 0.3 },
  followingStrip: { borderBottomWidth: 1 },
  followingStripContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 10 },
  followingItem: { alignItems: 'center', width: 56 },
  followingAvatarContainer: { width: 48, height: 48 },
  followingAvatarWrap: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  followingOnlineDot: { position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, borderRadius: 7, borderWidth: 2, zIndex: 2 },
  followingAvatarFallback: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  followingAvatarInitial: { fontSize: 18, fontWeight: '900' },
  followingName: { marginTop: 4, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  skeletonBlock: { borderRadius: 999 },
  inboxSkeleton: { paddingTop: 20 },
  skeletonSectionLabel: { width: 78, height: 9, marginBottom: 12 },
  skeletonConversationRow: { minHeight: 84, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: 1 },
  skeletonAvatar: { width: 52, height: 52, borderRadius: 19 },
  skeletonConversationCopy: { flex: 1, gap: 10 },
  skeletonConversationTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18 },
  skeletonLine: { height: 11 },
  skeletonName: { width: '48%' },
  skeletonNameShort: { width: '36%' },
  skeletonTime: { width: 42, height: 8 },
  skeletonPreview: { width: '55%', height: 9 },
  skeletonPreviewLong: { width: '74%' },
  chatSkeleton: { flex: 1 },
  skeletonEncryption: { minHeight: 36, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1 },
  skeletonEncryptionLine: { width: '56%', height: 8 },
  skeletonMessages: { flex: 1, paddingHorizontal: 13, paddingTop: 20 },
  skeletonMessageRow: { marginTop: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  skeletonMessageMine: { justifyContent: 'flex-end' },
  skeletonMessageAvatar: { width: 30, height: 30, borderRadius: 15 },
  skeletonBubbleWide: { width: '62%', height: 58, borderRadius: 16, borderBottomLeftRadius: 5 },
  skeletonBubbleMine: { width: '48%', height: 46, borderRadius: 16, borderBottomRightRadius: 5 },
  skeletonBubbleShort: { width: '43%', height: 40, borderRadius: 16, borderBottomLeftRadius: 5 },
  skeletonComposer: { minHeight: 61, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1 },
  skeletonComposerInput: { flex: 1, height: 43 },
  skeletonComposerButton: { width: 35, height: 35 },
  empty: { minHeight: 250, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyIcon: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 19, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1 },
  emptyTitle: { marginTop: 14, fontSize: 17, fontWeight: '900', letterSpacing: -0.25 },
  emptyText: { maxWidth: 270, marginTop: 6, textAlign: 'center', fontSize: 13, lineHeight: 19 },
  composeBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,14,13,.58)' },
  composeSheet: { maxHeight: '88%', paddingTop: 10, borderTopLeftRadius: 27, borderTopRightRadius: 27 },
  modalHeader: { paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { marginTop: 2, fontSize: 25, fontWeight: '900' },
  search: { minHeight: 48, marginHorizontal: 18, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 11 },
  searchNote: { marginHorizontal: 20, marginTop: 10, fontSize: 8, lineHeight: 13 },
  searchResults: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 30 },
  searchPlayer: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1 },
  searchPlayerMain: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  candidateMessageButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 },
  followButton: { minWidth: 70, height: 38, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  followButtonText: { color: '#0E2321', fontSize: 10, fontWeight: '900' },
  followingPill: { height: 34, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1 },
  followingText: { fontSize: 9, fontWeight: '800' },
  chatHeader: { minHeight: 65, paddingHorizontal: 14, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 9 },
  chatTitle: { fontSize: 16, fontWeight: '900' },
  chatStatus: { marginTop: 2, fontSize: 8 },
  chatBody: { flex: 1 },
  encryptionBanner: { minHeight: 36, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderBottomWidth: 1 },
  encryptionText: { flexShrink: 1, fontSize: 8 },
  messages: { flex: 1 },
  messageContent: { paddingHorizontal: 13, paddingTop: 12, paddingBottom: 18 },
  emptyChat: { minHeight: 260, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyChatTitle: { marginTop: 13, fontSize: 18, fontWeight: '900' },
  messageRow: { marginTop: 11, flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  messageRowMine: { justifyContent: 'flex-end' },
  messageGrouped: { marginTop: 4 },
  avatarSpacer: { width: 30 },
  directMessageBlock: { maxWidth: '86%', alignItems: 'flex-start' },
  directMessageBlockMine: { alignItems: 'flex-end' },
  directBubbleActionRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6 },
  directBubbleActionRowMine: { flexDirection: 'row-reverse' },
  messageBubble: { maxWidth: '100%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderBottomLeftRadius: 5, borderWidth: 1 },
  messageText: { fontSize: 15, lineHeight: 21 },
  messageTime: { marginTop: 4, alignSelf: 'flex-end', fontSize: 7 },
  directQuickActions: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  directQuickAction: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1 },
  directReactionSummary: { marginTop: -3, marginLeft: 5, flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  directReactionSummaryMine: { marginLeft: 0, marginRight: 5, justifyContent: 'flex-end' },
  directReactionChip: { minHeight: 24, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 12, borderWidth: 1 },
  directReactionEmoji: { fontSize: 11 },
  directReactionCount: { fontSize: 8, fontWeight: '800' },
  directSeenReceipt: { minHeight: 24, marginTop: 3, marginRight: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  directSeenText: { fontSize: 8, fontWeight: '700' },
  remoteTypingRow: { marginTop: 9, flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  typingBubble: { width: 51, height: 35, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 15, borderBottomLeftRadius: 5, borderWidth: 1 },
  typingDot: { width: 6, height: 6, borderRadius: 3 },
  messageInteractionBackdrop: { flex: 1, paddingHorizontal: 18, justifyContent: 'center', backgroundColor: 'rgba(5,14,13,.58)' },
  messageInteractionBackdropBottom: { paddingHorizontal: 10, justifyContent: 'flex-end' },
  messageInteractionCard: { maxWidth: '92%', alignSelf: 'flex-start' },
  messageInteractionCardMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  directReactionPicker: { minHeight: 54, marginBottom: 10, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 1, borderRadius: 28, ...Platform.select({ ios: { shadowColor: '#000000', shadowOpacity: .2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } }, android: { elevation: 8 } }) },
  directReactionOption: { width: 43, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23 },
  directReactionOptionText: { fontSize: 25 },
  messageInteractionPreviewRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 8 },
  messageInteractionPreviewRowMine: { flexDirection: 'row-reverse' },
  messageInteractionPreview: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 18, borderBottomLeftRadius: 5 },
  messageInteractionPreviewMine: { borderBottomLeftRadius: 18, borderBottomRightRadius: 5 },
  messageInteractionPreviewText: { fontSize: 12, lineHeight: 18 },
  messageInteractionMore: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 22, ...Platform.select({ ios: { shadowColor: '#000000', shadowOpacity: .18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }, android: { elevation: 7 } }) },
  directActionSheet: { marginBottom: 10, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12, borderRadius: 24, ...Platform.select({ ios: { shadowColor: '#000000', shadowOpacity: .22, shadowRadius: 20, shadowOffset: { width: 0, height: 9 } }, android: { elevation: 10 } }) },
  directActionHandle: { width: 42, height: 4, alignSelf: 'center', borderRadius: 2 },
  directActionTitle: { marginTop: 12, fontSize: 18, fontWeight: '900' },
  directActionReactions: { alignSelf: 'center', marginTop: 12, marginBottom: 7, justifyContent: 'space-between', shadowOpacity: 0, elevation: 0 },
  directActionRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, borderTopWidth: 1 },
  directActionIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  directActionCopy: { flex: 1 },
  directActionRowTitle: { fontSize: 11, fontWeight: '900' },
  directActionRowText: { marginTop: 3, fontSize: 8, lineHeight: 12 },
  directActionCancel: { minHeight: 48, marginTop: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  directActionCancelText: { fontSize: 10, fontWeight: '900' },
  composer: { paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1 },
  composerInput: { minHeight: 43, paddingLeft: 14, paddingRight: 4, flexDirection: 'row', alignItems: 'center', borderRadius: 22 },
  input: { flex: 1, maxHeight: 94, paddingVertical: 10, fontSize: 15 },
  sendButton: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  sendDisabled: { opacity: 0.35 },
  requestActions: { paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: 1 },
  requestCopy: { flex: 1 },
  requestTitle: { fontSize: 10, fontWeight: '900' },
  requestText: { marginTop: 2, fontSize: 8 },
  declineButton: { minHeight: 38, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1 },
  declineText: { fontSize: 9, fontWeight: '900' },
  acceptButton: { minWidth: 72, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  acceptText: { color: '#0E2321', fontSize: 9, fontWeight: '900' },
  pendingBanner: { minHeight: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderTopWidth: 1 },
  pendingText: { flexShrink: 1, fontSize: 9, lineHeight: 14 },
  safetyGate: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
  safetyIcon: { width: 65, height: 65, alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
  safetyTitle: { marginTop: 18, fontSize: 24, fontWeight: '900', textAlign: 'center' },
  safetyText: { maxWidth: 360, marginTop: 9, fontSize: 10, lineHeight: 17, textAlign: 'center' },
  safetyButton: { minHeight: 50, marginTop: 20, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  safetyButtonText: { color: '#0E2321', fontSize: 10, fontWeight: '900' },
  relationshipGate: { flex: 1, paddingHorizontal: 30, alignItems: 'center', justifyContent: 'center' },
  relationshipIcon: { width: 38, height: 38, marginTop: -18, marginRight: -62, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', borderRadius: 19 },
  relationshipTitle: { maxWidth: 330, marginTop: 18, fontSize: 22, lineHeight: 27, fontWeight: '900', textAlign: 'center', letterSpacing: -0.5 },
  relationshipText: { maxWidth: 310, marginTop: 9, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  relationshipButton: { minHeight: 50, marginTop: 20, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  relationshipButtonText: { color: '#0E2321', fontSize: 12, fontWeight: '900' },
  reportBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,14,13,.58)' },
  reportSheet: { maxHeight: '88%', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, borderTopLeftRadius: 27, borderTopRightRadius: 27 },
  reportHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reportTitle: { marginTop: 2, fontSize: 20, fontWeight: '900' },
  reportLead: { marginBottom: 10, fontSize: 9, lineHeight: 14 },
  reportReason: { minHeight: 48, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1 },
  reportReasonFirst: { borderTopWidth: 0 },
  reportReasonText: { flex: 1, fontSize: 10, fontWeight: '800' },
});
