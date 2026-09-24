import Modal from './ResponsiveModal';
import { webDialog } from '../utils/webLayout';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createDarkStyleSheet,
  DARK_CONTENT_COLORS,
  LIGHT_CONTENT_COLORS,
  useTheme,
} from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';

function KitchenLine({ styles }) {
  return (
    <View style={styles.kitchenLine}>
      <View style={styles.kitchenSolid} />
      <View style={styles.kitchenDashed} />
    </View>
  );
}

function NotificationCard({ item, onRead, onDelete, onOpen, onFollowResponse, styles, colors }) {
  const unread = !item.read_at;
  const opensDestination = Boolean(onOpen && (item.data?.conversationId || item.data?.sessionId));
  const followRequest = item.kind === 'follow_request' && item.data?.requesterId && onFollowResponse;
  const [responding, setResponding] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');
  const respond = async (accept) => {
    if (responding) return;
    setResponding(accept ? 'accept' : 'delete');
    setActionError('');
    try {
      await onFollowResponse(item, accept);
    } catch (error) {
      setActionError(error.message || 'This follow request could not be updated.');
      setResponding('');
    }
  };
  const remove = async (event) => {
    event?.stopPropagation?.();
    if (deleting) return;
    setDeleting(true);
    setActionError('');
    try {
      await onDelete(item.id);
    } catch (error) {
      setActionError(error.message || 'This notification could not be deleted.');
      setDeleting(false);
    }
  };
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
        {followRequest ? (
          <>
            <Text style={styles.noticeTime}>{item.time}</Text>
            <View style={styles.followActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Accept follow request from ${item.data?.playerName || 'player'}`} disabled={Boolean(responding)} onPress={() => respond(true)} style={({ pressed }) => [styles.acceptButton, pressed && styles.controlPressed, responding && styles.followButtonDisabled]}>
                {responding === 'accept' ? <ActivityIndicator size="small" color={LIGHT_CONTENT_COLORS.ink} /> : <><Ionicons name="checkmark" size={16} color={LIGHT_CONTENT_COLORS.ink} /><Text style={styles.acceptButtonText}>Accept</Text></>}
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete follow request from ${item.data?.playerName || 'player'}`} disabled={Boolean(responding)} onPress={() => respond(false)} style={({ pressed }) => [styles.deleteButton, pressed && styles.controlPressed, responding && styles.followButtonDisabled]}>
                {responding === 'delete' ? <ActivityIndicator size="small" color={colors.ink70} /> : <><Ionicons name="trash-outline" size={15} color={colors.ink70} /><Text style={styles.deleteButtonText}>Delete</Text></>}
              </Pressable>
            </View>
            {actionError ? <Text style={styles.followActionError}>{actionError}</Text> : null}
          </>
        ) : (
          <>
            <View style={styles.noticeMetaRow}>
              <Text style={styles.noticeTime}>{item.time}</Text>
              <View style={styles.noticeMetaActions}>
                {unread ? (
                  <View style={styles.readAction}>
                    <Ionicons name="checkmark" size={14} color={colors.teal} />
                  <Text style={styles.readActionText}>Mark as read</Text>
                  </View>
                ) : (
                  <View style={styles.readState}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.ink40} />
                    <Text style={styles.readStateText}>Read</Text>
                  </View>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete notification: ${item.title}`}
                  disabled={deleting}
                  hitSlop={8}
                  onPress={remove}
                  style={({ pressed }) => [styles.noticeDeleteButton, pressed && styles.controlPressed, deleting && styles.followButtonDisabled]}
                >
                  {deleting ? <ActivityIndicator size="small" color={colors.ink70} /> : <Ionicons name="trash-outline" size={15} color={colors.ink70} />}
                </Pressable>
              </View>
            </View>
            {actionError ? <Text style={styles.followActionError}>{actionError}</Text> : null}
          </>
        )}
      </View>
    </>
  );

  if (followRequest) {
    return (
      <View
        accessibilityLabel={`${item.title}. Follow request`}
        style={[styles.noticeCard, unread ? styles.noticeCardUnread : styles.noticeCardRead]}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${unread ? 'Unread notification' : 'Read notification'}`}
      accessibilityHint={opensDestination ? 'Opens this notification' : unread ? 'Marks this notification as read' : undefined}
      disabled={!unread && !opensDestination}
      onPress={() => opensDestination ? onOpen(item) : onRead(item.id)}
      style={({ pressed }) => [styles.noticeCard, unread ? styles.noticeCardUnread : styles.noticeCardRead, pressed && styles.noticeCardPressed]}
    >
      {body}
    </Pressable>
  );
}

export default function NotificationSheet({ visible, onClose, items, unreadCount, onRead, onReadAll, onDelete, onClearRead, onOpen, onFollowResponse }) {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = isDark ? darkStyles : lightStyles;
  const colors = isDark ? DARK_CONTENT_COLORS : LIGHT_CONTENT_COLORS;
  const updateLabel = items.length === 1 ? '1 update' : `${items.length} updates`;
  const clearableCount = items.filter((item) => item.read_at && item.kind !== 'follow_request').length;
  const showInboxActions = unreadCount > 1 || clearableCount > 0;
  const [clearing, setClearing] = useState(false);
  const [showClearAlert, setShowClearAlert] = useState(false);
  const confirmClearRead = () => setShowClearAlert(true);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <View {...webDialog('backdrop')} style={styles.backdrop}>
          <Pressable accessibilityLabel="Close notifications" onPress={onClose} style={styles.backdropDismiss} />
          <View {...webDialog('surface')} accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View {...webDialog('handle')} style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.eyebrow}>INBOX</Text>
                <Text style={styles.title}>Notifications</Text>
                <Text style={styles.subtitle}>{items.length ? `${updateLabel} in your inbox` : 'Your notification inbox'}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close notifications" hitSlop={8} onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed && styles.controlPressed]}>
                <Ionicons name="close" size={23} color={colors.ink} />
              </Pressable>
            </View>
            <KitchenLine styles={styles} />

            {showInboxActions ? (
              <View style={styles.inboxStatus}>
                <View>
                  <Text style={styles.statusLabel}>{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</Text>
                  <Text style={styles.statusCount}>{items.length === 1 ? '1 notification' : `${items.length} notifications`}</Text>
                </View>
                {unreadCount > 1 ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Mark all notifications as read" onPress={onReadAll} style={({ pressed }) => [styles.markAllButton, pressed && styles.controlPressed]}>
                    <Ionicons name="checkmark-done" size={17} color={colors.teal} />
                    <Text style={styles.markAllText}>Read all</Text>
                  </Pressable>
                ) : clearableCount > 0 ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${clearableCount} read notifications`} disabled={clearing} onPress={confirmClearRead} style={({ pressed }) => [styles.markAllButton, pressed && styles.controlPressed, clearing && styles.followButtonDisabled]}>
                    {clearing ? <ActivityIndicator size="small" color={colors.ink70} /> : <Ionicons name="trash-outline" size={16} color={colors.ink70} />}
                    <Text style={styles.clearReadText}>Clear read</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <ScrollView style={styles.list} contentContainerStyle={[styles.listContent, !items.length && styles.listContentEmpty]} showsVerticalScrollIndicator={false}>
              {items.length ? items.map((item, index) => (
                <React.Fragment key={item.id}>
                  {index === 0 || items[index - 1].group !== item.group ? <Text style={styles.groupLabel}>{item.group}</Text> : null}
                  <NotificationCard item={item} onRead={onRead} onDelete={onDelete} onOpen={onOpen} onFollowResponse={onFollowResponse} styles={styles} colors={colors} />
                </React.Fragment>
              )) : (
                <View style={styles.emptyState}>
                  <View style={styles.emptyDotOne} />
                  <View style={styles.emptyDotTwo} />
                  <View style={styles.emptyIcon}>
                    <Ionicons name="checkmark-done" size={31} color={colors.teal} />
                  </View>
                  <Text style={styles.emptyTitle}>Nothing needs your attention</Text>
                  <Text style={styles.emptyBody}>Follow requests, booking confirmations, match reminders, and venue updates will land here.</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
        {showClearAlert && (
          <View {...webDialog('backdrop')} style={styles.alertOverlay}>
            <View {...webDialog('surface')} style={styles.alertCard}>
              <Text style={styles.alertTitle}>Clear read notifications?</Text>
              <Text style={styles.alertMessage}>{clearableCount} read notification{clearableCount === 1 ? '' : 's'} will be permanently deleted.</Text>
              <View style={styles.alertActions}>
                <Pressable accessibilityRole="button" onPress={() => setShowClearAlert(false)} style={({ pressed }) => [styles.alertButton, styles.alertKeep, pressed && styles.controlPressed]}><Text style={styles.alertKeepText}>Cancel</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={async () => {
                  setShowClearAlert(false);
                  setClearing(true);
                  try { await onClearRead(); }
                  catch (error) { Alert.alert('Notifications', error.message || 'Read notifications could not be cleared.'); }
                  finally { setClearing(false); }
                }} style={({ pressed }) => [styles.alertButton, styles.alertCancel, pressed && styles.controlPressed]}><Text style={styles.alertCancelText}>Clear</Text></Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const sheetShadow = Platform.select({
  ios: { shadowColor: '#0E2321', shadowOpacity: 0.16, shadowRadius: 28, shadowOffset: { width: 0, height: -8 } },
  android: { elevation: 18 },
  default: {},
});

const lightStyles = createMobileStyleSheet({
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
  inboxStatus: { minHeight: 52, paddingHorizontal: 4, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottomWidth: 1, borderBottomColor: '#DDE3DA' },
  statusLabel: { color: '#0E2321', fontSize: 12, lineHeight: 16, fontWeight: '800' },
  statusCount: { marginTop: 1, color: '#7C8983', fontSize: 10, lineHeight: 14 },
  markAllButton: { minHeight: 38, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: '#DDE3DA', borderRadius: 12, backgroundColor: '#FFFFFF' },
  markAllText: { color: '#1C6B66', fontSize: 11, fontWeight: '800' },
  clearReadText: { color: '#3C4A45', fontSize: 11, fontWeight: '800' },
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
  noticeMetaActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeDeleteButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DDE3DA', borderRadius: 10, backgroundColor: '#F3F5EF' },
  followActions: { marginTop: 10, flexDirection: 'row', gap: 8 },
  acceptButton: { minHeight: 40, flex: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, backgroundColor: '#D6E94A' },
  acceptButtonText: { color: '#0E2321', fontSize: 11, fontWeight: '900' },
  deleteButton: { minHeight: 40, flex: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: '#DDE3DA', borderRadius: 12, backgroundColor: '#F3F5EF' },
  deleteButtonText: { color: '#3C4A45', fontSize: 11, fontWeight: '800' },
  followButtonDisabled: { opacity: .62 },
  followActionError: { marginTop: 7, color: '#B6472E', fontSize: 10, lineHeight: 14 },
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
  alertOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,18,17,0.58)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 100 },
  alertCard: { width: '100%', maxWidth: 320, padding: 20, borderRadius: 24, backgroundColor: '#E5F0ED', ...sheetShadow },
  alertTitle: { color: '#0E2321', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  alertMessage: { marginTop: 8, color: '#7C8983', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  alertActions: { marginTop: 24, flexDirection: 'row', gap: 10 },
  alertButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  alertKeep: { backgroundColor: '#BFD8D2' },
  alertKeepText: { color: '#0E2321', fontSize: 12, fontWeight: '900' },
  alertCancel: { backgroundColor: '#F7EAE6' },
  alertCancelText: { color: '#B6472E', fontSize: 12, fontWeight: '900' },
});

const darkStyles = createDarkStyleSheet(lightStyles);
