import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Modal from './ResponsiveModal';
import AppIcon from './AppIcon';
import { DARK_CONTENT_COLORS, LIGHT_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { webDialog } from '../utils/webLayout';

const GROUP_LABELS = { TODAY: 'Today', 'THIS WEEK': 'This week', EARLIER: 'Earlier' };

function NotificationRow({ item, onRead, onDelete, onOpen, onFollowResponse, menuOpen, onToggleMenu, styles, colors }) {
  const unread = !item.read_at;
  const opensDestination = Boolean(onOpen && (item.data?.conversationId || item.data?.sessionId || item.data?.gameId
    || (item.kind?.startsWith('team_invite') && item.data?.teamId)
    || (item.kind === 'community_announcement' && item.data?.eventKind && item.data?.eventId)));
  const followRequest = Boolean(item.kind === 'follow_request' && item.data?.requesterId && onFollowResponse);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const runAction = async (action, callback) => {
    if (busy) return;
    setBusy(action);
    setActionError('');
    try {
      await callback();
      if (menuOpen) onToggleMenu();
    } catch (error) {
      setActionError(error.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy('');
    }
  };
  const content = (
    <>
      <View style={[styles.noticeIcon, unread && styles.noticeIconUnread]}>
        <AppIcon name={item.icon || 'notifications-outline'} size={20} color={unread ? colors.teal : colors.muted} />
      </View>
      <View style={styles.noticeCopy}>
        <View style={styles.noticeTitleRow}>
          <Text style={[styles.noticeTitle, unread && styles.noticeTitleUnread]}>{item.title}</Text>
          {unread ? <View style={styles.unreadDot} /> : null}
        </View>
        <Text style={styles.noticeBody}>{item.body}</Text>
        <View style={styles.noticeMeta}>
          <Text style={styles.noticeTime}>{item.time}</Text>
          {opensDestination ? <Ionicons name="arrow-forward" size={13} color={colors.muted} /> : null}
        </View>
      </View>
    </>
  );

  return (
    <View style={[styles.noticeRow, unread && styles.noticeRowUnread]}>
      <View style={styles.noticeMain}>
        {followRequest ? <View style={styles.noticeContent}>{content}</View> : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${unread ? 'Unread notification' : 'Read notification'}. ${item.body}. ${item.time}`}
            accessibilityHint={opensDestination ? 'Opens this notification' : unread ? 'Marks this notification as read' : undefined}
            disabled={Boolean(busy) || (!unread && !opensDestination)}
            onPress={() => opensDestination ? onOpen(item) : runAction('read', () => onRead(item.id))}
            style={({ pressed }) => [styles.noticeContent, pressed && styles.controlPressed]}
          >
            {content}
          </Pressable>
        )}
        {!followRequest && onDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Actions for notification: ${item.title}`}
            accessibilityState={{ expanded: menuOpen }}
            onPress={onToggleMenu}
            style={({ pressed }) => [styles.moreButton, menuOpen && styles.moreButtonActive, pressed && styles.controlPressed]}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {followRequest ? (
        <View style={styles.rowActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Accept follow request from ${item.data?.playerName || 'player'}`}
            disabled={Boolean(busy)}
            onPress={() => runAction('accept', () => onFollowResponse(item, true))}
            style={({ pressed }) => [styles.acceptButton, pressed && styles.controlPressed, busy && styles.controlDisabled]}
          >
            {busy === 'accept' ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Text style={styles.acceptText}>Accept</Text>}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Decline follow request from ${item.data?.playerName || 'player'}`}
            disabled={Boolean(busy)}
            onPress={() => runAction('decline', () => onFollowResponse(item, false))}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.controlPressed, busy && styles.controlDisabled]}
          >
            {busy === 'decline' ? <ActivityIndicator size="small" color={colors.ink70} /> : <Text style={styles.secondaryText}>Decline</Text>}
          </Pressable>
        </View>
      ) : menuOpen ? (
        <View style={styles.rowActions}>
          {unread ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Mark notification as read: ${item.title}`} disabled={Boolean(busy)} onPress={() => runAction('read', () => onRead(item.id))} style={({ pressed }) => [styles.inlineAction, pressed && styles.controlPressed]}>
              {busy === 'read' ? <ActivityIndicator size="small" color={colors.teal} /> : <Ionicons name="checkmark-done-outline" size={16} color={colors.teal} />}
              <Text style={styles.inlineActionText}>Mark as read</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete notification: ${item.title}`} disabled={Boolean(busy)} onPress={() => runAction('delete', () => onDelete(item.id))} style={({ pressed }) => [styles.inlineAction, pressed && styles.controlPressed]}>
            {busy === 'delete' ? <ActivityIndicator size="small" color={colors.muted} /> : <Ionicons name="trash-outline" size={15} color={colors.muted} />}
            <Text style={styles.secondaryText}>Delete</Text>
          </Pressable>
        </View>
      ) : null}
      {actionError ? <Text accessibilityRole="alert" style={styles.actionError}>{actionError}</Text> : null}
    </View>
  );
}

export default function NotificationSheet({ visible, onClose, items = [], unreadCount = 0, onRead, onReadAll, onDelete, onClearRead, onOpen, onFollowResponse }) {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = isDark ? darkStyles : lightStyles;
  const colors = isDark ? darkColors : lightColors;
  const [filter, setFilter] = useState('all');
  const [activeMenu, setActiveMenu] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [readingAll, setReadingAll] = useState(false);
  const [showClearAlert, setShowClearAlert] = useState(false);
  const clearableCount = items.filter((item) => item.read_at && item.kind !== 'follow_request').length;
  const filteredItems = filter === 'unread' ? items.filter((item) => !item.read_at) : items;

  useEffect(() => {
    if (!visible) {
      setFilter('all');
      setActiveMenu(null);
      setShowClearAlert(false);
    }
  }, [visible]);

  const readAll = async () => {
    if (readingAll) return;
    setReadingAll(true);
    try { await onReadAll(); }
    catch (error) { Alert.alert('Notifications', error.message || 'Notifications could not be marked as read.'); }
    finally { setReadingAll(false); }
  };
  const clearRead = async () => {
    setShowClearAlert(false);
    setClearing(true);
    try { await onClearRead(); }
    catch (error) { Alert.alert('Notifications', error.message || 'Read notifications could not be cleared.'); }
    finally { setClearing(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => showClearAlert ? setShowClearAlert(false) : onClose()} statusBarTranslucent>
      <View {...webDialog('backdrop')} style={styles.backdrop}>
        <Pressable accessibilityLabel="Close notifications" onPress={onClose} style={styles.backdropDismiss} accessible={false} importantForAccessibility="no" />
        <View {...webDialog('surface')} accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View {...webDialog('handle')} style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" style={styles.title}>Notifications</Text>
              <Text style={styles.subtitle}>Matches, bookings and community updates.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close notifications" onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed && styles.controlPressed]}>
              <Ionicons name="close" size={21} color={colors.ink70} />
            </Pressable>
          </View>
          <View style={styles.toolbar}>
            <View accessibilityRole="tablist" style={styles.tabs}>
              {[['all', 'All'], ['unread', 'Unread']].map(([value, label]) => (
                <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === 'unread' ? `Unread notifications, ${unreadCount}` : 'All notifications'} accessibilityState={{ selected: filter === value }} onPress={() => { setFilter(value); setActiveMenu(null); }} style={[styles.tab, filter === value && styles.tabActive]}>
                  <Text style={[styles.tabText, filter === value && styles.tabTextActive]}>{label}</Text>
                  {value === 'unread' && unreadCount > 0 ? <View style={styles.countBadge}><Text style={styles.countText}>{unreadCount > 99 ? '99+' : unreadCount}</Text></View> : null}
                </Pressable>
              ))}
            </View>
            {unreadCount > 0 && onReadAll ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Mark all notifications as read" disabled={readingAll} onPress={readAll} style={({ pressed }) => [styles.markAllButton, pressed && styles.controlPressed, readingAll && styles.controlDisabled]}>
                {readingAll ? <ActivityIndicator size="small" color={colors.teal} /> : <Ionicons name="checkmark-done-outline" size={17} color={colors.teal} />}
                <Text style={styles.markAllText}>Read all</Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView style={styles.list} contentContainerStyle={[styles.listContent, !filteredItems.length && styles.listContentEmpty]} showsVerticalScrollIndicator={false}>
            {filteredItems.length ? filteredItems.map((item, index) => (
              <React.Fragment key={item.id}>
                {index === 0 || filteredItems[index - 1].group !== item.group ? (
                  <View style={styles.groupHeader}><Text accessibilityRole="header" style={styles.groupLabel}>{GROUP_LABELS[item.group] || item.group}</Text><View style={styles.groupRule} /></View>
                ) : null}
                <NotificationRow item={item} onRead={onRead} onDelete={onDelete} onOpen={onOpen} onFollowResponse={onFollowResponse} menuOpen={activeMenu === item.id} onToggleMenu={() => setActiveMenu((current) => current === item.id ? null : item.id)} styles={styles} colors={colors} />
              </React.Fragment>
            )) : (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}><Ionicons name={filter === 'unread' ? 'checkmark-done-outline' : 'notifications-outline'} size={27} color={colors.teal} /></View>
                <Text style={styles.emptyTitle}>{filter === 'unread' ? 'You’re all caught up' : 'No notifications yet'}</Text>
                <Text style={styles.emptyBody}>{filter === 'unread' ? 'No unread notifications. You’re up to date.' : 'Your match updates, bookings and follow requests will appear here.'}</Text>
                {filter === 'unread' && items.length > 0 ? <Pressable accessibilityRole="button" onPress={() => setFilter('all')} style={({ pressed }) => [styles.emptyAction, pressed && styles.controlPressed]}><Text style={styles.inlineActionText}>View all notifications</Text><Ionicons name="arrow-forward" size={15} color={colors.teal} /></Pressable> : null}
              </View>
            )}
          </ScrollView>
          {items.length > 0 ? (
            <View style={styles.footer}>
              <Text style={styles.footerText}>{items.length} notification{items.length === 1 ? '' : 's'}</Text>
              {clearableCount > 0 && onClearRead ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${clearableCount} read notifications`} disabled={clearing} onPress={() => setShowClearAlert(true)} style={({ pressed }) => [styles.clearButton, pressed && styles.controlPressed, clearing && styles.controlDisabled]}>
                  {clearing ? <ActivityIndicator size="small" color={colors.muted} /> : <Ionicons name="trash-outline" size={14} color={colors.muted} />}
                  <Text style={styles.footerText}>Clear read</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
      <Modal visible={showClearAlert} transparent animationType="fade" onRequestClose={() => setShowClearAlert(false)}>
        <View style={styles.alertOverlay}>
          <View accessibilityViewIsModal style={styles.alertCard}>
            <Text accessibilityRole="header" style={styles.alertTitle}>Clear read notifications?</Text>
            <Text style={styles.alertMessage}>{clearableCount} read notification{clearableCount === 1 ? '' : 's'} will be deleted. Unread notifications and follow requests will stay in your inbox.</Text>
            <View style={styles.alertActions}>
              <Pressable accessibilityRole="button" onPress={() => setShowClearAlert(false)} style={({ pressed }) => [styles.alertButton, styles.secondaryButton, pressed && styles.controlPressed]}><Text style={styles.secondaryText}>Keep them</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={clearRead} style={({ pressed }) => [styles.alertButton, styles.destructiveButton, pressed && styles.controlPressed]}><Text style={styles.destructiveText}>Clear read</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const lightColors = { ...LIGHT_CONTENT_COLORS, surface: '#FFFFFF', soft: '#F3F5F2', divider: '#E8ECE8', muted: '#6D7B74', unread: '#F7FAF8', onAccent: '#FFFFFF' };
const darkColors = { ...DARK_CONTENT_COLORS, surface: '#132B28', soft: '#203A35', divider: '#2B423C', muted: '#9FB3AC', unread: '#19342F', onAccent: '#0E2321' };
const sheetShadow = Platform.select({
  ios: { shadowColor: '#0E2321', shadowOpacity: 0.12, shadowRadius: 28, shadowOffset: { width: 0, height: -8 } },
  android: { elevation: 18 },
  default: {},
});

const createStyles = (c) => StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'rgba(9,24,21,0.42)' },
  backdropDismiss: { ...StyleSheet.absoluteFillObject },
  sheet: { width: '100%', maxWidth: 600, height: '88%', maxHeight: 760, paddingTop: 10, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: c.surface, overflow: 'hidden', ...sheetShadow },
  handle: { width: 32, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: c.divider },
  header: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 22, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: c.ink, fontSize: 25, lineHeight: 32, fontWeight: '600', letterSpacing: -0.8 },
  subtitle: { marginTop: 5, color: c.muted, fontSize: 13, lineHeight: 19 },
  closeButton: { width: 44, height: 44, marginTop: -6, marginRight: -10, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  controlPressed: { opacity: 0.6 },
  controlDisabled: { opacity: 0.5 },
  toolbar: { paddingHorizontal: 24, minHeight: 49, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottomWidth: 1, borderBottomColor: c.divider },
  tabs: { flexDirection: 'row', alignSelf: 'stretch', gap: 22 },
  tab: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 2, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: c.teal },
  tabText: { color: c.muted, fontSize: 13, lineHeight: 19, fontWeight: '500' },
  tabTextActive: { color: c.ink, fontWeight: '600' },
  countBadge: { minWidth: 20, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6, alignItems: 'center', backgroundColor: c.soft },
  countText: { color: c.ink70, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  markAllButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5 },
  markAllText: { color: c.teal, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingBottom: 16 },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  groupHeader: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 14 },
  groupLabel: { color: c.muted, fontSize: 12, lineHeight: 18, fontWeight: '500' },
  groupRule: { height: 1, flex: 1, backgroundColor: c.divider },
  noticeRow: { paddingVertical: 18, paddingLeft: 24, paddingRight: 14, borderBottomWidth: 1, borderBottomColor: c.divider },
  noticeRowUnread: { backgroundColor: c.unread },
  noticeMain: { flexDirection: 'row', alignItems: 'flex-start' },
  noticeContent: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  noticeIcon: { width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: c.soft },
  noticeIconUnread: { backgroundColor: c.tealWash },
  noticeCopy: { flex: 1, minWidth: 0 },
  noticeTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  noticeTitle: { flexShrink: 1, color: c.ink70, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  noticeTitleUnread: { color: c.ink, fontWeight: '600' },
  unreadDot: { width: 6, height: 6, flexShrink: 0, marginTop: 7, borderRadius: 3, backgroundColor: c.teal },
  noticeBody: { marginTop: 4, color: c.ink70, fontSize: 13, lineHeight: 20 },
  noticeMeta: { marginTop: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeTime: { color: c.muted, fontSize: 11, lineHeight: 16 },
  moreButton: { width: 44, height: 44, marginTop: -12, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  moreButtonActive: { backgroundColor: c.soft },
  rowActions: { marginTop: 12, marginLeft: 52, paddingRight: 10, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  acceptButton: { minHeight: 44, minWidth: 90, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: c.teal },
  acceptText: { color: c.onAccent, fontSize: 13, fontWeight: '600' },
  secondaryButton: { minHeight: 44, minWidth: 90, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.divider, borderRadius: 8, backgroundColor: c.surface },
  secondaryText: { color: c.ink70, fontSize: 12, lineHeight: 18, fontWeight: '500' },
  inlineAction: { minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, backgroundColor: c.soft },
  inlineActionText: { color: c.teal, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  actionError: { marginLeft: 52, marginTop: 8, paddingRight: 10, color: c.error, fontSize: 12, lineHeight: 18 },
  emptyState: { paddingVertical: 40, paddingHorizontal: 32, alignItems: 'center' },
  emptyIcon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 32, backgroundColor: c.soft },
  emptyTitle: { marginTop: 20, color: c.ink, textAlign: 'center', fontSize: 19, lineHeight: 26, fontWeight: '600', letterSpacing: -0.3 },
  emptyBody: { maxWidth: 260, marginTop: 8, color: c.muted, textAlign: 'center', fontSize: 13, lineHeight: 21 },
  emptyAction: { minHeight: 44, marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { minHeight: 50, paddingHorizontal: 24, paddingTop: 6, borderTopWidth: 1, borderTopColor: c.divider, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  footerText: { color: c.muted, fontSize: 11, lineHeight: 16 },
  clearButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  alertOverlay: { flex: 1, backgroundColor: 'rgba(9,24,21,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  alertCard: { width: '100%', maxWidth: 360, padding: 24, borderRadius: 20, backgroundColor: c.surface, ...sheetShadow },
  alertTitle: { color: c.ink, fontSize: 19, lineHeight: 26, fontWeight: '600', letterSpacing: -0.3 },
  alertMessage: { marginTop: 10, color: c.muted, fontSize: 13, lineHeight: 21 },
  alertActions: { marginTop: 24, flexDirection: 'row', gap: 10 },
  alertButton: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  destructiveButton: { backgroundColor: c.brickWash },
  destructiveText: { color: c.error, fontSize: 12, fontWeight: '600' },
});

const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors);
