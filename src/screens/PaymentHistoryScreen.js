import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { listMyPaymentHistory } from '../services/payments';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import PeakleLoadingOverlay from '../components/PeakleLoadingOverlay';

const LIGHT = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED', brickWash: '#F7EAE6', panel: '#0E2321' };
const DARK = { ...DARK_CONTENT_COLORS, surface: '#17302D', tealWash: '#203B37', brickWash: '#402C29', panel: '#102825' };
const BALL_IMAGE = require('../../public/images/ball.png');
const PAGE_SIZE = 20;

const PAYMENT_METHOD_LABELS = {
  gcash: 'GCash',
  paymaya: 'Maya',
  card: 'Credit / debit card',
  dob: 'Online banking',
  pay_at_venue: 'Pay at venue',
};

const PAYMENT_STATUS = {
  pay_at_venue: { label: 'Pay at venue', tone: 'neutral' },
  awaiting_payment: { label: 'Pending', tone: 'neutral' },
  paid: { label: 'Paid', tone: 'good' },
  refunded: { label: 'Refunded', tone: 'warn' },
  partially_refunded: { label: 'Partially refunded', tone: 'warn' },
  failed: { label: 'Failed', tone: 'bad' },
};

function Icon({ name, size = 20, color }) { return <Ionicons name={name} size={size} color={color} />; }

function paymentMethodLabel(method) {
  if (!method) return 'Not specified';
  return PAYMENT_METHOD_LABELS[method] || method;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
}

function PaymentRow({ payment, C }) {
  const status = PAYMENT_STATUS[payment.payment_status] || { label: payment.payment_status || 'Unknown', tone: 'neutral' };
  const toneColor = status.tone === 'good' ? C.teal : status.tone === 'bad' ? C.brick : status.tone === 'warn' ? C.brick : C.ink40;
  const toneWash = status.tone === 'good' ? C.tealWash : status.tone === 'bad' ? C.brickWash : status.tone === 'warn' ? C.brickWash : C.paper;
  return (
    <View style={[s.row, { backgroundColor: C.surface, borderColor: C.line }]}>
      <View style={[s.rowIcon, { backgroundColor: C.paper }]}>
        <Icon name="receipt-outline" size={17} color={C.teal} />
      </View>
      <View style={s.flex}>
        <Text numberOfLines={1} style={[s.rowVenue, { color: C.ink }]}>{payment.display_name || payment.venues?.name || (payment.source_type === 'membership' ? 'Venue membership' : 'Court booking')}</Text>
        <Text style={[s.rowMeta, { color: C.ink40 }]}>{formatDate(payment.created_at)} · {paymentMethodLabel(payment.payment_method)}</Text>
      </View>
      <View style={s.rowRight}>
        <Text style={[s.rowAmount, { color: C.ink }]}>₱{Number(payment.amount || 0).toLocaleString('en-PH')}</Text>
        <View style={[s.statusPill, { backgroundColor: toneWash }]}>
          <Text style={[s.statusPillText, { color: toneColor }]}>{status.label}</Text>
        </View>
      </View>
    </View>
  );
}

export default function PaymentHistoryScreen({ navigation }) {
  const { isDark } = useTheme();
  const C = isDark ? DARK : LIGHT;

  const [payments, setPayments] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    setLoading(true);
    try {
      const result = await listMyPaymentHistory({ page: 0, pageSize: PAGE_SIZE });
      setPayments(result.payments);
      setHasMore(result.hasMore);
      setPage(0);
    } catch (e) {
      setLoadError(e.message || 'Payment history could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const result = await listMyPaymentHistory({ page: nextPage, pageSize: PAGE_SIZE });
      setPayments((current) => [...current, ...result.payments]);
      setHasMore(result.hasMore);
      setPage(nextPage);
    } catch (e) {
      setLoadError(e.message || 'Payment history could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />

      <View style={[s.header, { borderBottomColor: C.line }]}>
        <Pressable accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={[s.back, { backgroundColor: C.surface, borderColor: C.line }]}>
          <Icon name="arrow-back" color={C.ink} />
        </Pressable>
        <View style={s.flex}>
          <Text style={[s.eyebrow, { color: C.ink40 }]}>YOUR ACCOUNT</Text>
          <Text style={[s.h1, { color: C.ink }]}>Payment history</Text>
        </View>
        <View style={[s.ball, { backgroundColor: C.optic }]}>
          <Image source={BALL_IMAGE} style={s.ballImage} resizeMode="contain" />
        </View>
      </View>

      <FlatList
        data={payments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.teal} />}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        ItemSeparatorComponent={() => <View style={s.separator} />}
        renderItem={({ item }) => <PaymentRow payment={item} C={C} />}
        ListHeaderComponent={loadError ? (
          <View style={[s.errorBanner, { backgroundColor: C.brickWash }]}>
            <Icon name="alert-circle" color={C.brick} />
            <Text style={[s.errorText, { color: C.brick }]}>{loadError}</Text>
          </View>
        ) : null}
        ListEmptyComponent={!loading ? (
          <View style={s.empty}>
            <Icon name="receipt-outline" size={28} color={C.ink40} />
            <Text style={[s.emptyText, { color: C.ink40 }]}>No payments yet. Your booking and membership receipts will show up here.</Text>
          </View>
        ) : null}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={s.loader} size="small" color={C.teal} /> : null}
      />
      <PeakleLoadingOverlay visible={loading && payments.length === 0} status="LOADING PAYMENT HISTORY" />
    </SafeAreaView>
  );
}

const s = createMobileStyleSheet({
  safe: { flex: 1 },
  header: { paddingHorizontal: 19, paddingTop: 12, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1 },
  ball: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  ballImage: { width: 27, height: 27 },
  eyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: .9 },
  h1: { marginTop: 2, fontSize: 24, fontWeight: '900' },
  flex: { flex: 1 },
  content: { paddingHorizontal: 19, paddingTop: 18, paddingBottom: 48, flexGrow: 1 },
  separator: { height: 9 },
  loader: { marginTop: 16 },
  errorBanner: { marginBottom: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12 },
  errorText: { flex: 1, fontSize: 8, lineHeight: 12, fontWeight: '800' },
  row: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 15 },
  rowIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  rowVenue: { fontSize: 11, fontWeight: '900' },
  rowMeta: { marginTop: 3, fontSize: 8, lineHeight: 12 },
  rowRight: { alignItems: 'flex-end', gap: 5 },
  rowAmount: { fontSize: 12, fontWeight: '900' },
  statusPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  statusPillText: { fontSize: 6, fontWeight: '900', letterSpacing: .4 },
  empty: { marginTop: 60, alignItems: 'center', gap: 10, paddingHorizontal: 30 },
  emptyText: { textAlign: 'center', fontSize: 9, lineHeight: 14, fontWeight: '700' },
});
