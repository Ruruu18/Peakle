import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AppIcon from './AppIcon';
import { webLayout } from '../utils/webLayout';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, LIGHT_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { dateFromDayKey, formatDayLabel, monthGrid, shiftDayKey } from '../services/schedule';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The schedule has its own calendar so the game-creation date and time setup
// can keep its compact picker and existing behavior.
export default function ScheduleCalendar({ monthKey, selectedKey, todayKey, byDay, monthOpen, onToggleMonth, onSelect, onMonth, expanded, kindColor, filters }) {
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
      <View style={styles.weekdays}>{WEEKDAYS.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
      <View style={styles.grid}>
        {Array.from({ length: days.length / 7 }, (_, week) => (
          <View key={days[week * 7]} style={[styles.weekRow, expanded && styles.weekRowExpanded]}>
            {days.slice(week * 7, week * 7 + 7).map((key) => {
              const selected = key === selectedKey;
              const today = key === todayKey;
              const outside = monthOpen && !key.startsWith(monthKey);
              const entries = (byDay[key] || []).slice().sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
              const kinds = [...new Set(entries.map((entry) => entry.kind))];
              return (
                <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected }} aria-pressed={selected} accessibilityLabel={`${formatDayLabel(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${today ? ', today' : ''}, ${entries.length} ${entries.length === 1 ? 'session' : 'sessions'}`} onPress={() => onSelect(key)} style={({ pressed, hovered }) => [styles.cell, !monthOpen && styles.cellWeek, expanded && styles.cellExpanded, selected && styles.cellSelected, (pressed || hovered) && styles.cellPressed]}>
                  <View style={[styles.dateCircle, today && styles.dateToday, selected && styles.dateSelected]}>
                    <Text style={[styles.dateText, outside && styles.dateOutside, today && styles.dateTodayText, selected && styles.dateSelectedText]}>{Number(key.slice(8))}</Text>
                  </View>
                  {expanded ? (
                    <View style={styles.previews}>
                      {entries.slice(0, 2).map((entry) => <View key={entry.id} style={[styles.preview, { borderLeftColor: kindColor(entry.kind, isDark) }]}><Text numberOfLines={1} style={[styles.previewText, entry.status === 'cancelled' && styles.cancelled]}>{entry.title}</Text></View>)}
                      {entries.length > 2 ? <Text style={styles.more}>+{entries.length - 2} more</Text> : null}
                    </View>
                  ) : (
                    <View style={styles.markers}>{kinds.slice(0, 4).map((kind) => <View key={kind} style={[styles.dot, { backgroundColor: kindColor(kind, isDark) }]} />)}</View>
                  )}
                </Pressable>
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
  calendar: { padding: 12, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  calendarExpanded: { padding: 22 },
  heading: { paddingHorizontal: 4, paddingTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { color: C.ink, fontSize: 21, lineHeight: 28, fontWeight: '800', letterSpacing: -.6 },
  titleExpanded: { fontSize: 24, lineHeight: 32 },
  subtitle: { marginTop: 5, color: C.ink40, fontSize: 12, lineHeight: 18 },
  todayButton: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  todayButtonText: { color: C.teal, fontSize: 12, fontWeight: '800' },
  toolbar: { marginTop: 22, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  viewToggle: { flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: C.paper },
  viewButton: { minHeight: 40, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 9 },
  viewButtonActive: { backgroundColor: C.surface, shadowColor: C.ink, shadowOpacity: .06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  viewText: { color: C.ink40, fontSize: 11, fontWeight: '700' },
  viewTextActive: { color: C.ink },
  navigation: { flexDirection: 'row', gap: 4 },
  navButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.paper },
  weekdays: { flexDirection: 'row', paddingBottom: 12 },
  weekday: { flex: 1, color: C.ink40, textAlign: 'center', fontSize: 11, lineHeight: 18, fontWeight: '700' },
  grid: { gap: 4 },
  weekRow: { flexDirection: 'row' },
  weekRowExpanded: { borderTopWidth: 1, borderTopColor: C.line },
  cell: { flex: 1, minWidth: 0, minHeight: 54, paddingTop: 6, paddingBottom: 6, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
  cellExpanded: { minHeight: 112, paddingHorizontal: 4, paddingTop: 10, paddingBottom: 10, borderRadius: 10 },
  cellWeek: { minHeight: 72 },
  cellSelected: { backgroundColor: C.tealWash, borderColor: C.teal },
  cellPressed: { backgroundColor: C.tealWash },
  dateCircle: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: 'transparent' },
  dateToday: { borderColor: C.teal },
  dateSelected: { backgroundColor: C.ink, borderColor: C.ink },
  dateText: { color: C.ink, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dateOutside: { color: C.ink40, fontWeight: '500' },
  dateTodayText: { color: C.teal, fontWeight: '900' },
  dateSelectedText: { color: '#FFFFFF', fontWeight: '800' },
  markers: { height: 7, marginTop: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  previews: { width: '100%', minWidth: 0, marginTop: 8, gap: 4 },
  preview: { minWidth: 0, paddingHorizontal: 4, paddingVertical: 3, borderLeftWidth: 2, borderRadius: 4, backgroundColor: C.paper },
  previewText: { color: C.ink70, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  cancelled: { textDecorationLine: 'line-through', opacity: .6 },
  more: { paddingLeft: 3, color: C.ink40, fontSize: 10, lineHeight: 14, fontWeight: '700' },
  filters: { marginBottom: 20 },
  pressed: { opacity: .7 },
});
const darkStyles = {
  ...createDarkStyleSheet(lightStyles),
  dateSelected: { backgroundColor: C.optic, borderColor: C.optic },
  dateSelectedText: { color: C.ink, fontWeight: '800' },
};
