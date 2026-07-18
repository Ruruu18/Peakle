import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import LocationPicker from '../components/LocationPicker';
import NotificationSheet from '../components/NotificationSheet';
import ScrollView from '../components/FocusResetScrollView';
import { useAuth } from '../context/AuthContext';
import { distanceInKm, formatDistance, useUserLocation } from '../context/LocationContext';
import { useOperations } from '../context/OperationsContext';
import { useTheme } from '../context/ThemeContext';
import { calculatePerformanceRating, extendBooking, listMyBookings, listMyMatches, listVenues } from '../services/database';
import { presentNotification } from '../utils/notifications';

const C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA',
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function MotionPressable({ children, onPress, onPressIn, onPressOut, style, ...props }) {
  const pressProgress = useRef(new Animated.Value(1)).current;

  const animateTo = (value) => {
    Animated.spring(pressProgress, {
      toValue: value,
      speed: 34,
      bounciness: value === 1 ? 5 : 0,
      useNativeDriver: true,
    }).start();
  };

  return (
    <AnimatedPressable
      {...props}
      onPress={onPress}
      onPressIn={(event) => { animateTo(0.95); onPressIn?.(event); }}
      onPressOut={(event) => { animateTo(1); onPressOut?.(event); }}
      style={[
        style,
        {
          transform: [
            { scale: pressProgress },
            { translateY: pressProgress.interpolate({ inputRange: [0.95, 1], outputRange: [1.5, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}

function dashboardDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
}

function greetingFor(date) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function startOfWeek(date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
  return value;
}

function weekLabel(date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const startMonth = start.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  return startMonth === endMonth
    ? `${startMonth} ${start.getDate()}—${end.getDate()}`
    : `${startMonth} ${start.getDate()}—${endMonth} ${end.getDate()}`;
}

function relativeTime(value, now = new Date()) {
  const elapsed = Math.max(0, now.getTime() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : `${days}d ago`;
}

function Icon({ name, size = 21, color }) {
  const { isDark } = useTheme();
  const resolved = color ?? (isDark ? C.paper : C.ink);
  return <Ionicons name={name} size={size} color={resolved} />;
}

function KitchenLine({ dark = false, style }) {
  const { isDark } = useTheme();
  const shouldBeDark = dark || isDark;
  return (
    <View style={[styles.kitchen, style]}>
      <View style={[styles.solid, shouldBeDark && darkStyles.solidLight]} />
      <View style={[styles.dashed, shouldBeDark && darkStyles.dashedLight]} />
    </View>
  );
}

function Eyebrow({ children, light = false, numberOfLines }) {
  const { isDark } = useTheme();
  return <Text numberOfLines={numberOfLines} style={[styles.eyebrow, isDark && darkStyles.mutedText, light && styles.eyebrowLight]}>{children}</Text>;
}

function SectionTitle({ eyebrow, title, right }) {
  const { isDark } = useTheme();
  return (
    <View style={styles.sectionTitle}>
      <View style={styles.sectionTitleMain}><Eyebrow numberOfLines={1}>{eyebrow}</Eyebrow><Text style={[styles.h2, isDark && darkStyles.text]}>{title}</Text></View>
      {right}
    </View>
  );
}

function Avatar({ initials, color, offset = false }) {
  return <View style={[styles.avatar, { backgroundColor: color }, offset && styles.avatarOffset]}><Text style={styles.avatarText}>{initials}</Text></View>;
}

function CourtGraphic({ compact = false, color = C.teal, courtNumber, environment }) {
  return (
    <View style={[styles.courtGraphic, { backgroundColor: color }, compact && styles.courtGraphicCompact]}>
      <View style={[styles.courtBounds, compact && styles.courtBoundsCompact]}>
        <View style={styles.courtCenterLine} />
        <View style={styles.courtKitchenLine} />
        <View style={[styles.courtKitchenLine, styles.courtKitchenLineTwo]} />
      </View>
      {!compact && <>{courtNumber ? <Text style={styles.courtNumber}>{courtNumber}</Text> : null}{environment ? <View style={styles.indoorBadge}><Text style={styles.indoorText}>{environment.toUpperCase()}</Text></View> : null}</>}
    </View>
  );
}

function NextMatch({ booking, now, extending, onExtend, canManage }) {
  const { isDark } = useTheme();
  if (!booking) return <View style={[styles.emptyDataCard, isDark && darkStyles.card]}><Icon name="calendar-outline" size={25} color={C.teal} /><Text style={[styles.emptyDataTitle, isDark && darkStyles.text]}>No upcoming bookings</Text><Text style={[styles.emptyDataText, isDark && darkStyles.mutedText]}>Your next confirmed court booking will appear here.</Text></View>;

  const startsAt = new Date(booking.starts_at);
  const endsAt = new Date(booking.ends_at);
  const active = startsAt <= now && endsAt > now;
  const remainingMinutes = Math.max(0, Math.ceil((startsAt.getTime() - now.getTime()) / 60_000));
  const minutesLeft = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 60_000));
  const countdown = remainingMinutes >= 1440
    ? `${Math.floor(remainingMinutes / 1440)}d ${Math.floor((remainingMinutes % 1440) / 60)}h`
    : remainingMinutes >= 60
      ? `${Math.floor(remainingMinutes / 60)}h ${remainingMinutes % 60}m`
      : remainingMinutes > 0 ? `${remainingMinutes}m` : 'Now';
  const bookingDate = startsAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  const startTime = startsAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  const endTime = endsAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  const canExtend = active && minutesLeft <= 15 && canManage;
  const venue = booking.venues;
  const court = booking.courts;
  const courtNumber = court?.name?.match(/\d+/)?.[0];

  return (
    <View style={styles.nextCard}>
      <CourtGraphic color={venue?.color || C.teal} courtNumber={courtNumber} environment={court?.environment} />
      <View style={styles.nextBody}>
        <Eyebrow light>{active ? 'ON COURT NOW' : booking.status.toUpperCase()} · COURT BOOKING</Eyebrow>
        <Text style={styles.nextTitle}>{venue?.name || 'Court booking'}</Text>
        <View style={styles.metaRow}><Icon name="calendar-outline" size={16} color="rgba(243,245,239,0.72)" /><Text style={styles.metaText}>{bookingDate} · {startTime}–{endTime}</Text></View>
        <View style={styles.metaRow}><Icon name="location-outline" size={16} color="rgba(243,245,239,0.72)" /><Text style={styles.metaText}>{[court?.name, venue?.area].filter(Boolean).join(' · ') || 'Court details unavailable'}</Text></View>
        <KitchenLine dark style={styles.nextDivider} />
        <View style={styles.opponentRow}>
          <View style={styles.opponentName}><Text style={styles.tinyLight}>BOOKING TOTAL</Text><Text numberOfLines={1} style={styles.opponentText}>{booking.currency || 'PHP'} {Number(booking.amount || 0).toLocaleString('en-PH')}</Text></View>
          <View style={styles.countdown}><Text style={styles.tinyLight}>{active ? 'COURT TIME LEFT' : 'STARTS IN'}</Text><Text style={styles.countdownText}>{active ? `${minutesLeft}m` : countdown}</Text></View>
        </View>
        {active && minutesLeft <= 15 ? <View style={styles.timeWarning}><Icon name="time-outline" size={17} color={C.optic} /><View style={styles.timeWarningCopy}><Text style={styles.timeWarningTitle}>{minutesLeft <= 5 ? 'Court time is almost up' : '15-minute reminder'}</Text><Text style={styles.timeWarningText}>Finish by {endTime}{canManage ? ', or extend if the next slot is free.' : '. The booking owner can request an extension.'}</Text></View></View> : null}
        {canExtend ? <Pressable accessibilityRole="button" disabled={extending} onPress={onExtend} style={({ pressed }) => [styles.extendButton, extending && styles.extendButtonDisabled, pressed && !extending && styles.pressed]}><Icon name="add-circle-outline" size={18} color={C.ink} /><Text style={styles.extendButtonText}>{extending ? 'Checking availability…' : 'Extend by 30 minutes'}</Text></Pressable> : null}
      </View>
    </View>
  );
}

function ActionButton({ icon, imageSource, overline, label, type, onPress }) {
  const { isDark } = useTheme();
  const palette = type === 'accent'
    ? { iconBg: C.optic, icon: C.ink }
    : type === 'dark'
      ? { iconBg: isDark ? C.paper : C.ink, icon: isDark ? C.ink : C.optic }
      : { iconBg: isDark ? '#2B4B46' : '#E5F0ED', icon: isDark ? C.optic : C.teal };
  return (
    <MotionPressable accessibilityRole="button" accessibilityLabel={`${label}. ${overline}`} onPress={onPress} style={styles.actionButton}>
      <View style={[styles.actionIcon, { backgroundColor: palette.iconBg }]}>
        {imageSource ? <Image source={imageSource} style={{ width: 19, height: 19, tintColor: palette.icon }} resizeMode="contain" /> : <Icon name={icon} size={19} color={palette.icon} />}
      </View>
      <View style={styles.actionCopy}>
        <Text numberOfLines={1} style={[styles.actionOverline, isDark && darkStyles.mutedText]}>{overline}</Text>
        <Text numberOfLines={1} style={[styles.actionLabel, isDark && darkStyles.text]}>{label}</Text>
      </View>
    </MotionPressable>
  );
}

function HeaderAction({ active = false, icon, label, onPress, showBadge = false }) {
  const { isDark } = useTheme();
  return (
    <MotionPressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={active ? { selected: true } : {}}
      onPress={onPress}
      style={[styles.headerAction, active && styles.headerActionActive, active && isDark && styles.headerActionActiveDark]}
    >
      <Icon name={icon} size={19} color={active ? C.ink : isDark ? C.paper : C.ink} />
      {showBadge ? <View style={[styles.unreadDot, isDark && darkStyles.unreadDot]} /> : null}
    </MotionPressable>
  );
}

function WeekCard({ matches, rating }) {
  const { isDark } = useTheme();
  const wins = matches.filter((match) => match.result === 'W').length;
  const winRate = matches.length ? Math.round((wins / matches.length) * 100) : 0;
  const recentForm = matches.slice(0, 4);
  const numericRating = Number.parseFloat(rating);
  const ratingProgress = Number.isFinite(numericRating) ? Math.min(100, Math.max(0, (numericRating / 5.5) * 100)) : 0;
  return (
    <View style={[styles.statCard, isDark && darkStyles.card]}>
      <View style={styles.statFormHeader}>
        <Eyebrow>{recentForm.length ? 'RECENT MATCHES' : 'NO MATCHES RECORDED'}</Eyebrow>
        <View style={styles.weekFormContainer}>{recentForm.map((match) => <View key={match.id} style={[styles.weekFormChip, match.result === 'L' && styles.weekFormChipLoss]}><Text style={[styles.weekFormText, match.result === 'L' && styles.weekFormTextLoss]}>{match.result}</Text></View>)}</View>
      </View>
      <View style={styles.statTop}>
        <View style={[styles.rateRing, isDark && darkStyles.ring, winRate === 0 && { borderColor: isDark ? '#304743' : C.line }]}><View style={styles.rateRingInner}><Text style={[styles.rateNumber, isDark && darkStyles.text]}>{winRate}<Text style={styles.ratePercent}>%</Text></Text><Text style={[styles.ringLabel, isDark && darkStyles.mutedText]}>WIN RATE</Text></View></View>
        <View style={styles.rateCopy}><Text style={[styles.rateLead, isDark && darkStyles.text]}>{wins} {wins === 1 ? 'win' : 'wins'}</Text><Text style={[styles.rateBody, isDark && darkStyles.bodyText]}>from {matches.length} {matches.length === 1 ? 'match' : 'matches'}</Text><Text style={styles.rateUp}>{matches.length ? 'Based on recorded matches this week' : 'Play and save a match to build your record'}</Text></View>
      </View>
      <KitchenLine style={styles.statDivider} />
      <View style={styles.ratingRow}><View style={styles.ratingInline}><Eyebrow>PERFORMANCE RATING</Eyebrow><Text style={[styles.ratingNumber, isDark && darkStyles.text]}>{rating ?? 'Unrated'}</Text></View></View>
      <View style={[styles.track, isDark && darkStyles.track]}><View style={[styles.trackFill, { width: `${ratingProgress}%` }]} /></View>
      <View style={styles.trackLabels}><Text style={[styles.trackLabel, isDark && darkStyles.mutedText]}>1.0</Text><Text style={[styles.trackLabel, isDark && darkStyles.mutedText]}>5.5</Text></View>
    </View>
  );
}

function CompetitiveHubCard({ rating, matches, onOpen, onFindPlay }) {
  const wins = matches.filter((match) => match.result === 'W').length;
  const losses = matches.filter((match) => match.result === 'L').length;
  return (
    <View style={styles.competitiveCard}>
      <View style={styles.competitiveGlow} />
      <View style={styles.competitiveHead}><View style={styles.competitiveIcon}><Image source={require('../../public/images/ball.png')} style={styles.competitiveBallImage} resizeMode="contain" /></View><View style={styles.competitiveHeadCopy}><Text style={styles.competitiveEyebrow}>RATINGS · RIVALRIES · EVENTS</Text><Text style={styles.competitiveTitle}>Competitive Hub</Text></View><View style={styles.competitiveLive}><View style={styles.competitiveLiveDot} /><Text style={styles.competitiveLiveText}>YOUR GAME</Text></View></View>
      <Text style={styles.competitiveBody}>Track verified ratings, find the right matchup, and enter leagues or tournaments.</Text>
      <View style={styles.competitiveMetrics}><View style={styles.competitiveMetric}><Text style={styles.competitiveMetricValue}>{rating ?? '—'}</Text><Text style={styles.competitiveMetricLabel}>RATING</Text></View><View style={styles.competitiveMetricDivider} /><View style={styles.competitiveMetric}><Text style={styles.competitiveMetricValue}>{wins}–{losses}</Text><Text style={styles.competitiveMetricLabel}>RECORD</Text></View><View style={styles.competitiveMetricDivider} /><View style={styles.competitiveMetric}><Text style={styles.competitiveMetricValue}>{matches.length}</Text><Text style={styles.competitiveMetricLabel}>MATCHES</Text></View></View>
      <View style={styles.competitiveActions}><Pressable accessibilityRole="button" onPress={onOpen} style={({ pressed }) => [styles.competitivePrimary, pressed && styles.pressed]}><Text style={styles.competitivePrimaryText}>Open hub</Text><Icon name="arrow-forward" size={16} color={C.ink} /></Pressable><Pressable accessibilityRole="button" onPress={onFindPlay} style={({ pressed }) => [styles.competitiveSecondary, pressed && styles.pressed]}><Icon name="search-outline" size={16} color={C.paper} /><Text style={styles.competitiveSecondaryText}>Find play</Text></Pressable></View>
    </View>
  );
}

function CourtCard({ court, onPress, wide }) {
  const { isDark } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.courtCard, isDark && darkStyles.card, wide && styles.courtCardWide, pressed && styles.pressed]}>
      <View><CourtGraphic compact color={court.color} /><View style={styles.distance}><Text style={styles.distanceText}>{court.distance}</Text></View></View>
      <View style={styles.courtInfo}>
        <View style={styles.courtInfoMain}><Text numberOfLines={1} style={[styles.courtName, isDark && darkStyles.text]}>{court.name}</Text><View style={styles.locationRow}><Icon name="location-outline" size={13} color={isDark ? '#8FA39C' : C.ink40} /><Text style={[styles.courtLocation, isDark && darkStyles.mutedText]}>{court.location}</Text></View></View>
        <Text style={styles.price}>{court.price}{court.hourlyPrice ? <Text style={[styles.perHour, isDark && darkStyles.mutedText]}>/hr</Text> : null}</Text>
      </View>
      <View style={styles.chips}>{[...new Set([court.indoor, ...court.amenities].filter(Boolean))].slice(0, 3).map((label) => <Text key={label} style={[styles.chip, isDark && darkStyles.chip]}>{label}</Text>)}</View>
    </Pressable>
  );
}

function ActivityList({ matches, now }) {
  const { isDark } = useTheme();
  if (!matches.length) return <View style={[styles.emptyDataCard, isDark && darkStyles.card]}><Icon name="tennisball-outline" size={25} color={C.teal} /><Text style={[styles.emptyDataTitle, isDark && darkStyles.text]}>No recorded matches yet</Text><Text style={[styles.emptyDataText, isDark && darkStyles.mutedText]}>Completed matches will appear here after they are saved.</Text></View>;

  return (
    <View style={[styles.activityCard, isDark && darkStyles.card]}>
      {matches.slice(0, 3).map((match, index) => {
        const won = match.result === 'W';
        return (
        <React.Fragment key={match.id}>
          {index > 0 && <KitchenLine style={styles.activityDivider} />}
          <View style={styles.activityItem}>
            <View style={[styles.activityIcon, { backgroundColor: won ? '#E5F0ED' : '#F7EAE6' }]}><Icon name={won ? 'trophy-outline' : 'tennisball-outline'} size={18} color={won ? C.teal : C.brick} /></View>
            <View style={styles.activityCopy}><Text style={[styles.activityText, isDark && darkStyles.bodyText]}><Text style={[styles.bold, isDark && darkStyles.text]}>{won ? 'Won' : 'Lost'}</Text> vs. {match.opponent} · <Text style={[styles.bold, isDark && darkStyles.text]}>{match.score || 'Score unavailable'}</Text></Text><Text style={[styles.activityMeta, isDark && darkStyles.mutedText]}>{match.type} · {relativeTime(match.endedAt, now)}</Text></View>
            <View style={[styles.activityTail, styles.activityTailMuted, isDark && darkStyles.subtle]}><Text style={[styles.tailText, won ? null : styles.tailBrick]}>{match.result}</Text></View>
          </View>
        </React.Fragment>
      );})}
    </View>
  );
}

function BottomNav({ onNavigate }) {
  const items = [
    ['Home', 'home-outline'], ['Book', 'calendar-outline'], ['Play', 'tennisball-outline'], ['Team', 'people-outline'], ['Profile', 'person-outline'],
  ];
  return (
    <View style={styles.bottomNav}>
      {items.map(([label, icon]) => {
        const active = label === 'Home'; const play = label === 'Play';
        return (
          <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={() => onNavigate(label)} style={styles.navItem}>
            {active && <KitchenLine style={styles.activeTick} />}
            <View style={play ? styles.playButton : undefined}><Icon name={icon} size={play ? 24 : 21} color={active || play ? C.ink : C.ink40} /></View>
            <Text style={[styles.navLabel, (active || play) && styles.navLabelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function playerInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'P';
}

function Leaderboard({ visible, onClose, user, matches, performanceRating }) {
  const { userLocation } = useUserLocation();
  const { isDark } = useTheme();
  const wins = matches.filter((match) => match.result === 'W').length;
  const losses = matches.filter((match) => match.result === 'L').length;
  const winRate = matches.length ? Math.round((wins / matches.length) * 100) : 0;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={[styles.leaderSheet, isDark && darkStyles.sheet]} onPress={() => {}}>
          <View style={[styles.sheetHandle, isDark && darkStyles.track]} />
          <View style={styles.sheetHead}><View style={styles.leaderHeading}><Eyebrow>{userLocation.label.toUpperCase()}</Eyebrow><Text style={[styles.sheetTitle, isDark && darkStyles.text]}>Your record</Text><Text style={[styles.leaderSubtitle, isDark && darkStyles.mutedText]}>Calculated from completed matches saved to your account</Text></View><Pressable onPress={onClose} hitSlop={12} style={[styles.closeButton, isDark && darkStyles.card]}><Icon name="close" size={23} /></Pressable></View>
          <View style={[styles.recordCard, isDark && darkStyles.card]}>
            <View style={styles.recordIdentity}><View style={styles.recordAvatar}><Text style={styles.avatarText}>{playerInitials(user?.name || 'Player')}</Text></View><View style={styles.recordCopy}><Text style={[styles.recordName, isDark && darkStyles.text]}>{user?.name || 'Player'}</Text><Text style={[styles.recordMeta, isDark && darkStyles.mutedText]}>Performance rating · {performanceRating ?? 'Unrated'}</Text></View></View>
            <View style={styles.recordStats}><View style={styles.recordStat}><Text style={[styles.recordValue, isDark && darkStyles.text]}>{wins}–{losses}</Text><Text style={[styles.recordLabel, isDark && darkStyles.mutedText]}>RECORD</Text></View><View style={styles.recordStat}><Text style={[styles.recordValue, isDark && darkStyles.text]}>{winRate}%</Text><Text style={[styles.recordLabel, isDark && darkStyles.mutedText]}>WIN RATE</Text></View><View style={styles.recordStat}><Text style={[styles.recordValue, isDark && darkStyles.text]}>{matches.length}</Text><Text style={[styles.recordLabel, isDark && darkStyles.mutedText]}>MATCHES</Text></View></View>
          </View>
          <Text style={[styles.recordNote, isDark && darkStyles.mutedText]}>Public rankings are hidden until the app has a real ranking calculation. No sample players or fabricated standings are shown.</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { notifications: operationNotifications, unreadCount, readNotification, readAllNotifications } = useOperations();
  const { isDark, toggleColorMode } = useTheme();
  const { userLocation } = useUserLocation();
  const { width } = useWindowDimensions();
  const tablet = width >= 840;
  const [notifications, setNotifications] = useState(false);
  const [leaderboard, setLeaderboard] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [matches, setMatches] = useState([]);
  const [venues, setVenues] = useState([]);
  const [dashboardError, setDashboardError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [toast, setToast] = useState('');
  const [extendingBookingId, setExtendingBookingId] = useState(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const displayName = user?.name?.trim() || 'Player';
  const notices = useMemo(() => operationNotifications.map(presentNotification), [operationNotifications]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    setNow(new Date());
    setDashboardError('');
    Promise.all([listMyBookings(), listMyMatches()])
      .then(([bookingRows, matchRows]) => {
        if (!active) return;
        setBookings(bookingRows);
        setMatches(matchRows);
      })
      .catch((error) => {
        if (!active) return;
        setDashboardError(error.message || 'Dashboard data could not be loaded.');
        setBookings([]);
        setMatches([]);
      });
    return () => { active = false; };
  }, [user?.id]));

  useFocusEffect(useCallback(() => {
    let active = true;
    listVenues()
      .then((rows) => {
        if (!active) return;
        setVenues(rows.map((venue) => {
          const activeCourts = venue.courts || [];
          const prices = activeCourts.map((court) => Number(court.hourly_price)).filter(Number.isFinite);
          const lowestPrice = prices.length ? Math.min(...prices) : null;
          return {
            id: venue.id,
            name: venue.name,
            location: [venue.area, `${activeCourts.length} ${activeCourts.length === 1 ? 'court' : 'courts'}`].filter(Boolean).join(' · '),
            latitude: venue.latitude,
            longitude: venue.longitude,
            price: lowestPrice === null ? 'Price unavailable' : `₱${lowestPrice.toLocaleString('en-PH')}`,
            hourlyPrice: lowestPrice !== null,
            color: venue.color || C.teal,
            indoor: venue.venue_type,
            amenities: venue.amenities || [],
          };
        }));
      })
      .catch(() => { if (active) setVenues([]); });
    return () => { active = false; };
  }, []));

  const showToast = (message) => {
    setToast(message);
    Animated.sequence([
      Animated.spring(toastAnim, { toValue: 1, useNativeDriver: true, bounciness: 3 }),
      Animated.delay(2200),
      Animated.timing(toastAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(() => setToast(''));
  };

  const quickMessage = (kind) => {
    if (kind === 'book') {
      navigation.navigate('Book', { findCourtsToken: Date.now() });
      return;
    }
    if (kind === 'live') { navigation.navigate('Play', { startLiveToken: Date.now() }); return; }
    if (kind === 'players') { navigation.navigate('Play', { nearbyPlayersToken: Date.now() }); return; }
  };
  const requestExtension = (booking) => {
    const extraCharge = Number(booking.courts?.hourly_price || 0) / 2;
    const newEnd = new Date(new Date(booking.ends_at).getTime() + 30 * 60_000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
    Alert.alert(
      'Extend court time?',
      `Add 30 minutes until ${newEnd}${extraCharge ? ` for ₱${extraCharge.toLocaleString('en-PH')}` : ''}. Peakle will first confirm that the next slot is free.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Check and extend', onPress: async () => {
          setExtendingBookingId(booking.id);
          try {
            const updated = await extendBooking(booking.id);
            setBookings((rows) => rows.map((row) => row.id === booking.id ? { ...row, ...updated, venues: row.venues, courts: row.courts } : row));
            showToast(`Court extended to ${newEnd}.`);
          } catch (error) {
            Alert.alert('Extension unavailable', error.message || 'The next slot could not be reserved. Please finish by your current end time.');
          } finally {
            setExtendingBookingId(null);
          }
        } },
      ],
    );
  };
  const nearbyCourts = useMemo(() => venues.map((court) => {
    const distanceKm = distanceInKm(userLocation, court);
    return { ...court, distanceKm, distance: formatDistance(distanceKm).toUpperCase() };
  }).sort((a, b) => a.distanceKm - b.distanceKm), [userLocation, venues]);
  const upcomingBooking = useMemo(() => bookings
    .filter((booking) => ['pending', 'confirmed'].includes(booking.status) && new Date(booking.ends_at) > now)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0] || null, [bookings, now]);
  const weekStart = startOfWeek(now).getTime();
  const weeklyMatches = useMemo(() => matches.filter((match) => match.endedAt && new Date(match.endedAt).getTime() >= weekStart), [matches, weekStart]);
  const performanceRating = useMemo(() => calculatePerformanceRating(matches), [matches]);
  const nextBookingIsToday = upcomingBooking ? new Date(upcomingBooking.starts_at).toDateString() === now.toDateString() : false;
  const schedule = (
    <View style={styles.section}>
      <SectionTitle eyebrow="YOUR SCHEDULE" title="Next up" right={upcomingBooking ? <View style={[styles.todayChip, isDark && darkStyles.card]}><View style={styles.liveDot} /><Text style={[styles.todayText, isDark && darkStyles.text]}>{nextBookingIsToday ? 'TODAY' : 'UPCOMING'}</Text></View> : null} />
      <NextMatch booking={upcomingBooking} now={now} extending={extendingBookingId === upcomingBooking?.id} canManage={upcomingBooking?.user_id === user?.id} onExtend={() => requestExtension(upcomingBooking)} />
      {dashboardError ? <Text style={styles.dataError}>{dashboardError}</Text> : null}
      <View style={[styles.actions, isDark && darkStyles.actionDock]}>
        <ActionButton icon="calendar-outline" overline="RESERVE A SPOT" label="Book a court" type="dark" onPress={() => quickMessage('book')} />
        <View style={[styles.actionDivider, isDark && darkStyles.actionDivider]} />
        <ActionButton imageSource={require('../../public/images/ball.png')} overline="COURT-SIDE" label="Start live" type="accent" onPress={() => quickMessage('live')} />
        <View style={[styles.actionDivider, isDark && darkStyles.actionDivider]} />
        <ActionButton icon="people-outline" overline="BUILD A FOUR" label="Find players" type="light" onPress={() => quickMessage('players')} />
      </View>
    </View>
  );

  const weekly = <View style={styles.section}><SectionTitle eyebrow={weekLabel(now)} title="This week" /><WeekCard matches={weeklyMatches} rating={performanceRating} /></View>;
  const competitive = <View style={styles.section}><SectionTitle eyebrow="YOUR COMPETITIVE GAME" title="Compete" /><CompetitiveHubCard rating={performanceRating} matches={matches} onOpen={() => navigation.navigate('Pickleball', { openTab: 'Ratings', ownerTab: 'Home' })} onFindPlay={() => navigation.navigate('Pickleball', { openTab: 'Find play', ownerTab: 'Home' })} /></View>;
  const nearby = (
    <View style={styles.section}>
      <SectionTitle eyebrow={`AROUND ${userLocation.label.toUpperCase()}`} title="Nearby courts" right={<Pressable accessibilityLabel="Change search location" onPress={() => setLocationOpen(true)} style={styles.seeAll}><Icon name="location-outline" size={15} color={C.teal} /><Text numberOfLines={1} style={styles.seeAllText}>{userLocation.label}</Text><Icon name="chevron-down" size={14} color={C.teal} /></Pressable>} />
      {nearbyCourts.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.courtScroll}>
        {nearbyCourts.map((court) => <CourtCard key={court.id} court={court} wide={tablet} onPress={() => navigation.navigate('Book', { courtId: court.id, from: 'Home' })} />)}
      </ScrollView> : <View style={[styles.emptyDataCard, isDark && darkStyles.card]}><Icon name="location-outline" size={25} color={C.teal} /><Text style={[styles.emptyDataTitle, isDark && darkStyles.text]}>No bookable courts yet</Text><Text style={[styles.emptyDataText, isDark && darkStyles.mutedText]}>Active venues will appear here when they are added.</Text></View>}
    </View>
  );
  const feed = <View style={styles.section}><SectionTitle eyebrow="THE SCOREBOARD" title="Activity" right={<Pressable accessibilityLabel="See all match activity" onPress={() => navigation.navigate('Profile', { openTab: 'Matches', openTabToken: Date.now() })} style={[styles.moreButton, isDark && darkStyles.card]}><Icon name="ellipsis-horizontal" size={20} /></Pressable>} /><ActivityList matches={matches} now={now} /></View>;

  return (
    <SafeAreaView style={[styles.safe, isDark && darkStyles.safe]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={isDark ? C.ink : C.paper} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, tablet && styles.contentTablet]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.greeting}><Eyebrow>{dashboardDate(now)}</Eyebrow><Text style={[styles.h1, isDark && darkStyles.text]}>{greetingFor(now)}, <Text style={[styles.greetingName, isDark && darkStyles.accentText]}>{displayName}.</Text></Text></View>
          <View style={[styles.headerActions, isDark && darkStyles.headerDock]}>
            <HeaderAction active={isDark} icon={isDark ? 'sunny-outline' : 'moon-outline'} label={isDark ? 'Use light dashboard' : 'Use dark dashboard'} onPress={toggleColorMode} />
            <View style={[styles.headerActionDivider, isDark && darkStyles.actionDivider]} />
            <HeaderAction icon="podium-outline" label="Open leaderboard" onPress={() => setLeaderboard(true)} />
            <View style={[styles.headerActionDivider, isDark && darkStyles.actionDivider]} />
            <HeaderAction icon="notifications-outline" label={`Open notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} onPress={() => setNotifications(true)} showBadge={unreadCount > 0} />
          </View>
        </View>
        <KitchenLine style={styles.headerLine} />
        {tablet ? <View style={styles.tabletGrid}><View style={styles.primaryColumn}>{schedule}{competitive}{nearby}</View><View style={styles.secondaryColumn}>{weekly}{feed}</View></View> : <>{schedule}{competitive}{weekly}{nearby}{feed}</>}
      </ScrollView>
      <NotificationSheet visible={notifications} onClose={() => setNotifications(false)} items={notices} unreadCount={unreadCount} onRead={(id) => readNotification(id).catch((error) => Alert.alert('Notifications', error.message || 'This notification could not be marked as read.'))} onReadAll={() => readAllNotifications().catch((error) => Alert.alert('Notifications', error.message || 'Notifications could not be marked as read.'))} />
      <Leaderboard visible={leaderboard} onClose={() => setLeaderboard(false)} user={user} matches={matches} performanceRating={performanceRating} />
      <LocationPicker visible={locationOpen} onClose={() => setLocationOpen(false)} />
      {!!toast && <Animated.View style={[styles.toast, { opacity: toastAnim, transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }]}><Text style={styles.toastText}>{toast}</Text></Animated.View>}
    </SafeAreaView>
  );
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 } });
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  scroll: { flex: 1 }, content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 126 }, contentTablet: { paddingHorizontal: 34, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, greeting: { flex: 1, minWidth: 0, paddingRight: 10 }, eyebrow: { color: C.ink40, fontSize: 10, lineHeight: 15, fontWeight: '700', letterSpacing: 1.05 }, eyebrowLight: { color: 'rgba(243,245,239,0.52)' },
  h1: { color: C.ink, fontSize: 29, lineHeight: 37, fontWeight: '700', letterSpacing: -0.8 }, greetingName: { color: C.teal }, h2: { color: C.ink, fontSize: 23, lineHeight: 29, fontWeight: '700', letterSpacing: -0.5 },
  headerActions: { height: 48, padding: 4, flexDirection: 'row', alignItems: 'center', flexShrink: 0, borderWidth: 1, borderColor: C.line, borderRadius: 18, backgroundColor: C.surface, ...shadow }, headerAction: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, headerActionActive: { backgroundColor: C.optic }, headerActionActiveDark: { backgroundColor: C.optic }, headerActionDivider: { width: 1, height: 21, backgroundColor: C.line }, unreadDot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: C.surface, backgroundColor: C.brick },
  kitchen: { height: 7, marginVertical: 18 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 }, headerLine: { marginTop: 22, marginBottom: 27 },
  tabletGrid: { flexDirection: 'row', gap: 30 }, primaryColumn: { flex: 1.55, minWidth: 0 }, secondaryColumn: { flex: 1, minWidth: 310 }, section: { marginBottom: 34 }, sectionTitle: { minHeight: 48, marginBottom: 13, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, sectionTitleMain: { flex: 1, minWidth: 0, paddingRight: 10 },
  competitiveCard: { overflow: 'hidden', padding: 18, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: C.ink, ...shadow }, competitiveGlow: { position: 'absolute', width: 190, height: 190, right: -95, top: -105, borderRadius: 95, backgroundColor: 'rgba(214,233,74,.12)' }, competitiveHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, competitiveIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: C.optic }, competitiveBallImage: { width: 27, height: 27 }, competitiveHeadCopy: { flex: 1, minWidth: 0 }, competitiveEyebrow: { color: 'rgba(243,245,239,.5)', fontSize: 7, fontWeight: '900', letterSpacing: .85 }, competitiveTitle: { marginTop: 3, color: C.paper, fontSize: 21, fontWeight: '900', letterSpacing: -.45 }, competitiveLive: { paddingHorizontal: 7, minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, backgroundColor: 'rgba(255,255,255,.08)' }, competitiveLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.optic }, competitiveLiveText: { color: C.paper, fontSize: 6, fontWeight: '900', letterSpacing: .45 }, competitiveBody: { maxWidth: 390, marginTop: 14, color: 'rgba(243,245,239,.68)', fontSize: 11, lineHeight: 17 }, competitiveMetrics: { minHeight: 70, marginTop: 16, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(243,245,239,.12)' }, competitiveMetric: { flex: 1, alignItems: 'center' }, competitiveMetricValue: { color: C.paper, fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] }, competitiveMetricLabel: { marginTop: 3, color: 'rgba(243,245,239,.42)', fontSize: 6, fontWeight: '900', letterSpacing: .65 }, competitiveMetricDivider: { width: 1, height: 31, backgroundColor: 'rgba(243,245,239,.12)' }, competitiveActions: { marginTop: 15, flexDirection: 'row', gap: 8 }, competitivePrimary: { minHeight: 45, flex: 1.15, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 13, backgroundColor: C.optic }, competitivePrimaryText: { color: C.ink, fontSize: 10, fontWeight: '900' }, competitiveSecondary: { minHeight: 45, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(243,245,239,.2)', borderRadius: 13 }, competitiveSecondaryText: { color: C.paper, fontSize: 10, fontWeight: '900' },
  todayChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.optic }, todayText: { color: C.ink, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  emptyDataCard: { minHeight: 132, padding: 20, borderWidth: 1, borderColor: C.line, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, ...shadow }, emptyDataTitle: { marginTop: 8, color: C.ink, textAlign: 'center', fontSize: 15, fontWeight: '800' }, emptyDataText: { maxWidth: 310, marginTop: 5, color: C.ink40, textAlign: 'center', fontSize: 11, lineHeight: 16 }, dataError: { marginTop: 8, color: C.brick, fontSize: 10, lineHeight: 15 },
  nextCard: { borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden', backgroundColor: C.ink, ...shadow }, courtGraphic: { height: 142, overflow: 'hidden' }, courtBounds: { position: 'absolute', left: '15%', right: '15%', top: 17, bottom: -23, borderWidth: 2, borderColor: 'rgba(255,255,255,0.58)', transform: [{ perspective: 250 }, { rotateX: '42deg' }] }, courtCenterLine: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, backgroundColor: 'rgba(255,255,255,0.55)' }, courtKitchenLine: { position: 'absolute', left: 0, right: 0, top: '27%', height: 2, backgroundColor: 'rgba(255,255,255,0.48)' }, courtKitchenLineTwo: { top: '72%' }, courtNumber: { position: 'absolute', left: 14, bottom: 3, color: 'rgba(255,255,255,0.14)', fontSize: 52, fontWeight: '800', fontVariant: ['tabular-nums'] }, indoorBadge: { position: 'absolute', left: 13, top: 12, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: 'rgba(14,35,33,0.74)' }, indoorText: { color: C.paper, fontSize: 8, fontWeight: '800', letterSpacing: 0.9 },
  nextBody: { padding: 20 }, nextTitle: { marginTop: 5, marginBottom: 13, color: C.paper, fontSize: 23, lineHeight: 29, fontWeight: '700', letterSpacing: -0.5 }, metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 5 }, metaText: { color: 'rgba(243,245,239,0.7)', fontSize: 12 }, nextDivider: { marginTop: 14, marginBottom: 14 }, opponentRow: { flexDirection: 'row', alignItems: 'center' }, avatarRow: { flexDirection: 'row' }, avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: C.paper, alignItems: 'center', justifyContent: 'center' }, avatarOffset: { marginLeft: -9 }, avatarText: { color: '#fff', fontSize: 9, fontWeight: '800' }, vs: { marginHorizontal: 8, color: 'rgba(243,245,239,0.4)', fontSize: 9, fontWeight: '800' }, opponentName: { flex: 1, marginLeft: 9 }, tinyLight: { color: 'rgba(243,245,239,0.43)', fontSize: 8, fontWeight: '700', letterSpacing: 0.8 }, opponentText: { color: C.paper, fontSize: 12, fontWeight: '700' }, countdown: { alignItems: 'flex-end', marginLeft: 8 }, countdownText: { color: C.optic, fontSize: 16, lineHeight: 21, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timeWarning: { marginTop: 15, paddingTop: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1, borderColor: 'rgba(243,245,239,.13)' }, timeWarningCopy: { flex: 1 }, timeWarningTitle: { color: C.optic, fontSize: 10, fontWeight: '900' }, timeWarningText: { marginTop: 2, color: 'rgba(243,245,239,.66)', fontSize: 9, lineHeight: 13 }, extendButton: { minHeight: 46, marginTop: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, backgroundColor: C.optic }, extendButtonDisabled: { opacity: .58 }, extendButtonText: { color: C.ink, fontSize: 10, fontWeight: '900' },
  actions: { minHeight: 96, marginTop: 12, padding: 6, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 22, backgroundColor: C.surface, ...shadow }, actionButton: { flex: 1, minWidth: 0, minHeight: 82, paddingHorizontal: 4, paddingVertical: 8, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, actionIcon: { width: 38, height: 38, marginBottom: 7, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, actionDivider: { width: 1, height: 54, backgroundColor: C.line }, actionCopy: { width: '100%', alignItems: 'center' }, actionOverline: { width: '100%', color: C.ink40, textAlign: 'center', fontSize: 6, fontWeight: '900', letterSpacing: 0.55 }, actionLabel: { width: '100%', marginTop: 2, color: C.ink, textAlign: 'center', fontSize: 10.5, lineHeight: 15, fontWeight: '800' }, pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  weekFormContainer: { flexDirection: 'row', gap: 5 }, weekFormChip: { width: 25, height: 25, borderRadius: 13, backgroundColor: '#E5F0ED', alignItems: 'center', justifyContent: 'center' }, weekFormChipLoss: { backgroundColor: '#F7EAE6' }, weekFormText: { color: C.teal, fontSize: 10, fontWeight: '800' }, weekFormTextLoss: { color: C.brick }, statCard: { padding: 19, borderWidth: 1, borderColor: C.line, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: C.surface, ...shadow }, statFormHeader: { marginBottom: 15, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: C.line }, statTop: { flexDirection: 'row', alignItems: 'center', gap: 15 }, rateRing: { width: 92, height: 92, borderRadius: 46, borderWidth: 9, borderColor: C.teal, borderRightColor: C.line, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-18deg' }] }, rateRingInner: { alignItems: 'center', transform: [{ rotate: '18deg' }] }, rateNumber: { color: C.ink, fontSize: 27, lineHeight: 29, fontWeight: '800', fontVariant: ['tabular-nums'] }, ratePercent: { fontSize: 12 }, ringLabel: { color: C.ink40, fontSize: 7, fontWeight: '800', letterSpacing: 0.7 }, rateLead: { color: C.ink, fontSize: 17, fontWeight: '700' }, rateBody: { color: C.ink70, fontSize: 13 }, rateUp: { marginTop: 4, color: C.teal, fontSize: 10, fontWeight: '600' }, statDivider: { marginVertical: 18 }, ratingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, ratingInline: { flexDirection: 'row', alignItems: 'baseline', gap: 10 }, ratingNumber: { color: C.ink, fontSize: 34, lineHeight: 38, fontWeight: '800', fontVariant: ['tabular-nums'] }, trendChip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, overflow: 'hidden', backgroundColor: '#E5F0ED', color: C.teal, fontSize: 10, fontWeight: '800' }, track: { height: 5, marginTop: 10, borderRadius: 3, overflow: 'hidden', backgroundColor: C.line }, trackFill: { width: '72%', height: '100%', backgroundColor: C.teal }, trackLabels: { marginTop: 5, flexDirection: 'row', justifyContent: 'space-between' }, trackLabel: { color: C.ink40, fontSize: 9 },
  seeAll: { maxWidth: '48%', flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 7, flexShrink: 1 }, seeAllText: { flexShrink: 1, color: C.teal, fontSize: 10, fontWeight: '800' }, courtScroll: { paddingRight: 20, gap: 12 }, courtCard: { width: 280, borderWidth: 1, borderColor: C.line, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden', backgroundColor: C.surface, ...shadow }, courtCardWide: { width: 290 }, courtGraphicCompact: { height: 125 }, courtBoundsCompact: { top: 11, bottom: -40 }, distance: { position: 'absolute', top: 10, right: 10, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(14,35,33,0.82)' }, distanceText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 0.8 }, courtInfo: { flexDirection: 'row', gap: 8, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 8 }, courtInfoMain: { flex: 1 }, courtName: { color: C.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' }, locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 }, courtLocation: { color: C.ink40, fontSize: 10 }, price: { color: C.teal, fontSize: 14, fontWeight: '800' }, perHour: { color: C.ink40, fontSize: 9, fontWeight: '400' }, chips: { flexDirection: 'row', gap: 5, paddingHorizontal: 13, paddingBottom: 13 }, chip: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, overflow: 'hidden', backgroundColor: C.paper, color: C.ink70, fontSize: 8, fontWeight: '800' }, ratingChip: { color: C.teal },
  moreButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface }, activityCard: { borderWidth: 1, borderColor: C.line, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden', backgroundColor: C.surface, ...shadow }, activityItem: { minHeight: 78, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, activityDivider: { height: 5, marginHorizontal: 14 }, activityIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, activityCopy: { flex: 1 }, activityText: { color: C.ink70, fontSize: 12, lineHeight: 17 }, bold: { color: C.ink, fontWeight: '800' }, activityMeta: { marginTop: 2, color: C.ink40, fontSize: 9 }, activityTail: { minWidth: 25, alignItems: 'flex-end' }, activityTailMuted: { width: 27, height: 27, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper }, tailText: { color: C.teal, fontSize: 11, fontWeight: '800' }, tailMuted: { color: C.ink40 }, tailBrick: { color: C.brick },
  bottomNav: { position: 'absolute', left: 12, right: 12, bottom: Platform.OS === 'ios' ? 9 : 12, height: 76, paddingHorizontal: 5, borderWidth: 1, borderColor: C.line, borderRadius: 20, flexDirection: 'row', backgroundColor: C.surface, ...Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } }, android: { elevation: 9 } }) }, navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }, navLabel: { color: C.ink40, fontSize: 9, fontWeight: '700' }, navLabelActive: { color: C.ink }, activeTick: { position: 'absolute', top: -4, width: 24 }, playButton: { width: 52, height: 52, marginTop: -28, borderRadius: 26, borderWidth: 5, borderColor: C.surface, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,0.46)' }, leaderSheet: { height: '84%', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: C.paper }, sheetHandle: { alignSelf: 'center', width: 40, height: 4, marginBottom: 14, borderRadius: 2, backgroundColor: C.line }, sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, leaderHeading: { flex: 1, paddingRight: 10 }, sheetTitle: { color: C.ink, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -.7 }, leaderSubtitle: { marginTop: 1, color: C.ink40, fontSize: 9 }, closeButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  leaderTabs: { marginTop: 12, marginBottom: 10, padding: 3, flexDirection: 'row', borderRadius: 12, backgroundColor: '#E5E9E3' }, leaderTab: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center' }, leaderTabActive: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: C.ink }, leaderTabText: { color: C.ink40, fontSize: 10, fontWeight: '800' }, leaderTabActiveText: { color: C.paper, fontSize: 10, fontWeight: '800' }, leaderScroll: { paddingBottom: 4 },
  recordCard: { marginTop: 20, padding: 18, borderWidth: 1, borderColor: C.line, borderRadius: 22, backgroundColor: C.surface, ...shadow }, recordIdentity: { flexDirection: 'row', alignItems: 'center' }, recordAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, recordCopy: { flex: 1, marginLeft: 11 }, recordName: { color: C.ink, fontSize: 16, fontWeight: '800' }, recordMeta: { marginTop: 3, color: C.ink40, fontSize: 10 }, recordStats: { marginTop: 18, paddingTop: 16, flexDirection: 'row', borderTopWidth: 1, borderColor: C.line }, recordStat: { flex: 1, alignItems: 'center' }, recordValue: { color: C.ink, fontSize: 23, fontWeight: '900' }, recordLabel: { marginTop: 3, color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, recordNote: { marginTop: 14, color: C.ink40, textAlign: 'center', fontSize: 10, lineHeight: 16 },
  leaderSeasonBar: { minHeight: 34, marginBottom: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 9, backgroundColor: C.surface }, seasonLive: { flexDirection: 'row', alignItems: 'center', gap: 5 }, seasonLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.optic }, seasonLiveText: { color: C.ink, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, seasonReset: { flex: 1, marginLeft: 8, color: C.ink40, fontSize: 8 }, seasonMatches: { flexDirection: 'row', alignItems: 'baseline' }, seasonMatchesValue: { color: C.teal, fontSize: 11, fontWeight: '900' }, seasonMatchesLabel: { color: C.ink40, fontSize: 6, fontWeight: '800' },
  podiumFrame: { overflow: 'hidden', borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: C.ink, ...shadow }, podiumFrameTop: { height: 31, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: 'rgba(243,245,239,.1)' }, podiumFrameTitle: { color: 'rgba(243,245,239,.62)', fontSize: 8, fontWeight: '900', letterSpacing: 1 }, podiumFrameMeta: { color: 'rgba(243,245,239,.36)', fontSize: 6, fontWeight: '900', letterSpacing: .6 }, podiumGrid: { minHeight: 150, paddingHorizontal: 7, paddingTop: 15, paddingBottom: 9, flexDirection: 'row', alignItems: 'flex-end', gap: 6 }, podiumCard: { flex: 1, minWidth: 0, height: 115, paddingHorizontal: 5, paddingTop: 9, paddingBottom: 8, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(243,245,239,.11)', borderRadius: 14, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, backgroundColor: 'rgba(255,255,255,.045)' }, podiumCardChampion: { height: 132, borderColor: 'rgba(214,233,74,.38)', backgroundColor: 'rgba(214,233,74,.08)' }, podiumCardSelected: { borderColor: C.optic, backgroundColor: 'rgba(214,233,74,.14)' }, crown: { position: 'absolute', top: -10, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, podiumAvatarFrame: { width: 45, height: 45, padding: 3, borderRadius: 23, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink }, podiumAvatarFrameChampion: { width: 53, height: 53, borderRadius: 27 }, podiumAvatar: { width: '100%', height: '100%', borderRadius: 25, alignItems: 'center', justifyContent: 'center' }, podiumAvatarText: { fontSize: 10 }, rankSeal: { position: 'absolute', right: -5, bottom: -3, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.ink, alignItems: 'center', justifyContent: 'center' }, rankSealText: { fontSize: 9, fontWeight: '900' }, podiumName: { width: '100%', marginTop: 7, color: C.paper, textAlign: 'center', fontSize: 9, fontWeight: '800' }, podiumNameChampion: { fontSize: 10 }, podiumRatingRow: { marginTop: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 }, podiumRating: { color: C.paper, fontSize: 17, lineHeight: 19, fontWeight: '900', fontVariant: ['tabular-nums'] }, podiumTrend: { color: C.optic, fontSize: 7, fontWeight: '900' }, podiumTrendDown: { color: 'rgba(243,245,239,.45)' },
  standingsHeading: { marginTop: 16, marginBottom: 8, paddingHorizontal: 3, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, standingsTitle: { color: C.ink, fontSize: 17, fontWeight: '800' }, ratingHeader: { marginBottom: 2, color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, leaderListFrame: { overflow: 'hidden', borderWidth: 1, borderColor: C.line, borderRadius: 17, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.surface, ...shadow }, leaderRow: { minHeight: 66, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }, leaderRowBorder: { borderTopWidth: 1, borderColor: C.line }, leaderRowYou: { backgroundColor: '#EAF3F0' }, leaderRowSelected: { backgroundColor: '#F7FADD' }, leaderRankFrame: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper }, leaderRank: { color: C.ink, textAlign: 'center', fontSize: 10, fontWeight: '900' }, leaderAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, leaderCopy: { flex: 1, minWidth: 0 }, leaderNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 }, leaderName: { flexShrink: 1, color: C.ink, fontSize: 12, fontWeight: '800' }, youBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, overflow: 'hidden', color: C.teal, backgroundColor: C.surface, fontSize: 6, fontWeight: '900' }, leaderRating: { alignItems: 'flex-end' }, leaderRatingValue: { color: C.ink, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] }, leaderTrend: { marginTop: 1, color: C.teal, fontSize: 7, fontWeight: '900' }, leaderTrendDown: { color: C.ink40 },
  leaderFooter: { minHeight: 66, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#BFD8D2', borderRadius: 15, borderBottomLeftRadius: 7, borderBottomRightRadius: 7, backgroundColor: '#E5F0ED', ...shadow }, footerRank: { width: 43, height: 43, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, footerRankLabel: { color: 'rgba(255,255,255,.58)', fontSize: 6, fontWeight: '900' }, footerRankValue: { color: C.surface, fontSize: 16, fontWeight: '900' }, leaderFooterCopy: { flex: 1, minWidth: 0 }, footerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 }, leaderFooterName: { flexShrink: 1, color: C.ink, fontSize: 11, fontWeight: '900' }, leaderFooterText: { marginTop: 3, color: C.teal, fontSize: 8, fontWeight: '700' }, footerRating: { alignItems: 'flex-end' }, footerRatingValue: { color: C.ink, fontSize: 20, fontWeight: '900' }, footerRatingLabel: { color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .5 },
  toast: { position: 'absolute', left: 20, right: 20, bottom: 100, minHeight: 48, paddingHorizontal: 17, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink, ...shadow }, toastText: { color: C.paper, textAlign: 'center', fontSize: 12, fontWeight: '700' },
});

const darkStyles = StyleSheet.create({
  safe: { backgroundColor: C.ink },
  sheet: { backgroundColor: '#102825' },
  card: { backgroundColor: '#17302D', borderColor: '#304743' },
  headerDock: { backgroundColor: '#17302D', borderColor: '#304743' },
  actionDock: { backgroundColor: '#17302D', borderColor: '#304743' },
  actionDivider: { backgroundColor: '#304743' },
  subtle: { backgroundColor: '#203B37' },
  themeButton: { backgroundColor: '#203B37', borderColor: '#3B5550' },
  unreadDot: { borderColor: '#17302D' },
  border: { borderColor: '#304743' },
  ring: { borderRightColor: '#304743' },
  track: { backgroundColor: '#304743' },
  chip: { backgroundColor: '#203B37', color: '#D5DFDB' },
  solidLight: { backgroundColor: 'rgba(255,255,255,.78)' },
  dashedLight: { borderColor: 'rgba(255,255,255,.38)' },
  text: { color: C.paper },
  bodyText: { color: '#C1CECA' },
  mutedText: { color: '#8FA39C' },
  accentText: { color: C.optic },
});
