import Modal from './ResponsiveModal';
import { webDialog } from '../utils/webLayout';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import {
  deleteCourtBlackout, deleteVenuePricingRule, listVenueBookingRules,
  saveCourtBlackout, saveVenuePricingRule,
} from '../services/database';

const LIGHT_C = { ink: '#0E2321', surface: '#FFFFFF', paper: '#F3F5EF', teal: '#1C6B66', optic: '#D6E94A', brick: '#B6472E', line: '#DDE3DA', muted: '#7C8983' };
let C = LIGHT_C;
const Icon = ({ name, size = 18, color = C.ink }) => <Ionicons name={name} size={size} color={color} />;
const tomorrow = () => { const date = new Date(Date.now() + 86400000); return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); };
const dateAfter = (days) => { const date = new Date(Date.now() + days * 86400000); return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); };
const localIso = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();
const shiftDate = (value, days) => { const next = new Date(`${value}T12:00:00+08:00`); next.setDate(next.getDate() + days); return next.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); };
const shiftTime = (value, minutes) => { const [hour, minute] = value.split(':').map(Number); const total = Math.min(23 * 60 + 30, Math.max(6 * 60, hour * 60 + minute + minutes)); return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`; };
const displayTime = (value) => new Date(`2026-01-01T${value}:00`).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
const displayDate = (value) => new Date(`${value}T12:00:00+08:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });

function describePricingRule(rule) {
  const type = ({ peak: 'Peak hours', off_peak: 'Off-peak', holiday: 'Holiday', membership: 'Members', promotion: 'Promotion' })[rule.rule_type] || rule.rule_type;
  const value = Number(rule.adjustment_value);
  const price = rule.adjustment_type === 'fixed_hourly'
    ? `₱${value.toLocaleString()} per hour`
    : rule.adjustment_type === 'percentage'
      ? `${value > 0 ? '+' : ''}${value}%`
      : `₱${Math.abs(value).toLocaleString()} discount`;
  return `${type} · ${price}`;
}

function Choice({ values, value, onChange }) {
  return <View style={styles.choices}>{values.map((item) => <Pressable key={item.value} onPress={() => onChange(item.value)} style={[styles.choice, value === item.value && styles.choiceActive]}><Text style={[styles.choiceText, value === item.value && styles.choiceTextActive]}>{item.label}</Text></Pressable>)}</View>;
}

function TimeStepper({ label, value, onChange }) {
  return <View style={styles.timeStepper}><Text style={styles.timeStepperLabel}>{label}</Text><View style={styles.timeStepperControls}><Pressable accessibilityRole="button" accessibilityLabel={`Make ${label.toLowerCase()} 30 minutes earlier`} disabled={value <= '06:00'} onPress={() => onChange(shiftTime(value, -30))} style={[styles.timeStepButton, value <= '06:00' && styles.disabled]}><Icon name="remove" color={C.teal} /></Pressable><Text style={styles.timeStepperValue}>{displayTime(value)}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Make ${label.toLowerCase()} 30 minutes later`} disabled={value >= '23:30'} onPress={() => onChange(shiftTime(value, 30))} style={[styles.timeStepButton, value >= '23:30' && styles.disabled]}><Icon name="add" color={C.teal} /></Pressable></View></View>;
}

function PricingForm({ venue, visible, onClose, onSaved }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('Peak hours');
  const [ruleType, setRuleType] = useState('peak');
  const [adjustmentType, setAdjustmentType] = useState('fixed_hourly');
  const [value, setValue] = useState('700');
  const [startsAt, setStartsAt] = useState('17:00');
  const [endsAt, setEndsAt] = useState('21:00');
  const [courtId, setCourtId] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (visible) { setStep(1); setCourtId(''); setPromoCode(''); } }, [visible]);
  const chooseTemplate = (template) => {
    setRuleType(template.type); setName(template.name); setAdjustmentType(template.method); setValue(template.value); setStartsAt(template.start); setEndsAt(template.end); setStep(2);
  };
  const save = async () => {
    if (name.trim().length < 2 || !Number.isFinite(Number(value)) || (adjustmentType !== 'percentage' && Number(value) < 0)) { Alert.alert('Check special price', 'Enter a name and valid price. Percentage discounts use a negative number.'); return; }
    setSaving(true);
    try {
      await saveVenuePricingRule({ venueId: venue.id, courtId, name, ruleType, adjustmentType, adjustmentValue: value, daysOfWeek: [1, 2, 3, 4, 5, 6, 0], startsAtLocal: startsAt, endsAtLocal: endsAt, promoCode: ruleType === 'promotion' ? promoCode : '', priority: ruleType === 'holiday' ? 30 : ruleType === 'promotion' ? 40 : 10 });
      onSaved();
    } catch (error) { Alert.alert('Special price not saved', error.message || 'Please try again.'); }
    finally { setSaving(false); }
  };
  const templates = [
    { type: 'peak', name: 'Peak hours', icon: 'trending-up-outline', detail: 'Charge a different rate during busy hours', method: 'fixed_hourly', value: '700', start: '17:00', end: '21:00' },
    { type: 'off_peak', name: 'Off-peak deal', icon: 'sunny-outline', detail: 'Encourage bookings during quieter hours', method: 'fixed_hourly', value: '400', start: '10:00', end: '16:00' },
    { type: 'holiday', name: 'Holiday rate', icon: 'calendar-outline', detail: 'Set a special price for holidays or events', method: 'fixed_hourly', value: '800', start: '06:00', end: '22:00' },
    { type: 'promotion', name: 'Promo discount', icon: 'gift-outline', detail: 'Offer a code players can use', method: 'flat_discount', value: '100', start: '06:00', end: '22:00' },
  ];
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><KeyboardAvoidingView {...webDialog('backdrop')} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.backdrop}><View {...webDialog('surface')} style={styles.sheet}><View style={styles.sheetHead}><View><Text style={styles.eyebrow}>SPECIAL PRICING · STEP {step} OF 2</Text><Text style={styles.sheetTitle}>{step === 1 ? 'Choose a starting point' : 'Review the details'}</Text></View><Pressable accessibilityLabel="Close special pricing form" onPress={onClose} style={styles.close}><Icon name="close" /></Pressable></View><View style={styles.sheetProgress}><View style={styles.sheetProgressActive} /><View style={[styles.sheetProgressStep, step === 2 && styles.sheetProgressActive]} /></View><ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
    {step === 1 ? <><Text style={styles.formIntro}>Pick the option closest to what you need. You can adjust everything on the next screen.</Text><View style={styles.templateList}>{templates.map((template) => <Pressable key={template.type} onPress={() => chooseTemplate(template)} style={({ pressed }) => [styles.templateCard, pressed && styles.templateCardPressed]}><View style={styles.templateIcon}><Icon name={template.icon} color={C.teal} /></View><View style={styles.flex}><Text style={styles.templateTitle}>{template.name}</Text><Text style={styles.templateDetail}>{template.detail}</Text></View><Icon name="chevron-forward" color={C.teal} /></Pressable>)}</View></> : <>
      <View style={styles.selectedTemplate}><View style={styles.selectedTemplateIcon}><Icon name={templates.find((item) => item.type === ruleType)?.icon || 'pricetag-outline'} color={C.teal} /></View><View style={styles.flex}><Text style={styles.selectedTemplateTitle}>{name}</Text><Text style={styles.selectedTemplateMeta}>You can change these details below.</Text></View><Pressable onPress={() => setStep(1)}><Text style={styles.editText}>CHANGE</Text></Pressable></View>
      <Text style={styles.label}>NAME PLAYERS WILL UNDERSTAND</Text><TextInput value={name} onChangeText={setName} placeholder="e.g. Weekday peak hours" placeholderTextColor={C.muted} style={styles.input} />
      <Text style={styles.label}>APPLIES TO</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}><Pressable onPress={() => setCourtId('')} style={[styles.chip, !courtId && styles.chipActive]}><Text style={[styles.chipText, !courtId && styles.chipTextActive]}>All courts</Text></Pressable>{venue.courts.map((court) => <Pressable key={court.id} onPress={() => setCourtId(court.id)} style={[styles.chip, courtId === court.id && styles.chipActive]}><Text style={[styles.chipText, courtId === court.id && styles.chipTextActive]}>{court.name}</Text></Pressable>)}</ScrollView>
      <Text style={styles.label}>HOW THE PRICE CHANGES</Text><Choice value={adjustmentType} onChange={setAdjustmentType} values={[{ value: 'fixed_hourly', label: 'Set hourly price' }, { value: 'percentage', label: 'Change by %' }, { value: 'flat_discount', label: 'Flat discount' }]} />
      <Text style={styles.label}>{adjustmentType === 'fixed_hourly' ? 'NEW HOURLY PRICE (PHP)' : adjustmentType === 'percentage' ? 'PERCENT CHANGE' : 'DISCOUNT AMOUNT (PHP)'}</Text><TextInput value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder={adjustmentType === 'percentage' ? '-20' : '500'} placeholderTextColor={C.muted} style={styles.input} />
      <Text style={styles.label}>ACTIVE EACH DAY BETWEEN</Text><View style={styles.timeStepperStack}><TimeStepper label="Starts" value={startsAt} onChange={setStartsAt} /><TimeStepper label="Ends" value={endsAt} onChange={setEndsAt} /></View>
      {ruleType === 'promotion' && <><Text style={styles.label}>PROMO CODE</Text><TextInput autoCapitalize="characters" value={promoCode} onChangeText={setPromoCode} placeholder="e.g. PLAY100" placeholderTextColor={C.muted} style={styles.input} /></>}
      <View style={styles.sheetActions}><Pressable disabled={saving} onPress={() => setStep(1)} style={styles.sheetBackButton}><Text style={styles.sheetBackText}>Back</Text></Pressable><Pressable disabled={saving} onPress={save} style={[styles.save, styles.sheetSave]}>{saving ? <ActivityIndicator color="#0E2321" /> : <><Text style={styles.saveText}>Save price</Text><Icon name="checkmark" color="#0E2321" /></>}</Pressable></View>
    </>}
  </ScrollView></View></KeyboardAvoidingView></Modal>;
}

function BlackoutForm({ venue, userId, visible, onClose, onSaved }) {
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState('maintenance'); const [reason, setReason] = useState('Court maintenance');
  const [date, setDate] = useState(tomorrow()); const [startsAt, setStartsAt] = useState('08:00'); const [endsAt, setEndsAt] = useState('10:00');
  const [courtId, setCourtId] = useState(''); const [saving, setSaving] = useState(false); const [timePreset, setTimePreset] = useState('morning');
  useEffect(() => { if (visible) { setStep(1); setKind('maintenance'); setReason('Court maintenance'); setDate(tomorrow()); setStartsAt('08:00'); setEndsAt('12:00'); setCourtId(''); setTimePreset('morning'); } }, [visible]);
  const selectKind = (value) => { setKind(value); setReason(({ maintenance: 'Court maintenance', private_event: 'Private event', closure: 'Venue closure' })[value]); };
  const selectTime = (preset) => { setTimePreset(preset.id); setStartsAt(preset.start); setEndsAt(preset.end); };
  const save = async () => {
    const start = localIso(date, startsAt); const end = localIso(date, endsAt);
    if (!reason.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startsAt) || !/^\d{2}:\d{2}$/.test(endsAt) || new Date(end) <= new Date(start)) { Alert.alert('Check blocked time', 'Enter a reason, valid date, and an end time after the start time.'); return; }
    setSaving(true); try { await saveCourtBlackout({ venueId: venue.id, courtId, kind, reason, startsAt: start, endsAt: end, userId }); onSaved(); } catch (error) { Alert.alert('Time not blocked', error.message || 'Check the date and times.'); } finally { setSaving(false); }
  };
  const timePresets = [{ id: 'morning', label: 'Morning', start: '08:00', end: '12:00' }, { id: 'afternoon', label: 'Afternoon', start: '12:00', end: '17:00' }, { id: 'evening', label: 'Evening', start: '17:00', end: '22:00' }, { id: 'day', label: 'All day', start: '06:00', end: '22:00' }];
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><KeyboardAvoidingView {...webDialog('backdrop')} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.backdrop}><View {...webDialog('surface')} style={styles.sheet}><View style={styles.sheetHead}><View><Text style={styles.eyebrow}>BOOKING AVAILABILITY · {step} OF 2</Text><Text style={styles.sheetTitle}>{step === 1 ? 'Choose what to block' : 'Choose date and time'}</Text></View><Pressable accessibilityLabel="Close blocked-time form" onPress={onClose} style={styles.close}><Icon name="close" /></Pressable></View><View style={styles.sheetProgress}><View style={styles.sheetProgressActive} /><View style={step === 2 ? styles.sheetProgressActive : styles.sheetProgressStep} /></View><ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
    {step === 1 ? <>
      <Text style={styles.formIntro}>First choose the reason and affected court. You’ll schedule it on the next step.</Text>
      <Text style={styles.label}>WHY IS BOOKING CLOSED?</Text><Choice value={kind} onChange={selectKind} values={[{ value: 'maintenance', label: 'Maintenance' }, { value: 'private_event', label: 'Private event' }, { value: 'closure', label: 'Full closure' }]} />
      <Text style={styles.label}>NOTE FOR YOUR TEAM</Text><TextInput value={reason} onChangeText={setReason} placeholder="e.g. Net replacement" placeholderTextColor={C.muted} style={styles.input} />
      <Text style={styles.label}>WHERE</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}><Pressable onPress={() => setCourtId('')} style={[styles.chip, !courtId && styles.chipActive]}><Text style={[styles.chipText, !courtId && styles.chipTextActive]}>Entire venue</Text></Pressable>{venue.courts.map((court) => <Pressable key={court.id} onPress={() => setCourtId(court.id)} style={[styles.chip, courtId === court.id && styles.chipActive]}><Text style={[styles.chipText, courtId === court.id && styles.chipTextActive]}>{court.name}</Text></Pressable>)}</ScrollView>
      <Pressable disabled={!reason.trim()} onPress={() => setStep(2)} style={[styles.save, !reason.trim() && styles.disabled]}><Text style={styles.saveText}>Continue to schedule</Text><Icon name="arrow-forward" color="#0E2321" /></Pressable>
    </> : <>
      <View style={styles.selectedTemplate}><View style={styles.selectedTemplateIcon}><Icon name="calendar-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.selectedTemplateTitle}>{reason}</Text><Text style={styles.selectedTemplateMeta}>{courtId ? venue.courts.find((court) => court.id === courtId)?.name : 'Entire venue'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Edit blocked-time details" onPress={() => setStep(1)}><Text style={styles.editText}>EDIT</Text></Pressable></View>
      <Text style={styles.label}>DATE</Text><View style={styles.quickDateRow}>{[{ label: 'Tomorrow', value: dateAfter(1) }, { label: 'In 2 days', value: dateAfter(2) }, { label: 'Next week', value: dateAfter(7) }].map((item) => <Pressable key={item.label} onPress={() => setDate(item.value)} style={[styles.quickDate, date === item.value && styles.quickDateActive]}><Text style={[styles.quickDateText, date === item.value && styles.quickDateTextActive]}>{item.label}</Text></Pressable>)}</View><View style={styles.dateStepper}><Pressable accessibilityRole="button" accessibilityLabel="Previous date" disabled={date <= tomorrow()} onPress={() => setDate(shiftDate(date, -1))} style={[styles.dateStepButton, date <= tomorrow() && styles.disabled]}><Icon name="chevron-back" color={C.teal} /></Pressable><View style={styles.dateStepCopy}><Text style={styles.dateStepValue}>{displayDate(date)}</Text><Text style={styles.dateStepMeta}>{date}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Next date" onPress={() => setDate(shiftDate(date, 1))} style={styles.dateStepButton}><Icon name="chevron-forward" color={C.teal} /></Pressable></View>
      <Text style={styles.label}>TIME</Text><View style={styles.timePresetGrid}>{timePresets.map((preset) => <Pressable key={preset.id} onPress={() => selectTime(preset)} style={[styles.timePreset, timePreset === preset.id && styles.timePresetActive]}><Text style={[styles.timePresetTitle, timePreset === preset.id && styles.timePresetTitleActive]}>{preset.label}</Text><Text style={styles.timePresetMeta}>{preset.start}–{preset.end}</Text></Pressable>)}</View>
      <Text style={styles.label}>ADJUST TIME</Text><View style={styles.timeStepperStack}><TimeStepper label="Starts" value={startsAt} onChange={(value) => { setTimePreset('custom'); setStartsAt(value); }} /><TimeStepper label="Ends" value={endsAt} onChange={(value) => { setTimePreset('custom'); setEndsAt(value); }} /></View>
      <View style={styles.blockSummary}><Icon name="information-circle-outline" color={C.teal} /><Text style={styles.blockSummaryText}>{courtId ? venue.courts.find((court) => court.id === courtId)?.name : 'Entire venue'} will be unavailable on {date}, {startsAt}–{endsAt}.</Text></View>
      <View style={styles.sheetActions}><Pressable disabled={saving} onPress={() => setStep(1)} style={styles.sheetBackButton}><Text style={styles.sheetBackText}>Back</Text></Pressable><Pressable disabled={saving} onPress={save} style={[styles.save, styles.sheetSave]}>{saving ? <ActivityIndicator color="#0E2321" /> : <><Text style={styles.saveText}>Block this time</Text><Icon name="close-circle-outline" color="#0E2321" /></>}</Pressable></View>
    </>}
  </ScrollView></View></KeyboardAvoidingView></Modal>;
}

export default function BookingRulesManager({ venue }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS, muted: DARK_CONTENT_COLORS.ink40 } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { user } = useAuth(); const [data, setData] = useState({ pricing: [], blackouts: [] }); const [loading, setLoading] = useState(true);
  const [pricingOpen, setPricingOpen] = useState(false); const [blackoutOpen, setBlackoutOpen] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { setData(await listVenueBookingRules(venue.id)); } catch (error) { Alert.alert('Booking setup unavailable', error.message || 'Please try again.'); } finally { setLoading(false); } }, [venue.id]);
  useEffect(() => { load(); }, [load]);
  const removePricing = (id) => Alert.alert('Remove special price?', 'Your standard court price will apply instead.', [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { await deleteVenuePricingRule(id); load(); } }]);
  const removeBlackout = (id) => Alert.alert('Make this time bookable again?', 'Players will be able to book it if no reservation overlaps.', [{ text: 'Keep blocked', style: 'cancel' }, { text: 'Make bookable', onPress: async () => { await deleteCourtBlackout(id); load(); } }]);
  return <View style={styles.card}><View style={styles.head}><View style={styles.flex}><Text style={styles.eyebrow}>PRICES &amp; CLOSURES</Text><Text style={styles.title}>Booking setup</Text><Text style={styles.subtitle}>Change prices for special hours or stop bookings during maintenance.</Text></View>{loading && <ActivityIndicator size="small" color={C.teal} />}</View><View style={styles.actions}><Pressable onPress={() => setPricingOpen(true)} style={styles.action}><View style={styles.actionIcon}><Icon name="pricetag-outline" color={C.teal} /></View><Text style={styles.actionTitle}>Special price</Text><Text style={styles.actionMeta}>Peak, promo, or member rate</Text></Pressable><Pressable onPress={() => setBlackoutOpen(true)} style={styles.action}><View style={styles.actionIcon}><Icon name="calendar-outline" color={C.teal} /></View><Text style={styles.actionTitle}>Block time</Text><Text style={styles.actionMeta}>Maintenance, closure, or event</Text></Pressable></View>
    {!!data.pricing.length && <Text style={styles.listLabel}>SPECIAL PRICES</Text>}
    {data.pricing.map((rule) => <View key={rule.id} style={styles.row}><View style={styles.rowIcon}><Icon name="pricetag" color={C.teal} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{rule.name}</Text><Text style={styles.rowMeta}>{describePricingRule(rule)}</Text></View><View style={styles.livePill}><Text style={styles.live}>LIVE</Text></View><Pressable accessibilityLabel={`Remove ${rule.name}`} onPress={() => removePricing(rule.id)} style={styles.removeButton}><Icon name="trash-outline" size={16} color={C.brick} /></Pressable></View>)}
    {!!data.blackouts.length && <Text style={styles.listLabel}>BLOCKED TIMES</Text>}
    {data.blackouts.map((item) => <View key={item.id} style={styles.row}><View style={[styles.rowIcon, styles.rowIconBlocked]}><Icon name="calendar" color={C.brick} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.reason}</Text><Text style={styles.rowMeta}>{new Date(item.starts_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })}</Text></View><Pressable accessibilityLabel={`Remove blocked time for ${item.reason}`} onPress={() => removeBlackout(item.id)} style={styles.removeButton}><Icon name="trash-outline" size={16} color={C.brick} /></Pressable></View>)}
    {!loading && !data.pricing.length && !data.blackouts.length && <View style={styles.emptyState}><View style={styles.emptyIcon}><Icon name="checkmark-circle-outline" size={25} color={C.teal} /></View><View style={styles.flex}><Text style={styles.emptyTitle}>Standard setup is active</Text><Text style={styles.empty}>Players see each court’s regular hourly price, and all active courts remain bookable.</Text></View></View>}
    <PricingForm venue={venue} visible={pricingOpen} onClose={() => setPricingOpen(false)} onSaved={() => { setPricingOpen(false); load(); }} />
    <BlackoutForm venue={venue} userId={user.id} visible={blackoutOpen} onClose={() => setBlackoutOpen(false)} onSaved={() => { setBlackoutOpen(false); load(); }} />
  </View>;
}

const lightStyles = createMobileStyleSheet({
  flex: { flex: 1 },
  card: { marginTop: 16, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: LIGHT_C.teal, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { marginTop: 3, color: LIGHT_C.ink, fontSize: 17, fontWeight: '900' },
  subtitle: { marginTop: 4, color: LIGHT_C.muted, fontSize: 11 },
  actions: { marginTop: 16, flexDirection: 'row', gap: 8 },
  action: { flex: 1, padding: 12, borderRadius: 12, backgroundColor: LIGHT_C.paper, borderWidth: 1, borderColor: LIGHT_C.line, alignItems: 'flex-start' },
  actionIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#E5F0ED', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  actionTitle: { color: LIGHT_C.ink, fontSize: 12, fontWeight: '900' },
  actionMeta: { marginTop: 2, color: LIGHT_C.muted, fontSize: 10 },
  listLabel: { marginTop: 20, marginBottom: 8, color: LIGHT_C.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  row: { minHeight: 57, marginBottom: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, backgroundColor: LIGHT_C.paper },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#E5F0ED', alignItems: 'center', justifyContent: 'center' },
  rowIconBlocked: { backgroundColor: '#FDECEA' },
  rowCopy: { flex: 1 },
  rowTitle: { color: LIGHT_C.ink, fontSize: 12, fontWeight: '900' },
  rowMeta: { marginTop: 2, color: LIGHT_C.muted, fontSize: 10 },
  livePill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#E5F0ED' },
  live: { color: LIGHT_C.teal, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  removeButton: { padding: 8 },
  emptyState: { marginTop: 20, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.paper, flexDirection: 'row', alignItems: 'center', gap: 12 },
  emptyIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E5F0ED', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: LIGHT_C.ink, fontSize: 13, fontWeight: '900' },
  empty: { marginTop: 4, color: LIGHT_C.muted, fontSize: 11, lineHeight: 16 },

  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.55)' },
  sheet: { maxHeight: '92%', borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: LIGHT_C.paper },
  sheetHead: { padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { marginTop: 3, color: LIGHT_C.ink, fontSize: 20, fontWeight: '900' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: LIGHT_C.surface },
  sheetProgress: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 20 },
  sheetProgressActive: { flex: 1, height: 4, borderRadius: 2, backgroundColor: LIGHT_C.teal },
  sheetProgressStep: { flex: 1, height: 4, borderRadius: 2, backgroundColor: LIGHT_C.line },
  form: { paddingHorizontal: 20, paddingBottom: 38 },
  formIntro: { marginBottom: 20, color: LIGHT_C.muted, fontSize: 13, lineHeight: 18 },
  templateList: { gap: 12 },
  templateCard: { padding: 16, borderRadius: 16, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
  templateCardPressed: { backgroundColor: LIGHT_C.paper },
  templateIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E5F0ED', alignItems: 'center', justifyContent: 'center' },
  templateTitle: { color: LIGHT_C.ink, fontSize: 14, fontWeight: '900' },
  templateDetail: { marginTop: 4, color: LIGHT_C.muted, fontSize: 11 },
  selectedTemplate: { padding: 16, borderRadius: 16, backgroundColor: '#E5F0ED', flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  selectedTemplateIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: LIGHT_C.surface, alignItems: 'center', justifyContent: 'center' },
  selectedTemplateTitle: { color: LIGHT_C.ink, fontSize: 13, fontWeight: '900' },
  selectedTemplateMeta: { marginTop: 2, color: LIGHT_C.teal, fontSize: 10 },
  editText: { color: LIGHT_C.teal, fontSize: 10, fontWeight: '900' },
  label: { marginTop: 16, marginBottom: 8, color: LIGHT_C.muted, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  input: { minHeight: 48, paddingHorizontal: 16, borderWidth: 1, borderColor: LIGHT_C.line, borderRadius: 12, color: LIGHT_C.ink, backgroundColor: LIGHT_C.surface, fontSize: 13, fontWeight: '800' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 44, paddingHorizontal: 16, flexGrow: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface },
  choiceActive: { borderColor: LIGHT_C.teal, backgroundColor: '#E5F0ED' },
  choiceText: { color: LIGHT_C.muted, fontSize: 11, fontWeight: '800' },
  choiceTextActive: { color: LIGHT_C.teal },
  chipRow: { gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface },
  chipActive: { backgroundColor: LIGHT_C.teal, borderColor: LIGHT_C.teal },
  chipText: { color: LIGHT_C.muted, fontSize: 12, fontWeight: '800' },
  chipTextActive: { color: LIGHT_C.surface },
  twoCols: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  save: { minHeight: 52, marginTop: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: LIGHT_C.optic },
  saveText: { color: LIGHT_C.ink, fontSize: 14, fontWeight: '900' },
  sheetActions: { marginTop: 24, flexDirection: 'row', gap: 12 },
  sheetBackButton: { minHeight: 52, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: LIGHT_C.surface, borderWidth: 1, borderColor: LIGHT_C.line },
  sheetBackText: { color: LIGHT_C.ink, fontSize: 14, fontWeight: '900' },
  sheetSave: { marginTop: 0, flex: 2 },
  quickDateRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  quickDate: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface },
  quickDateActive: { borderColor: LIGHT_C.teal, backgroundColor: '#E5F0ED' },
  quickDateText: { color: LIGHT_C.muted, fontSize: 11, fontWeight: '800' },
  quickDateTextActive: { color: LIGHT_C.teal },
  timePresetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  timePreset: { width: '48%', minHeight: 56, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface, justifyContent: 'center' },
  timePresetActive: { borderColor: LIGHT_C.teal, backgroundColor: '#E5F0ED' },
  timePresetTitle: { color: LIGHT_C.ink, fontSize: 12, fontWeight: '900' },
  timePresetTitleActive: { color: LIGHT_C.teal },
  timePresetMeta: { marginTop: 2, color: LIGHT_C.muted, fontSize: 10 },
  blockSummary: { marginTop: 24, padding: 16, borderRadius: 12, backgroundColor: '#E5F0ED', flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  blockSummaryText: { flex: 1, color: LIGHT_C.teal, fontSize: 12, lineHeight: 18 },
  disabled: { opacity: 0.5 },

  timeStepperStack: { gap: 8 }, timeStepper: { minHeight: 68, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, timeStepperLabel: { width: 44, color: LIGHT_C.muted, fontSize: 8, fontWeight: '900' }, timeStepperControls: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, timeStepButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, timeStepperValue: { flex: 1, color: LIGHT_C.ink, fontSize: 12, fontWeight: '900', textAlign: 'center' }, dateStepper: { minHeight: 68, marginTop: 7, padding: 7, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface }, dateStepButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, dateStepCopy: { flex: 1, alignItems: 'center' }, dateStepValue: { color: LIGHT_C.ink, fontSize: 10, fontWeight: '900', textAlign: 'center' }, dateStepMeta: { marginTop: 3, color: LIGHT_C.muted, fontSize: 7 },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
