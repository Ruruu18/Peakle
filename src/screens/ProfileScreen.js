import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
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
import Svg, { Circle } from 'react-native-svg';
import { useAppMode } from '../context/AppModeContext';
import { useAuth } from '../context/AuthContext';
import { useOrganizerPass } from '../context/OrganizerPassContext';
import { calculatePerformanceRating, listMyMatches, listTeams } from '../services/database';
import CartoonAvatar from '../components/CartoonAvatar';
import AvatarBuilder from '../components/AvatarBuilder';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { useOperations } from '../context/OperationsContext';

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
let C = LIGHT_C;

function Icon({ name, size = 20, color = C.ink }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function AccountTierBadge({ tier }) {
  if (!tier) return null;
  return <View accessibilityLabel={`${tier} account`} style={[styles.accountTierBadge, tier === 'pro' && styles.accountTierBadgePro, tier === 'admin' && styles.accountTierBadgeAdmin]}><Text style={[styles.accountTierText, tier === 'pro' && styles.accountTierTextPro, tier === 'admin' && styles.accountTierTextAdmin]}>{tier.toUpperCase()}</Text></View>;
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

function AppModeSwitch({ mode, organizerUnlocked, onChange, onOrganizerPass }) {
  return (
    <View style={styles.appModeCard}>
      <View style={styles.appModeHead}><View><Text style={styles.appModeEyebrow}>APP MODE</Text><Text style={styles.appModeTitle}>Choose your workspace</Text></View><View style={styles.capabilityPill}><Text style={styles.capabilityText}>PLAYER · ORGANIZER</Text></View></View>
      <View style={styles.appModeControl}>
        {[{ value: 'player', label: 'Player', icon: 'tennisball-outline' }, { value: 'organizer', label: 'Organizer', icon: 'key-outline' }].map((option) => {
          const active = mode === option.value;
          const locked = option.value === 'organizer' && !organizerUnlocked;
          return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => locked ? onOrganizerPass() : onChange(option.value)} style={[styles.appModeOption, active && styles.appModeOptionActive, locked && styles.appModeOptionLocked]}><Icon name={locked ? 'lock-closed-outline' : option.icon} size={17} color={active ? '#0E2321' : C.ink40} /><Text style={[styles.appModeOptionText, active && styles.appModeOptionTextActive]}>{option.label}</Text>{active && <View style={styles.appModeActiveDot} />}</Pressable>;
        })}
      </View>
      <Text style={styles.appModeHelp}>{mode === 'organizer' ? 'Organizer tools are active. You can still join your own session as a player.' : organizerUnlocked ? 'Organizer mode is unlocked. Switch whenever you need to host.' : 'Player mode is active. Organizer Pass unlocks the organizer workspace.'}</Text>
    </View>
  );
}

function ModeChangeModal({ nextMode, onCancel, onConfirm }) {
  const organizer = nextMode === 'organizer';
  return (
    <Modal visible={Boolean(nextMode)} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable accessibilityLabel="Cancel workspace change" onPress={onCancel} style={styles.modeModalBackdrop}>
        <Pressable accessibilityRole="alert" onPress={(event) => event.stopPropagation()} style={styles.modeDialog}>
          <View style={styles.modeDialogIcon}><Icon name={organizer ? 'key-outline' : 'tennisball-outline'} size={27} /></View>
          <Text style={styles.modeDialogEyebrow}>CHANGE APP MODE</Text>
          <Text style={styles.modeDialogTitle}>Switch to {organizer ? 'Organizer' : 'Player'}?</Text>
          <Text style={styles.modeDialogBody}>{organizer ? 'You’ll enter the organizer workspace for sessions, courts, queues, and player monitoring.' : 'You’ll return to your personal bookings, matches, team, and player statistics.'}</Text>
          <View style={styles.modeDialogNote}><Icon name="information-circle-outline" size={17} color={C.teal} /><Text style={styles.modeDialogNoteText}>{organizer ? 'You can still participate as a player in your own session.' : 'Any active organizer session will keep running and can be resumed later.'}</Text></View>
          <View style={styles.modeDialogActions}><Pressable onPress={onCancel} style={styles.modeCancelButton}><Text style={styles.modeCancelText}>Stay here</Text></Pressable><Pressable onPress={onConfirm} style={styles.modeConfirmButton}><Text style={styles.modeConfirmText}>Switch workspace</Text></Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Sheet({ visible, title, eyebrow, onClose, children, fullHeight = false }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close modal backdrop" onPress={onClose} style={styles.backdropDismiss} />
        <View style={[styles.sheet, fullHeight && styles.sheetTall]}>
          <View style={styles.handle} />
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

  const radius = (82 - 7) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (winRate / 100) * circumference;

  return (
    <>
      <View style={styles.statCard}>
        <View style={styles.ring}>
          <Svg style={{ position: 'absolute' }} width={82} height={82}>
            <Circle stroke={C.line} fill="none" cx={41} cy={41} r={radius} strokeWidth={7} />
            <Circle stroke={C.optic} fill="none" cx={41} cy={41} r={radius} strokeWidth={7} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" originX={41} originY={41} rotation="-90" />
          </Svg>
          <View style={styles.ringInner}><Text style={styles.ringValue}>{winRate}<Text style={styles.ringPercent}>%</Text></Text><Text style={styles.statLabel}>WIN RATE</Text></View>
        </View>
        <View style={styles.statBlock}><Text style={styles.statValue}>{matches.length}</Text><Text style={styles.statLabel}>MATCHES</Text><Text style={styles.statMeta}>{matches.filter((item) => item.type.startsWith('Ranked')).length} ranked</Text></View>
        <View style={styles.statDivider} />
        <View style={styles.statBlock}><Text style={styles.statValue}>{winStreak}</Text><Text style={styles.statLabel}>WIN STREAK</Text><Text style={styles.streakMeta}>PERSONAL BEST · {personalBest}</Text></View>
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
        <SettingRow icon="notifications-outline" title="Squad notifications" detail="Challenges, invites, and team updates" value={preferences.squad} onToggle={(value) => setPreference('squad', value)} border={false} />
        <SettingRow icon="calendar-outline" title="Match reminders" detail="One hour before every match" value={preferences.reminders} onToggle={(value) => setPreference('reminders', value)} />
        <SettingRow icon="sync-outline" title="Calendar sync" detail={preferences.calendar ? 'Syncing with your calendar' : 'Not connected'} value={preferences.calendar} onToggle={(value) => setPreference('calendar', value)} />
      </View>
      <Text style={styles.settingsLabel}>ACCOUNT & PLAY</Text>
      <View style={styles.settingsCard}>
        <SettingRow icon="person-outline" title="Account details" detail="Name, email, and location" onPress={() => onAction('Edit profile')} border={false} />
        <SettingRow icon="shield-checkmark-outline" title="Privacy" detail="Friends can find you" onPress={() => onAction('Privacy preferences saved')} />
        <SettingRow icon="card-outline" title="Payment methods" detail="Pay at venue is your default" onPress={() => onAction('Payment methods')} />
        <SettingRow icon="analytics-outline" title="Performance rating" detail="Calculated from completed match scores" onPress={() => onAction('Performance rating')} />
        <SettingRow icon="time-outline" title="Last active" detail={formatLastLogin(lastLogin)} />
      </View>
      <Text style={styles.settingsLabel}>SUPPORT</Text>
      <View style={styles.settingsCard}>
        <SettingRow icon="help-circle-outline" title="Help and support" onPress={() => onAction('Help and support')} border={false} />
        <SettingRow icon="log-out-outline" title="Log out" destructive onPress={() => onAction('Log out')} />
      </View>
      <Text style={styles.version}>PEAKLE · VERSION 1.0.0</Text>
    </View>
  );
}

function OrganizerOverview({ onMonitor }) {
  return (
    <View>
      <View style={styles.organizerHero}>
        <View style={styles.organizerHeroHead}><View style={styles.organizerHeroIcon}><Icon name="key" size={20} /></View><View style={styles.flex}><Text style={styles.organizerHeroEyebrow}>ORGANIZER ACCESS</Text><Text style={styles.organizerHeroTitle}>Ready to run the room</Text></View><View style={styles.organizerVerified}><Icon name="checkmark" size={13} color={C.teal} /><Text style={styles.organizerVerifiedText}>ACTIVE</Text></View></View>
        <Text style={styles.organizerHeroBody}>Create open play sessions, manage player rotation, monitor every court, and override match scores when needed.</Text>
        <Pressable onPress={onMonitor} style={styles.organizerMonitorButton}><Text style={styles.organizerMonitorText}>Open court monitor</Text><Icon name="arrow-forward" size={17} /></Pressable>
      </View>

      <View style={styles.sectionHeader}><View><Text style={styles.eyebrow}>HOSTING SNAPSHOT</Text><Text style={styles.h2}>Your organizer record</Text></View></View>
      <View style={styles.organizerStats}>
        <View style={styles.organizerStat}><Text style={styles.organizerStatValue}>—</Text><Text style={styles.organizerStatLabel}>SESSIONS</Text><Text style={styles.organizerStatMeta}>No record</Text></View>
        <View style={styles.organizerStat}><Text style={styles.organizerStatValue}>—</Text><Text style={styles.organizerStatLabel}>MATCHES</Text><Text style={styles.organizerStatMeta}>No record</Text></View>
        <View style={styles.organizerStat}><Text style={styles.organizerStatValue}>—</Text><Text style={styles.organizerStatLabel}>CHECK-INS</Text><Text style={styles.organizerStatMeta}>No record</Text></View>
      </View>

      <View style={styles.sectionHeader}><View><Text style={styles.eyebrow}>YOUR CAPABILITIES</Text><Text style={styles.h2}>Access and participation</Text></View></View>
      <View style={styles.capabilitiesCard}>
        <View style={styles.capabilityRow}><View style={styles.capabilityIcon}><Icon name="key-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.capabilityTitle}>Organizer</Text><Text style={styles.capabilityDetail}>Manage sessions, courts, queues, and results.</Text></View><Icon name="checkmark-circle" color={C.teal} /></View>
        <View style={[styles.capabilityRow, styles.rowBorder]}><View style={styles.capabilityIcon}><Icon name="tennisball-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.capabilityTitle}>Player</Text><Text style={styles.capabilityDetail}>Join your own session without giving up organizer access.</Text></View><Icon name="checkmark-circle" color={C.teal} /></View>
      </View>
    </View>
  );
}

function OrganizerHistory() {
  return <View style={styles.empty}><Icon name="calendar-outline" size={38} color={C.teal} /><Text style={styles.emptyTitle}>No organizer sessions recorded</Text><Text style={styles.settingDetail}>Completed sessions will appear here when organizer history is connected.</Text></View>;
}

function OrganizerSettings({ preferences, setPreference, onAction }) {
  return <View><Text style={styles.settingsLabel}>SESSION OPERATIONS</Text><View style={styles.settingsCard}><SettingRow icon="notifications-outline" title="Court alerts" detail="Match point, finished games, and open courts" value={preferences.squad} onToggle={(value) => setPreference('squad', value)} border={false} /><SettingRow icon="people-outline" title="Check-in alerts" detail="Notify when players join your session" value={preferences.reminders} onToggle={(value) => setPreference('reminders', value)} /></View><Text style={styles.settingsLabel}>ORGANIZER ACCOUNT</Text><View style={styles.settingsCard}><SettingRow icon="person-outline" title="Organizer details" detail="Public host name and home venue" onPress={() => onAction('Edit profile')} border={false} /><SettingRow icon="options-outline" title="Default open play rules" detail="Doubles · First to 11 · Win by 2" onPress={() => onAction('Default open play rules')} /><SettingRow icon="shield-checkmark-outline" title="Staff access" detail="Invite another organizer or court monitor" onPress={() => onAction('Staff access')} /></View><Text style={styles.settingsLabel}>SUPPORT</Text><View style={styles.settingsCard}><SettingRow icon="help-circle-outline" title="Organizer help" onPress={() => onAction('Organizer help')} border={false} /><SettingRow icon="log-out-outline" title="Log out" destructive onPress={() => onAction('Log out')} /></View><Text style={styles.version}>PEAKLE ORGANIZER · VERSION 1.0.0</Text></View>;
}

function EditProfile({ visible, player, onClose, onSave }) {
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
          <Text style={styles.inputLabel}>DISPLAY NAME</Text><TextInput value={name} onChangeText={setName} style={styles.input} placeholderTextColor={C.ink40} />
          <Text style={styles.inputLabel}>HOME AREA</Text><TextInput value={location} onChangeText={setLocation} style={styles.input} placeholderTextColor={C.ink40} />
          <Text style={styles.inputLabel}>CARTOON AVATAR</Text><AvatarBuilder initialAvatar={avatar} onAvatarChange={setAvatar} />
          <View style={styles.ratingNotice}><Icon name="analytics-outline" color={C.teal} /><Text style={styles.settingDetail}>Your performance rating is earned from completed match scores and cannot be edited manually.</Text></View>
          <Text style={styles.inputLabel}>PLAY PREFERENCE</Text><View style={styles.editChoiceRow}>{['Singles', 'Doubles', 'Both'].map((value) => <Pressable key={value} onPress={() => setPreference(value)} style={[styles.editChoice, preference === value && styles.editChoiceActive]}><Text style={[styles.editChoiceText, preference === value && styles.editChoiceTextActive]}>{value}</Text></Pressable>)}</View>
        </ScrollView>
        <View style={styles.editProfileFooter}>
          {error ? <Text style={styles.editError}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Save profile changes" disabled={isSaving} onPress={save} style={({ pressed }) => [styles.primaryButton, styles.editSaveButton, isSaving && styles.disabled, pressed && !isSaving && styles.pressed]}><Text style={styles.primaryText}>{isSaving ? 'Saving…' : 'Save changes'}</Text><Icon name="checkmark" color="#0E2321" /></Pressable>
        </View>
      </View>
    </Sheet>
  );
}

export default function ProfileScreen({ navigation, route }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { mode, setMode } = useAppMode();
  const { user, updateProfile, signOut } = useAuth();
  const { hasOrganizerAccess, passTier } = useOrganizerPass();
  const { notifications: operationNotifications, unreadCount, readNotification, enablePushNotifications, disablePushNotifications } = useOperations();
  const [tab, setTab] = useState('Overview');
  const [player, setPlayer] = useState({ name: user?.name || 'Player', location: user?.location || 'Metro Manila', avatar: user?.picture, skill: user?.skill || '—', preference: user?.preference || 'Doubles', presenceStatus: user?.presenceStatus || 'free' });
  const [editOpen, setEditOpen] = useState(false);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [achievement, setAchievement] = useState(null);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [toast, setToast] = useState('');
  const [preferences, setPreferences] = useState(user?.preferences || { squad: true, reminders: true, calendar: false });
  const [pendingMode, setPendingMode] = useState(null);
  const [recordedMatches, setRecordedMatches] = useState([]);
  const [joinedTeams, setJoinedTeams] = useState([]);
  const performanceRating = useMemo(() => calculatePerformanceRating(recordedMatches), [recordedMatches]);
  const notices = useMemo(() => operationNotifications.map((notice) => ({
    ...notice,
    group: new Date(notice.created_at).toDateString() === new Date().toDateString() ? 'TODAY' : 'EARLIER',
    icon: ({ approval: 'checkmark-circle-outline', waitlist_promotion: 'arrow-up-circle-outline', check_in_reminder: 'time-outline', court_assignment: 'tennisball-outline', match_point: 'flag-outline', result: 'trophy-outline', cancellation: 'close-circle-outline', venue_announcement: 'megaphone-outline' })[notice.kind] || 'notifications-outline',
    time: new Date(notice.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
  })), [operationNotifications]);

  useEffect(() => {
    if (user) setPlayer({ name: user.name, location: user.location, avatar: user.picture, skill: user.skill, preference: user.preference, presenceStatus: user.presenceStatus || 'free' });
  }, [user]);

  useEffect(() => {
    const requestedTab = route.params?.openTab;
    if (mode === 'player' && ['Overview', 'Matches', 'Settings'].includes(requestedTab)) setTab(requestedTab);
    if (mode === 'organizer' && ['Overview', 'Sessions', 'Settings'].includes(requestedTab)) setTab(requestedTab);
  }, [route.params?.openTab, route.params?.openTabToken, mode]);

  const showToast = (message) => { setToast(message); setTimeout(() => setToast(''), 2200); };
  useEffect(() => {
    let active = true;
    const loadProfileData = async () => {
      const [matchResult, teamResult] = await Promise.allSettled([listMyMatches(), listTeams()]);
      if (!active) return;
      if (matchResult.status === 'fulfilled') setRecordedMatches(matchResult.value);
      else showToast(matchResult.reason?.message || 'Match history unavailable.');
      if (teamResult.status === 'fulfilled') setJoinedTeams(teamResult.value.filter((team) => team.role));
      else setJoinedTeams([]);
    };
    loadProfileData();
    const unsubscribe = navigation.addListener('focus', loadProfileData);
    return () => { active = false; unsubscribe(); };
  }, [navigation, user?.id]);
  const setPreference = async (key, value) => {
    if (value && ['squad', 'reminders'].includes(key)) {
      try { await enablePushNotifications(); } catch (error) { showToast(error.message || 'Push notifications could not be enabled.'); return; }
    }
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    if (!next.squad && !next.reminders) disablePushNotifications().catch(() => {});
    updateProfile({ preferences: next }).catch((error) => showToast(error.message || 'Could not save preference.'));
    showToast(`${mode === 'organizer' ? (key === 'squad' ? 'Court alerts' : 'Check-in alerts') : key === 'squad' ? 'Squad notifications' : key === 'reminders' ? 'Match reminders' : 'Calendar sync'} ${value ? 'on' : 'off'}.`);
  };
  const handleSetting = (action) => {
    if (action === 'Edit profile') { setEditOpen(true); return; }
    if (action === 'Staff access') { navigation.navigate('Staff'); return; }
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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}><View><Text style={styles.eyebrow}>{mode === 'organizer' ? 'YOUR ACCOUNT' : 'YOUR GAME'}</Text><Text style={styles.h1}>{mode === 'organizer' ? 'Organizer profile' : 'Player profile'}</Text></View><View style={styles.topActions}><Pressable accessibilityLabel="Notifications" onPress={() => setNotificationsOpen(true)} style={styles.iconButton}><Icon name="notifications-outline" />{unreadCount > 0 && <View style={styles.noticeDot} />}</Pressable></View></View>
        <KitchenLine />
        <View style={styles.identity}>
          <View accessibilityLabel={mode === 'organizer' ? 'Organizer profile' : 'Player profile'} style={styles.avatar}><CartoonAvatar avatar={player.avatar} name={player.name} size={67} /><Pressable accessibilityRole="button" accessibilityLabel={`Change player status. Current status ${presenceOption(player.presenceStatus).label}`} onPress={() => setPresenceOpen(true)} hitSlop={8} style={styles.avatarStatusButton}><View style={[styles.avatarStatusDot, { backgroundColor: presenceOption(player.presenceStatus).color }]} /></Pressable></View>
          <View style={styles.identityCopy}><View style={styles.playerNameRow}><Text numberOfLines={1} style={styles.playerName}>{player.name}</Text><AccountTierBadge tier={passTier} /><Pressable accessibilityLabel={`Edit profile. Status ${presenceOption(player.presenceStatus).label}`} onPress={() => setEditOpen(true)} hitSlop={8} style={styles.editProfileButton}><Icon name="create-outline" size={18} color={C.ink40} /></Pressable></View><View style={styles.location}><Icon name="location-outline" size={13} color={C.ink40} /><Text style={styles.locationText}>{player.location}</Text></View><View style={styles.squad}><Icon name={mode === 'organizer' ? 'key' : 'people'} size={12} color={C.teal} /><Text style={styles.squadText}>{mode === 'organizer' ? 'Open Play Organizer' : joinedTeams.length ? `${joinedTeams[0].name}${joinedTeams.length > 1 ? ` +${joinedTeams.length - 1}` : ''}` : 'No team joined'}</Text></View></View>
          <View style={styles.rating}><Text style={styles.ratingValue}>{mode === 'organizer' ? '—' : performanceRating ?? '—'}</Text><Text style={styles.ratingTier}>{mode === 'organizer' ? 'SESSIONS' : performanceRating == null ? 'UNRATED' : 'PERFORMANCE'}</Text><Text style={styles.ratingTrend}>{mode === 'organizer' ? 'HOSTED' : `${recordedMatches.length} RECORDED`}</Text></View>
        </View>
        <AppModeSwitch mode={mode} organizerUnlocked={hasOrganizerAccess} onChange={setPendingMode} onOrganizerPass={() => navigation.navigate('Pass')} />
        <View style={styles.tabs}>{(mode === 'organizer' ? ['Overview', 'Sessions', 'Settings'] : ['Overview', 'Matches', 'Settings']).map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}</View>
        {mode === 'player' && tab === 'Overview' && <Overview matches={recordedMatches} onAchievement={setAchievement} onSeeMatches={() => setTab('Matches')} onMatch={setSelectedMatch} onStartFocus={() => {
          if (mode === 'organizer') { setMode('player'); return; }
          navigation.navigate('Play', { focusChallengeToken: Date.now(), focusChallenge: { id: 'return-depth-7-of-10', title: 'Return depth', instruction: 'Land 7 of your first 10 returns past mid-court.', target: 7, attempts: 10 } });
        }} />}
        {mode === 'player' && tab === 'Matches' && <History source={recordedMatches} onMatch={setSelectedMatch} />}
        {mode === 'player' && tab === 'Settings' && <Settings preferences={preferences} setPreference={setPreference} onAction={handleSetting} lastLogin={user?.lastLogin} />}
        {mode === 'organizer' && tab === 'Overview' && <OrganizerOverview onMonitor={() => navigation.navigate('Monitor')} />}
        {mode === 'organizer' && tab === 'Sessions' && <OrganizerHistory />}
        {mode === 'organizer' && tab === 'Settings' && <OrganizerSettings preferences={preferences} setPreference={setPreference} onAction={handleSetting} />}
      </ScrollView>

      <EditProfile visible={editOpen} player={player} onClose={() => setEditOpen(false)} onSave={async (value) => { await updateProfile(value); setPlayer((current) => ({ ...current, ...value })); setEditOpen(false); showToast('Profile updated.'); }} />
      <Sheet visible={presenceOpen} title="Player status" eyebrow="AVAILABILITY" onClose={() => setPresenceOpen(false)}>
        <Text style={styles.statusSheetLead}>Choose how you appear to nearby players and match invitations.</Text>
        <View style={styles.statusSheetCard}>{PRESENCE_OPTIONS.map((option, index) => { const selected = (player.presenceStatus || 'free') === option.value; return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => changePresenceStatus(option.value)} style={[styles.statusSheetRow, index > 0 && styles.rowBorder]}><View style={[styles.statusSheetDot, { backgroundColor: option.color }]} /><View style={styles.flex}><Text style={styles.statusSheetTitle}>{option.label}</Text><Text style={styles.statusSheetDetail}>{option.detail}</Text></View>{selected && <Icon name="checkmark-circle" size={20} color={C.teal} />}</Pressable>; })}</View>
      </Sheet>
      <Sheet visible={notificationsOpen} title="Notifications" eyebrow="INBOX" onClose={() => setNotificationsOpen(false)}>
        <ScrollView showsVerticalScrollIndicator={false}>{notices.length ? notices.map((notice, index) => <View key={notice.id}>{(index === 0 || notices[index - 1].group !== notice.group) && <Text style={styles.noticeGroup}>{notice.group}</Text>}<View style={[styles.noticeRow, notice.read_at && { opacity: .62 }]}><View style={styles.noticeIcon}><Icon name={notice.icon} size={18} color={C.teal} /></View><View style={styles.noticeCopy}><Text style={styles.noticeTitle}>{notice.title}</Text><Text style={styles.noticeBody}>{notice.body}</Text><Text style={styles.noticeTime}>{notice.time}</Text></View>{!notice.read_at && <Pressable accessibilityLabel={`Mark ${notice.title} read`} onPress={() => readNotification(notice.id).catch(() => {})} style={styles.dismiss}><Icon name="checkmark" size={17} color={C.teal} /></Pressable>}</View></View>) : <View style={styles.empty}><Icon name="checkmark-circle-outline" size={38} color={C.teal} /><Text style={styles.emptyTitle}>You're caught up</Text><Text style={styles.settingDetail}>Open-play operations and venue updates will appear here.</Text></View>}</ScrollView>
      </Sheet>
      <Sheet visible={Boolean(achievement)} title={achievement?.name || ''} eyebrow={achievement?.earned ? 'ACHIEVEMENT EARNED' : 'IN PROGRESS'} onClose={() => setAchievement(null)}>
        <View style={[styles.achievementDetailIcon, !achievement?.earned && styles.achievementIconLocked]}><Icon name={achievement?.earned ? achievement?.icon : 'lock-closed-outline'} size={31} /></View><Text style={styles.achievementDetail}>{achievement?.detail}</Text><Text style={styles.achievementProgress}>{achievement?.earned ? `Earned ${achievement?.date}` : achievement?.date}</Text><Pressable onPress={() => setAchievement(null)} style={styles.primaryButton}><Text style={styles.primaryText}>{achievement?.earned ? 'Nice work' : 'Keep playing'}</Text></Pressable>
      </Sheet>
      <Sheet fullHeight visible={Boolean(selectedMatch)} title="Box score" eyebrow="COMPLETED MATCH" onClose={() => setSelectedMatch(null)}><BoxScore match={selectedMatch} playerName={player.name} /></Sheet>
      <ModeChangeModal nextMode={pendingMode} onCancel={() => setPendingMode(null)} onConfirm={() => { const nextMode = pendingMode; setPendingMode(null); setMode(nextMode); }} />
      {toast ? <View style={styles.toast}><Icon name="checkmark-circle" size={17} color={C.optic} /><Text style={styles.toastText}>{toast}</Text></View> : null}
    </SafeAreaView>
  );
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: .08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 } });
const lightStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper }, content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 40 }, flex: { flex: 1 },
  topbar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, topActions: { flexDirection: 'row', gap: 8 }, eyebrow: { color: C.ink40, fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1 }, h1: { color: C.ink, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -.8 }, h2: { color: C.ink, fontSize: 21, lineHeight: 27, fontWeight: '800', letterSpacing: -.4 },
  iconButton: { width: 43, height: 43, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }, noticeDot: { position: 'absolute', right: 9, top: 8, width: 7, height: 7, borderRadius: 4, borderWidth: 1, borderColor: C.surface, backgroundColor: C.brick },
  kitchen: { height: 7, marginTop: 18, marginBottom: 22 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 }, solidQuiet: { backgroundColor: C.line }, dashedQuiet: { borderColor: C.line },
  identity: { flexDirection: 'row', alignItems: 'center' }, avatar: { width: 67, height: 67, borderRadius: 34, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: C.surface, fontSize: 17, fontWeight: '900' }, avatarStatusButton: { position: 'absolute', right: -2, bottom: 0, width: 25, height: 25, alignItems: 'center', justifyContent: 'center' }, avatarStatusDot: { width: 15, height: 15, borderRadius: 8, borderWidth: 3, borderColor: C.paper }, identityCopy: { flex: 1, marginLeft: 13 }, playerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 }, playerName: { maxWidth: 145, flexShrink: 1, color: C.ink, fontSize: 21, fontWeight: '800' }, accountTierBadge: { minWidth: 40, height: 19, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: '#B58B2A', backgroundColor: '#FBF5E4' }, accountTierBadgePro: { borderColor: '#8C98A3', backgroundColor: '#EEF1F3' }, accountTierBadgeAdmin: { borderColor: '#B94235', backgroundColor: '#FBEDEA' }, accountTierText: { color: '#7A5A08', fontSize: 5.5, fontWeight: '900', letterSpacing: .65 }, accountTierTextPro: { color: '#46515B' }, accountTierTextAdmin: { color: '#9F2F25' }, editProfileButton: { width: 27, height: 27, alignItems: 'center', justifyContent: 'center' }, location: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 3 }, locationText: { color: C.ink40, fontSize: 10 }, squad: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }, squadText: { color: C.teal, fontSize: 10, fontWeight: '800' }, rating: { alignItems: 'flex-end' }, ratingValue: { color: C.ink, fontSize: 30, lineHeight: 32, fontWeight: '900' }, ratingTier: { marginTop: 2, color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, ratingTrend: { marginTop: 3, color: C.teal, fontSize: 9, fontWeight: '800' },
  appModeCard: { marginTop: 18, padding: 13, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, appModeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, appModeEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, appModeTitle: { marginTop: 2, color: C.ink, fontSize: 11, fontWeight: '900' }, capabilityPill: { minHeight: 23, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.tealWash }, capabilityText: { color: C.teal, fontSize: 6, fontWeight: '900' }, appModeControl: { marginTop: 11, padding: 4, flexDirection: 'row', gap: 4, borderRadius: 14, backgroundColor: '#E5E9E3' }, appModeOption: { minHeight: 43, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10 }, appModeOptionActive: { backgroundColor: C.optic, ...shadow }, appModeOptionLocked: { opacity: .72 }, appModeOptionText: { color: C.ink40, fontSize: 10, fontWeight: '800' }, appModeOptionTextActive: { color: C.ink, fontWeight: '900' }, appModeActiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.teal }, appModeHelp: { marginTop: 9, color: C.ink40, fontSize: 8, lineHeight: 12 },
  modeModalBackdrop: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,35,33,.58)' }, modeDialog: { width: '100%', maxWidth: 370, padding: 20, borderRadius: 23, backgroundColor: C.paper, ...shadow }, modeDialogIcon: { width: 54, height: 54, marginBottom: 14, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, modeDialogEyebrow: { color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .9 }, modeDialogTitle: { marginTop: 4, color: C.ink, fontSize: 22, lineHeight: 28, fontWeight: '900' }, modeDialogBody: { marginTop: 7, color: C.ink70, fontSize: 10, lineHeight: 16 }, modeDialogNote: { minHeight: 56, marginTop: 14, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 13, backgroundColor: C.tealWash }, modeDialogNoteText: { flex: 1, color: C.ink70, fontSize: 8, lineHeight: 12 }, modeDialogActions: { marginTop: 16, flexDirection: 'row', gap: 9 }, modeCancelButton: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, modeCancelText: { color: C.ink40, fontSize: 9, fontWeight: '900' }, modeConfirmButton: { minHeight: 48, flex: 1.35, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.ink }, modeConfirmText: { color: C.surface, fontSize: 9, fontWeight: '900' },
  organizerHero: { padding: 16, borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: C.ink }, organizerHeroHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, organizerHeroIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, organizerHeroEyebrow: { color: '#9FB3AC', fontSize: 7, fontWeight: '900', letterSpacing: .8 }, organizerHeroTitle: { marginTop: 2, color: C.surface, fontSize: 15, fontWeight: '900' }, organizerVerified: { minHeight: 25, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 13, backgroundColor: C.tealWash }, organizerVerifiedText: { color: C.teal, fontSize: 6, fontWeight: '900' }, organizerHeroBody: { marginTop: 13, color: '#CBD7D2', fontSize: 9, lineHeight: 14 }, organizerMonitorButton: { minHeight: 48, marginTop: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, backgroundColor: C.optic }, organizerMonitorText: { color: C.ink, fontSize: 10, fontWeight: '900' }, organizerStats: { paddingVertical: 16, flexDirection: 'row', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, organizerStat: { flex: 1, alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderColor: C.line }, organizerStatValue: { color: C.ink, fontSize: 24, fontWeight: '900' }, organizerStatLabel: { marginTop: 3, color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, organizerStatMeta: { marginTop: 3, color: C.ink40, fontSize: 7 }, capabilitiesCard: { paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, capabilityRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10 }, capabilityIcon: { width: 39, height: 39, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.tealWash }, capabilityTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, capabilityDetail: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 },
  organizerHistorySummary: { minHeight: 100, padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 18, backgroundColor: C.ink }, organizerHistoryTitle: { marginTop: 3, color: C.surface, fontSize: 16, fontWeight: '900' }, organizerHistoryBadge: { alignItems: 'flex-end' }, organizerHistoryBadgeValue: { color: C.optic, fontSize: 25, fontWeight: '900' }, organizerHistoryBadgeLabel: { marginTop: 2, color: '#9FB3AC', fontSize: 6, fontWeight: '900' }, organizerSessionsCard: { paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, organizerSessionRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 9 }, organizerDate: { width: 45, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.tealWash }, organizerDateText: { color: C.teal, fontSize: 7, fontWeight: '900' }, organizerSessionTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, organizerSessionMeta: { marginTop: 4, color: C.ink40, fontSize: 8 }, organizerMatchCount: { alignItems: 'flex-end' }, organizerMatchValue: { color: C.ink, fontSize: 16, fontWeight: '900' }, organizerMatchLabel: { color: C.ink40, fontSize: 5, fontWeight: '900' },
  tabs: { marginTop: 20, marginBottom: 18, padding: 4, flexDirection: 'row', borderRadius: 13, backgroundColor: '#E5E9E3' }, tab: { flex: 1, minHeight: 41, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, tabActive: { backgroundColor: C.optic, ...shadow }, tabText: { color: C.ink40, fontSize: 11, fontWeight: '800' }, tabTextActive: { color: C.ink },
  focusCard: { marginBottom: 13, padding: 16, borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: C.ink, ...shadow }, focusTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, focusIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.optic, alignItems: 'center', justifyContent: 'center' }, focusEyebrow: { color: '#9FB3AC', fontSize: 8, fontWeight: '900', letterSpacing: .9 }, focusTitle: { marginTop: 2, color: C.surface, fontSize: 17, fontWeight: '900' }, priorityBadge: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7, backgroundColor: 'rgba(214,233,74,.14)' }, priorityText: { color: C.optic, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, focusWhy: { marginTop: 13, color: '#D9E1DD', fontSize: 10, lineHeight: 15 }, focusStrong: { color: C.surface, fontWeight: '900' }, progressTrack: { height: 7, marginTop: 13, overflow: 'hidden', borderRadius: 4, backgroundColor: '#334946' }, progressFill: { width: '48%', height: '100%', borderRadius: 4, backgroundColor: C.optic }, progressLabels: { marginTop: 5, flexDirection: 'row', justifyContent: 'space-between' }, progressCurrent: { color: C.optic, fontSize: 7, fontWeight: '900' }, progressGoal: { color: '#9FB3AC', fontSize: 7, fontWeight: '900' }, nextAction: { minHeight: 65, marginTop: 13, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 11, backgroundColor: C.surface }, nextActionPressed: { opacity: .82, transform: [{ scale: .985 }] }, nextActionIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, nextActionCopy: { flex: 1 }, nextActionText: { color: C.ink70, fontSize: 9, lineHeight: 13 }, nextActionStrong: { color: C.ink, fontWeight: '900' }, nextActionCta: { marginTop: 4, color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .65 },
  statCard: { padding: 15, flexDirection: 'row', alignItems: 'center', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, ring: { width: 82, height: 82, alignItems: 'center', justifyContent: 'center' }, ringInner: { alignItems: 'center' }, ringValue: { color: C.ink, fontSize: 22, fontWeight: '900' }, ringPercent: { fontSize: 11 }, statLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, statBlock: { flex: 1, marginLeft: 15 }, statValue: { color: C.ink, fontSize: 23, fontWeight: '900' }, statMeta: { marginTop: 4, color: C.ink40, fontSize: 8 }, streakMeta: { marginTop: 4, color: C.brick, fontSize: 7, fontWeight: '800' }, statDivider: { width: 1, height: 42, backgroundColor: C.line },
  chartCard: { marginTop: 13, padding: 16, borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, cardTitle: { marginTop: 2, color: C.ink, fontSize: 15, fontWeight: '800' }, changeBadge: { paddingHorizontal: 8, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, backgroundColor: C.tealWash }, changeText: { color: C.teal, fontSize: 10, fontWeight: '900' }, chart: { height: 96, marginTop: 12, overflow: 'hidden' }, gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: C.line }, chartBars: { position: 'absolute', left: 0, right: 0, bottom: 1, height: 80, flexDirection: 'row', alignItems: 'flex-end' }, barSlot: { flex: 1, height: 80, alignItems: 'center', justifyContent: 'flex-end' }, bar: { width: 8, minHeight: 9, borderRadius: 4, backgroundColor: '#A6C6C0' }, barCurrent: { width: 10, backgroundColor: C.teal }, chartLabels: { flexDirection: 'row', justifyContent: 'space-between' }, chartLabel: { color: C.ink40, fontSize: 7, fontWeight: '800' },
  sectionHeader: { marginTop: 24, marginBottom: 11, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, sectionMeta: { color: C.ink40, fontSize: 8, fontWeight: '800' }, link: { paddingVertical: 4, color: C.teal, fontSize: 11, fontWeight: '800' }, insightGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, insight: { width: '48.5%', minHeight: 105, padding: 13, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, insightValue: { marginTop: 9, color: C.ink, fontSize: 23, fontWeight: '900' }, insightValueSmall: { marginTop: 10, color: C.ink, fontSize: 14, fontWeight: '900' }, insightLabel: { marginTop: 3, color: C.ink40, fontSize: 9 },
  achievementRow: { gap: 9, paddingRight: 20 }, achievement: { width: 116, minHeight: 133, padding: 12, borderRadius: 17, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, achievementLocked: { opacity: .62, backgroundColor: '#ECEFEA' }, achievementIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.optic, alignItems: 'center', justifyContent: 'center' }, achievementIconLocked: { backgroundColor: C.line }, achievementName: { marginTop: 10, minHeight: 30, color: C.ink, fontSize: 11, lineHeight: 15, fontWeight: '800' }, achievementDate: { color: C.ink40, fontSize: 8 },
  matchCard: { overflow: 'hidden', borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, matchRow: { minHeight: 83, marginHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 }, rowBorder: { borderTopWidth: 1, borderColor: C.line }, result: { width: 31, height: 31, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, resultWin: { backgroundColor: C.tealWash }, resultLoss: { backgroundColor: C.brickWash }, resultText: { color: C.teal, fontSize: 10, fontWeight: '900' }, resultTextLoss: { color: C.brick }, matchCopy: { flex: 1 }, matchOpponent: { color: C.ink, fontSize: 10, fontWeight: '800' }, matchMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, matchLearning: { marginTop: 4, fontSize: 7, fontWeight: '800' }, scoreCopy: { alignItems: 'flex-end' }, matchScore: { color: C.ink, fontSize: 10, fontWeight: '900' }, matchDate: { marginTop: 3, color: C.ink40, fontSize: 7, fontWeight: '800' }, ratingChange: { width: 25, textAlign: 'right', fontSize: 8, fontWeight: '900' }, positive: { color: C.teal }, negative: { color: C.brick }, muted: { color: C.ink40 }, pressed: { opacity: .75, transform: [{ scale: .985 }] },
  historySummary: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 18, backgroundColor: C.ink }, record: { alignItems: 'flex-end' }, recordValue: { color: C.optic, fontSize: 23, fontWeight: '900' }, patternCard: { marginTop: 12, padding: 15, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, patternHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, patternTitle: { marginTop: 2, color: C.ink, fontSize: 14, fontWeight: '900' }, formRecord: { color: C.teal, fontSize: 19, fontWeight: '900' }, recentForm: { marginTop: 14, flexDirection: 'row', gap: 7 }, patternMetrics: { marginTop: 14, flexDirection: 'row' }, patternMetric: { flex: 1, alignItems: 'center' }, patternDivider: { width: 1, backgroundColor: C.line }, patternValue: { color: C.ink, fontSize: 18, fontWeight: '900' }, patternLabel: { marginTop: 2, color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .3 }, patternStatus: { marginTop: 4, color: C.teal, fontSize: 7, fontWeight: '800' }, patternNeeds: { marginTop: 4, color: C.brick, fontSize: 7, fontWeight: '800' }, patternCopy: { marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderColor: C.line, color: C.ink70, fontSize: 9, lineHeight: 13 }, filters: { marginVertical: 13, flexDirection: 'row', gap: 8 }, filter: { minHeight: 36, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, filterActive: { borderColor: C.ink, backgroundColor: C.ink }, filterText: { color: C.ink70, fontSize: 10, fontWeight: '800' }, filterTextActive: { color: C.paper }, endNote: { paddingVertical: 18, textAlign: 'center', color: C.ink40, fontSize: 9 },
  settingsLabel: { marginTop: 5, marginBottom: 8, color: C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: .8 }, settingsCard: { marginBottom: 21, paddingHorizontal: 13, overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, settingRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 10 }, settingIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.tealWash }, settingIconDanger: { backgroundColor: '#F7E7E4' }, settingCopy: { flex: 1 }, settingTitle: { color: C.ink, fontSize: 11, fontWeight: '800' }, settingDetail: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 }, danger: { color: C.error }, toggle: { width: 43, height: 25, padding: 3, borderRadius: 13, backgroundColor: C.line }, toggleOn: { backgroundColor: C.optic }, toggleKnob: { width: 19, height: 19, borderRadius: 10, backgroundColor: C.surface, ...shadow }, toggleKnobOn: { transform: [{ translateX: 18 }] }, version: { marginTop: 2, textAlign: 'center', color: C.ink40, fontSize: 7, fontWeight: '800', letterSpacing: .7 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.42)' }, backdropDismiss: { ...StyleSheet.absoluteFillObject }, sheet: { maxHeight: '84%', paddingHorizontal: 20, paddingTop: 9, paddingBottom: 30, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: C.paper }, sheetTall: { height: '92%', maxHeight: '92%', paddingBottom: 12 }, sheetBody: { flexShrink: 1 }, sheetBodyScrollable: { flex: 1, minHeight: 0, overflow: 'hidden' }, handle: { width: 38, height: 4, marginBottom: 15, alignSelf: 'center', borderRadius: 2, backgroundColor: C.line }, sheetHeader: { flexDirection: 'row', alignItems: 'center' }, sheetTitle: { color: C.ink, fontSize: 25, fontWeight: '800' }, sheetLine: { marginTop: 15, marginBottom: 13 },
  inputLabel: { marginTop: 10, marginBottom: 6, color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 }, input: { height: 50, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, fontSize: 13 }, ratingNotice: { marginTop: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, backgroundColor: C.tealWash }, profileAvatarPicker: { gap: 9, paddingVertical: 2, paddingRight: 15 }, profileAvatarChoice: { width: 58, height: 58, borderRadius: 18, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface }, profileAvatarChoiceActive: { borderColor: C.ink, backgroundColor: C.optic }, editProfileLayout: { flex: 1, minHeight: 0 }, editProfileScroll: { flex: 1, minHeight: 0 }, editProfileContent: { paddingBottom: 14 }, editProfileFooter: { paddingTop: 8, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.paper }, editChoiceRow: { flexDirection: 'row', gap: 6 }, editChoice: { minHeight: 38, flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: C.surface }, editChoiceActive: { borderColor: C.ink, backgroundColor: C.optic }, editChoiceText: { color: C.ink40, fontSize: 8, fontWeight: '900' }, editChoiceTextActive: { color: C.ink }, editError: { marginTop: 4, color: C.error, fontSize: 9 }, primaryButton: { minHeight: 52, marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: C.optic }, editSaveButton: { marginTop: 8 }, primaryText: { color: C.ink, fontSize: 12, fontWeight: '900' }, disabled: { opacity: .4 },
  statusSheetLead: { marginBottom: 12, color: C.ink40, fontSize: 9, lineHeight: 14 }, statusSheetCard: { paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, statusSheetRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10 }, statusSheetDot: { width: 12, height: 12, borderRadius: 6 }, statusSheetTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, statusSheetDetail: { marginTop: 3, color: C.ink40, fontSize: 8 },
  noticeGroup: { marginTop: 8, marginBottom: 5, color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 }, noticeRow: { minHeight: 77, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: C.line }, noticeIcon: { width: 39, height: 39, borderRadius: 12, backgroundColor: C.tealWash, alignItems: 'center', justifyContent: 'center' }, noticeCopy: { flex: 1 }, noticeTitle: { color: C.ink, fontSize: 11, fontWeight: '800' }, noticeBody: { marginTop: 3, color: C.ink70, fontSize: 9, lineHeight: 13 }, noticeTime: { marginTop: 4, color: C.ink40, fontSize: 7 }, dismiss: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }, empty: { paddingVertical: 55, alignItems: 'center' }, emptyTitle: { marginTop: 11, marginBottom: 3, color: C.ink, fontSize: 16, fontWeight: '800' },
  achievementDetailIcon: { width: 70, height: 70, marginTop: 7, marginBottom: 15, alignSelf: 'center', borderRadius: 23, backgroundColor: C.optic, alignItems: 'center', justifyContent: 'center' }, achievementDetail: { color: C.ink70, textAlign: 'center', fontSize: 13, lineHeight: 19 }, achievementProgress: { marginTop: 7, color: C.teal, textAlign: 'center', fontSize: 10, fontWeight: '800' },
  boxScroll: { flex: 1, minHeight: 0 }, boxContent: { flexGrow: 0, paddingBottom: 72 }, boxResult: { padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, backgroundColor: C.teal }, boxResultLoss: { backgroundColor: C.brick }, boxResultLabel: { color: 'rgba(255,255,255,.7)', fontSize: 8, fontWeight: '900', letterSpacing: .7 }, boxResultScore: { marginTop: 2, color: C.surface, fontSize: 29, fontWeight: '900' }, boxResultMeta: { alignItems: 'flex-end' }, boxType: { color: C.surface, fontSize: 10, fontWeight: '800' }, boxRating: { marginTop: 3, color: 'rgba(255,255,255,.7)', fontSize: 8 }, boxVenue: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 6 }, boxVenueText: { color: C.ink70, fontSize: 9, fontWeight: '700' }, takeawayCard: { marginBottom: 13, padding: 12, flexDirection: 'row', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: '#C9DCD7', backgroundColor: C.tealWash }, takeawayCardLoss: { borderColor: '#E7CFC7', backgroundColor: C.brickWash }, takeawayIcon: { width: 35, height: 35, borderRadius: 11, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }, takeawayIconLoss: { backgroundColor: '#FFF9F7' }, takeawayLabel: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, takeawayTitle: { marginTop: 2, color: C.ink, fontSize: 12, lineHeight: 16, fontWeight: '900' }, takeawayCopy: { marginTop: 3, color: C.ink70, fontSize: 8, lineHeight: 12 }, boxTable: { overflow: 'hidden', borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, boxHeaderRow: { minHeight: 31, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: '#E7EBE7' }, boxHeaderCell: { width: 32, color: C.ink40, textAlign: 'center', fontSize: 7, fontWeight: '900' }, boxTeamCell: { flex: 1, width: undefined, textAlign: 'left' }, boxTeamRow: { minHeight: 59, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' }, boxOpponentRow: { borderTopWidth: 1, borderColor: C.line }, boxTeamName: { color: C.ink, fontSize: 9, fontWeight: '800' }, boxTeamTag: { marginTop: 3, color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, boxOpponentTag: { marginTop: 3, color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, boxScoreCell: { width: 32, color: C.ink40, textAlign: 'center', fontSize: 14, fontWeight: '800' }, boxWinningScore: { color: C.teal }, boxTotal: { width: 32, color: C.ink, textAlign: 'center', fontSize: 15, fontWeight: '900' }, boxSectionLabel: { marginTop: 18, marginBottom: 8, color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 }, boxStats: { paddingVertical: 12, flexDirection: 'row', borderRadius: 14, backgroundColor: C.tealWash }, boxStat: { flex: 1, alignItems: 'center', borderRightWidth: 1, borderColor: '#C9DCD7' }, boxStatLast: { borderRightWidth: 0 }, boxStatValue: { marginTop: 4, color: C.ink, fontSize: 11, fontWeight: '900' }, boxStatLabel: { marginTop: 2, color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .4 }, performanceCard: { paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, performanceRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: C.line }, performanceCopy: { width: 92 }, performanceName: { color: C.ink, fontSize: 8, fontWeight: '800' }, performanceTarget: { marginTop: 2, color: C.ink40, fontSize: 6 }, performanceBar: { flex: 1, height: 6, overflow: 'hidden', borderRadius: 3, backgroundColor: C.line }, performanceFill: { height: '100%', borderRadius: 3, backgroundColor: C.teal }, performanceFillBelow: { backgroundColor: C.brick }, performanceResult: { width: 54, alignItems: 'flex-end' }, performanceValue: { color: C.teal, fontSize: 11, fontWeight: '900' }, performanceVerdict: { marginTop: 2, color: C.teal, fontSize: 6, fontWeight: '800' }, performanceBelow: { color: C.brick }, errorRow: { minHeight: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, coachCard: { marginTop: 12, padding: 14, borderRadius: 15, backgroundColor: C.optic }, coachStep: { color: C.ink70, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, coachTitle: { marginTop: 3, color: C.ink, fontSize: 12, lineHeight: 16, fontWeight: '900' }, coachMeta: { marginTop: 4, color: C.ink70, fontSize: 8 }, boxNote: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }, boxNoteText: { flex: 1, color: C.ink40, fontSize: 8, lineHeight: 12 },
  toast: { position: 'absolute', left: 20, right: 20, bottom: 12, minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13, backgroundColor: C.ink, ...shadow }, toastText: { flex: 1, color: C.paper, fontSize: 10, fontWeight: '700' },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
