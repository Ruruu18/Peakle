import Modal from '../components/ResponsiveModal';
import { webDialog } from '../utils/webLayout';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import { startSupportConversation } from '../services/supportChat';
import { COURT_BOOKING_ENABLED } from '../config/features';
import { APP_VERSION_LABEL } from '../config/appInfo';

const LIGHT = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983',
  line: '#DDE3DA', tealWash: '#E5F0ED', brickWash: '#F7EAE6', panel: '#0E2321',
};
const DARK = {
  ...DARK_CONTENT_COLORS,
  surface: '#17302D', tealWash: '#203B37', brickWash: '#402C29', panel: '#102825',
};
const BALL_IMAGE = require('../../public/images/ball.png');
const SUPPORT_EMAIL = (process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'support@peakle.app').trim();
const APP_VERSION = APP_VERSION_LABEL.replace(/^Peakle /, '');

const BOOKING_FAQS = [
  {
    id: 'booking',
    category: 'Bookings',
    question: 'Where can I see my bookings and payment status?',
    answer: 'Open Explore and switch to My Bookings. For a full payment and refund record, use Payment history below.',
    actionLabel: 'Open payment history',
    route: 'PaymentHistory',
  },
  {
    id: 'refund',
    category: 'Bookings',
    question: 'How do cancellations and refunds work?',
    answer: 'Open the booking to see the venue’s cancellation policy before cancelling. Eligible refunds are returned through the payment flow and appear in Payment history.',
    actionLabel: 'View payment history',
    route: 'PaymentHistory',
  },
];

const SCHEDULE_FAQS = [
  {
    id: 'schedule-game',
    category: 'Schedule',
    question: 'How do I schedule a game with friends?',
    answer: 'Open Schedule and tap New game. Pick a date and time, choose any court (or add your own), then invite players or open it to anyone. Invited players get a notification to accept.',
    actionLabel: 'Open Schedule',
    route: 'Schedule',
  },
  {
    id: 'any-court',
    category: 'Matches',
    question: 'Can I score a match at any court?',
    answer: 'Yes. In Play, choose a recent court, a court listed on Peakle, or add the venue you’re at. The court is saved with your match history.',
  },
];

const FAQS = [
  ...(COURT_BOOKING_ENABLED ? BOOKING_FAQS : SCHEDULE_FAQS),
  {
    id: 'score',
    category: 'Matches',
    question: 'Where can I review a completed match?',
    answer: 'Go to Profile, choose Matches, then tap a match to open its box score and recorded rally history.',
  },
  {
    id: 'notifications',
    category: 'Notifications',
    question: 'Why am I not receiving notifications?',
    answer: 'Check that Peakle notifications are allowed in your phone settings, then use the notification test to verify this device.',
    actionLabel: 'Test notifications',
    route: 'NotificationTest',
  },
  {
    id: 'privacy',
    category: 'Account',
    question: 'How do I control who can find me?',
    answer: 'Privacy & matching lets you control competitive-profile visibility, availability, and whether player matching is enabled.',
    actionLabel: 'Open privacy controls',
    route: 'Privacy',
  },
  {
    id: 'profile',
    category: 'Account',
    question: 'How do I update my name, photo, or home area?',
    answer: 'Return to Profile, open Settings, then choose Account details. Your changes are saved to your Peakle account.',
  },
  {
    id: 'safety',
    category: 'Safety',
    question: 'How do I report a message or player?',
    answer: 'Use the report option on the relevant message or conversation so the safety team receives the correct context. You can also contact support below for account-level concerns.',
  },
];

const SUPPORT_CATEGORIES = ['Booking or payment', 'Account access', 'Match or score', 'Safety concern', 'Bug or feedback'];

function Icon({ name, size = 20, color }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function FaqRow({ item, expanded, onToggle, onAction, C }) {
  return (
    <View style={[s.faqRow, { borderColor: C.line }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={s.faqTrigger}
      >
        <View style={s.flex}>
          <Text style={[s.faqCategory, { color: C.teal }]}>{item.category.toUpperCase()}</Text>
          <Text style={[s.faqQuestion, { color: C.ink }]}>{item.question}</Text>
        </View>
        <View style={[s.faqChevron, { backgroundColor: C.paper }]}>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={C.ink40} />
        </View>
      </Pressable>
      {expanded ? (
        <View style={[s.faqAnswerWrap, { borderTopColor: C.line }]}>
          <Text style={[s.faqAnswer, { color: C.ink70 }]}>{item.answer}</Text>
          {item.route ? (
            <Pressable accessibilityRole="button" onPress={onAction} style={[s.inlineAction, { backgroundColor: C.tealWash }]}>
              <Text style={[s.inlineActionText, { color: C.teal }]}>{item.actionLabel}</Text>
              <Icon name="arrow-forward" size={15} color={C.teal} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ContactModal({ visible, onClose, user, C, onStarted }) {
  const [category, setCategory] = useState(SUPPORT_CATEGORIES[0]);
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);

  const close = () => {
    if (opening) return;
    setError('');
    onClose();
  };

  const startChat = async () => {
    if (details.trim().length < 10) {
      setError('Add a little more detail so the support team can help.');
      return;
    }
    setOpening(true);
    setError('');
    try {
      const { conversationId } = await startSupportConversation(details, category);
      setDetails('');
      onClose();
      onStarted(conversationId);
    } catch (err) {
      setError(err.message || 'Could not start a conversation. Please try again.');
    } finally {
      setOpening(false);
    }
  };

  const emailFallback = () => {
    const subject = `Peakle support · ${category}`;
    const body = [
      'Hi Peakle Support,',
      '',
      details.trim(),
      '',
      '---',
      `Category: ${category}`,
      `Account email: ${user?.email || 'Not available'}`,
      `App: Peakle ${APP_VERSION}`,
      `Device: ${Platform.OS} ${String(Platform.Version)}`,
    ].join('\n');
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(url).catch(() => {
      setError(`No email app could be opened. Email us directly at ${SUPPORT_EMAIL}.`);
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.modalKeyboard}>
        <View {...webDialog('backdrop')} style={s.backdrop}>
          <Pressable accessibilityLabel="Close contact support" onPress={close} style={s.backdropDismiss} />
          <View {...webDialog('surface')} style={[s.sheet, { backgroundColor: C.paper }]}>
            <View {...webDialog('handle')} style={[s.handle, { backgroundColor: C.line }]} />
            <View style={s.sheetHeader}>
              <View style={s.flex}>
                <Text style={[s.eyebrow, { color: C.ink40 }]}>CONTACT SUPPORT</Text>
                <Text style={[s.sheetTitle, { color: C.ink }]}>How can we help?</Text>
              </View>
              <Pressable accessibilityLabel="Close" onPress={close} style={[s.close, { backgroundColor: C.surface, borderColor: C.line }]}>
                <Icon name="close" color={C.ink} />
              </Pressable>
            </View>

            <Text style={[s.fieldLabel, { color: C.ink40 }]}>TOPIC</Text>
            <View style={s.categoryWrap}>
              {SUPPORT_CATEGORIES.map((item) => {
                const selected = item === category;
                return (
                  <Pressable
                    key={item}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setCategory(item)}
                    style={[s.categoryChip, { backgroundColor: selected ? C.optic : C.surface, borderColor: selected ? C.ink : C.line }]}
                  >
                    <Text style={[s.categoryText, { color: selected ? '#0E2321' : C.ink70 }]}>{item}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[s.fieldLabel, { color: C.ink40 }]}>WHAT HAPPENED?</Text>
            <TextInput
              accessibilityLabel="Describe your support request"
              value={details}
              onChangeText={(value) => { setDetails(value); setError(''); }}
              multiline
              maxLength={1500}
              placeholder="Tell us what you expected, what happened, and any booking or match details that may help."
              placeholderTextColor={C.ink40}
              style={[s.detailsInput, { color: C.ink, backgroundColor: C.surface, borderColor: error ? C.brick : C.line }]}
            />
            <Text style={[s.characterCount, { color: C.ink40 }]}>{details.length}/1500</Text>
            {error ? <Text selectable style={[s.formError, { color: C.brick }]}>{error}</Text> : null}

            <Pressable
              accessibilityRole="button"
              disabled={opening}
              onPress={startChat}
              style={[s.sendButton, { backgroundColor: C.optic }, opening && s.disabled]}
            >
              {opening ? <ActivityIndicator color="#0E2321" /> : <Icon name="chatbubble-ellipses-outline" color="#0E2321" />}
              <Text style={s.sendButtonText}>{opening ? 'Starting chat…' : 'Start chat with support'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={emailFallback} style={s.emailFallback}>
              <Text style={[s.emailNote, { color: C.ink40 }]}>Prefer email? Contact {SUPPORT_EMAIL} instead.</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function HelpSupportScreen({ navigation }) {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const C = isDark ? DARK : LIGHT;
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [contactOpen, setContactOpen] = useState(false);

  const faqs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return FAQS;
    return FAQS.filter((item) => `${item.category} ${item.question} ${item.answer}`.toLowerCase().includes(normalized));
  }, [query]);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <View style={[s.header, { borderBottomColor: C.line }]}>
        <Pressable accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={[s.back, { backgroundColor: C.surface, borderColor: C.line }]}>
          <Icon name="arrow-back" color={C.ink} />
        </Pressable>
        <View style={s.flex}>
          <Text style={[s.eyebrow, { color: C.ink40 }]}>PEAKLE SUPPORT</Text>
          <Text style={[s.h1, { color: C.ink }]}>Help & support</Text>
        </View>
        <View style={[s.ball, { backgroundColor: C.optic }]}>
          <Image source={BALL_IMAGE} style={s.ballImage} resizeMode="contain" />
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={[s.hero, { backgroundColor: C.panel }]}>
          <View style={[s.heroIcon, { backgroundColor: C.optic }]}>
            <Icon name="help-buoy-outline" size={25} color="#0E2321" />
          </View>
          <Text style={s.heroTitle}>What can we help you with?</Text>
          <Text style={s.heroBody}>Find a quick answer or send the support team the details of your issue.</Text>
          <View style={[s.search, { backgroundColor: isDark ? C.surface : '#FFFFFF' }]}>
            <Icon name="search-outline" size={19} color={C.ink40} />
            <TextInput
              accessibilityLabel="Search help articles"
              value={query}
              onChangeText={setQuery}
              placeholder="Search bookings, matches, account…"
              placeholderTextColor={C.ink40}
              returnKeyType="search"
              style={[s.searchInput, { color: C.ink }]}
            />
            {query ? <Pressable accessibilityLabel="Clear search" onPress={() => setQuery('')} hitSlop={8}><Icon name="close-circle" size={18} color={C.ink40} /></Pressable> : null}
          </View>
        </View>

        <Text style={[s.sectionLabel, { color: C.ink40 }]}>QUICK LINKS</Text>
        <View style={s.quickGrid}>
          {COURT_BOOKING_ENABLED ? <Pressable onPress={() => navigation.navigate('PaymentHistory')} style={[s.quickCard, { backgroundColor: C.surface, borderColor: C.line }]}>
            <View style={[s.quickIcon, { backgroundColor: C.tealWash }]}><Icon name="receipt-outline" color={C.teal} /></View>
            <Text style={[s.quickTitle, { color: C.ink }]}>Payments</Text>
            <Text style={[s.quickMeta, { color: C.ink40 }]}>Receipts & refunds</Text>
          </Pressable> : <Pressable onPress={() => navigation.navigate('Schedule')} style={[s.quickCard, { backgroundColor: C.surface, borderColor: C.line }]}>
            <View style={[s.quickIcon, { backgroundColor: C.tealWash }]}><Icon name="calendar-outline" color={C.teal} /></View>
            <Text style={[s.quickTitle, { color: C.ink }]}>Schedule</Text>
            <Text style={[s.quickMeta, { color: C.ink40 }]}>Games & events</Text>
          </Pressable>}
          <Pressable onPress={() => navigation.navigate('NotificationTest')} style={[s.quickCard, { backgroundColor: C.surface, borderColor: C.line }]}>
            <View style={[s.quickIcon, { backgroundColor: C.tealWash }]}><Icon name="notifications-outline" color={C.teal} /></View>
            <Text style={[s.quickTitle, { color: C.ink }]}>Notifications</Text>
            <Text style={[s.quickMeta, { color: C.ink40 }]}>Check this device</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Privacy')} style={[s.quickCard, { backgroundColor: C.surface, borderColor: C.line }]}>
            <View style={[s.quickIcon, { backgroundColor: C.tealWash }]}><Icon name="shield-checkmark-outline" color={C.teal} /></View>
            <Text style={[s.quickTitle, { color: C.ink }]}>Privacy</Text>
            <Text style={[s.quickMeta, { color: C.ink40 }]}>Visibility & matching</Text>
          </Pressable>
        </View>

        <Text style={[s.sectionLabel, { color: C.ink40 }]}>FREQUENTLY ASKED QUESTIONS</Text>
        <View style={[s.faqCard, { backgroundColor: C.surface, borderColor: C.line }]}>
          {faqs.map((item) => (
            <FaqRow
              key={item.id}
              item={item}
              C={C}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId((current) => current === item.id ? null : item.id)}
              onAction={() => navigation.navigate(item.route)}
            />
          ))}
          {!faqs.length ? (
            <View style={s.noResults}>
              <Icon name="search-outline" size={26} color={C.ink40} />
              <Text style={[s.noResultsTitle, { color: C.ink }]}>No matching answer</Text>
              <Text style={[s.noResultsBody, { color: C.ink40 }]}>Try another search or contact the support team below.</Text>
            </View>
          ) : null}
        </View>

        <View style={[s.contactCard, { backgroundColor: C.panel }]}>
          <View style={[s.contactIcon, { backgroundColor: C.optic }]}><Icon name="chatbubble-ellipses-outline" color="#0E2321" /></View>
          <View style={s.flex}>
            <Text style={s.contactEyebrow}>STILL NEED HELP?</Text>
            <Text style={s.contactTitle}>Chat with Peakle support</Text>
            <Text style={s.contactBody}>Tell us what happened and get an instant answer, or connect with a teammate.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Contact Peakle support" onPress={() => setContactOpen(true)} style={[s.contactButton, { backgroundColor: C.optic }]}>
            <Icon name="arrow-forward" color="#0E2321" />
          </Pressable>
        </View>

        <View style={[s.safetyNote, { backgroundColor: C.brickWash }]}>
          <Icon name="warning-outline" color={C.brick} />
          <Text style={[s.safetyText, { color: C.ink70 }]}>If someone may be in immediate danger, contact local emergency services. Peakle support is not an emergency service.</Text>
        </View>
        <Text selectable style={[s.footer, { color: C.ink40 }]}>Peakle {APP_VERSION} · {SUPPORT_EMAIL}</Text>
      </ScrollView>

      <ContactModal
        visible={contactOpen}
        onClose={() => setContactOpen(false)}
        user={user}
        C={C}
        onStarted={(conversationId) => navigation.navigate('SupportChat', { conversationId })}
      />
    </SafeAreaView>
  );
}

const s = createMobileStyleSheet({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: { paddingHorizontal: 19, paddingTop: 12, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1 },
  ball: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  ballImage: { width: 27, height: 27 },
  eyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: .9 },
  h1: { marginTop: 2, fontSize: 24, fontWeight: '900' },
  content: { paddingHorizontal: 19, paddingTop: 18, paddingBottom: 50 },
  hero: { padding: 18, borderRadius: 22, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  heroIcon: { width: 47, height: 47, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  heroTitle: { marginTop: 16, color: '#FFFFFF', fontSize: 22, lineHeight: 28, fontWeight: '900' },
  heroBody: { marginTop: 5, color: 'rgba(255,255,255,.67)', fontSize: 9, lineHeight: 14 },
  search: { minHeight: 50, marginTop: 17, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14 },
  searchInput: { minWidth: 0, flex: 1, height: 50, paddingVertical: 0, fontSize: 11 },
  sectionLabel: { marginTop: 22, marginBottom: 9, fontSize: 8, fontWeight: '900', letterSpacing: .8 },
  quickGrid: { flexDirection: 'row', gap: 8 },
  quickCard: { minWidth: 0, flex: 1, minHeight: 113, padding: 10, borderWidth: 1, borderRadius: 15 },
  quickIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  quickTitle: { marginTop: 10, fontSize: 9, fontWeight: '900' },
  quickMeta: { marginTop: 3, fontSize: 7, lineHeight: 11 },
  faqCard: { overflow: 'hidden', borderWidth: 1, borderRadius: 17 },
  faqRow: { marginHorizontal: 13, borderBottomWidth: 1 },
  faqTrigger: { minHeight: 74, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  faqCategory: { marginBottom: 3, fontSize: 6, fontWeight: '900', letterSpacing: .6 },
  faqQuestion: { fontSize: 10, lineHeight: 15, fontWeight: '800' },
  faqChevron: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  faqAnswerWrap: { paddingTop: 11, paddingBottom: 14, borderTopWidth: 1 },
  faqAnswer: { fontSize: 9, lineHeight: 15 },
  inlineAction: { minHeight: 38, marginTop: 11, paddingHorizontal: 11, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11 },
  inlineActionText: { fontSize: 8, fontWeight: '900' },
  noResults: { minHeight: 180, padding: 24, alignItems: 'center', justifyContent: 'center' },
  noResultsTitle: { marginTop: 9, fontSize: 12, fontWeight: '900' },
  noResultsBody: { marginTop: 4, textAlign: 'center', fontSize: 8, lineHeight: 12 },
  contactCard: { marginTop: 21, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 19 },
  contactIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  contactEyebrow: { color: 'rgba(255,255,255,.52)', fontSize: 6, fontWeight: '900', letterSpacing: .7 },
  contactTitle: { marginTop: 2, color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  contactBody: { marginTop: 3, color: 'rgba(255,255,255,.62)', fontSize: 7, lineHeight: 11 },
  contactButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  safetyNote: { marginTop: 12, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 13 },
  safetyText: { flex: 1, fontSize: 8, lineHeight: 13 },
  footer: { marginTop: 18, textAlign: 'center', fontSize: 7, fontWeight: '700' },
  modalKeyboard: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.55)' },
  backdropDismiss: { ...StyleSheet.absoluteFillObject },
  sheet: { maxHeight: '94%', paddingHorizontal: 20, paddingTop: 9, paddingBottom: 28, borderTopLeftRadius: 25, borderTopRightRadius: 25 },
  handle: { width: 38, height: 4, marginBottom: 15, alignSelf: 'center', borderRadius: 2 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetTitle: { marginTop: 2, fontSize: 24, fontWeight: '900' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1 },
  fieldLabel: { marginTop: 18, marginBottom: 8, fontSize: 8, fontWeight: '900', letterSpacing: .8 },
  categoryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  categoryChip: { minHeight: 37, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 12 },
  categoryText: { fontSize: 8, fontWeight: '800' },
  detailsInput: { minHeight: 130, padding: 13, borderWidth: 1, borderRadius: 14, fontSize: 10, lineHeight: 16, textAlignVertical: 'top' },
  characterCount: { marginTop: 5, textAlign: 'right', fontSize: 7 },
  formError: { marginTop: 7, fontSize: 8, lineHeight: 12, fontWeight: '800' },
  sendButton: { minHeight: 52, marginTop: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14 },
  sendButtonText: { color: '#0E2321', fontSize: 10, fontWeight: '900' },
  emailFallback: { marginTop: 4, alignSelf: 'center' },
  emailNote: { marginTop: 8, textAlign: 'center', fontSize: 7, lineHeight: 11 },
  disabled: { opacity: .6 },
});
