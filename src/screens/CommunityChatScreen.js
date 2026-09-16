import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import ScrollView from '../components/FocusResetScrollView';
import { useAuth } from '../context/AuthContext';
import { DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import {
  getCommunityMessage,
  getOrCreateCommunityChat,
  listCommunityMessages,
  markCommunityConversationRead,
  sendCommunityMessage,
} from '../services/communityChat';

const LIGHT = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983',
  line: '#DDE3DA', tealWash: '#E5F0ED', gold: '#D5A928', goldWash: '#FBF2D9',
};
const DARK = {
  ...LIGHT, ...DARK_CONTENT_COLORS,
  paper: '#0E2321', surface: '#17302D', tealWash: '#203B37', goldWash: '#3A311C',
};

function Icon({ name, size = 20, color }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function AnnouncementBubble({ message, colors }) {
  return (
    <View style={[s.announcement, { backgroundColor: colors.goldWash, borderColor: colors.gold }]}>
      <View style={s.announcementHead}>
        <Icon name="megaphone" size={12} color={colors.gold} />
        <Text style={[s.announcementLabel, { color: colors.gold }]}>ANNOUNCEMENT · {message.sender}</Text>
      </View>
      <Text style={[s.announcementText, { color: colors.ink }]}>{message.text}</Text>
      <Text style={[s.announcementTime, { color: colors.ink40 }]}>{message.time}</Text>
    </View>
  );
}

function ChatBubble({ message, colors }) {
  const mine = message.mine;
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [entrance]);
  if (message.isAnnouncement) return <AnnouncementBubble message={message} colors={colors} />;
  return (
    <Animated.View style={[s.messageRow, mine && s.messageRowMine, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }] }]}>
      {!mine ? <Text style={[s.senderLabel, { color: colors.ink70 }]}>{message.sender}</Text> : null}
      <View style={[s.bubble, { backgroundColor: colors.surface, borderColor: colors.line }, mine && { backgroundColor: colors.teal, borderColor: colors.teal }]}>
        <Text style={[s.bubbleText, { color: mine ? '#FFFFFF' : colors.ink }]}>{message.text}</Text>
        <Text style={[s.bubbleTime, { color: mine ? 'rgba(255,255,255,.7)' : colors.ink40 }]}>{message.time}</Text>
      </View>
    </Animated.View>
  );
}

export function CommunityChatBody({ eventKind, eventId, initialTitle = null, onClose }) {
  const { isDark } = useTheme();
  const colors = isDark ? DARK : LIGHT;
  const { user } = useAuth();
  const [chat, setChat] = useState(initialTitle ? { title: initialTitle } : null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [announceMode, setAnnounceMode] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);
  const scrollFrameRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const scrollToLatest = useCallback((animated = true) => {
    if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated });
      scrollFrameRef.current = null;
    });
  }, []);

  const upsertMessage = useCallback((message) => {
    if (!message) return;
    setMessages((current) => {
      if (current.some((item) => item.id === message.id)) return current;
      return [...current, message].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    });
  }, []);

  useEffect(() => {
    if (!eventKind || !eventId) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const details = await getOrCreateCommunityChat(eventKind, eventId);
        if (cancelled) return;
        setChat(details);
        const rows = await listCommunityMessages(details.conversationId);
        if (cancelled) return;
        setMessages(rows);
        await markCommunityConversationRead(details.conversationId);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || 'This chat could not be opened.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventKind, eventId]);

  useEffect(() => {
    if (!supabase || !chat?.conversationId || !user?.id) return undefined;
    const channel = supabase.channel(`community-chat-${chat.conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'community_messages', filter: `conversation_id=eq.${chat.conversationId}` }, ({ new: row }) => {
        getCommunityMessage(row.id).then((message) => {
          upsertMessage(message);
          if (message?.senderId !== user.id) markCommunityConversationRead(chat.conversationId).catch(() => {});
        }).catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chat?.conversationId, upsertMessage, user?.id]);

  useEffect(() => {
    if (stickToBottomRef.current) scrollToLatest(true);
  }, [messages.length, scrollToLatest]);
  useEffect(() => () => { if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current); }, []);

  const send = async () => {
    const clean = draft.trim();
    if (!clean || !chat?.conversationId || sending) return;
    stickToBottomRef.current = true;
    setSending(true);
    try {
      await sendCommunityMessage(chat.conversationId, clean, announceMode);
      setDraft('');
      setAnnounceMode(false);
    } catch (sendError) {
      Alert.alert('Message not sent', sendError.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.paper} />
      <View style={s.header}>
        {onClose ? (
          <Pressable accessibilityLabel="Close" onPress={onClose} style={[s.iconButton, { borderColor: colors.line, backgroundColor: colors.surface }]}>
            <Icon name="arrow-back" color={colors.ink} />
          </Pressable>
        ) : null}
        <View style={s.flex}>
          <Text numberOfLines={1} style={[s.title, { color: colors.ink }]}>{chat?.title || 'Community chat'}</Text>
          <Text numberOfLines={1} style={[s.subtitle, { color: colors.ink40 }]}>
            {chat?.subtitle ? `${chat.subtitle} · ` : ''}{chat?.memberCount ? `${chat.memberCount} member${chat.memberCount === 1 ? '' : 's'}` : 'Members only'}
          </Text>
        </View>
        {chat?.isHost ? (
          <View style={[s.hostBadge, { backgroundColor: colors.tealWash }]}>
            <Text style={[s.hostBadgeText, { color: colors.teal }]}>HOST</Text>
          </View>
        ) : null}
      </View>
      <View style={[s.rule, { backgroundColor: colors.line }]} />

      {loading ? (
        <View style={s.loading}><ActivityIndicator color={colors.teal} /></View>
      ) : error ? (
        <View style={s.loading}>
          <Icon name="cloud-offline-outline" size={26} color={colors.ink40} />
          <Text style={[s.errorText, { color: colors.ink40 }]}>{error}</Text>
        </View>
      ) : (
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
          <ScrollView
            ref={scrollRef}
            style={s.flex}
            contentContainerStyle={s.messageContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            scrollEventThrottle={16}
            onScroll={({ nativeEvent }) => {
              const distanceFromBottom = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y;
              stickToBottomRef.current = distanceFromBottom < 72;
            }}
            onContentSizeChange={() => { if (stickToBottomRef.current) scrollToLatest(true); }}
          >
            {!messages.length ? (
              <View style={s.emptyState}>
                <View style={[s.emptyIcon, { backgroundColor: colors.tealWash }]}><Icon name="people-circle-outline" size={26} color={colors.teal} /></View>
                <Text style={[s.emptyTitle, { color: colors.ink }]}>Welcome to the group chat</Text>
                <Text style={[s.emptyCopy, { color: colors.ink40 }]}>Say hi, ask questions, and watch this space for announcements about the play.</Text>
              </View>
            ) : null}
            {messages.map((message) => <ChatBubble key={message.id} message={message} colors={colors} />)}
          </ScrollView>
          <View style={[s.composer, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            {chat?.isHost ? (
              <Pressable
                accessibilityLabel={announceMode ? 'Cancel announcement' : 'Post as announcement'}
                onPress={() => setAnnounceMode((value) => !value)}
                style={[s.announceToggle, { backgroundColor: announceMode ? colors.gold : colors.tealWash }]}
              >
                <Icon name="megaphone" size={15} color={announceMode ? '#0E2321' : colors.teal} />
                <Text style={[s.announceToggleText, { color: announceMode ? '#0E2321' : colors.teal }]}>{announceMode ? 'Announcement' : 'Announce'}</Text>
              </Pressable>
            ) : null}
            <View style={[s.composerInput, { backgroundColor: colors.paper }]}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={send}
                returnKeyType="send"
                submitBehavior="submit"
                multiline
                maxLength={announceMode ? 500 : 2000}
                placeholder={announceMode ? 'Write an announcement for everyone…' : 'Message the group'}
                placeholderTextColor={colors.ink40}
                style={[s.input, { color: colors.ink }]}
              />
              <Pressable
                disabled={!draft.trim() || sending}
                accessibilityLabel="Send message"
                onPress={send}
                style={({ pressed }) => [s.sendButton, { backgroundColor: announceMode ? colors.gold : colors.optic }, (!draft.trim() || sending) && s.disabled, pressed && s.pressed]}
              >
                {sending ? <ActivityIndicator size="small" color="#0E2321" /> : <Icon name="arrow-up" size={18} color="#0E2321" />}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

export default function CommunityChatScreen({ route, navigation }) {
  const { eventKind, eventId, title } = route?.params || {};
  return <CommunityChatBody eventKind={eventKind} eventId={eventId} initialTitle={title} onClose={() => navigation.goBack()} />;
}

const s = createMobileStyleSheet({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: { paddingHorizontal: 19, paddingTop: 12, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1 },
  title: { fontSize: 16, fontWeight: '900' },
  subtitle: { marginTop: 2, fontSize: 9, fontWeight: '700' },
  hostBadge: { minHeight: 24, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  hostBadgeText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  rule: { height: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 30 },
  errorText: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  messageContent: { paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  emptyState: { paddingVertical: 26, alignItems: 'center', gap: 8 },
  emptyIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  emptyTitle: { fontSize: 13, fontWeight: '900' },
  emptyCopy: { maxWidth: 260, textAlign: 'center', fontSize: 10, lineHeight: 15 },
  announcement: { width: '100%', padding: 13, borderWidth: 1, borderRadius: 16 },
  announcementHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  announcementLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },
  announcementText: { marginTop: 6, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  announcementTime: { marginTop: 6, fontSize: 7, fontWeight: '700' },
  messageRow: { alignItems: 'flex-start', maxWidth: '86%' },
  messageRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  senderLabel: { marginBottom: 3, marginLeft: 4, fontSize: 8, fontWeight: '900', letterSpacing: .3 },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1, borderRadius: 16 },
  bubbleText: { fontSize: 12, lineHeight: 17 },
  bubbleTime: { marginTop: 4, fontSize: 7, fontWeight: '700' },
  composer: { padding: 10, borderTopWidth: 1, gap: 8 },
  announceToggle: { minHeight: 32, alignSelf: 'flex-start', paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 11 },
  announceToggleText: { fontSize: 9, fontWeight: '900' },
  composerInput: { minHeight: 44, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'flex-end', gap: 6, borderRadius: 16 },
  input: { minWidth: 0, flex: 1, maxHeight: 110, paddingVertical: 8, fontSize: 12, lineHeight: 18 },
  sendButton: { width: 34, height: 34, marginBottom: 3, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  pressed: { opacity: .72, transform: [{ scale: .97 }] },
  disabled: { opacity: .5 },
});
