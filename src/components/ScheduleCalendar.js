import React, { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import AppIcon from './AppIcon';
import { webLayout } from '../utils/webLayout';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, LIGHT_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { dateFromDayKey, formatDayLabel, formatTime, monthGrid, shiftDayKey } from '../services/schedule';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The schedule has its own calendar so the game-creation date and time setup
// can keep its compact picker and existing behavior.
export default function ScheduleCalendar({ monthKey, selectedKey, todayKey, byDay, monthOpen, onToggleMonth, onSelect, onMonth, onOpenEntry, expanded, kindColor, filters }) {
  const { isDark } = useTheme();
  const styles = isDark ? darkStyles : lightStyles;
  const palette = isDark ? DARK_CONTENT_COLORS : LIGHT_CONTENT_COLORS;
  const days = useMemo(() => {
    if (monthOpen) {
      const grid = monthGrid(monthKey);
      // Keep full weeks, without an empty sixth row in shorter months.
      return grid[35].startsWith(monthKey) ? grid : grid.slice(0, 35);
    }
    const start = shiftDayKey(selectedKey, -dateFromDayKey(selectedKey).getUTCDay());
    return Array.from({ length: 7 }, (_, index) => shiftDayKey(start, index));
  }, [monthKey, selectedKey, monthOpen]);
  const monthCount = Object.entries(byDay).reduce((total, [key, entries]) => total + (key.startsWith(monthKey) ? entries.length : 0), 0);
  const title = formatDayLabel(`${monthKey}-01`, { month: 'long', year: 'numeric' });
  const changePeriod = (delta) => monthOpen ? onMonth(delta) : onSelect(shiftDayKey(selectedKey, delta * 7));

  return (
    <View {...webLayout('schedule-calendar')} style={[styles.calendar, expanded && styles.calendarExpanded]}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={[styles.title, expanded && styles.titleExpanded]}>{title}</Text>
          <Text style={styles.subtitle}>{monthCount ? `${monthCount} ${monthCount === 1 ? 'session' : 'sessions'} this month` : 'Make room for a little court time'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Go to today" onPress={() => onSelect(todayKey)} style={({ pressed }) => [styles.todayButton, pressed && styles.pressed]}>
          <Text style={styles.todayButtonText}>Today</Text>
        </Pressable>
      </View>

      <View style={styles.toolbar}>
        <View accessibilityRole="tablist" accessibilityLabel="Calendar display" style={styles.viewToggle}>
          {[{ label: 'Month', active: monthOpen }, { label: 'Week', active: !monthOpen }].map(({ label, active }) => (
            <Pressable key={label} accessibilityRole="tab" accessibilityLabel={`${label} view`} accessibilityState={{ selected: active }} aria-selected={active} onPress={() => { if (!active) onToggleMonth(); }} style={({ pressed }) => [styles.viewButton, active && styles.viewButtonActive, pressed && styles.pressed]}>
              <AppIcon name={label === 'Month' ? 'calendar-outline' : 'reorder-three-outline'} size={14} color={active ? palette.ink : palette.ink40} />
              <Text style={[styles.viewText, active && styles.viewTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.navigation}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Previous ${monthOpen ? 'month' : 'week'}`} onPress={() => changePeriod(-1)} style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}><AppIcon name="chevron-back" size={18} color={palette.ink} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Next ${monthOpen ? 'month' : 'week'}`} onPress={() => changePeriod(1)} style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}><AppIcon name="chevron-forward" size={18} color={palette.ink} /></Pressable>
        </View>
      </View>

      <View style={styles.filters}>{filters}</View>
      <View style={styles.weekdays}>{WEEKDAYS.map((day, index) => <Text key={day} style={[styles.weekday, index === 0 && styles.sunday, index === 6 && styles.saturday]}>{day}</Text>)}</View>
      <View style={styles.grid}>
        {Array.from({ length: days.length / 7 }, (_, week) => (
          <View key={days[week * 7]} style={styles.weekRow}>
            {days.slice(week * 7, week * 7 + 7).map((key, weekday) => {
              const selected = key === selectedKey;
              const today = key === todayKey;
              const outside = monthOpen && !key.startsWith(monthKey);
              const entries = (byDay[key] || []).slice().sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
              return (
                <View key={key} style={[styles.cell, expanded && styles.cellExpanded, selected && styles.cellSelected]}>
                  <Pressable accessibilityRole="button" accessibilityState={{ selected }} aria-pressed={selected} accessibilityLabel={`${formatDayLabel(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${today ? ', today' : ''}, ${entries.length} ${entries.length === 1 ? 'session' : 'sessions'}`} onPress={() => onSelect(key)} style={({ pressed, hovered }) => [styles.dayButton, (pressed || hovered) && styles.cellPressed]}>
                    <View style={[styles.dateCircle, today && styles.dateToday, selected && styles.dateSelected]}>
                      <Text style={[styles.dateText, weekday === 0 && styles.sunday, weekday === 6 && styles.saturday, outside && styles.dateOutside, today && styles.dateTodayText, selected && styles.dateSelectedText]}>{Number(key.slice(8))}</Text>
                    </View>
                  </Pressable>
                  <View pointerEvents="box-none" style={styles.previews}>
                    {entries.slice(0, 3).map((entry) => {
                      const color = kindColor(entry.kind, isDark);
                      const cancelled = entry.status === 'cancelled';
                      return (
                        <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={`${entry.title}, ${formatTime(entry.startsAt)}${cancelled ? ', cancelled' : ''}`} onPress={() => { onSelect(key); onOpenEntry?.(entry); }} style={({ pressed }) => [styles.preview, expanded && styles.previewExpanded, { backgroundColor: cancelled ? `${color}22` : color }, pressed && styles.pressed]}>
                          <Text numberOfLines={1} ellipsizeMode="clip" style={[styles.previewText, expanded && styles.previewTextExpanded, { color: cancelled ? color : isDark || entry.kind === 'open_play' ? '#0E2321' : '#FFFFFF' }, cancelled && styles.cancelled]}>{entry.title}</Text>
                        </Pressable>
                      );
                    })}
                    {entries.length > 3 ? <Pressable accessibilityRole="button" accessibilityLabel={`Show all ${entries.length} sessions on ${formatDayLabel(key)}`} onPress={() => onSelect(key)} style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}><Text style={styles.more}>+{entries.length - 3} more</Text></Pressable> : null}
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const C = LIGHT_CONTENT_COLORS;
const lightStyles = StyleSheet.create({
  calendar: { padding: 8, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, overflow: 'hidden' },
  calendarExpanded: { padding: 22 },
  heading: { paddingHorizontal: 6, paddingTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { color: C.ink, fontSize: 21, lineHeight: 28, fontWeight: '800', letterSpacing: -.6 },
  titleExpanded: { fontSize: 24, lineHeight: 32 },
  subtitle: { marginTop: 5, color: C.ink40, fontSize: 12, lineHeight: 18 },
  todayButton: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  todayButtonText: { color: C.teal, fontSize: 12, fontWeight: '800' },
  toolbar: { marginTop: 18, paddingHorizontal: 6, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  viewToggle: { flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: C.paper },
  viewButton: { minHeight: 40, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 9 },
  viewButtonActive: { backgroundColor: C.surface, shadowColor: C.ink, shadowOpacity: .06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  viewText: { color: C.ink40, fontSize: 11, fontWeight: '700' },
  viewTextActive: { color: C.ink },
  navigation: { flexDirection: 'row', gap: 4 },
  navButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.paper },
  weekdays: { flexDirection: 'row', paddingBottom: 10 },
  weekday: { flex: 1, color: C.ink40, textAlign: 'center', fontSize: 11, lineHeight: 18, fontWeight: '700' },
  grid: { marginHorizontal: -4 },
  weekRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  cell: { flex: 1, minWidth: 0, minHeight: 118, paddingHorizontal: 1, paddingBottom: 8 },
  cellExpanded: { minHeight: 144, paddingHorizontal: 2, paddingBottom: 12 },
  cellSelected: { backgroundColor: C.tealWash },
  dayButton: { ...StyleSheet.absoluteFillObject, alignItems: 'center', paddingTop: 6 },
  cellPressed: { backgroundColor: C.tealWash },
  dateCircle: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: 'transparent' },
  dateToday: { borderColor: C.teal },
  dateSelected: { backgroundColor: C.ink, borderColor: C.ink },
  dateText: { color: C.ink, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sunday: { color: '#C33F46' },
  saturday: { color: '#3869CF' },
  dateOutside: { color: C.ink40, fontWeight: '500' },
  dateTodayText: { color: C.teal, fontWeight: '900' },
  dateSelectedText: { color: '#FFFFFF', fontWeight: '800' },
  previews: { width: '100%', minWidth: 0, marginTop: 42, gap: 3 },
  preview: { minWidth: 0, minHeight: 18, paddingHorizontal: 2, overflow: 'hidden', paddingVertical: 2, justifyContent: 'center', borderRadius: 4 },
  previewExpanded: { minHeight: 22, paddingHorizontal: 6 },
  previewText: { fontSize: 9, lineHeight: 14, fontWeight: '700', ...(Platform.OS === 'web' ? { textOverflow: 'clip' } : null) },
  previewTextExpanded: { fontSize: 11, lineHeight: 16 },
  cancelled: { textDecorationLine: 'line-through' },
  moreButton: { minHeight: 20, justifyContent: 'center' },
  more: { color: C.ink70, textAlign: 'center', fontSize: 9, lineHeight: 14, fontWeight: '600' },
  filters: { marginHorizontal: 4, marginBottom: 18 },
  pressed: { opacity: .7 },
});
const darkStyles = {
  ...createDarkStyleSheet(lightStyles),
  dateSelected: { backgroundColor: C.optic, borderColor: C.optic },
  dateSelectedText: { color: C.ink, fontWeight: '800' },
  sunday: { color: '#FF9298' },
  saturday: { color: '#91B4FF' },
};
