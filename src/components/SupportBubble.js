import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { listSupportConversations } from '../services/supportChat';
import { SupportChatBody } from '../screens/SupportChatScreen';
import { createMobileStyleSheet } from '../utils/mobileStyles';

// Hide the bubble on screens that are already a support conversation, to
// avoid a redundant floating button over the full chat UI.
const HIDDEN_ON_ROUTES = new Set(['SupportChat', 'HelpSupport']);

export default function SupportBubble({ navigationRef }) {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [routeName, setRouteName] = useState(null);

  const refreshUnread = useCallback(async () => {
    if (!user?.id) return;
    try {
      const list = await listSupportConversations();
      // Count unread messages on every conversation, closed included — a
      // teammate's final reply can arrive right before an admin closes the
      // thread, and that message still deserves a badge.
      setUnread(list.reduce((sum, item) => sum + item.unreadCount, 0));
    } catch {
      // best-effort badge; ignore failures
    }
  }, [user?.id]);

  useEffect(() => { refreshUnread(); }, [refreshUnread]);

  useEffect(() => {
    if (!navigationRef) return undefined;
    const update = () => setRouteName(navigationRef.getCurrentRoute?.()?.name || null);
    update();
    const unsubscribe = navigationRef.addListener?.('state', update);
    return () => { unsubscribe?.(); };
  }, [navigationRef]);

  useEffect(() => {
    if (!supabase || !user?.id) return undefined;
    const channel = supabase.channel(`support-bubble-${user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_conversations', filter: `requester_id=eq.${user.id}` }, () => refreshUnread())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, refreshUnread]);

  const close = () => {
    setOpen(false);
    refreshUnread();
  };

  if (!user?.id || HIDDEN_ON_ROUTES.has(routeName)) return null;

  return (
    <>
      <Pressable
        accessibilityLabel="Open Peakle support chat"
        onPress={() => setOpen(true)}
        style={[styles.bubble, { bottom: insets.bottom + 84, backgroundColor: isDark ? '#1C6B66' : '#0E2321' }]}
      >
        <Ionicons name="chatbubble-ellipses" size={24} color="#D6E94A" />
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        ) : null}
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <SupportChatBody initialConversationId={null} onClose={close} />
      </Modal>
    </>
  );
}

const styles = createMobileStyleSheet({
  bubble: {
    position: 'absolute',
    right: 18,
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 40,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: '#B6472E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
});
