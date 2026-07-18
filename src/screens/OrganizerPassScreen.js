import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import ScrollView from '../components/FocusResetScrollView';
import { useOrganizerPass } from '../context/OrganizerPassContext';
import { useAppMode } from '../context/AppModeContext';
import { getOrganizerPassPlan, ORGANIZER_PASS_PLANS } from '../services/organizerPass';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';

const LIGHT_C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983',
  line: '#DDE3DA', tealWash: '#E5F0ED', brickWash: '#F7EAE6',
};

const FEATURES = [
  ['infinite-outline', 'Unlimited sessions', 'Run recurring open play without session limits.'],
  ['git-branch-outline', 'Smart rotations', 'Manage queues, match assignments, and every active court.'],
  ['stats-chart-outline', 'Organizer history', 'Keep session, attendance, and match records together.'],
  ['people-outline', 'Staff-ready workspace', 'Prepared for additional organizers and court monitors.'],
];

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Icon({ name, size = 20, color }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export default function OrganizerPassScreen({ navigation }) {
  const { isDark } = useTheme();
  const C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  const styles = isDark ? darkStyles : lightStyles;
  const {
    entitlement, hasOrganizerAccess, isAdminAccess, busy, activate, cancel, restore,
    simulateExpiration, simulateReinstall,
  } = useOrganizerPass();
  const { mode, setMode } = useAppMode();
  const [selectedPlanId, setSelectedPlanId] = useState(entitlement.planId || ORGANIZER_PASS_PLANS[0].id);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const selectedPlan = useMemo(() => getOrganizerPassPlan(selectedPlanId), [selectedPlanId]);
  const activePlan = getOrganizerPassPlan(entitlement.planId);

  const runAction = async (action, successMessage) => {
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(successMessage);
    } catch (actionError) {
      setError(actionError.message || 'The demo action could not be completed.');
    }
  };

  const confirmActivation = async () => {
    await runAction(() => activate(selectedPlanId), `${selectedPlan.name} demo access activated.`);
    setCheckoutOpen(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Back" onPress={() => navigation.goBack()} style={styles.backButton}>
            <Icon name="arrow-back" color={C.ink} />
          </Pressable>
          <View style={styles.headerCopy}><Text style={styles.eyebrow}>ORGANIZER PASS</Text><Text style={styles.title}>Run every court.</Text></View>
          <View style={styles.demoPill}><View style={styles.demoDot} /><Text style={styles.demoPillText}>DEMO</Text></View>
        </View>

        <View style={styles.demoNotice}>
          <Icon name="flask-outline" size={19} color={C.teal} />
          <View style={styles.flex}><Text style={styles.demoNoticeTitle}>Payment sandbox</Text><Text style={styles.demoNoticeText}>No card, store account, or real money is used. Demo access is stored on your Peakle account and verified by the server.</Text></View>
        </View>

        {hasOrganizerAccess ? (
          <View style={styles.activeCard}>
            <View style={styles.activeHead}>
              <View style={styles.activeIcon}><Icon name="checkmark" size={24} color="#0E2321" /></View>
              <View style={styles.flex}><Text style={styles.activeEyebrow}>ACCESS ACTIVE</Text><Text style={styles.activeTitle}>{isAdminAccess ? 'Platform administrator' : `Organizer ${activePlan.tier.charAt(0).toUpperCase() + activePlan.tier.slice(1)} · ${activePlan.name}`}</Text></View>
            </View>
            <View style={styles.activeMetaRow}>
              <View><Text style={styles.activeMetaLabel}>VALID THROUGH</Text><Text style={styles.activeMetaValue}>{isAdminAccess ? 'No expiration' : formatDate(entitlement.currentPeriodEnd)}</Text></View>
              <View style={styles.activeMetaRight}><Text style={styles.activeMetaLabel}>RENEWAL</Text><Text style={styles.activeMetaValue}>{isAdminAccess ? 'Not required' : entitlement.autoRenews ? 'Automatic' : 'Canceled'}</Text></View>
            </View>
            <Pressable onPress={() => { if (mode === 'player') setMode('organizer'); else navigation.navigate('Sessions'); }} style={styles.primaryButton}><Text style={styles.primaryText}>{mode === 'player' ? 'Switch to Organizer mode' : 'Open session control'}</Text><Icon name="arrow-forward" color="#0E2321" /></Pressable>
          </View>
        ) : (
          <View style={styles.hero}>
            <View style={styles.heroIcon}><Icon name="key" size={27} color="#0E2321" /></View>
            <Text style={styles.heroEyebrow}>PEAKLE FOR HOSTS</Text>
            <Text style={styles.heroTitle}>One workspace from check-in to match point.</Text>
            <Text style={styles.heroBody}>Choose a demo plan to unlock the full organizer workflow. You can test cancellation, expiration, and purchase restoration afterward.</Text>
          </View>
        )}

        {!hasOrganizerAccess && (
          <>
            <View style={styles.sectionHead}><Text style={styles.sectionEyebrow}>CHOOSE YOUR PLAN</Text><Text style={styles.sectionTitle}>Simple, predictable pricing</Text></View>
            <View style={styles.planList}>
              {ORGANIZER_PASS_PLANS.map((plan) => {
                const selected = selectedPlanId === plan.id;
                return (
                  <Pressable key={plan.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => setSelectedPlanId(plan.id)} style={[styles.planCard, selected && styles.planCardSelected]}>
                    <View style={[styles.radio, selected && styles.radioSelected]}>{selected && <View style={styles.radioDot} />}</View>
                    <View style={styles.flex}><View style={styles.planNameRow}><Text style={styles.planName}>{plan.name}</Text>{plan.badge && <View style={styles.savePill}><Text style={styles.saveText}>{plan.badge}</Text></View>}</View><Text style={styles.planDetail}>{plan.id === 'organizer_monthly' ? 'Flexible month-to-month access' : 'Best value for regular organizers'}</Text></View>
                    <View style={styles.planPrice}><Text style={styles.price}>₱{plan.price.toLocaleString()}</Text><Text style={styles.pricePeriod}>/{plan.billingLabel}</Text></View>
                  </Pressable>
                );
              })}
            </View>
            <Pressable disabled={busy} onPress={() => setCheckoutOpen(true)} style={[styles.primaryButton, busy && styles.disabled]}><Text style={styles.primaryText}>Continue with {selectedPlan.name}</Text><Icon name="arrow-forward" color="#0E2321" /></Pressable>
            <Pressable disabled={busy} onPress={() => runAction(restore, 'Demo purchase restored.')} style={styles.restoreButton}><Icon name="refresh-outline" size={17} color={C.teal} /><Text style={styles.restoreText}>Restore demo purchase</Text></Pressable>
          </>
        )}

        <View style={styles.sectionHead}><Text style={styles.sectionEyebrow}>INCLUDED</Text><Text style={styles.sectionTitle}>Built for live operations</Text></View>
        <View style={styles.featureCard}>
          {FEATURES.map(([icon, title, detail], index) => <View key={title} style={[styles.featureRow, index > 0 && styles.rowBorder]}><View style={styles.featureIcon}><Icon name={icon} color={C.teal} /></View><View style={styles.flex}><Text style={styles.featureTitle}>{title}</Text><Text style={styles.featureDetail}>{detail}</Text></View><Icon name="checkmark-circle" size={18} color={C.teal} /></View>)}
        </View>

        {hasOrganizerAccess && !isAdminAccess && (
          <>
            <View style={styles.sectionHead}><Text style={styles.sectionEyebrow}>DEMO CONTROLS</Text><Text style={styles.sectionTitle}>Test the subscription lifecycle</Text></View>
            <View style={styles.controlCard}>
              {entitlement.autoRenews && <Pressable disabled={busy} onPress={() => runAction(cancel, 'Renewal canceled. Access remains available through the current period.')} style={styles.controlRow}><Icon name="close-circle-outline" color={C.brick} /><View style={styles.flex}><Text style={styles.controlTitle}>Cancel renewal</Text><Text style={styles.controlDetail}>Keep access until {formatDate(entitlement.currentPeriodEnd)}.</Text></View><Icon name="chevron-forward" color={C.ink40} /></Pressable>}
              <Pressable disabled={busy} onPress={() => runAction(simulateExpiration, 'Demo pass expired. Existing session data was preserved.')} style={[styles.controlRow, entitlement.autoRenews && styles.rowBorder]}><Icon name="time-outline" color={C.brick} /><View style={styles.flex}><Text style={styles.controlTitle}>Simulate expiration</Text><Text style={styles.controlDetail}>Immediately test the expired-access experience.</Text></View><Icon name="chevron-forward" color={C.ink40} /></Pressable>
              <Pressable disabled={busy} onPress={() => runAction(simulateReinstall, 'Local state cleared. Server-verified access was recovered automatically.')} style={[styles.controlRow, styles.rowBorder]}><Icon name="phone-portrait-outline" color={C.teal} /><View style={styles.flex}><Text style={styles.controlTitle}>Test account restore</Text><Text style={styles.controlDetail}>Reload access from the server as a fresh install would.</Text></View><Icon name="chevron-forward" color={C.ink40} /></Pressable>
            </View>
          </>
        )}

        {busy && <ActivityIndicator color={C.teal} style={styles.loader} />}
        {message ? <View style={styles.feedback}><Icon name="checkmark-circle" color={C.teal} /><Text style={styles.feedbackText}>{message}</Text></View> : null}
        {error ? <View style={[styles.feedback, styles.feedbackError]}><Icon name="alert-circle" color={C.brick} /><Text style={[styles.feedbackText, styles.errorText]}>{error}</Text></View> : null}
        <Text style={styles.legal}>DEMO ONLY · NO PAYMENT WILL BE COLLECTED · NOT A REAL SUBSCRIPTION</Text>
      </ScrollView>

      <Modal visible={checkoutOpen} transparent animationType="fade" onRequestClose={() => setCheckoutOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.checkoutIcon}><Icon name="flask" size={27} color="#0E2321" /></View>
            <Text style={styles.modalEyebrow}>SIMULATED CHECKOUT</Text>
            <Text style={styles.modalTitle}>Activate {selectedPlan.name}?</Text>
            <Text style={styles.modalPrice}>₱{selectedPlan.price.toLocaleString()} <Text style={styles.modalPeriod}>/{selectedPlan.billingLabel}</Text></Text>
            <View style={styles.zeroCharge}><Icon name="shield-checkmark-outline" color={C.teal} /><Text style={styles.zeroChargeText}>Amount charged today: ₱0.00</Text></View>
            <Text style={styles.modalBody}>This creates a server-owned demo entitlement so you can evaluate the complete Organizer Pass experience. No external payment service is contacted.</Text>
            <View style={styles.modalActions}>
              <Pressable disabled={busy} onPress={() => setCheckoutOpen(false)} style={styles.modalCancel}><Text style={styles.modalCancelText}>Not now</Text></Pressable>
              <Pressable disabled={busy} onPress={confirmActivation} style={[styles.modalConfirm, busy && styles.disabled]}>{busy ? <ActivityIndicator color="#0E2321" /> : <Text style={styles.modalConfirmText}>Activate demo</Text>}</Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const lightStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: LIGHT_C.paper }, content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48 }, flex: { flex: 1 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11 }, backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, headerCopy: { flex: 1 }, eyebrow: { color: LIGHT_C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .9 }, title: { marginTop: 2, color: LIGHT_C.ink, fontSize: 23, fontWeight: '900' }, demoPill: { minHeight: 29, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 15, backgroundColor: LIGHT_C.tealWash }, demoDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: LIGHT_C.optic }, demoPillText: { color: LIGHT_C.teal, fontSize: 7, fontWeight: '900' },
  demoNotice: { marginTop: 18, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 14, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: LIGHT_C.tealWash }, demoNoticeTitle: { color: LIGHT_C.ink, fontSize: 10, fontWeight: '900' }, demoNoticeText: { marginTop: 3, color: LIGHT_C.ink70, fontSize: 8, lineHeight: 12 },
  hero: { marginTop: 14, padding: 20, borderRadius: 23, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: LIGHT_C.ink }, heroIcon: { width: 51, height: 51, marginBottom: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: LIGHT_C.optic }, heroEyebrow: { color: '#9FB3AC', fontSize: 8, fontWeight: '900', letterSpacing: .9 }, heroTitle: { marginTop: 5, color: LIGHT_C.surface, fontSize: 24, lineHeight: 30, fontWeight: '900' }, heroBody: { marginTop: 9, color: '#CBD7D2', fontSize: 10, lineHeight: 16 },
  activeCard: { marginTop: 14, padding: 17, borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: LIGHT_C.ink }, activeHead: { flexDirection: 'row', alignItems: 'center', gap: 11 }, activeIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: LIGHT_C.optic }, activeEyebrow: { color: LIGHT_C.optic, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, activeTitle: { marginTop: 3, color: LIGHT_C.surface, fontSize: 15, fontWeight: '900' }, activeMetaRow: { marginTop: 17, paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderColor: 'rgba(255,255,255,.16)' }, activeMetaRight: { alignItems: 'flex-end' }, activeMetaLabel: { color: '#9FB3AC', fontSize: 6, fontWeight: '900', letterSpacing: .6 }, activeMetaValue: { marginTop: 3, color: LIGHT_C.surface, fontSize: 10, fontWeight: '900' },
  sectionHead: { marginTop: 25, marginBottom: 10 }, sectionEyebrow: { color: LIGHT_C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .9 }, sectionTitle: { marginTop: 3, color: LIGHT_C.ink, fontSize: 19, fontWeight: '900' }, planList: { gap: 9 }, planCard: { minHeight: 78, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, planCardSelected: { borderWidth: 2, borderColor: LIGHT_C.teal }, radio: { width: 21, height: 21, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: LIGHT_C.ink40 }, radioSelected: { borderColor: LIGHT_C.teal }, radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: LIGHT_C.teal }, planNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, planName: { color: LIGHT_C.ink, fontSize: 12, fontWeight: '900' }, planDetail: { marginTop: 4, color: LIGHT_C.ink40, fontSize: 7.5 }, savePill: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7, backgroundColor: LIGHT_C.optic }, saveText: { color: LIGHT_C.ink, fontSize: 5.5, fontWeight: '900' }, planPrice: { alignItems: 'flex-end' }, price: { color: LIGHT_C.ink, fontSize: 17, fontWeight: '900' }, pricePeriod: { marginTop: 2, color: LIGHT_C.ink40, fontSize: 7 },
  primaryButton: { minHeight: 54, marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: LIGHT_C.optic }, primaryText: { color: LIGHT_C.ink, fontSize: 10, fontWeight: '900' }, disabled: { opacity: .45 }, restoreButton: { minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, restoreText: { color: LIGHT_C.teal, fontSize: 9, fontWeight: '900' },
  featureCard: { paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, featureRow: { minHeight: 75, flexDirection: 'row', alignItems: 'center', gap: 10 }, featureIcon: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: LIGHT_C.tealWash }, featureTitle: { color: LIGHT_C.ink, fontSize: 10, fontWeight: '900' }, featureDetail: { marginTop: 3, color: LIGHT_C.ink40, fontSize: 7.5, lineHeight: 11 }, rowBorder: { borderTopWidth: 1, borderColor: LIGHT_C.line },
  controlCard: { paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, controlRow: { minHeight: 73, flexDirection: 'row', alignItems: 'center', gap: 10 }, controlTitle: { color: LIGHT_C.ink, fontSize: 10, fontWeight: '900' }, controlDetail: { marginTop: 3, color: LIGHT_C.ink40, fontSize: 7.5, lineHeight: 11 }, loader: { marginTop: 15 }, feedback: { marginTop: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: LIGHT_C.tealWash }, feedbackError: { backgroundColor: LIGHT_C.brickWash }, feedbackText: { flex: 1, color: LIGHT_C.teal, fontSize: 8.5, fontWeight: '800' }, errorText: { color: LIGHT_C.brick }, legal: { marginTop: 24, color: LIGHT_C.ink40, textAlign: 'center', fontSize: 6.5, fontWeight: '900', letterSpacing: .55 },
  modalBackdrop: { flex: 1, padding: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,35,33,.65)' }, modalCard: { width: '100%', maxWidth: 380, padding: 20, borderRadius: 23, backgroundColor: LIGHT_C.paper }, checkoutIcon: { width: 54, height: 54, marginBottom: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: LIGHT_C.optic }, modalEyebrow: { color: LIGHT_C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .9 }, modalTitle: { marginTop: 4, color: LIGHT_C.ink, fontSize: 22, fontWeight: '900' }, modalPrice: { marginTop: 14, color: LIGHT_C.ink, fontSize: 28, fontWeight: '900' }, modalPeriod: { color: LIGHT_C.ink40, fontSize: 10, fontWeight: '700' }, zeroCharge: { marginTop: 13, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: LIGHT_C.tealWash }, zeroChargeText: { color: LIGHT_C.teal, fontSize: 9, fontWeight: '900' }, modalBody: { marginTop: 12, color: LIGHT_C.ink70, fontSize: 9, lineHeight: 14 }, modalActions: { marginTop: 17, flexDirection: 'row', gap: 8 }, modalCancel: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, modalCancelText: { color: LIGHT_C.ink40, fontSize: 9, fontWeight: '900' }, modalConfirm: { minHeight: 48, flex: 1.35, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: LIGHT_C.optic }, modalConfirmText: { color: LIGHT_C.ink, fontSize: 9, fontWeight: '900' },
});

const darkStyles = createDarkStyleSheet(lightStyles);
