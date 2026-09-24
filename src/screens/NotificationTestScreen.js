import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import AppIcon from '../components/AppIcon';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOperations } from '../context/OperationsContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  configureInteractiveNotifications,
  getLastNotificationTest,
  scheduleClosedAppNotificationTest,
} from '../services/notificationActions';

const PALETTE = {
  light: {
    paper: '#F3F5EF', surface: '#FFFFFF', ink: '#0E2321', ink70: '#3C4A45',
    muted: '#7C8983', line: '#DDE3DA', optic: '#D6E94A', teal: '#1C6B66',
    wash: '#E5F0ED', warning: '#B6472E', warningWash: '#F7EAE6',
  },
  dark: {
    paper: '#0E2321', surface: '#17302D', ink: '#F3F5EF', ink70: '#D9E1DD',
    muted: '#9FB3AC', line: '#304743', optic: '#D6E94A', teal: '#7FC3BA',
    wash: '#203E3A', warning: '#F09A83', warningWash: '#432D29',
  },
};

function StatusPill({ icon, label, positive, colors }) {
  return (
    <View style={[styles.statusPill, { backgroundColor: positive ? colors.wash : colors.warningWash }]}>
      <Ionicons name={icon} size={14} color={positive ? colors.teal : colors.warning} />
      <Text style={[styles.statusPillText, { color: positive ? colors.teal : colors.warning }]}>{label}</Text>
    </View>
  );
}

function Step({ number, title, detail, complete, colors, last }) {
  return (
    <View style={[styles.step, !last && { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <View style={[styles.stepNumber, { backgroundColor: complete ? colors.optic : colors.wash }]}>
        {complete
          ? <Ionicons name="checkmark" size={16} color="#0E2321" />
          : <Text style={[styles.stepNumberText, { color: colors.teal }]}>{number}</Text>}
      </View>
      <View style={styles.stepCopy}>
        <Text style={[styles.stepTitle, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.stepDetail, { color: colors.muted }]}>{detail}</Text>
      </View>
    </View>
  );
}

export default function NotificationTestScreen({ navigation }) {
  const { isDark } = useTheme();
  const colors = isDark ? PALETTE.dark : PALETTE.light;
  const { enablePushNotifications } = useOperations();
  const { user, updateProfile } = useAuth();
  const [permission, setPermission] = useState('undetermined');
  const [messagesEnabled, setMessagesEnabled] = useState(user?.preferences?.messages !== false);
  const [lastTest, setLastTest] = useState(null);
  const [busy, setBusy] = useState('');
  const [deliveryAt, setDeliveryAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const physicalDevice = Boolean(Device.isDevice);
  const allowed = permission === 'granted';

  useEffect(() => {
    setMessagesEnabled(user?.preferences?.messages !== false);
  }, [user?.preferences?.messages]);

  const refresh = useCallback(async () => {
    const [permissionResult, testResult] = await Promise.all([
      Notifications.getPermissionsAsync(),
      getLastNotificationTest(),
    ]);
    setPermission(permissionResult.status);
    setLastTest(testResult);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh().catch(() => {});
    });
    const unsubscribeFocus = navigation.addListener('focus', () => refresh().catch(() => {}));
    return () => {
      appState.remove();
      unsubscribeFocus();
    };
  }, [navigation, refresh]);

  useEffect(() => {
    if (!deliveryAt) return undefined;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deliveryAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (!remaining) setDeliveryAt(0);
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [deliveryAt]);

  const enable = async () => {
    setBusy('enable');
    try {
      if (physicalDevice) {
        await enablePushNotifications();
      } else {
        await configureInteractiveNotifications();
        const nextPermission = await Notifications.requestPermissionsAsync();
        if (nextPermission.status !== 'granted') throw new Error('Notification permission was not granted.');
      }
      await refresh();
      Alert.alert('Notifications are ready', 'Peakle can now deliver messages while the app is in the background or closed.');
    } catch (error) {
      Alert.alert('Could not enable notifications', error.message || 'Check the notification settings for Peakle.');
    } finally {
      setBusy('');
    }
  };

  const runTest = async () => {
    setBusy('test');
    try {
      if (!allowed) {
        if (physicalDevice) {
          await enablePushNotifications();
        } else {
          await configureInteractiveNotifications();
          const nextPermission = await Notifications.requestPermissionsAsync();
          if (nextPermission.status !== 'granted') throw new Error('Notification permission was not granted.');
        }
      }
      await scheduleClosedAppNotificationTest(10);
      setLastTest(null);
      setDeliveryAt(Date.now() + 10000);
      Alert.alert(
        'Test scheduled for 10 seconds',
        'Lock your phone or swipe Peakle away now. When the notification arrives, expand it and tap Reply.',
      );
      await refresh();
    } catch (error) {
      Alert.alert('Test could not start', error.message || 'Notifications are unavailable on this device.');
    } finally {
      setBusy('');
    }
  };

  const toggleMessages = async () => {
    const next = !messagesEnabled;
    setBusy('preference');
    try {
      if (next && physicalDevice) await enablePushNotifications();
      await updateProfile({
        preferences: { ...(user?.preferences || {}), messages: next },
      });
      setMessagesEnabled(next);
    } catch (error) {
      Alert.alert('Could not update message alerts', error.message || 'Try again in a moment.');
    } finally {
      setBusy('');
    }
  };

  const testDate = lastTest?.completedAt
    ? new Date(lastTest.completedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} onPress={() => navigation.goBack()} style={[styles.backButton, { borderColor: colors.line, backgroundColor: colors.surface }]}>
          <Ionicons name="arrow-back" size={21} color={colors.ink} />
        </Pressable>
        <View style={styles.topbarCopy}>
          <Text style={[styles.eyebrow, { color: colors.teal }]}>MESSAGING · DEVICE TEST</Text>
          <Text style={[styles.heading, { color: colors.ink }]}>Notifications</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { backgroundColor: '#0E2321' }]}>
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}><Ionicons name="notifications" size={23} color="#0E2321" /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>STAY IN THE CONVERSATION</Text>
              <Text style={styles.heroTitle}>Messages, even when Peakle is closed.</Text>
            </View>
          </View>
          <Text style={styles.heroBody}>Incoming chats appear on the lock screen. Expand a message to reply without opening the conversation.</Text>
          <View style={styles.heroStatuses}>
            <StatusPill icon={physicalDevice ? 'phone-portrait' : 'desktop-outline'} label={physicalDevice ? 'Physical device' : 'Simulator'} positive={physicalDevice} colors={PALETTE.dark} />
            <StatusPill icon={allowed ? 'checkmark-circle' : 'alert-circle'} label={allowed ? 'Allowed' : 'Permission needed'} positive={allowed} colors={PALETTE.dark} />
            <StatusPill icon={messagesEnabled ? 'chatbubble-ellipses' : 'chatbubble-outline'} label={messagesEnabled ? 'Chat alerts on' : 'Chat alerts off'} positive={messagesEnabled} colors={PALETTE.dark} />
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>LOCK-SCREEN PREVIEW</Text>
        <View style={[styles.phonePreview, { backgroundColor: isDark ? '#243B38' : '#DCE4E0' }]}>
          <View style={styles.previewTimeRow}>
            <Text style={[styles.previewTime, { color: colors.ink }]}>9:41</Text>
            <Ionicons name="lock-closed" size={12} color={colors.ink70} />
          </View>
          <View style={[styles.notificationPreview, { backgroundColor: isDark ? '#304A46' : 'rgba(255,255,255,.94)' }]}>
            <View style={styles.previewHead}>
              <View style={styles.previewAppIcon}><AppIcon name="tennisball" size={13} color="#0E2321" /></View>
              <Text style={[styles.previewApp, { color: colors.ink70 }]}>PEAKLE</Text>
              <Text style={[styles.previewNow, { color: colors.muted }]}>now</Text>
            </View>
            <Text style={[styles.previewSender, { color: colors.ink }]}>Alex Santos</Text>
            <Text style={[styles.previewMessage, { color: colors.ink70 }]}>Are we still on for pickleball tonight?</Text>
            <View style={styles.previewActions}>
              <View style={[styles.previewAction, { borderColor: colors.line }]}><Text style={[styles.previewActionText, { color: colors.teal }]}>Mark as read</Text></View>
              <View style={[styles.previewReply, { backgroundColor: colors.wash }]}><Ionicons name="return-down-back" size={14} color={colors.teal} /><Text style={[styles.previewActionText, { color: colors.teal }]}>Reply</Text></View>
            </View>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>DEVICE READINESS</Text>
        <View style={[styles.card, { borderColor: colors.line, backgroundColor: colors.surface }]}>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: messagesEnabled }} disabled={busy === 'preference'} onPress={toggleMessages} style={styles.preferenceRow}>
            <View style={[styles.readinessIcon, { backgroundColor: messagesEnabled ? colors.wash : colors.warningWash }]}>
              <Ionicons name="chatbubble-ellipses-outline" size={21} color={messagesEnabled ? colors.teal : colors.warning} />
            </View>
            <View style={styles.readinessCopy}>
              <Text style={[styles.cardTitle, { color: colors.ink }]}>Message alerts</Text>
              <Text style={[styles.cardDetail, { color: colors.muted }]}>Show private chats outside the app</Text>
            </View>
            <View style={[styles.toggleTrack, { backgroundColor: messagesEnabled ? colors.optic : colors.line }]}>
              <View style={[styles.toggleThumb, messagesEnabled && styles.toggleThumbOn]} />
            </View>
          </Pressable>
          <View style={[styles.cardDivider, { backgroundColor: colors.line }]} />
          <View style={styles.readinessRow}>
            <View style={[styles.readinessIcon, { backgroundColor: allowed ? colors.wash : colors.warningWash }]}>
              <Ionicons name={allowed ? 'shield-checkmark' : 'notifications-off-outline'} size={21} color={allowed ? colors.teal : colors.warning} />
            </View>
            <View style={styles.readinessCopy}>
              <Text style={[styles.cardTitle, { color: colors.ink }]}>{allowed ? 'System notifications enabled' : 'Permission required'}</Text>
              <Text style={[styles.cardDetail, { color: colors.muted }]}>
                {allowed ? 'Messages can appear outside Peakle.' : 'Allow notifications to receive messages when the app is closed.'}
              </Text>
            </View>
          </View>
          {!allowed ? (
            <Pressable disabled={Boolean(busy)} onPress={enable} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.line }, pressed && styles.pressed]}>
              {busy === 'enable' ? <ActivityIndicator color={colors.teal} /> : <><Ionicons name="notifications-outline" size={18} color={colors.teal} /><Text style={[styles.secondaryButtonText, { color: colors.teal }]}>Allow notifications</Text></>}
            </Pressable>
          ) : null}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>CLOSED-APP TEST</Text>
        <View style={[styles.card, { borderColor: colors.line, backgroundColor: colors.surface }]}>
          <Step number="1" title="Schedule the test" detail="Peakle waits 10 seconds before delivering a real system notification." complete={Boolean(deliveryAt || lastTest)} colors={colors} />
          <Step number="2" title="Close or lock the phone" detail="Swipe Peakle away from recents, or simply lock the screen." complete={Boolean(lastTest)} colors={colors} />
          <Step number="3" title="Reply from the notification" detail="Expand the alert, tap Reply, type a message, and send." complete={Boolean(lastTest?.reply)} colors={colors} last />

          {lastTest ? (
            <View style={[styles.result, { backgroundColor: colors.wash }]}>
              <View style={styles.resultTop}><Ionicons name="checkmark-circle" size={20} color={colors.teal} /><Text style={[styles.resultTitle, { color: colors.teal }]}>Test passed</Text><Text style={[styles.resultDate, { color: colors.muted }]}>{testDate}</Text></View>
              {lastTest.reply ? <Text style={[styles.resultReply, { color: colors.ink70 }]}>Reply captured: “{lastTest.reply}”</Text> : null}
            </View>
          ) : null}

          <Pressable disabled={Boolean(busy || deliveryAt)} onPress={runTest} style={({ pressed }) => [styles.primaryButton, (busy || deliveryAt) && styles.disabled, pressed && styles.pressed]}>
            {busy === 'test'
              ? <ActivityIndicator color="#0E2321" />
              : <><Ionicons name={deliveryAt ? 'timer-outline' : 'paper-plane-outline'} size={19} color="#0E2321" /><Text style={styles.primaryButtonText}>{deliveryAt ? `Arriving in ${secondsLeft}s` : lastTest ? 'Run test again' : 'Send test in 10 seconds'}</Text></>}
          </Pressable>
        </View>

        <View style={[styles.note, { backgroundColor: colors.warningWash }]}>
          <Ionicons name="information-circle-outline" size={19} color={colors.warning} />
          <Text style={[styles.noteText, { color: colors.ink70 }]}>
            For real two-user testing, use a physical device and a development or release build. Expo Go does not support production push delivery. On Android, use swipe-away—not “Force stop” in system settings.
          </Text>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>END-TO-END CHAT CHECK</Text>
        <View style={[styles.card, { borderColor: colors.line, backgroundColor: colors.surface }]}>
          <Step number="1" title="Sign in on two accounts" detail="Use a separate physical phone for each Peakle player." colors={colors} />
          <Step number="2" title="Open an accepted conversation" detail="Both players must be connected and the message request accepted." colors={colors} />
          <Step number="3" title="Close the recipient app" detail="Lock the recipient phone or swipe Peakle away." colors={colors} />
          <Step number="4" title="Send from the other phone" detail="The recipient should see the sender and message on the lock screen." colors={colors} />
          <Step number="5" title="Reply from the alert" detail="Expand it and tap Reply. The response should appear once in both chats." colors={colors} last />
        </View>

        <Text style={[styles.footnote, { color: colors.muted }]}>Notification previews can be hidden by the phone owner’s lock-screen privacy settings.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topbar: { minHeight: 72, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1 },
  topbarCopy: { flex: 1 },
  eyebrow: { fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 1 },
  heading: { marginTop: 1, fontSize: 25, lineHeight: 30, fontWeight: '900', letterSpacing: -.6 },
  content: { paddingHorizontal: 20, paddingBottom: 42 },
  hero: { padding: 17, borderRadius: 23, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  heroIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#D6E94A' },
  heroCopy: { flex: 1 },
  heroEyebrow: { color: '#9FB3AC', fontSize: 7, lineHeight: 11, fontWeight: '900', letterSpacing: .8 },
  heroTitle: { marginTop: 3, color: '#FFFFFF', fontSize: 17, lineHeight: 22, fontWeight: '900' },
  heroBody: { marginTop: 13, color: '#D9E1DD', fontSize: 11, lineHeight: 17 },
  heroStatuses: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  statusPill: { minHeight: 27, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14 },
  statusPillText: { fontSize: 8, fontWeight: '900', letterSpacing: .25 },
  sectionLabel: { marginTop: 22, marginBottom: 8, fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: 1 },
  phonePreview: { minHeight: 226, padding: 18, justifyContent: 'center', borderRadius: 28 },
  previewTimeRow: { marginBottom: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  previewTime: { fontSize: 16, fontWeight: '800' },
  notificationPreview: { padding: 14, borderRadius: 20 },
  previewHead: { flexDirection: 'row', alignItems: 'center' },
  previewAppIcon: { width: 25, height: 25, marginRight: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: '#D6E94A' },
  previewApp: { flex: 1, fontSize: 9, fontWeight: '900', letterSpacing: .7 },
  previewNow: { fontSize: 9 },
  previewSender: { marginTop: 9, fontSize: 13, fontWeight: '900' },
  previewMessage: { marginTop: 3, fontSize: 11, lineHeight: 16 },
  previewActions: { marginTop: 11, flexDirection: 'row', gap: 7 },
  previewAction: { minHeight: 31, flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
  previewReply: { minHeight: 31, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 10 },
  previewActionText: { fontSize: 9, fontWeight: '900' },
  card: { padding: 14, borderWidth: 1, borderRadius: 21, borderBottomLeftRadius: 9, borderBottomRightRadius: 9 },
  preferenceRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10 },
  readinessRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  readinessIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  readinessCopy: { flex: 1 },
  cardDivider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  toggleTrack: { width: 43, height: 25, padding: 3, justifyContent: 'center', borderRadius: 13 },
  toggleThumb: { width: 19, height: 19, borderRadius: 10, backgroundColor: '#FFFFFF' },
  toggleThumbOn: { alignSelf: 'flex-end' },
  cardTitle: { fontSize: 13, lineHeight: 18, fontWeight: '900' },
  cardDetail: { marginTop: 3, fontSize: 10, lineHeight: 15 },
  secondaryButton: { minHeight: 46, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderRadius: 13 },
  secondaryButtonText: { fontSize: 10, fontWeight: '900' },
  step: { minHeight: 69, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNumber: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  stepNumberText: { fontSize: 11, fontWeight: '900' },
  stepCopy: { flex: 1 },
  stepTitle: { fontSize: 11, lineHeight: 15, fontWeight: '900' },
  stepDetail: { marginTop: 3, fontSize: 9, lineHeight: 14 },
  result: { marginTop: 10, padding: 11, borderRadius: 13 },
  resultTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultTitle: { flex: 1, fontSize: 10, fontWeight: '900' },
  resultDate: { fontSize: 8 },
  resultReply: { marginTop: 7, fontSize: 9, lineHeight: 14 },
  primaryButton: { minHeight: 51, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: '#D6E94A' },
  primaryButtonText: { color: '#0E2321', fontSize: 11, fontWeight: '900' },
  note: { marginTop: 12, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 15 },
  noteText: { flex: 1, fontSize: 9, lineHeight: 15 },
  footnote: { marginTop: 12, paddingHorizontal: 8, textAlign: 'center', fontSize: 8, lineHeight: 13 },
  pressed: { opacity: .76, transform: [{ scale: .99 }] },
  disabled: { opacity: .58 },
});
