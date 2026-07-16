import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import {
  deleteCourtBlackout, deleteVenuePricingRule, listVenueBookingRules,
  saveCourtBlackout, saveVenuePricingRule,
} from '../services/database';

const C = { ink: '#0E2321', surface: '#FFFFFF', paper: '#F3F5EF', teal: '#1C6B66', optic: '#D6E94A', brick: '#B6472E', line: '#DDE3DA', muted: '#7C8983' };
const Icon = ({ name, size = 18, color = C.ink }) => <Ionicons name={name} size={size} color={color} />;
const tomorrow = () => { const date = new Date(Date.now() + 86400000); return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); };
const localIso = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();

function Choice({ values, value, onChange }) {
  return <View style={styles.choices}>{values.map((item) => <Pressable key={item.value} onPress={() => onChange(item.value)} style={[styles.choice, value === item.value && styles.choiceActive]}><Text style={[styles.choiceText, value === item.value && styles.choiceTextActive]}>{item.label}</Text></Pressable>)}</View>;
}

function PricingForm({ venue, visible, onClose, onSaved }) {
  const [name, setName] = useState('Peak hours');
  const [ruleType, setRuleType] = useState('peak');
  const [adjustmentType, setAdjustmentType] = useState('fixed_hourly');
  const [value, setValue] = useState('700');
  const [startsAt, setStartsAt] = useState('17:00');
  const [endsAt, setEndsAt] = useState('21:00');
  const [courtId, setCourtId] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (name.trim().length < 2 || !Number.isFinite(Number(value)) || (adjustmentType !== 'percentage' && Number(value) < 0)) { Alert.alert('Check pricing rule', 'Enter a name and valid pricing value. Percentage discounts use a negative number.'); return; }
    setSaving(true);
    try {
      await saveVenuePricingRule({ venueId: venue.id, courtId, name, ruleType, adjustmentType, adjustmentValue: value, daysOfWeek: [1, 2, 3, 4, 5, 6, 0], startsAtLocal: startsAt, endsAtLocal: endsAt, promoCode: ruleType === 'promotion' ? promoCode : '', priority: ruleType === 'holiday' ? 30 : ruleType === 'promotion' ? 40 : 10 });
      onSaved();
    } catch (error) { Alert.alert('Rule not saved', error.message || 'Please try again.'); }
    finally { setSaving(false); }
  };
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.backdrop}><View style={styles.sheet}><View style={styles.sheetHead}><View><Text style={styles.eyebrow}>ADVANCED PRICING</Text><Text style={styles.sheetTitle}>Add pricing rule</Text></View><Pressable onPress={onClose} style={styles.close}><Icon name="close" /></Pressable></View><ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
    <Text style={styles.label}>RULE NAME</Text><TextInput value={name} onChangeText={setName} style={styles.input} />
    <Text style={styles.label}>TYPE</Text><Choice value={ruleType} onChange={setRuleType} values={[{ value: 'peak', label: 'Peak' }, { value: 'off_peak', label: 'Off-peak' }, { value: 'holiday', label: 'Holiday' }, { value: 'membership', label: 'Member' }, { value: 'promotion', label: 'Promo' }]} />
    <Text style={styles.label}>APPLIES TO</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}><Pressable onPress={() => setCourtId('')} style={[styles.chip, !courtId && styles.chipActive]}><Text style={[styles.chipText, !courtId && styles.chipTextActive]}>All courts</Text></Pressable>{venue.courts.map((court) => <Pressable key={court.id} onPress={() => setCourtId(court.id)} style={[styles.chip, courtId === court.id && styles.chipActive]}><Text style={[styles.chipText, courtId === court.id && styles.chipTextActive]}>{court.name}</Text></Pressable>)}</ScrollView>
    <Text style={styles.label}>PRICE METHOD</Text><Choice value={adjustmentType} onChange={setAdjustmentType} values={[{ value: 'fixed_hourly', label: 'Hourly price' }, { value: 'percentage', label: '% change' }, { value: 'flat_discount', label: 'Discount' }]} />
    <Text style={styles.label}>{adjustmentType === 'percentage' ? 'PERCENT' : 'AMOUNT (PHP)'}</Text><TextInput value={value} onChangeText={setValue} keyboardType="decimal-pad" style={styles.input} />
    <View style={styles.twoCols}><View style={styles.col}><Text style={styles.label}>START</Text><TextInput value={startsAt} onChangeText={setStartsAt} style={styles.input} /></View><View style={styles.col}><Text style={styles.label}>END</Text><TextInput value={endsAt} onChangeText={setEndsAt} style={styles.input} /></View></View>
    {ruleType === 'promotion' && <><Text style={styles.label}>PROMO CODE</Text><TextInput autoCapitalize="characters" value={promoCode} onChangeText={setPromoCode} style={styles.input} /></>}
    <Pressable disabled={saving} onPress={save} style={styles.save}>{saving ? <ActivityIndicator color={C.ink} /> : <><Text style={styles.saveText}>Publish rule</Text><Icon name="checkmark" /></>}</Pressable>
  </ScrollView></View></View></Modal>;
}

function BlackoutForm({ venue, userId, visible, onClose, onSaved }) {
  const [kind, setKind] = useState('maintenance'); const [reason, setReason] = useState('Court maintenance');
  const [date, setDate] = useState(tomorrow()); const [startsAt, setStartsAt] = useState('08:00'); const [endsAt, setEndsAt] = useState('10:00');
  const [courtId, setCourtId] = useState(''); const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await saveCourtBlackout({ venueId: venue.id, courtId, kind, reason, startsAt: localIso(date, startsAt), endsAt: localIso(date, endsAt), userId }); onSaved(); } catch (error) { Alert.alert('Blackout not saved', error.message || 'Check the date and times.'); } finally { setSaving(false); } };
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.backdrop}><View style={styles.sheet}><View style={styles.sheetHead}><View><Text style={styles.eyebrow}>COURT CALENDAR</Text><Text style={styles.sheetTitle}>Block unavailable time</Text></View><Pressable onPress={onClose} style={styles.close}><Icon name="close" /></Pressable></View><ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
    <Text style={styles.label}>REASON</Text><TextInput value={reason} onChangeText={setReason} style={styles.input} />
    <Text style={styles.label}>TYPE</Text><Choice value={kind} onChange={setKind} values={[{ value: 'maintenance', label: 'Maintenance' }, { value: 'private_event', label: 'Private event' }, { value: 'closure', label: 'Closure' }]} />
    <Text style={styles.label}>COURT</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}><Pressable onPress={() => setCourtId('')} style={[styles.chip, !courtId && styles.chipActive]}><Text style={[styles.chipText, !courtId && styles.chipTextActive]}>Entire venue</Text></Pressable>{venue.courts.map((court) => <Pressable key={court.id} onPress={() => setCourtId(court.id)} style={[styles.chip, courtId === court.id && styles.chipActive]}><Text style={[styles.chipText, courtId === court.id && styles.chipTextActive]}>{court.name}</Text></Pressable>)}</ScrollView>
    <Text style={styles.label}>DATE · YYYY-MM-DD</Text><TextInput value={date} onChangeText={setDate} style={styles.input} />
    <View style={styles.twoCols}><View style={styles.col}><Text style={styles.label}>START</Text><TextInput value={startsAt} onChangeText={setStartsAt} style={styles.input} /></View><View style={styles.col}><Text style={styles.label}>END</Text><TextInput value={endsAt} onChangeText={setEndsAt} style={styles.input} /></View></View>
    <Pressable disabled={saving} onPress={save} style={styles.save}>{saving ? <ActivityIndicator color={C.ink} /> : <><Text style={styles.saveText}>Block time</Text><Icon name="close-circle-outline" /></>}</Pressable>
  </ScrollView></View></View></Modal>;
}

export default function BookingRulesManager({ venue }) {
  const { user } = useAuth(); const [data, setData] = useState({ pricing: [], blackouts: [] }); const [loading, setLoading] = useState(true);
  const [pricingOpen, setPricingOpen] = useState(false); const [blackoutOpen, setBlackoutOpen] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { setData(await listVenueBookingRules(venue.id)); } catch (error) { Alert.alert('Booking rules unavailable', error.message || 'Please try again.'); } finally { setLoading(false); } }, [venue.id]);
  useEffect(() => { load(); }, [load]);
  const removePricing = (id) => Alert.alert('Delete pricing rule?', 'New quotes will stop using it immediately.', [{ text: 'Keep', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteVenuePricingRule(id); load(); } }]);
  const removeBlackout = (id) => Alert.alert('Remove blackout?', 'This time will become bookable if no reservation overlaps it.', [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { await deleteCourtBlackout(id); load(); } }]);
  return <View style={styles.card}><View style={styles.head}><View><Text style={styles.eyebrow}>BOOKING OPERATIONS</Text><Text style={styles.title}>Pricing &amp; availability</Text></View>{loading && <ActivityIndicator size="small" color={C.teal} />}</View><View style={styles.actions}><Pressable onPress={() => setPricingOpen(true)} style={styles.action}><Icon name="pricetag-outline" color={C.teal} /><Text style={styles.actionText}>Pricing rule</Text></Pressable><Pressable onPress={() => setBlackoutOpen(true)} style={styles.action}><Icon name="construct-outline" color={C.teal} /><Text style={styles.actionText}>Blackout</Text></Pressable></View>
    {data.pricing.map((rule) => <Pressable key={rule.id} onLongPress={() => removePricing(rule.id)} style={styles.row}><Icon name="pricetag" color={C.teal} /><View style={styles.rowCopy}><Text style={styles.rowTitle}>{rule.name}</Text><Text style={styles.rowMeta}>{rule.rule_type.replace('_', ' ')} · {rule.adjustment_type.replace('_', ' ')} {Number(rule.adjustment_value).toLocaleString()}</Text></View><Text style={styles.live}>LIVE</Text></Pressable>)}
    {data.blackouts.map((item) => <Pressable key={item.id} onLongPress={() => removeBlackout(item.id)} style={styles.row}><Icon name="ban" color={C.brick} /><View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.reason}</Text><Text style={styles.rowMeta}>{new Date(item.starts_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })}</Text></View></Pressable>)}
    {!loading && !data.pricing.length && !data.blackouts.length && <Text style={styles.empty}>Base court prices apply. Add peak/off-peak rules or maintenance blocks here.</Text>}
    <Text style={styles.hint}>Long-press a rule or blackout to remove it.</Text>
    <PricingForm venue={venue} visible={pricingOpen} onClose={() => setPricingOpen(false)} onSaved={() => { setPricingOpen(false); load(); }} />
    <BlackoutForm venue={venue} userId={user.id} visible={blackoutOpen} onClose={() => setBlackoutOpen(false)} onSaved={() => { setBlackoutOpen(false); load(); }} />
  </View>;
}

const styles = StyleSheet.create({
  card: { marginTop: 16, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, eyebrow: { color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .8 }, title: { marginTop: 3, color: C.ink, fontSize: 17, fontWeight: '900' }, actions: { marginTop: 12, flexDirection: 'row', gap: 8 }, action: { minHeight: 44, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, backgroundColor: '#E5F0ED' }, actionText: { color: C.teal, fontSize: 9, fontWeight: '900' }, row: { minHeight: 57, marginTop: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: C.paper }, rowCopy: { flex: 1 }, rowTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, rowMeta: { marginTop: 3, color: C.muted, fontSize: 7, textTransform: 'capitalize' }, live: { color: C.teal, fontSize: 6, fontWeight: '900' }, empty: { marginTop: 12, color: C.muted, fontSize: 8, lineHeight: 13 }, hint: { marginTop: 9, color: C.muted, fontSize: 7 }, backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.55)' }, sheet: { maxHeight: '92%', borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: C.paper }, sheetHead: { padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sheetTitle: { marginTop: 3, color: C.ink, fontSize: 20, fontWeight: '900' }, close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: C.surface }, form: { paddingHorizontal: 20, paddingBottom: 38 }, label: { marginTop: 13, marginBottom: 6, color: C.muted, fontSize: 8, fontWeight: '900', letterSpacing: .6 }, input: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: C.line, borderRadius: 12, color: C.ink, backgroundColor: C.surface, fontSize: 10, fontWeight: '800' }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, choice: { minHeight: 39, paddingHorizontal: 10, flexGrow: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, choiceActive: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, choiceText: { color: C.muted, fontSize: 8, fontWeight: '800' }, choiceTextActive: { color: C.teal }, chipRow: { gap: 6 }, chip: { minHeight: 36, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, chipActive: { backgroundColor: C.teal }, chipText: { color: C.muted, fontSize: 8, fontWeight: '800' }, chipTextActive: { color: C.surface }, twoCols: { flexDirection: 'row', gap: 8 }, col: { flex: 1 }, save: { minHeight: 52, marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: C.optic }, saveText: { color: C.ink, fontSize: 11, fontWeight: '900' },
});
