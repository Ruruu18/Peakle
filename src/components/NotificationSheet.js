import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createDarkStyleSheet,
  DARK_CONTENT_COLORS,
  LIGHT_CONTENT_COLORS,
  useTheme,
} from '../context/ThemeContext';

function KitchenLine({ styles }) {
  return (
    <View style={styles.kitchenLine}>
      <View style={styles.kitchenSolid} />
      <View style={styles.kitchenDashed} />
    </View>
  );
}

function NotificationCard({ item, onRead, styles, colors }) {
  const unread = !item.read_at;
  const body = (
    <>
      <View style={[styles.noticeIcon, unread ? styles.noticeIconUnread : styles.noticeIconRead]}>
        <Ionicons name={item.icon} size={20} color={unread ? colors.teal : colors.ink40} />
      </View>
      <View style={styles.noticeCopy}>
        <View style={styles.noticeTitleRow}>
          <Text numberOfLines={2} style={[styles.noticeTitle, !unread && styles.noticeTitleRead]}>{item.title}</Text>
          {unread ? <View style={styles.newPill}><Text style={styles.newPillText}>NEW</Text></View> : null}
        </View>
        <Text style={styles.noticeBody}>{item.body}</Text>
        <View style={styles.noticeMetaRow}>
          <Text style={styles.noticeTime}>{item.time}</Text>
          {unread ? (
            <View style={styles.readAction}>
              <Ionicons name="checkmark" size={14} color={colors.teal} />
              <Text style={styles.readActionText}>Mark read</Text>
            </View>
          ) : (
            <View style={styles.readState}>
              <Ionicons name="checkmark-circle" size={14} color={colors.ink40} />
              <Text style={styles.readStateText}>Read</Text>
            </View>
          )}
        </View>
      </View>
    </>
  );

  if (!unread) return <View style={[styles.noticeCard, styles.noticeCardRead]}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. Unread notification`}
      accessibilityHint="Marks this notification as read"
      onPress={() => onRead(item.id)}
      style={({ pressed }) => [styles.noticeCard, styles.noticeCardUnread, pressed && styles.noticeCardPressed]}
    >
      {body}
    </Pressable>
  );
}

export default function NotificationSheet({ visible, onClose, items, unreadCount, onRead, onReadAll }) {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = isDark ? darkStyles : lightStyles;
  const colors = isDark ? DARK_CONTENT_COLORS : LIGHT_CONTENT_COLORS;
  const updateLabel = items.length === 1 ? '1 update' : `${items.length} updates`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close notifications" onPress={onClose} style={styles.backdropDismiss} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>INBOX</Text>
              <Text style={styles.title}>Notifications</Text>
              <Text style={styles.subtitle}>{updateLabel} from bookings, matches, and venues</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close notifications" hitSlop={8} onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed && styles.controlPressed]}>
              <Ionicons name="close" size={23} color={colors.ink} />
            </Pressable>
          </View>
          <KitchenLine styles={styles} />

          <View style={styles.inboxStatus}>
            <View style={styles.inboxStatusCopy}>
              <View style={[styles.statusIcon, unreadCount === 0 && styles.statusIconCaughtUp]}>
                <Ionicons name={unreadCount > 0 ? 'notifications' : 'checkmark'} size={16} color={unreadCount > 0 ? LIGHT_CONTENT_COLORS.ink : colors.teal} />
              </View>
              <View>
                <Text style={styles.statusLabel}>{unreadCount > 0 ? 'Unread' : 'All caught up'}</Text>
                <Text style={styles.statusCount}>{unreadCount > 0 ? `${unreadCount} waiting for you` : 'No new updates'}</Text>
              </View>
            </View>
            {unreadCount > 0 ? (
              <Pressable accessibilityRole="button" onPress={onReadAll} style={({ pressed }) => [styles.markAllButton, pressed && styles.controlPressed]}>
                <Ionicons name="checkmark-done" size={17} color={colors.teal} />
                <Text style={styles.markAllText}>Mark all read</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView style={styles.list} contentContainerStyle={[styles.listContent, !items.length && styles.listContentEmpty]} showsVerticalScrollIndicator={false}>
            {items.length ? items.map((item, index) => (
              <React.Fragment key={item.id}>
                {index === 0 || items[index - 1].group !== item.group ? <Text style={styles.groupLabel}>{item.group}</Text> : null}
                <NotificationCard item={item} onRead={onRead} styles={styles} colors={colors} />
              </React.Fragment>
            )) : (
              <View style={styles.emptyState}>
                <View style={styles.emptyDotOne} />
                <View style={styles.emptyDotTwo} />
                <View style={styles.emptyIcon}>
                  <Ionicons name="checkmark-done" size={31} color={colors.teal} />
                </View>
                <Text style={styles.emptyTitle}>Nothing needs your attention</Text>
                <Text style={styles.emptyBody}>Booking confirmations, match reminders, and venue updates will land here.</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const sheetShadow = Platform.select({
  ios: { shadowColor: '#0E2321', shadowOpacity: 0.16, shadowRadius: 28, shadowOffset: { width: 0, height: -8 } },
  android: { elevation: 18 },
  default: {},
});

const lightStyles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.5)' },
  backdropDismiss: { ...StyleSheet.absoluteFillObject },
  sheet: { width: '100%', maxWidth: 620, height: '88%', maxHeight: 760, paddingHorizontal: 20, paddingTop: 10, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#F3F5EF', ...sheetShadow },
  handle: { width: 42, height: 4, marginBottom: 16, alignSelf: 'center', borderRadius: 2, backgroundColor: '#DDE3DA' },
  header: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: '#1C6B66', fontSize: 10, lineHeight: 15, fontWeight: '900', letterSpacing: 1.1 },
  title: { marginTop: 1, color: '#0E2321', fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -.7 },
  subtitle: { marginTop: 3, color: '#7C8983', fontSize: 11, lineHeight: 16 },
  closeButton: { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: '#DDE3DA', backgroundColor: '#FFFFFF' },
  controlPressed: { opacity: .7, transform: [{ scale: .97 }] },
  kitchenLine: { height: 7, marginTop: 16, marginBottom: 18 },
  kitchenSolid: { height: 2, backgroundColor: '#DDE3DA' },
  kitchenDashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#DDE3DA' },
  inboxStatus: { minHeight: 64, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, borderColor: '#DDE3DA', borderRadius: 17, backgroundColor: '#FFFFFF' },
  inboxStatusCopy: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusIcon: { width: 36, height: 36, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#D6E94A' },
  statusIconCaughtUp: { backgroundColor: '#E5F0ED' },
  statusLabel: { color: '#0E2321', fontSize: 13, lineHeight: 17, fontWeight: '800' },
  statusCount: { marginTop: 1, color: '#7C8983', fontSize: 10, lineHeight: 14 },
  markAllButton: { minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12 },
  markAllText: { color: '#1C6B66', fontSize: 11, fontWeight: '800' },
  list: { flex: 1, minHeight: 0, marginTop: 8 },
  listContent: { paddingBottom: 12 },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  groupLabel: { marginTop: 14, marginBottom: 8, color: '#7C8983', fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 1 },
  noticeCard: { minHeight: 116, marginBottom: 10, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1, borderColor: '#DDE3DA', borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: '#FFFFFF' },
  noticeCardUnread: { borderColor: '#BFD8D2' },
  noticeCardRead: { backgroundColor: '#F3F5EF' },
  noticeCardPressed: { opacity: .76, transform: [{ scale: .99 }] },
  noticeIcon: { width: 42, height: 42, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  noticeIconUnread: { backgroundColor: '#E5F0ED' },
  noticeIconRead: { backgroundColor: '#ECEFEA' },
  noticeCopy: { flex: 1, minWidth: 0 },
  noticeTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  noticeTitle: { flex: 1, color: '#0E2321', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  noticeTitleRead: { color: '#3C4A45' },
  newPill: { minWidth: 35, height: 20, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: '#D6E94A' },
  newPillText: { color: '#0E2321', fontSize: 8, fontWeight: '900', letterSpacing: .55 },
  noticeBody: { marginTop: 4, color: '#3C4A45', fontSize: 13, lineHeight: 19 },
  noticeMetaRow: { minHeight: 24, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  noticeTime: { flex: 1, color: '#7C8983', fontSize: 10, lineHeight: 14 },
  readAction: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  readActionText: { color: '#1C6B66', fontSize: 10, fontWeight: '800' },
  readState: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  readStateText: { color: '#7C8983', fontSize: 10, fontWeight: '700' },
  emptyState: { minHeight: 300, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: '#DDE3DA', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: '#FFFFFF' },
  emptyDotOne: { position: 'absolute', top: 30, right: 32, width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(28,107,102,.045)' },
  emptyDotTwo: { position: 'absolute', bottom: 30, left: 22, width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(28,107,102,.035)' },
  emptyIcon: { width: 66, height: 66, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#E5F0ED' },
  emptyTitle: { marginTop: 18, color: '#0E2321', textAlign: 'center', fontSize: 18, lineHeight: 24, fontWeight: '800' },
  emptyBody: { maxWidth: 330, marginTop: 7, color: '#7C8983', textAlign: 'center', fontSize: 13, lineHeight: 19 },
});

const darkStyles = createDarkStyleSheet(lightStyles);
