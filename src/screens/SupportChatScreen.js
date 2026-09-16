import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import ScrollView from '../components/FocusResetScrollView';
import { useAuth } from '../context/AuthContext';
import { DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import { SUPPORT_QUICK_REPLIES } from '../config/supportQuickReplies';
import {
  deleteSupportChatMedia,
  getSupportConversation,
  getSupportMessage,
  listSupportConversations,
  listSupportMessages,
  markSupportConversationRead,
  rateSupportConversation,
  requestHumanSupport,
  sendSupportMessage,
  startSupportConversation,
  uploadSupportChatMedia,
} from '../services/supportChat';

const LIGHT = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983',
  line: '#DDE3DA', tealWash: '#E5F0ED',
};
const DARK = {
  ...LIGHT, ...DARK_CONTENT_COLORS,
  paper: '#0E2321', surface: '#17302D', tealWash: '#203B37',
};
const TYPING_IDLE_MS = 1400;
const TYPING_HEARTBEAT_MS = 900;
const TYPING_EXPIRY_MS = 2600;

function Icon({ name, size = 20, color }) {
  return <Ionicons name={name} size={size} color={color} />;
}

const STATUS_COPY = {
  bot: 'Answered by Peakle AI',
  open: 'Waiting for a teammate',
  assigned: (agentName) => `Chatting with ${agentName || 'Peakle support'}`,
  closed: 'Conversation closed',
};

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
  return (
    <View style={[s.typingBubble, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      {values.map((value, index) => <Animated.View key={index} style={[s.typingDot, { backgroundColor: colors.ink40, opacity: value }]} />)}
    </View>
  );
}

function SupportMessageBubble({ message, colors, seen }) {
  const fromAi = message.senderType === 'ai';
  const mine = message.mine;
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 190,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [entrance]);
  return (
    <Animated.View
      style={[
        s.messageRow,
        mine && s.messageRowMine,
        { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }] },
      ]}
    >
      {!mine ? (
        <View style={s.senderRow}>
          {fromAi ? <Icon name="sparkles" size={10} color={colors.teal} /> : null}
          <Text style={[s.senderLabel, { color: fromAi ? colors.teal : colors.ink70 }]}>
            {fromAi ? 'Peakle AI' : message.sender}
          </Text>
        </View>
      ) : null}
      <View style={[
        s.bubble,
        { backgroundColor: colors.surface, borderColor: colors.line },
        fromAi && { backgroundColor: colors.tealWash, borderColor: colors.teal },
        mine && { backgroundColor: colors.teal, borderColor: colors.teal },
      ]}>
        {message.mediaUrl ? <Image source={{ uri: message.mediaUrl }} style={s.bubbleImage} resizeMode="cover" /> : null}
        {message.text ? <Text style={[s.bubbleText, { color: mine ? '#FFFFFF' : colors.ink }, message.mediaUrl && s.bubbleTextSpacing]}>{message.text}</Text> : null}
        <Text style={[s.bubbleTime, { color: mine ? 'rgba(255,255,255,.7)' : colors.ink40 }]}>{message.time}</Text>
      </View>
      {mine && seen ? <Text style={[s.seenText, { color: colors.ink40 }]}>Seen</Text> : null}
    </Animated.View>
  );
}

function QuickReplyChips({ colors, onPick, disabled }) {
  return (
    <View style={s.chipsWrap}>
      {SUPPORT_QUICK_REPLIES.map((item) => (
        <Pressable
          key={item.label}
          disabled={disabled}
          onPress={() => onPick(item)}
          style={({ pressed }) => [s.chip, { backgroundColor: colors.tealWash, borderColor: colors.line }, pressed && s.pressed]}
        >
          <Text style={[s.chipText, { color: colors.teal }]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function SuggestionCards({ colors, onPick, disabled }) {
  return (
    <View style={s.suggestionsWrap}>
      {SUPPORT_QUICK_REPLIES.slice(0, 3).map((item) => (
        <Pressable
          key={item.label}
          disabled={disabled}
          onPress={() => onPick(item)}
          style={({ pressed }) => [s.suggestionCard, { backgroundColor: colors.surface, borderColor: colors.line }, pressed && s.pressed]}
        >
          <Text style={[s.suggestionText, { color: colors.ink70 }]}>{item.prompt}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function CsatPrompt({ colors, busy, onSubmit, onDismiss }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  return (
    <View style={[s.csatCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={s.csatHeader}>
        <Text style={[s.csatTitle, { color: colors.ink }]}>How was your experience?</Text>
        <Pressable accessibilityLabel="Dismiss rating" onPress={onDismiss} hitSlop={8}><Icon name="close" size={16} color={colors.ink40} /></Pressable>
      </View>
      <View style={s.csatStars}>
        {[1, 2, 3, 4, 5].map((value) => (
          <Pressable key={value} accessibilityLabel={`Rate ${value} star${value > 1 ? 's' : ''}`} onPress={() => setRating(value)} hitSlop={6}>
            <Icon name={value <= rating ? 'star' : 'star-outline'} size={26} color={value <= rating ? colors.optic : colors.ink40} />
          </Pressable>
        ))}
      </View>
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="Anything else you'd like to share? (optional)"
        placeholderTextColor={colors.ink40}
        multiline
        maxLength={500}
        style={[s.csatInput, { color: colors.ink, borderColor: colors.line }]}
      />
      <Pressable disabled={!rating || busy} onPress={() => onSubmit(rating, comment)} style={[s.csatSubmit, { backgroundColor: colors.optic }, (!rating || busy) && s.disabled]}>
        {busy ? <ActivityIndicator size="small" color="#0E2321" /> : <Text style={s.csatSubmitText}>Submit</Text>}
      </Pressable>
    </View>
  );
}

export function SupportChatBody({ initialConversationId = null, onClose }) {
  const { isDark } = useTheme();
  const colors = isDark ? DARK : LIGHT;
  const { user } = useAuth();
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [resolving, setResolving] = useState(!initialConversationId);
  const [loading, setLoading] = useState(Boolean(initialConversationId));
  const [sending, setSending] = useState(false);
  const [requestingHuman, setRequestingHuman] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingDismissed, setRatingDismissed] = useState(false);
  const scrollRef = useRef(null);
  const scrollFrameRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const channelRef = useRef(null);
  const typingActiveRef = useRef(false);
  const typingStopTimer = useRef(null);
  const typingHeartbeatTimer = useRef(null);
  const typingExpiryTimer = useRef(null);

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
      const existing = current.findIndex((item) => item.id === message.id);
      if (existing < 0) return [...current, message].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const next = [...current];
      next[existing] = message;
      return next;
    });
  }, []);

  const refreshConversation = useCallback(async (id = conversationId) => {
    if (!id) return null;
    try {
      const details = await getSupportConversation(id);
      setConversation(details);
      return details;
    } catch {
      return null;
    }
  }, [conversationId]);

  useEffect(() => {
    if (initialConversationId) return;
    let cancelled = false;
    (async () => {
      setResolving(true);
      try {
        const list = await listSupportConversations();
        const active = list.find((item) => item.status !== 'closed');
        if (!cancelled && active) setConversationId(active.id);
      } catch {
        // no existing conversation could be resolved — the start view covers this
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initialConversationId]);

  useEffect(() => {
    if (!conversationId) { setLoading(false); return undefined; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [details, rows] = await Promise.all([
          getSupportConversation(conversationId),
          listSupportMessages(conversationId),
        ]);
        if (cancelled) return;
        setConversation(details);
        setMessages(rows);
        await markSupportConversationRead(conversationId);
      } catch (error) {
        if (!cancelled) Alert.alert('Conversation unavailable', error.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  const sendTyping = useCallback((isTyping) => {
    channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: user?.id, isTyping } }).catch(() => {});
  }, [user?.id]);
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
    const humanPresent = conversation?.status === 'open' || conversation?.status === 'assigned';
    if (!value.trim() || !humanPresent) { stopTyping(); return; }
    if (!typingActiveRef.current) { typingActiveRef.current = true; sendTyping(true); }
    if (!typingHeartbeatTimer.current) typingHeartbeatTimer.current = setInterval(() => sendTyping(true), TYPING_HEARTBEAT_MS);
    typingStopTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  useEffect(() => {
    if (!supabase || !conversationId || !user?.id) return undefined;
    const channel = supabase.channel(`support-chat-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${conversationId}` }, ({ new: row }) => {
        getSupportMessage(row.id).then((message) => {
          upsertMessage(message);
          if (message?.senderId !== user.id) markSupportConversationRead(conversationId).catch(() => {});
        }).catch(() => {});
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_conversations', filter: `id=eq.${conversationId}` }, () => refreshConversation())
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
  }, [conversationId, refreshConversation, upsertMessage, user?.id]);
  useEffect(() => () => stopTyping(), [stopTyping]);

  useEffect(() => {
    if (stickToBottomRef.current) scrollToLatest(true);
  }, [messages.length, remoteTyping, scrollToLatest]);
  useEffect(() => () => {
    if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  useEffect(() => { setRatingDismissed(false); }, [conversationId]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: .85 });
    if (result.canceled) return;
    setPendingImage(result.assets[0]);
  };

  const startWith = async (text, category = null) => {
    const clean = text.trim();
    if ((!clean && !pendingImage) || sending) return;
    stickToBottomRef.current = true;
    setSending(true);
    let uploadedMedia = null;
    try {
      if (pendingImage) uploadedMedia = await uploadSupportChatMedia(pendingImage);
      const result = await startSupportConversation(clean, category, uploadedMedia);
      setDraft('');
      setPendingImage(null);
      setConversationId(result.conversationId);
    } catch (error) {
      if (uploadedMedia?.path) deleteSupportChatMedia(uploadedMedia.path).catch(() => {});
      Alert.alert('Message not sent', error.message);
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    const clean = draft.trim();
    if (!conversationId) return startWith(clean);
    if ((!clean && !pendingImage) || sending) return;
    stickToBottomRef.current = true;
    stopTyping();
    setSending(true);
    let uploadedMedia = null;
    try {
      if (pendingImage) uploadedMedia = await uploadSupportChatMedia(pendingImage);
      await sendSupportMessage(conversationId, clean, uploadedMedia);
      setDraft('');
      setPendingImage(null);
      await refreshConversation();
    } catch (error) {
      if (uploadedMedia?.path) deleteSupportChatMedia(uploadedMedia.path).catch(() => {});
      Alert.alert('Message not sent', error.message);
    } finally {
      setSending(false);
    }
  };

  const sendPrompt = async (text) => {
    const clean = text.trim();
    if (!clean || !conversationId || sending) return;
    stickToBottomRef.current = true;
    stopTyping();
    setSending(true);
    try {
      await sendSupportMessage(conversationId, clean, null);
      await refreshConversation();
    } catch (error) {
      Alert.alert('Message not sent', error.message);
    } finally {
      setSending(false);
    }
  };

  const talkToHuman = async () => {
    if (!conversationId || requestingHuman) return;
    setRequestingHuman(true);
    try {
      await requestHumanSupport(conversationId);
      await refreshConversation();
    } catch (error) {
      Alert.alert('Could not connect you with a teammate', error.message);
    } finally {
      setRequestingHuman(false);
    }
  };

  const submitRating = async (rating, comment) => {
    if (!conversationId) return;
    setRatingBusy(true);
    try {
      await rateSupportConversation(conversationId, rating, comment);
      await refreshConversation();
    } catch (error) {
      Alert.alert('Rating not saved', error.message);
    } finally {
      setRatingBusy(false);
    }
  };

  const beginNewConversation = () => {
    stopTyping();
    setConversationId(null);
    setConversation(null);
    setMessages([]);
    setDraft('');
    setPendingImage(null);
    setRemoteTyping(false);
    setRatingDismissed(false);
  };

  const status = conversation?.status || 'bot';
  const statusText = !conversationId
    ? 'Ask a question or pick a topic below'
    : status === 'assigned'
      ? STATUS_COPY.assigned(conversation?.assignedAgentName)
      : STATUS_COPY[status] || STATUS_COPY.bot;
  // The server now auto-escalates out of "bot" status the instant the AI
  // can't answer (see 202608280002_builtin_support_responder.sql), so this
  // button offers proactive escalation during an active AI chat rather than
  // reacting to a "couldn't answer" state the client would ever observe.
  const canTalkToHuman = Boolean(conversationId) && status === 'bot';
  const latestMine = [...messages].reverse().find((message) => message.mine);
  const latestMineSeen = latestMine && conversation?.agentLastReadAt && new Date(conversation.agentLastReadAt) >= new Date(latestMine.createdAt);
  const showCsat = conversationId && status === 'closed' && !conversation?.csatRating && !ratingDismissed;

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
          <Text style={[s.title, { color: colors.ink }]}>{status === 'bot' ? 'Peakle AI' : 'Peakle Support'}</Text>
          <Text style={[s.subtitle, { color: colors.ink40 }]}>{statusText}</Text>
        </View>
        {canTalkToHuman ? (
          <Pressable accessibilityLabel="Talk to a human" disabled={requestingHuman} onPress={talkToHuman} style={[s.humanButton, { backgroundColor: colors.tealWash }]}>
            {requestingHuman ? <ActivityIndicator size="small" color={colors.teal} /> : <Icon name="person-outline" size={16} color={colors.teal} />}
          </Pressable>
        ) : null}
        {conversationId ? (
          <Pressable accessibilityLabel="Start a new conversation" onPress={beginNewConversation} style={[s.iconButton, { borderColor: colors.line, backgroundColor: colors.surface }]}>
            <Icon name="add" size={20} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>
      <View style={[s.rule, { backgroundColor: colors.line }]} />

      {resolving || loading ? (
        <View style={s.loading}><ActivityIndicator color={colors.teal} /></View>
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
            onContentSizeChange={() => {
              if (stickToBottomRef.current) scrollToLatest(true);
            }}
          >
            {!conversationId ? (
              <View style={s.startPrompt}>
                <View style={[s.aiWelcome, { backgroundColor: colors.tealWash, borderColor: colors.line }]}>
                  <View style={[s.aiMark, { backgroundColor: colors.optic }]}>
                    <Icon name="sparkles" size={18} color="#0E2321" />
                  </View>
                  <View style={s.flex}>
                    <Text style={[s.aiWelcomeTitle, { color: colors.ink }]}>Hi, I’m Peakle AI.</Text>
                    <Text style={[s.aiWelcomeCopy, { color: colors.ink70 }]}>Ask me about Peakle, or choose a topic for a quick answer.</Text>
                  </View>
                </View>
                <Text style={[s.startTitle, { color: colors.ink }]}>How can we help?</Text>
                <QuickReplyChips colors={colors} disabled={sending} onPick={(item) => startWith(item.prompt, item.category)} />
              </View>
            ) : null}
            {messages.map((message) => (
              <SupportMessageBubble key={message.id} message={message} colors={colors} seen={message.id === latestMine?.id && Boolean(latestMineSeen)} />
            ))}
            {remoteTyping ? <View style={s.typingRow}><AnimatedTypingDots colors={colors} /></View> : null}
            {showCsat ? <CsatPrompt colors={colors} busy={ratingBusy} onSubmit={submitRating} onDismiss={() => setRatingDismissed(true)} /> : null}
          </ScrollView>
          {conversationId && status === 'bot' ? (
            <SuggestionCards colors={colors} disabled={sending} onPick={(item) => sendPrompt(item.prompt)} />
          ) : null}
          <View style={[s.composer, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            {pendingImage ? (
              <View style={s.pendingImageRow}>
                <Image source={{ uri: pendingImage.uri }} style={s.pendingImageThumb} />
                <Pressable accessibilityLabel="Remove image" onPress={() => setPendingImage(null)} style={[s.pendingImageRemove, { backgroundColor: colors.paper }]}>
                  <Icon name="close" size={13} color={colors.ink} />
                </Pressable>
              </View>
            ) : null}
            <View style={[s.composerInput, { backgroundColor: colors.paper }]}>
              <Pressable accessibilityLabel="Attach an image" onPress={pickImage} style={s.attachButton}>
                <Icon name="image-outline" size={19} color={colors.ink40} />
              </Pressable>
              <TextInput
                value={draft}
                onChangeText={changeDraft}
                onBlur={stopTyping}
                onSubmitEditing={send}
                returnKeyType="send"
                submitBehavior="submit"
                multiline
                maxLength={4000}
                placeholder={status === 'bot' ? 'Ask Peakle AI' : 'Message Peakle support'}
                placeholderTextColor={colors.ink40}
                style={[s.input, { color: colors.ink }]}
              />
              <Pressable
                disabled={(!draft.trim() && !pendingImage) || sending}
                accessibilityLabel="Send message"
                onPress={send}
                style={({ pressed }) => [s.sendButton, { backgroundColor: colors.optic }, ((!draft.trim() && !pendingImage) || sending) && s.disabled, pressed && s.pressed]}
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

export default function SupportChatScreen({ route, navigation }) {
  return <SupportChatBody initialConversationId={route?.params?.conversationId || null} onClose={() => navigation.goBack()} />;
}

const s = createMobileStyleSheet({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: { paddingHorizontal: 19, paddingTop: 12, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1 },
  title: { fontSize: 17, fontWeight: '900' },
  subtitle: { marginTop: 2, fontSize: 9, fontWeight: '700' },
  humanButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  rule: { height: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messageContent: { paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  startPrompt: { paddingVertical: 20, alignItems: 'center', gap: 14 },
  aiWelcome: { width: '100%', padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 16 },
  aiMark: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  aiWelcomeTitle: { fontSize: 12, fontWeight: '900' },
  aiWelcomeCopy: { marginTop: 3, fontSize: 10, lineHeight: 15 },
  startTitle: { fontSize: 15, fontWeight: '900' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chip: { minHeight: 34, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 12 },
  chipText: { fontSize: 10, fontWeight: '800' },
  suggestionsWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2, gap: 8 },
  suggestionCard: { padding: 12, borderWidth: 1, borderRadius: 14 },
  suggestionText: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  messageRow: { alignItems: 'flex-start', maxWidth: '86%' },
  messageRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  senderRow: { marginBottom: 3, marginLeft: 4, flexDirection: 'row', alignItems: 'center', gap: 3 },
  senderLabel: { fontSize: 8, fontWeight: '900', letterSpacing: .4 },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  bubbleImage: { width: 200, height: 150, marginHorizontal: -13, marginTop: -9, marginBottom: 7, borderRadius: 0 },
  bubbleText: { fontSize: 12, lineHeight: 17 },
  bubbleTextSpacing: { marginTop: 2 },
  bubbleTime: { marginTop: 4, fontSize: 7, fontWeight: '700' },
  seenText: { marginTop: 3, marginRight: 2, fontSize: 7, fontWeight: '700' },
  typingRow: { alignSelf: 'flex-start' },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 13, paddingVertical: 11, borderWidth: 1, borderRadius: 16 },
  typingDot: { width: 6, height: 6, borderRadius: 3 },
  csatCard: { marginTop: 6, padding: 14, borderWidth: 1, borderRadius: 16, gap: 10 },
  csatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  csatTitle: { fontSize: 12, fontWeight: '900' },
  csatStars: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  csatInput: { minHeight: 50, padding: 10, borderWidth: 1, borderRadius: 12, fontSize: 11 },
  csatSubmit: { minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  csatSubmitText: { color: '#0E2321', fontSize: 11, fontWeight: '900' },
  composer: { padding: 10, borderTopWidth: 1 },
  pendingImageRow: { marginBottom: 8, flexDirection: 'row', alignItems: 'flex-start' },
  pendingImageThumb: { width: 56, height: 56, borderRadius: 10 },
  pendingImageRemove: { width: 20, height: 20, marginLeft: -10, marginTop: -6, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  composerInput: { minHeight: 44, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'flex-end', gap: 6, borderRadius: 16 },
  attachButton: { width: 30, height: 34, alignItems: 'center', justifyContent: 'center' },
  input: { minWidth: 0, flex: 1, maxHeight: 110, paddingVertical: 8, fontSize: 12, lineHeight: 18 },
  sendButton: { width: 34, height: 34, marginBottom: 3, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  pressed: { opacity: .72, transform: [{ scale: .97 }] },
  disabled: { opacity: .5 },
});
