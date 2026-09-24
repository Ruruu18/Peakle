import Modal from '../components/ResponsiveModal';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import AppIcon from '../components/AppIcon';
import Svg, { Circle } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { listMyMatches, listTeams } from '../services/database';
import { getNearbyLiveMatch } from '../services/nearbyPlayers';
import { getPlayerFollowCounts } from '../services/directMessages';
import ProfilePhoto from '../components/ProfilePhoto';
import ProfilePhotoPicker from '../components/ProfilePhotoPicker';
import NotificationSheet from '../components/NotificationSheet';
import ScrollView from '../components/FocusResetScrollView';
import useResponsiveWidth from '../hooks/useResponsiveWidth';
import { webLayout, webDialog } from '../utils/webLayout';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { useOperations } from '../context/OperationsContext';
import { useOrganizerPass } from '../context/OrganizerPassContext';
import { presentNotification } from '../utils/notifications';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import { reverseGeocode } from '../utils/geocode';
import { PH_LOCATIONS, formatLocation, locationMatchesSearch, parseLocation } from '../data/phLocations';
import { peekCachedData, readCachedData, withTimeout, writeCachedData } from '../lib/asyncData';
import { profileScreenCacheKey } from '../lib/cacheKeys';
import { supabase } from '../lib/supabase';

const LIGHT_C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', error: '#A63B2B', ink70: '#3C4A45',
  ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED', brickWash: '#F7EAE6',
};
const PRESENCE_OPTIONS = [
  { value: 'free', label: 'Active / free', detail: 'Open to match invitations', color: '#68B96B' },
  { value: 'away', label: 'Away', detail: 'Not accepting invitations', color: '#D49A32' },
  { value: 'in_play', label: 'In play', detail: 'Currently on court', color: '#2F80ED' },
];

function presenceOption(value) {
  return PRESENCE_OPTIONS.find((option) => option.value === value) || PRESENCE_OPTIONS[0];
}
function formatSocialCount(value) {
  const count = Math.max(0, Number(value) || 0);
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace('.0', '')}K`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0).replace('.0', '')}M`;
}
let C = LIGHT_C;
const ORGANIZER_PORTAL_URL = (process.env.EXPO_PUBLIC_ORGANIZER_PORTAL_URL || 'https://organizer.peakle.app').replace(/\/+$/, '');

function Icon({ name, size = 20, color = C.ink }) {
  return <AppIcon name={name} size={size} color={color} />;
}

function KitchenLine({ quiet = false, style }) {
  return <View style={[styles.kitchen, style]}><View style={[styles.solid, quiet && styles.solidQuiet]} /><View style={[styles.dashed, quiet && styles.dashedQuiet]} /></View>;
}

function Toggle({ value, onChange, label }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={[styles.toggle, value && styles.toggleOn]}>
      <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
    </Pressable>
  );
}

function OrganizerPortalShortcut({ onOpen }) {
  return (
    <View style={styles.organizerPortalCard}>
      <View style={styles.organizerPortalHead}><View style={styles.organizerPortalIcon}><Icon name="desktop-outline" size={20} color="#0E2321" /></View><View style={styles.flex}><Text style={styles.organizerPortalEyebrow}>ORGANIZER TOOLS</Text><Text style={styles.organizerPortalTitle}>Continue on the web portal</Text></View><Pressable accessibilityRole="link" accessibilityLabel="Open organizer portal" onPress={() => onOpen('/overview')} style={styles.organizerPortalOpen}><Icon name="open-outline" size={18} color="#0E2321" /></Pressable></View>
      <Text style={styles.organizerPortalBody}>The mobile app stays focused on playing. Use the same Peakle account for venue operations.</Text>
      <View style={styles.organizerShortcutRow}>
        <Pressable accessibilityRole="link" onPress={() => onOpen('/overview')} style={styles.organizerShortcut}><Icon name="grid-outline" size={16} color={C.teal} /><Text style={styles.organizerShortcutText}>Portal</Text></Pressable>
        <Pressable accessibilityRole="link" onPress={() => onOpen('/monitor')} style={styles.organizerShortcut}><Icon name="pulse-outline" size={16} color={C.teal} /><Text style={styles.organizerShortcutText}>Live monitor</Text></Pressable>
        <Pressable accessibilityRole="link" onPress={() => onOpen('/players')} style={styles.organizerShortcut}><Icon name="people-outline" size={16} color={C.teal} /><Text style={styles.organizerShortcutText}>Players</Text></Pressable>
      </View>
    </View>
  );
}

function Sheet({ visible, title, eyebrow, onClose, children, fullHeight = false }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View {...webDialog('backdrop')} style={styles.backdrop}>
        <Pressable accessibilityLabel="Close modal backdrop" onPress={onClose} style={styles.backdropDismiss} />
        <View {...webDialog('surface')} style={[styles.sheet, fullHeight && styles.sheetTall]}>
          <View {...webDialog('handle')} style={styles.handle} />
          <View style={styles.sheetHeader}><View style={styles.flex}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.sheetTitle}>{title}</Text></View><Pressable accessibilityLabel="Close" hitSlop={10} onPress={onClose} style={styles.iconButton}><Icon name="close" size={22} /></Pressable></View>
          <KitchenLine quiet style={styles.sheetLine} />
          <View style={[styles.sheetBody, fullHeight && styles.sheetBodyScrollable]}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}

function Overview({ matches, onAchievement, onSeeMatches, onMatch, onStartFocus }) {
  const wins = matches.filter((match) => match.result === 'W').length;
  const winRate = matches.length ? Math.round((wins / matches.length) * 100) : 0;
  const currentStreak = matches.findIndex((match) => match.result !== 'W');
  const winStreak = currentStreak === -1 ? matches.length : currentStreak;
  let runningStreak = 0;
  const personalBest = matches.reduce((best, match) => {
    runningStreak = match.result === 'W' ? runningStreak + 1 : 0;
    return Math.max(best, runningStreak);
  }, 0);

  const radius = (96 - 7) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (winRate / 100) * circumference;

  return (
    <>
      <View style={styles.statCard}>
        <View style={styles.ring}>
          <Svg style={{ position: 'absolute' }} width={96} height={96}>
            <Circle stroke={C.line} fill="none" cx={48} cy={48} r={radius} strokeWidth={7} />
            <Circle stroke={C.optic} fill="none" cx={48} cy={48} r={radius} strokeWidth={7} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" originX={48} originY={48} rotation="-90" />
          </Svg>
          <View style={styles.ringInner}><Text style={styles.ringValue}>{winRate}<Text style={styles.ringPercent}>%</Text></Text><Text style={styles.statLabel}>WIN RATE</Text></View>
        </View>
        <View style={styles.statBlock}><Text style={styles.statValue}>{matches.length}</Text><Text style={styles.statLabel}>MATCHES</Text><Text style={styles.statMeta}>{matches.filter((item) => item.type.startsWith('Ranked')).length} ranked</Text></View>
        <View style={styles.statDivider} />
        <View style={styles.statBlock}><Text style={styles.statValue}>{winStreak}</Text><Text style={styles.statLabel}>WIN STREAK</Text><Text style={styles.statMeta} numberOfLines={1}>PB · {personalBest}</Text></View>
      </View>
      <View style={styles.sectionHeader}><View><Text style={styles.eyebrow}>RECENT FORM</Text><Text style={styles.h2}>Last matches</Text></View><Pressable onPress={onSeeMatches}><Text style={styles.link}>See all</Text></Pressable></View>
      {matches.length ? <View style={styles.matchCard}>{matches.slice(0, 3).map((match, index) => <MatchRow key={match.id} match={match} border={index > 0} onPress={() => onMatch(match)} />)}</View> : <View style={styles.empty}><Icon name="tennisball-outline" size={38} color={C.teal} /><Text style={styles.emptyTitle}>No recorded matches</Text><Text style={styles.settingDetail}>Complete and save a match to start your record.</Text></View>}
    </>
  );
}

function MatchRow({ match, border, onPress }) {
  const won = match.result === 'W';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open box score against ${match.opponent}`} onPress={onPress} style={({ pressed }) => [styles.matchRow, border && styles.rowBorder, pressed && styles.pressed]}>
      <View style={[styles.result, won ? styles.resultWin : styles.resultLoss]}><Text style={[styles.resultText, !won && styles.resultTextLoss]}>{match.result}</Text></View>
      <View style={styles.matchCopy}><Text numberOfLines={1} style={styles.matchOpponent}>vs. {match.opponent}</Text><Text numberOfLines={1} style={styles.matchMeta}>{match.type}{match.partner ? ` · with ${match.partner.split(' ')[0]}` : ''}</Text><Text numberOfLines={1} style={[styles.matchLearning, won ? styles.positive : styles.negative]}>{won ? 'Strength' : 'Review'} · {match.takeaway}</Text></View>
      <View style={styles.scoreCopy}><Text style={styles.matchScore}>{match.score.split(',')[0]}</Text><Text style={styles.matchDate}>{match.date}</Text></View>
      <Text style={[styles.ratingChange, match.rating.startsWith('+') ? styles.positive : match.rating.startsWith('−') || match.rating.startsWith('-') ? styles.negative : styles.muted]}>{match.rating}</Text>
      <Icon name="chevron-forward" size={14} color={C.ink40} />
    </Pressable>
  );
}

function History({ source, onMatch }) {
  const [filter, setFilter] = useState('All');
  const matches = useMemo(() => source.filter((item) => filter === 'All' || item.result === filter), [source, filter]);
  const recent = source.slice(0, 5);
  const recentWins = recent.filter((item) => item.result === 'W').length;
  const recentLosses = recent.filter((item) => item.result === 'L').length;
  return (
    <View>
      <View style={styles.historySummary}><View><Text style={styles.eyebrow}>ALL TIME</Text><Text style={styles.h2}>{source.length} recorded matches</Text></View><View style={styles.record}><Text style={styles.recordValue}>{source.filter((item) => item.result === 'W').length}–{source.filter((item) => item.result === 'L').length}</Text><Text style={styles.statLabel}>RECORD</Text></View></View>
      <View style={styles.patternCard}>
        <View style={styles.patternHead}><View><Text style={styles.eyebrow}>LAST {recent.length || 0} MATCHES</Text><Text style={styles.patternTitle}>Recent recorded form</Text></View><Text style={styles.formRecord}>{recentWins}–{recentLosses}</Text></View>
        <View style={styles.recentForm}>{recent.map((match) => <View key={match.id} style={[styles.result, match.result === 'W' ? styles.resultWin : styles.resultLoss]}><Text style={[styles.resultText, match.result !== 'W' && styles.resultTextLoss]}>{match.result}</Text></View>)}</View>
        <Text style={styles.patternCopy}>{recent.length ? 'This summary uses only completed matches saved to your account.' : 'No completed matches have been saved yet.'}</Text>
      </View>
      <View style={styles.filters}>{[['All', 'All'], ['Wins', 'W'], ['Losses', 'L']].map(([label, value]) => <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filter, filter === value && styles.filterActive]}><Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{label}</Text></Pressable>)}</View>
      <View style={styles.matchCard}>{matches.map((match, index) => <MatchRow key={match.id} match={match} border={index > 0} onPress={() => onMatch(match)} />)}</View>
      <Text style={styles.endNote}>Showing your latest recorded matches.</Text>
    </View>
  );
}

function BoxScore({ match, playerName }) {
  const [rallies, setRallies] = useState(null);
  useEffect(() => {
    setRallies(null);
    if (!match?.id) return undefined;
    let cancelled = false;
    getNearbyLiveMatch(match.id).then((session) => {
      if (cancelled) return;
      const rallyLog = session?.state?.finalResult?.rallyLog || session?.state?.rallyLog || [];
      setRallies(rallyLog);
    }).catch(() => { if (!cancelled) setRallies([]); });
    return () => { cancelled = true; };
  }, [match?.id]);
  if (!match) return null;
  const games = match.score.split(',').map((game) => game.trim().split(/[–-]/).map(Number));
  const savedPlayerName = playerName?.trim() || 'Player';
  const yourName = match.partner ? `${savedPlayerName.split(/\s+/)[0]} & ${match.partner.split(' ')[0]}` : savedPlayerName;
  const yourTotal = games.reduce((total, game) => total + game[0], 0);
  const opponentTotal = games.reduce((total, game) => total + game[1], 0);
  const yourGames = games.filter((game) => game[0] > game[1]).length;
  const opponentGames = games.length - yourGames;
  return (
    <ScrollView
      style={styles.boxScroll}
      contentContainerStyle={styles.boxContent}
      showsVerticalScrollIndicator={false}
      alwaysBounceVertical
      directionalLockEnabled
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.boxResult, match.result === 'L' && styles.boxResultLoss]}><View><Text style={styles.boxResultLabel}>{match.result === 'W' ? 'WIN' : 'LOSS'} · {match.date}</Text><Text style={styles.boxResultScore}>{yourGames}–{opponentGames}</Text></View><View style={styles.boxResultMeta}><Text style={styles.boxType}>{match.type}</Text><Text style={styles.boxRating}>{match.rating === '—' ? 'Unrated' : `${match.rating} rating`}</Text></View></View>
      <View style={styles.boxVenue}><Icon name="location-outline" size={17} color={C.teal} /><Text style={styles.boxVenueText}>{match.venue}</Text></View>
      <View style={[styles.takeawayCard, match.result === 'L' && styles.takeawayCardLoss]}>
        <View style={[styles.takeawayIcon, match.result === 'L' && styles.takeawayIconLoss]}><Icon name={match.result === 'W' ? 'sparkles-outline' : 'search-outline'} size={19} color={match.result === 'W' ? C.teal : C.brick} /></View>
        <View style={styles.flex}><Text style={[styles.takeawayLabel, match.result === 'L' && styles.negative]}>{match.result === 'W' ? 'WHY YOU WON' : 'WHAT DECIDED IT'}</Text><Text style={styles.takeawayTitle}>{match.takeaway}</Text><Text style={styles.takeawayCopy}>{match.improve}</Text></View>
      </View>
      <View style={styles.boxTable}>
        <View style={styles.boxHeaderRow}><Text style={[styles.boxHeaderCell, styles.boxTeamCell]}>TEAM</Text>{games.map((_, index) => <Text key={index} style={styles.boxHeaderCell}>G{index + 1}</Text>)}<Text style={styles.boxHeaderCell}>PTS</Text></View>
        <View style={styles.boxTeamRow}><View style={styles.boxTeamCell}><Text numberOfLines={1} style={styles.boxTeamName}>{yourName}</Text><Text style={styles.boxTeamTag}>YOU</Text></View>{games.map((game, index) => <Text key={index} style={[styles.boxScoreCell, game[0] > game[1] && styles.boxWinningScore]}>{game[0]}</Text>)}<Text style={styles.boxTotal}>{yourTotal}</Text></View>
        <View style={[styles.boxTeamRow, styles.boxOpponentRow]}><View style={styles.boxTeamCell}><Text numberOfLines={1} style={styles.boxTeamName}>{match.opponent}</Text><Text style={styles.boxOpponentTag}>OPPONENT</Text></View>{games.map((game, index) => <Text key={index} style={[styles.boxScoreCell, game[1] > game[0] && styles.boxWinningScore]}>{game[1]}</Text>)}<Text style={styles.boxTotal}>{opponentTotal}</Text></View>
      </View>
      <Text style={styles.boxSectionLabel}>MATCH STATS</Text>
      <View style={styles.boxStats}><View style={[styles.boxStat, styles.boxStatLast]}><Icon name="time-outline" color={C.teal} /><Text style={styles.boxStatValue}>{match.duration}</Text><Text style={styles.boxStatLabel}>DURATION</Text></View>{match.longestRally != null ? <View style={styles.boxStat}><Icon name="flash-outline" color={C.teal} /><Text style={styles.boxStatValue}>{match.longestRally}</Text><Text style={styles.boxStatLabel}>LONGEST RALLY</Text></View> : null}{match.sideOuts != null ? <View style={[styles.boxStat, styles.boxStatLast]}><Icon name="repeat-outline" color={C.teal} /><Text style={styles.boxStatValue}>{match.sideOuts}</Text><Text style={styles.boxStatLabel}>SIDE-OUTS</Text></View> : null}</View>
      {match.serveWon != null && match.returnWon != null && match.kitchenWon != null ? <><Text style={styles.boxSectionLabel}>YOUR PERFORMANCE</Text><View style={styles.performanceCard}><PerformanceRow label="Serve points won" value={match.serveWon} target={60} /><PerformanceRow label="Return points won" value={match.returnWon} target={55} /><PerformanceRow label="Kitchen points won" value={match.kitchenWon} target={55} />{match.errors != null ? <View style={styles.errorRow}><Text style={styles.performanceName}>Unforced errors</Text><Text style={[styles.performanceVerdict, match.errors > 10 && styles.performanceBelow]}>{match.errors}</Text></View> : null}</View></> : null}
      <View style={styles.coachCard}><Text style={styles.coachStep}>DO THIS NEXT</Text><Text style={styles.coachTitle}>{match.improve}</Text><Text style={styles.coachMeta}>Use this as your one goal in the next recorded match.</Text></View>
      {rallies?.length ? <>
        <Text style={styles.boxSectionLabel}>RALLY HISTORY</Text>
        <View style={styles.boxTable}>{rallies.map((rally, index) => <View key={rally.id || index} style={[styles.rallyHistoryRow, index > 0 && styles.boxOpponentRow]}><View style={styles.rallyHistoryNumber}><Text style={styles.rallyHistoryNumberText}>{rally.number || index + 1}</Text></View><View style={styles.flex}><Text numberOfLines={1} style={styles.rallyHistoryResult}>{rally.winner} · {rally.action}</Text><Text numberOfLines={1} style={styles.rallyHistoryServe}>{rally.nextServe}</Text></View><Text style={styles.rallyHistoryScore}>{rally.score?.[0]}–{rally.score?.[1]}</Text></View>)}</View>
      </> : null}
      <View style={styles.boxNote}><Icon name="information-circle-outline" size={17} color={C.teal} /><Text style={styles.boxNoteText}>Only values recorded with this completed match are shown.</Text></View>
    </ScrollView>
  );
}

function PerformanceRow({ label, value, target }) {
  const onTarget = value >= target;
  return (
    <View style={styles.performanceRow}>
      <View style={styles.performanceCopy}><Text style={styles.performanceName}>{label}</Text><Text style={styles.performanceTarget}>Target {target}%</Text></View>
      <View style={styles.performanceBar}><View style={[styles.performanceFill, { width: `${value}%` }, !onTarget && styles.performanceFillBelow]} /></View>
      <View style={styles.performanceResult}><Text style={[styles.performanceValue, !onTarget && styles.negative]}>{value}%</Text><Text style={[styles.performanceVerdict, !onTarget && styles.performanceBelow]}>{onTarget ? 'On track' : 'Needs work'}</Text></View>
    </View>
  );
}

function SettingRow({ icon, title, detail, value, onToggle, onPress, destructive = false, border = true }) {
  return (
    <Pressable onPress={onPress || (onToggle ? () => onToggle(!value) : undefined)} style={[styles.settingRow, border && styles.rowBorder]}>
      <View style={[styles.settingIcon, destructive && styles.settingIconDanger]}><Icon name={icon} size={19} color={destructive ? C.error : C.teal} /></View>
      <View style={styles.settingCopy}><Text style={[styles.settingTitle, destructive && styles.danger]}>{title}</Text>{detail && <Text style={styles.settingDetail}>{detail}</Text>}</View>
      {onToggle ? <Toggle label={title} value={value} onChange={onToggle} /> : <Icon name="chevron-forward" size={18} color={C.ink40} />}
    </Pressable>
  );
}

function formatLastLogin(isoString) {
  if (!isoString) return 'Never recorded';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 2) return 'Just now';
  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Settings({ preferences, setPreference, onAction, lastLogin }) {
  return (
    <View>
      <Text style={styles.settingsLabel}>PREFERENCES</Text>
      <View style={styles.settingsCard}>
        {Platform.OS !== 'web' ? <SettingRow icon="chatbubble-ellipses-outline" title="Message notifications" detail="Lock-screen delivery, quick reply, and device test" onPress={() => onAction('Message notifications')} border={false} /> : <Text style={styles.footText}>Updates appear here while Peakle is open.</Text>}
        <SettingRow icon="notifications-outline" title="Squad notifications" detail="Challenges, invites, and team updates" value={preferences.squad} onToggle={(value) => setPreference('squad', value)} />
        <SettingRow icon="calendar-outline" title="Match reminders" detail="One hour before every match" value={preferences.reminders} onToggle={(value) => setPreference('reminders', value)} />
        <SettingRow icon="sync-outline" title="Calendar sync" detail={preferences.calendar ? 'Syncing with your calendar' : 'Not connected'} value={preferences.calendar} onToggle={(value) => setPreference('calendar', value)} />
      </View>
      <Text style={styles.settingsLabel}>ACCOUNT & PLAY</Text>
      <View style={styles.settingsCard}>
        <SettingRow icon="person-outline" title="Account details" detail="Name, email, and location" onPress={() => onAction('Edit profile')} border={false} />
        <SettingRow icon="shield-checkmark-outline" title="Privacy & matching" detail="Competitive profile, availability and player discovery" onPress={() => onAction('Privacy & matching')} />
        <SettingRow icon="receipt-outline" title="Payment history" detail="Your booking receipts and refunds" onPress={() => onAction('Payment history')} />
        <SettingRow icon="analytics-outline" title="Performance rating" detail="Calculated from completed match scores" onPress={() => onAction('Performance rating')} />
        <SettingRow icon="time-outline" title="Last active" detail={formatLastLogin(lastLogin)} />
      </View>
      <Text style={styles.settingsLabel}>SUPPORT</Text>
      <View style={styles.settingsCard}>
        <SettingRow icon="help-circle-outline" title="Help and support" onPress={() => onAction('Help and support')} border={false} />
        <SettingRow icon="document-text-outline" title="Privacy policy" detail="How Peakle handles your data" onPress={() => onAction('Privacy policy')} />
        <SettingRow icon="reader-outline" title="Terms of service" onPress={() => onAction('Terms of service')} />
        <SettingRow icon="trash-outline" title="Delete account" detail="Permanently remove your account and personal data" destructive onPress={() => onAction('Delete account')} />
        <SettingRow icon="log-out-outline" title="Log out" destructive onPress={() => onAction('Log out')} />
      </View>
      <Text style={styles.version}>PEAKLE · VERSION 1.0.0</Text>
    </View>
  );
}

// ─── Philippine cities / municipalities (curated) ───────────────────────────
// ─── LocationPicker (structured: City · Region · Country) ───────────────────
function LocationPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);

  // Parse the stored value (e.g. "Butuan · Region XIII · Philippines")
  const parsed = useMemo(() => parseLocation(value), [value]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PH_LOCATIONS.slice(0, 10);
    return PH_LOCATIONS.filter((loc) => locationMatchesSearch(loc, q)).slice(0, 8);
  }, [query]);

  const openSheet = () => { setQuery(''); setOpen(true); };
  const closeSheet = () => { setOpen(false); setQuery(''); };
  const selectLoc = (loc) => { onChange(formatLocation(loc)); closeSheet(); };

  const detectLocation = async () => {
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setGpsLoading(false); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const geo = await reverseGeocode({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      if (geo) {
        const detectedCity = geo.city || geo.subregion || '';
        const match = PH_LOCATIONS.find(
          (loc) => loc.city.toLowerCase() === detectedCity.toLowerCase()
        );
        if (match) {
          selectLoc(match);
        } else {
          // Fallback: build from GPS data
          onChange(`${detectedCity} · ${geo.region || ''} · ${geo.country || 'Philippines'}`);
          closeSheet();
        }
      }
    } catch (_) { /* silently ignore */ }
    finally { setGpsLoading(false); }
  };

  return (
    <>
      {/* ── Trigger chip ───────────────────────────────────── */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Change location, currently ${value || 'not set'}`}
        onPress={openSheet}
        style={({ pressed }) => [styles.locTrigger, pressed && styles.locTriggerPressed]}
      >
        <View style={styles.locTriggerIcon}>
          <Ionicons name="location" size={17} color={C.teal} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.locTriggerEyebrow}>HOME AREA</Text>
          {parsed ? (
            <>
              <Text numberOfLines={1} style={styles.locTriggerCity}>{parsed.city}</Text>
              <Text numberOfLines={1} style={styles.locTriggerMeta}>{parsed.region}{parsed.country ? ` · ${parsed.country}` : ''}</Text>
            </>
          ) : (
            <Text style={styles.locTriggerPlaceholder}>Tap to set your location</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={16} color={C.teal} />
      </Pressable>

      {/* ── Bottom-sheet modal ─────────────────────────────── */}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}
        statusBarTranslucent
      >
        <View {...webDialog('backdrop')} style={styles.locModalBackdrop}>
          <Pressable style={styles.locModalDismiss} onPress={closeSheet} />
          <View {...webDialog('surface')} style={styles.locSheet}>
            <View {...webDialog('handle')} style={styles.locHandle} />

            {/* Header */}
            <View style={styles.locHeader}>
              <View style={styles.flex}>
                <Text style={styles.locHeaderEyebrow}>YOUR SEARCH AREA</Text>
                <Text style={styles.locHeaderTitle}>Change location</Text>
              </View>
              <Pressable onPress={closeSheet} style={styles.locCloseBtn}>
                <Ionicons name="close" size={20} color="#FFFFFF" />
              </Pressable>
            </View>

            {/* Currently using */}
            {Boolean(parsed) && (
              <View style={styles.locCurrentCard}>
                <View style={styles.locCurrentIcon}>
                  <Ionicons name="location" size={20} color={C.teal} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.locCurrentLabel}>CURRENTLY USING</Text>
                  <Text style={styles.locCurrentCity}>{parsed.city}</Text>
                  <Text style={styles.locCurrentMeta}>{parsed.region}{parsed.country ? ` · ${parsed.country}` : ''}</Text>
                </View>
              </View>
            )}

            {/* GPS button */}
            <Pressable
              onPress={detectLocation}
              disabled={gpsLoading}
              style={({ pressed }) => [styles.locGpsBtn, pressed && { opacity: 0.85 }]}
            >
              {gpsLoading
                ? <ActivityIndicator color={C.ink} size="small" />
                : <Ionicons name="navigate" size={20} color={C.ink} />
              }
              <View style={styles.flex}>
                <Text style={styles.locGpsBtnTitle}>Use my exact location</Text>
                <Text style={styles.locGpsBtnSub}>Uses your device GPS while the app is open.</Text>
              </View>
            </Pressable>

            {/* Divider */}
            <Text style={styles.locOrLabel}>OR SEARCH ANYWHERE</Text>

            {/* Search row */}
            <View style={styles.locSearchRow}>
              <Ionicons name="search-outline" size={18} color="rgba(255,255,255,0.45)" style={{ marginLeft: 14 }} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="City or region…"
                placeholderTextColor="rgba(255,255,255,0.3)"
                style={styles.locSearchInput}
                returnKeyType="search"
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery('')} style={styles.locSearchClear}>
                  <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.4)" />
                </Pressable>
              )}
            </View>

            {/* Results */}
            {suggestions.length > 0 && (
              <View style={styles.locResults}>
                {suggestions.map((loc, index) => {
                  const isActive = parsed?.city === loc.city && parsed?.region === loc.region;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: isActive }}
                      key={`${loc.city}-${loc.region}`}
                      onPress={() => selectLoc(loc)}
                      style={({ pressed, hovered }) => [
                        styles.locResultRow,
                        index > 0 && styles.locResultBorder,
                        isActive && styles.locResultActive,
                        (pressed || hovered) && styles.locResultHovered,
                      ]}
                    >
                      <Ionicons name="location-outline" size={16} color="rgba(255,255,255,0.4)" />
                      <View style={styles.flex}>
                        <Text style={styles.locResultCity}>{loc.city}</Text>
                        <Text style={styles.locResultMeta}>{loc.region} · {loc.country}</Text>
                      </View>
                      {isActive && <Ionicons name="checkmark-circle" size={18} color={C.teal} />}
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Text style={styles.locPrivacyNote}>
              Your coordinates stay on this device unless you separately turn on Nearby Player visibility.
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}


function EditProfile({ visible, player, onClose, onSave, isDark }) {
  const [name, setName] = useState(player.name);
  const [location, setLocation] = useState(player.location);
  const [avatar, setAvatar] = useState(player.avatar);
  const [preference, setPreference] = useState(player.preference);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    if (visible) {
      setName(player.name);
      setLocation(player.location);
      setAvatar(player.avatar);
      setPreference(player.preference || 'Doubles');
      setError('');
      setIsSaving(false);
    }
  }, [visible, player]);
  const hasChanges = name.trim() !== player.name
    || location.trim() !== player.location
    || (avatar || '') !== (player.avatar || '')
    || preference !== (player.preference || 'Doubles');
  const saveDisabled = isSaving || !hasChanges;
  const save = async () => {
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 80) { setError('Display name must be between 2 and 80 characters.'); return; }
    if (!location.trim()) { setError('Home area is required.'); return; }
    setError('');
    setIsSaving(true);
    try {
      await onSave({ name: cleanName, location: location.trim(), avatar, preference });
    } catch (reason) {
      setError(reason.message || 'Profile could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <Sheet fullHeight visible={visible} title="Edit player" eyebrow="YOUR DETAILS" onClose={onClose}>
      <View style={styles.editProfileLayout}>
        <ScrollView
          style={styles.editProfileScroll}
          contentContainerStyle={styles.editProfileContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.editFieldGroup}>
            <Text style={styles.inputLabel}>DISPLAY NAME</Text>
            <TextInput
              accessibilityLabel="Display name"
              value={name}
              onChangeText={(value) => { setName(value); setError(''); }}
              placeholder="Enter your display name"
              placeholderTextColor={C.ink40}
              selectionColor={C.teal}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={80}
              returnKeyType="done"
              style={styles.input}
            />
          </View>
          <View style={styles.editFieldGroup}><LocationPicker value={location} onChange={setLocation} /></View>
          <View style={styles.editFieldGroup}>
            <Text style={styles.inputLabel}>PROFILE PHOTO</Text>
            <ProfilePhotoPicker value={avatar} name={name} onChange={setAvatar} onError={setError} colors={C} dark={isDark} />
          </View>
          <View style={styles.ratingNotice}><Icon name="analytics-outline" color={C.teal} /><Text style={styles.settingDetail}>Your performance rating is earned from completed match scores and cannot be edited manually.</Text></View>
          <View style={[styles.editFieldGroup, styles.editFieldGroupLast]}>
            <Text style={styles.inputLabel}>PLAY PREFERENCE</Text>
            <View style={styles.editChoiceRow}>{['Singles', 'Doubles', 'Both'].map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: preference === value }} accessibilityLabel={`${value} play preference`} onPress={() => { setPreference(value); setError(''); }} style={({ pressed }) => [styles.editChoice, preference === value && styles.editChoiceActive, pressed && styles.pressed]}><Text style={[styles.editChoiceText, preference === value && styles.editChoiceTextActive]}>{value}</Text></Pressable>)}</View>
          </View>
          <View style={styles.editProfileActions}>
            {error ? <Text style={styles.editError}>{error}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={hasChanges ? 'Save profile changes' : 'Save profile changes, currently disabled because nothing changed'} accessibilityState={{ disabled: saveDisabled, busy: isSaving }} disabled={saveDisabled} onPress={save} style={({ pressed }) => [styles.primaryButton, styles.editSaveButton, !hasChanges && styles.editSaveButtonDisabled, isSaving && styles.disabled, pressed && !saveDisabled && styles.pressed]}>{isSaving ? <ActivityIndicator size="small" color="#0E2321" /> : <Icon name="checkmark-circle-outline" color={hasChanges ? '#0E2321' : C.ink40} />}<Text style={[styles.primaryText, !hasChanges && { color: C.ink40 }]}>{isSaving ? 'Saving changes…' : 'Save changes'}</Text></Pressable>
          </View>
        </ScrollView>
      </View>
    </Sheet>
  );
}

function ProfileScreen({ navigation, route }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { user, updateProfile, signOut } = useAuth();
  const { hasOrganizerAccess } = useOrganizerPass();
  const width = useResponsiveWidth();
  const compactPhone = width <= 440;
  const { notifications: operationNotifications, unreadCount, readNotification, readAllNotifications, removeNotification, clearNotifications, respondFollowRequest, enablePushNotifications, disablePushNotifications } = useOperations();
  const dataCacheKey = profileScreenCacheKey(user?.id || 'guest');
  const initialSnapshot = useRef(peekCachedData(dataCacheKey)).current;
  const [tab, setTab] = useState('Overview');
  const [player, setPlayer] = useState({ name: user?.name || 'Player', location: user?.location || '', avatar: user?.picture, skill: user?.skill || '—', preference: user?.preference || 'Doubles', presenceStatus: user?.presenceStatus || 'free' });
  const [editOpen, setEditOpen] = useState(false);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [achievement, setAchievement] = useState(null);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [toast, setToast] = useState('');
  const [preferences, setPreferences] = useState(user?.preferences || { squad: true, reminders: true, calendar: false });
  const [recordedMatches, setRecordedMatches] = useState(() => initialSnapshot?.recordedMatches || []);
  const [joinedTeams, setJoinedTeams] = useState(() => initialSnapshot?.joinedTeams || []);
  const [followCounts, setFollowCounts] = useState(() => initialSnapshot?.followCounts || { followers: 0, following: 0 });
  const notices = useMemo(() => operationNotifications.map(presentNotification), [operationNotifications]);

  useEffect(() => {
    if (user) setPlayer({ name: user.name, location: user.location, avatar: user.picture, skill: user.skill, preference: user.preference, presenceStatus: user.presenceStatus || 'free' });
  }, [user]);

  useEffect(() => {
    if (!supabase || !user?.id) return undefined;
    let active = true;
    let refreshTimer;
    const refreshCounts = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        getPlayerFollowCounts()
          .then((counts) => {
            if (active) setFollowCounts(counts);
          })
          .catch(() => {});
      }, 80);
    };
    const channel = supabase.channel(`profile-follow-counts-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'player_follows',
      }, refreshCounts)
      .subscribe();
    return () => {
      active = false;
      clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    const requestedTab = route.params?.openTab;
    if (['Overview', 'Matches', 'Settings'].includes(requestedTab)) setTab(requestedTab);
  }, [route.params?.openTab, route.params?.openTabToken]);

  useEffect(() => {
    if (route.params?.openNotificationsToken) setNotificationsOpen(true);
  }, [route.params?.openNotificationsToken]);

  const showToast = (message) => { setToast(message); setTimeout(() => setToast(''), 2200); };
  const handleFollowResponse = async (item, accept) => {
    const accepted = await respondFollowRequest(item.data?.requesterId, accept, item.id);
    if (!accepted) return;
    try {
      setFollowCounts(await getPlayerFollowCounts());
    } catch {
      setFollowCounts((current) => ({
        followers: current.followers + 1,
        following: current.following + 1,
      }));
    }
  };
  useEffect(() => {
    let active = true;
    let refreshRunning = false;
    let cacheApplied = Boolean(initialSnapshot);
    const loadProfileData = async () => {
      if (refreshRunning) return;
      refreshRunning = true;
      let cached = peekCachedData(dataCacheKey);
      if (!cacheApplied) {
        cached = await readCachedData(dataCacheKey);
        cacheApplied = true;
        if (active && cached) {
          setRecordedMatches(cached.recordedMatches || []);
          setJoinedTeams(cached.joinedTeams || []);
          setFollowCounts(cached.followCounts || { followers: 0, following: 0 });
        }
      }
      const [matchResult, teamResult, followResult] = await Promise.allSettled([
        withTimeout(listMyMatches(), 12000, 'Match history took too long to refresh.'),
        withTimeout(listTeams(), 12000, 'Teams took too long to refresh.'),
        withTimeout(getPlayerFollowCounts(), 12000, 'Follow counts took too long to refresh.'),
      ]);
      if (!active) return;
      const nextMatches = matchResult.status === 'fulfilled' ? matchResult.value : cached?.recordedMatches || [];
      const nextTeams = teamResult.status === 'fulfilled'
        ? teamResult.value.filter((team) => team.role)
        : cached?.joinedTeams || [];
      const nextFollowCounts = followResult.status === 'fulfilled'
        ? followResult.value
        : cached?.followCounts || { followers: 0, following: 0 };
      if (matchResult.status === 'fulfilled') {
        setRecordedMatches(nextMatches);
        const requestedMatch = route.params?.openMatchId;
        if (requestedMatch) {
          setTab('Matches');
          const match = requestedMatch === 'latest' ? nextMatches[0] : nextMatches.find((item) => item.id === requestedMatch);
          if (match) setSelectedMatch(match);
          else showToast('No completed matches recorded yet.');
          navigation.setParams({ openMatchId: undefined });
        }
      }
      else if (!cached) showToast(matchResult.reason?.message || 'Match history unavailable.');
      if (teamResult.status === 'fulfilled') setJoinedTeams(nextTeams);
      else if (!cached) setJoinedTeams([]);
      if (followResult.status === 'fulfilled') setFollowCounts(nextFollowCounts);
      if (matchResult.status === 'fulfilled' || teamResult.status === 'fulfilled' || followResult.status === 'fulfilled') {
        await writeCachedData(dataCacheKey, { recordedMatches: nextMatches, joinedTeams: nextTeams, followCounts: nextFollowCounts });
      }
      refreshRunning = false;
    };
    loadProfileData();
    const unsubscribe = navigation.addListener('focus', loadProfileData);
    return () => { active = false; unsubscribe(); };
  }, [dataCacheKey, navigation, route.params?.openMatchId, user?.id]);
  const setPreference = async (key, value) => {
    if (Platform.OS !== 'web' && value && ['squad', 'reminders'].includes(key)) {
      try { await enablePushNotifications(); } catch (error) { showToast(error.message || 'Push notifications could not be enabled.'); return; }
    }
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    if (Platform.OS !== 'web' && !next.squad && !next.reminders) disablePushNotifications().catch(() => {});
    updateProfile({ preferences: next }).catch((error) => showToast(error.message || 'Could not save preference.'));
    showToast(`${key === 'squad' ? 'Squad notifications' : key === 'reminders' ? 'Match reminders' : 'Calendar sync'} ${value ? 'on' : 'off'}.`);
  };
  const openOrganizerPortal = (path) => {
    Linking.openURL(`${ORGANIZER_PORTAL_URL}${path}`).catch(() => showToast('Organizer portal could not be opened.'));
  };
  const handleSetting = (action) => {
    if (action === 'Edit profile') { setEditOpen(true); return; }
    if (action === 'Performance rating') { navigation.navigate('Pickleball', { openTab: 'Ratings', ownerTab: 'Profile' }); return; }
    if (action === 'Privacy & matching') { navigation.navigate('Privacy'); return; }
    if (action === 'Payment history') { navigation.navigate('PaymentHistory'); return; }
    if (action === 'Help and support') { navigation.navigate('HelpSupport'); return; }
    if (action === 'Privacy policy') { navigation.navigate('LegalDocument', { documentKey: 'privacy' }); return; }
    if (action === 'Terms of service') { navigation.navigate('LegalDocument', { documentKey: 'terms' }); return; }
    if (action === 'Delete account') { navigation.navigate('AccountDeletion'); return; }
    if (action === 'Message notifications') { navigation.navigate('NotificationTest'); return; }
    if (action === 'Log out') { signOut(); return; }
    showToast(`${action} opened.`);
  };
  const changePresenceStatus = async (nextStatus) => {
    const previousStatus = player.presenceStatus || 'free';
    setPlayer((current) => ({ ...current, presenceStatus: nextStatus }));
    setPresenceOpen(false);
    try {
      await updateProfile({ presenceStatus: nextStatus });
      showToast(`Status changed to ${presenceOption(nextStatus).label}.`);
    } catch (error) {
      setPlayer((current) => ({ ...current, presenceStatus: previousStatus }));
      showToast(error.message || 'Status could not be updated.');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <ScrollView contentContainerStyle={[styles.content, compactPhone && styles.contentCompact]} showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}>
          <View style={styles.topbarCopy}><Text numberOfLines={1} style={styles.eyebrow}>YOUR GAME</Text><Text numberOfLines={1} style={styles.h1}>Player profile</Text></View>
          <View style={styles.topActions}><Pressable accessibilityLabel="Notifications" onPress={() => setNotificationsOpen(true)} style={styles.topActionButton}><Icon name="notifications-outline" size={19} />{unreadCount > 0 && <View style={styles.noticeDot} />}</Pressable></View>
        </View>
        <KitchenLine style={[styles.headerLine, compactPhone && styles.headerLineCompact]} />
        <View {...webLayout('profile')}>
        <View {...webLayout('profile-summary')}>
        <View {...webLayout('profile-identity')} style={[styles.identity, compactPhone && styles.identityCompact]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Change player status. Current status ${presenceOption(player.presenceStatus).label}`} accessibilityHint="Opens player availability options" onPress={() => setPresenceOpen(true)} hitSlop={10} style={({ pressed }) => [styles.avatar, pressed && styles.avatarPressed]}><ProfilePhoto photo={player.avatar} name={player.name} size={67} /><View pointerEvents="none" style={styles.avatarStatusButton}><View style={[styles.avatarStatusDot, { backgroundColor: presenceOption(player.presenceStatus).color }]} /></View></Pressable>
          <View {...webLayout('profile-identity-copy')} style={styles.identityCopy}>
            <View style={styles.playerNameRow}><Text numberOfLines={1} style={styles.playerName}>{player.name}</Text><Pressable accessibilityLabel={`Edit profile. Status ${presenceOption(player.presenceStatus).label}`} onPress={() => setEditOpen(true)} hitSlop={8} style={styles.editProfileButton}><Icon name="create-outline" size={18} color={C.ink40} /></Pressable></View>
            <View {...webLayout('profile-meta')} style={[styles.clubLocationRow, compactPhone && styles.clubLocationRowCompact]}>
              <View style={[styles.squad, { marginTop: 0, flexShrink: 1 }]}><Icon name="people" size={12} color={C.teal} /><Text {...webLayout('profile-meta-label')} numberOfLines={1} style={[styles.squadText, { flex: 0, flexShrink: 1 }]}>{joinedTeams.length ? `${joinedTeams[0].name}${joinedTeams.length > 1 ? ` +${joinedTeams.length - 1}` : ''}` : 'No team joined'}</Text></View>
              <View style={[styles.location, { marginTop: 0, flexShrink: 1 }]}><Icon name="location-outline" size={13} color={C.ink40} /><Text {...webLayout('profile-meta-label')} numberOfLines={1} style={[styles.locationText, { flex: 0, flexShrink: 1 }]}>{player.location}</Text></View>
            </View>
            <View style={[styles.socialStats, compactPhone && styles.socialStatsCompact]}><Pressable accessibilityRole="button" accessibilityLabel={`${followCounts.followers} followers. Open followers list`} hitSlop={7} onPress={() => navigation.navigate('Connections', { initialTab: 'Followers', openToken: Date.now() })} style={({ pressed }) => [styles.socialStat, pressed && styles.socialStatPressed]}><Text style={styles.socialValue}>{formatSocialCount(followCounts.followers)}</Text><Text style={styles.socialLabel}>Followers</Text></Pressable><View style={styles.socialDivider} /><Pressable accessibilityRole="button" accessibilityLabel={`Following ${followCounts.following} players. Open following list`} hitSlop={7} onPress={() => navigation.navigate('Connections', { initialTab: 'Following', openToken: Date.now() })} style={({ pressed }) => [styles.socialStat, pressed && styles.socialStatPressed]}><Text style={styles.socialValue}>{formatSocialCount(followCounts.following)}</Text><Text style={styles.socialLabel}>Following</Text></Pressable></View>
          </View>
        </View>
        {hasOrganizerAccess && <OrganizerPortalShortcut onOpen={openOrganizerPortal} />}
        </View>
        <View {...webLayout('profile-content')}>
        <View style={[styles.tabs, compactPhone && styles.tabsCompact]}>{['Overview', 'Matches', 'Settings'].map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}</View>
        {tab === 'Overview' && <Overview matches={recordedMatches} onAchievement={setAchievement} onSeeMatches={() => setTab('Matches')} onMatch={setSelectedMatch} onStartFocus={() => {
          navigation.navigate('Play', { focusChallengeToken: Date.now(), focusChallenge: { id: 'return-depth-7-of-10', title: 'Return depth', instruction: 'Land 7 of your first 10 returns past mid-court.', target: 7, attempts: 10 } });
        }} />}
        {tab === 'Matches' && <History source={recordedMatches} onMatch={setSelectedMatch} />}
        {tab === 'Settings' && <Settings preferences={preferences} setPreference={setPreference} onAction={handleSetting} lastLogin={user?.lastLogin} />}
        </View>
        </View>
      </ScrollView>

      <EditProfile visible={editOpen} player={player} isDark={isDark} onClose={() => setEditOpen(false)} onSave={async (value) => { const saved = await updateProfile(value); setPlayer((current) => ({ ...current, ...saved })); setEditOpen(false); showToast('Profile updated.'); }} />
      <Sheet visible={presenceOpen} title="Player status" eyebrow="AVAILABILITY" onClose={() => setPresenceOpen(false)}>
        <Text style={styles.statusSheetLead}>Choose how you appear to nearby players and match invitations.</Text>
        <View style={styles.statusSheetCard}>{PRESENCE_OPTIONS.map((option, index) => { const selected = (player.presenceStatus || 'free') === option.value; return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => changePresenceStatus(option.value)} style={[styles.statusSheetRow, index > 0 && styles.rowBorder]}><View style={[styles.statusSheetDot, { backgroundColor: option.color }]} /><View style={styles.flex}><Text style={styles.statusSheetTitle}>{option.label}</Text><Text style={styles.statusSheetDetail}>{option.detail}</Text></View>{selected && <Icon name="checkmark-circle" size={20} color={C.teal} />}</Pressable>; })}</View>
      </Sheet>
      <NotificationSheet visible={notificationsOpen} onClose={() => setNotificationsOpen(false)} items={notices} unreadCount={unreadCount} onRead={(id) => readNotification(id).catch((error) => showToast(error.message || 'This notification could not be marked as read.'))} onReadAll={() => readAllNotifications().catch((error) => showToast(error.message || 'Notifications could not be marked as read.'))} onDelete={removeNotification} onClearRead={clearNotifications} onFollowResponse={handleFollowResponse} />
      <Sheet visible={Boolean(achievement)} title={achievement?.name || ''} eyebrow={achievement?.earned ? 'ACHIEVEMENT EARNED' : 'IN PROGRESS'} onClose={() => setAchievement(null)}>
        <View style={[styles.achievementDetailIcon, !achievement?.earned && styles.achievementIconLocked]}><Icon name={achievement?.earned ? achievement?.icon : 'lock-closed-outline'} size={31} /></View><Text style={styles.achievementDetail}>{achievement?.detail}</Text><Text style={styles.achievementProgress}>{achievement?.earned ? `Earned ${achievement?.date}` : achievement?.date}</Text><Pressable onPress={() => setAchievement(null)} style={styles.primaryButton}><Text style={styles.primaryText}>{achievement?.earned ? 'Nice work' : 'Keep playing'}</Text></Pressable>
      </Sheet>
      <Sheet fullHeight visible={Boolean(selectedMatch)} title="Box score" eyebrow="COMPLETED MATCH" onClose={() => setSelectedMatch(null)}><BoxScore match={selectedMatch} playerName={player.name} /></Sheet>
      {toast ? <View style={styles.toast}><Icon name="checkmark-circle" size={17} color={C.optic} /><Text style={styles.toastText}>{toast}</Text></View> : null}
    </SafeAreaView>
  );
}

export default function PlayerProfileScreen(props) {
  return <ProfileScreen {...props} />;
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: .08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 } });
const lightStyles = createMobileStyleSheet({
  safe: { flex: 1, backgroundColor: C.paper }, content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 126 }, contentCompact: { paddingHorizontal: 16, paddingTop: 22 }, flex: { flex: 1 },
  topbar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, topbarCopy: { flex: 1, minWidth: 0 }, topActions: { height: 40, flexDirection: 'row', flexShrink: 0, gap: 6 }, eyebrow: { color: C.ink40, fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1 }, h1: { marginTop: 2, color: C.ink, fontSize: 26, lineHeight: 31, fontWeight: '900', letterSpacing: -.55 }, h2: { marginTop: 3, color: C.ink, fontSize: 21, lineHeight: 27, fontWeight: '800', letterSpacing: -.4 },
  topActionButton: { width: 40, height: 40, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  iconButton: { width: 43, height: 43, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }, noticeDot: { position: 'absolute', right: 9, top: 8, width: 7, height: 7, borderRadius: 4, borderWidth: 1, borderColor: C.surface, backgroundColor: C.brick },
  kitchen: { height: 7, marginTop: 18, marginBottom: 22 }, headerLine: { marginTop: 10, marginBottom: 16 }, headerLineCompact: { marginTop: 14, marginBottom: 21 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 }, solidQuiet: { backgroundColor: C.line }, dashedQuiet: { borderColor: C.line },
  identity: { flexDirection: 'row', alignItems: 'center' }, identityCompact: { alignItems: 'flex-start' }, avatar: { width: 67, height: 67, borderRadius: 34, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' }, avatarPressed: { opacity: .72, transform: [{ scale: .97 }] }, avatarText: { color: C.surface, fontSize: 17, fontWeight: '900' }, avatarStatusButton: { position: 'absolute', right: 0, bottom: 0, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.paper }, avatarStatusDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: C.paper }, identityCopy: { minWidth: 0, flex: 1, marginLeft: 13 }, playerNameRow: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 }, playerName: { minWidth: 0, flexShrink: 1, color: C.ink, fontSize: 21, fontWeight: '800' }, accountTierBadge: { minWidth: 40, height: 19, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: '#B58B2A', backgroundColor: '#FBF5E4' }, accountTierBadgePro: { borderColor: '#8C98A3', backgroundColor: '#EEF1F3' }, accountTierBadgeAdmin: { borderColor: '#B94235', backgroundColor: '#FBEDEA' }, accountTierText: { color: '#7A5A08', fontSize: 5.5, fontWeight: '900', letterSpacing: .65 }, accountTierTextPro: { color: '#46515B' }, accountTierTextAdmin: { color: '#9F2F25' }, editProfileButton: { width: 27, height: 27, alignItems: 'center', justifyContent: 'center' }, clubLocationRow: { marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'flex-start' }, clubLocationRowCompact: { marginTop: 7, flexWrap: 'wrap', columnGap: 12, rowGap: 5 }, location: { marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 3 }, locationText: { minWidth: 0, flex: 1, color: C.ink40, fontSize: 10 }, squad: { marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 4 }, squadText: { minWidth: 0, flex: 1, color: C.teal, fontSize: 10, fontWeight: '800' }, rating: { alignItems: 'flex-end' }, ratingValue: { color: C.ink, fontSize: 30, lineHeight: 32, fontWeight: '900' }, ratingTier: { marginTop: 2, color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, ratingTrend: { marginTop: 3, color: C.teal, fontSize: 9, fontWeight: '800' }, socialStats: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 5 }, socialStatsCompact: { marginTop: 9, gap: 7 }, socialStat: { flexDirection: 'row', alignItems: 'baseline', gap: 3 }, socialStatPressed: { opacity: .55 }, socialValue: { color: C.ink, fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] }, socialLabel: { color: C.ink40, fontSize: 8, fontWeight: '800' }, socialDivider: { width: 3, height: 3, marginHorizontal: 2, borderRadius: 2, backgroundColor: C.line },
  organizerPortalCard: { marginTop: 18, padding: 14, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, organizerPortalHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, organizerPortalIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.optic }, organizerPortalEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, organizerPortalTitle: { marginTop: 2, color: C.ink, fontSize: 12, fontWeight: '900' }, organizerPortalOpen: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.optic }, organizerPortalBody: { marginTop: 11, color: C.ink40, fontSize: 9, lineHeight: 14 }, organizerShortcutRow: { marginTop: 12, flexDirection: 'row', gap: 7 }, organizerShortcut: { minHeight: 42, flex: 1, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 11, backgroundColor: C.tealWash }, organizerShortcutText: { color: C.teal, fontSize: 8, fontWeight: '900' },
  appModeCard: { marginTop: 18, padding: 13, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, appModeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, appModeEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, appModeTitle: { marginTop: 2, color: C.ink, fontSize: 11, fontWeight: '900' }, capabilityPill: { minHeight: 23, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.tealWash }, capabilityText: { color: C.teal, fontSize: 6, fontWeight: '900' }, appModeControl: { marginTop: 11, padding: 4, flexDirection: 'row', gap: 4, borderRadius: 14, backgroundColor: '#E5E9E3' }, appModeOption: { minHeight: 43, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10 }, appModeOptionActive: { backgroundColor: C.optic, ...shadow }, appModeOptionLocked: { opacity: .72 }, appModeOptionText: { color: C.ink40, fontSize: 10, fontWeight: '800' }, appModeOptionTextActive: { color: C.ink, fontWeight: '900' }, appModeActiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.teal }, appModeHelp: { marginTop: 9, color: C.ink40, fontSize: 8, lineHeight: 12 },
  modeModalBackdrop: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,35,33,.58)' }, modeDialog: { width: '100%', maxWidth: 370, padding: 20, borderRadius: 23, backgroundColor: C.paper, ...shadow }, modeDialogIcon: { width: 54, height: 54, marginBottom: 14, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, modeDialogEyebrow: { color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .9 }, modeDialogTitle: { marginTop: 4, color: C.ink, fontSize: 22, lineHeight: 28, fontWeight: '900' }, modeDialogBody: { marginTop: 7, color: C.ink70, fontSize: 10, lineHeight: 16 }, modeDialogNote: { minHeight: 56, marginTop: 14, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 13, backgroundColor: C.tealWash }, modeDialogNoteText: { flex: 1, color: C.ink70, fontSize: 8, lineHeight: 12 }, modeDialogActions: { marginTop: 16, flexDirection: 'row', gap: 9 }, modeCancelButton: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, modeCancelText: { color: C.ink40, fontSize: 9, fontWeight: '900' }, modeConfirmButton: { minHeight: 48, flex: 1.35, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.ink }, modeConfirmText: { color: C.surface, fontSize: 9, fontWeight: '900' },
  organizerHero: { padding: 16, borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: C.ink }, organizerHeroHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, organizerHeroIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, organizerHeroEyebrow: { color: '#9FB3AC', fontSize: 7, fontWeight: '900', letterSpacing: .8 }, organizerHeroTitle: { marginTop: 2, color: C.surface, fontSize: 15, fontWeight: '900' }, organizerVerified: { minHeight: 25, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 13, backgroundColor: C.tealWash }, organizerVerifiedText: { color: C.teal, fontSize: 6, fontWeight: '900' }, organizerHeroBody: { marginTop: 13, color: '#CBD7D2', fontSize: 9, lineHeight: 14 }, organizerMonitorButton: { minHeight: 48, marginTop: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, backgroundColor: C.optic }, organizerMonitorText: { color: C.ink, fontSize: 10, fontWeight: '900' }, organizerStats: { paddingVertical: 16, flexDirection: 'row', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, organizerStat: { flex: 1, alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderColor: C.line }, organizerStatValue: { color: C.ink, fontSize: 24, fontWeight: '900' }, organizerStatLabel: { marginTop: 3, color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, organizerStatMeta: { marginTop: 3, color: C.ink40, fontSize: 7 }, capabilitiesCard: { paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, capabilityRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10 }, capabilityIcon: { width: 39, height: 39, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.tealWash }, capabilityTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, capabilityDetail: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 },
  organizerHistorySummary: { minHeight: 100, padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 18, backgroundColor: C.ink }, organizerHistoryTitle: { marginTop: 3, color: C.surface, fontSize: 16, fontWeight: '900' }, organizerHistoryBadge: { alignItems: 'flex-end' }, organizerHistoryBadgeValue: { color: C.optic, fontSize: 25, fontWeight: '900' }, organizerHistoryBadgeLabel: { marginTop: 2, color: '#9FB3AC', fontSize: 6, fontWeight: '900' }, organizerSessionsCard: { paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, organizerSessionRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 9 }, organizerDate: { width: 45, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.tealWash }, organizerDateText: { color: C.teal, fontSize: 7, fontWeight: '900' }, organizerSessionTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, organizerSessionMeta: { marginTop: 4, color: C.ink40, fontSize: 8 }, organizerMatchCount: { alignItems: 'flex-end' }, organizerMatchValue: { color: C.ink, fontSize: 16, fontWeight: '900' }, organizerMatchLabel: { color: C.ink40, fontSize: 5, fontWeight: '900' },
  tabs: { marginTop: 20, marginBottom: 18, padding: 4, flexDirection: 'row', borderRadius: 13, backgroundColor: '#E5E9E3' }, tabsCompact: { marginTop: 24, marginBottom: 22 }, tab: { flex: 1, minHeight: 41, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, tabActive: { backgroundColor: C.optic, ...shadow }, tabText: { color: C.ink40, fontSize: 11, fontWeight: '800' }, tabTextActive: { color: C.ink },
  focusCard: { marginBottom: 13, padding: 16, borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: C.ink, ...shadow }, focusTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, focusIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.optic, alignItems: 'center', justifyContent: 'center' }, focusEyebrow: { color: '#9FB3AC', fontSize: 8, fontWeight: '900', letterSpacing: .9 }, focusTitle: { marginTop: 2, color: C.surface, fontSize: 17, fontWeight: '900' }, priorityBadge: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7, backgroundColor: 'rgba(214,233,74,.14)' }, priorityText: { color: C.optic, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, focusWhy: { marginTop: 13, color: '#D9E1DD', fontSize: 10, lineHeight: 15 }, focusStrong: { color: C.surface, fontWeight: '900' }, progressTrack: { height: 7, marginTop: 13, overflow: 'hidden', borderRadius: 4, backgroundColor: '#334946' }, progressFill: { width: '48%', height: '100%', borderRadius: 4, backgroundColor: C.optic }, progressLabels: { marginTop: 5, flexDirection: 'row', justifyContent: 'space-between' }, progressCurrent: { color: C.optic, fontSize: 7, fontWeight: '900' }, progressGoal: { color: '#9FB3AC', fontSize: 7, fontWeight: '900' }, nextAction: { minHeight: 65, marginTop: 13, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 11, backgroundColor: C.surface }, nextActionPressed: { opacity: .82, transform: [{ scale: .985 }] }, nextActionIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, nextActionCopy: { flex: 1 }, nextActionText: { color: C.ink70, fontSize: 9, lineHeight: 13 }, nextActionStrong: { color: C.ink, fontWeight: '900' }, nextActionCta: { marginTop: 4, color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .65 },
  statCard: { padding: 15, flexDirection: 'row', alignItems: 'stretch', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, ring: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }, ringInner: { alignItems: 'center' }, ringValue: { color: C.ink, fontSize: 20, fontWeight: '900' }, ringPercent: { fontSize: 10 }, statLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, statBlock: { flex: 1, marginLeft: 15, justifyContent: 'center' }, statValue: { color: C.ink, fontSize: 23, fontWeight: '900' }, statMeta: { marginTop: 4, color: C.ink40, fontSize: 8 }, streakMeta: { marginTop: 4, color: C.brick, fontSize: 7, fontWeight: '800' }, statDivider: { width: 1, height: 42, backgroundColor: C.line, alignSelf: 'center' },
  chartCard: { marginTop: 13, padding: 16, borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, cardTitle: { marginTop: 2, color: C.ink, fontSize: 15, fontWeight: '800' }, changeBadge: { paddingHorizontal: 8, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, backgroundColor: C.tealWash }, changeText: { color: C.teal, fontSize: 10, fontWeight: '900' }, chart: { height: 96, marginTop: 12, overflow: 'hidden' }, gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: C.line }, chartBars: { position: 'absolute', left: 0, right: 0, bottom: 1, height: 80, flexDirection: 'row', alignItems: 'flex-end' }, barSlot: { flex: 1, height: 80, alignItems: 'center', justifyContent: 'flex-end' }, bar: { width: 8, minHeight: 9, borderRadius: 4, backgroundColor: '#A6C6C0' }, barCurrent: { width: 10, backgroundColor: C.teal }, chartLabels: { flexDirection: 'row', justifyContent: 'space-between' }, chartLabel: { color: C.ink40, fontSize: 7, fontWeight: '800' },
  sectionHeader: { marginTop: 24, marginBottom: 11, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, sectionMeta: { color: C.ink40, fontSize: 8, fontWeight: '800' }, link: { paddingVertical: 4, color: C.teal, fontSize: 11, fontWeight: '800' }, insightGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, insight: { width: '48.5%', minHeight: 105, padding: 13, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, insightValue: { marginTop: 9, color: C.ink, fontSize: 23, fontWeight: '900' }, insightValueSmall: { marginTop: 10, color: C.ink, fontSize: 14, fontWeight: '900' }, insightLabel: { marginTop: 3, color: C.ink40, fontSize: 9 },
  achievementRow: { gap: 9, paddingRight: 20 }, achievement: { width: 116, minHeight: 133, padding: 12, borderRadius: 17, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, achievementLocked: { opacity: .62, backgroundColor: '#ECEFEA' }, achievementIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.optic, alignItems: 'center', justifyContent: 'center' }, achievementIconLocked: { backgroundColor: C.line }, achievementName: { marginTop: 10, minHeight: 30, color: C.ink, fontSize: 11, lineHeight: 15, fontWeight: '800' }, achievementDate: { color: C.ink40, fontSize: 8 },
  matchCard: { overflow: 'hidden', borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, matchRow: { minHeight: 83, marginHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 }, rowBorder: { borderTopWidth: 1, borderColor: C.line }, result: { width: 31, height: 31, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, resultWin: { backgroundColor: C.tealWash }, resultLoss: { backgroundColor: C.brickWash }, resultText: { color: C.teal, fontSize: 10, fontWeight: '900' }, resultTextLoss: { color: C.brick }, matchCopy: { flex: 1 }, matchOpponent: { color: C.ink, fontSize: 10, fontWeight: '800' }, matchMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, matchLearning: { marginTop: 4, fontSize: 7, fontWeight: '800' }, scoreCopy: { alignItems: 'flex-end' }, matchScore: { color: C.ink, fontSize: 10, fontWeight: '900' }, matchDate: { marginTop: 3, color: C.ink40, fontSize: 7, fontWeight: '800' }, ratingChange: { width: 25, textAlign: 'right', fontSize: 8, fontWeight: '900' }, positive: { color: C.teal }, negative: { color: C.brick }, muted: { color: C.ink40 }, pressed: { opacity: .75, transform: [{ scale: .985 }] },
  historySummary: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 18, backgroundColor: C.ink }, record: { alignItems: 'flex-end' }, recordValue: { color: C.optic, fontSize: 23, fontWeight: '900' }, patternCard: { marginTop: 12, padding: 15, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, patternHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, patternTitle: { marginTop: 2, color: C.ink, fontSize: 14, fontWeight: '900' }, formRecord: { color: C.teal, fontSize: 19, fontWeight: '900' }, recentForm: { marginTop: 14, flexDirection: 'row', gap: 7 }, patternMetrics: { marginTop: 14, flexDirection: 'row' }, patternMetric: { flex: 1, alignItems: 'center' }, patternDivider: { width: 1, backgroundColor: C.line }, patternValue: { color: C.ink, fontSize: 18, fontWeight: '900' }, patternLabel: { marginTop: 2, color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .3 }, patternStatus: { marginTop: 4, color: C.teal, fontSize: 7, fontWeight: '800' }, patternNeeds: { marginTop: 4, color: C.brick, fontSize: 7, fontWeight: '800' }, patternCopy: { marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderColor: C.line, color: C.ink70, fontSize: 9, lineHeight: 13 }, filters: { marginVertical: 13, flexDirection: 'row', gap: 8 }, filter: { minHeight: 36, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, filterActive: { borderColor: C.ink, backgroundColor: C.ink }, filterText: { color: C.ink70, fontSize: 10, fontWeight: '800' }, filterTextActive: { color: C.paper }, endNote: { paddingVertical: 18, textAlign: 'center', color: C.ink40, fontSize: 9 },
  settingsLabel: { marginTop: 5, marginBottom: 8, color: C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: .8 }, settingsCard: { marginBottom: 21, paddingHorizontal: 13, overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, settingRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 10 }, settingIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.tealWash }, settingIconDanger: { backgroundColor: '#F7E7E4' }, settingCopy: { flex: 1 }, settingTitle: { color: C.ink, fontSize: 11, fontWeight: '800' }, settingDetail: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 }, danger: { color: C.error }, toggle: { width: 43, height: 25, padding: 3, borderRadius: 13, backgroundColor: C.line }, toggleOn: { backgroundColor: C.optic }, toggleKnob: { width: 19, height: 19, borderRadius: 10, backgroundColor: C.surface, ...shadow }, toggleKnobOn: { transform: [{ translateX: 18 }] }, version: { marginTop: 2, textAlign: 'center', color: C.ink40, fontSize: 7, fontWeight: '800', letterSpacing: .7 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.42)' }, backdropDismiss: { ...StyleSheet.absoluteFillObject }, sheet: { maxHeight: '84%', paddingHorizontal: 20, paddingTop: 9, paddingBottom: 30, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: C.paper }, sheetTall: { height: '92%', maxHeight: '92%', paddingBottom: 12 }, sheetBody: { flexShrink: 1 }, sheetBodyScrollable: { flex: 1, minHeight: 0, overflow: 'hidden' }, handle: { width: 38, height: 4, marginBottom: 15, alignSelf: 'center', borderRadius: 2, backgroundColor: C.line }, sheetHeader: { flexDirection: 'row', alignItems: 'center' }, sheetTitle: { color: C.ink, fontSize: 25, fontWeight: '800' }, sheetLine: { marginTop: 15, marginBottom: 13 },
  inputLabel: { marginBottom: 7, color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 }, input: { minHeight: 54, paddingHorizontal: 16, paddingVertical: 0, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, fontSize: 13, textAlignVertical: 'center', outlineStyle: 'none' },
  // Location picker trigger chip
  locTrigger: { minHeight: 64, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  locTriggerPressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  locTriggerIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.tealWash },
  locTriggerEyebrow: { color: C.ink40, fontSize: 7.5, fontWeight: '900', letterSpacing: .7 },
  locTriggerCity: { marginTop: 1, color: C.ink, fontSize: 14, fontWeight: '800' },
  locTriggerMeta: { marginTop: 1, color: C.ink40, fontSize: 9 },
  locTriggerPlaceholder: { marginTop: 2, color: C.ink40, fontSize: 12 },
  locTriggerChevron: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.tealWash },
  // Modal backdrop + sheet
  locModalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.55)' },
  locModalDismiss: { ...StyleSheet.absoluteFillObject },
  locSheet: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: '#0F2421' },
  locHandle: { width: 38, height: 4, marginBottom: 18, alignSelf: 'center', borderRadius: 2, backgroundColor: 'rgba(255,255,255,.2)' },
  locHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  locHeaderEyebrow: { color: 'rgba(255,255,255,.45)', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  locHeaderTitle: { marginTop: 3, color: '#FFFFFF', fontSize: 26, fontWeight: '800', letterSpacing: -.5 },
  locCloseBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.12)' },
  // Currently using card
  locCurrentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingHorizontal: 14, marginBottom: 14, borderRadius: 15, backgroundColor: 'rgba(255,255,255,.09)' },
  locCurrentIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(28,107,102,.35)' },
  locCurrentLabel: { color: 'rgba(255,255,255,.45)', fontSize: 8, fontWeight: '900', letterSpacing: .8 },
  locCurrentCity: { marginTop: 2, color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  locCurrentMeta: { marginTop: 1, color: 'rgba(255,255,255,.5)', fontSize: 9 },
  // GPS button (optic / lime-yellow)
  locGpsBtn: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 16, borderRadius: 16, backgroundColor: C.optic, marginBottom: 18 },
  locGpsBtnTitle: { color: C.ink, fontSize: 13, fontWeight: '900' },
  locGpsBtnSub: { marginTop: 2, color: 'rgba(14,35,33,.55)', fontSize: 9 },
  // OR divider label
  locOrLabel: { color: 'rgba(255,255,255,.4)', fontSize: 9, fontWeight: '900', letterSpacing: 1.1, marginBottom: 10 },
  // Search row
  locSearchRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, backgroundColor: 'rgba(255,255,255,.1)', marginBottom: 10 },
  locSearchInput: { flex: 1, height: 52, paddingHorizontal: 10, color: '#FFFFFF', fontSize: 13, outlineStyle: 'none' },
  locSearchClear: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  locSearchArrow: { width: 42, height: 42, marginRight: 5, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic },
  // Results list
  locResults: { borderRadius: 14, backgroundColor: 'rgba(255,255,255,.09)', marginBottom: 10, overflow: 'hidden' },
  locResultRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  locResultBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,.12)' },
  locResultActive: { backgroundColor: 'rgba(214,233,74,.14)' },
  locResultHovered: { backgroundColor: 'rgba(114,199,190,.2)' },
  locResultCity: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  locResultMeta: { marginTop: 1, color: 'rgba(255,255,255,.45)', fontSize: 9 },
  locResultText: { flex: 1, color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  // Privacy note
  locPrivacyNote: { marginTop: 6, color: 'rgba(255,255,255,.35)', fontSize: 8.5, textAlign: 'center', lineHeight: 13 },
  ratingNotice: { marginBottom: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, backgroundColor: C.tealWash }, profileAvatarPicker: { gap: 9, paddingVertical: 2, paddingRight: 15 }, profileAvatarChoice: { width: 58, height: 58, borderRadius: 18, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface }, profileAvatarChoiceActive: { borderColor: C.ink, backgroundColor: C.optic }, editProfileLayout: { flex: 1, minHeight: 0 }, editProfileScroll: { flex: 1, minHeight: 0 }, editProfileContent: { paddingTop: 2, paddingBottom: 34 }, editFieldGroup: { marginBottom: 16 }, editFieldGroupLast: { marginBottom: 0 }, editProfileActions: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderColor: C.line }, editChoiceRow: { flexDirection: 'row', gap: 8 }, editChoice: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 12, backgroundColor: C.surface }, editChoiceActive: { borderColor: C.ink, backgroundColor: C.optic }, editChoiceText: { color: C.ink40, fontSize: 9, fontWeight: '900' }, editChoiceTextActive: { color: C.ink }, editError: { marginBottom: 8, color: C.error, fontSize: 9 }, primaryButton: { minHeight: 54, marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 15, backgroundColor: C.optic }, editSaveButton: { marginTop: 0 }, editSaveButtonDisabled: { borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, primaryText: { color: C.ink, fontSize: 12, fontWeight: '900' }, disabled: { opacity: .55 },
  statusSheetLead: { marginBottom: 12, color: C.ink40, fontSize: 9, lineHeight: 14 }, statusSheetCard: { paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, statusSheetRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10 }, statusSheetDot: { width: 12, height: 12, borderRadius: 6 }, statusSheetTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, statusSheetDetail: { marginTop: 3, color: C.ink40, fontSize: 8 },
  empty: { paddingVertical: 55, alignItems: 'center' }, emptyTitle: { marginTop: 11, marginBottom: 3, color: C.ink, fontSize: 16, fontWeight: '800' },
  achievementDetailIcon: { width: 70, height: 70, marginTop: 7, marginBottom: 15, alignSelf: 'center', borderRadius: 23, backgroundColor: C.optic, alignItems: 'center', justifyContent: 'center' }, achievementDetail: { color: C.ink70, textAlign: 'center', fontSize: 13, lineHeight: 19 }, achievementProgress: { marginTop: 7, color: C.teal, textAlign: 'center', fontSize: 10, fontWeight: '800' },
  boxScroll: { flex: 1, minHeight: 0 }, boxContent: { flexGrow: 0, paddingBottom: 72 }, boxResult: { padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, backgroundColor: C.teal }, boxResultLoss: { backgroundColor: C.brick }, boxResultLabel: { color: 'rgba(255,255,255,.7)', fontSize: 8, fontWeight: '900', letterSpacing: .7 }, boxResultScore: { marginTop: 2, color: C.surface, fontSize: 29, fontWeight: '900' }, boxResultMeta: { alignItems: 'flex-end' }, boxType: { color: C.surface, fontSize: 10, fontWeight: '800' }, boxRating: { marginTop: 3, color: 'rgba(255,255,255,.7)', fontSize: 8 }, boxVenue: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 6 }, boxVenueText: { color: C.ink70, fontSize: 9, fontWeight: '700' }, takeawayCard: { marginBottom: 13, padding: 12, flexDirection: 'row', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: '#C9DCD7', backgroundColor: C.tealWash }, takeawayCardLoss: { borderColor: '#E7CFC7', backgroundColor: C.brickWash }, takeawayIcon: { width: 35, height: 35, borderRadius: 11, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }, takeawayIconLoss: { backgroundColor: '#FFF9F7' }, takeawayLabel: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, takeawayTitle: { marginTop: 2, color: C.ink, fontSize: 12, lineHeight: 16, fontWeight: '900' }, takeawayCopy: { marginTop: 3, color: C.ink70, fontSize: 8, lineHeight: 12 }, boxTable: { overflow: 'hidden', borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, boxHeaderRow: { minHeight: 31, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: '#E7EBE7' }, boxHeaderCell: { width: 32, color: C.ink40, textAlign: 'center', fontSize: 7, fontWeight: '900' }, boxTeamCell: { flex: 1, width: undefined, textAlign: 'left' }, boxTeamRow: { minHeight: 59, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' }, boxOpponentRow: { borderTopWidth: 1, borderColor: C.line }, boxTeamName: { color: C.ink, fontSize: 9, fontWeight: '800' }, boxTeamTag: { marginTop: 3, color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, boxOpponentTag: { marginTop: 3, color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, boxScoreCell: { width: 32, color: C.ink40, textAlign: 'center', fontSize: 14, fontWeight: '800' }, boxWinningScore: { color: C.teal }, boxTotal: { width: 32, color: C.ink, textAlign: 'center', fontSize: 15, fontWeight: '900' }, boxSectionLabel: { marginTop: 18, marginBottom: 8, color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 }, boxStats: { paddingVertical: 12, flexDirection: 'row', borderRadius: 14, backgroundColor: C.tealWash }, boxStat: { flex: 1, alignItems: 'center', borderRightWidth: 1, borderColor: '#C9DCD7' }, boxStatLast: { borderRightWidth: 0 }, boxStatValue: { marginTop: 4, color: C.ink, fontSize: 11, fontWeight: '900' }, boxStatLabel: { marginTop: 2, color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .4 }, performanceCard: { paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, performanceRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: C.line }, performanceCopy: { width: 92 }, performanceName: { color: C.ink, fontSize: 8, fontWeight: '800' }, performanceTarget: { marginTop: 2, color: C.ink40, fontSize: 6 }, performanceBar: { flex: 1, height: 6, overflow: 'hidden', borderRadius: 3, backgroundColor: C.line }, performanceFill: { height: '100%', borderRadius: 3, backgroundColor: C.teal }, performanceFillBelow: { backgroundColor: C.brick }, performanceResult: { width: 54, alignItems: 'flex-end' }, performanceValue: { color: C.teal, fontSize: 11, fontWeight: '900' }, performanceVerdict: { marginTop: 2, color: C.teal, fontSize: 6, fontWeight: '800' }, performanceBelow: { color: C.brick }, errorRow: { minHeight: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, coachCard: { marginTop: 12, padding: 14, borderRadius: 15, backgroundColor: C.optic }, coachStep: { color: C.ink70, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, coachTitle: { marginTop: 3, color: C.ink, fontSize: 12, lineHeight: 16, fontWeight: '900' }, coachMeta: { marginTop: 4, color: C.ink70, fontSize: 8 }, boxNote: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }, boxNoteText: { flex: 1, color: C.ink40, fontSize: 8, lineHeight: 12 }, rallyHistoryRow: { minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }, rallyHistoryNumber: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: C.tealWash }, rallyHistoryNumberText: { color: C.teal, fontSize: 8, fontWeight: '900' }, rallyHistoryResult: { color: C.ink, fontSize: 9, fontWeight: '800' }, rallyHistoryServe: { marginTop: 2, color: C.ink40, fontSize: 7 }, rallyHistoryScore: { color: C.ink, fontSize: 11, fontWeight: '900' },
  toast: { position: 'absolute', left: 20, right: 20, bottom: 12, minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, backgroundColor: C.ink, ...shadow }, toastText: { flex: 1, color: C.paper, fontSize: 10, fontWeight: '700' },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
