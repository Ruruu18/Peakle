import Modal from './ResponsiveModal';
import { webDialog } from '../utils/webLayout';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DEFAULT_COLORS = {
  ink: '#0E2321',
  paper: '#F3F5EF',
  surface: '#FFFFFF',
  optic: '#D6E94A',
  teal: '#1C6B66',
  ink40: '#7C8983',
  line: '#DDE3DA',
};

const pad = (value) => String(value).padStart(2, '0');
export const todayDateValue = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const validDateValue = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const monthFromValue = (value) => {
  const safeValue = validDateValue(value) ? value : todayDateValue();
  const [year, month] = safeValue.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
};
const monthKey = (date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
const calendarDays = (monthCursor) => {
  const year = monthCursor.getUTCFullYear();
  const month = monthCursor.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const item = new Date(gridStart);
    item.setUTCDate(gridStart.getUTCDate() + index);
    return {
      value: `${item.getUTCFullYear()}-${pad(item.getUTCMonth() + 1)}-${pad(item.getUTCDate())}`,
      day: item.getUTCDate(),
      inMonth: item.getUTCMonth() === month,
    };
  });
};

export const appDateLabel = (value) => {
  if (!validDateValue(value)) return 'Choose date';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-PH', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export function AppDatePickerField({ value, onPress, accessibilityLabel = 'Choose date', colors = DEFAULT_COLORS }) {
  const C = { ...DEFAULT_COLORS, ...colors };
  return <Pressable accessibilityRole="button" accessibilityLabel={`${accessibilityLabel}, currently ${appDateLabel(value)}`} onPress={onPress} style={[styles.field, { backgroundColor: C.surface, borderColor: C.line }]}>
    <View style={[styles.fieldIcon, { backgroundColor: C.paper }]}><Ionicons name="calendar-outline" size={18} color={C.teal} /></View>
    <Text numberOfLines={1} style={[styles.fieldValue, { color: C.ink }]}>{appDateLabel(value)}</Text>
    <Ionicons name="chevron-down" size={17} color={C.ink40} />
  </Pressable>;
}

export default function AppDatePickerModal({
  visible,
  value,
  title = 'Choose a date',
  eyebrow = 'DATE',
  minimumDate = null,
  maximumDate = null,
  onSelect,
  onClose,
  colors = DEFAULT_COLORS,
}) {
  const insets = useSafeAreaInsets();
  const C = { ...DEFAULT_COLORS, ...colors };
  const [monthCursor, setMonthCursor] = useState(() => monthFromValue(value));
  useEffect(() => {
    if (visible) setMonthCursor(monthFromValue(value || minimumDate));
  }, [minimumDate, value, visible]);
  const days = useMemo(() => calendarDays(monthCursor), [monthCursor]);
  const previousDisabled = minimumDate && monthKey(monthCursor) <= monthKey(monthFromValue(minimumDate));
  const nextDisabled = maximumDate && monthKey(monthCursor) >= monthKey(monthFromValue(maximumDate));
  const changeMonth = (amount) => setMonthCursor((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + amount, 1)));

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <Pressable {...webDialog('backdrop')} accessibilityRole="button" accessibilityLabel="Close date picker" onPress={onClose} style={styles.backdrop}>
      <Pressable {...webDialog('surface')} onPress={(event) => event.stopPropagation()} style={[styles.sheet, { backgroundColor: C.paper, paddingBottom: Math.max(insets.bottom, 18) }]}>
        <View {...webDialog('handle')} style={[styles.handle, { backgroundColor: C.line }]} />
        <View style={styles.header}><View style={styles.flex}><Text style={[styles.eyebrow, { color: C.teal }]}>{eyebrow}</Text><Text style={[styles.title, { color: C.ink }]}>{title}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close date picker" onPress={onClose} style={[styles.close, { backgroundColor: C.surface }]}><Ionicons name="close" size={20} color={C.ink} /></Pressable></View>
        <View style={styles.calendar}>
          <View style={styles.monthNav}><Pressable accessibilityRole="button" accessibilityLabel="Previous month" accessibilityState={{ disabled: Boolean(previousDisabled) }} disabled={Boolean(previousDisabled)} onPress={() => changeMonth(-1)} style={[styles.monthButton, { backgroundColor: C.surface, borderColor: C.line }, previousDisabled && styles.disabled]}><Ionicons name="chevron-back" size={19} color={C.teal} /></Pressable><Text style={[styles.month, { color: C.ink }]}>{monthCursor.toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'long', year: 'numeric' })}</Text><Pressable accessibilityRole="button" accessibilityLabel="Next month" accessibilityState={{ disabled: Boolean(nextDisabled) }} disabled={Boolean(nextDisabled)} onPress={() => changeMonth(1)} style={[styles.monthButton, { backgroundColor: C.surface, borderColor: C.line }, nextDisabled && styles.disabled]}><Ionicons name="chevron-forward" size={19} color={C.teal} /></Pressable></View>
          <View style={styles.weekdays}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => <Text key={`${label}-${index}`} style={[styles.weekday, { color: C.ink40 }]}>{label}</Text>)}</View>
          <View style={styles.grid}>{days.map((item) => {
            if (!item.inMonth) return <View key={item.value} style={styles.day} />;
            const active = item.value === value;
            const disabled = Boolean((minimumDate && item.value < minimumDate) || (maximumDate && item.value > maximumDate));
            return <Pressable key={item.value} accessibilityRole="button" accessibilityLabel={appDateLabel(item.value)} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={() => onSelect(item.value)} style={[styles.day, active && { backgroundColor: C.optic }, disabled && styles.disabled]}><Text style={[styles.dayText, { color: active ? '#0E2321' : C.ink }, active && styles.dayTextActive]}>{item.day}</Text>{item.value === todayDateValue() ? <View style={[styles.todayDot, { backgroundColor: active ? '#0E2321' : C.teal }]} /> : null}</Pressable>;
          })}</View>
        </View>
      </Pressable>
    </Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.54)' },
  sheet: { paddingHorizontal: 18, paddingTop: 10, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  handle: { width: 42, height: 4, alignSelf: 'center', marginBottom: 13, borderRadius: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: .9 },
  title: { marginTop: 2, fontSize: 21, fontWeight: '900' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  calendar: { marginTop: 15 },
  monthNav: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 12 },
  month: { fontSize: 14, fontWeight: '900' },
  weekdays: { marginTop: 9, flexDirection: 'row' },
  weekday: { width: '14.285%', textAlign: 'center', fontSize: 8, fontWeight: '900' },
  grid: { marginTop: 6, flexDirection: 'row', flexWrap: 'wrap' },
  day: { width: '14.285%', height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  dayText: { fontSize: 12, fontWeight: '800' },
  dayTextActive: { fontWeight: '900' },
  todayDot: { position: 'absolute', bottom: 6, width: 4, height: 4, borderRadius: 2 },
  disabled: { opacity: .2 },
  field: { minHeight: 52, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 13 },
  fieldIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  fieldValue: { flex: 1, fontSize: 10, fontWeight: '900' },
});
