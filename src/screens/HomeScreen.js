import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  Image,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import AppIcon from '../components/AppIcon';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import LocationPicker from '../components/LocationPicker';
import NotificationSheet from '../components/NotificationSheet';
import ProfilePhoto from '../components/ProfilePhoto';
import ScrollView from '../components/FocusResetScrollView';
import useResponsiveWidth from '../hooks/useResponsiveWidth';
import useDesktopLayout from '../hooks/useDesktopLayout';
import { webLayout } from '../utils/webLayout';
import { useAuth } from '../context/AuthContext';
import { distanceInKm, formatDistance, useUserLocation } from '../context/LocationContext';
import { useOperations } from '../context/OperationsContext';
import { useTheme } from '../context/ThemeContext';
import { calculatePerformanceRating, extendBooking, listMyBookings, listMyMatches, listVenues } from '../services/database';
import { presentNotification } from '../utils/notifications';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import { peekCachedData, readCachedData, withTimeout, writeCachedData } from '../lib/asyncData';
import { requireSupabase } from '../lib/supabase';
import { HOME_VENUES_CACHE_KEY, homeDashboardCacheKey, playerActivitiesCacheKey } from '../lib/cacheKeys';
import { skillCategoryForRating } from '../utils/skillCategories';
import { listDiscoverablePlayerActivities } from '../services/playerActivities';
import { formatTime, isPlayerScheduledEntry, listScheduledGames, nextOnMyCalendar, scheduleEntryFromActivity } from '../services/schedule';
import { COURT_BOOKING_ENABLED, ORGANIZER_EVENTS_ENABLED } from '../config/features';
import { dismissPlayerSuggestion, followPlayer, listPlayerSuggestions } from '../services/directMessages';
import { ACCOUNT_MENU_NAV, useAccountMenu } from '../components/AccountMenu';
import { dropShadow, noShadow } from '../utils/shadow';
import { ActivityCardsSkeleton, PlayerCardsSkeleton } from '../components/Skeleton';

const C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA',
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const BALL_IMAGE = require('../../public/images/ball.png');

function MotionPressable({ children, onPress, onPressIn, onPressOut, style, ...props }) {
  const pressProgress = useRef(new Animated.Value(1)).current;

  const animateTo = (value) => {
    Animated.spring(pressProgress, {
      toValue: value,
      speed: 34,
      bounciness: value === 1 ? 5 : 0,
      useNativeDriver: Platform.OS !== 'web',
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

function greetingFor(date) {
  const hour = date.getHours();
  if (hour < 12) return { text: 'Good morning' };
  if (hour < 18) return { text: 'Good afternoon' };
  return { text: 'Good evening' };
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
  return <AppIcon name={name} size={size} color={resolved} />;
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
  return <Text numberOfLines={numberOfLines} style={[styles.eyebrow, isDark && darkStyles.eyebrowDark, light && styles.eyebrowLight]}>{children}</Text>;
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

const SCHEDULE_KIND_LABELS = { game: 'GAME', open_play: 'OPEN PLAY', competition: 'TOURNAMENT', program: 'PROGRAM' };

// Booking is paused, so "Next up" shows the next game or event on the player's calendar.
function NextScheduled({ entry, now, onOpen, onSchedule }) {
  const { isDark } = useTheme();
  if (!entry) {
    return (
      <View style={[styles.emptyDataCard, isDark && darkStyles.card]}>
        <Icon name="calendar-outline" size={25} color={C.teal} />
        <Text style={[styles.emptyDataTitle, isDark && darkStyles.text]}>Nothing scheduled yet</Text>
        <Text style={[styles.emptyDataText, isDark && darkStyles.mutedText]}>Plan a game at any court, or join an open play near you.</Text>
        <Pressable accessibilityRole="button" onPress={onSchedule} style={({ pressed }) => [styles.extendButton, pressed && styles.pressed]}><Icon name="add" size={18} color={C.ink} /><Text style={styles.extendButtonText}>Schedule a game</Text></Pressable>
      </View>
    );
  }
  const startsAt = new Date(entry.startsAt);
  const endsAt = new Date(entry.endsAt);
  const active = startsAt <= now && endsAt > now;
  const remainingMinutes = Math.max(0, Math.ceil((startsAt.getTime() - now.getTime()) / 60_000));
  const countdown = remainingMinutes >= 1440
    ? `${Math.floor(remainingMinutes / 1440)}d ${Math.floor((remainingMinutes % 1440) / 60)}h`
    : remainingMinutes >= 60
      ? `${Math.floor(remainingMinutes / 60)}h ${remainingMinutes % 60}m`
      : remainingMinutes > 0 ? `${remainingMinutes}m` : 'Now';
  const date = startsAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  const status = isPlayerScheduledEntry(entry) ? (entry.isHost ? 'HOSTING' : entry.myStatus === 'invited' ? 'INVITED' : 'GOING') : 'REGISTERED';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Next up: ${entry.title}, ${date} at ${formatTime(entry.startsAt)}`} onPress={onOpen} style={({ pressed }) => [styles.nextCard, pressed && styles.pressed]}>
      <CourtGraphic color={C.teal} courtNumber={null} environment={null} />
      <View style={styles.nextBody}>
        <Eyebrow light>{active ? 'HAPPENING NOW' : status} · {SCHEDULE_KIND_LABELS[entry.kind] || 'EVENT'}</Eyebrow>
        <Text style={styles.nextTitle}>{entry.title}</Text>
        <View style={styles.metaRow}><Icon name="calendar-outline" size={16} color="rgba(243,245,239,0.72)" /><Text style={styles.metaText}>{date} · {formatTime(entry.startsAt)}–{formatTime(entry.endsAt)}</Text></View>
        <View style={styles.metaRow}><Icon name="location-outline" size={16} color="rgba(243,245,239,0.72)" /><Text style={styles.metaText}>{[entry.place, entry.area].filter(Boolean).join(' · ')}</Text></View>
        <KitchenLine dark style={styles.nextDivider} />
        <View style={styles.opponentRow}>
          <View style={styles.opponentName}><Text style={styles.tinyLight}>{isPlayerScheduledEntry(entry) ? 'PLAYERS' : 'TYPE'}</Text><Text numberOfLines={1} style={styles.opponentText}>{isPlayerScheduledEntry(entry) ? `${entry.going.length}/${entry.capacity} going` : entry.typeLabel}</Text></View>
          <View style={styles.countdown}><Text style={styles.tinyLight}>{active ? 'ON NOW' : 'STARTS IN'}</Text><Text style={styles.countdownText}>{active ? 'Now' : countdown}</Text></View>
        </View>
      </View>
    </Pressable>
  );
}

function ownedBookings(bookings, userId) {
  if (!userId) return [];
  return (bookings || []).filter((booking) => booking?.user_id === userId);
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
        {imageSource ? <Image source={imageSource} style={{ width: 19, height: 19 }} tintColor={palette.icon} resizeMode="contain" /> : <Icon name={icon} size={19} color={palette.icon} />}
      </View>
      <View style={styles.actionCopy}>
        <Text numberOfLines={1} style={[styles.actionOverline, isDark && darkStyles.mutedText]}>{overline}</Text>
        <Text numberOfLines={1} style={[styles.actionLabel, isDark && darkStyles.text]}>{label}</Text>
      </View>
    </MotionPressable>
  );
}

function HeaderAction({ active = false, compact = false, docked = false, icon, label, onPress, badgeCount = 0, textLabel }) {
  const { isDark } = useTheme();
  return (
    <MotionPressable
      {...webLayout(textLabel ? 'home-header-shortcut' : 'home-header-action')}
      {...(Platform.OS === 'web' ? { title: label } : {})}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={active ? { selected: true } : {}}
      onPress={onPress}
      style={[styles.headerAction, compact && styles.headerActionCompact, isDark && darkStyles.headerAction, docked && styles.headerActionDocked, active && styles.headerActionActive, active && isDark && styles.headerActionActiveDark]}
    >
      <Icon name={badgeCount > 0 ? icon.replace('-outline', '') : icon} size={17} color={active ? C.ink : isDark ? C.paper : C.ink} />
      {Platform.OS === 'web' && textLabel ? <Text {...webLayout('home-header-action-label')} style={[styles.headerActionLabel, isDark && darkStyles.text]}>{textLabel}</Text> : null}
      {badgeCount > 0 ? <View style={[styles.unreadBadge, isDark && darkStyles.unreadBadge, { pointerEvents: 'none' }]}><Text style={styles.unreadBadgeText}>{badgeCount > 99 ? '99+' : badgeCount}</Text></View> : null}
    </MotionPressable>
  );
}

function WeekCard({ matches, rating, onRecordMatch }) {
  const { isDark } = useTheme();
  const wins = matches.filter((match) => match.result === 'W').length;
  const winRate = matches.length ? Math.round((wins / matches.length) * 100) : 0;
  const recentForm = matches.slice(0, 4);
  const numericRating = Number.parseFloat(rating);
  const ratingCategory = skillCategoryForRating(numericRating);
  const ratingProgress = Number.isFinite(numericRating) ? Math.min(100, Math.max(0, (numericRating / 5.5) * 100)) : 0;

  if (!matches.length) {
    return (
      <View style={[styles.weekEmptyCard, isDark && darkStyles.card]}>
        <View style={[styles.weekEmptyGlow, { pointerEvents: 'none' }]} />
        <View style={styles.weekEmptyHead}>
          <View style={[styles.weekEmptyMark, isDark && styles.weekEmptyMarkDark]}>
            <Image source={require('../../public/images/ball.png')} style={styles.weekEmptyBall} resizeMode="contain" />
          </View>
          <View style={[styles.weekEmptyStatus, isDark && styles.weekEmptyStatusDark]}>
            <View style={styles.weekEmptyStatusDot} />
            <Text style={[styles.weekEmptyStatusText, isDark && styles.weekEmptyStatusTextDark]}>WEEKLY RECORD</Text>
          </View>
        </View>
        <Text style={[styles.weekEmptyTitle, isDark && darkStyles.text]}>Your record starts here</Text>
        <Text style={[styles.weekEmptyBody, isDark && darkStyles.bodyText]}>Play and save your first match this week. Your win rate, recent form, and rating progress will appear automatically.</Text>
        <MotionPressable accessibilityLabel="Record your first match this week" accessibilityRole="button" onPress={onRecordMatch} style={styles.weekEmptyButton}>
          <Text style={styles.weekEmptyButtonText}>Record a match</Text>
          <Icon name="arrow-forward" size={17} color={C.ink} />
        </MotionPressable>
      </View>
    );
  }

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
      <View style={styles.ratingRow}><View style={styles.ratingInline}><Eyebrow>PERFORMANCE RATING</Eyebrow><Text style={[styles.ratingNumber, isDark && darkStyles.text]}>{rating ?? 'Unrated'}</Text></View>{ratingCategory ? <View style={styles.ratingCategory}><Text style={styles.ratingCategoryText}>{ratingCategory.label.toUpperCase()}</Text></View> : null}</View>
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

function CourtCard({ court, onPress, wide, single }) {
  const { isDark } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.courtCard, isDark && darkStyles.card, wide && styles.courtCardWide, single && styles.courtCardSingle, pressed && styles.pressed]}>
      <View><CourtGraphic compact color={court.color} /><View style={styles.distance}><Text style={styles.distanceText}>{court.distance}</Text></View></View>
      <View style={styles.courtInfo}>
        <View style={styles.courtInfoMain}><Text numberOfLines={1} style={[styles.courtName, isDark && darkStyles.text]}>{court.name}</Text><View style={styles.locationRow}><Icon name="location-outline" size={13} color={isDark ? '#D5DFDB' : C.teal} /><Text style={[styles.courtLocation, isDark && darkStyles.locationText]}>{court.location}</Text></View></View>
        <Text style={styles.price}>{court.price}{court.hourlyPrice ? <Text style={[styles.perHour, isDark && darkStyles.mutedText]}>/hr</Text> : null}</Text>
      </View>
      <View style={styles.chips}>{[...new Set([court.indoor, ...court.amenities].filter(Boolean))].slice(0, 3).map((label) => <Text key={label} style={[styles.chip, isDark && darkStyles.chip]}>{label}</Text>)}</View>
    </Pressable>
  );
}

function PublicActivityCard({ activity, userLocation, onPress, wide, single }) {
  const { isDark } = useTheme();
  const startsAt = new Date(activity.startsAt);
  const date = startsAt.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  const time = startsAt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  const distanceKm = distanceInKm(userLocation, activity.venue);
  const hasDistance = distanceKm != null;
  const distance = formatDistance(distanceKm);
  const fee = activity.feeAmount == null ? activity.typeLabel : Number(activity.feeAmount) > 0 ? `₱${Number(activity.feeAmount).toLocaleString('en-PH')}` : 'Free';
  const isWaitlist = activity.availability === 'WAITLIST';
  const typeIcon = activity.type === 'game' ? 'tennisball' : activity.type === 'open_play' ? 'people' : activity.type === 'competition' ? 'trophy' : 'school';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${activity.typeLabel}, ${activity.title}, ${activity.venue?.name || 'public activity'}`}
      onPress={onPress}
      style={({ pressed }) => [styles.homeOpenPlayCard, isDark && darkStyles.card, wide && styles.homeOpenPlayCardWide, single && styles.homeOpenPlayCardSingle, pressed && styles.pressed]}
    >
      <View style={styles.homeOpenPlayTop}>
        <View style={styles.homeOpenPlayVerified}><Icon name={typeIcon} size={12} color={C.teal} /><Text style={styles.homeOpenPlayVerifiedText}>{activity.typeLabel.toUpperCase()}</Text></View>
        <Text style={[styles.homeOpenPlayFee, isDark && darkStyles.text]}>{fee}</Text>
      </View>
      <Text numberOfLines={1} style={[styles.homeOpenPlayName, isDark && darkStyles.text]}>{activity.title}</Text>
      <Text numberOfLines={1} style={styles.homeOpenPlayVenue}>{[activity.venue?.name || 'Peakle venue', activity.venue?.area || (hasDistance ? distance : null)].filter(Boolean).join(' · ')}</Text>
      <View style={styles.homeOpenPlayMeta}><Icon name="calendar-outline" size={14} color={isDark ? '#8FA39C' : C.ink40} /><Text numberOfLines={1} style={[styles.homeOpenPlayMetaText, isDark && darkStyles.mutedText]}>{date} · {time}</Text></View>
      <View style={styles.homeOpenPlayFoot}>
        <Text numberOfLines={1} style={[styles.homeOpenPlayDistance, isDark && darkStyles.mutedText]}>{hasDistance ? distance : activity.venue?.area || 'Location not set'}</Text>
        <View style={[styles.homeOpenPlaySpots, isWaitlist && styles.homeOpenPlayWaitlist]}><Text style={[styles.homeOpenPlaySpotsText, isWaitlist && styles.homeOpenPlayWaitlistText]}>{activity.availability}</Text></View>
      </View>
    </Pressable>
  );
}

function ActivityList({ matches, now }) {
  const { isDark } = useTheme();
  if (!matches.length) return <View style={[styles.emptyDataCard, isDark && darkStyles.card]}><Image source={BALL_IMAGE} style={{ width: 25, height: 25 }} tintColor={C.teal} resizeMode="contain" /><Text style={[styles.emptyDataTitle, isDark && darkStyles.text]}>No recorded matches yet</Text><Text style={[styles.emptyDataText, isDark && darkStyles.mutedText]}>Completed matches will appear here after they are saved.</Text></View>;

  return (
    <View style={[styles.activityCard, isDark && darkStyles.card]}>
      {matches.slice(0, 2).map((match, index) => {
        const won = match.result === 'W';
        // Older cached matches only carry the joined opponent name.
        const opponentPlayers = match.opponentPlayers?.length ? match.opponentPlayers : String(match.opponent || 'Opponent').split(' & ').map((name) => ({ name, avatar: null }));
        return (
        <React.Fragment key={match.id}>
          {index > 0 && <KitchenLine style={styles.activityDivider} />}
          <View style={styles.activityItem}>
            <View style={[styles.activityIcon, { backgroundColor: won ? '#E5F0ED' : '#F7EAE6' }]}>{won ? <Icon name="trophy-outline" size={18} color={C.teal} /> : <Image source={BALL_IMAGE} style={{ width: 18, height: 18 }} tintColor={C.brick} resizeMode="contain" />}</View>
            <View style={styles.activityCopy}><Text style={[styles.activityText, isDark && darkStyles.bodyText]}><Text style={[styles.bold, isDark && darkStyles.text]}>{won ? 'Won' : 'Lost'}</Text> vs. {match.opponent} · <Text style={[styles.bold, isDark && darkStyles.text]}>{match.score || 'Score unavailable'}</Text></Text><Text style={[styles.activityMeta, isDark && darkStyles.mutedText]}>{match.type} · {relativeTime(match.endedAt, now)}</Text></View>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.activityOpponents}>{opponentPlayers.slice(0, 2).map((player, playerIndex) => <ProfilePhoto key={`${player.name}-${playerIndex}`} photo={player.avatar} name={player.name} size={30} style={[styles.activityOpponentPhoto, isDark && darkStyles.activityOpponentPhoto, playerIndex > 0 && styles.activityOpponentOverlap]} />)}</View>
            <View style={[styles.activityTail, styles.activityTailMuted, isDark && darkStyles.subtle, won && styles.activityTailWon]}><Text style={[styles.tailText, won ? styles.tailTextWon : styles.tailBrick]}>{match.result}</Text></View>
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
            <View style={play ? styles.playButton : undefined}>{play ? <Image source={BALL_IMAGE} style={{ width: 24, height: 24 }} tintColor={C.ink} resizeMode="contain" /> : <Icon name={icon} size={21} color={active ? C.ink : C.ink40} />}</View>
            <Text style={[styles.navLabel, (active || play) && styles.navLabelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SuggestedPlayerCard({ player, onFollow, onDismiss, onPress, busy, wide }) {
  const { isDark } = useTheme();
  const requested = player.followRequestPending;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.suggestedPlayerCard, wide && styles.suggestedPlayerCardWide, isDark && darkStyles.card, pressed && { opacity: 0.9 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${player.name} from suggestions`}
        hitSlop={8}
        onPress={() => onDismiss(player)}
        style={({ pressed }) => [styles.suggestedDismissButton, pressed && styles.pressed]}
      >
        <Icon name="close" size={14} color={isDark ? 'rgba(243,245,239,0.72)' : C.ink40} />
      </Pressable>
      {player.mutuals > 0 && <Text style={[styles.suggestedPlayerMutuals, isDark && darkStyles.mutedText]}>{player.mutuals} mutuals</Text>}
      <View style={styles.suggestedPlayerTop}>
        <ProfilePhoto photo={player.avatar} name={player.name} size={58} />
      </View>
      <Text numberOfLines={1} style={[styles.suggestedPlayerFollowers, isDark && darkStyles.mutedText]}>
        <Text style={[styles.suggestedPlayerFollowersStrong, isDark && darkStyles.text]}>{player.followers}</Text> followers · <Text style={[styles.suggestedPlayerFollowersStrong, isDark && darkStyles.text]}>{player.following}</Text> following
      </Text>
      <Text numberOfLines={1} style={[styles.suggestedPlayerName, isDark && darkStyles.text]}>{player.name}</Text>
      <Text numberOfLines={1} style={[styles.suggestedPlayerReason, isDark && darkStyles.mutedText]}>{player.reason}</Text>
      <Text numberOfLines={1} style={[styles.suggestedPlayerMeta, isDark && darkStyles.mutedText]}>
        {[player.area, player.rating ? `${player.rating.toFixed(1)} rating` : null].filter(Boolean).join(' · ') || 'Ready to connect'}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={requested ? `Follow request sent to ${player.name}` : `Follow ${player.name}`}
        accessibilityState={{ disabled: requested || busy }}
        disabled={requested || busy}
        onPress={() => onFollow(player)}
        style={({ pressed }) => [styles.suggestedFollowButton, requested && styles.suggestedFollowButtonPending, pressed && styles.pressed]}
      >
        {busy ? <ActivityIndicator size="small" color={C.ink} /> : <Icon name={requested ? 'checkmark' : 'person-add-outline'} size={16} color={requested ? C.teal : C.ink} />}
        {!busy ? <Text style={[styles.suggestedFollowText, requested && styles.suggestedFollowTextPending]}>{requested ? 'Requested' : 'Follow'}</Text> : null}
      </Pressable>
    </Pressable>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { notifications: operationNotifications, unreadCount, readNotification, readAllNotifications, removeNotification, clearNotifications, respondFollowRequest, reportRealtime, online } = useOperations();
  const { isDark, toggleColorMode } = useTheme();
  const { userLocation } = useUserLocation();
  const width = useResponsiveWidth();
  const desktop = useDesktopLayout();
  const tablet = desktop || width >= 840;
  const compactHeader = width <= 440;
  const narrowHeader = width < 360;
  const [notifications, setNotifications] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const dashboardCacheKey = homeDashboardCacheKey(user?.id || 'guest');
  const activitiesCacheKey = playerActivitiesCacheKey(user?.id || 'guest');
  const cachedDashboard = peekCachedData(dashboardCacheKey);
  const [bookings, setBookings] = useState(() => ownedBookings(cachedDashboard?.bookings, user?.id));
  const [matches, setMatches] = useState(() => cachedDashboard?.matches || []);
  const [venues, setVenues] = useState(() => peekCachedData(HOME_VENUES_CACHE_KEY) || []);
  const [publicActivities, setPublicActivities] = useState(() => peekCachedData(activitiesCacheKey) || []);
  const [scheduledGames, setScheduledGames] = useState([]);
  useFocusEffect(useCallback(() => {
    if (COURT_BOOKING_ENABLED || !user?.id) return undefined;
    let active = true;
    listScheduledGames({ from: new Date().toISOString(), to: new Date(Date.now() + 90 * 86400000).toISOString() })
      .then((rows) => { if (active) setScheduledGames(rows); })
      .catch(() => {});
    return () => { active = false; };
  }, [user?.id]));
  const [activitiesLoading, setActivitiesLoading] = useState(() => peekCachedData(activitiesCacheKey) === null);
  const [suggestedPlayers, setSuggestedPlayers] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [followingPlayerId, setFollowingPlayerId] = useState(null);
  const [connectedPlayerIds, setConnectedPlayerIds] = useState(() => new Set());
  const [suggestionsRequest, setSuggestionsRequest] = useState(0);
  const [dashboardError, setDashboardError] = useState('');
  const [dashboardRequest, setDashboardRequest] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [toast, setToast] = useState('');
  const [extendingBookingId, setExtendingBookingId] = useState(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const displayName = user?.name?.trim() || 'Player';
  const firstName = displayName.split(/\s+/)[0];
  const greeting = greetingFor(now);
  const { setOpen: setAccountMenuOpen } = useAccountMenu();
  const notices = useMemo(() => operationNotifications.map(presentNotification), [operationNotifications]);
  // Players who accepted our follow request are now followed, so they no longer
  // belong in "People you may know". New followers stay: they are follow-back suggestions.
  const acceptedFollowKey = useMemo(() => operationNotifications
    .filter((notice) => notice.kind === 'follow_accepted' && notice.data?.event !== 'new_follower' && notice.data?.playerId)
    .map((notice) => notice.data.playerId)
    .sort()
    .join(','), [operationNotifications]);
  const visibleSuggestedPlayers = useMemo(() => {
    const accepted = new Set(acceptedFollowKey ? acceptedFollowKey.split(',') : []);
    return suggestedPlayers.filter((player) => !connectedPlayerIds.has(player.id) && !accepted.has(player.id));
  }, [acceptedFollowKey, connectedPlayerIds, suggestedPlayers]);
  const previousAcceptedFollowKey = useRef(acceptedFollowKey);
  useEffect(() => {
    if (previousAcceptedFollowKey.current === acceptedFollowKey) return;
    previousAcceptedFollowKey.current = acceptedFollowKey;
    setSuggestionsRequest((value) => value + 1);
  }, [acceptedFollowKey]);
  const respondToFollow = async (item, accept) => {
    const accepted = await respondFollowRequest(item.data?.requesterId, accept, item.id);
    if (accept && item.data?.requesterId) {
      setConnectedPlayerIds((current) => new Set(current).add(item.data.requesterId));
      setSuggestionsRequest((value) => value + 1);
    }
    return accepted;
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    setNow(new Date());
    setDashboardError('');
    (async () => {
      const cached = await readCachedData(dashboardCacheKey);
      if (!active) return;
      if (cached) {
        setBookings(ownedBookings(cached.bookings, user?.id));
        setMatches(cached.matches || []);
      } else {
        setBookings([]);
      }
      if (!online) {
        if (!cached) setDashboardError('You\u2019re offline. Dashboard activity will refresh when you reconnect.');
        return;
      }

      // Refresh these independently. A slow match-history query should not throw
      // away fresh bookings (and vice versa).
      const [bookingResult, matchResult] = await Promise.allSettled([
        withTimeout(listMyBookings(), 20000, 'Bookings took too long to refresh.'),
        withTimeout(listMyMatches({ limit: 50 }), 20000, 'Match activity took too long to refresh.'),
      ]);
      if (!active) return;

      const bookingRows = ownedBookings(
        bookingResult.status === 'fulfilled' ? bookingResult.value : cached?.bookings,
        user?.id,
      );
      const matchRows = matchResult.status === 'fulfilled' ? matchResult.value : cached?.matches;
      setBookings(bookingRows);
      if (matchRows) setMatches(matchRows);
      if (bookingRows || matchRows) {
        writeCachedData(dashboardCacheKey, { bookings: bookingRows || [], matches: matchRows || [] });
      }

      const failures = [bookingResult, matchResult].filter((result) => result.status === 'rejected');
      if (failures.length === 2 && !cached) {
        setDashboardError(failures[0].reason?.message || 'Dashboard data could not be loaded.');
      }
    })();
    return () => { active = false; };
  }, [dashboardCacheKey, dashboardRequest, online, user?.id]));

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const cached = await readCachedData(activitiesCacheKey);
      if (!active) return;
      if (cached !== null) {
        setPublicActivities(cached);
        setActivitiesLoading(false);
      }
      try {
        const rows = await withTimeout(
          listDiscoverablePlayerActivities(),
          12000,
          'Public activities took too long to refresh.',
        );
        if (!active) return;
        setPublicActivities(rows);
        setActivitiesLoading(false);
        writeCachedData(activitiesCacheKey, rows);
      } catch {
        if (active) setActivitiesLoading(false);
      }
    })();
    return () => { active = false; };
  }, [activitiesCacheKey, dashboardRequest]));

  useFocusEffect(useCallback(() => {
    let active = true;
    setSuggestionsLoading(true);
    withTimeout(listPlayerSuggestions(tablet ? 8 : 6), 12000, 'Player suggestions took too long to refresh.')
      .then((rows) => { if (active) setSuggestedPlayers(rows); })
      .catch(() => { if (active) setSuggestedPlayers([]); })
      .finally(() => { if (active) setSuggestionsLoading(false); });
    return () => { active = false; };
  }, [dashboardRequest, suggestionsRequest, tablet, user?.id]));

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const cached = await readCachedData(HOME_VENUES_CACHE_KEY);
      if (!active) return;
      if (cached) setVenues(cached);
      try {
        const rows = await withTimeout(listVenues(), 12000, 'Venues took too long to refresh.');
        if (!active) return;
        const nextVenues = rows.map((venue) => {
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
        });
        setVenues(nextVenues);
        writeCachedData(HOME_VENUES_CACHE_KEY, nextVenues);
      } catch {
        // Keep the last successful venue list visible.
      }
    })();
    return () => { active = false; };
  }, []));

  useEffect(() => {
    const client = requireSupabase();
    let refreshTimer = null;
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => setDashboardRequest((value) => value + 1), 180);
    };
    const channel = client.channel(`home-activity-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `user_id=eq.${user.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_sessions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_play_players' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competitions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'venue_programs' }, refresh)
      .subscribe((status) => reportRealtime(`home-activity-${user.id}`, status));
    return () => {
      clearTimeout(refreshTimer);
      client.removeChannel(channel);
      reportRealtime(`home-activity-${user.id}`, 'REMOVE');
    };
  }, [reportRealtime, user.id]);

  const showToast = (message) => {
    setToast(message);
    Animated.sequence([
      Animated.spring(toastAnim, { toValue: 1, useNativeDriver: Platform.OS !== 'web', bounciness: 3 }),
      Animated.delay(2200),
      Animated.timing(toastAnim, { toValue: 0, duration: 160, useNativeDriver: Platform.OS !== 'web' }),
    ]).start(() => setToast(''));
  };

  const quickMessage = (kind) => {
    if (kind === 'schedule') {
      navigation.navigate('Schedule', { newGameToken: Date.now() });
      return;
    }
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
  const requestSuggestedFollow = async (player) => {
    if (!player?.id || followingPlayerId) return;
    setFollowingPlayerId(player.id);
    try {
      await followPlayer(player.id);
      setSuggestedPlayers((current) => current.map((item) => item.id === player.id ? { ...item, followRequestPending: true } : item));
      showToast(`Follow request sent to ${player.name}.`);
    } catch (error) {
      Alert.alert('Follow request not sent', error.message || 'Please try again.');
    } finally {
      setFollowingPlayerId(null);
    }
  };
  const dismissSuggestedPlayer = (player) => {
    if (!player?.id) return;
    // Hide right away; the server remembers it so the player isn't suggested again.
    setSuggestedPlayers((current) => current.filter((item) => item.id !== player.id));
    dismissPlayerSuggestion(player.id).catch(() => {});
  };
  const nearbyCourts = useMemo(() => venues.map((court) => {
    const distanceKm = distanceInKm(userLocation, court);
    return {
      ...court,
      distanceKm,
      distance: formatDistance(distanceKm).toUpperCase(),
    };
  }).sort((a, b) => (a.distanceKm ?? Number.MAX_VALUE) - (b.distanceKm ?? Number.MAX_VALUE)), [userLocation, venues]);
  const nearbyPreview = nearbyCourts.slice(0, tablet ? 6 : 3);
  // Player-hosted games open to anyone are public activities too.
  const openGames = useMemo(() => scheduledGames
    .filter((game) => game.visibility === 'open' && game.status === 'scheduled' && !game.myStatus && game.spotsLeft > 0 && new Date(game.endsAt) > now)
    .map((game) => ({
      id: game.id,
      sourceId: game.sourceId,
      type: game.kind,
      typeLabel: game.kind === 'game' ? 'Open game' : game.typeLabel,
      isPlayerScheduled: true,
      title: game.title,
      venue: { name: game.place, area: game.area, latitude: game.latitude, longitude: game.longitude },
      startsAt: game.startsAt,
      endsAt: game.endsAt,
      feeAmount: 0,
      availability: `${game.spotsLeft} ${game.spotsLeft === 1 ? 'SPOT' : 'SPOTS'}`,
    })), [now, scheduledGames]);
  const activityPreview = useMemo(() => [...openGames, ...publicActivities]
    .sort((a, b) => {
      const distanceA = distanceInKm(userLocation, a.venue) ?? Number.MAX_VALUE;
      const distanceB = distanceInKm(userLocation, b.venue) ?? Number.MAX_VALUE;
      return distanceA - distanceB || new Date(a.startsAt) - new Date(b.startsAt);
    })
    .slice(0, tablet ? 6 : 4), [openGames, publicActivities, tablet, userLocation]);
  const upcomingBooking = useMemo(() => bookings
    .filter((booking) => booking.user_id === user?.id && ['pending', 'confirmed'].includes(booking.status) && new Date(booking.ends_at) > now)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0] || null, [bookings, now, user?.id]);
  const weekStart = startOfWeek(now).getTime();
  const weeklyMatches = useMemo(() => matches.filter((match) => match.endedAt && new Date(match.endedAt).getTime() >= weekStart), [matches, weekStart]);
  const performanceRating = useMemo(() => calculatePerformanceRating(matches), [matches]);
  const nextEntry = useMemo(() => (COURT_BOOKING_ENABLED ? null : nextOnMyCalendar([...scheduledGames, ...publicActivities.map(scheduleEntryFromActivity)], now.getTime())), [now, publicActivities, scheduledGames]);
  const openNextEntry = () => {
    if (isPlayerScheduledEntry(nextEntry)) navigation.navigate('Schedule', { openGameId: nextEntry.sourceId, openGameToken: Date.now() });
    else navigation.navigate('Schedule');
  };
  const nextBookingIsToday = upcomingBooking ? new Date(upcomingBooking.starts_at).toDateString() === now.toDateString() : false;
  const schedule = (
    <View style={styles.section}>
      <SectionTitle eyebrow="YOUR SCHEDULE" title="Next up" right={upcomingBooking ? <View style={[styles.todayChip, isDark && darkStyles.card]}><View style={styles.liveDot} /><Text style={[styles.todayText, isDark && darkStyles.text]}>{nextBookingIsToday ? 'TODAY' : 'UPCOMING'}</Text></View> : null} />
      {COURT_BOOKING_ENABLED
        ? <NextMatch booking={upcomingBooking} now={now} extending={extendingBookingId === upcomingBooking?.id} canManage={upcomingBooking?.user_id === user?.id} onExtend={() => requestExtension(upcomingBooking)} />
        : <NextScheduled entry={nextEntry} now={now} onOpen={openNextEntry} onSchedule={() => quickMessage('schedule')} />}
      {dashboardError ? <Text style={styles.dataError}>{dashboardError}</Text> : null}
      <View style={[styles.actions, isDark && darkStyles.actionDock]}>
        {COURT_BOOKING_ENABLED
          ? <ActionButton icon="calendar-outline" overline="RESERVE A SPOT" label="Book a court" type="dark" onPress={() => quickMessage('book')} />
          : <ActionButton icon="calendar-outline" overline="PLAN A GAME" label="Schedule" type="dark" onPress={() => quickMessage('schedule')} />}
        <View style={[styles.actionDivider, isDark && darkStyles.actionDivider]} />
        <ActionButton imageSource={require('../../public/images/ball.png')} overline="COURT-SIDE" label="Start live" type="accent" onPress={() => quickMessage('live')} />
        <View style={[styles.actionDivider, isDark && darkStyles.actionDivider]} />
        <ActionButton icon="people-outline" overline="BUILD A FOUR" label="Find players" type="light" onPress={() => quickMessage('players')} />
      </View>
    </View>
  );

  const openActivity = (activity) => {
    if (activity.isPlayerScheduled || activity.type === 'game') {
      navigation.navigate('Schedule', { openGameId: activity.sourceId, openGameToken: Date.now(), openView: 'discover' });
      return;
    }
    if (activity.type === 'open_play') {
      navigation.navigate('OpenPlayActivity', { token: Date.now(), sessionId: activity.sourceId, direct: true, returnTo: 'Home' });
      return;
    }
    navigation.navigate('ActivityDetails', { activity, returnTo: 'Home' });
  };
  const discovery = (
    <View style={styles.section}>
      <SectionTitle
        eyebrow={ORGANIZER_EVENTS_ENABLED ? 'PUBLIC ACTIVITIES' : 'OPEN GAMES'}
        title="Happening near you"
        right={<Pressable accessibilityRole="button" accessibilityLabel="See all public activities" onPress={() => (COURT_BOOKING_ENABLED ? navigation.navigate('Activities') : navigation.navigate('Schedule', { openView: 'discover', openViewToken: Date.now() }))} style={styles.openPlayMore}><Text style={styles.openPlayMoreText}>More</Text><Icon name="arrow-forward" size={14} color={C.ink} /></Pressable>}
      />
      {activitiesLoading && !activityPreview.length
        ? <ActivityCardsSkeleton />
        : activityPreview.length
          ? <ScrollView {...webLayout('home-cards')} horizontal={activityPreview.length > 1} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.openPlayScroll, activityPreview.length === 1 && styles.openPlayScrollSingle]}>
              {activityPreview.map((activity) => <PublicActivityCard key={activity.id} activity={activity} userLocation={userLocation} wide={tablet} single={activityPreview.length === 1} onPress={() => openActivity(activity)} />)}
            </ScrollView>
          : <View style={[styles.emptyDataCard, isDark && darkStyles.card]}><Icon name="compass-outline" size={25} color={C.teal} /><Text style={[styles.emptyDataTitle, isDark && darkStyles.text]}>No public activities yet</Text><Text style={[styles.emptyDataText, isDark && darkStyles.mutedText]}>Open games hosted by players near you will appear here.</Text></View>}
    </View>
  );
  const peopleYouMayKnow = (
    <View style={styles.section}>
      <SectionTitle eyebrow="FIND YOUR PEOPLE" title="People you may know" />
      {suggestionsLoading && !visibleSuggestedPlayers.length ? (
        <PlayerCardsSkeleton />
      ) : visibleSuggestedPlayers.length ? (
        <ScrollView {...webLayout('home-cards')} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionsScroll}>
          {visibleSuggestedPlayers.map((player) => <SuggestedPlayerCard key={player.id} player={player} wide={tablet} busy={followingPlayerId === player.id} onFollow={requestSuggestedFollow} onDismiss={dismissSuggestedPlayer} onPress={() => navigation.navigate('PublicProfile', { player })} />)}
        </ScrollView>
      ) : (
        <View style={[styles.emptyDataCard, isDark && darkStyles.card]}><Icon name="people-outline" size={25} color={C.teal} /><Text style={[styles.emptyDataTitle, isDark && darkStyles.text]}>You’re all caught up</Text><Text style={[styles.emptyDataText, isDark && darkStyles.mutedText]}>Players with mutual connections or in your home area will appear here.</Text></View>
      )}
    </View>
  );

  const weekWins = weeklyMatches.filter((match) => match.result === 'W').length;
  const weekLosses = weeklyMatches.filter((match) => match.result === 'L').length;
  const gameOverview = (
    <View style={styles.section}>
      <SectionTitle eyebrow={ORGANIZER_EVENTS_ENABLED ? 'PROGRESS & EVENTS' : 'PROGRESS & PLAY'} title="Your game" right={<Pressable accessibilityRole="button" accessibilityLabel="Open ratings and insights" onPress={() => navigation.navigate('Pickleball', { openTab: 'Ratings', ownerTab: 'Home' })} style={[styles.moreButton, isDark && darkStyles.card]}><Icon name="arrow-forward" size={18} /></Pressable>} />
      <View style={styles.gameOverviewGrid}>
        <Pressable accessibilityRole="button" accessibilityLabel="View this week's matches" onPress={() => navigation.navigate('Profile', { openTab: 'Matches', openTabToken: Date.now() })} style={({ pressed }) => [styles.gameOverviewCard, isDark && darkStyles.card, pressed && styles.pressed]}>
          <View style={[styles.gameOverviewIcon, isDark && darkStyles.subtle]}><Icon name="pulse-outline" size={20} color={C.teal} /></View>
          <Text style={[styles.gameOverviewEyebrow, isDark && darkStyles.mutedText]}>{weekLabel(now)}</Text>
          <Text style={[styles.gameOverviewTitle, isDark && darkStyles.text]}>{weeklyMatches.length ? `${weekWins}–${weekLosses}` : 'No matches'}</Text>
          <Text style={[styles.gameOverviewMeta, isDark && darkStyles.mutedText]}>{performanceRating ? `${performanceRating} rating` : 'Record a match to start'}</Text>
        </Pressable>
        {ORGANIZER_EVENTS_ENABLED
          ? <Pressable accessibilityRole="button" accessibilityLabel="Explore competitions and programs" onPress={() => navigation.navigate('Pickleball', { openTab: 'Compete', ownerTab: 'Home' })} style={({ pressed }) => [styles.gameOverviewCard, styles.gameOverviewCardAccent, pressed && styles.pressed]}>
              <View style={styles.gameOverviewIconAccent}><Icon name="trophy-outline" size={20} color={C.ink} /></View>
              <Text style={styles.gameOverviewEyebrowAccent}>COMPETE & LEARN</Text>
              <Text style={styles.gameOverviewTitleAccent}>Events</Text>
              <Text style={styles.gameOverviewMetaAccent}>Competitions, clinics and programs</Text>
            </Pressable>
          : <Pressable accessibilityRole="button" accessibilityLabel="Host an open game" onPress={() => quickMessage('schedule')} style={({ pressed }) => [styles.gameOverviewCard, styles.gameOverviewCardAccent, pressed && styles.pressed]}>
              <View style={styles.gameOverviewIconAccent}><Icon name="add" size={20} color={C.ink} /></View>
              <Text style={styles.gameOverviewEyebrowAccent}>HOST & PLAY</Text>
              <Text style={styles.gameOverviewTitleAccent}>Host a game</Text>
              <Text style={styles.gameOverviewMetaAccent}>{openGames.length ? `${openGames.length} open ${openGames.length === 1 ? 'game' : 'games'} to join nearby` : 'Open a game any player can join'}</Text>
            </Pressable>}
      </View>
    </View>
  );
  const shortLocation = userLocation.label.split('·')[0].trim();
  const nearby = (
    <View style={styles.section}>
      <SectionTitle eyebrow="COURT LOCATIONS" title="Nearby courts" right={<View style={styles.nearbyHeaderActions}>{nearbyCourts.length > nearbyPreview.length && <Pressable accessibilityLabel="See all nearby courts" onPress={() => navigation.navigate('Book')} style={styles.nearbySeeAll}><Text style={styles.nearbySeeAllText}>See all</Text></Pressable>}<Pressable accessibilityLabel="Change search location" onPress={() => setLocationOpen(true)} style={[styles.seeAll, isDark && darkStyles.locationPill]}><Icon name="location-outline" size={13} color={isDark ? '#D5DFDB' : C.teal} /><Text numberOfLines={1} style={[styles.seeAllText, isDark && darkStyles.locationPillText]}>{shortLocation}</Text><Icon name="chevron-down" size={12} color={isDark ? '#D5DFDB' : C.teal} /></Pressable></View>} />
      {nearbyCourts.length ? <ScrollView {...webLayout('home-cards')} horizontal={nearbyPreview.length > 1} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.courtScroll, nearbyPreview.length === 1 && styles.courtScrollSingle]}>
        {nearbyPreview.map((court) => <CourtCard key={court.id} court={court} wide={tablet} single={nearbyPreview.length === 1} onPress={() => navigation.navigate('Book', { courtId: court.id, from: 'Home' })} />)}
      </ScrollView> : <View style={[styles.emptyDataCard, isDark && darkStyles.card]}><Icon name="location-outline" size={25} color={C.teal} /><Text style={[styles.emptyDataTitle, isDark && darkStyles.text]}>No bookable courts yet</Text><Text style={[styles.emptyDataText, isDark && darkStyles.mutedText]}>Active venues will appear here when they are added.</Text></View>}
    </View>
  );
  const feed = <View style={styles.section}><SectionTitle eyebrow="THE SCOREBOARD" title="Activity" right={<Pressable accessibilityLabel="See all match activity" onPress={() => navigation.navigate('Profile', { openTab: 'Matches', openTabToken: Date.now() })} style={[styles.moreButton, isDark && darkStyles.card]}><Icon name="ellipsis-horizontal" size={20} /></Pressable>} /><ActivityList matches={matches} now={now} /></View>;

  return (
    <SafeAreaView style={[styles.safe, isDark && darkStyles.safe]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={isDark ? C.ink : C.paper} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, compactHeader && styles.contentCompact, tablet && styles.contentTablet, desktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
        <View {...webLayout('home-header')} style={[styles.header, compactHeader && styles.headerCompact, desktop && styles.headerDesktop]}>
          <View {...webLayout('home-header-profile')} style={styles.headerProfileGroup}>
            {desktop ? null : ACCOUNT_MENU_NAV ? <Pressable accessibilityRole="button" accessibilityLabel="Open your account menu" hitSlop={6} onPress={() => setAccountMenuOpen(true)} style={({ pressed }) => [styles.headerAvatarButton, pressed && styles.pressed]}><ProfilePhoto photo={user?.picture || user?.avatar} name={displayName} size={compactHeader ? 44 : 46} /></Pressable> : <ProfilePhoto photo={user?.picture || user?.avatar} name={displayName} size={narrowHeader ? 38 : compactHeader ? 44 : 46} />}
            <View style={styles.headerIdentityCopy}>
              {!desktop ? <View style={styles.greetingRow}><Text {...webLayout('home-greeting')} numberOfLines={1} style={[styles.greeting, isDark && styles.greetingDark]}>{greeting.text}</Text></View> : null}
              {desktop
                ? <Text {...webLayout('home-header-title')} accessibilityRole="header" style={[styles.h1, styles.h1Desktop, isDark && darkStyles.text]}><Text style={[styles.h1Muted, isDark && darkStyles.mutedText]}>{greeting.text}, </Text>{firstName}</Text>
                : <Text {...webLayout('home-header-title')} accessibilityRole="header" numberOfLines={1} style={[styles.h1, compactHeader && styles.h1Compact, isDark && darkStyles.text]}>{firstName}</Text>}
            </View>
          </View>
          {/* Desktop already lists Leaderboard in the sidebar, so it keeps just two standalone buttons. */}
          <View {...webLayout('home-header-actions')} style={desktop ? styles.headerActionsDesktop : [styles.headerDock, isDark && darkStyles.headerDock]}>
            <HeaderAction docked={!desktop} compact={compactHeader} active={isDark && !desktop} icon={isDark ? 'sunny-outline' : 'moon-outline'} label={isDark ? 'Use light dashboard' : 'Use dark dashboard'} onPress={toggleColorMode} />
            {desktop ? null : <HeaderAction docked compact={compactHeader} icon="podium-outline" label="Open leaderboard" textLabel="Leaderboard" onPress={() => navigation.navigate('Leaderboard', { defaultFormat: user?.preference?.toLowerCase() === 'singles' ? 'singles' : 'doubles' })} />}
            <HeaderAction docked={!desktop} compact={compactHeader} icon="notifications-outline" label={`Open notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} onPress={() => setNotifications(true)} badgeCount={unreadCount} />
          </View>
        </View>
        <KitchenLine style={[styles.headerLine, compactHeader && styles.headerLineCompact]} />
        {tablet ? <View {...webLayout('home')} style={styles.tabletGrid}><View style={styles.primaryColumn}>{schedule}{discovery}{peopleYouMayKnow}{COURT_BOOKING_ENABLED ? nearby : null}</View><View style={styles.secondaryColumn}>{gameOverview}{feed}</View></View> : <>{schedule}{discovery}{peopleYouMayKnow}{gameOverview}{COURT_BOOKING_ENABLED ? nearby : null}{feed}</>}
      </ScrollView>
      <NotificationSheet visible={notifications} onClose={() => setNotifications(false)} items={notices} unreadCount={unreadCount} onRead={(id) => readNotification(id).catch((error) => Alert.alert('Notifications', error.message || 'This notification could not be marked as read.'))} onReadAll={() => readAllNotifications().catch((error) => Alert.alert('Notifications', error.message || 'Notifications could not be marked as read.'))} onDelete={removeNotification} onClearRead={clearNotifications} onFollowResponse={respondToFollow} onOpen={(item) => { if (!item.read_at && item.kind !== 'team_invite') readNotification(item.id).catch(() => {}); setNotifications(false); if (item.kind === 'community_announcement' && item.data?.eventKind && item.data?.eventId) navigation.navigate('CommunityChat', { eventKind: item.data.eventKind, eventId: item.data.eventId, ownerTab: 'Home' }); else if (item.data?.conversationId) navigation.navigate('DirectChat', { conversationId: item.data.conversationId, player: item.data?.playerId ? { id: item.data.playerId } : undefined, ownerTab: 'Team' }); else if (item.data?.teamId && item.kind?.startsWith('team_invite')) navigation.navigate('Team', { openInvitationTeamId: item.data.teamId, openInvitationToken: Date.now() }); else if (item.data?.teamId && item.kind === 'team_mention') navigation.navigate('Team', { openChatTeamId: item.data.teamId, openChatToken: Date.now() }); else if (item.data?.gameId) navigation.navigate('Schedule', { openGameId: item.data.gameId, openGameToken: Date.now() }); else if (item.data?.sessionId) navigation.navigate('OpenPlayActivity', { token: Date.now(), sessionId: item.data.sessionId, direct: true, returnTo: 'Home' }); }} />
      <LocationPicker visible={locationOpen} onClose={() => setLocationOpen(false)} />
      {!!toast && <Animated.View style={[styles.toast, { opacity: toastAnim, transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }]}><Text style={styles.toastText}>{toast}</Text></Animated.View>}
    </SafeAreaView>
  );
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 } });
const styles = createMobileStyleSheet({
  contentDesktop: { paddingHorizontal: 24, maxWidth: 1040, paddingBottom: 40 },
  safe: { flex: 1, backgroundColor: C.paper },
  headerAvatarButton: { flexShrink: 0, borderRadius: 24 },
  headerActionLabel: { color: C.ink, fontSize: 13, fontWeight: '600' },
  scroll: { flex: 1 }, content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 126 }, contentCompact: { paddingHorizontal: 16, paddingTop: 22 }, contentTablet: { paddingHorizontal: 34, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, headerCompact: { minHeight: 48, gap: 9 }, headerProfileGroup: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }, headerIdentityCopy: { flex: 1, minWidth: 0 }, eyebrow: { color: C.ink40, fontSize: 10, lineHeight: 15, fontWeight: '700', letterSpacing: 1.05 }, eyebrowLight: { color: 'rgba(243,245,239,0.52)' },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, greeting: { flexShrink: 1, color: C.teal, fontSize: 13, lineHeight: 17, fontWeight: '600', letterSpacing: -0.1 }, greetingDark: { color: C.optic },
  h1: { marginTop: 1, color: C.ink, fontSize: 24, lineHeight: 29, fontWeight: '600', letterSpacing: -0.9 }, h1Compact: { fontSize: 22, lineHeight: 27, letterSpacing: -0.6 }, h1Desktop: { marginTop: 6, fontSize: 36, lineHeight: 42, letterSpacing: -1.4 }, h1Muted: { color: C.ink40 },
  headerDesktop: { alignItems: 'flex-end', paddingTop: 8 }, headerDock: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 2, padding: 3, borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.surface, ...shadow }, headerActionsDesktop: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }, headerActionDocked: { borderWidth: 0, backgroundColor: 'transparent', borderRadius: 12, ...noShadow, elevation: 0 }, h2: { marginTop: 3, color: C.ink, fontSize: 23, lineHeight: 29, fontWeight: '700', letterSpacing: -0.5 },
  headerAction: { width: 36, height: 36, borderWidth: 1, borderColor: C.line, borderRadius: 11, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', ...shadow }, headerActionCompact: { width: 34, height: 34, borderRadius: 10 }, headerActionActive: { backgroundColor: C.optic }, headerActionActiveDark: { backgroundColor: C.optic }, unreadBadge: { position: 'absolute', top: -6, right: -7, minWidth: 19, height: 19, paddingHorizontal: 5, borderRadius: 10, borderWidth: 2, borderColor: C.surface, backgroundColor: C.brick, alignItems: 'center', justifyContent: 'center' }, unreadBadgeText: { color: '#FFFFFF', fontSize: 10, lineHeight: 12, fontWeight: '900' },
  kitchen: { height: 7, marginVertical: 18 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 }, headerLine: { marginTop: 10, marginBottom: 16 }, headerLineCompact: { marginTop: 18, marginBottom: 14 },
  openPlayMore: { minHeight: 40, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 13, backgroundColor: C.optic }, openPlayMoreText: { color: C.ink, fontSize: 9, fontWeight: '900' },
  openPlayScroll: { paddingRight: 20, gap: 12 }, openPlayScrollSingle: { width: '100%', paddingRight: 0 },
  homeOpenPlayCard: { width: 252, minHeight: 166, padding: 13, borderWidth: 1, borderColor: C.line, borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: C.surface, ...shadow }, homeOpenPlayCardWide: { width: 280 }, homeOpenPlayCardSingle: { width: '100%', flex: 1, minWidth: '100%' },
  homeOpenPlayTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, homeOpenPlayVerified: { minHeight: 25, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 13, backgroundColor: '#E5F0ED' }, homeOpenPlayVerifiedText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .45 }, homeOpenPlayFee: { color: C.ink, fontSize: 11, fontWeight: '900' },
  homeOpenPlayName: { marginTop: 10, color: C.ink, fontSize: 15, lineHeight: 19, fontWeight: '900' }, homeOpenPlayVenue: { marginTop: 3, color: C.teal, fontSize: 8, fontWeight: '800' }, homeOpenPlayMeta: { marginTop: 9, flexDirection: 'row', alignItems: 'center', gap: 6 }, homeOpenPlayMetaText: { flex: 1, color: C.ink70, fontSize: 8 },
  homeOpenPlayFoot: { marginTop: 9, paddingTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderColor: C.line }, homeOpenPlayDistance: { color: C.ink40, fontSize: 8, fontWeight: '800' }, homeOpenPlaySpots: { minHeight: 23, paddingHorizontal: 8, justifyContent: 'center', borderRadius: 12, backgroundColor: C.optic }, homeOpenPlaySpotsText: { color: C.ink, fontSize: 6, fontWeight: '900' }, homeOpenPlayWaitlist: { backgroundColor: '#F7EAE6' }, homeOpenPlayWaitlistText: { color: C.brick },
  suggestionsScroll: { paddingRight: 20, gap: 12 },
  suggestedPlayerCard: { width: 190, minHeight: 225, padding: 15, borderWidth: 1, borderColor: C.line, borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: C.surface, ...shadow },
  suggestedPlayerCardWide: { width: 210 },
  suggestedPlayerTop: { alignItems: 'center' },
  suggestedDismissButton: { position: 'absolute', top: 8, right: 8, zIndex: 1, width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  suggestedPlayerMutuals: { textAlign: 'center', marginBottom: 10, color: C.ink40, fontSize: 9, fontWeight: '800' },
  suggestedPlayerFollowers: { textAlign: 'center', marginTop: 10, color: C.ink40, fontSize: 9, fontWeight: '700' },
  suggestedPlayerFollowersStrong: { color: C.ink, fontWeight: '900' },
  suggestedPlayerName: { textAlign: 'center', marginTop: 6, color: C.ink, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  suggestedPlayerReason: { textAlign: 'center', marginTop: 2, color: C.teal, fontSize: 9, lineHeight: 13, fontWeight: '800' },
  suggestedPlayerMeta: { textAlign: 'center', minHeight: 16, marginTop: 5, color: C.ink40, fontSize: 8, lineHeight: 12 },
  suggestedFollowButton: { minHeight: 42, marginTop: 'auto', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 13, backgroundColor: C.optic },
  suggestedFollowButtonPending: { borderWidth: 1, borderColor: C.line, backgroundColor: C.paper },
  suggestedFollowText: { color: C.ink, fontSize: 10, fontWeight: '900' },
  suggestedFollowTextPending: { color: C.teal },
  gameOverviewGrid: { flexDirection: 'row', gap: 10 }, gameOverviewCard: { flex: 1, minWidth: 0, minHeight: 138, padding: 14, borderWidth: 1, borderColor: C.line, borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: C.surface, ...shadow }, gameOverviewCardAccent: { borderColor: C.optic, backgroundColor: C.optic },
  gameOverviewIcon: { width: 38, height: 38, marginBottom: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, gameOverviewIconAccent: { width: 38, height: 38, marginBottom: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,.5)' },
  gameOverviewEyebrow: { color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .55 }, gameOverviewEyebrowAccent: { color: C.ink70, fontSize: 6, fontWeight: '900', letterSpacing: .55 }, gameOverviewTitle: { marginTop: 3, color: C.ink, fontSize: 17, fontWeight: '900' }, gameOverviewTitleAccent: { marginTop: 3, color: C.ink, fontSize: 17, fontWeight: '900' }, gameOverviewMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 11 }, gameOverviewMetaAccent: { marginTop: 3, color: C.ink70, fontSize: 8, lineHeight: 11 },
  tabletGrid: { flexDirection: 'row', gap: 30 }, primaryColumn: { flex: 1.55, minWidth: 0 }, secondaryColumn: { flex: 1, minWidth: 310 }, section: { marginBottom: 34 }, sectionTitle: { minHeight: 48, marginBottom: 13, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, sectionTitleMain: { flex: 1, minWidth: 0, paddingRight: 10 },
  competitiveCard: { overflow: 'hidden', padding: 18, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: C.ink, ...shadow }, competitiveGlow: { position: 'absolute', width: 190, height: 190, right: -95, top: -105, borderRadius: 95, backgroundColor: 'rgba(214,233,74,.12)' }, competitiveHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, competitiveIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: C.optic }, competitiveBallImage: { width: 27, height: 27 }, competitiveHeadCopy: { flex: 1, minWidth: 0 }, competitiveEyebrow: { color: 'rgba(243,245,239,.5)', fontSize: 7, fontWeight: '900', letterSpacing: .85 }, competitiveTitle: { marginTop: 3, color: C.paper, fontSize: 21, fontWeight: '900', letterSpacing: -.45 }, competitiveLive: { paddingHorizontal: 7, minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, backgroundColor: 'rgba(255,255,255,.08)' }, competitiveLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.optic }, competitiveLiveText: { color: C.paper, fontSize: 6, fontWeight: '900', letterSpacing: .45 }, competitiveBody: { maxWidth: 390, marginTop: 14, color: 'rgba(243,245,239,.68)', fontSize: 11, lineHeight: 17 }, competitiveMetrics: { minHeight: 70, marginTop: 16, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(243,245,239,.12)' }, competitiveMetric: { flex: 1, alignItems: 'center' }, competitiveMetricValue: { color: C.paper, fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] }, competitiveMetricLabel: { marginTop: 3, color: 'rgba(243,245,239,.42)', fontSize: 6, fontWeight: '900', letterSpacing: .65 }, competitiveMetricDivider: { width: 1, height: 31, backgroundColor: 'rgba(243,245,239,.12)' }, competitiveActions: { marginTop: 15, flexDirection: 'row', gap: 8 }, competitivePrimary: { minHeight: 45, flex: 1.15, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 13, backgroundColor: C.optic }, competitivePrimaryText: { color: C.ink, fontSize: 10, fontWeight: '900' }, competitiveSecondary: { minHeight: 45, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(243,245,239,.2)', borderRadius: 13 }, competitiveSecondaryText: { color: C.paper, fontSize: 10, fontWeight: '900' },
  todayChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.optic }, todayText: { color: C.ink, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  emptyDataCard: { minHeight: 132, padding: 20, borderWidth: 1, borderColor: C.line, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, ...shadow }, emptyDataTitle: { marginTop: 8, color: C.ink, textAlign: 'center', fontSize: 15, fontWeight: '800' }, emptyDataText: { maxWidth: 310, marginTop: 5, color: C.ink40, textAlign: 'center', fontSize: 11, lineHeight: 16 }, dataError: { marginTop: 8, color: C.brick, fontSize: 10, lineHeight: 15 },
  nextCard: { borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden', backgroundColor: C.ink, ...shadow }, courtGraphic: { height: 142, overflow: 'hidden' }, courtBounds: { position: 'absolute', left: '15%', right: '15%', top: 17, bottom: -23, borderWidth: 2, borderColor: 'rgba(255,255,255,0.58)', transform: [{ perspective: 250 }, { rotateX: '42deg' }] }, courtCenterLine: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2, backgroundColor: 'rgba(255,255,255,0.55)' }, courtKitchenLine: { position: 'absolute', left: 0, right: 0, top: '27%', height: 2, backgroundColor: 'rgba(255,255,255,0.48)' }, courtKitchenLineTwo: { top: '72%' }, courtNumber: { position: 'absolute', left: 14, bottom: 3, color: 'rgba(255,255,255,0.14)', fontSize: 52, fontWeight: '800', fontVariant: ['tabular-nums'] }, indoorBadge: { position: 'absolute', left: 13, top: 12, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: 'rgba(14,35,33,0.74)' }, indoorText: { color: C.paper, fontSize: 8, fontWeight: '800', letterSpacing: 0.9 },
  nextBody: { padding: 20 }, nextTitle: { marginTop: 5, marginBottom: 13, color: C.paper, fontSize: 23, lineHeight: 29, fontWeight: '700', letterSpacing: -0.5 }, metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 5 }, metaText: { color: 'rgba(243,245,239,0.7)', fontSize: 12 }, nextDivider: { marginTop: 14, marginBottom: 14 }, opponentRow: { flexDirection: 'row', alignItems: 'center' }, avatarRow: { flexDirection: 'row' }, avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: C.paper, alignItems: 'center', justifyContent: 'center' }, avatarOffset: { marginLeft: -9 }, avatarText: { color: '#fff', fontSize: 9, fontWeight: '800' }, vs: { marginHorizontal: 8, color: 'rgba(243,245,239,0.4)', fontSize: 9, fontWeight: '800' }, opponentName: { flex: 1, marginLeft: 9 }, tinyLight: { color: 'rgba(243,245,239,0.43)', fontSize: 8, fontWeight: '700', letterSpacing: 0.8 }, opponentText: { color: C.paper, fontSize: 12, fontWeight: '700' }, countdown: { alignItems: 'flex-end', marginLeft: 8 }, countdownText: { color: C.optic, fontSize: 16, lineHeight: 21, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timeWarning: { marginTop: 15, paddingTop: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1, borderColor: 'rgba(243,245,239,.13)' }, timeWarningCopy: { flex: 1 }, timeWarningTitle: { color: C.optic, fontSize: 10, fontWeight: '900' }, timeWarningText: { marginTop: 2, color: 'rgba(243,245,239,.66)', fontSize: 9, lineHeight: 13 }, extendButton: { minHeight: 46, marginTop: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, backgroundColor: C.optic }, extendButtonDisabled: { opacity: .58 }, extendButtonText: { color: C.ink, fontSize: 10, fontWeight: '900' },
  actions: { minHeight: 96, marginTop: 12, padding: 6, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 22, backgroundColor: C.surface, ...shadow }, actionButton: { flex: 1, minWidth: 0, minHeight: 82, paddingHorizontal: 4, paddingVertical: 8, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, actionIcon: { width: 38, height: 38, marginBottom: 7, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, actionDivider: { width: 1, height: 54, backgroundColor: C.line }, actionCopy: { width: '100%', alignItems: 'center' }, actionOverline: { width: '100%', color: C.ink40, textAlign: 'center', fontSize: 6, fontWeight: '900', letterSpacing: 0.55 }, actionLabel: { width: '100%', marginTop: 2, color: C.ink, textAlign: 'center', fontSize: 10.5, lineHeight: 15, fontWeight: '800' }, pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  weekFormContainer: { flexDirection: 'row', gap: 5 }, weekFormChip: { width: 25, height: 25, borderRadius: 13, backgroundColor: '#E5F0ED', alignItems: 'center', justifyContent: 'center' }, weekFormChipLoss: { backgroundColor: '#F7EAE6' }, weekFormText: { color: C.teal, fontSize: 10, fontWeight: '800' }, weekFormTextLoss: { color: C.brick }, statCard: { padding: 19, borderWidth: 1, borderColor: C.line, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: C.surface, ...shadow }, statFormHeader: { marginBottom: 15, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: C.line }, statTop: { flexDirection: 'row', alignItems: 'center', gap: 15 }, rateRing: { width: 100, height: 100, borderRadius: 50, borderWidth: 9, borderColor: C.teal, borderRightColor: C.line, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-18deg' }] }, rateRingInner: { alignItems: 'center', transform: [{ rotate: '18deg' }] }, rateNumber: { color: C.ink, fontSize: 24, lineHeight: 26, fontWeight: '800', fontVariant: ['tabular-nums'] }, ratePercent: { fontSize: 11 }, ringLabel: { color: C.ink40, fontSize: 6.5, fontWeight: '800', letterSpacing: 0.6 }, rateLead: { color: C.ink, fontSize: 17, fontWeight: '700' }, rateBody: { color: C.ink70, fontSize: 13 }, rateUp: { marginTop: 4, color: C.teal, fontSize: 10, fontWeight: '600' }, statDivider: { marginVertical: 18 }, ratingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, ratingInline: { flexDirection: 'row', alignItems: 'baseline', gap: 10 }, ratingNumber: { color: C.ink, fontSize: 34, lineHeight: 38, fontWeight: '800', fontVariant: ['tabular-nums'] }, ratingCategory: { minHeight: 27, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#E5F0ED' }, ratingCategoryText: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .45 }, trendChip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, overflow: 'hidden', backgroundColor: '#E5F0ED', color: C.teal, fontSize: 10, fontWeight: '800' }, track: { height: 5, marginTop: 10, borderRadius: 3, overflow: 'hidden', backgroundColor: C.line }, trackFill: { width: '72%', height: '100%', backgroundColor: C.teal }, trackLabels: { marginTop: 5, flexDirection: 'row', justifyContent: 'space-between' }, trackLabel: { color: C.ink40, fontSize: 9 },
  weekEmptyCard: { minHeight: 252, padding: 22, overflow: 'hidden', borderWidth: 1, borderColor: C.line, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: C.surface, ...shadow },
  weekEmptyGlow: { position: 'absolute', width: 170, height: 170, top: -105, right: -62, borderRadius: 85, backgroundColor: 'rgba(214,233,74,.12)' },
  weekEmptyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekEmptyMark: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF3F0' },
  weekEmptyMarkDark: { backgroundColor: 'rgba(214,233,74,.1)' },
  weekEmptyBall: { width: 30, height: 30 },
  weekEmptyStatus: { minHeight: 29, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#C8D5CF', borderRadius: 10, backgroundColor: 'rgba(255,255,255,.76)' },
  weekEmptyStatusDark: { borderColor: '#3B5550', backgroundColor: '#203B37' },
  weekEmptyStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.optic },
  weekEmptyStatusText: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .75 },
  weekEmptyStatusTextDark: { color: '#B7CAC4' },
  weekEmptyTitle: { marginTop: 20, color: C.ink, fontSize: 24, lineHeight: 29, fontWeight: '800', letterSpacing: -.55 },
  weekEmptyBody: { maxWidth: 330, marginTop: 7, color: C.ink70, fontSize: 11, lineHeight: 17 },
  weekEmptyButton: { minHeight: 48, marginTop: 21, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: C.optic },
  weekEmptyButtonText: { color: C.ink, fontSize: 11, fontWeight: '900' },
  nearbyHeaderActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }, nearbySeeAll: { minHeight: 40, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.optic }, nearbySeeAllText: { color: '#0E2321', fontSize: 9, fontWeight: '900' }, seeAll: { maxWidth: 160, minHeight: 34, paddingHorizontal: 10, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, seeAllText: { flexShrink: 1, color: C.teal, fontSize: 11, fontWeight: '800' }, courtScroll: { paddingRight: 20, gap: 12 }, courtScrollSingle: { width: '100%', paddingRight: 0 }, courtCard: { width: 300, borderWidth: 1, borderColor: C.line, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden', backgroundColor: C.surface, ...shadow }, courtCardWide: { width: 320 }, courtCardSingle: { width: '100%', flex: 1, minWidth: '100%' }, courtGraphicCompact: { height: 125 }, courtBoundsCompact: { top: 11, bottom: -40 }, distance: { position: 'absolute', top: 10, right: 10, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(14,35,33,0.82)' }, distanceText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 0.8 }, courtInfo: { flexDirection: 'row', gap: 8, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 8 }, courtInfoMain: { flex: 1 }, courtName: { color: C.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' }, locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 }, courtLocation: { color: C.ink40, fontSize: 10 }, price: { color: C.teal, fontSize: 14, fontWeight: '800' }, perHour: { color: C.ink40, fontSize: 9, fontWeight: '400' }, chips: { flexDirection: 'row', gap: 5, paddingHorizontal: 13, paddingBottom: 13 }, chip: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, overflow: 'hidden', backgroundColor: C.paper, color: C.ink70, fontSize: 8, fontWeight: '800' }, ratingChip: { color: C.teal },
  moreButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface }, activityCard: { borderWidth: 1, borderColor: C.line, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden', backgroundColor: C.surface, ...shadow }, activityItem: { minHeight: 78, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, activityDivider: { height: 5, marginHorizontal: 14 }, activityIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, activityCopy: { flex: 1 }, activityText: { color: C.ink70, fontSize: 12, lineHeight: 17 }, bold: { color: C.ink, fontWeight: '800' }, activityMeta: { marginTop: 2, color: C.ink40, fontSize: 9 }, activityOpponents: { flexDirection: 'row', alignItems: 'center' }, activityOpponentPhoto: { borderWidth: 2, borderColor: C.surface }, activityOpponentOverlap: { marginLeft: -10 }, activityTail: { minWidth: 25, alignItems: 'flex-end' }, activityTailMuted: { width: 27, height: 27, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper }, activityTailWon: { backgroundColor: C.optic, ...dropShadow({ color: C.optic, opacity: 0.4, radius: 4 }) }, tailText: { color: C.teal, fontSize: 11, fontWeight: '800' }, tailTextWon: { color: '#0E2321', fontSize: 11, fontWeight: '900' }, tailMuted: { color: C.ink40 }, tailBrick: { color: C.brick },
  bottomNav: { position: 'absolute', left: 12, right: 12, bottom: Platform.OS === 'ios' ? 9 : 12, height: 76, paddingHorizontal: 5, borderWidth: 1, borderColor: C.line, borderRadius: 20, flexDirection: 'row', backgroundColor: C.surface, ...Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } }, android: { elevation: 9 } }) }, navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }, navLabel: { color: C.ink40, fontSize: 9, fontWeight: '700' }, navLabelActive: { color: C.ink }, activeTick: { position: 'absolute', top: -4, width: 24 }, playButton: { width: 52, height: 52, marginTop: -28, borderRadius: 26, borderWidth: 5, borderColor: C.surface, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic },
  toast: { position: 'absolute', left: 20, right: 20, bottom: 100, minHeight: 48, paddingHorizontal: 17, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink, ...shadow }, toastText: { color: C.paper, textAlign: 'center', fontSize: 12, fontWeight: '700' },
});

const darkStyles = createMobileStyleSheet({
  safe: { backgroundColor: C.ink },
  card: { backgroundColor: '#17302D', borderColor: '#304743' },
  activityOpponentPhoto: { borderColor: '#17302D' },
  headerAction: { backgroundColor: '#17302D', borderColor: '#304743' },
  headerDock: { backgroundColor: '#17302D', borderColor: '#304743' },
  actionDock: { backgroundColor: '#17302D', borderColor: '#304743' },
  actionDivider: { backgroundColor: '#304743' },
  subtle: { backgroundColor: '#203B37' },
  themeButton: { backgroundColor: '#203B37', borderColor: '#3B5550' },
  unreadBadge: { borderColor: '#17302D' },
  border: { borderColor: '#304743' },
  ring: { borderRightColor: '#304743' },
  track: { backgroundColor: '#304743' },
  chip: { backgroundColor: '#203B37', color: '#D5DFDB' },
  solidLight: { backgroundColor: 'rgba(255,255,255,.78)' },
  dashedLight: { borderColor: 'rgba(255,255,255,.38)' },
  text: { color: C.paper },
  bodyText: { color: '#C1CECA' },
  mutedText: { color: '#8FA39C' },
  eyebrowDark: { color: '#B2C5C0' },
  locationText: { color: '#D5DFDB' },
  locationPill: { backgroundColor: '#17302D', borderColor: '#304743' },
  locationPillText: { color: '#D5DFDB', fontWeight: '800' },
  accentText: { color: C.optic },
});
