import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import ProfilePhoto from '../components/ProfilePhoto';
import ProfilePhotoPicker from '../components/ProfilePhotoPicker';
import NotificationSheet from '../components/NotificationSheet';
import ScrollView from '../components/FocusResetScrollView';
import { useAuth } from '../context/AuthContext';
import { useOpenPlaySession } from '../context/OpenPlaySessionContext';
import { useOperations } from '../context/OperationsContext';
import { useOrganizerPass } from '../context/OrganizerPassContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { listManagedVenues } from '../services/database';
import { getOrganizerPassPlan } from '../services/organizerPass';
import { presentNotification } from '../utils/notifications';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import BlinkingDot from '../components/BlinkingDot';

const LIGHT_C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66',
  brick: '#B6472E', error: '#A63B2B', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA',
  tealWash: '#E5F0ED', brickWash: '#F7EAE6',
};
const ORGANIZER_PREFERENCE_DEFAULTS = { organizerCourtAlerts: true, organizerCheckInAlerts: true };

function organizerPreferences(saved) {
  return { ...ORGANIZER_PREFERENCE_DEFAULTS, ...(saved || {}) };
}

function Icon({ name, size = 20, color }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function Toggle({ label, value, onChange, styles, C }) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={[styles.toggle, value && styles.toggleOn]}><View style={[styles.toggleKnob, value && styles.toggleKnobOn]} /></Pressable>;
}

function SettingRow({ icon, title, detail, onPress, children, border = true, styles, C }) {
  return <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.settingRow, border && styles.rowBorder, pressed && styles.pressed]}><View style={styles.settingIcon}><Icon name={icon} size={19} color={C.teal} /></View><View style={styles.flex}><Text style={styles.settingTitle}>{title}</Text>{detail ? <Text style={styles.settingDetail}>{detail}</Text> : null}</View>{children || (onPress ? <Icon name="chevron-forward" size={17} color={C.ink40} /> : null)}</Pressable>;
}

function EditSharedAccount({ visible, user, onClose, onSave, styles, C, isDark }) {
  const [name, setName] = useState(user?.name || '');
  const [location, setLocation] = useState(user?.location || '');
  const [photo, setPhoto] = useState(user?.picture || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setName(user?.name || '');
    setLocation(user?.location || '');
    setPhoto(user?.picture || '');
    setError('');
  }, [user?.location, user?.name, user?.picture, visible]);
  const hasChanges = name.trim() !== (user?.name || '')
    || location.trim() !== (user?.location || '')
    || (photo || '') !== (user?.picture || '');
  const saveDisabled = saving || !hasChanges;

  const save = async () => {
    if (name.trim().length < 2 || name.trim().length > 80) { setError('Display name must be between 2 and 80 characters.'); return; }
    if (!location.trim()) { setError('Enter your home area.'); return; }
    setSaving(true); setError('');
    try { await onSave({ name: name.trim(), location: location.trim(), avatar: photo }); }
    catch (saveError) { setError(saveError.message || 'Account details could not be saved.'); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable accessibilityLabel="Close account editor" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHead}>
            <View style={styles.flex}><Text style={styles.eyebrow}>SHARED ACCOUNT</Text><Text style={styles.sheetTitle}>Edit identity</Text></View>
            <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.iconButton}><Icon name="close" size={21} color={C.ink} /></Pressable>
          </View>
          <Text style={styles.sharedNote}>Your name, photo and location are shared with your Player profile. Organizer activity and statistics remain separate.</Text>
          <Text style={styles.fieldLabel}>PROFILE PHOTO</Text>
          <ProfilePhotoPicker value={photo} name={name} onChange={(value) => { setPhoto(value); setError(''); }} onError={setError} colors={C} dark={isDark} />
          <Text style={styles.fieldLabel}>DISPLAY NAME</Text>
          <TextInput accessibilityLabel="Display name" value={name} onChangeText={(value) => { setName(value); setError(''); }} placeholder="Enter your display name" placeholderTextColor={C.ink40} selectionColor={C.teal} autoCapitalize="words" autoCorrect={false} maxLength={80} style={styles.input} />
          <Text style={styles.fieldLabel}>HOME AREA</Text>
          <TextInput accessibilityLabel="Home area" value={location} onChangeText={(value) => { setLocation(value); setError(''); }} placeholder="City · Region · Philippines" placeholderTextColor={C.ink40} selectionColor={C.teal} autoCapitalize="words" style={styles.input} />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Save shared identity" accessibilityState={{ disabled: saveDisabled, busy: saving }} disabled={saveDisabled} onPress={save} style={({ pressed }) => [styles.primaryButton, styles.editorSaveButton, !hasChanges && styles.editorSaveDisabled, saving && styles.disabled, pressed && !saveDisabled && styles.pressed]}>
            {saving ? <ActivityIndicator size="small" color="#0E2321" /> : <Icon name="checkmark-circle-outline" size={19} color={hasChanges ? '#0E2321' : C.ink40} />}
            <Text style={[styles.primaryText, !hasChanges && { color: C.ink40 }]}>{saving ? 'Saving changes…' : 'Save changes'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function OrganizerProfileScreen({ navigation }) {
  const { isDark } = useTheme();
  const C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  const styles = isDark ? darkStyles : lightStyles;
  const { user, updateProfile } = useAuth();
  const { session } = useOpenPlaySession();
  const { entitlement, hasOrganizerAccess, hydrated, isAdminAccess, passTier } = useOrganizerPass();
  const { notifications, unreadCount, readNotification, readAllNotifications, removeNotification, clearNotifications, respondFollowRequest, enablePushNotifications, disablePushNotifications } = useOperations();
  const [venues, setVenues] = useState([]);
  const [loadingVenues, setLoadingVenues] = useState(true);
  const [venueError, setVenueError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [preferences, setPreferences] = useState(() => organizerPreferences(user?.preferences));
  const notices = useMemo(() => notifications.map(presentNotification), [notifications]);

  useEffect(() => { setPreferences(organizerPreferences(user?.preferences)); }, [user?.preferences]);
  const loadVenues = useCallback(async () => {
    setLoadingVenues(true); setVenueError('');
    try { setVenues(await listManagedVenues()); }
    catch (error) { setVenueError(error.message || 'Managed venues could not be loaded.'); }
    finally { setLoadingVenues(false); }
  }, []);
  useFocusEffect(useCallback(() => { loadVenues(); }, [loadVenues]));

  const showToast = (message) => { setToast(message); setTimeout(() => setToast(''), 2200); };
  const setAlert = async (key, value) => {
    if (value) {
      try { await enablePushNotifications(); }
      catch (error) { showToast(error.message || 'Notifications could not be enabled.'); return; }
    }
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    if (!next.squad && !next.reminders && !next.organizerCourtAlerts && !next.organizerCheckInAlerts) disablePushNotifications().catch(() => {});
    try { await updateProfile({ preferences: next }); showToast(`${key === 'organizerCourtAlerts' ? 'Court alerts' : 'Check-in alerts'} ${value ? 'on' : 'off'}.`); }
    catch (error) { setPreferences(preferences); showToast(error.message || 'Alert preference could not be saved.'); }
  };

  const primaryVenue = venues[0];
  const primaryCourtCount = primaryVenue?.courts?.length || 0;
  const primaryVenueRole = primaryVenue?.role && primaryVenue.role !== 'admin'
    ? `${primaryVenue.role.charAt(0).toUpperCase()}${primaryVenue.role.slice(1)} · `
    : '';
  const primaryVenueMeta = `${primaryVenueRole}${primaryCourtCount} ${primaryCourtCount === 1 ? 'court' : 'courts'}${venues.length > 1 ? ` · +${venues.length - 1} more` : ''}`;
  const courtCount = venues.reduce((total, venue) => total + (venue.courts?.length || 0), 0);
  const activeCourts = session?.courts?.filter((court) => court.match).length || 0;
  const activePlayers = session?.players?.length || 0;
  const activePlan = entitlement?.planId ? getOrganizerPassPlan(entitlement.planId) : null;
  const planName = !hydrated ? 'Checking access…' : isAdminAccess ? 'Administrator access' : hasOrganizerAccess ? activePlan?.name || `Organizer ${passTier || 'Pass'}` : 'No active Organizer Pass';
  const planMeta = hasOrganizerAccess && entitlement?.currentPeriodEnd && !isAdminAccess
    ? `${entitlement.autoRenews ? 'Renews' : 'Ends'} ${new Date(entitlement.currentPeriodEnd).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : isAdminAccess ? 'Full organizer access · No expiration' : 'View plans to unlock organizer tools';

  return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.topbar}><View style={styles.headerLeading}><Pressable accessibilityRole="button" accessibilityLabel="Back to More" onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('More')} style={styles.backButton}><Icon name="arrow-back" size={20} color={C.ink} /></Pressable><View><Text style={styles.eyebrow}>ORGANIZER ACCOUNT</Text><Text style={styles.h1}>Organizer profile</Text></View></View><Pressable accessibilityLabel="Notifications" onPress={() => setNotificationsOpen(true)} style={styles.iconButton}><Icon name="notifications-outline" color={C.ink} />{unreadCount > 0 ? <View style={styles.noticeDot} /> : null}</Pressable></View>
    <View style={styles.kitchen}><View style={styles.solid} /><View style={styles.dashed} /></View>

    <View style={styles.identityCard}><View style={styles.identityHead}><ProfilePhoto photo={user?.picture} name={user?.name} size={68} /><View style={styles.identityCopy}><View style={styles.nameRow}><Text numberOfLines={1} style={styles.name}>{user?.name || 'Organizer'}</Text>{passTier ? <View style={styles.tierBadge}><Text style={styles.tierText}>{passTier.toUpperCase()}</Text></View> : null}</View><Text style={styles.identityMeta}>{user?.location || 'Set your home area'}</Text><View accessibilityLabel="Identity shared with Player profile" style={styles.sharedPill}><Icon name="link-outline" size={12} color={C.teal} /><Text style={styles.sharedPillText} numberOfLines={1}>SHARED WITH PLAYER</Text></View></View><Pressable accessibilityLabel="Edit shared account identity" onPress={() => setEditOpen(true)} style={styles.editButton}><Icon name="create-outline" size={18} color={C.teal} /></Pressable></View><Text style={styles.identityNote}>Manage your venues, sessions, staff, and reports here.</Text></View>

    <View style={styles.sectionHead}><View><Text style={styles.cardEyebrow}>OPERATIONS</Text><Text style={styles.h2}>Organizer snapshot</Text></View>{session ? <View style={styles.livePill}><BlinkingDot style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View> : null}</View>
    <View style={styles.statsCard}><View style={styles.stat}><Text style={styles.statValue}>{venues.length}</Text><Text style={styles.statLabel}>VENUES</Text></View><View style={styles.stat}><Text style={styles.statValue}>{courtCount}</Text><Text style={styles.statLabel}>COURTS</Text></View><View style={styles.stat}><Text style={styles.statValue}>{activeCourts}</Text><Text style={styles.statLabel}>IN PLAY</Text></View><View style={[styles.stat, styles.statLast]}><Text style={styles.statValue}>{activePlayers}</Text><Text style={styles.statLabel}>PLAYERS</Text></View></View>

    <Text style={styles.sectionLabel}>ORGANIZER DETAILS</Text><View style={styles.settingsCard}>
      <SettingRow icon="business-outline" title={loadingVenues ? 'Loading managed venues…' : primaryVenue?.name || 'No managed venue'} detail={venueError || (primaryVenue ? primaryVenueMeta : 'Add or claim a venue from Venue management')} onPress={() => navigation.navigate('Venue')} border={false} styles={styles} C={C}>{loadingVenues ? <ActivityIndicator color={C.teal} /> : <Icon name="chevron-forward" size={17} color={C.ink40} />}</SettingRow>
      <SettingRow icon="diamond-outline" title={planName} detail={planMeta} onPress={() => navigation.navigate('Pass')} styles={styles} C={C} />
      <SettingRow icon="people-outline" title="Staff & permissions" detail="Manage organizer and court-monitor access" onPress={() => navigation.navigate('Staff')} styles={styles} C={C} />
    </View>

    <Text style={styles.sectionLabel}>ORGANIZER ALERTS</Text><View style={styles.settingsCard}>
      <SettingRow icon="pulse-outline" title="Court alerts" detail="Match point, finished games, and open courts" border={false} styles={styles} C={C}><Toggle label="Court alerts" value={Boolean(preferences.organizerCourtAlerts)} onChange={(value) => setAlert('organizerCourtAlerts', value)} styles={styles} C={C} /></SettingRow>
      <SettingRow icon="person-add-outline" title="Check-in alerts" detail="Notify when players join your session" styles={styles} C={C}><Toggle label="Check-in alerts" value={Boolean(preferences.organizerCheckInAlerts)} onChange={(value) => setAlert('organizerCheckInAlerts', value)} styles={styles} C={C} /></SettingRow>
    </View>

    <Pressable onPress={() => navigation.navigate(session ? 'Monitor' : 'Sessions')} style={styles.primaryButton}><Text style={styles.primaryText}>{session ? 'Open live session' : 'Open session control'}</Text><Icon name="arrow-forward" size={18} color="#0E2321" /></Pressable>
  </ScrollView>

  <EditSharedAccount visible={editOpen} user={user} isDark={isDark} onClose={() => setEditOpen(false)} onSave={async (changes) => { await updateProfile(changes); setEditOpen(false); showToast('Shared identity updated.'); }} styles={styles} C={C} />
  <NotificationSheet visible={notificationsOpen} onClose={() => setNotificationsOpen(false)} items={notices} unreadCount={unreadCount} onRead={(id) => readNotification(id).catch((error) => showToast(error.message || 'Notification could not be marked as read.'))} onReadAll={() => readAllNotifications().catch((error) => showToast(error.message || 'Notifications could not be marked as read.'))} onDelete={removeNotification} onClearRead={clearNotifications} onFollowResponse={(item, accept) => respondFollowRequest(item.data?.requesterId, accept, item.id)} />
  {toast ? <View style={styles.toast}><Icon name="checkmark-circle" size={17} color={C.optic} /><Text style={styles.toastText}>{toast}</Text></View> : null}
  </SafeAreaView>;
}

const shadow = Platform.select({ ios: { shadowColor: '#0E2321', shadowOpacity: .08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 } });
const lightStyles = createMobileStyleSheet({
  safe: { flex: 1, backgroundColor: LIGHT_C.paper }, content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 40 }, flex: { flex: 1 },
  topbar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerLeading: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }, backButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface, alignItems: 'center', justifyContent: 'center' }, eyebrow: { color: LIGHT_C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, h1: { marginTop: 2, color: LIGHT_C.ink, fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -.7 }, h2: { marginTop: 2, color: LIGHT_C.ink, fontSize: 21, fontWeight: '800' }, iconButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface, alignItems: 'center', justifyContent: 'center' }, noticeDot: { position: 'absolute', right: 9, top: 8, width: 7, height: 7, borderRadius: 4, borderWidth: 1, borderColor: LIGHT_C.surface, backgroundColor: LIGHT_C.brick },
  kitchen: { height: 7, marginTop: 18, marginBottom: 22 }, solid: { height: 2, backgroundColor: LIGHT_C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: LIGHT_C.ink40 },
  identityCard: { padding: 16, borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: LIGHT_C.ink, ...shadow }, identityHead: { flexDirection: 'row', alignItems: 'center' }, identityCopy: { flex: 1, marginLeft: 13 }, nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, name: { maxWidth: 150, flexShrink: 1, color: LIGHT_C.surface, fontSize: 20, fontWeight: '900' }, identityMeta: { marginTop: 4, color: '#CBD7D2', fontSize: 9 }, sharedPill: { alignSelf: 'flex-start', minHeight: 23, marginTop: 7, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, backgroundColor: 'rgba(114,199,190,.14)' }, sharedPillText: { color: '#72C7BE', fontSize: 5.5, fontWeight: '900', letterSpacing: .45 }, tierBadge: { minHeight: 19, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: LIGHT_C.brick }, tierText: { color: '#0E2321', fontSize: 5.5, fontWeight: '900', letterSpacing: .6 }, editButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(114,199,190,.14)' }, identityNote: { marginTop: 13, color: '#CBD7D2', fontSize: 8, lineHeight: 13 },
  cardEyebrow: { color: LIGHT_C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .8 },
  sectionHead: { marginTop: 24, marginBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, livePill: { minHeight: 25, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 13, backgroundColor: LIGHT_C.brickWash }, liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: LIGHT_C.brick }, liveText: { color: LIGHT_C.brick, fontSize: 7, fontWeight: '900' }, statsCard: { paddingVertical: 16, flexDirection: 'row', borderRadius: 18, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, stat: { flex: 1, alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderColor: LIGHT_C.line }, statLast: { borderRightWidth: 0 }, statValue: { color: LIGHT_C.ink, fontSize: 22, fontWeight: '900' }, statLabel: { marginTop: 3, color: LIGHT_C.teal, fontSize: 5.5, fontWeight: '900', letterSpacing: .4 },
  sectionLabel: { marginTop: 24, marginBottom: 9, color: LIGHT_C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .9 }, settingsCard: { paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, settingRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10 }, rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: LIGHT_C.line }, settingIcon: { width: 39, height: 39, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: LIGHT_C.tealWash }, settingTitle: { color: LIGHT_C.ink, fontSize: 10.5, fontWeight: '900' }, settingDetail: { marginTop: 3, color: LIGHT_C.ink40, fontSize: 7.5, lineHeight: 11 }, pressed: { opacity: .72 },
  toggle: { width: 43, height: 25, padding: 3, borderRadius: 13, backgroundColor: '#C9D0CB' }, toggleOn: { backgroundColor: LIGHT_C.optic }, toggleKnob: { width: 19, height: 19, borderRadius: 10, backgroundColor: LIGHT_C.surface }, toggleKnobOn: { transform: [{ translateX: 18 }], backgroundColor: '#0E2321' },
  primaryButton: { minHeight: 52, marginTop: 20, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, backgroundColor: LIGHT_C.optic }, editorSaveButton: { justifyContent: 'center', gap: 8 }, editorSaveDisabled: { borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, primaryText: { color: '#0E2321', fontSize: 10, fontWeight: '900' }, disabled: { opacity: .55 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.55)' }, sheet: { padding: 20, paddingBottom: 30, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: LIGHT_C.paper }, sheetHandle: { width: 38, height: 4, alignSelf: 'center', marginBottom: 18, borderRadius: 2, backgroundColor: LIGHT_C.line }, sheetHead: { flexDirection: 'row', alignItems: 'center' }, sheetTitle: { marginTop: 2, color: LIGHT_C.ink, fontSize: 22, fontWeight: '900' }, sharedNote: { marginTop: 13, padding: 11, borderRadius: 12, color: LIGHT_C.ink70, backgroundColor: LIGHT_C.tealWash, fontSize: 8, lineHeight: 13 }, fieldLabel: { marginTop: 16, marginBottom: 6, color: LIGHT_C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, input: { minHeight: 49, paddingHorizontal: 13, borderWidth: 1, borderColor: LIGHT_C.line, borderRadius: 13, backgroundColor: LIGHT_C.surface, color: LIGHT_C.ink, fontSize: 11 }, errorText: { marginTop: 8, color: LIGHT_C.error, fontSize: 8 },
  toast: { position: 'absolute', right: 20, bottom: 20, left: 20, minHeight: 48, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, backgroundColor: '#0E2321', ...shadow }, toastText: { flex: 1, color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
});
const darkStyles = {
  ...createDarkStyleSheet(lightStyles),
  tierText: { ...lightStyles.tierText, color: '#0E2321' }
};
