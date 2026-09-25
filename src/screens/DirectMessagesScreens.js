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
  PanResponder,
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
import AppIcon from '../components/AppIcon';
import { useFocusEffect } from '@react-navigation/native';
import { DEMO_MODE } from '../config/demoMode';
import { DEMO_CONVERSATION_ID, DEMO_DIRECT_MESSAGE_DRIP } from '../config/demoData';
import { PRIVATE_MESSAGES_ENABLED } from '../config/features';
import ScrollView from '../components/FocusResetScrollView';
import ProfilePhoto from '../components/ProfilePhoto';
import MessageFocusModal, { canCopyText, copyText, unselectable } from '../components/MessageFocusModal';
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
import { ACCOUNT_MENU_NAV, HeaderAvatar } from '../components/AccountMenu';
import {
  MUTE_DURATIONS,
  applyConversationSettings,
  deleteDirectConversationForMe,
  hideDirectMessage,
  unsendDirectMessage,
  findDirectConversation,
  followPlayer,
  getDirectConversationSettings,
  isMuteActive,
  muteDirectConversation,
  muteStatusLabel,
  setDirectConversationArchived,
  unmuteDirectConversation,
  getDirectConversation,
  getDirectMessagePermission,
  getPublicPlayerProfile,
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
import { createReactionTracker, toggleOwnReaction } from '../utils/reactions';

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
  brickWash: '#F7EAE6',
  gold: '#D5A928',
};
// Swipe action fills stay the same in both themes and always carry white text.
const SWIPE_COLORS = { mute: '#5E6E69', archive: '#1C6B66', delete: '#B6472E' };
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
  return <AppIcon name={name} size={size} color={color} />;
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

const SWIPE_ACTION_WIDTH = 74;

// iOS drops an Alert presented while a Modal is still animating closed.
function afterSheetCloses(callback) {
  setTimeout(callback, Platform.OS === 'ios' ? 350 : 0);
}

// Swipe a private conversation left to reveal its quick actions. Built on
// PanResponder so it needs no extra native module and also works with a mouse
// drag on web; only one row stays open at a time (openId is owned by the list).
function SwipeableConversation({ id, openId, onOpenChange, actions, children, colors }) {
  const width = actions.length * SWIPE_ACTION_WIDTH;
  const translateX = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);
  const isOpen = openId === id;
  const snap = useCallback((to) => {
    offset.current = to;
    Animated.spring(translateX, { toValue: to, useNativeDriver: Platform.OS !== 'web', speed: 22, bounciness: 0 }).start();
  }, [translateX]);
  useEffect(() => {
    if (!isOpen && offset.current !== 0) snap(0);
  }, [isOpen, snap]);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderGrant: () => translateX.stopAnimation(),
    onPanResponderMove: (_, gesture) => {
      translateX.setValue(Math.min(0, Math.max(-width - 24, offset.current + gesture.dx)));
    },
    onPanResponderRelease: (_, gesture) => {
      const end = offset.current + gesture.dx;
      const open = gesture.vx < -0.35 || (gesture.vx <= 0.35 && end < -width / 2);
      snap(open ? -width : 0);
      onOpenChange(id, open);
    },
    onPanResponderTerminate: () => snap(offset.current),
    onPanResponderTerminationRequest: () => false,
  }), [id, onOpenChange, snap, translateX, width]);
  return (
    <View style={styles.swipeRow}>
      <Animated.View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[styles.swipeActions, { width, opacity: translateX.interpolate({ inputRange: [-1, 0], outputRange: [1, 0], extrapolate: 'clamp' }) }]}
      >
        {actions.map((action) => (
          <Pressable
            key={action.key}
            onPress={() => { onOpenChange(id, false); action.onPress(); }}
            style={({ pressed }) => [styles.swipeAction, { backgroundColor: action.color }, pressed && styles.pressed]}
          >
            <Icon name={action.icon} size={21} color="#FFFFFF" />
            <Text numberOfLines={1} style={styles.swipeActionText}>{action.label}</Text>
          </Pressable>
        ))}
      </Animated.View>
      <Animated.View {...pan.panHandlers} style={[styles.swipeContent, { backgroundColor: colors.surface, transform: [{ translateX }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

// One sheet for every private-conversation option: the chat header's "..."
// button, a long press in the inbox, and the swipe "Mute" action (which opens
// straight on the mute lengths).
function ConversationOptionsSheet({ target, view, onViewChange, onClose, onViewProfile, onMute, onUnmute, onArchive, onDelete, onBlock, colors }) {
  const conversation = target?.conversation;
  const peer = target?.peer || conversation?.peer;
  const name = peer?.name || 'this player';
  const muted = isMuteActive(conversation?.mutedUntil);
  const archived = Boolean(conversation?.archived);
  const showMute = view === 'mute';
  const rows = showMute ? MUTE_DURATIONS.map((option) => ({
    key: `mute-${option.minutes ?? 'forever'}`,
    icon: option.minutes == null ? 'notifications-off-outline' : 'time-outline',
    label: option.label,
    onPress: () => onMute(conversation, option.minutes),
  })) : [
    onViewProfile ? { key: 'profile', icon: 'person-circle-outline', label: 'View profile', onPress: () => onViewProfile(peer) } : null,
    muted
      ? { key: 'unmute', icon: 'notifications-outline', label: 'Unmute notifications', detail: muteStatusLabel(conversation?.mutedUntil), onPress: () => onUnmute(conversation) }
      : { key: 'mute', icon: 'notifications-off-outline', label: 'Mute notifications', detail: 'Stop alerts for new messages', chevron: true, onPress: () => onViewChange('mute') },
    archived
      ? { key: 'unarchive', icon: 'arrow-undo-outline', label: 'Move to inbox', detail: 'Show this chat with your recent messages', onPress: () => onArchive(conversation, false) }
      : { key: 'archive', icon: 'archive-outline', label: 'Archive chat', detail: 'Hide it until a new message arrives', onPress: () => onArchive(conversation, true) },
    { key: 'delete', icon: 'trash-outline', label: 'Delete chat', detail: `Removes it for you only. ${peer?.name ? peer.name.split(' ')[0] : 'They'} can still see it.`, destructive: true, onPress: () => onDelete(conversation) },
    onBlock && !conversation?.blockedByMe ? { key: 'block', icon: 'ban-outline', label: `Block ${name}`, destructive: true, onPress: () => onBlock(peer) } : null,
  ].filter(Boolean);
  return (
    <Modal visible={Boolean(conversation)} transparent animationType="fade" onRequestClose={onClose}>
      <View {...webDialog('backdrop')} style={styles.reportBackdrop}>
        <Pressable accessibilityLabel="Close conversation options" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View {...webDialog('surface')} style={[styles.reportSheet, { backgroundColor: colors.surface }]}>
          <View style={styles.optionsHeader}>
            {showMute
              ? <Pressable accessibilityLabel="Back to conversation options" onPress={() => onViewChange('menu')} style={[styles.iconButton, { borderColor: colors.line, backgroundColor: colors.paper }]}><Icon name="chevron-back" color={colors.ink} /></Pressable>
              : <ProfilePhoto photo={peer?.avatar} name={peer?.name} size={42} />}
            <View style={styles.optionsHeaderCopy}>
              <Text numberOfLines={1} style={[styles.optionsTitle, { color: colors.ink }]}>{showMute ? 'Mute notifications' : peer?.name || 'Conversation'}</Text>
              <Text numberOfLines={2} style={[styles.optionsSubtitle, { color: colors.ink40 }]}>
                {showMute ? `You won't be notified about new messages from ${name}. Unread messages still appear in your inbox.` : muteStatusLabel(conversation?.mutedUntil) || (archived ? 'Archived' : 'Private conversation')}
              </Text>
            </View>
            <Pressable accessibilityLabel="Close" onPress={onClose} style={[styles.iconButton, { borderColor: colors.line, backgroundColor: colors.paper }]}><Icon name="close" color={colors.ink} /></Pressable>
          </View>
          <View accessibilityRole="menu" style={[styles.optionsList, { borderColor: colors.line }]}>
            {rows.map((row, index) => {
              const tint = row.destructive ? colors.brick : colors.ink;
              return (
                <Pressable
                  key={row.key}
                  accessibilityRole="menuitem"
                  accessibilityLabel={row.detail ? `${row.label}. ${row.detail}` : row.label}
                  onPress={row.onPress}
                  style={({ pressed }) => [styles.optionsRow, index > 0 && { borderTopWidth: 1, borderColor: colors.line }, pressed && { backgroundColor: colors.paper }]}
                >
                  <View style={[styles.optionsIcon, { backgroundColor: row.destructive ? colors.brickWash : colors.tealWash }]}><Icon name={row.icon} size={18} color={row.destructive ? colors.brick : colors.teal} /></View>
                  <View style={styles.optionsRowCopy}>
                    <Text style={[styles.optionsRowLabel, { color: tint }]}>{row.label}</Text>
                    {row.detail ? <Text numberOfLines={2} style={[styles.optionsRowDetail, { color: colors.ink40 }]}>{row.detail}</Text> : null}
                  </View>
                  {row.chevron ? <Icon name="chevron-forward" size={16} color={colors.ink40} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ConversationRow({ conversation, currentUserId, onPress, onLongPress, accessibilityActions, onAccessibilityAction, colors, isLast = false }) {
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
  const muted = isMuteActive(conversation.mutedUntil);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={380}
      accessibilityRole="button"
      accessibilityLabel={`${conversation.peer.name}${muted ? ', muted' : ''}${conversation.unreadCount ? `, ${conversation.unreadCount} unread` : ''}. ${preview}`}
      accessibilityHint={onLongPress ? 'Opens the conversation. Long press for more options.' : undefined}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      style={({ pressed }) => [styles.conversationRow, { borderColor: colors.line }, isLast && styles.conversationRowLast, pressed && styles.pressed]}
    >
      <View>
        <ProfilePhoto photo={conversation.peer.avatar} name={conversation.peer.name} size={52} />
        {conversation.status === 'accepted' && !blocked ? <View style={[styles.privateBadge, { backgroundColor: colors.optic }]}><Icon name="lock-closed" size={9} color="#0E2321" /></View> : null}
      </View>
      <View style={styles.conversationCopy}>
        <View style={styles.conversationNameRow}>
          <Text numberOfLines={1} style={[styles.conversationName, { color: colors.ink }]}>{conversation.peer.name}</Text>
          {muted ? <Icon name="notifications-off" size={13} color={colors.ink40} /> : null}
          <Text style={[styles.conversationTime, { color: colors.ink40 }]}>{formatConversationTime(conversation.lastMessageAt)}</Text>
        </View>
        <View style={styles.conversationPreviewRow}>
          <Text numberOfLines={1} style={[styles.conversationPreview, { color: incomingRequest ? colors.teal : colors.ink40 }, incomingRequest && styles.requestPreview]}>{preview}</Text>
          {conversation.unreadCount > 0 ? <View style={[styles.unreadBadge, { backgroundColor: muted ? colors.ink40 : colors.brick }]}><Text style={styles.unreadText}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</Text></View> : null}
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

// Short "last active" badge for offline players; a day or older is hidden.
function lastActiveLabel(lastActiveAt) {
  const time = lastActiveAt ? new Date(lastActiveAt).getTime() : NaN;
  if (!Number.isFinite(time)) return null;
  const minutes = Math.max(1, Math.floor((Date.now() - time) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  return null;
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
              {item.isOnline ? (
                <View
                  style={[
                    styles.followingOnlineDot,
                    {
                      backgroundColor: PRESENCE_DOT_COLOR[item.playerStatus] || PRESENCE_DOT_COLOR.free,
                      borderColor: colors.surface,
                    },
                  ]}
                />
              ) : lastActiveLabel(item.lastActiveAt) ? (
                <View style={[styles.followingLastActive, { backgroundColor: colors.tealWash, borderColor: colors.surface }]}>
                  <Text style={[styles.followingLastActiveText, { color: colors.teal }]}>{lastActiveLabel(item.lastActiveAt)}</Text>
                </View>
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
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [inbox, setInbox] = useState(() => cachedInbox || EMPTY_INBOX_SNAPSHOT);
  const [loading, setLoading] = useState(() => PRIVATE_MESSAGES_ENABLED && !cachedInbox);
  const [composeOpen, setComposeOpen] = useState(false);
  const [communityChats, setCommunityChats] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(true);
  const [swipeOpenId, setSwipeOpenId] = useState(null);
  const [optionsTarget, setOptionsTarget] = useState(null);
  const [optionsView, setOptionsView] = useState('menu');
  const [timeMessageId, setTimeMessageId] = useState(null);
  const [profileCardOpen, setProfileCardOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
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
  // Online dots come from activity check-ins, which no realtime event covers,
  // so re-read the following strip while the inbox stays open.
  useFocusEffect(useCallback(() => {
    if (!PRIVATE_MESSAGES_ENABLED || !user?.id) return undefined;
    const userId = user.id;
    const timer = setInterval(() => {
      listFollowingPlayers().then((following) => {
        if (activeUserIdRef.current !== userId) return;
        setInbox((current) => {
          const next = { ...current, followingPlayers: following };
          inboxCache.set(userId, next);
          return next;
        });
      }, () => {});
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [user?.id]));
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
  const privateRows = directConversations.filter((item) => !incomingRequests.includes(item) && !item.archived);
  const archivedRows = directConversations.filter((item) => !incomingRequests.includes(item) && item.archived);
  const openPrivate = (conversation) => {
    // A tap while any row is swiped open just closes it, like native lists.
    if (swipeOpenId) {
      setSwipeOpenId(null);
      return;
    }
    navigation.navigate('DirectChat', { conversationId: conversation.id, player: conversation.peer, ownerTab: 'Team' });
  };
  const changeSwipeOpen = useCallback((id, open) => {
    setSwipeOpenId((current) => (open ? id : current === id ? null : current));
  }, []);

  // Inbox controls update the list right away and roll back with a reload if
  // the server rejects the change.
  const updateDirectConversations = useCallback((change) => {
    setInbox((current) => {
      const next = { ...current, directConversations: change(current.directConversations) };
      if (user?.id) inboxCache.set(user.id, next);
      return next;
    });
  }, [user?.id]);
  const patchConversation = useCallback((id, patch) => {
    updateDirectConversations((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, [updateDirectConversations]);
  const runInboxAction = useCallback(async (failureTitle, request) => {
    try {
      await request();
    } catch (error) {
      Alert.alert(failureTitle, error.message);
      loadInbox();
    }
  }, [loadInbox]);
  const openConversationOptions = (conversation, view = 'menu') => {
    setSwipeOpenId(null);
    setOptionsView(view);
    setOptionsTarget({ conversation });
  };
  const closeConversationOptions = () => setOptionsTarget(null);
  const muteConversation = (conversation, minutes) => {
    closeConversationOptions();
    const localUntil = minutes == null ? 'infinity' : new Date(Date.now() + minutes * 60000).toISOString();
    patchConversation(conversation.id, { mutedUntil: localUntil, muted: true });
    runInboxAction('Chat not muted', async () => {
      const mutedUntil = await muteDirectConversation(conversation.id, minutes);
      patchConversation(conversation.id, { mutedUntil: mutedUntil || localUntil });
    });
  };
  const unmuteConversation = (conversation) => {
    closeConversationOptions();
    patchConversation(conversation.id, { mutedUntil: null, muted: false });
    runInboxAction('Chat not unmuted', () => unmuteDirectConversation(conversation.id));
  };
  const archiveConversation = (conversation, archived) => {
    closeConversationOptions();
    patchConversation(conversation.id, { archived, archivedAt: archived ? new Date().toISOString() : null });
    runInboxAction(archived ? 'Chat not archived' : 'Chat not moved to inbox', () => setDirectConversationArchived(conversation.id, archived));
  };
  const deleteConversation = (conversation) => {
    closeConversationOptions();
    const name = conversation.peer?.name || 'this player';
    afterSheetCloses(() => Alert.alert('Delete this chat?', `The conversation and its messages will be removed from your inbox. ${name} can still see them.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        updateDirectConversations((list) => list.filter((item) => item.id !== conversation.id));
        runInboxAction('Chat not deleted', () => deleteDirectConversationForMe(conversation.id));
      } },
    ]));
  };
  const swipeActionsFor = (conversation) => [
    isMuteActive(conversation.mutedUntil)
      ? { key: 'unmute', label: 'Unmute', icon: 'notifications-outline', color: SWIPE_COLORS.mute, onPress: () => unmuteConversation(conversation) }
      : { key: 'mute', label: 'Mute', icon: 'notifications-off-outline', color: SWIPE_COLORS.mute, onPress: () => openConversationOptions(conversation, 'mute') },
    conversation.archived
      ? { key: 'unarchive', label: 'Unarchive', icon: 'arrow-undo-outline', color: SWIPE_COLORS.archive, onPress: () => archiveConversation(conversation, false) }
      : { key: 'archive', label: 'Archive', icon: 'archive-outline', color: SWIPE_COLORS.archive, onPress: () => archiveConversation(conversation, true) },
    { key: 'delete', label: 'Delete', icon: 'trash-outline', color: SWIPE_COLORS.delete, onPress: () => deleteConversation(conversation) },
  ];
  const renderPrivateRow = (conversation, isLast) => {
    const actions = swipeActionsFor(conversation);
    return (
      <SwipeableConversation key={`private-${conversation.id}`} id={conversation.id} openId={swipeOpenId} onOpenChange={changeSwipeOpen} actions={actions} colors={colors}>
        <ConversationRow
          conversation={conversation}
          currentUserId={user?.id}
          onPress={() => openPrivate(conversation)}
          onLongPress={() => openConversationOptions(conversation)}
          accessibilityActions={actions.map((action) => ({ name: action.key, label: action.label }))}
          onAccessibilityAction={(event) => actions.find((action) => action.key === event.nativeEvent.actionName)?.onPress()}
          colors={colors}
          isLast={isLast}
        />
      </SwipeableConversation>
    );
  };
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
  const search = query.trim().toLowerCase();
  const matches = (name) => !search || String(name || '').toLowerCase().includes(search);
  // One list: people and teams sorted by latest activity. People keep round
  // photos and teams keep rounded-square badges, so no filter tabs are needed.
  const threads = [
    ...privateRows.map((conversation) => ({
      key: `private-${conversation.id}`,
      kind: 'private',
      name: conversation.peer.name,
      timestamp: conversation.lastMessageAt,
      conversation,
    })),
    ...teams.map((team) => ({
      key: `team-${team.id}`,
      kind: 'team',
      name: team.name,
      timestamp: teamSummaries[team.id]?.last_created_at,
      team,
      summary: teamSummaries[team.id],
    })),
  ]
    .filter((item) => matches(item.name))
    .sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTime - aTime;
    });
  const visibleRequests = incomingRequests.filter((item) => matches(item.peer.name));
  const visibleArchived = archivedRows.filter((item) => matches(item.peer.name));
  const archivedExpanded = archivedOpen || Boolean(search);
  const archivedUnread = visibleArchived.reduce((total, item) => total + Number(item.unreadCount || 0), 0);
  const visibleCommunityChats = communityChats.filter((chat) => matches(chat.title));
  const messagesUnreadCount = directConversations.reduce((total, item) => total + Number(item.unreadCount || 0), 0)
    + teams.reduce((total, team) => total + Number(teamSummaries[team.id]?.unread_count || 0), 0);

  const showStrip = followingPlayers.length > 0 && !search;
  const onMessages = segment === 'messages';
  const otherUnread = onMessages ? communityUnreadCount : messagesUnreadCount;
  const chooseSegment = (next) => {
    setSwitcherOpen(false);
    setSegment(next);
  };
  const toggleSearch = () => {
    setSearchOpen((open) => !open);
    setQuery('');
  };
  const switcherOptions = [
    ['messages', 'Messages', 'People and teams', messagesUnreadCount],
    ['community', 'Community', 'Open play and tournaments', communityUnreadCount],
  ];
  const emptyState = (icon, title, text) => (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surface, borderColor: colors.line }]}><Icon name={icon} size={26} color={colors.teal} /></View>
      <Text style={[styles.emptyTitle, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.emptyText, { color: colors.ink40 }]}>{text}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.paper} />
      <View style={styles.inboxHeaderWrap}>
        <View style={styles.inboxHeader}>
          {ACCOUNT_MENU_NAV ? null : <Pressable accessibilityLabel="Go back" hitSlop={8} onPress={() => navigation.goBack()} style={[styles.iconButton, { borderColor: colors.line, backgroundColor: colors.surface }]}><Icon name="arrow-back" size={19} color={colors.ink} /></Pressable>}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${onMessages ? 'Messages' : 'Community'}. Switch conversation list${otherUnread ? `, ${otherUnread} unread in ${onMessages ? 'Community' : 'Messages'}` : ''}`}
            accessibilityState={{ expanded: switcherOpen }}
            disabled={!PRIVATE_MESSAGES_ENABLED}
            onPress={() => setSwitcherOpen((open) => !open)}
            style={({ pressed }) => [styles.inboxTitleButton, pressed && styles.pressed]}
          >
            <Text style={[styles.inboxTitle, { color: colors.ink }]}>{onMessages ? 'Messages' : 'Community'}</Text>
            {PRIVATE_MESSAGES_ENABLED ? <Icon name={switcherOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.ink} /> : null}
            {PRIVATE_MESSAGES_ENABLED && otherUnread > 0 && !switcherOpen ? <View style={[styles.switcherDot, { backgroundColor: colors.brick }]} /> : null}
          </Pressable>
          <View style={styles.inboxActions}>
            <Pressable accessibilityLabel={searchOpen ? 'Close search' : 'Search conversations'} hitSlop={6} onPress={toggleSearch} style={({ pressed }) => [styles.headerIconButton, searchOpen && { backgroundColor: colors.tealWash }, pressed && styles.pressed]}>
              <Icon name={searchOpen ? 'close' : 'search-outline'} size={22} color={searchOpen ? colors.teal : colors.ink} />
            </Pressable>
            {onMessages ? <Pressable accessibilityLabel="New private message" hitSlop={6} onPress={() => setComposeOpen(true)} style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}><Icon name="create-outline" size={22} color={colors.ink} /></Pressable> : null}
            <HeaderAvatar />
          </View>
        </View>
        {switcherOpen ? (
          <>
            <Pressable accessibilityLabel="Close list switcher" onPress={() => setSwitcherOpen(false)} style={styles.switcherBackdrop} />
            <View accessibilityRole="menu" style={[styles.switcherMenu, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              {switcherOptions.map(([value, label, hint, unread], index) => {
                const selected = segment === value;
                return (
                  <Pressable key={value} accessibilityRole="menuitem" accessibilityState={{ selected }} onPress={() => chooseSegment(value)} style={({ pressed }) => [styles.switcherOption, index > 0 && { borderTopWidth: 1, borderColor: colors.line }, pressed && styles.pressed]}>
                    <View style={styles.switcherCopy}>
                      <Text style={[styles.switcherLabel, { color: colors.ink }]}>{label}</Text>
                      <Text style={[styles.switcherHint, { color: colors.ink40 }]}>{hint}</Text>
                    </View>
                    {unread > 0 ? <View style={[styles.unreadBadge, { backgroundColor: colors.brick }]}><Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text></View> : null}
                    {selected ? <Icon name="checkmark" size={18} color={colors.teal} /> : <View style={styles.switcherCheckSpace} />}
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </View>
      {searchOpen ? (
        <View style={styles.inboxSearchWrap}>
          <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.line }]}><Icon name="search-outline" color={colors.ink40} /><TextInput autoFocus value={query} onChangeText={setQuery} placeholder={onMessages ? 'Search people and teams' : 'Search community chats'} placeholderTextColor={colors.ink40} returnKeyType="search" style={[styles.searchInput, { color: colors.ink }]} /></View>
        </View>
      ) : null}
      {onMessages ? (
        <ScrollView contentContainerStyle={styles.inboxContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} onScrollBeginDrag={() => setSwipeOpenId(null)}>
          {!loading && showStrip ? (
            <>
              <View style={styles.sectionHead}><Text style={[styles.sectionLabel, { color: colors.teal }]}>FOLLOWING</Text></View>
              <FollowingStrip players={followingPlayers} onPress={openConnection} colors={colors} />
            </>
          ) : null}
          {loading ? <InboxLoadingSkeleton colors={colors} /> : null}
          {!loading && visibleRequests.length ? (
            <>
              <View style={styles.sectionHead}><Text style={[styles.sectionLabel, { color: colors.brick }]}>MESSAGE REQUESTS</Text><Text style={[styles.sectionMeta, { color: colors.brick }]}>{visibleRequests.length}</Text></View>
              <View style={[styles.conversationList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                {visibleRequests.map((item, index) => <ConversationRow key={item.id} conversation={item} currentUserId={user?.id} onPress={() => openPrivate(item)} colors={colors} isLast={index === visibleRequests.length - 1} />)}
              </View>
            </>
          ) : null}
          {!loading && threads.length ? (
            <>
              <View style={styles.sectionHead}>
                <Text style={[styles.sectionLabel, { color: colors.teal }]}>{search ? 'RESULTS' : 'RECENT'}</Text>
              </View>
              <View style={[styles.conversationList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                {threads.map((item, index) => item.kind === 'private'
                  ? renderPrivateRow(item.conversation, index === threads.length - 1)
                  : <TeamConversationRow key={item.key} team={item.team} summary={item.summary} colors={colors} onPress={() => openTeam(item.team)} isLast={index === threads.length - 1} />)}
              </View>
            </>
          ) : null}
          {!loading && visibleArchived.length ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: archivedExpanded }}
                accessibilityLabel={`Archived chats, ${visibleArchived.length}${archivedUnread ? `, ${archivedUnread} unread` : ''}`}
                disabled={Boolean(search)}
                onPress={() => { setSwipeOpenId(null); setArchivedOpen((open) => !open); }}
                style={({ pressed }) => [styles.archivedToggle, { backgroundColor: colors.surface, borderColor: colors.line }, pressed && styles.pressed]}
              >
                <View style={[styles.archivedIcon, { backgroundColor: colors.tealWash }]}><Icon name="archive-outline" size={17} color={colors.teal} /></View>
                <Text style={[styles.archivedLabel, { color: colors.ink }]}>Archived chats</Text>
                {archivedUnread ? <View style={[styles.unreadBadge, { backgroundColor: colors.ink40 }]}><Text style={styles.unreadText}>{archivedUnread > 99 ? '99+' : archivedUnread}</Text></View> : <Text style={[styles.sectionMeta, { color: colors.ink40 }]}>{visibleArchived.length}</Text>}
                {search ? null : <Icon name={archivedExpanded ? 'chevron-up' : 'chevron-down'} size={17} color={colors.ink40} />}
              </Pressable>
              {archivedExpanded ? (
                <View style={[styles.conversationList, styles.archivedList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                  {visibleArchived.map((conversation, index) => renderPrivateRow(conversation, index === visibleArchived.length - 1))}
                </View>
              ) : null}
            </>
          ) : null}
          {!loading && !threads.length && !visibleRequests.length && !visibleArchived.length
            ? (search ? emptyState('search-outline', 'No matches', `Nothing matches “${query.trim()}”.`) : emptyState('chatbubbles-outline', 'Your inbox is ready', 'Private and team conversations will appear here.'))
            : null}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.inboxContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {communityLoading ? <InboxLoadingSkeleton colors={colors} /> : null}
          {!communityLoading && visibleCommunityChats.length ? (
            <>
              <View style={styles.sectionHead}>
                <Text style={[styles.sectionLabel, { color: colors.teal }]}>{search ? 'RESULTS' : 'OPEN PLAY & TOURNAMENTS'}</Text>
              </View>
              <View style={[styles.conversationList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                {visibleCommunityChats.map((chat, index) => (
                  <CommunityConversationRow key={chat.conversationId || `${chat.eventKind}:${chat.eventId}`} chat={chat} colors={colors} onPress={() => openCommunityChat(chat)} isLast={index === visibleCommunityChats.length - 1} />
                ))}
              </View>
            </>
          ) : null}
          {!communityLoading && !visibleCommunityChats.length
            ? (search ? emptyState('search-outline', 'No matches', `Nothing matches “${query.trim()}”.`) : emptyState('people-circle-outline', 'No community chats yet', 'Join an open-play session or enter a tournament to unlock its group chat and announcements.'))
            : null}
        </ScrollView>
      )}
      <NewMessageModal visible={composeOpen} onClose={() => setComposeOpen(false)} onSelect={choosePlayer} colors={colors} />
      <ConversationOptionsSheet
        target={optionsTarget}
        view={optionsView}
        onViewChange={setOptionsView}
        onClose={closeConversationOptions}
        onViewProfile={(player) => { closeConversationOptions(); navigation.navigate('PublicProfile', { player, ownerTab: 'Team' }); }}
        onMute={muteConversation}
        onUnmute={unmuteConversation}
        onArchive={archiveConversation}
        onDelete={deleteConversation}
        colors={colors}
      />
    </SafeAreaView>
  );
}

// Messenger-style typing bubble: pops in, then the dots rise and darken in a
// continuous wave with a short rest between cycles.
function AnimatedTypingDots({ colors }) {
  const useNativeDriver = Platform.OS !== 'web';
  const entrance = useRef(new Animated.Value(0)).current;
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.spring(entrance, { toValue: 1, friction: 6, tension: 140, useNativeDriver }).start();
    const wave = Animated.loop(Animated.sequence([
      Animated.stagger(160, values.map((value) => Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver }),
        Animated.timing(value, { toValue: 0, duration: 280, easing: Easing.in(Easing.quad), useNativeDriver }),
      ]))),
      Animated.delay(260),
    ]));
    wave.start();
    return () => wave.stop();
  }, [entrance, values, useNativeDriver]);
  return (
    <Animated.View style={[styles.typingBubble, { backgroundColor: colors.surface, borderColor: colors.line, opacity: entrance, transform: [{ scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
      {values.map((value, index) => <Animated.View key={index} style={[styles.typingDot, { backgroundColor: colors.ink70, opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] }), transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]} />)}
    </Animated.View>
  );
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
  // Older databases report peer eligibility only for teammates (null otherwise),
  // so a locked chat between mutual followers also means the peer is ineligible.
  const peerUnavailable = !permission?.blocked && (permission?.peerChatEligible === false
    || (permission?.peerChatEligible !== true && (permission?.sharesTeam || (alreadyFollowing && followsYou))));
  const title = permission?.blocked
    ? 'Private messaging is unavailable.'
    : peerUnavailable
      ? `${peer?.name || (permission?.sharesTeam ? 'This teammate' : 'This player')} cannot use private chat yet.`
    : followsYou && !alreadyFollowing
    ? `Follow ${peer?.name || 'this player'} back to chat.`
    : requestPending
      ? 'Follow request sent.'
    : alreadyFollowing
      ? 'Waiting for a follow back.'
      : 'Follow each other to chat.';
  const body = permission?.blocked
    ? 'One of these accounts has blocked private messages between you.'
    : peerUnavailable
      ? `Private chat requires ${peer?.name || 'their account'} to complete the chat-safety setup.`
    : followsYou && !alreadyFollowing
    ? 'They already follow you. Follow them back to open a private conversation.'
    : requestPending
      ? `${peer?.name || 'This player'} can accept or delete your request from their notifications.`
    : alreadyFollowing
      ? `${peer?.name || 'This player'} will become messageable when they follow you back.`
      : 'Private messages are limited to mutual followers, teammates, and players matched on a play request.';
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

// An unsent message keeps its place in the thread as a quiet placeholder.
function UnsentMessageText({ message, colors, style }) {
  const tint = message.mine ? 'rgba(255,255,255,.75)' : colors.ink40;
  return <View style={styles.unsentRow}><Icon name="return-up-back-outline" size={14} color={tint} /><Text selectable={false} style={[styles.messageText, styles.unsentText, style, { color: tint }]}>{message.mine ? 'You unsent a message' : 'Message unsent'}</Text></View>;
}

function DirectMessageInteractionModal({ message, peer, seen, isDark, colors, currentUserId, onClose, onReact, onDetails, onReport, onBlock, onDeleteForMe, onUnsend }) {
  const unsent = Boolean(message?.deletedAt);
  const actions = message ? [
    canCopyText && message.text ? { key: 'copy', label: 'Copy', icon: 'copy-outline', onPress: () => copyText(message.text) } : null,
    !unsent ? { key: 'details', label: 'Message details', icon: 'information-circle-outline', onPress: () => onDetails(message, seen) } : null,
    !message.mine && !unsent ? { key: 'report', label: 'Report message', icon: 'flag-outline', destructive: true, separated: true, onPress: () => onReport(message) } : null,
    !message.mine ? { key: 'block', label: `Block ${peer?.name || 'player'}`, icon: 'ban-outline', destructive: true, separated: unsent, onPress: onBlock } : null,
    { key: 'delete', label: 'Delete for you', icon: 'trash-outline', separated: message.mine, onPress: () => onDeleteForMe(message) },
    message.mine && !unsent ? { key: 'unsend', label: 'Delete for everyone', icon: 'return-up-back-outline', destructive: true, onPress: () => onUnsend(message) } : null,
  ].filter(Boolean) : [];
  return (
    <MessageFocusModal
      visible={Boolean(message)}
      mine={message?.mine}
      dark={isDark}
      reactions={unsent ? [] : DIRECT_REACTION_OPTIONS}
      selectedReactions={(message?.reactions || []).filter((reaction) => reaction.user_id === currentUserId).map((reaction) => reaction.emoji)}
      onReact={(emoji) => onReact(message.id, emoji)}
      actions={actions}
      onClose={onClose}
    >
      {message ? <View style={[styles.messageBubble, { backgroundColor: colors.surface, borderColor: colors.line }, message.mine && { backgroundColor: colors.teal, borderColor: colors.teal }, unsent && [styles.unsentBubble, { borderColor: colors.line }]]}>{unsent ? <UnsentMessageText message={message} colors={colors} /> : <Text style={[styles.messageText, { color: message.mine ? '#FFFFFF' : colors.ink }]}>{message.text}</Text>}<Text style={[styles.messageTime, { color: message.mine ? 'rgba(255,255,255,.7)' : colors.ink40 }]}>{message.time}</Text></View> : null}
    </MessageFocusModal>
  );
}

// Today's messages show just the time; older ones include the day too.
const formatMessageSentAt = (createdAt) => {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return `${date.toLocaleDateString([], sameYear ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })}, ${time}`;
};

function PeerProfileCard({ peer, canBlock, onViewProfile, onBlock, onClose, colors }) {
  return (
    <Modal visible={Boolean(peer)} transparent animationType="fade" onRequestClose={onClose}>
      <View {...webDialog('backdrop')} style={styles.profileCardBackdrop}>
        <Pressable accessibilityLabel="Close profile card" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View {...webDialog('surface')} style={[styles.profileCard, { backgroundColor: colors.surface }]}>
          <ProfilePhoto photo={peer?.avatar} name={peer?.name} size={76} />
          <Text numberOfLines={1} style={[styles.profileCardName, { color: colors.ink }]}>{peer?.name || 'Peakle player'}</Text>
          <Text numberOfLines={1} style={[styles.profileCardMeta, { color: colors.ink40 }]}>{peer?.area || 'Peakle player'}</Text>
          {onViewProfile ? <Pressable accessibilityRole="button" onPress={onViewProfile} style={({ pressed }) => [styles.profileCardButton, { backgroundColor: colors.optic }, pressed && styles.pressed]}><Icon name="person-circle-outline" size={18} color="#0E2321" /><Text style={styles.profileCardPrimaryText}>View profile</Text></Pressable> : null}
          {canBlock ? <Pressable accessibilityRole="button" onPress={onBlock} style={({ pressed }) => [styles.profileCardButton, { backgroundColor: colors.brickWash }, pressed && styles.pressed]}><Icon name="ban-outline" size={18} color={colors.brick} /><Text style={[styles.profileCardButtonText, { color: colors.brick }]}>Block {peer?.name?.split(' ')[0] || 'player'}</Text></Pressable> : null}
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.profileCardButton, { borderColor: colors.line, borderWidth: 1 }, pressed && styles.pressed]}><Text style={[styles.profileCardButtonText, { color: colors.ink }]}>Cancel</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

function DirectChatMessage({ message, grouped, interactive, peer, seen, timeVisible, currentUserId, colors, onToggleTime, onOpenActions, onOpenProfile, onReact }) {
  const reactionGroups = DIRECT_REACTION_OPTIONS.map((emoji) => ({
    emoji,
    reactions: (message.reactions || []).filter((reaction) => reaction.emoji === emoji),
  })).filter((group) => group.reactions.length);
  const sentAt = formatMessageSentAt(message.createdAt) || message.time;
  return (
    <View style={[styles.messageRow, message.mine && styles.messageRowMine, grouped && styles.messageGrouped]}>
      <View style={[styles.directMessageBlock, message.mine && styles.directMessageBlockMine]}>
        <View style={[styles.directBubbleActionRow, message.mine && styles.directBubbleActionRowMine]}>
          {!message.mine && !grouped ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${message.sender || peer?.name || 'player'}`} hitSlop={4} onPress={onOpenProfile}><ProfilePhoto photo={message.avatar || peer?.avatar} name={message.sender} size={30} /></Pressable> : !message.mine ? <View style={styles.avatarSpacer} /> : null}
          <Pressable accessibilityHint={interactive ? 'Tap to show the time. Long press for reactions and message options.' : 'Tap to show the time.'} onPress={() => onToggleTime(message.id)} onLongPress={interactive ? () => onOpenActions(message.id) : undefined} delayLongPress={240} style={[styles.messageBubble, unselectable, { backgroundColor: colors.surface, borderColor: colors.line }, message.mine && { backgroundColor: colors.teal, borderColor: colors.teal }, message.deletedAt && [styles.unsentBubble, { borderColor: colors.line }]]}>{message.deletedAt ? <UnsentMessageText message={message} colors={colors} style={unselectable} /> : <Text selectable={false} style={[styles.messageText, unselectable, { color: message.mine ? '#FFFFFF' : colors.ink }]}>{message.text}</Text>}</Pressable>
        </View>
        <View style={[styles.directMessageExtras, message.mine ? styles.directMessageExtrasMine : styles.directMessageExtrasPeer]}>
          {timeVisible ? <Text accessibilityLiveRegion="polite" style={[styles.messageTime, message.mine ? styles.messageTimeMine : styles.messageTimePeer, { color: colors.ink40 }]}>{message.mine ? 'Sent' : 'Received'} {sentAt}</Text> : null}
          {reactionGroups.length ? <View style={[styles.directReactionSummary, message.mine && styles.directReactionSummaryMine]}>{reactionGroups.map((group) => { const mine = group.reactions.some((reaction) => reaction.user_id === currentUserId); return <Pressable key={group.emoji} accessibilityLabel={`${group.emoji}, ${group.reactions.length} reactions`} onPress={() => onReact(message.id, group.emoji)} style={[styles.directReactionChip, { backgroundColor: mine ? colors.tealWash : colors.surface, borderColor: mine ? colors.teal : colors.line }]}><Text style={styles.directReactionEmoji}>{group.emoji}</Text><Text style={[styles.directReactionCount, { color: colors.ink70 }]}>{group.reactions.length}</Text></Pressable>; })}</View> : null}
          {message.mine && seen ? <View accessibilityLabel={`Seen by ${peer?.name || 'player'}`} style={styles.directSeenReceipt}><ProfilePhoto photo={peer?.avatar} name={peer?.name} size={17} /><Icon name="checkmark-done" size={13} color={colors.teal} /><Text style={[styles.directSeenText, { color: colors.ink40 }]}>Seen</Text></View> : null}
        </View>
      </View>
    </View>
  );
}

export function DirectChatScreen({ route, navigation }) {
  const target = route?.params?.conversationId
    ? `conversation:${route.params.conversationId}`
    : `player:${route?.params?.player?.id || route?.params?.playerId || ''}`;
  // Tab screens stay mounted. A different recipient needs fresh chat state,
  // including the conversation id and any unsent draft.
  return <DirectChatConversation key={target} route={route} navigation={navigation} />;
}

function DirectChatConversation({ route, navigation }) {
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
  const [inboxSettings, setInboxSettings] = useState(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsView, setOptionsView] = useState('menu');
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
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [safetyStatus, setSafetyStatus] = useState(null);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [messagePermission, setMessagePermission] = useState(null);
  const [following, setFollowing] = useState(false);
  const scrollRef = useRef(null);
  const conversationLoadingRef = useRef(false);
  const channelRef = useRef(null);
  const reactionTracker = useRef(createReactionTracker()).current;
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
        const [found, permission, profile] = await Promise.all([
          findDirectConversation(routePlayer.id),
          getDirectMessagePermission(routePlayer.id),
          getPublicPlayerProfile(routePlayer.id).catch(() => null),
        ]);
        setMessagePermission(permission);
        if (profile) setPeer(playerFromRoute(profile));
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
        getDirectConversationSettings(id).then(setInboxSettings, () => {});
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
  // A follow can become mutual while this chat stays mounted (e.g. the player
  // accepts the request from notifications and comes back), so re-check the
  // relationship gate on focus and periodically while it is showing.
  const awaitingRelationship = !conversationId && Boolean(routePlayer?.id) && messagePermission != null && !messagePermission.canMessage;
  const refreshMessagePermission = useCallback(async () => {
    if (!awaitingRelationship || conversationLoadingRef.current) return;
    try {
      setMessagePermission(await getDirectMessagePermission(routePlayer.id));
    } catch {
      // Keep the current gate; the next check will try again.
    }
  }, [awaitingRelationship, routePlayer?.id]);
  useFocusEffect(useCallback(() => {
    refreshMessagePermission();
    if (!awaitingRelationship) return undefined;
    const timer = setInterval(refreshMessagePermission, 15000);
    return () => clearInterval(timer);
  }, [awaitingRelationship, refreshMessagePermission]));
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
      // Unsend ("Delete for everyone") arrives as an update to the message.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` }, ({ new: row }) => {
        getDirectMessage(row.id).then(upsertMessage).catch(() => {});
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_conversations', filter: `id=eq.${conversationId}` }, () => refreshConversation())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_conversation_reads', filter: `conversation_id=eq.${conversationId}` }, () => refreshConversation())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_message_reactions' }, (payload) => {
        const messageId = payload.new?.message_id || payload.old?.message_id;
        // Our own in-flight toggles reconcile when their RPC settles.
        if (messageId && !reactionTracker.isPending(messageId)) {
          getDirectMessage(messageId).then((message) => { if (!reactionTracker.isPending(messageId)) upsertMessage(message); }).catch(() => {});
        }
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
  }, [conversationId, reactionTracker, refreshConversation, safetyStatus?.eligible, upsertMessage, user?.id]);
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
  const openMessageActions = (messageId) => {
    setSelectedMessageId(messageId);
  };
  const toggleMessageTime = (messageId) => {
    setTimeMessageId((current) => (current === messageId ? null : messageId));
  };
  const reactToMessage = async (messageId, emoji) => {
    if (!user?.id) return;
    setMessages((current) => current.map((item) => (item.id === messageId
      ? { ...item, reactions: toggleOwnReaction(item.reactions, user.id, emoji, { singlePerUser: true }) }
      : item)));
    reactionTracker.start(messageId);
    let message = null;
    let failure = null;
    try {
      message = await toggleDirectMessageReaction(messageId, emoji);
    } catch (error) {
      failure = error;
    }
    if (!reactionTracker.finish(messageId)) return;
    if (failure) {
      getDirectMessage(messageId).then(upsertMessage).catch(() => {});
      Alert.alert('Reaction not saved', failure.message);
      return;
    }
    upsertMessage(message);
  };
  const deleteMessageForMe = (message) => Alert.alert('Delete for you?', `This message will disappear only from your chat. ${peer?.name || 'The other player'} can still see it.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      setMessages((current) => current.filter((item) => item.id !== message.id));
      try {
        await hideDirectMessage(message.id);
      } catch (error) {
        upsertMessage(message);
        Alert.alert('Message not deleted', error.message);
      }
    } },
  ]);
  const unsendMessage = (message) => Alert.alert('Delete for everyone?', `The message will be removed for you and ${peer?.name || 'the other player'}.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete for everyone', style: 'destructive', onPress: async () => {
      upsertMessage({ ...message, text: null, reactions: [], deletedAt: new Date().toISOString() });
      try {
        await unsendDirectMessage(message.id);
      } catch (error) {
        upsertMessage(message);
        Alert.alert('Message not deleted', error.message);
      }
    } },
  ]);
  const showMessageDetails = (message, seen) => {
    const sentAt = new Date(message.createdAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    Alert.alert('Message details', `${message.mine ? 'Sent' : 'Received'} ${sentAt}${message.mine ? `\n${seen ? `Seen by ${peer?.name || 'player'}` : 'Delivered'}` : ''}`);
  };
  // The options sheet works on the conversation as this player's inbox sees
  // it, so archive state accounts for messages that arrived after archiving.
  const optionsConversation = conversation ? applyConversationSettings({
    ...conversation,
    lastMessageAt: messages[messages.length - 1]?.createdAt || conversation.lastMessageAt,
  }, inboxSettings) : null;
  const closeOptions = () => setOptionsOpen(false);
  const openOptions = () => {
    setOptionsView('menu');
    setOptionsOpen(true);
  };
  const reloadInboxSettings = () => {
    if (conversationId) getDirectConversationSettings(conversationId).then(setInboxSettings, () => {});
  };
  const muteChat = async (_, minutes) => {
    closeOptions();
    const localUntil = minutes == null ? 'infinity' : new Date(Date.now() + minutes * 60000).toISOString();
    setInboxSettings((current) => ({ ...current, mutedUntil: localUntil }));
    try {
      const mutedUntil = await muteDirectConversation(conversationId, minutes);
      setInboxSettings((current) => ({ ...current, mutedUntil: mutedUntil || localUntil }));
    } catch (error) {
      reloadInboxSettings();
      afterSheetCloses(() => Alert.alert('Chat not muted', error.message));
    }
  };
  const unmuteChat = async () => {
    closeOptions();
    setInboxSettings((current) => ({ ...current, mutedUntil: null }));
    try {
      await unmuteDirectConversation(conversationId);
    } catch (error) {
      reloadInboxSettings();
      afterSheetCloses(() => Alert.alert('Chat not unmuted', error.message));
    }
  };
  // Archiving puts the chat away, so it returns to the inbox; moving it back
  // keeps the player in the conversation.
  const archiveChat = async (_, archived) => {
    closeOptions();
    try {
      const archivedAt = await setDirectConversationArchived(conversationId, archived);
      setInboxSettings((current) => ({ ...current, archivedAt: archived ? archivedAt || new Date().toISOString() : null }));
      if (archived) navigation.goBack();
    } catch (error) {
      afterSheetCloses(() => Alert.alert(archived ? 'Chat not archived' : 'Chat not moved to inbox', error.message));
    }
  };
  const deleteChat = () => {
    closeOptions();
    afterSheetCloses(() => Alert.alert('Delete this chat?', `The conversation and its messages will be removed from your inbox. ${peer?.name || 'This player'} can still see them.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await deleteDirectConversationForMe(conversationId);
          stopTyping();
          setMessages([]);
          navigation.goBack();
        } catch (error) {
          Alert.alert('Chat not deleted', error.message);
        }
      } },
    ]));
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
        <View style={styles.headerCopy}><View style={styles.chatTitleRow}><Text numberOfLines={1} style={[styles.chatTitle, styles.chatTitleText, { color: colors.ink }]}>{peer?.name || 'Private message'}</Text>{isMuteActive(inboxSettings?.mutedUntil) ? <Icon name="notifications-off" size={14} color={colors.ink40} /> : null}</View><Text style={[styles.chatStatus, { color: colors.ink40 }]}>{remoteTyping ? 'typing…' : conversation?.status === 'accepted' ? 'Private conversation' : conversation?.status === 'pending' ? 'Message request' : relationshipLocked ? 'Mutual follow required' : peer?.area || 'Peakle player'}</Text></View>
        {conversationId ? <Pressable accessibilityLabel="Conversation options" accessibilityHint="Mute, archive, delete, or block" onPress={openOptions} style={[styles.iconButton, { borderColor: colors.line, backgroundColor: colors.surface }]}><Icon name="ellipsis-horizontal" color={colors.ink} /></Pressable> : null}
      </View>
      <View style={[styles.rule, { backgroundColor: colors.line }]} />
      {!safetyStatus?.eligible && !loading ? <ChatSafetyGate status={safetyStatus} busy={safetyBusy} onConfirm={confirmSafety} colors={colors} /> : loading ? <ChatLoadingSkeleton colors={colors} /> : relationshipLocked ? <MessageRelationshipGate peer={peer} permission={messagePermission} busy={following} onFollow={followPeer} colors={colors} /> : (
        <KeyboardAvoidingView style={styles.chatBody} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
          <View style={[styles.encryptionBanner, { backgroundColor: isDark ? colors.surface : '#E5F0ED', borderColor: colors.line }]}><Icon name="lock-closed-outline" size={14} color={colors.teal} /><Text style={[styles.encryptionText, { color: colors.ink70 }]}>Only you and {peer?.name || 'this player'} can view this conversation.</Text></View>
          <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messageContent} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
            {!messages.length ? <View style={styles.emptyChat}><ProfilePhoto photo={peer?.avatar} name={peer?.name} size={70} /><Text style={[styles.emptyChatTitle, { color: colors.ink }]}>Message {peer?.name || 'this player'}</Text><Text style={[styles.emptyText, { color: colors.ink40 }]}>You can message because you are teammates, mutual followers, or matched on a play request. Keep personal and sensitive information private.</Text></View> : null}
            <View style={styles.messageTapArea}>
            {messages.map((message, index) => {
              const grouped = messages[index - 1]?.senderId === message.senderId;
              return <DirectChatMessage key={message.id} message={message} grouped={grouped} interactive={conversation?.status === 'accepted' && !blocked} peer={peer} seen={message.id === latestMine?.id && Boolean(latestMineSeen)} timeVisible={timeMessageId === message.id} currentUserId={user?.id} colors={colors} onToggleTime={toggleMessageTime} onOpenActions={openMessageActions} onOpenProfile={() => setProfileCardOpen(true)} onReact={reactToMessage} />;
            })}
            {remoteTyping ? <View accessibilityLiveRegion="polite" accessibilityLabel={`${peer?.name || 'Player'} is typing`} style={styles.remoteTypingRow}><ProfilePhoto photo={peer?.avatar} name={peer?.name} size={30} /><AnimatedTypingDots colors={colors} /></View> : null}
            </View>
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
        peer={peer}
        seen={selectedMessage?.id === latestMine?.id && Boolean(latestMineSeen)}
        isDark={isDark}
        colors={colors}
        currentUserId={user?.id}
        onClose={() => setSelectedMessageId(null)}
        onReact={reactToMessage}
        onDetails={showMessageDetails}
        onReport={setReportingMessage}
        onBlock={blockPlayer}
        onDeleteForMe={deleteMessageForMe}
        onUnsend={unsendMessage}
      />
      <ConversationOptionsSheet
        target={optionsOpen && optionsConversation ? { conversation: optionsConversation, peer } : null}
        view={optionsView}
        onViewChange={setOptionsView}
        onClose={closeOptions}
        onViewProfile={peer?.id ? (player) => { closeOptions(); navigation.navigate('PublicProfile', { player, ownerTab: 'Team' }); } : null}
        onMute={muteChat}
        onUnmute={unmuteChat}
        onArchive={archiveChat}
        onDelete={deleteChat}
        onBlock={() => { closeOptions(); afterSheetCloses(blockPlayer); }}
        colors={colors}
      />
      <PeerProfileCard
        peer={profileCardOpen ? peer : null}
        canBlock={Boolean(peer?.id) && !conversation?.blockedByMe}
        onViewProfile={peer?.id ? () => { setProfileCardOpen(false); navigation.navigate('PublicProfile', { player: peer, ownerTab: 'Team' }); } : null}
        onBlock={() => { setProfileCardOpen(false); afterSheetCloses(blockPlayer); }}
        onClose={() => setProfileCardOpen(false)}
        colors={colors}
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
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1 },
  rule: { height: 1 },
  inboxHeaderWrap: { zIndex: 20, elevation: 20 },
  inboxHeader: { minHeight: 72, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  inboxTitleButton: { flexShrink: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  inboxTitle: { fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -0.8 },
  switcherDot: { width: 8, height: 8, marginLeft: -2, marginTop: -14, borderRadius: 4 },
  inboxActions: { marginLeft: 'auto', flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerIconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  switcherBackdrop: { position: 'absolute', top: 0, left: -2000, right: -2000, height: 4000 },
  switcherMenu: { position: 'absolute', top: 66, left: 20, width: 270, overflow: 'hidden', borderWidth: 1, borderRadius: 16, ...Platform.select({ ios: { shadowColor: '#0E2321', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } }, android: { elevation: 12 }, web: { boxShadow: '0 12px 32px rgba(14,35,33,.16)' } }) },
  switcherOption: { minHeight: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  switcherCopy: { flex: 1, minWidth: 0 },
  switcherLabel: { fontSize: 15, fontWeight: '800' },
  switcherHint: { marginTop: 2, fontSize: 11, fontWeight: '600' },
  switcherCheckSpace: { width: 18 },
  inboxSearchWrap: { paddingHorizontal: 2, paddingBottom: 4 },
  inboxContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 44 },
  sectionHead: { minHeight: 28, marginTop: 20, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.25 },
  sectionMeta: { marginLeft: 'auto', fontSize: 11, fontWeight: '700' },
  conversationList: { overflow: 'hidden', borderWidth: 1, borderRadius: 20, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  conversationRow: { minHeight: 84, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: 1 },
  conversationRowLast: { borderBottomWidth: 0 },
  swipeRow: { position: 'relative', overflow: 'hidden' },
  swipeActions: { position: 'absolute', top: 0, right: 0, bottom: 0, flexDirection: 'row' },
  swipeAction: { width: SWIPE_ACTION_WIDTH, alignItems: 'center', justifyContent: 'center', gap: 4 },
  swipeActionText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  swipeContent: { zIndex: 1 },
  archivedToggle: { minHeight: 54, marginTop: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderRadius: 16 },
  archivedIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  archivedLabel: { flex: 1, fontSize: 13, fontWeight: '800' },
  archivedList: { marginTop: 8 },
  optionsHeader: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionsHeaderCopy: { flex: 1 },
  optionsTitle: { fontSize: 17, fontWeight: '900' },
  optionsSubtitle: { marginTop: 3, fontSize: 11, lineHeight: 15 },
  optionsList: { marginTop: 6, overflow: 'hidden', borderWidth: 1, borderRadius: 16 },
  optionsRow: { minHeight: 58, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionsIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  optionsRowCopy: { flex: 1 },
  optionsRowLabel: { fontSize: 14, fontWeight: '800' },
  optionsRowDetail: { marginTop: 2, fontSize: 11, lineHeight: 15 },
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
  teamAvatar: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  teamAvatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', letterSpacing: 0.3 },
  followingStrip: { borderBottomWidth: 1 },
  followingStripContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 10 },
  followingItem: { alignItems: 'center', width: 56 },
  followingAvatarContainer: { width: 48, height: 48 },
  followingAvatarWrap: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  followingOnlineDot: { position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, borderRadius: 7, borderWidth: 2, zIndex: 2 },
  followingLastActive: { position: 'absolute', bottom: -2, right: -6, minWidth: 22, height: 16, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 2, zIndex: 2 },
  followingLastActiveText: { fontSize: 8, fontWeight: '900' },
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
  chatTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chatTitleText: { flexShrink: 1 },
  chatStatus: { marginTop: 2, fontSize: 8 },
  chatBody: { flex: 1 },
  encryptionBanner: { minHeight: 36, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderBottomWidth: 1 },
  encryptionText: { flexShrink: 1, fontSize: 8 },
  messages: { flex: 1 },
  messageContent: { flexGrow: 1, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 18 },
  messageTapArea: { flexGrow: 1 },
  emptyChat: { minHeight: 260, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyChatTitle: { marginTop: 13, fontSize: 18, fontWeight: '900' },
  messageRow: { marginTop: 11, flexDirection: 'row' },
  messageRowMine: { justifyContent: 'flex-end' },
  messageGrouped: { marginTop: 4 },
  avatarSpacer: { width: 30 },
  directMessageBlock: { maxWidth: '90%', alignItems: 'flex-start' },
  directMessageBlockMine: { alignItems: 'flex-end' },
  // The avatar sits beside the bubble itself, so controls and reactions
  // opening underneath never push it down.
  directBubbleActionRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  directBubbleActionRowMine: { flexDirection: 'row-reverse' },
  directMessageExtras: { maxWidth: '100%', alignItems: 'flex-start' },
  directMessageExtrasMine: { alignItems: 'flex-end' },
  directMessageExtrasPeer: { paddingLeft: 37 },
  messageBubble: { maxWidth: '100%', flexShrink: 1, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderBottomLeftRadius: 5, borderWidth: 1 },
  messageText: { fontSize: 15, lineHeight: 21 },
  messageTime: { marginTop: 4, marginBottom: 2, fontSize: 9, fontWeight: '700' },
  unsentBubble: { backgroundColor: 'transparent', borderStyle: 'dashed' },
  unsentRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unsentText: { fontStyle: 'italic' },
  messageTimeMine: { marginRight: 5 },
  messageTimePeer: { marginLeft: 5 },
  directReactionSummary: { marginTop: -3, marginLeft: 5, flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  directReactionSummaryMine: { marginLeft: 0, marginRight: 5, justifyContent: 'flex-end' },
  directReactionChip: { minHeight: 24, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 12, borderWidth: 1 },
  directReactionEmoji: { fontSize: 11 },
  directReactionCount: { fontSize: 8, fontWeight: '800' },
  directSeenReceipt: { minHeight: 24, marginTop: 3, marginRight: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  directSeenText: { fontSize: 8, fontWeight: '700' },
  remoteTypingRow: { marginTop: 9, flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  typingBubble: { width: 62, height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 19, borderWidth: 1, transformOrigin: 'left bottom' },
  typingDot: { width: 8, height: 8, borderRadius: 4 },
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
  profileCardBackdrop: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,14,13,.58)' },
  profileCard: { width: '100%', maxWidth: 340, paddingHorizontal: 20, paddingTop: 26, paddingBottom: 18, alignItems: 'center', borderRadius: 26 },
  profileCardName: { maxWidth: '100%', marginTop: 12, fontSize: 20, fontWeight: '900' },
  profileCardMeta: { maxWidth: '100%', marginTop: 3, marginBottom: 16, fontSize: 12 },
  profileCardButton: { width: '100%', minHeight: 48, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 15 },
  profileCardPrimaryText: { color: '#0E2321', fontSize: 13, fontWeight: '900' },
  profileCardButtonText: { fontSize: 13, fontWeight: '900' },
  reportBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,14,13,.58)' },
  reportSheet: { maxHeight: '88%', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, borderTopLeftRadius: 27, borderTopRightRadius: 27 },
  reportHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reportTitle: { marginTop: 2, fontSize: 20, fontWeight: '900' },
  reportLead: { marginBottom: 10, fontSize: 9, lineHeight: 14 },
  reportReason: { minHeight: 48, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1 },
  reportReasonFirst: { borderTopWidth: 0 },
  reportReasonText: { flex: 1, fontSize: 10, fontWeight: '800' },
});
