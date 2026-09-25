import Modal from '../components/ResponsiveModal';
import { webLayout, webDialog } from '../utils/webLayout';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { searchRegisteredPlayers } from '../services/nearbyPlayers';
import {
  ActivityIndicator,
  Animated,
  Alert,
  BackHandler,
  Easing,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import Ionicons from '@expo/vector-icons/Ionicons';
import AppIcon from '../components/AppIcon';
import { captureRef } from 'react-native-view-shot';
import { exportWebMatchCard } from '../services/exportWebMatchCard';
import PlayerOpenPlayScreen from './PlayerOpenPlayScreen';
import ResilientImage from '../components/ResilientImage';
import CourtLineup from '../components/CourtLineup';
import LeaveMatchDialog from '../components/LeaveMatchDialog';
import { normalizeProfilePhoto } from '../services/profilePhotos';
import ScrollView from '../components/FocusResetScrollView';
import RallyBall from '../components/RallyBall';
import useRallyBallAnimation from '../hooks/useRallyBallAnimation';
import { useAuth } from '../context/AuthContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { listMyBookings, listTeams, loadUnfinishedMatch, saveCompletedMatch, saveUnfinishedMatch } from '../services/database';
import { listFollowingPlayers } from '../services/directMessages';
import { useNearbyPlayersContext } from '../context/NearbyPlayersContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import { announceScoreForVoiceOver, speakScoreAnnouncement, stopScoreAnnouncement } from '../utils/scoreAccessibility';
import useShoutScoring from '../hooks/useShoutScoring';
import useMatchDraft from '../hooks/useMatchDraft';
import { PRIVATE_MESSAGES_ENABLED, NATIVE_VOICE_SCORING_ENABLED } from '../config/features';
import { parseVoiceMatchCommand } from '../utils/voiceMatchCommands';
import { evenSidePlayerFromCurrentServer, playerForSideOut, resolveRallyState } from '../utils/liveMatchScoring';
import { DEMO_MODE } from '../config/demoMode';
import { DEMO_LIVE_MATCH } from '../config/demoData';
import { HeaderAvatar } from '../components/AccountMenu';

const BALL_IMAGE = require('../../public/images/ball.png');

const LIGHT_C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA',
};
let C = LIGHT_C;

const emptyLineup = (currentUserName) => [[currentUserName || 'You', ''], ['', '']];
const normalizedPlayerName = (name) => name?.trim().toLocaleLowerCase() || '';

function isConfirmedBooking(booking) {
  return booking?.status === 'confirmed' && new Date(booking.ends_at).getTime() > Date.now();
}

function isCourtBookingActive(court, now = Date.now()) {
  const startsAt = new Date(court?.bookingStartsAt).getTime();
  const endsAt = new Date(court?.bookingEndsAt).getTime();
  return Boolean(court?.bookingId && Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now && now < endsAt);
}

function bookingTimeLabel(booking) {
  const startsAt = new Date(booking.starts_at);
  const endsAt = new Date(booking.ends_at);
  const timeZone = booking.venues?.time_zone || 'Asia/Manila';
  const time = (date) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  const date = startsAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
  return startsAt.getTime() <= Date.now()
    ? `Booked now · until ${time(endsAt)}`
    : `Booked ${date} · ${time(startsAt)}–${time(endsAt)}`;
}

function playableCourtsFromBookings(bookings) {
  return (bookings || [])
    .filter(isConfirmedBooking)
    .filter((booking) => booking.courts && booking.venues)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .map((booking) => ({
      id: booking.court_id,
      bookingId: booking.id,
      bookingStartsAt: booking.starts_at,
      bookingEndsAt: booking.ends_at,
      name: booking.venues.name,
      detail: `${booking.courts.name} · ${booking.courts.environment || 'Court'}`,
      distance: booking.venues.area || 'Confirmed reservation',
      next: bookingTimeLabel(booking),
      color: booking.venues.color || C.teal,
    }));
}

function Icon({ name, size = 20, color = C.ink }) {
  return <AppIcon name={name} size={size} color={color} />;
}

function KitchenLine({ dark = false, style }) {
  return <View style={[styles.kitchen, style]}><View style={[styles.solid, dark && styles.solidLight]} /><View style={[styles.dashed, dark && styles.dashedLight]} /></View>;
}

function Header({ eyebrow, title, action, onBack }) {
  return (
    <>
      <View style={styles.header}>
        {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Back to Play options" hitSlop={6} onPress={onBack} style={styles.headerBack}><Icon name="arrow-back" /></Pressable> : null}
        <View style={styles.headerCopy}><Text numberOfLines={1} style={styles.eyebrow}>{eyebrow}</Text><Text numberOfLines={1} style={styles.h1}>{title}</Text></View>
        {action}
      </View>
      <KitchenLine style={styles.headerLine} />
    </>
  );
}

function SegmentedControl({ label, options, value, onChange }) {
  const selectedIndex = options.findIndex((o) => o.value === value);
  const [containerWidth, setContainerWidth] = useState(0);
  const anim = useRef(new Animated.Value(selectedIndex > -1 ? selectedIndex : 0)).current;

  useEffect(() => {
    if (selectedIndex > -1) {
      Animated.spring(anim, {
        toValue: selectedIndex,
        useNativeDriver: Platform.OS !== 'web',
        bounciness: 0,
        speed: 24,
      }).start();
    }
  }, [selectedIndex, anim]);

  const padding = 4;
  const gap = 4;
  const itemWidth = containerWidth > 0 ? (containerWidth - (padding * 2) - (gap * (options.length - 1))) / options.length : 0;
  
  const translateX = anim.interpolate({
    inputRange: options.map((_, i) => i),
    outputRange: options.map((_, i) => i * (itemWidth + gap))
  });

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View 
        style={styles.segment}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        {containerWidth > 0 && (
          <Animated.View
            style={[
              styles.segmentActive,
              {
                position: 'absolute',
                top: padding,
                bottom: padding,
                left: padding,
                width: itemWidth,
                transform: [{ translateX }],
                borderRadius: 10,
              }
            ]}
          />
        )}
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              onPress={() => onChange(option.value)}
              style={styles.segmentItem}
            >
              {option.icon && <Icon name={option.icon} size={16} color={isActive ? '#000000' : C.ink40} />}
              <Text style={[styles.segmentText, isActive && styles.segmentTextActive, isActive && { color: '#000000' }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function PlayerInput({ value, onChangeText, team, number, visible, editable = true }) {
  if (!visible) return null;
  const empty = !value.trim();
  const initials = value.trim()
    ? value.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    : String(number);
  return (
    <View style={[styles.playerInputWrap, empty && styles.playerInputWrapEmpty]}>
      <View style={[styles.playerNumber, team === 1 && styles.playerNumberAway]}><Text style={styles.playerNumberText}>{initials}</Text></View>
      <View style={styles.playerInputCopy}>
        <TextInput
          accessibilityLabel={`Team ${team + 1} player ${number}`}
          accessibilityHint={editable ? "Enter the guest player's name" : 'Invite a registered player below to fill this spot'}
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          placeholder={editable ? 'Tap to enter guest name' : 'Invite a player below'}
          placeholderTextColor={C.ink40}
          autoCapitalize="words"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="next"
          maxLength={24}
          selectTextOnFocus
          style={styles.playerInput}
        />
        <View style={styles.playerStatus}><Icon name={empty ? (editable ? 'create-outline' : 'person-add-outline') : 'checkmark-circle'} size={10} color={empty ? C.teal : C.ink40} /><Text numberOfLines={1} adjustsFontSizeToFit style={[styles.playerStatusText, empty && styles.playerStatusTextEmpty]}>{empty ? `PLAYER ${number} · ${editable ? 'TYPE A GUEST NAME' : 'INVITE BELOW'}` : `PLAYER ${number} · READY`}</Text></View>
      </View>
    </View>
  );
}

function CourtPicker({ courts, visible, selected, onSelect, onClose }) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const availableHeight = windowHeight - insets.top - insets.bottom;
  const desiredHeight = 116 + (Math.max(courts.length, 1) * 80);
  const sheetHeight = Math.min(520, desiredHeight, Math.floor(availableHeight * 0.72));

  const renderCourt = ({ item: court }) => {
    const active = selected?.bookingId === court.bookingId;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        key={court.bookingId}
        onPress={() => onSelect(court)}
        style={({ pressed }) => [styles.courtOption, active && styles.courtOptionActive, pressed && styles.pressed]}
      >
        <View style={[styles.courtThumb, { backgroundColor: court.color }]}><View style={styles.courtThumbLine} /><Icon name="tennisball-outline" size={18} color={C.surface} /></View>
        <View style={styles.courtOptionCopy}><Text numberOfLines={1} style={styles.courtOptionName}>{court.name}</Text><Text numberOfLines={1} style={styles.courtOptionDetail}>{court.detail} · {court.distance}</Text><Text numberOfLines={1} style={styles.courtAvailable}>{court.next}</Text></View>
        <Icon name={active ? 'checkmark-circle' : 'chevron-forward'} color={active ? C.teal : C.ink40} />
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable {...webDialog('backdrop')} accessibilityLabel="Close court picker" style={[styles.modalBackdrop, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={onClose}>
        <Pressable {...webDialog('surface')} accessibilityRole="dialog" testID="court-picker-sheet" style={[styles.courtSheet, { height: sheetHeight }]} onPress={(event) => event.stopPropagation()}>
          <View {...webDialog('handle')} style={styles.sheetHandle} />
          <View style={styles.sheetHead}><View><Text style={styles.eyebrow}>CONFIRMED RESERVATIONS</Text><Text style={styles.sheetTitle}>Choose a booked court</Text></View><Pressable accessibilityLabel="Close" onPress={onClose} style={styles.sheetClose}><Icon name="close" /></Pressable></View>
          <Text style={styles.sheetLead}>Only courts covered by your confirmed bookings are available.</Text>
          <FlatList
            testID="court-picker-list"
            data={courts}
            renderItem={renderCourt}
            keyExtractor={(court) => court.bookingId}
            style={styles.courtList}
            contentContainerStyle={styles.courtListContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            initialNumToRender={6}
            windowSize={5}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function IncomingInvites({ invites, onRespond }) {
  if (!invites.length) return null;
  return (
    <View style={styles.invitesCard}>
      <View style={styles.invitesTitleRow}><View style={styles.inviteBell}><Icon name="notifications" size={17} color="#0E2321" /></View><View style={styles.flex}><Text style={styles.invitesEyebrow}>MATCH INVITATION</Text><Text style={styles.invitesTitle}>{invites.length === 1 ? 'A player invited you' : `${invites.length} players invited you`}</Text></View></View>
      {invites.map((invite) => {
        const senderName = invite.sender?.display_name || 'A player';
        const payload = invite.match_payload || {};
        const detail = `${payload.matchType === 'singles' ? 'Singles' : 'Doubles'} · ${payload.mode === 'ranked' ? 'Ranked' : 'Casual'}${payload.court?.name ? ` · ${payload.court.name}` : ''}`;
        return <View key={invite.id} style={styles.inviteRequest}><View style={styles.inviteRequestCopy}><Text style={styles.inviteSender}>{senderName}</Text><Text numberOfLines={2} style={styles.inviteDetail}>{detail}</Text></View><Pressable accessibilityLabel={`Decline invitation from ${senderName}`} onPress={() => onRespond(invite.id, false)} style={styles.declineInvite}><Icon name="close" size={17} color={C.brick} /></Pressable><Pressable accessibilityLabel={`Accept invitation from ${senderName}`} onPress={() => onRespond(invite.id, true)} style={styles.acceptInvite}><Icon name="checkmark" size={17} color="#0E2321" /><Text style={styles.acceptInviteText}>Join</Text></Pressable></View>;
      })}
    </View>
  );
}

function NearbyLobby({ players, invited, outgoingInvites, onToggle, onMessage, full, visible, loading, error, onVisibility }) {
  const [searchQuery, setSearchQuery] = useState('');
  const nearbyPlayers = players.filter((player) => !player.isTeammate);
  const visiblePlayers = players.filter((player) => player.isTeammate || player.isAcceptedInvite || visible);
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  // Nearby discovery is limited to 25 km by design; name search reaches
  // registered players in any city so they can still be invited.
  useEffect(() => {
    if (normalizedQuery.length < 2) {
      setSearchResults([]);
      setSearching(false);
      setSearchError('');
      return undefined;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchRegisteredPlayers(normalizedQuery)
        .then((rows) => { if (active) { setSearchResults(rows); setSearchError(''); } })
        .catch(() => { if (active) { setSearchResults([]); setSearchError('Player search is unavailable right now. Try again in a moment.'); } })
        .finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [normalizedQuery]);
  const localMatches = normalizedQuery
    ? visiblePlayers.filter((player) => `${player.name} ${(player.teamNames || []).join(' ')}`.toLocaleLowerCase().includes(normalizedQuery))
    : visiblePlayers;
  const filteredPlayers = normalizedQuery
    ? [...localMatches, ...searchResults.filter((result) => !localMatches.some((player) => player.id === result.id))]
    : visiblePlayers;
  return (
    <View style={styles.nearbyCard}>
      <View style={styles.nearbyHead}><View style={styles.flex}><Text style={styles.sectionLabel}>REGISTERED PLAYERS</Text><Text style={styles.nearbySubtitle}>{visible ? 'Online players within 25 km appear below. Search by name to find registered players in any city. Your exact position stays private.' : 'Your accepted teammates appear here. Search by name to find players in any city, or go visible to see who is online nearby.'}</Text></View><Pressable disabled={loading} accessibilityRole="switch" accessibilityState={{ checked: visible }} accessibilityLabel={visible ? 'Stop showing me to nearby players' : 'Show me to nearby players'} onPress={() => onVisibility(!visible)} style={[styles.visibilityButton, visible && styles.visibilityButtonOn, loading && styles.disabled]}><View style={[styles.visibilityDot, visible && styles.visibilityDotOn]} /><Text style={[styles.visibilityText, visible && styles.visibilityTextOn]}>{loading ? 'WAIT' : visible ? 'VISIBLE' : 'GO VISIBLE'}</Text></Pressable></View>
      {!!error && <View style={styles.nearbyError}><Icon name="alert-circle-outline" size={16} color={C.brick} /><Text style={styles.nearbyErrorText}>{error}</Text></View>}
      <View style={styles.playerSearch}><Icon name="search" size={17} color={C.ink40} /><TextInput accessibilityLabel="Search registered players" value={searchQuery} onChangeText={setSearchQuery} placeholder="Search players by name, any city" placeholderTextColor={C.ink40} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" style={styles.playerSearchInput} /></View>
      {(visible || visiblePlayers.length > 0) && <View style={styles.nearbyCountRow}><View style={styles.nearbyCount}><Icon name="people" size={11} color={C.teal} /><Text style={styles.nearbyCountText}>{filteredPlayers.length} {filteredPlayers.length === 1 ? 'PLAYER' : 'PLAYERS'} FOUND</Text></View></View>}
      {!normalizedQuery && visible && !nearbyPlayers.length && !players.some((player) => player.isTeammate) && !error && <View style={styles.nearbyEmpty}><Icon name="navigate-outline" size={22} color={C.ink40} /><Text style={styles.nearbyEmptyTitle}>No players available yet</Text><Text style={styles.nearbyEmptyText}>Use a different account on the second device, choose Registered, and turn on visibility.</Text></View>}
      {!normalizedQuery && !visible && !visiblePlayers.length && !error && <View style={styles.nearbyEmpty}><Icon name="people-outline" size={22} color={C.ink40} /><Text style={styles.nearbyEmptyTitle}>No teammates found</Text><Text style={styles.nearbyEmptyText}>Accepted team members appear here automatically. Go visible to find other nearby players.</Text></View>}
      {!!searchError && <View style={styles.nearbyError}><Icon name="alert-circle-outline" size={16} color={C.brick} /><Text style={styles.nearbyErrorText}>{searchError}</Text></View>}
      {!!normalizedQuery && searching && !filteredPlayers.length && <View style={styles.nearbyEmpty}><ActivityIndicator color={C.teal} /><Text style={styles.nearbyEmptyText}>Searching all Peakle players…</Text></View>}
      {!!normalizedQuery && !searching && !filteredPlayers.length && <View style={styles.nearbyEmpty}><Icon name="search-outline" size={22} color={C.ink40} /><Text style={styles.nearbyEmptyTitle}>No matching player</Text><Text style={styles.nearbyEmptyText}>{normalizedQuery.length < 2 ? 'Type at least 2 letters to search players in every city.' : 'No registered player matches that name. Check the spelling and try again.'}</Text></View>}
      {filteredPlayers.map((player, index) => {
        const added = invited.includes(player.id);
        const latestInvite = outgoingInvites.find((invite) => invite.recipient_id === player.id && invite.match_payload?.setupId);
        const pending = latestInvite?.status === 'pending';
        const accepted = latestInvite?.status === 'accepted';
        const disabled = !accepted && full && !added && !pending;
        return (
          <View key={player.id} style={[styles.nearbyPlayer, index > 0 && styles.nearbyPlayerBorder]}>
            <ResilientImage
              uri={normalizeProfilePhoto(player.avatar || player.avatar_url)}
              accessibilityLabel={`${player.name} profile photo`}
              fallback={<Text style={styles.nearbyAvatarText}>{player.initials || initials(player.name)}</Text>}
              fallbackColor={player.color || C.teal}
              showLoadingIndicator={false}
              style={styles.nearbyAvatar}
            />
            <View style={styles.nearbyCopy}><Text style={styles.nearbyName}>{player.name}</Text><Text style={styles.nearbyMeta}>{accepted ? 'Accepted · in your lineup' : player.isTeammate ? `${player.teamNames?.join(', ') || 'Your team'} · teammate${player.distance ? ` · ${player.distance} away` : ''}` : player.isSearchResult ? `★ ${player.rating}${player.area ? ` · ${player.area}` : ''} · registered player` : `★ ${player.rating} · ${player.distance} away${player.distanceAccuracy ? ` (±${player.distanceAccuracy})` : ''} · online`}</Text></View>
            {PRIVATE_MESSAGES_ENABLED ? <Pressable accessibilityLabel={`Message ${player.name} privately`} onPress={() => onMessage(player)} style={({ pressed }) => [styles.nearbyMessageButton, pressed && styles.pressed]}><Icon name="chatbubble-outline" size={16} color={C.teal} /></Pressable> : null}
            <Pressable disabled={disabled} accessibilityLabel={`${accepted ? 'Remove' : pending ? 'Cancel invitation for' : disabled ? 'Lineup full for' : 'Invite'} ${player.name}`} accessibilityHint={accepted ? 'Removes this player from your match after confirmation' : undefined} hitSlop={accepted ? 6 : 0} onPress={() => onToggle(player, latestInvite)} style={({ pressed }) => [styles.inviteButton, pending && styles.inviteButtonAdded, accepted && styles.inviteButtonRemove, disabled && styles.inviteButtonDisabled, pressed && !disabled && styles.pressed]}>
              <Icon name={accepted ? 'person-remove-outline' : pending ? 'time-outline' : disabled ? 'remove' : 'add'} size={accepted ? 18 : 15} color={accepted ? C.brick : pending ? C.teal : disabled ? C.ink40 : '#0E2321'} />
              {!accepted && <Text style={[styles.inviteButtonText, pending && styles.inviteButtonTextAdded, disabled && styles.inviteButtonTextDisabled]}>{pending ? 'Pending' : disabled ? 'Full' : 'Invite'}</Text>}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function PlayChoiceScreen({ onFindPlay, onSetupMatch, unfinishedMatch, onResume }) {
  return (
    <ScrollView contentContainerStyle={[styles.content, styles.playChoiceContent]} showsVerticalScrollIndicator={false}>
      <Header
        eyebrow="YOUR GAME"
        title="Play"
        action={<><View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.playHeaderBall}><Image source={BALL_IMAGE} style={styles.playHeaderBallImage} resizeMode="contain" /></View><HeaderAvatar size={36} style={styles.playHeaderAvatar} /></>}
      />

      <View style={styles.choiceIntro}>
        <Text style={styles.choiceIntroTitle}>How do you want to play?</Text>
        <Text style={styles.choiceIntroText}>Find people nearby or set up a match you already have.</Text>
      </View>

      <View {...webLayout('two-columns')} accessibilityRole="group" accessibilityLabel="Ways to play" style={styles.playChoices}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Find a play"
          accessibilityHint="Browse nearby play requests or post that you need a partner, opponent, or substitute"
          onPress={onFindPlay}
          style={({ pressed }) => [styles.playChoiceCard, styles.playChoiceCardPrimary, pressed && styles.pressed]}
        >
          <View style={styles.playChoiceTop}>
            <View style={styles.playChoiceIconPrimary}><Icon name="search" size={25} color="#0E2321" /></View>
            <View style={styles.playChoiceRecommended}><Text style={[styles.playChoiceRecommendedText, { color: '#0E2321' }]}>BEST IF YOU NEED PLAYERS</Text></View>
          </View>
          <Text style={styles.playChoiceEyebrowPrimary}>PARTNER · OPPONENT · SUBSTITUTE</Text>
          <Text style={styles.playChoiceTitlePrimary}>Find a play</Text>
          <Text style={styles.playChoiceTextPrimary}>See who is looking for a game nearby, or create a simple play request of your own.</Text>
          <View style={styles.playChoiceActionPrimary}>
            <Text style={[styles.playChoiceActionPrimaryText, { color: '#0E2321' }]}>Find players</Text>
            <Icon name="arrow-forward" size={18} color="#0E2321" />
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Set up a match"
          accessibilityHint="Add players, choose a court, and keep score for a game you already have"
          onPress={onSetupMatch}
          style={({ pressed }) => [styles.playChoiceCard, styles.playChoiceCardSecondary, pressed && styles.pressed]}
        >
          <View style={styles.playChoiceTop}>
            <View style={styles.playChoiceIconSecondary}><Image source={BALL_IMAGE} style={{ width: 25, height: 25, tintColor: C.teal }} resizeMode="contain" /></View>
            <View style={styles.playChoiceArrow}><Icon name="arrow-forward" size={19} color={C.teal} /></View>
          </View>
          <Text style={styles.playChoiceEyebrowSecondary}>ALREADY HAVE A GAME?</Text>
          <Text style={styles.playChoiceTitleSecondary}>Set up a match</Text>
          <Text style={styles.playChoiceTextSecondary}>Add the players, select a court, choose the format, and use Peakle to keep score.</Text>
          <View style={styles.playChoiceActionSecondary}>
            <Text style={styles.playChoiceActionSecondaryText}>Start match setup</Text>
            <Icon name="chevron-forward" size={16} color={C.teal} />
          </View>
        </Pressable>
      </View>

      {unfinishedMatch ? (
        <View style={styles.choiceResumeCard}>
          <View style={styles.resumeIcon}><Icon name="bookmark" size={20} color="#0E2321" /></View>
          <View style={styles.flex}>
            <Text style={styles.resumeEyebrow}>{unfinishedMatch.resultPendingSave ? 'RESULT NOT SYNCED' : 'SAVED MATCH'}</Text>
            <Text style={styles.resumeTitle}>{teamName(unfinishedMatch.players[0])} · {unfinishedMatch.scores[0]}–{unfinishedMatch.scores[1]} · {teamName(unfinishedMatch.players[1])}</Text>
            <Text style={styles.resumeMeta}>{unfinishedMatch.resultPendingSave ? 'Retry saving your finished result.' : 'Continue exactly where you stopped.'}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={unfinishedMatch.resultPendingSave ? 'Retry saving result' : 'Resume saved match'} onPress={onResume} style={({ pressed }) => [styles.resumeButton, pressed && styles.pressed]}>
            <Text style={styles.resumeButtonText}>{unfinishedMatch.resultPendingSave ? 'Retry' : 'Resume'}</Text><Icon name="play" size={13} color={C.surface} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.choiceTip}>
        <Icon name="information-circle-outline" size={18} color={C.teal} />
        <Text style={styles.choiceTipText}><Text style={styles.choiceTipStrong}>Not sure?</Text> Choose “Find a play” if you still need someone to play with.</Text>
      </View>
    </ScrollView>
  );
}

function SetupScreen({ courts, courtsLoading, courtsError, onRefreshCourts, onBookCourt, nearbyPlayers, nearbyPresence, currentUserName, currentUserId, currentUserAvatar, onStart, focusChallenge, onBackToChoices, showBackToChoices = true, onFindPlay, onMessagePlayer, onLeaveJoined, unfinishedMatch, onResume, openNearbyPlayersToken }) {
  const [followingPlayers, setFollowingPlayers] = useState([]);
  const [teammates, setTeammates] = useState([]);
  const [rosterError, setRosterError] = useState('');
  useEffect(() => {
    let active = true;
    setRosterError('');
    Promise.allSettled([listFollowingPlayers(), listTeams()]).then(([followingResult, teamsResult]) => {
      if (!active) return;
      if (followingResult.status === 'fulfilled') setFollowingPlayers(followingResult.value);
      if (teamsResult.status === 'fulfilled') {
        const teammateMap = new Map();
        teamsResult.value.filter((team) => team.role).forEach((team) => {
          team.roster.filter((member) => member.id !== currentUserId).forEach((member) => {
            const existing = teammateMap.get(member.id);
            teammateMap.set(member.id, {
              ...member,
              isTeammate: true,
              teamNames: [...new Set([...(existing?.teamNames || []), team.name])],
              color: member.color || '#1C6B66',
            });
          });
        });
        setTeammates([...teammateMap.values()]);
      } else {
        setRosterError('Your team roster could not be loaded. Refresh Play and try again.');
      }
    });
    return () => { active = false; };
  }, [currentUserId]);
  const [matchType, setMatchType] = useState('doubles');
  const [mode, setMode] = useState('casual');
  const [access, setAccess] = useState('public');
  const [target, setTarget] = useState(11);
  const [bestOf, setBestOf] = useState(3);
  const [winByTwo, setWinByTwo] = useState(true);
  const [players, setPlayers] = useState(() => emptyLineup(currentUserName));
  const [invited, setInvited] = useState([]);
  const [court, setCourt] = useState(null);
  const [bookingClock, setBookingClock] = useState(Date.now());
  const [scorerSource, setScorerSource] = useState('host');
  const [scorer, setScorer] = useState(currentUserName || 'You');
  const [scorerId, setScorerId] = useState(currentUserId || null);
  const [scoringMethod, setScoringMethod] = useState('manual');
  const [showCourts, setShowCourts] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [setupStage, setSetupStage] = useState(() => openNearbyPlayersToken ? 1 : 0);
  const setupId = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`).current;
  const appliedInviteIds = useRef(new Set());
  const appliedInvitePlayers = useRef(new Map());
  const scrollRef = useRef(null);
  const nearbySectionY = useRef(0);
  const pendingNearbyScroll = useRef(Boolean(openNearbyPlayersToken));
  const handledNearbyToken = useRef(null);
  const requiredPlayers = matchType === 'doubles' ? 2 : 1;

  useEffect(() => {
    if (scorerSource !== 'host') return;
    setScorer(currentUserName || 'You');
    setScorerId(currentUserId || null);
  }, [currentUserId, currentUserName, scorerSource]);

  const scrollToNearbyPlayers = () => {
    if (!nearbySectionY.current) return;
    pendingNearbyScroll.current = false;
    scrollRef.current?.scrollTo({ y: Math.max(0, nearbySectionY.current - 16), animated: true });
  };

  useEffect(() => {
    if (!openNearbyPlayersToken || handledNearbyToken.current === openNearbyPlayersToken) return undefined;
    handledNearbyToken.current = openNearbyPlayersToken;
    pendingNearbyScroll.current = true;
    setAccess('public');
    setSetupStage(1);
    setPlayers(emptyLineup(currentUserName));
    setInvited([]);
    const timer = setTimeout(scrollToNearbyPlayers, 250);
    return () => clearTimeout(timer);
  }, [currentUserName, openNearbyPlayersToken]);

  const updatePlayer = (team, index, value) => {
    setPlayers((current) => current.map((group, groupIndex) => (
      groupIndex === team ? group.map((name, nameIndex) => nameIndex === index ? value : name) : group
    )));
  };

  const trimmedPlayers = players.map((team) => team.slice(0, requiredPlayers).map((name) => name.trim()));
  const onCourtScorers = trimmedPlayers.flat().filter(Boolean);
  const normalizedLineup = onCourtScorers.map(normalizedPlayerName);
  const hasDuplicatePlayers = new Set(normalizedLineup).size !== normalizedLineup.length;
  const missingPlayerCount = (requiredPlayers * 2) - onCourtScorers.length;
  const joinedInvite = nearbyPresence.joinedInvite;
  const joinedSender = joinedInvite?.sender;
  const acceptedProfiles = nearbyPresence.outgoingInvites.filter((invite) => invite.status === 'accepted' && invite.match_payload?.setupId === setupId).map((invite) => invite.recipient).filter(Boolean);
  const registeredPlayers = [{ id: currentUserId, name: currentUserName, avatar: currentUserAvatar }, ...acceptedProfiles.map((profile) => ({ id: profile.id, name: profile.display_name, avatar: profile.avatar_url }))];
  const registeredScorerCandidates = registeredPlayers.filter((profile) => profile.id && profile.id !== currentUserId && onCourtScorers.some((name) => normalizedPlayerName(name) === normalizedPlayerName(profile.name)));
  const scorerIsValid = scorerSource === 'host'
    ? Boolean(currentUserId && scorerId === currentUserId)
    : registeredScorerCandidates.some((profile) => profile.id === scorerId);
  const bookingActive = Boolean(joinedInvite) || isCourtBookingActive(court, bookingClock);
  const canStart = !joinedInvite && !courtsLoading && !courtsError && Boolean(court) && bookingActive && scorerIsValid && missingPlayerCount === 0 && !hasDuplicatePlayers;
  const acceptedInvitePlayers = acceptedProfiles.map((profile) => ({
    id: profile.id,
    name: profile.display_name,
    avatar: profile.avatar_url,
    initials: initials(profile.display_name),
    isAcceptedInvite: true,
  }));
  const invitePlayers = [...acceptedInvitePlayers, ...teammates, ...nearbyPlayers].reduce((rows, player) => {
    const existingIndex = rows.findIndex((candidate) => candidate.id === player.id);
    if (existingIndex < 0) return [...rows, player];
    const existing = rows[existingIndex];
    const next = [...rows];
    next[existingIndex] = {
      ...existing,
      ...player,
      isTeammate: existing.isTeammate || player.isTeammate,
      teamNames: existing.teamNames || player.teamNames,
    };
    return next;
  }, []);
  const lineupProfiles = [...followingPlayers, ...teammates, ...nearbyPlayers, ...(joinedSender ? [{ id: joinedSender.id, name: joinedSender.display_name, avatar: joinedSender.avatar_url }] : [])]
    .filter((profile, index, rows) => profile?.id && rows.findIndex((candidate) => candidate?.id === profile.id) === index);
  const matchConfiguration = { setupId, matchType, mode, access, target, bestOf, winByTwo, players: trimmedPlayers, registeredPlayers, court, scorer, scorerId, scorerSource, scoringMethod, focusChallenge };
  const setupMessage = hasDuplicatePlayers
    ? 'Each player needs a unique name.'
    : missingPlayerCount > 0
      ? `Add ${missingPlayerCount} more ${missingPlayerCount === 1 ? 'player' : 'players'} to complete the lineup.`
      : courtsError
        ? 'Your court booking could not be verified. Try again before continuing.'
      : !court
        ? 'Choose where you are playing.'
        : !bookingActive
          ? new Date(court.bookingStartsAt).getTime() > bookingClock
            ? `Your booking has not started yet. Court time begins ${court.next.replace(/^Booked /, '')}.`
            : 'This booking is no longer active. Choose another confirmed reservation.'
        : !scorerIsValid
          ? 'Choose who will keep score.'
          : 'Everything is ready. Choose the first server.';
  const setupStages = [
    { label: 'Game', icon: 'tennisball-outline' },
    { label: 'Players', icon: 'people-outline' },
    { label: 'Court', icon: 'location-outline' },
    { label: 'Review', icon: 'checkmark-circle-outline' },
  ];
  const stageMessage = [
    'Choose the kind of match you want to play.',
    hasDuplicatePlayers ? 'Each player needs a unique name.' : missingPlayerCount > 0 ? `Add ${missingPlayerCount} more ${missingPlayerCount === 1 ? 'player' : 'players'}.` : 'Your lineup is complete.',
    courtsLoading ? 'Checking your confirmed court bookings.' : courtsError ? 'Your booking could not be verified. Try again.' : court ? `${court.name} is selected. Continue when ready.` : 'Choose a confirmed court booking.',
    setupMessage,
  ][setupStage];
  const canContinueStage = setupStage === 0
    || (setupStage === 1 && missingPlayerCount === 0 && !hasDuplicatePlayers)
    || (setupStage === 2 && !courtsLoading && !courtsError && Boolean(court));

  const moveToStage = (nextStage) => {
    setSetupStage(nextStage);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  };

  useEffect(() => {
    if (!court || joinedInvite) return undefined;
    const timer = setInterval(() => setBookingClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [court, joinedInvite]);

  useEffect(() => {
    if (!court || joinedInvite) return;
    const bookingStillAvailable = courts.some((option) => option.bookingId === court.bookingId);
    if (!bookingStillAvailable) setCourt(null);
  }, [court, courts, joinedInvite]);

  useEffect(() => {
    if (!joinedInvite?.id || !joinedSender?.display_name) return;
    const payload = joinedInvite.match_payload || {};
    const joinedMatchType = payload.matchType === 'singles' ? 'singles' : 'doubles';
    const senderName = joinedSender.display_name;
    setMatchType(joinedMatchType);
    setMode(payload.mode === 'ranked' ? 'ranked' : 'casual');
    setAccess('public');
    setTarget(Number(payload.target) || 11);
    setBestOf(Number(payload.bestOf) || 3);
    setWinByTwo(payload.winByTwo !== false);
    setSetupStage(3);
    setPlayers(joinedMatchType === 'singles'
      ? [[senderName], [currentUserName || 'You']]
      : [[senderName, currentUserName || 'You'], ['', '']]);
    setScorerSource('host');
    setScorer(senderName);
    setScorerId(joinedSender.id);
    if (payload.court) setCourt(payload.court);
  }, [currentUserName, joinedInvite?.id, joinedSender?.display_name]);

  useEffect(() => {
    if (scorerSource !== 'player' || registeredScorerCandidates.some((profile) => profile.id === scorerId)) return;
    setScorerSource('host');
    setScorer(currentUserName || 'You');
    setScorerId(currentUserId || null);
  }, [currentUserId, currentUserName, registeredScorerCandidates, scorerId, scorerSource]);

  useEffect(() => {
    const invite = nearbyPresence.outgoingInvites.find((item) => item.status === 'accepted' && item.match_payload?.setupId === setupId && !appliedInviteIds.current.has(item.id) && item.recipient?.display_name);
    if (!invite) return;
    const slots = matchType === 'doubles' ? [[0, 0], [0, 1], [1, 0], [1, 1]] : [[0, 0], [1, 0]];
    const openSlot = slots.find(([team, index]) => !players[team][index].trim());
    if (!openSlot) return;
    appliedInviteIds.current.add(invite.id);
    appliedInvitePlayers.current.set(invite.id, { id: invite.recipient.id, name: invite.recipient.display_name });
    setInvited((ids) => ids.includes(invite.recipient.id) ? ids : [...ids, invite.recipient.id]);
    setPlayers((current) => current.map((team, teamIndex) => team.map((name, nameIndex) => teamIndex === openSlot[0] && nameIndex === openSlot[1] ? invite.recipient.display_name : name)));
  }, [matchType, nearbyPresence.outgoingInvites, players, setupId]);

  useEffect(() => {
    const departed = nearbyPresence.outgoingInvites
      .filter((invite) => appliedInvitePlayers.current.has(invite.id) && ['cancelled', 'declined', 'expired', 'removed'].includes(invite.status))
      .map((invite) => appliedInvitePlayers.current.get(invite.id));
    if (!departed.length) return;
    const departedIds = new Set(departed.map((player) => player.id));
    const departedNames = new Set(departed.map((player) => normalizedPlayerName(player.name)));
    nearbyPresence.outgoingInvites.forEach((invite) => {
      if (appliedInvitePlayers.current.has(invite.id) && ['cancelled', 'declined', 'expired', 'removed'].includes(invite.status)) {
        appliedInvitePlayers.current.delete(invite.id);
        appliedInviteIds.current.delete(invite.id);
      }
    });
    setInvited((ids) => ids.filter((id) => !departedIds.has(id)));
    setPlayers((current) => current.map((team) => team.map((name) => departedNames.has(normalizedPlayerName(name)) ? '' : name)));
  }, [nearbyPresence.outgoingInvites]);

  const changeScorerSource = (source) => {
    setScorerSource(source);
    if (source === 'host') {
      setScorer(currentUserName || 'You');
      setScorerId(currentUserId || null);
      return;
    }
    setScorer(registeredScorerCandidates[0]?.name || '');
    setScorerId(registeredScorerCandidates[0]?.id || null);
  };

  const changeAccess = (value) => {
    if (value === access) return;
    if (value === 'private') {
      nearbyPresence.outgoingInvites
        .filter((invite) => invite.status === 'pending' && invite.match_payload?.setupId === setupId)
        .forEach((invite) => nearbyPresence.cancel(invite.id));
    }
    setAccess(value);
    setInvited([]);
    setPlayers(emptyLineup(currentUserName));
    setScorerSource('host');
    setScorer(currentUserName || 'You');
    setScorerId(currentUserId || null);
  };

  const toggleNearbyPlayer = async (player, existingInvite) => {
    if (existingInvite?.status === 'pending') {
      await nearbyPresence.cancel(existingInvite.id);
      return;
    }
    if (existingInvite?.status === 'accepted') {
      Alert.alert(
        `Remove ${player.name}?`,
        'They’ll be removed from your lineup immediately. You can invite them again if needed.',
        [
          { text: 'Keep player', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              const removed = await nearbyPresence.remove(existingInvite.id);
              if (!removed) Alert.alert('Couldn’t remove player', 'Check your connection and try again.');
            },
          },
        ],
      );
      return;
    }
    if (invited.includes(player.id)) return;
    await nearbyPresence.invite(player.id, {
      setupId,
      senderName: currentUserName,
      matchType,
      mode,
      target,
      bestOf,
      winByTwo,
      court: court ? { id: court.id, name: court.name, detail: court.detail } : null,
    }).catch(() => {});
  };

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Header
        eyebrow={joinedInvite ? 'MATCH JOINED' : 'MATCH DAY'}
        title={joinedInvite ? 'You’re in the match' : 'Set up a match'}
        onBack={showBackToChoices && !joinedInvite ? onBackToChoices : null}
        action={joinedInvite ? <View style={styles.joinedChip}><Icon name="checkmark-circle" size={13} color="#0E2321" /><Text style={styles.joinedChipText}>JOINED</Text></View> : <View style={styles.liveChip}><View style={styles.liveDot} /><Text style={styles.liveChipText}>COURT-SIDE</Text></View>}
      />

      {joinedInvite ? <View accessible accessibilityLabel={`Joined ${matchType} ${mode} match hosted by ${joinedSender?.display_name || 'the host'}, at ${court?.name || 'a court the host will confirm'}. Your place is confirmed.`} style={styles.joinedMatchCard}>
        <View style={styles.joinedMatchHead}>
          <ResilientImage
            uri={normalizeProfilePhoto(joinedSender?.avatar_url)}
            accessibilityLabel={`${joinedSender?.display_name || 'Host'} profile photo`}
            fallback={<Text style={styles.joinedHostInitials}>{initials(joinedSender?.display_name || 'Host')}</Text>}
            fallbackColor={C.teal}
            showLoadingIndicator={false}
            style={styles.joinedHostAvatar}
          />
          <View style={styles.flex}>
            <Text style={styles.joinedMatchEyebrow}>HOSTED BY</Text>
            <Text numberOfLines={1} style={styles.joinedMatchHost}>{joinedSender?.display_name || 'Match host'}</Text>
            <Text style={styles.joinedMatchLead}>Your place is confirmed. The host is preparing the match.</Text>
          </View>
          <View style={styles.joinedConfirmedBadge}><Icon name="checkmark" size={16} color="#0E2321" /></View>
        </View>
        <View style={styles.joinedMatchDetails}>
          <View style={styles.joinedMatchDetail}>
            <View style={styles.joinedDetailIcon}><Icon name={matchType === 'singles' ? 'person-outline' : 'people-outline'} size={17} color={C.teal} /></View>
            <View style={styles.flex}><Text style={styles.joinedDetailLabel}>MATCH</Text><Text numberOfLines={1} style={styles.joinedDetailValue}>{matchType === 'singles' ? 'Singles' : 'Doubles'} · {mode === 'ranked' ? 'Ranked' : 'Casual'}</Text></View>
          </View>
          <View style={styles.joinedDetailDivider} />
          <View style={styles.joinedMatchDetail}>
            <View style={styles.joinedDetailIcon}><Icon name="location-outline" size={17} color={C.teal} /></View>
            <View style={styles.flex}><Text style={styles.joinedDetailLabel}>COURT</Text><Text numberOfLines={1} style={styles.joinedDetailValue}>{court?.name || 'Host will confirm'}</Text></View>
          </View>
        </View>
        <View style={styles.joinedRulesRow}><Icon name="options-outline" size={16} color={C.ink40} /><Text style={styles.joinedRulesText}>{target} points · {bestOf === 1 ? '1 game' : 'Best of 3'}{winByTwo ? ' · Win by 2' : ''}</Text></View>
      </View> : null}

      {setupStage === 0 && !joinedInvite && <>
      {unfinishedMatch && <View style={styles.resumeCard}><View style={styles.resultIcon}><Icon name="checkmark" size={32} color="#0E2321" /></View><View style={styles.flex}><Text style={styles.resumeEyebrow}>UNFINISHED MATCH SAVED</Text><Text style={styles.resumeTitle}>{teamName(unfinishedMatch.players[0])} · {unfinishedMatch.scores[0]}–{unfinishedMatch.scores[1]} · {teamName(unfinishedMatch.players[1])}</Text><Text style={styles.resumeMeta}>Continue from the saved score when you have court time again.</Text></View><Pressable accessibilityRole="button" onPress={onResume} style={({ pressed }) => [styles.resumeButton, pressed && styles.pressed]}><Text style={styles.resumeButtonText}>Resume</Text><Icon name="play" size={13} color={C.surface} /></Pressable></View>}
      <View style={styles.introCard}>
        <View style={styles.introIcon}><Image source={BALL_IMAGE} style={{ width: 26, height: 26, tintColor: '#0E2321' }} resizeMode="contain" /></View>
        <View style={styles.introCopy}><Text style={[styles.introTitle, { color: '#0E2321' }]}>Start a match in minutes.</Text><Text style={[styles.bodySmall, { color: '#3C4A45' }]}>Pick a format, add the players, and confirm the court. We’ll handle the scoring defaults.</Text></View>
      </View>
      </>}
      {focusChallenge && !joinedInvite && (
        <View style={styles.focusSetupCard}>
          <View style={styles.focusTrackerIcon}><Icon name="locate" size={20} color="#0E2321" /></View>
          <View style={styles.focusSetupCopy}><Text style={styles.focusSetupEyebrow}>FOCUS CHALLENGE ACTIVE</Text><Text style={styles.focusSetupTitle}>{focusChallenge.instruction}</Text><Text style={styles.focusSetupMeta}>You’ll track each return during the live match.</Text></View>
          <Icon name="checkmark-circle" size={20} color={C.teal} />
        </View>
      )}

      {!joinedInvite && <View style={styles.setupGuide}>
        <View style={styles.setupGuideHead}>
          <View><Text style={styles.setupGuideEyebrow}>STEP {setupStage + 1} OF {setupStages.length}</Text><Text style={styles.setupGuideTitle}>{setupStages[setupStage].label} details</Text></View>
          <View accessibilityLabel={`Setup progress ${Math.round(((setupStage + 1) / setupStages.length) * 100)} percent`} style={[styles.setupProgressBadge, setupStage === setupStages.length - 1 && canStart && styles.setupProgressBadgeReady]}><Text maxFontSizeMultiplier={1.2} style={[styles.setupProgressText, { color: '#0E2321' }]}>{Math.round(((setupStage + 1) / setupStages.length) * 100)}%</Text></View>
        </View>
        <View style={styles.setupSteps}>
          {setupStages.map(({ icon, label }, index) => {
            const done = index < setupStage;
            const active = index === setupStage;
            return <React.Fragment key={label}><View style={styles.setupStep}><View style={[styles.setupStepIcon, done && styles.setupStepIconDone, active && styles.setupStepIconActive]}>{done ? <Icon name="checkmark" size={15} color="#0E2321" /> : icon === 'tennisball-outline' ? <Image source={BALL_IMAGE} style={{ width: 17, height: 17, tintColor: active ? '#0E2321' : C.ink40 }} resizeMode="contain" /> : <Icon name={icon} size={15} color={active ? '#0E2321' : C.ink40} />}</View><Text style={[styles.setupStepText, done && styles.setupStepTextDone, active && styles.setupStepTextActive]}>{label}</Text></View>{index < setupStages.length - 1 && <View style={[styles.setupStepLine, index < setupStage && styles.setupStepLineDone]} />}</React.Fragment>;
          })}
        </View>
        <Text accessibilityLiveRegion="polite" style={[styles.setupGuideMessage, setupStage === 3 && canStart && styles.setupGuideMessageReady]}>{stageMessage}</Text>
      </View>}

      {setupStage === 0 && !joinedInvite && <View style={styles.formPart}>
      <SegmentedControl label="FORMAT" value={matchType} onChange={setMatchType} options={[
        { value: 'singles', label: 'Singles', icon: 'person-outline' },
        { value: 'doubles', label: 'Doubles', icon: 'people-outline' },
      ]} />
      <SegmentedControl label="PLAY TYPE" value={mode} onChange={setMode} options={[
        { value: 'casual', label: 'Casual', icon: 'happy-outline' },
        { value: 'ranked', label: 'Ranked', icon: 'podium-outline' },
      ]} />
      {mode === 'ranked' && <View style={styles.rankedNote}><Icon name="shield-checkmark-outline" color={C.teal} /><Text style={styles.rankedNoteText}>Ranked result will be included in your local rating history.</Text></View>}
      </View>}

      {setupStage === 1 && !joinedInvite && <View style={styles.formPart}>
      <SegmentedControl label="HOW TO ADD PLAYERS" value={access} onChange={changeAccess} options={[
        { value: 'public', label: 'Registered', icon: 'person-add-outline' },
        { value: 'private', label: 'Guest names', icon: 'create-outline' },
      ]} />
      <View style={styles.playerSourceHelp}>
        <View style={styles.playerSourceHelpIcon}><Icon name={access === 'private' ? 'phone-portrait-outline' : 'notifications-outline'} size={19} color={C.teal} /></View>
        <View style={styles.flex}>
          <Text style={styles.playerSourceHelpTitle}>{access === 'private' ? 'Only for players without an account' : 'Invite players through Peakle'}</Text>
          <Text style={styles.playerSourceHelpText}>{access === 'private' ? 'Type a guest name only when someone is sharing this phone and does not use Peakle.' : 'Your accepted teammates are listed below automatically. Search, tap Invite, and their account name fills a spot after they accept.'}</Text>
        </View>
      </View>
      <View style={styles.fieldGroup}>
        <View style={styles.sectionHeadingRow}><View><Text style={styles.sectionLabel}>{access === 'private' ? 'ENTER GUEST NAMES' : 'MATCH LINEUP'}</Text><Text style={styles.sectionHelper}>{matchType === 'singles' ? 'One player on each side' : 'Two players on each side'}</Text></View><View style={[styles.rosterCount, missingPlayerCount === 0 && !hasDuplicatePlayers && styles.rosterCountReady]}><Text style={[styles.rosterCountText, missingPlayerCount === 0 && !hasDuplicatePlayers && { color: '#0E2321' }]}>{onCourtScorers.length}/{requiredPlayers * 2}</Text></View></View>
        <View style={styles.teamsGrid}>
          {[0, 1].map((team) => (
            <View key={team} style={styles.teamSetup}>
              <View style={styles.teamSetupHead}><View style={[styles.teamBar, team === 1 && styles.teamBarAway]} /><Text style={styles.teamLabel}>{team === 0 ? 'YOUR SIDE' : 'OPPONENTS'}</Text></View>
              <PlayerInput team={team} number={1} value={players[team][0]} onChangeText={(value) => updatePlayer(team, 0, value)} visible editable={access === 'private'} />
              <PlayerInput team={team} number={2} value={players[team][1]} onChangeText={(value) => updatePlayer(team, 1, value)} visible={matchType === 'doubles'} editable={access === 'private'} />
            </View>
          ))}
        </View>
        {hasDuplicatePlayers && <View style={styles.inlineError}><Icon name="alert-circle" size={15} color={C.brick} /><Text style={styles.inlineErrorText}>Use a different name for each player.</Text></View>}
        <Pressable accessibilityRole="button" accessibilityLabel="Swap both sides" onPress={() => setPlayers(([first, second]) => [second, first])} style={({ pressed }) => [styles.swapSidesButton, pressed && styles.pressed]}><Icon name="swap-vertical" size={16} color={C.teal} /><Text style={styles.swapSidesText}>Swap sides</Text></Pressable>
      </View>

      {access === 'public' && <View onLayout={(event) => { nearbySectionY.current = event.nativeEvent.layout.y; if (pendingNearbyScroll.current) requestAnimationFrame(scrollToNearbyPlayers); }}><NearbyLobby players={invitePlayers} invited={invited} outgoingInvites={nearbyPresence.outgoingInvites.filter((invite) => invite.match_payload?.setupId === setupId)} onToggle={toggleNearbyPlayer} onMessage={onMessagePlayer} full={trimmedPlayers.flat().every(Boolean)} visible={nearbyPresence.visible} loading={nearbyPresence.loading} error={nearbyPresence.error || rosterError} onVisibility={nearbyPresence.setDiscoveryVisible} /></View>}
      </View>}

      {setupStage === 2 && !joinedInvite && <View style={styles.formPart}>
      <View style={styles.fieldGroup}>
        <Text style={styles.sectionLabel}>BOOKED COURT</Text>
        {courtsLoading && !courts.length ? <View style={styles.bookingGateCard}><ActivityIndicator color={C.teal} /><View style={styles.flex}><Text style={styles.bookingGateTitle}>Checking your reservations</Text><Text style={styles.bookingGateText}>Peakle is confirming which courts you can use.</Text></View></View> : courtsError ?<View style={styles.bookingGateCard}><View style={styles.bookingGateIcon}><Icon name="cloud-offline-outline" color={C.brick} /></View><View style={styles.flex}><Text style={styles.bookingGateTitle}>Booking check unavailable</Text><Text style={styles.bookingGateText}>{courtsError}</Text><Pressable accessibilityRole="button" onPress={onRefreshCourts} style={styles.bookingGateLink}><Text style={styles.bookingGateLinkText}>Try again</Text></Pressable></View></View> : !courts.length ? <View style={styles.bookingGateCard}><View style={styles.bookingGateIcon}><Icon name="ticket-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.bookingGateTitle}>Book a court first</Text><Text style={styles.bookingGateText}>A confirmed court reservation is required before you can start scoring a match.</Text><Pressable accessibilityRole="button" onPress={onBookCourt} style={styles.bookCourtButton}><Icon name="calendar-outline" size={16} color="#0E2321" /><Text style={styles.bookCourtButtonText}>Find and book a court</Text></Pressable></View></View> : <>
          <Pressable accessibilityLabel="Choose a booked court" onPress={() => setShowCourts(true)} style={({ pressed }) => [styles.courtSelect, court && styles.courtSelectChosen, pressed && styles.pressed]}>
            <View style={[styles.courtSelectIcon, court && { backgroundColor: court.color }]}><Icon name={court ? 'tennisball-outline' : 'ticket-outline'} color={court ? C.surface : C.teal} /></View>
            <View style={styles.courtSelectCopy}><Text style={styles.courtSelectName}>{court ? court.name : 'Select from your bookings'}</Text><Text style={styles.courtSelectDetail}>{court ? `${court.detail} · ${court.next}` : `${courts.length} confirmed ${courts.length === 1 ? 'reservation' : 'reservations'} available`}</Text></View>
            <Icon name={court ? 'create-outline' : 'chevron-forward'} color={C.teal} />
          </Pressable>
          <View style={styles.bookingVerifiedNote}><Icon name="shield-checkmark-outline" size={15} color={C.teal} /><Text style={styles.bookingVerifiedText}>Only confirmed reservations are shown. Live scoring unlocks during your booked time.</Text></View>
          <Pressable accessibilityRole="button" onPress={onBookCourt} style={styles.bookAnotherButton}><Icon name="add-circle-outline" size={15} color={C.teal} /><Text style={styles.bookAnotherText}>Book another court</Text></Pressable>
        </>}
      </View>
      </View>}

      {!joinedInvite && <View style={styles.lineupPreview}>
        <View style={styles.sectionHeadingRow}><View><Text style={styles.sectionLabel}>COURT LINEUP</Text><Text style={styles.sectionHelper}>{canStart ? 'Everything looks good' : 'Open spots update as you add players'}</Text></View>{canStart && <View style={styles.readyPill}><Icon name="checkmark-circle" size={14} color={C.teal} /><Text style={styles.readyPillText}>READY</Text></View>}</View>
        <CourtLineup players={players} matchType={matchType} court={court} onSwap={() => setPlayers(([first, second]) => [second, first])} currentUserName={currentUserName} currentUserAvatar={currentUserAvatar} registeredPlayers={[...registeredPlayers, ...lineupProfiles]} />
      </View>}

      {setupStage === 3 && !joinedInvite && <>
      <View style={styles.scoringMethodSection}>
        <View style={styles.sectionHeadingRow}><View><Text style={styles.sectionLabel}>SCORING METHOD</Text><Text style={styles.sectionHelper}>Choose how score updates are delivered courtside</Text></View><View style={styles.scoringMethodSelected}><Icon name={scoringMethod === 'voice' ? 'volume-high' : scoringMethod === 'shout' ? 'mic' : 'hand-left'} size={13} color={C.teal} /><Text style={styles.scoringMethodSelectedText}>{scoringMethod === 'shout' ? 'VOICE SCORE' : scoringMethod.toUpperCase()}</Text></View></View>
        <View accessibilityRole="radiogroup" style={styles.scoringMethodChoices}>
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: scoringMethod === 'voice' }} onPress={() => setScoringMethod('voice')} style={({ pressed }) => [styles.scoringMethodChoice, scoringMethod === 'voice' && styles.scoringMethodChoiceActive, pressed && styles.pressed]}><View style={[styles.scoringMethodChoiceIcon, scoringMethod === 'voice' && styles.scoringMethodChoiceIconActive]}><Icon name="volume-high-outline" size={21} color={scoringMethod === 'voice' ? '#0E2321' : C.teal} /></View><Text style={styles.scoringMethodChoiceTitle}>Voice assisted</Text><Text style={styles.scoringMethodChoiceMeta}>Tap the rally winner and Peakle announces the score and next server aloud.</Text><View style={[styles.scoringMethodRadio, scoringMethod === 'voice' && styles.scoringMethodRadioActive]}>{scoringMethod === 'voice' ? <View style={styles.scoringMethodRadioDot} /> : null}</View></Pressable>
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: scoringMethod === 'manual' }} onPress={() => setScoringMethod('manual')} style={({ pressed }) => [styles.scoringMethodChoice, scoringMethod === 'manual' && styles.scoringMethodChoiceActive, pressed && styles.pressed]}><View style={[styles.scoringMethodChoiceIcon, scoringMethod === 'manual' && styles.scoringMethodChoiceIconActive]}><Icon name="hand-left-outline" size={21} color={scoringMethod === 'manual' ? '#0E2321' : C.teal} /></View><Text style={styles.scoringMethodChoiceTitle}>Manual</Text><Text style={styles.scoringMethodChoiceMeta}>Use quiet one-tap controls for every rally, side-out, and correction.</Text><View style={[styles.scoringMethodRadio, scoringMethod === 'manual' && styles.scoringMethodRadioActive]}>{scoringMethod === 'manual' ? <View style={styles.scoringMethodRadioDot} /> : null}</View></Pressable>
          {NATIVE_VOICE_SCORING_ENABLED ? <Pressable accessibilityRole="radio" accessibilityState={{ checked: scoringMethod === 'shout' }} onPress={() => setScoringMethod('shout')} style={({ pressed }) => [styles.scoringMethodChoice, scoringMethod === 'shout' && styles.scoringMethodChoiceActive, pressed && styles.pressed]}><View style={[styles.scoringMethodChoiceIcon, scoringMethod === 'shout' && styles.scoringMethodChoiceIconActive]}><Icon name="mic-outline" size={21} color={scoringMethod === 'shout' ? '#0E2321' : C.teal} /></View><Text style={styles.scoringMethodChoiceTitle}>Voice scoring</Text><Text style={styles.scoringMethodChoiceMeta}>Say an explicit command such as “Point team one,” “[player name] serving,” or “Score two one two.”</Text><View style={[styles.scoringMethodRadio, scoringMethod === 'shout' && styles.scoringMethodRadioActive]}>{scoringMethod === 'shout' ? <View style={styles.scoringMethodRadioDot} /> : null}</View></Pressable> : null}
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAdvanced }} onPress={() => setShowAdvanced((value) => !value)} style={({ pressed }) => [styles.advancedToggle, pressed && styles.pressed]}>
        <View style={styles.advancedIcon}><Icon name="options-outline" color={C.teal} /></View>
        <View style={styles.flex}><Text style={styles.advancedTitle}>Match options</Text><Text style={styles.advancedMeta}>{mode === 'ranked' ? 'Ranked' : 'Casual'} · {target} points · {bestOf === 1 ? '1 game' : 'best of 3'} · {scorer || 'choose scorer'}</Text></View>
        <Icon name={showAdvanced ? 'chevron-up' : 'chevron-down'} color={C.teal} />
      </Pressable>

      {showAdvanced && <View style={styles.advancedPanel}>
        <SegmentedControl
          label="MATCH SCORER"
          value={scorerSource}
          onChange={changeScorerSource}
          options={[
            { value: 'host', label: 'Host scores', icon: 'phone-portrait-outline' },
            { value: 'player', label: 'Player scores', icon: 'person-outline' }
          ]}
        />
        <View style={styles.scorerPicker}>
          {(scorerSource === 'host'
            ? [{ id: currentUserId, name: currentUserName || 'You', meta: 'Recommended · this device controls scoring', color: C.teal }]
            : registeredScorerCandidates.map((person) => ({ ...person, meta: 'Signed-in player · scores from their device', color: C.teal }))).map((person) => {
            const selected = scorerId === person.id;
            return (
              <Pressable key={person.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`Choose ${person.name} as scorer`} onPress={() => { setScorer(person.name); setScorerId(person.id); }} style={({ pressed }) => [styles.scorerOption, selected && styles.scorerOptionSelected, pressed && styles.pressed]}>
                <View style={[styles.scorerOptionAvatar, { backgroundColor: person.color || C.teal }]}><Text style={styles.scorerOptionInitials}>{initials(person.name)}</Text></View>
                <View style={styles.scorerOptionCopy}><Text style={styles.scorerOptionName}>{person.name}</Text><Text style={styles.scorerOptionMeta}>{person.meta}</Text></View>
                <Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} color={selected ? C.teal : C.ink40} />
              </Pressable>
            );
          })}
        </View>
        {scorerSource === 'player' && !registeredScorerCandidates.length && <Text style={styles.emptyScorerText}>No signed-in player is available yet. Keep “Host scores,” or invite a registered player and wait for them to join.</Text>}
        {mode === 'ranked' && <View style={styles.scorerHint}><Icon name="shield-checkmark-outline" size={15} color={C.teal} /><Text style={styles.scorerHintText}>Ranked scoring can only be assigned to the signed-in host or an accepted signed-in player.</Text></View>}
        <SegmentedControl label="POINTS TO WIN" value={target} onChange={setTarget} options={[11, 15, 21].map((value) => ({ value, label: String(value) }))} />
        <SegmentedControl label="MATCH LENGTH" value={bestOf} onChange={setBestOf} options={[
          { value: 1, label: '1 game' },
          { value: 3, label: 'Best of 3' },
        ]} />
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: winByTwo }} onPress={() => setWinByTwo((value) => !value)} style={styles.settingRow}>
          <View style={styles.settingIcon}><Icon name="add-circle-outline" color={C.teal} /></View>
          <View style={styles.settingCopy}><Text style={styles.settingTitle}>Win by 2</Text><Text style={styles.bodySmall}>Keep playing until one side leads by two points.</Text></View>
          <View style={[styles.toggle, winByTwo && styles.toggleOn]}><View style={[styles.toggleKnob, winByTwo && styles.toggleKnobOn]} /></View>
        </Pressable>
        {mode === 'ranked' && <View style={styles.rankedNote}><Icon name="shield-checkmark-outline" color={C.teal} /><Text style={styles.rankedNoteText}>Ranked result will be included in your local rating history.</Text></View>}
      </View>}
      </>}

      {joinedInvite ? <View accessibilityRole="status" style={styles.joinedWaitingCard}>
        <View style={styles.joinedWaitingIcon}><Icon name="checkmark" size={24} color="#0E2321" /></View>
        <View style={styles.flex}><Text style={styles.joinedWaitingEyebrow}>YOU’RE CONNECTED</Text><Text style={styles.joinedWaitingTitle}>Waiting for {joinedSender?.display_name || 'the host'}</Text><Text style={styles.joinedWaitingText}>Keep this screen open. The host controls the lineup and starts the match.</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Leave joined match" onPress={onLeaveJoined} style={({ pressed }) => [styles.leaveJoinedButton, pressed && styles.pressed]}><Icon name="exit-outline" size={17} color={C.brick} /><Text style={styles.leaveJoinedText}>Leave</Text></Pressable>
      </View> : <View style={styles.wizardActions}>
        {setupStage > 0 && <Pressable accessibilityRole="button" onPress={() => moveToStage(setupStage - 1)} style={({ pressed }) => [styles.wizardBack, pressed && styles.pressed]}><Icon name="arrow-back" size={16} color={C.teal} /><Text style={styles.wizardBackText}>Back</Text></Pressable>}
        {setupStage < setupStages.length - 1 ? <Pressable
          accessibilityRole="button"
          disabled={!canContinueStage}
          onPress={() => moveToStage(setupStage + 1)}
          style={({ pressed }) => [styles.primaryButton, styles.wizardPrimary, !canContinueStage && styles.disabled, pressed && canContinueStage && styles.pressed]}
        >
          <Text style={styles.primaryText}>{['Continue to players', 'Continue to court', 'Review match'][setupStage]}</Text><Icon name="arrow-forward" size={18} color="#0E2321" />
        </Pressable> : <Pressable
          accessibilityRole="button"
          disabled={!canStart}
          onPress={() => onStart(matchConfiguration)}
          style={({ pressed }) => [styles.primaryButton, styles.wizardPrimary, !canStart && styles.disabled, pressed && canStart && styles.pressed]}
        >
          <Icon name={canStart ? 'play' : 'lock-closed'} size={19} color="#0E2321" /><Text style={styles.primaryText}>{canStart ? 'Continue to first serve' : 'Complete match setup'}</Text><Icon name="arrow-forward" size={18} color="#0E2321" />
        </Pressable>}
      </View>}
      {!joinedInvite && ((setupStage < 3 && !canContinueStage) || (setupStage === 3 && !canStart)) && <Text style={styles.validation}>{stageMessage}</Text>}

      {setupStage === 0 && <View style={styles.otherPlaySection}>
        <Text style={styles.otherPlayEyebrow}>OTHER WAYS TO PLAY</Text>
        <Text style={styles.otherPlayTitle}>Looking for a game?</Text>
        <View style={styles.otherPlayActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Find players for a game" onPress={onFindPlay} style={({ pressed }) => [styles.otherPlayAction, pressed && styles.pressed]}>
            <View style={[styles.otherPlayIcon, styles.otherPlayIconMuted]}><Icon name="search" size={20} color={C.teal} /></View>
            <Text style={styles.otherPlayActionTitle}>Find players</Text>
            <Text style={styles.otherPlayActionMeta}>Find a partner or opponent</Text>
            <View style={styles.otherPlayArrow}><Icon name="arrow-forward" size={15} color={C.teal} /></View>
          </Pressable>
        </View>
      </View>}
      <CourtPicker courts={courts} visible={showCourts} selected={court} onClose={() => setShowCourts(false)} onSelect={(selected) => { setCourt(selected); setBookingClock(Date.now()); setShowCourts(false); }} />
    </ScrollView>
  );
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function teamName(players) {
  return players.join(' & ');
}

function initials(name) {
  return name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function PreGameScreen({ match, onBack, onStart }) {
  const [serveChoice, setServeChoice] = useState(null);

  return (
    <ScrollView contentContainerStyle={[styles.content, styles.preGameContent]} showsVerticalScrollIndicator={false}>
      <Header eyebrow="PRE-GAME" title="Who serves first?" action={<View style={styles.liveChip}><Icon name="create-outline" size={14} color={C.teal} /><Text style={styles.liveChipText}>SCORER PICKS</Text></View>} />
      <View style={styles.drawHero}>
        <View style={styles.drawHeroIcon}><Icon name="person" size={32} /></View>
        <Text style={styles.drawEyebrow}>{match.scorerSource === 'host' ? 'HOST SCORING' : 'PLAYER SCORER'} · {match.scorer.toUpperCase()}</Text>
        <Text style={styles.drawTitle}>{serveChoice === null ? 'Choose the opening server.' : `${serveChoice.player} serves first.`}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.drawLead}>{serveChoice === null ? 'The scorer selects one player below before live scoring begins.' : `${teamName(match.players[serveChoice.team])} opens the match on serve.`}</Text>
      </View>

      <View style={styles.drawTeams}>
        {[0, 1].map((team) => {
          const selected = serveChoice?.team === team;
          return (
            <View key={team} style={[styles.drawTeam, team === 1 && styles.drawTeamAway, selected && styles.drawTeamWinner]}>
              <View style={[styles.drawTeamBadge, team === 1 && styles.drawTeamBadgeAway]}><Text style={styles.drawTeamBadgeText}>T{team + 1}</Text></View>
              <Text numberOfLines={2} style={styles.drawTeamName}>{teamName(match.players[team])}</Text>
              <View style={styles.serverChoices}>
                {match.players[team].map((player) => {
                  const playerSelected = serveChoice?.team === team && serveChoice?.player === player;
                  return <Pressable key={player} accessibilityRole="radio" accessibilityState={{ checked: playerSelected }} accessibilityLabel={`Choose ${player} to serve first`} onPress={() => setServeChoice({ team, player })} style={({ pressed }) => [styles.serverChoice, playerSelected && styles.serverChoiceSelected, pressed && styles.pressed]}><Icon name={playerSelected ? 'tennisball' : 'person-outline'} size={13} color={playerSelected ? '#0E2321' : C.ink40} /><Text numberOfLines={1} style={[styles.serverChoiceText, playerSelected && styles.serverChoiceTextSelected, playerSelected && { color: '#0E2321' }]}>{player}</Text></Pressable>;
                })}
              </View>
              <View style={[styles.drawServeStatus, selected && styles.drawServeStatusActive]}><Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={selected ? '#0E2321' : C.ink40} /><Text numberOfLines={1} style={[styles.drawServeStatusText, selected && styles.drawServeStatusTextActive, selected && { color: '#0E2321' }]}>{selected ? 'FIRST SERVE' : 'NOT SELECTED'}</Text></View>
            </View>
          );
        })}
      </View>

      <View style={styles.preGameSummary}>
        <View style={styles.preGameSummaryRow}><Icon name="location-outline" color={C.teal} /><View style={styles.flex}><Text style={styles.preGameSummaryLabel}>COURT</Text><Text style={styles.preGameSummaryValue}>{match.court.name}</Text></View></View>
        <View style={styles.preGameSummaryRow}><Icon name={match.scorerSource === 'host' ? 'phone-portrait-outline' : 'person-outline'} color={C.teal} /><View style={styles.flex}><Text style={styles.preGameSummaryLabel}>{match.scorerSource === 'host' ? 'HOST SCORING' : 'PLAYER SCORER'}</Text><Text style={styles.preGameSummaryValue}>{match.scorer}</Text></View><View style={styles.scorerReady}><View style={styles.liveDot} /><Text style={styles.scorerReadyText}>READY</Text></View></View>
        <View style={styles.preGameSummaryRow}><Icon name={match.scoringMethod === 'voice' ? 'volume-high-outline' : match.scoringMethod === 'shout' ? 'mic-outline' : 'hand-left-outline'} color={C.teal} /><View style={styles.flex}><Text style={styles.preGameSummaryLabel}>SCORING METHOD</Text><Text style={styles.preGameSummaryValue}>{match.scoringMethod === 'voice' ? 'Voice assisted' : match.scoringMethod === 'shout' ? 'Voice scoring' : 'Manual controls'}</Text></View></View>
      </View>

      <Pressable accessibilityRole="button" disabled={!serveChoice} onPress={() => onStart(serveChoice)} style={({ pressed }) => [styles.primaryButton, !serveChoice && styles.disabled, pressed && serveChoice && styles.pressed]}><Icon name="play" size={19} color="#0E2321" /><Text style={styles.primaryText}>{serveChoice ? `Start with ${serveChoice.player}` : 'Select a first server'}</Text><Icon name="arrow-forward" size={18} color="#0E2321" /></Pressable>
      <Pressable accessibilityRole="button" onPress={onBack} style={({ pressed }) => [styles.preGameBack, pressed && styles.pressed]}><Icon name="arrow-back" size={15} color={C.ink40} /><Text style={styles.preGameBackText}>Back to match setup</Text></Pressable>
    </ScrollView>
  );
}

function LiveCourt({ match, ballBounce, rallyTravel, scorerMessage, paused, breakActive = false, scores, server, servingPlayerIndex, serviceNumber, celebration, pointAnnouncement, canScore = true, isHost = false, onChangeScorer }) {
  const playerOpacity = celebration.interpolate({ inputRange: [0, .1, .88, 1], outputRange: [1, 0, 0, 1] });
  const announcementOpacity = celebration.interpolate({ inputRange: [0, .1, .88, 1], outputRange: [0, 1, 1, 0] });
  const announcementScale = celebration.interpolate({ inputRange: [0, .18, .82, 1], outputRange: [.86, 1, 1, .94] });

  return (
    <View style={styles.liveCourtCard}>
      <View style={styles.liveCourtHead}>
        <View><Text style={styles.liveCourtEyebrow}>ON COURT NOW</Text><Text style={styles.liveCourtTitle}>Live court</Text></View>
        <View style={styles.liveNowPill}><View style={styles.liveNowDot} /><Text style={styles.liveNowText}>{breakActive ? 'BREAK' : paused ? 'PAUSED' : 'PLAYING'}</Text></View>
      </View>
      <View style={[styles.liveCourt, { backgroundColor: match.court.color || C.teal }]}> 
        <View style={styles.liveCourtBounds} />
        <View style={styles.liveCourtCenterTop} />
        <View style={styles.liveCourtCenterBottom} />
        <View style={styles.liveCourtKitchenTop} />
        <View style={styles.liveCourtKitchenBottom} />
        <View style={styles.liveCourtNet} />
        <View style={styles.courtScoreBar}><View style={styles.courtScoreTeam}><Text style={styles.courtScoreTag}>T1</Text><Text accessibilityLabel={`Team 1 score ${scores[0]}`} style={styles.courtScoreNumber}>{scores[0]}</Text></View><View style={styles.courtGamePill}><Text style={styles.courtGameText}>LIVE SCORE</Text></View><View style={styles.courtScoreTeam}><Text accessibilityLabel={`Team 2 score ${scores[1]}`} style={styles.courtScoreNumber}>{scores[1]}</Text><Text style={[styles.courtScoreTag, styles.courtScoreTagAway]}>T2</Text></View></View>
        {[0, 1].map((team) => (
          <Animated.View key={team} style={[styles.liveCourtTeam, team === 1 && styles.liveCourtTeamAway, { opacity: playerOpacity }]}>
            {match.players[team].map((player) => (
              <View key={`${team}-${player}`} style={styles.liveCourtPlayer}>
                <View style={[styles.livePlayerMarker, team === 1 && styles.livePlayerMarkerAway, server === team && match.players[team][servingPlayerIndex] === player && styles.livePlayerServing]}><Text style={styles.livePlayerInitials}>{initials(player)}</Text></View>
                <Text numberOfLines={1} style={styles.livePlayerName}>{player}</Text>
              </View>
            ))}
          </Animated.View>
        ))}
        {pointAnnouncement && <Animated.View accessibilityRole="alert" accessibilityLiveRegion="assertive" pointerEvents="none" style={[styles.pointAnnouncement, { opacity: announcementOpacity, transform: [{ scale: announcementScale }] }]}><Text style={styles.pointAnnouncementPlayer}>{pointAnnouncement.player}</Text><Text style={styles.pointAnnouncementTeam}>{pointAnnouncement.team}</Text><Text style={styles.pointAnnouncementText}>{pointAnnouncement.action}</Text><Text style={styles.pointAnnouncementScore}>{pointAnnouncement.score}</Text>{pointAnnouncement.nextServe && <Text style={styles.pointAnnouncementServe}>{pointAnnouncement.nextServe}</Text>}</Animated.View>}
        <RallyBall travel={rallyTravel} bounce={ballBounce} doubles={match.matchType === 'doubles'} opacity={playerOpacity} />
      </View>
      <View style={styles.scorerBooth}>
        <View style={styles.scorerBoothAvatar}><Text style={styles.scorerBoothInitials}>{initials(match.scorer)}</Text><View style={styles.scorerOnline} /></View>
        <View style={styles.scorerBoothCopy}><Text style={styles.scorerBoothLabel}>{match.scorerSource === 'host' ? 'HOST SCORING' : 'PLAYER SCORER'}</Text><Text style={styles.scorerBoothName}>{match.scorer}</Text><Text accessibilityLiveRegion="polite" numberOfLines={1} style={styles.scorerMessage}>{paused ? 'Scoring paused. Resume when players are ready.' : scorerMessage}</Text><Text style={styles.scorerServing}>{match.players[server][servingPlayerIndex]} serving · Server {serviceNumber}</Text></View>
        {isHost ? <Pressable accessibilityRole="button" accessibilityLabel="Change match scorer" onPress={onChangeScorer} style={({ pressed }) => [styles.scorerChangeButton, pressed && styles.pressed]}><Icon name="swap-horizontal-outline" size={14} color={C.teal} /><Text style={styles.scorerChangeText}>CHANGE</Text></Pressable> : <View style={styles.scorerControlBadge}><Icon name={canScore ? 'create-outline' : 'eye-outline'} size={14} color={C.teal} /><Text style={styles.scorerControlText}>{canScore ? 'SCORING' : 'WATCHING'}</Text></View>}
      </View>
    </View>
  );
}

function ScoreTeam({ index, players, score, games, serving, winner, disabled, onPoint }) {
  return (
    <View style={[styles.scoreTeam, index === 1 && styles.scoreTeamAway, winner && styles.scoreTeamWinner]}>
      <View style={styles.scoreTeamHead}>
        <View style={[styles.teamBadge, index === 1 && styles.teamBadgeAway]}><Text style={styles.teamBadgeText}>T{index + 1}</Text></View>
        <View style={styles.scoreNameWrap}><Text numberOfLines={2} style={styles.scoreName}>{teamName(players)}</Text><Text style={styles.gamesText}>{games} {games === 1 ? 'game' : 'games'}</Text></View>
      </View>
      <Text accessibilityLabel={`Team ${index + 1} score ${score}`} style={styles.score}>{score}</Text>
      <View style={styles.serveRow}>{serving ? <><View style={styles.serveDot} /><Text style={styles.serveText}>SERVING</Text></> : <Text style={styles.receiveText}>RECEIVING</Text>}</View>
      <Pressable
        accessibilityLabel={`Add point to team ${index + 1}`}
        disabled={disabled}
        onPress={() => onPoint(index)}
        style={({ pressed }) => [styles.pointButton, index === 1 && styles.pointButtonAway, disabled && styles.pointDisabled, pressed && !disabled && styles.pressed]}
      >
        <Icon name="add" size={22} color={C.surface} /><Text style={styles.pointText}>ADD POINT</Text>
      </Pressable>
    </View>
  );
}

function ConfirmEndModal({ visible, onCancel, onConfirm, onSaveUnfinished }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable {...webDialog('backdrop')} accessibilityLabel="Cancel ending match" style={styles.modalBackdrop} onPress={onCancel}>
        <Pressable {...webDialog('surface')} accessibilityRole="dialog" style={styles.dialog} onPress={(event) => event.stopPropagation()}>
          <View style={styles.dialogIcon}><Icon name="flag-outline" size={26} color={C.brick} /></View>
          <Text style={styles.dialogTitle}>End this match?</Text>
          <Text style={styles.dialogBody}>Save it as unfinished to resume later without affecting your record, or end it now as a final result.</Text>
          <Pressable onPress={onSaveUnfinished} style={({ pressed }) => [styles.saveUnfinishedButton, pressed && styles.pressed]}><Icon name="bookmark-outline" size={16} color="#0E2321" /><Text style={[styles.saveUnfinishedText, { color: '#0E2321' }]}>Save as unfinished</Text></Pressable>
          <View style={styles.dialogActions}><Pressable onPress={onCancel} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryText}>Keep playing</Text></Pressable><Pressable onPress={onConfirm} style={({ pressed }) => [styles.endConfirmButton, pressed && styles.pressed]}><Text style={styles.endConfirmText}>End as final</Text></Pressable></View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ServerSelectionModal({ visible, teamName, players, onCancel, onSelect }) {
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable {...webDialog('backdrop')} accessibilityLabel="Cancel server selection" style={styles.modalBackdrop} onPress={onCancel}>
        <Pressable {...webDialog('surface')} accessibilityRole="dialog" style={styles.dialog} onPress={(event) => event.stopPropagation()}>
          <View style={[styles.dialogIcon, { backgroundColor: '#E5F0ED' }]}><Icon name="tennisball-outline" size={26} color={C.teal} /></View>
          <Text style={styles.dialogTitle}>Who is serving?</Text>
          <Text style={styles.dialogBody}>Correct the serving player and server number for {teamName}. This does not award a point.</Text>
          <View style={styles.serverChoiceList}>
            {players.map((player, playerIndex) => (
              <View key={`${player}-${playerIndex}`} style={styles.serverChoiceRow}>
                <Text numberOfLines={1} style={styles.serverChoiceName}>{player}</Text>
                <Pressable onPress={() => onSelect(playerIndex, 1)} style={({ pressed }) => [styles.serverChoiceButton, pressed && styles.pressed]}><Text style={styles.serverChoiceButtonText}>SERVER 1</Text></Pressable>
                {players.length > 1 ? <Pressable onPress={() => onSelect(playerIndex, 2)} style={({ pressed }) => [styles.serverChoiceButton, pressed && styles.pressed]}><Text style={styles.serverChoiceButtonText}>SERVER 2</Text></Pressable> : null}
              </View>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FocusTracker({ challenge, returns, paused, onRecord, onUndo }) {
  if (!challenge) return null;
  const successes = returns.filter(Boolean).length;
  const complete = returns.length >= challenge.attempts;
  const achieved = complete && successes >= challenge.target;
  return (
    <View style={[styles.focusTracker, complete && (achieved ? styles.focusTrackerAchieved : styles.focusTrackerMissed)]}>
      <View style={styles.focusTrackerHead}>
        <View style={styles.focusTrackerIcon}><Icon name={complete ? (achieved ? 'checkmark' : 'refresh') : 'locate'} size={18} /></View>
        <View style={styles.focusTrackerCopy}><Text style={styles.focusTrackerEyebrow}>{complete ? (achieved ? 'CHALLENGE COMPLETE' : 'TARGET NOT YET MET') : 'ACTIVE FOCUS'}</Text><Text style={styles.focusTrackerTitle}>{challenge.instruction}</Text></View>
        <Text accessibilityLabel={`${successes} successful returns out of ${returns.length} recorded`} style={styles.focusTrackerScore}>{successes}/{challenge.target}</Text>
      </View>
      <View style={styles.returnDots}>
        {Array.from({ length: challenge.attempts }, (_, index) => {
          const recorded = index < returns.length;
          const successful = returns[index] === true;
          return <View key={index} style={[styles.returnDot, recorded && (successful ? styles.returnDotDeep : styles.returnDotShort)]}><Text style={[styles.returnDotText, recorded && styles.returnDotTextRecorded]}>{recorded ? (successful ? '✓' : '×') : index + 1}</Text></View>;
        })}
      </View>
      {!complete ? (
        <View style={styles.returnActions}>
          <Pressable disabled={paused} accessibilityLabel="Record return past mid-court" onPress={() => onRecord(true)} style={({ pressed }) => [styles.returnButton, styles.returnButtonDeep, paused && styles.controlDisabled, pressed && !paused && styles.pressed]}><Icon name="checkmark" size={17} color={C.surface} /><Text style={styles.returnButtonText}>Past mid-court</Text></Pressable>
          <Pressable disabled={paused} accessibilityLabel="Record short return" onPress={() => onRecord(false)} style={({ pressed }) => [styles.returnButton, styles.returnButtonShort, paused && styles.controlDisabled, pressed && !paused && styles.pressed]}><Icon name="close" size={17} color={C.brick} /><Text style={styles.returnButtonShortText}>Short</Text></Pressable>
        </View>
      ) : <Text style={styles.focusTrackerResult}>{achieved ? `Goal achieved — ${successes} of ${challenge.attempts} returns landed deep.` : `${successes} of ${challenge.attempts} landed deep. Try the challenge again next match.`}</Text>}
      {returns.length > 0 && !complete && <Pressable disabled={paused} onPress={onUndo} style={styles.returnUndo}><Icon name="arrow-undo-outline" size={13} color={C.ink40} /><Text style={styles.returnUndoText}>Undo last return</Text></Pressable>}
    </View>
  );
}

const scoreCardStyles = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 14, overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: '#304743', backgroundColor: '#0E2321' },
  header: { minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.12)', backgroundColor: '#17302D' },
  headerTitle: { flexShrink: 0, color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: .8 },
  headerMeta: { flexShrink: 1, color: '#9FB3AC', textAlign: 'right', fontSize: 10, fontWeight: '800', letterSpacing: .35 },
  columns: { minHeight: 34, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.1)' },
  column: { width: 39, color: '#9FB3AC', textAlign: 'center', fontSize: 10, fontWeight: '900', letterSpacing: .3 },
  teamColumn: { minWidth: 0, flex: 1, textAlign: 'left' },
  teamRow: { minHeight: 64, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.1)' },
  teamMark: { width: 30, height: 30, marginRight: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#1C6B66' },
  teamMarkAway: { backgroundColor: '#B6472E' },
  teamMarkText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  teamName: { minWidth: 0, flex: 1, paddingRight: 7, color: '#FFFFFF', fontSize: 12, lineHeight: 16, fontWeight: '900' },
  setValue: { width: 39, color: '#FFFFFF', textAlign: 'center', fontSize: 17, fontWeight: '900' },
  gameValue: { width: 39, color: '#9FB3AC', textAlign: 'center', fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  gameValueLive: { color: '#D6E94A' },
  timeRow: { minHeight: 50, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  timeLabel: { minWidth: 0, flex: 1, color: '#9FB3AC', textAlign: 'left', fontSize: 10, fontWeight: '900', letterSpacing: .45 },
  timeTotal: { width: 39, color: '#FFFFFF', textAlign: 'center', fontSize: 10, fontWeight: '900', fontVariant: ['tabular-nums'] },
  timeValue: { width: 39, color: '#9FB3AC', textAlign: 'center', fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'] },
});

const breakCardLightStyles = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 14, minHeight: 108, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: '#E5F0ED', ...Platform.select({ ios: { shadowColor: '#0E2321', shadowOpacity: .09, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } }, android: { elevation: 4 } }) },
  timer: { width: 58, height: 68, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#0E2321' },
  timerValue: { color: '#D6E94A', fontSize: 24, lineHeight: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  timerUnit: { marginTop: 1, color: 'rgba(255,255,255,.62)', fontSize: 9, fontWeight: '900', letterSpacing: .7 },
  copy: { minWidth: 0, flex: 1 },
  eyebrow: { color: '#1C6B66', fontSize: 9, fontWeight: '900', letterSpacing: .45 },
  title: { marginTop: 3, color: '#0E2321', fontSize: 12, lineHeight: 16, fontWeight: '900' },
  meta: { marginTop: 4, color: '#667570', fontSize: 10, lineHeight: 14 },
  continueButton: { minWidth: 76, minHeight: 48, paddingHorizontal: 9, flexShrink: 0, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 13, backgroundColor: '#D6E94A' },
  continueText: { color: '#0E2321', fontSize: 10, fontWeight: '900' },
  waiting: { width: 68, minHeight: 48, flexShrink: 0, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 13, borderWidth: 1, borderColor: '#C9DCD7', backgroundColor: '#FFFFFF' },
  waitingText: { color: '#1C6B66', fontSize: 9, fontWeight: '900', letterSpacing: .4 },
});

const breakCardDarkStyles = StyleSheet.create({
  ...Object.fromEntries(Object.entries(breakCardLightStyles).map(([key, value]) => [key, StyleSheet.flatten(value)])),
  card: { ...StyleSheet.flatten(breakCardLightStyles.card), borderColor: '#35534E', backgroundColor: '#203B37' },
  title: { ...StyleSheet.flatten(breakCardLightStyles.title), color: '#F2F5F0' },
  meta: { ...StyleSheet.flatten(breakCardLightStyles.meta), color: '#9FB3AC' },
  eyebrow: { ...StyleSheet.flatten(breakCardLightStyles.eyebrow), color: '#72C7BE' },
  waiting: { ...StyleSheet.flatten(breakCardLightStyles.waiting), borderColor: '#35534E', backgroundColor: '#162F2C' },
  waitingText: { ...StyleSheet.flatten(breakCardLightStyles.waitingText), color: '#72C7BE' },
});

function MatchBoxScore({ match, games, scores, gameScores, elapsed, gameElapsed, gameDurations, gameBreak }) {
  const columns = [...gameScores];
  const lastCompletedScore = gameScores[gameScores.length - 1];
  const currentGameActive = !gameBreak && (!lastCompletedScore || lastCompletedScore[0] !== scores[0] || lastCompletedScore[1] !== scores[1]);
  if (currentGameActive && columns.length < match.bestOf) columns.push(scores);
  const columnSlots = Array.from({ length: match.bestOf }, (_, index) => columns[index] || null);
  const timeSlots = Array.from({ length: match.bestOf }, (_, index) => gameDurations[index] ?? (currentGameActive && index === gameScores.length ? gameElapsed : null));
  return (
    <View style={scoreCardStyles.card}>
      <View style={scoreCardStyles.header}><Text maxFontSizeMultiplier={1.2} style={scoreCardStyles.headerTitle}>BOX SCORE</Text><Text maxFontSizeMultiplier={1.2} style={scoreCardStyles.headerMeta}>SETS · FIRST TO {match.target}</Text></View>
      <View style={scoreCardStyles.columns}><Text maxFontSizeMultiplier={1.2} style={[scoreCardStyles.column, scoreCardStyles.teamColumn]}>TEAM</Text><Text maxFontSizeMultiplier={1.2} style={scoreCardStyles.column}>SETS</Text>{columnSlots.map((_, index) => <Text maxFontSizeMultiplier={1.2} key={`head-${index}`} style={scoreCardStyles.column}>G{index + 1}</Text>)}</View>
      {[0, 1].map((team) => <View key={team} style={scoreCardStyles.teamRow}><View style={[scoreCardStyles.teamMark, team === 1 && scoreCardStyles.teamMarkAway]}><Text maxFontSizeMultiplier={1.2} style={scoreCardStyles.teamMarkText}>T{team + 1}</Text></View><Text maxFontSizeMultiplier={1.2} numberOfLines={2} style={scoreCardStyles.teamName}>{teamName(match.players[team])}</Text><Text maxFontSizeMultiplier={1.2} style={scoreCardStyles.setValue}>{games[team]}</Text>{columnSlots.map((score, index) => <Text maxFontSizeMultiplier={1.2} key={`${team}-${index}`} style={[scoreCardStyles.gameValue, index === gameScores.length && !gameBreak && scoreCardStyles.gameValueLive]}>{score ? score[team] : '—'}</Text>)}</View>)}
      <View style={scoreCardStyles.timeRow}><Text maxFontSizeMultiplier={1.2} style={scoreCardStyles.timeLabel}>MATCH TIME</Text><Text maxFontSizeMultiplier={1.2} style={scoreCardStyles.timeTotal}>{formatTime(elapsed)}</Text>{timeSlots.map((time, index) => <Text maxFontSizeMultiplier={1.2} key={`time-${index}`} style={scoreCardStyles.timeValue}>{Number.isFinite(time) ? formatTime(time) : '—'}</Text>)}</View>
    </View>
  );
}

function GameBreakCard({ gameBreak, canScore, onContinue }) {
  const { isDark } = useTheme();
  const breakStyles = isDark ? breakCardDarkStyles : breakCardLightStyles;
  const [remaining, setRemaining] = useState(gameBreak.durationSeconds);
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, gameBreak.durationSeconds - Math.floor((Date.now() - gameBreak.startedAt) / 1000)));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [gameBreak.durationSeconds, gameBreak.startedAt]);
  return (
    <View style={breakStyles.card}>
      <View style={breakStyles.timer}><Text maxFontSizeMultiplier={1.2} style={breakStyles.timerValue}>{remaining}</Text><Text maxFontSizeMultiplier={1.2} style={breakStyles.timerUnit}>SEC</Text></View>
      <View style={breakStyles.copy}><Text maxFontSizeMultiplier={1.2} numberOfLines={2} style={breakStyles.eyebrow}>GAME {gameBreak.completedGame} COMPLETE · WATER BREAK</Text><Text maxFontSizeMultiplier={1.2} style={breakStyles.title}>{remaining > 0 ? 'Recover when you need it.' : 'Break complete. Ready for the next game?'}</Text><Text maxFontSizeMultiplier={1.2} numberOfLines={3} style={breakStyles.meta}>{gameBreak.score[0]}–{gameBreak.score[1]} · Game {gameBreak.nextGame} starts with {gameBreak.nextPlayer} serving.</Text></View>
      {canScore ? <Pressable accessibilityRole="button" onPress={onContinue} style={({ pressed }) => [breakStyles.continueButton, pressed && styles.pressed]}><Icon name="play" size={16} color="#0E2321" /><Text maxFontSizeMultiplier={1.2} style={breakStyles.continueText}>{remaining > 0 ? 'Continue' : `Start G${gameBreak.nextGame}`}</Text></Pressable> : <View style={breakStyles.waiting}><Icon name="hourglass-outline" size={15} color={isDark ? '#72C7BE' : '#1C6B66'} /><Text maxFontSizeMultiplier={1.2} style={breakStyles.waitingText}>SCORER</Text></View>}
    </View>
  );
}

function RallyBoxScore({ rallies }) {
  const [expanded, setExpanded] = useState(false);
  const visibleRallies = expanded ? rallies : rallies.slice(-6);
  return (
    <View style={styles.rallyLogCard}>
      <View style={styles.rallyLogHead}>
        <View><Text style={styles.eyebrow}>RALLY HISTORY</Text><Text style={styles.rallyLogTitle}>Serve-by-serve tally</Text></View>
        <View style={styles.rallyLogCount}><Text style={styles.rallyLogCountText}>{rallies.length} {rallies.length === 1 ? 'RALLY' : 'RALLIES'}</Text></View>
      </View>
      {!rallies.length ? <View style={styles.rallyLogEmpty}><Icon name="list-outline" size={20} color={C.ink40} /><Text style={styles.rallyLogEmptyText}>Every point, side-out, and server change will appear here.</Text></View> : visibleRallies.map((rally) => (
        <View key={rally.id} style={styles.rallyLogRow}>
          <View style={[styles.rallyLogNumber, rally.team === 1 && styles.rallyLogNumberAway]}><Text style={styles.rallyLogNumberText}>{rally.number}</Text></View>
          <View style={styles.rallyLogCopy}><Text numberOfLines={1} style={styles.rallyLogResult}>{rally.winner} · {rally.action}</Text><Text numberOfLines={1} style={styles.rallyLogServe}>{rally.nextServe}</Text></View>
          <View style={styles.rallyLogScore}><Text style={styles.rallyLogScoreText}>{rally.score[0]} – {rally.score[1]}</Text><Text style={styles.rallyLogGame}>G{rally.game}</Text></View>
        </View>
      ))}
      {rallies.length > 6 ? <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)} style={({ pressed }) => [styles.rallyLogMore, pressed && styles.pressed]}><Text style={styles.rallyLogMoreText}>{expanded ? 'Show latest 6' : `Show all ${rallies.length} rallies`}</Text><Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.teal} /></Pressable> : null}
    </View>
  );
}

function LiveMatch({ match, sharedSession = null, currentUserId, onSyncSharedState, onHandoffScorer, onFinish }) {
  const initialSharedState = sharedSession?.state || match.sharedState || (match.reason === 'unfinished' ? match : {});
  const configuredFirstServerTeam = match.firstServer ?? 0;
  const configuredFirstServerPlayerIndex = Math.max(0, match.players[configuredFirstServerTeam].indexOf(match.firstServerPlayer));
  const configuredEvenSidePlayerIndexes = match.evenSidePlayerIndexes || [
    configuredFirstServerTeam === 0 ? configuredFirstServerPlayerIndex : 0,
    configuredFirstServerTeam === 1 ? configuredFirstServerPlayerIndex : 0,
  ];
  const [scores, setScores] = useState(() => initialSharedState.scores ? [...initialSharedState.scores] : match.scores ? [...match.scores] : [0, 0]);
  const [games, setGames] = useState(() => initialSharedState.games ? [...initialSharedState.games] : match.games ? [...match.games] : [0, 0]);
  const [gameScores, setGameScores] = useState(() => (initialSharedState.gameScores || match.gameScores || []).map((item) => [...item]));
  const [server, setServer] = useState(initialSharedState.server ?? match.server ?? configuredFirstServerTeam);
  const [servingPlayerIndex, setServingPlayerIndex] = useState(() => initialSharedState.servingPlayerIndex ?? match.servingPlayerIndex ?? configuredFirstServerPlayerIndex);
  const [serviceNumber, setServiceNumber] = useState(initialSharedState.serviceNumber ?? match.serviceNumber ?? (match.matchType === 'doubles' ? 2 : 1));
  const [evenSidePlayerIndexes, setEvenSidePlayerIndexes] = useState(() => [
    ...(initialSharedState.evenSidePlayerIndexes || configuredEvenSidePlayerIndexes),
  ]);
  const [paused, setPaused] = useState(initialSharedState.paused ?? false);
  const [pointPause, setPointPause] = useState(false);
  const [pointAnnouncement, setPointAnnouncement] = useState(null);
  const [pointEvent, setPointEvent] = useState(initialSharedState.pointEvent || null);
  const [rallyLog, setRallyLog] = useState(() => (initialSharedState.rallyLog || match.rallyLog || []).map((item) => ({ ...item, score: Array.isArray(item.score) ? [...item.score] : [0, 0] })));
  const initialElapsed = initialSharedState.elapsed ?? match.elapsed ?? 0;
  const initialGameElapsed = initialSharedState.gameElapsed ?? match.gameElapsed ?? 0;
  const [elapsed, setElapsed] = useState(initialElapsed);
  const [gameElapsed, setGameElapsed] = useState(initialGameElapsed);
  const [matchStartedAt, setMatchStartedAt] = useState(() => initialSharedState.matchStartedAt ?? match.matchStartedAt ?? Date.now() - (initialElapsed * 1000));
  const [gameStartedAt, setGameStartedAt] = useState(() => initialSharedState.gameStartedAt ?? match.gameStartedAt ?? Date.now() - (initialGameElapsed * 1000));
  const [gameDurations, setGameDurations] = useState(() => [...(initialSharedState.gameDurations || match.gameDurations || [])]);
  const [gameBreak, setGameBreak] = useState(initialSharedState.gameBreak || null);
  const [history, setHistory] = useState(() => initialSharedState.history || []);
  const [swapped, setSwapped] = useState(false);
  const [manualServeTeam, setManualServeTeam] = useState(null);
  const [showEnd, setShowEnd] = useState(false);
  const [focusReturns, setFocusReturns] = useState(match.focusReturns || []);
  const [scoringMethod, setScoringMethod] = useState(match.scoringMethod === 'voice' ? 'voice' : NATIVE_VOICE_SCORING_ENABLED && match.scoringMethod === 'shout' ? 'shout' : 'manual');
  const [shoutFeedback, setShoutFeedback] = useState(null);
  const [scorerMessage, setScorerMessage] = useState(initialSharedState.scorerMessage || (match.reason === 'unfinished' ? 'Match resumed from the saved score.' : `Match started — ${match.firstServerPlayer || teamName(match.players[match.firstServer ?? 0])} serves first.`));
  const finishedRef = useRef(false);
  const { ballBounce, rallyTravel, bounceBall } = useRallyBallAnimation({ doubles: match.matchType === 'doubles', paused: paused || pointPause || Boolean(gameBreak) });
  const celebration = useRef(new Animated.Value(0)).current;
  const appliedSharedRevision = useRef(sharedSession?.revision || 0);
  const appliedPointEventId = useRef(initialSharedState.pointEvent?.id || null);
  const sharedSyncReady = useRef(false);
  const applyingSharedState = useRef(false);
  const isShared = Boolean(sharedSession?.id);
  const canScore = !isShared || sharedSession.scorer_id === currentUserId;
  const isHost = Boolean(isShared && sharedSession.host_id === currentUserId);
  const draft = useMatchDraft({
    enabled: !isShared && !DEMO_MODE, userId: currentUserId, match,
    state: { scores, games, gameScores, server, servingPlayerIndex, serviceNumber, evenSidePlayerIndexes, paused, rallyLog, gameDurations, gameBreak, matchStartedAt, gameStartedAt, scoringMethod, focusReturns, history: history.slice(-10) },
  });
  const scorerMember = sharedSession?.nearby_live_match_members?.find((member) => member.user_id === sharedSession.scorer_id);
  const liveMatch = { ...match, scorerId: sharedSession?.scorer_id || match.scorerId, scorer: scorerMember?.profiles?.display_name || match.scorer };
  const lastSharedSnapshot = useRef(JSON.stringify({
    scores: initialSharedState.scores || scores,
    games: initialSharedState.games || games,
    gameScores: initialSharedState.gameScores || gameScores,
    server: initialSharedState.server ?? server,
    servingPlayerIndex: initialSharedState.servingPlayerIndex ?? servingPlayerIndex,
    serviceNumber: initialSharedState.serviceNumber ?? serviceNumber,
    evenSidePlayerIndexes: initialSharedState.evenSidePlayerIndexes || evenSidePlayerIndexes,
    paused: initialSharedState.paused ?? paused,
    scorerMessage: initialSharedState.scorerMessage || scorerMessage,
    pointEvent: initialSharedState.pointEvent || pointEvent,
    rallyLog: initialSharedState.rallyLog || rallyLog,
    gameDurations: initialSharedState.gameDurations || gameDurations,
    gameBreak: initialSharedState.gameBreak || gameBreak,
    matchStartedAt: initialSharedState.matchStartedAt ?? matchStartedAt,
    gameStartedAt: initialSharedState.gameStartedAt ?? gameStartedAt,
  }));


  const playPointAnnouncement = useCallback((announcement, onComplete) => {
    setPointAnnouncement(announcement);
    if (scoringMethod === 'voice' && canScore) speakScoreAnnouncement(announcement);
    else announceScoreForVoiceOver(announcement);
    setPointPause(true);
    celebration.stopAnimation();
    celebration.setValue(0);
    Animated.timing(celebration, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start(() => {
      setPointAnnouncement(null);
      setPointPause(false);
      celebration.setValue(0);
      onComplete?.();
    });
  }, [canScore, celebration, scoringMethod]);

  useEffect(() => {
    return () => { celebration.stopAnimation(); stopScoreAnnouncement(); };
  }, [celebration]);

  const changeScoringMethod = (method) => {
    if (method === scoringMethod) return;
    stopScoreAnnouncement();
    setShoutFeedback(null);
    setScoringMethod(method);
  };

  useEffect(() => {
    if (!sharedSession?.id || sharedSession.revision <= appliedSharedRevision.current || !sharedSession.state) return;
    appliedSharedRevision.current = sharedSession.revision;
    applyingSharedState.current = true;
    const state = sharedSession.state;
    if (state.scores) setScores([...state.scores]);
    if (state.games) setGames([...state.games]);
    if (state.gameScores) setGameScores(state.gameScores.map((item) => [...item]));
    if (Number.isInteger(state.server)) setServer(state.server);
    if (Number.isInteger(state.servingPlayerIndex)) setServingPlayerIndex(state.servingPlayerIndex);
    if (Number.isInteger(state.serviceNumber)) setServiceNumber(state.serviceNumber);
    if (Array.isArray(state.evenSidePlayerIndexes)) setEvenSidePlayerIndexes([...state.evenSidePlayerIndexes]);
    if (typeof state.paused === 'boolean') setPaused(state.paused);
    if (typeof state.scorerMessage === 'string') setScorerMessage(state.scorerMessage);
    if (state.pointEvent) {
      setPointEvent(state.pointEvent);
      if (state.pointEvent.id && state.pointEvent.id !== appliedPointEventId.current) {
        appliedPointEventId.current = state.pointEvent.id;
        playPointAnnouncement(state.pointEvent);
      }
    }
    if (state.rallyLog) setRallyLog(state.rallyLog.map((item) => ({ ...item, score: Array.isArray(item.score) ? [...item.score] : [0, 0] })));
    if (state.gameDurations) setGameDurations([...state.gameDurations]);
    if (Object.prototype.hasOwnProperty.call(state, 'gameBreak')) setGameBreak(state.gameBreak || null);
    if (Number.isFinite(state.matchStartedAt)) setMatchStartedAt(state.matchStartedAt);
    if (Number.isFinite(state.gameStartedAt)) setGameStartedAt(state.gameStartedAt);
    lastSharedSnapshot.current = JSON.stringify({
      scores: state.scores || scores,
      games: state.games || games,
      gameScores: state.gameScores || gameScores,
      server: state.server ?? server,
      servingPlayerIndex: state.servingPlayerIndex ?? servingPlayerIndex,
      serviceNumber: state.serviceNumber ?? serviceNumber,
      evenSidePlayerIndexes: state.evenSidePlayerIndexes || evenSidePlayerIndexes,
      paused: state.paused ?? paused,
      scorerMessage: state.scorerMessage || scorerMessage,
      pointEvent: state.pointEvent || pointEvent,
      rallyLog: state.rallyLog || rallyLog,
      gameDurations: state.gameDurations || gameDurations,
      gameBreak: Object.prototype.hasOwnProperty.call(state, 'gameBreak') ? state.gameBreak : gameBreak,
      matchStartedAt: state.matchStartedAt ?? matchStartedAt,
      gameStartedAt: state.gameStartedAt ?? gameStartedAt,
    });
    const timer = setTimeout(() => { applyingSharedState.current = false; }, 0);
    return () => clearTimeout(timer);
  }, [playPointAnnouncement, sharedSession?.id, sharedSession?.revision]);

  useEffect(() => {
    if (!isShared || !canScore || !onSyncSharedState) return undefined;
    if (!sharedSyncReady.current) {
      const readyTimer = setTimeout(() => { sharedSyncReady.current = true; }, 0);
      return () => clearTimeout(readyTimer);
    }
    if (applyingSharedState.current) return undefined;
    const nextState = { scores, games, gameScores, server, servingPlayerIndex, serviceNumber, evenSidePlayerIndexes, paused, scorerMessage, pointEvent, rallyLog, gameDurations, gameBreak, matchStartedAt, gameStartedAt };
    const snapshot = JSON.stringify(nextState);
    if (snapshot === lastSharedSnapshot.current) return undefined;
    const syncTimer = setTimeout(() => {
      lastSharedSnapshot.current = snapshot;
      onSyncSharedState(nextState).catch(() => { lastSharedSnapshot.current = ''; });
    }, 180);
    return () => clearTimeout(syncTimer);
  }, [canScore, evenSidePlayerIndexes, gameBreak, gameDurations, gameScores, gameStartedAt, games, isShared, matchStartedAt, onSyncSharedState, paused, pointEvent, rallyLog, scorerMessage, scores, server, serviceNumber, servingPlayerIndex]);


  useEffect(() => {
    const updateClock = () => {
      const now = Date.now();
      setElapsed(Math.max(0, Math.floor((now - matchStartedAt) / 1000)));
      if (!gameBreak) setGameElapsed(Math.max(0, Math.floor((now - gameStartedAt) / 1000)));
    };
    updateClock();
    const timer = setInterval(updateClock, 250);
    return () => clearInterval(timer);
  }, [gameBreak, gameStartedAt, matchStartedAt]);

  const gamesNeeded = Math.ceil(match.bestOf / 2);
  const scoringLocked = paused || pointPause || Boolean(gameBreak) || !canScore;

  const openScorerHandoff = () => {
    if (!isHost || !onHandoffScorer) return;
    const members = sharedSession.nearby_live_match_members || [];
    Alert.alert(
      'Change match scorer',
      'Scoring controls will move to the selected signed-in player’s device.',
      [
        ...members.map((member) => ({
          text: `${member.profiles?.display_name || (member.user_id === currentUserId ? 'You' : 'Player')}${member.user_id === sharedSession.scorer_id ? ' · Current' : ''}`,
          onPress: member.user_id === sharedSession.scorer_id ? undefined : () => onHandoffScorer(member.user_id),
        })),
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const finish = async (finalState, reason = 'completed') => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const endedAtTimestamp = finalState.endedAtTimestamp ?? Date.now();
    const finalElapsed = finalState.elapsed ?? Math.max(0, Math.floor((endedAtTimestamp - matchStartedAt) / 1000));
    const finalGameElapsed = finalState.gameElapsed ?? Math.max(0, Math.floor((endedAtTimestamp - gameStartedAt) / 1000));
    const savedDraftId = await draft.settle();
    onFinish({ ...match, ...(savedDraftId ? { savedMatchId: savedDraftId } : {}), scoringMethod, ...finalState, rallyLog: finalState.rallyLog || rallyLog, gameDurations: finalState.gameDurations || gameDurations, gameElapsed: finalGameElapsed, elapsed: finalElapsed, matchStartedAt, endedAtTimestamp, reason, focusReturns });
  };

  const runPointCelebration = (announcement, onComplete) => {
    const event = { ...announcement, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` };
    appliedPointEventId.current = event.id;
    setPointEvent(event);
    playPointAnnouncement(event, onComplete);
  };

  const captureScoringSnapshot = () => ({
    scores: [...scores],
    games: [...games],
    gameScores: gameScores.map((item) => [...item]),
    gameDurations: [...gameDurations],
    gameElapsed,
    gameBreak,
    rallyLog: rallyLog.map((item) => ({ ...item, score: [...item.score] })),
    server,
    servingPlayerIndex,
    serviceNumber,
    evenSidePlayerIndexes: [...evenSidePlayerIndexes],
  });

  const recordRally = (team) => {
    if (paused || pointPause || finishedRef.current) return;
    setHistory((items) => [...items, captureScoringSnapshot()]);
    bounceBall();

    const rallyState = resolveRallyState({
      matchType: match.matchType,
      scores,
      server,
      servingPlayerIndex,
      serviceNumber,
      evenSidePlayerIndexes,
    }, team);

    if (team !== server) {
      const newServer = rallyState.server;
      const newPlayerIndex = rallyState.servingPlayerIndex;
      const newServiceNumber = rallyState.serviceNumber;

      setServer(newServer);
      setServingPlayerIndex(newPlayerIndex);
      setServiceNumber(newServiceNumber);
      const nextPlayer = match.players[newServer][newPlayerIndex];
      const nextTeam = teamName(match.players[newServer]);
      const nextRallyLog = [...rallyLog, {
        id: `rally-${Date.now().toString(36)}-${rallyLog.length + 1}`,
        number: rallyLog.length + 1,
        game: gameScores.length + 1,
        team,
        winner: teamName(match.players[team]),
        action: rallyState.action,
        score: [...scores],
        nextServe: `${nextPlayer} serving · Server ${newServiceNumber}`,
      }];
      setRallyLog(nextRallyLog);
      setScorerMessage(`${teamName(match.players[team])} won the rally · ${nextPlayer} serves next`);
      runPointCelebration({ player: teamName(match.players[team]), team: 'wins the rally', action: rallyState.action.toUpperCase(), score: `${scores[0]} – ${scores[1]}`, nextServe: `${nextPlayer} serves for ${nextTeam}` });
      return;
    }

    const nextScores = rallyState.scores;
    const lead = nextScores[team] - nextScores[1 - team];
    const wonGame = nextScores[team] >= match.target && lead >= (match.winByTwo ? 2 : 1);
    setScores(nextScores);
    
    const announcementPlayer = match.players[team][servingPlayerIndex];
    const announcement = { player: announcementPlayer, team: teamName(match.players[team]), action: 'SCORES!', score: `${nextScores[0]} – ${nextScores[1]}` };
    const nextRallyLog = [...rallyLog, {
      id: `rally-${Date.now().toString(36)}-${rallyLog.length + 1}`,
      number: rallyLog.length + 1,
      game: gameScores.length + 1,
      team,
      winner: teamName(match.players[team]),
      action: wonGame ? 'Game won' : 'Point',
      score: [...nextScores],
      nextServe: wonGame ? 'Game complete' : `${announcementPlayer} serving · Server ${serviceNumber}`,
    }];
    setRallyLog(nextRallyLog);

    if (!wonGame) {
      setScorerMessage(`Point to ${teamName(match.players[team])} · ${nextScores[0]}–${nextScores[1]}`);
      runPointCelebration(announcement);
      return;
    }

    const nextGames = [...games];
    nextGames[team] += 1;
    const nextGameScores = [...gameScores, nextScores];
    const gameEndedAt = Date.now();
    const completedGameElapsed = Math.max(0, Math.floor((gameEndedAt - gameStartedAt) / 1000));
    const completedMatchElapsed = Math.max(0, Math.floor((gameEndedAt - matchStartedAt) / 1000));
    const nextGameDurations = [...gameDurations, completedGameElapsed];
    setGames(nextGames);
    setGameScores(nextGameScores);
    setGameDurations(nextGameDurations);
    setScorerMessage(`Game to ${teamName(match.players[team])} · ${nextScores[0]}–${nextScores[1]}`);

    if (nextGames[team] >= gamesNeeded) {
      runPointCelebration(announcement, () => {
        setPaused(true);
        finish({ scores: nextScores, games: nextGames, gameScores: nextGameScores, gameDurations: nextGameDurations, gameElapsed: completedGameElapsed, elapsed: completedMatchElapsed, endedAtTimestamp: gameEndedAt, rallyLog: nextRallyLog, winner: team });
      });
    } else {
      runPointCelebration(announcement, () => {
        const nextTeam = 1 - team;
        const nextServiceNumber = match.matchType === 'doubles' ? 2 : 1;
        const nextPlayer = match.players[nextTeam][0];
        setGameBreak({
          id: `break-${Date.now().toString(36)}`,
          completedGame: nextGameScores.length,
          nextGame: nextGameScores.length + 1,
          durationSeconds: 20,
          startedAt: Date.now(),
          score: [...nextScores],
          nextServer: nextTeam,
          nextPlayerIndex: 0,
          nextServiceNumber,
          nextPlayer,
        });
        setScorerMessage(`Game ${nextGameScores.length} complete · Water break before Game ${nextGameScores.length + 1}`);
      });
    }
  };

  const recordRallyRef = useRef(recordRally);
  recordRallyRef.current = recordRally;
  useEffect(() => {
    if (!DEMO_MODE) return undefined;
    let rallies = 0;
    const teamSequence = [0, 0, 1, 0, 1, 1, 0, 1];
    const timer = setInterval(() => {
      if (rallies >= teamSequence.length) { clearInterval(timer); return; }
      recordRallyRef.current(teamSequence[rallies]);
      rallies += 1;
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  const continueAfterBreak = () => {
    if (!canScore || !gameBreak) return;
    setScores([0, 0]);
    setServer(gameBreak.nextServer);
    setServingPlayerIndex(gameBreak.nextPlayerIndex);
    setServiceNumber(gameBreak.nextServiceNumber);
    setEvenSidePlayerIndexes([0, 0]);
    setGameStartedAt(Date.now());
    setGameElapsed(0);
    setGameBreak(null);
    setScorerMessage(`Game ${gameBreak.nextGame} started · ${gameBreak.nextPlayer} serves first`);
    bounceBall(2);
  };

  const applyServeCorrection = (team, playerIndex, requestedServiceNumber = 1, source = 'Manual') => {
    if (scoringLocked || finishedRef.current) return false;
    const player = match.players?.[team]?.[playerIndex];
    if (!player) return false;
    const nextServiceNumber = match.matchType === 'doubles' && requestedServiceNumber === 2 ? 2 : 1;
    setHistory((items) => [...items, captureScoringSnapshot()]);
    setServer(team);
    setServingPlayerIndex(playerIndex);
    setServiceNumber(nextServiceNumber);
    setEvenSidePlayerIndexes((current) => current.map((value, index) => (
      index === team
        ? evenSidePlayerFromCurrentServer(scores[team], playerIndex, match.matchType)
        : value
    )));
    setScorerMessage(`${source}: ${player} serving · Server ${nextServiceNumber} · ${scores[0]}–${scores[1]}`);
    bounceBall(2);
    return true;
  };

  const applyScoreCorrection = (nextScores, requestedServiceNumber, transcript) => {
    if (scoringLocked || finishedRef.current) return false;
    if (!Array.isArray(nextScores) || nextScores.some((score) => !Number.isInteger(score) || score < 0)) return false;
    const nextServiceNumber = match.matchType === 'doubles' && requestedServiceNumber === 2 ? 2 : 1;
    setHistory((items) => [...items, captureScoringSnapshot()]);
    setScores([...nextScores]);
    setServiceNumber(nextServiceNumber);
    const nextPlayer = match.players[server][servingPlayerIndex];
    setScorerMessage(`Voice score confirmed · ${nextScores[0]}–${nextScores[1]} · ${nextPlayer} serving · Server ${nextServiceNumber}`);
    setShoutFeedback({ accepted: true, message: `Applied “${transcript}”` });
    bounceBall(2);
    return true;
  };

  const handleVoiceTranscript = (transcripts, primaryTranscript, metadata) => {
    for (const transcript of transcripts) {
      const command = parseVoiceMatchCommand(transcript, match.players, server);
      if (!command) continue;

      if (command.type === 'rally') {
        setShoutFeedback({ accepted: true, message: `Applied “${transcript}”` });
        recordRally(command.team);
        return true;
      }

      if (command.type === 'serve') {
        const playerIndex = command.playerExplicit
          ? command.servingPlayerIndex
          : playerForSideOut(
            scores[command.server],
            evenSidePlayerIndexes[command.server],
            match.matchType,
          );
        const applied = applyServeCorrection(
          command.server,
          playerIndex,
          command.serviceNumber,
          'Voice command',
        );
        if (applied) setShoutFeedback({ accepted: true, message: `Applied “${transcript}”` });
        return applied;
      }

      if (command.type === 'score') {
        return applyScoreCorrection(command.scores, command.serviceNumber, transcript);
      }
    }

    if (metadata?.pending) return false;
    const reason = metadata?.reason === 'low-confidence'
      ? 'Recognition was uncertain. Please repeat the full command.'
      : 'Not applied. Say “point,” “serving,” or start with “score.”';
    setShoutFeedback({ accepted: false, message: reason });
    setScorerMessage(`Heard “${primaryTranscript}” · No score or serve change applied`);
    return true;
  };

  const shoutScoringActive = scoringMethod === 'shout' && !scoringLocked;
  const {
    listening: shoutListening,
    lastHeard: shoutLastHeard,
    unavailable: shoutUnavailable,
    errorMessage: shoutErrorMessage,
  } = useShoutScoring({
    active: shoutScoringActive,
    players: match.players,
    onTranscript: handleVoiceTranscript,
    strictConfidence: false,
    minimumAudibleVolume: null,
    fragmentBufferMs: 1600,
  });

  useEffect(() => {
    if (scoringMethod === 'shout' && shoutUnavailable) {
      Alert.alert('Voice scoring unavailable', `${shoutErrorMessage}\n\nSwitching to manual scoring.`);
      changeScoringMethod('manual');
    }
  }, [scoringMethod, shoutUnavailable, shoutErrorMessage]);

  const undo = () => {
    if (!history.length || paused || pointPause || finishedRef.current) return;
    const previous = history[history.length - 1];
    setScores(previous.scores);
    setGames(previous.games);
    setGameScores(previous.gameScores);
    setGameDurations(previous.gameDurations);
    setGameElapsed(previous.gameElapsed);
    setGameStartedAt(Date.now() - (previous.gameElapsed * 1000));
    setGameBreak(previous.gameBreak);
    setRallyLog(previous.rallyLog);
    setServer(previous.server);
    setServingPlayerIndex(previous.servingPlayerIndex);
    setServiceNumber(previous.serviceNumber);
    setEvenSidePlayerIndexes(previous.evenSidePlayerIndexes || configuredEvenSidePlayerIndexes);
    setHistory((items) => items.slice(0, -1));
    setScorerMessage(`Last rally removed · ${previous.scores[0]}–${previous.scores[1]}`);
    bounceBall();
  };

  const endEarly = () => {
    const winner = games[0] !== games[1] ? (games[0] > games[1] ? 0 : 1) : scores[0] !== scores[1] ? (scores[0] > scores[1] ? 0 : 1) : null;
    setShowEnd(false);
    const endedAtTimestamp = Date.now();
    finish({ scores, games, gameScores: [...gameScores, scores], elapsed: Math.max(0, Math.floor((endedAtTimestamp - matchStartedAt) / 1000)), gameElapsed: Math.max(0, Math.floor((endedAtTimestamp - gameStartedAt) / 1000)), endedAtTimestamp, winner }, 'ended');
  };

  const saveUnfinished = () => {
    setShowEnd(false);
    finish({ scores, games, gameScores, server, servingPlayerIndex, serviceNumber, evenSidePlayerIndexes, winner: null }, 'unfinished');
  };

  const openManualServeCorrection = () => {
    if (scoringLocked) return;
    Alert.alert(
      'Correct serving team',
      'Choose the team that should be serving. You’ll select the player and server number next.',
      [
        { text: `Team 1 · ${teamName(match.players[0])}`, onPress: () => setManualServeTeam(0) },
        { text: `Team 2 · ${teamName(match.players[1])}`, onPress: () => setManualServeTeam(1) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.liveContent} showsVerticalScrollIndicator={false}>
      <View style={styles.liveHero}>
        {draft.status ? <Text accessibilityRole="status" style={{ paddingHorizontal: 20, paddingVertical: 6, fontSize: 12, color: ['local', 'failed'].includes(draft.status) ? '#FFB097' : '#D6E94A' }}>{draft.status === 'saved' ? 'Score synced to your account' : draft.status === 'saving' ? 'Saving score…' : draft.status === 'local' ? 'Score saved on this browser · reconnect to sync' : 'Score not saved · keep this page open and reconnect'}</Text> : null}
      <View style={styles.liveHeader}>
          <Pressable accessibilityLabel="Cancel match" onPress={() => setShowEnd(true)} style={styles.heroIconButton}><Icon name="close" color={C.surface} /></Pressable>
          <View style={styles.liveHeaderCopy}><Text style={styles.liveEyebrow}>{match.access.toUpperCase()} · {match.mode.toUpperCase()} · GAME {gameScores.length + 1}</Text><Text numberOfLines={1} style={styles.liveTitle}>{match.court.name}</Text></View>
          <View style={styles.timerChip}><Icon name={paused ? 'pause' : 'time-outline'} size={14} color={C.surface} /><Text style={styles.timerText}>{formatTime(elapsed)}</Text></View>
        </View>
        <KitchenLine dark />
        <View style={styles.matchMeta}>
          <Text style={styles.matchMetaText}>FIRST TO {match.target}</Text><View style={styles.metaDot} /><Text style={styles.matchMetaText}>{match.winByTwo ? 'WIN BY 2' : 'SUDDEN FINISH'}</Text><View style={styles.metaDot} /><Text style={styles.matchMetaText}>{match.bestOf === 1 ? '1 GAME' : 'BEST OF 3'}</Text>
        </View>
      </View>

      {!canScore && <View style={styles.scorerWatchBanner}><Icon name="eye-outline" color={C.teal} /><View style={styles.flex}><Text style={styles.scorerWatchTitle}>Watching live score</Text><Text style={styles.scorerWatchText}>{liveMatch.scorer} has the scoring controls. Score changes and rally announcements appear here automatically.</Text></View></View>}
      {paused && <View style={styles.pausedBanner}><Icon name="pause-circle" color={C.teal} /><Text style={styles.pausedText}>Match paused — scoring is locked.</Text></View>}

      <View {...webLayout('live-grid')}>
      <View>
      <LiveCourt match={liveMatch} ballBounce={ballBounce} rallyTravel={rallyTravel} scorerMessage={scorerMessage} paused={paused} breakActive={Boolean(gameBreak)} scores={scores} server={server} servingPlayerIndex={servingPlayerIndex} serviceNumber={serviceNumber} celebration={celebration} pointAnnouncement={pointAnnouncement} canScore={canScore} isHost={isHost} onChangeScorer={openScorerHandoff} />

      {gameBreak ? <GameBreakCard gameBreak={gameBreak} canScore={canScore} onContinue={continueAfterBreak} /> : null}

      <FocusTracker challenge={match.focusChallenge} returns={focusReturns} paused={scoringLocked} onRecord={(deep) => setFocusReturns((items) => items.length < match.focusChallenge.attempts ? [...items, deep] : items)} onUndo={() => setFocusReturns((items) => items.slice(0, -1))} />

      </View>
      <View>
      {canScore && !gameBreak && <>
        <View style={styles.liveScoringMethod}>
          <View style={styles.liveScoringMethodCopy}>
            <Text style={styles.liveScoringMethodLabel}>SCORING METHOD</Text>
            <Text numberOfLines={2} style={styles.liveScoringMethodMeta}>
              {scoringMethod === 'voice'
                ? 'Score and next server are announced aloud'
                : scoringMethod === 'shout'
                  ? (shoutListening ? (shoutLastHeard ? 'Heard: "' + shoutLastHeard + '"' : 'Listening for a complete command…') : 'Starting the microphone…')
                  : 'Quiet one-tap courtside controls'}
            </Text>
          </View>
          <View accessibilityRole="radiogroup" style={styles.liveScoringMethodSwitch}>
            {[{ value: 'manual', label: 'Manual', icon: 'hand-left-outline' }, { value: 'voice', label: 'Voice', icon: 'volume-high-outline' }, { value: 'shout', label: 'Mic', icon: 'mic-outline' }].filter((option) => NATIVE_VOICE_SCORING_ENABLED || option.value !== 'shout').map((option) => {
              const active = scoringMethod === option.value;
              return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => changeScoringMethod(option.value)} style={[styles.liveScoringMethodOption, active && styles.liveScoringMethodOptionActive]}><Icon name={active && option.value === 'shout' && shoutListening ? 'mic' : option.icon} size={13} color={active ? '#0E2321' : C.ink40} /><Text style={[styles.liveScoringMethodText, active && styles.liveScoringMethodTextActive]}>{option.label}</Text></Pressable>;
            })}
          </View>
        </View>
        {scoringMethod === 'shout' && shoutFeedback ? (
          <View accessibilityLiveRegion="polite" style={[styles.shoutFeedback, shoutFeedback.accepted ? styles.shoutFeedbackAccepted : styles.shoutFeedbackRejected]}>
            <Icon name={shoutFeedback.accepted ? 'checkmark-circle' : 'alert-circle'} size={15} color={shoutFeedback.accepted ? C.teal : C.brick} />
            <Text numberOfLines={2} style={styles.shoutFeedbackText}>{shoutFeedback.message}</Text>
          </View>
        ) : null}
        <View style={styles.scorerActions}>
          <View style={styles.scorerActionHead}>
            <View>
              <Text style={styles.eyebrow}>WHO WON THE RALLY?</Text>
              <Text style={styles.scorerActionTitle}>{scoringMethod === 'shout' ? 'Say a safe command, or tap to score' : 'One tap updates score and serve'}</Text>
              <Text style={styles.scorerActionMeta}>{match.players[server][servingPlayerIndex]} serving · Server {serviceNumber}</Text>
              {Platform.OS === 'web' ? <Text accessibilityLiveRegion="polite" style={{ color: C.ink, fontSize: 28, fontWeight: '900', marginTop: 6 }}>{scores[0]} – {scores[1]}</Text> : null}
            </View>
            <View style={[styles.teamBadge, server === 1 && styles.teamBadgeAway]}><Text style={styles.teamBadgeText}>T{server + 1}</Text></View>
          </View>
          <View style={styles.rallyWinnerButtons}>
            {[0, 1].map((team) => <Pressable key={team} accessibilityLabel={teamName(match.players[team]) + ' won the rally'} disabled={scoringLocked} onPress={() => recordRally(team)} style={({ pressed }) => [styles.rallyWinnerButton, team === 1 && styles.rallyWinnerButtonAway, scoringLocked && styles.pointDisabled, pressed && !scoringLocked && styles.pressed]}><Text style={styles.rallyWinnerTag}>TEAM {team + 1}</Text><Text numberOfLines={2} style={styles.rallyWinnerName}>{teamName(match.players[team])}</Text><Text style={styles.rallyWinnerAction}>WON RALLY</Text></Pressable>)}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Correct serving player and server number" onPress={openManualServeCorrection} style={({ pressed }) => [styles.correctServerButton, pressed && styles.pressed]}><Icon name="swap-horizontal-outline" size={14} color={C.teal} /><Text style={styles.correctServerText}>Correct serving player or server number</Text></Pressable>
          <Text style={styles.autoServeHint}><Icon name={scoringMethod === 'voice' ? 'volume-high-outline' : scoringMethod === 'shout' ? 'mic-outline' : 'flash-outline'} size={11} color={C.teal} /> {scoringMethod === 'voice' ? 'Voice announcements are on' : scoringMethod === 'shout' ? 'Say “Point team one,” “[player] serving,” or “Score two one two”' : 'Serving rotation updates automatically'}</Text>
        </View>

      <View style={styles.controls}>
        <Pressable accessibilityLabel="Undo last point" disabled={!history.length || scoringLocked} onPress={undo} style={({ pressed }) => [styles.controlButton, (!history.length || scoringLocked) && styles.controlDisabled, pressed && styles.pressed]}><Icon name="arrow-undo-outline" color={!history.length || scoringLocked ? C.ink40 : C.teal} /><Text style={[styles.controlText, (!history.length || scoringLocked) && styles.controlTextDisabled]}>Undo</Text></Pressable>
        <Pressable accessibilityLabel={paused ? 'Resume match' : 'Pause match'} disabled={pointPause || !canScore} onPress={() => setPaused((value) => !value)} style={({ pressed }) => [styles.controlButton, styles.pauseButton, (pointPause || !canScore) && styles.controlDisabled, pressed && !pointPause && canScore && styles.pressed]}><Icon name={paused ? 'play' : 'pause'} color="#0E2321" /><Text style={styles.pauseText}>{paused ? 'Resume' : 'Pause'}</Text></Pressable>
      </View>
      </>}

      </View>
      </View>
      <MatchBoxScore match={match} games={games} scores={scores} gameScores={gameScores} elapsed={elapsed} gameElapsed={gameElapsed} gameDurations={gameDurations} gameBreak={gameBreak} />
      <RallyBoxScore rallies={rallyLog} />

      {(canScore || isHost) && <Pressable onPress={() => setShowEnd(true)} style={({ pressed }) => [styles.endLink, pressed && styles.pressed]}><Icon name="flag-outline" size={17} color={C.brick} /><Text style={styles.endLinkText}>End match early</Text></Pressable>}
      <ConfirmEndModal visible={showEnd} onCancel={() => setShowEnd(false)} onConfirm={endEarly} onSaveUnfinished={saveUnfinished} />
      <ServerSelectionModal visible={manualServeTeam !== null} teamName={manualServeTeam !== null ? teamName(match.players[manualServeTeam]) : ''} players={manualServeTeam !== null ? match.players[manualServeTeam] : []} onCancel={() => setManualServeTeam(null)} onSelect={(playerIndex, selectedServiceNumber) => { applyServeCorrection(manualServeTeam, playerIndex, selectedServiceNumber, 'Manual correction'); setManualServeTeam(null); }} />
    </ScrollView>
  );
}

function ResultScreen({ result, saveState = 'saved', saveError = '', onRetrySave, onRematch, onNewMatch }) {
  const storyCardRef = useRef(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const winnerName = result.winner === null ? null : teamName(result.players[result.winner]);
  const completeScores = result.gameScores.length ? result.gameScores : [result.scores];
  const totalPoints = completeScores.reduce((total, game) => total + game[0] + game[1], 0);
  const matchDate = new Date(result.endedAtTimestamp || Date.now());
  const matchDateLabel = matchDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  const matchTimeLabel = matchDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toUpperCase();
  const formatLabel = `${result.matchType === 'singles' ? 'SINGLES' : 'DOUBLES'} · ${result.mode === 'ranked' ? 'RANKED' : 'CASUAL'}`;
  const focusSuccesses = result.focusReturns?.filter(Boolean).length || 0;
  const focusComplete = result.focusChallenge && result.focusReturns?.length >= result.focusChallenge.attempts;
  const focusAchieved = focusComplete && focusSuccesses >= result.focusChallenge.target;

  const makeMatchPhoto = async (action) => {
    if (!storyCardRef.current || exporting) return;
    setActionsOpen(false);
    setExporting(true);
    try {
      if (Platform.OS === 'web') { await exportWebMatchCard(result, action); return; }
      const uri = await captureRef(storyCardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      if (action === 'save') {
        if (Platform.OS === 'android') {
          if (Number(Platform.Version) <= 28) {
            await Sharing.shareAsync(uri, { dialogTitle: 'Save your Peakle match card', mimeType: 'image/png' });
          } else {
            await MediaLibrary.saveToLibraryAsync(uri);
            Alert.alert('Saved to photos', 'Your match card is ready for My Day or Stories.');
          }
        } else {
          const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
          if (!permission.granted) {
            Alert.alert('Photo access needed', 'Allow Peakle to add the match card to your photos, then try again.');
            return;
          }
          await MediaLibrary.createAssetAsync(uri);
          Alert.alert('Saved to photos', 'Your match card is ready for My Day or Stories.');
        }
        return;
      }
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', 'Save the card to Photos, then share it from your gallery.');
        return;
      }
      await Sharing.shareAsync(uri, { dialogTitle: 'Share your Peakle match', mimeType: 'image/png', UTI: 'public.png' });
    } catch (error) {
      Alert.alert('Couldn’t create match photo', error.message || 'Please try again in a moment.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.content, styles.resultContent]} showsVerticalScrollIndicator={false}>
      <View style={styles.resultTopBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to match setup" onPress={onNewMatch} style={({ pressed }) => [styles.resultTopButton, pressed && styles.pressed]}>
          <Icon name="arrow-back" size={20} color={C.ink} />
        </Pressable>
        <View style={styles.resultTopCopy}><Text style={styles.resultTopEyebrow}>MATCH CENTER</Text><Text style={styles.resultTopTitle}>Final result</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="More result actions" accessibilityState={{ expanded: actionsOpen }} onPress={() => setActionsOpen(true)} style={({ pressed }) => [styles.resultTopButton, pressed && styles.pressed]}>
          {exporting ? <ActivityIndicator size="small" color={C.teal} /> : <Icon name="ellipsis-horizontal" size={22} color={C.ink} />}
        </Pressable>
      </View>

      <View ref={storyCardRef} collapsable={false} style={styles.resultPoster}>
        <View style={styles.posterGlow} />
        <View style={styles.posterBrandRow}>
          <View style={styles.posterBrand}><Image source={BALL_IMAGE} style={{ width: 24, height: 24, tintColor: C.optic }} resizeMode="contain" /><Text style={styles.posterBrandText}>PEAKLE</Text></View>
          <View style={styles.posterFinalPill}><View style={styles.posterFinalDot} /><Text style={styles.posterFinalText}>FINAL</Text></View>
        </View>
        <Text style={styles.posterMeta}>{formatLabel}</Text>
        <Text numberOfLines={2} style={styles.posterHeadline}>{winnerName ? `Victory for ${winnerName}` : 'Match ends level'}</Text>
        <View style={styles.posterVenueRow}><Icon name="location" size={13} color={C.optic} /><Text numberOfLines={1} style={styles.posterVenue}>{result.court.name}</Text></View>

        <View style={styles.posterScoreboard}>
          <View style={styles.posterScoreHead}><Text style={[styles.posterScoreLabel, styles.posterTeamLabel]}>TEAM</Text>{completeScores.map((_, index) => <Text key={`poster-head-${index}`} style={styles.posterScoreLabel}>G{index + 1}</Text>)}<View style={styles.posterMatchBadge}><Text style={styles.posterMatchBadgeText}>W</Text></View></View>
          {[0, 1].map((team) => (
            <View key={`poster-team-${team}`} style={[styles.posterTeamRow, team === 1 && styles.posterTeamRowBorder]}>
              <View style={[styles.posterTeamMark, team === 1 && styles.posterTeamMarkAway]}><Text style={styles.posterTeamMarkText}>T{team + 1}</Text></View>
              <View style={styles.posterTeamNameWrap}><Text numberOfLines={2} style={styles.posterTeamName}>{teamName(result.players[team])}</Text>{result.winner === team ? <Text style={styles.posterWinnerTag}>MATCH WINNER</Text> : null}</View>
              {completeScores.map((game, index) => <Text key={`poster-score-${team}-${index}`} style={[styles.posterGameScore, game[team] > game[1 - team] && styles.posterGameScoreWon]}>{game[team]}</Text>)}
              <Text style={[styles.posterMatchScore, result.winner === team && styles.posterMatchScoreWon]}>{result.games[team]}</Text>
            </View>
          ))}
        </View>

        <View style={styles.posterFooter}>
          <View><Text style={styles.posterFooterLabel}>PLAYED</Text><Text style={styles.posterFooterValue}>{matchDateLabel} · {matchTimeLabel}</Text></View>
          <View style={styles.posterDuration}><Text style={styles.posterFooterLabel}>DURATION</Text><Text style={styles.posterFooterValue}>{formatTime(result.elapsed)}</Text></View>
        </View>
      </View>

      <View style={styles.resultSectionHead}><View><Text style={styles.resultSectionEyebrow}>MATCH DETAILS</Text><Text style={styles.resultSectionTitle}>Performance summary</Text></View><Text style={styles.resultSectionMeta}>{completeScores.length} {completeScores.length === 1 ? 'game' : 'games'}</Text></View>
      <View style={styles.resultStats}>
        <View style={styles.resultStat}><View style={styles.resultStatIcon}><Icon name="time-outline" size={18} color={C.teal} /></View><Text style={styles.resultStatValue}>{formatTime(result.elapsed)}</Text><Text style={styles.resultStatLabel}>DURATION</Text></View>
        <View style={styles.resultStat}><View style={styles.resultStatIcon}><Icon name="tennisball-outline" size={18} color={C.teal} /></View><Text style={styles.resultStatValue}>{totalPoints}</Text><Text style={styles.resultStatLabel}>TOTAL POINTS</Text></View>
        <View style={[styles.resultStat, styles.resultStatLast]}><View style={styles.resultStatIcon}><Icon name="pulse-outline" size={18} color={C.teal} /></View><Text style={styles.resultStatValue}>{result.rallyLog?.length || 0}</Text><Text style={styles.resultStatLabel}>RALLIES LOGGED</Text></View>
      </View>

      {result.focusChallenge && (
        <View style={[styles.focusResultCard, focusAchieved && styles.focusResultAchieved]}>
          <View style={styles.focusResultIcon}><Icon name={focusAchieved ? 'checkmark' : 'locate'} size={21} /></View>
          <View style={styles.flex}><Text style={styles.focusTrackerEyebrow}>{focusAchieved ? 'FOCUS GOAL ACHIEVED' : focusComplete ? 'FOCUS GOAL RESULT' : 'FOCUS GOAL INCOMPLETE'}</Text><Text style={styles.focusResultTitle}>{focusSuccesses} of {result.focusReturns.length} returns landed past mid-court</Text><Text style={styles.focusResultMeta}>{focusAchieved ? 'Great depth. Keep this target for your next match.' : focusComplete ? `Target: ${result.focusChallenge.target} of ${result.focusChallenge.attempts}.` : `Record all ${result.focusChallenge.attempts} returns next time to complete the challenge.`}</Text></View>
        </View>
      )}

      {saveState === 'saving' ? <View accessibilityRole="status" style={styles.resultSaveStatus}><ActivityIndicator color={C.teal} /><View style={styles.flex}><Text style={styles.resultDetailsTitle}>Recording match…</Text><Text style={styles.resultDetailsMeta}>Keep Peakle open while the score is saved.</Text></View></View> : saveState === 'failed' ? <Pressable accessibilityRole="button" accessibilityLabel="Retry recording match" onPress={onRetrySave} style={({ pressed }) => [styles.resultSaveStatus, styles.resultSaveFailed, pressed && styles.pressed]}><View style={styles.resultSaveIcon}><Icon name="refresh" size={17} color={C.brick} /></View><View style={styles.flex}><Text style={styles.resultDetailsTitle}>Match not recorded</Text><Text numberOfLines={2} style={styles.resultDetailsMeta}>{saveError || 'Check your connection, then retry.'}</Text></View><Text style={styles.resultRetryText}>RETRY</Text></Pressable> : <View accessibilityRole="status" style={styles.resultSaveStatus}><View style={styles.resultSaveIcon}><Icon name={saveState === 'remote' ? 'cloud-upload-outline' : 'checkmark'} size={17} color={C.teal} /></View><View style={styles.flex}><Text style={styles.resultDetailsTitle}>{saveState === 'remote' ? 'Shared match completed' : 'Match recorded'}</Text><Text style={styles.resultDetailsMeta}>{saveState === 'remote' ? 'The scorer is syncing the result for every player.' : 'Saved to every registered participant’s match history.'}</Text></View></View>}

      <View style={styles.resultActions}>
        {onRematch ? <Pressable disabled={saveState === 'saving'} onPress={onRematch} style={({ pressed }) => [styles.resultPrimaryAction, saveState === 'saving' && styles.disabled, pressed && saveState !== 'saving' && styles.pressed]}><Icon name="refresh" color="#0E2321" /><Text style={styles.resultPrimaryActionText}>Play a rematch</Text></Pressable> : null}
        <Pressable disabled={saveState === 'saving'} onPress={onNewMatch} style={({ pressed }) => [styles.resultSecondaryAction, saveState === 'saving' && styles.disabled, pressed && saveState !== 'saving' && styles.pressed]}><Text style={styles.resultSecondaryActionText}>New match</Text><Icon name="arrow-forward" size={17} color={C.teal} /></Pressable>
      </View>

      <Modal visible={actionsOpen} transparent animationType="fade" onRequestClose={() => setActionsOpen(false)}>
        <Pressable {...webDialog('backdrop')} accessibilityLabel="Close result actions" style={styles.resultActionsBackdrop} onPress={() => setActionsOpen(false)}>
          <Pressable {...webDialog('surface')} accessibilityRole="menu" style={styles.resultActionsSheet} onPress={(event) => event.stopPropagation()}>
            <View {...webDialog('handle')} style={styles.resultActionsHandle} />
            <View style={styles.resultActionsHeader}><View><Text style={styles.resultSectionEyebrow}>MATCH PHOTO</Text><Text style={styles.resultActionsTitle}>Share your final</Text></View><Pressable accessibilityLabel="Close" onPress={() => setActionsOpen(false)} style={styles.resultActionsClose}><Icon name="close" size={19} color={C.ink} /></Pressable></View>
            <Text style={styles.resultActionsLead}>The score card is formatted as a clean portrait image for My Day, Stories, or your gallery.</Text>
            <Pressable accessibilityRole="menuitem" accessibilityLabel="Save match card to photos" onPress={() => makeMatchPhoto('save')} style={({ pressed }) => [styles.resultActionRow, pressed && styles.pressed]}><View style={styles.resultActionIcon}><Icon name="download-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.resultActionTitle}>Save to photos</Text><Text style={styles.resultActionMeta}>Keep a high-quality PNG in your gallery</Text></View><Icon name="chevron-forward" size={17} color={C.ink40} /></Pressable>
            <Pressable accessibilityRole="menuitem" accessibilityLabel="Share match card" onPress={() => makeMatchPhoto('share')} style={({ pressed }) => [styles.resultActionRow, pressed && styles.pressed]}><View style={styles.resultActionIcon}><Icon name="share-social-outline" color={C.teal} /></View><View style={styles.flex}><Text style={styles.resultActionTitle}>Share match card</Text><Text style={styles.resultActionMeta}>Post to My Day, Stories, or send to friends</Text></View><Icon name="chevron-forward" size={17} color={C.ink40} /></Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

export default function PlayScreen({ route, navigation }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { user } = useAuth();
  const nearbyPresence = useNearbyPlayersContext();
  const [courts, setCourts] = useState([]);
  const [courtsLoading, setCourtsLoading] = useState(true);
  const [courtsError, setCourtsError] = useState('');
  const [screen, setScreen] = useState('choice');
  const [match, setMatch] = useState(null);
  const [result, setResult] = useState(null);
  const [resultSaveState, setResultSaveState] = useState('idle');
  const [resultSaveError, setResultSaveError] = useState('');
  const [focusChallenge, setFocusChallenge] = useState(null);
  const [openPlayMode, setOpenPlayMode] = useState(null);
  const [unfinishedMatch, setUnfinishedMatch] = useState(null);
  const [showSetupBackToChoices, setShowSetupBackToChoices] = useState(true);
  const handledStartToken = useRef(null);
  const handledFocusToken = useRef(null);
  const handledNearbyToken = useRef(null);
  const handledOpenPlayToken = useRef(null);
  const handledJoinedMatchToken = useRef(null);
  const handledRemovedInviteId = useRef(null);
  const handledSharedCompletion = useRef(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leavingMatch, setLeavingMatch] = useState(false);
  const [leaveError, setLeaveError] = useState('');

  useEffect(() => {
    const removedInvite = nearbyPresence.removedInvite;
    if (!removedInvite?.id || handledRemovedInviteId.current === removedInvite.id || screen !== 'setup') return;
    handledRemovedInviteId.current = removedInvite.id;
    setLeaveDialogOpen(false);
    setMatch(null);
    setResult(null);
    setScreen('choice');
    Alert.alert(
      'Removed from match',
      `${removedInvite.sender?.display_name || 'The host'} removed you from the lineup. You can join again only if they send a new invite.`,
    );
  }, [nearbyPresence.removedInvite?.id, screen]);

  const confirmLeaveJoinedMatch = useCallback(() => {
    const invite = nearbyPresence.joinedInvite;
    if (!invite?.id || leaveDialogOpen) return;
    setLeaveError('');
    setLeaveDialogOpen(true);
  }, [leaveDialogOpen, nearbyPresence.joinedInvite?.id]);

  const cancelLeaveJoinedMatch = useCallback(() => {
    if (leavingMatch) return;
    setLeaveDialogOpen(false);
    setLeaveError('');
  }, [leavingMatch]);

  const leaveJoinedMatch = useCallback(async () => {
    const inviteId = nearbyPresence.joinedInvite?.id;
    if (!inviteId || leavingMatch) return;
    setLeavingMatch(true);
    setLeaveError('');
    const left = await nearbyPresence.leave(inviteId);
    setLeavingMatch(false);
    if (left) {
      setLeaveDialogOpen(false);
      navigation.navigate('Home');
      return;
    }
    setLeaveError('Couldn’t leave the match. Check your connection and try again.');
  }, [leavingMatch, navigation, nearbyPresence.joinedInvite?.id, nearbyPresence.leave]);

  useEffect(() => {
    if (!nearbyPresence.joinedInvite?.id) return undefined;
    const hardwareBack = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused()) return false;
      confirmLeaveJoinedMatch();
      return true;
    });
    const preventRemove = navigation.addListener('beforeRemove', (event) => {
      if (!nearbyPresence.joinedInvite?.id) return;
      event.preventDefault();
      confirmLeaveJoinedMatch();
    });
    return () => {
      hardwareBack.remove();
      preventRemove();
    };
  }, [confirmLeaveJoinedMatch, navigation, nearbyPresence.joinedInvite?.id]);

  const refreshCourtBookings = useCallback(async () => {
    setCourtsLoading(true);
    setCourtsError('');
    try {
      setCourts(playableCourtsFromBookings(await listMyBookings()));
    } catch (error) {
      setCourts([]);
      setCourtsError(error.message || 'Check your connection and try again.');
    } finally {
      setCourtsLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => {
    refreshCourtBookings();
  }, [refreshCourtBookings]));

  useEffect(() => {
    loadUnfinishedMatch().then(setUnfinishedMatch).catch((error) => console.warn('Unfinished match load failed:', error.message));
  }, [user?.id]);

  const verifyActiveCourtBooking = useCallback(async (selectedCourt) => {
    if (!selectedCourt?.bookingId) return false;
    const bookings = await listMyBookings();
    const booking = bookings.find((item) => item.id === selectedCourt.bookingId && item.court_id === selectedCourt.id);
    const now = Date.now();
    return Boolean(booking && booking.status === 'confirmed' && new Date(booking.starts_at).getTime() <= now && now < new Date(booking.ends_at).getTime());
  }, [user?.id]);

  const openCourtBooking = useCallback(() => {
    navigation.navigate('Book', { findCourtsToken: Date.now(), returnToPlay: true });
  }, [navigation]);

  const showCourtBookingRequired = useCallback((message = 'Book and confirm a court for the current time before starting this match.') => {
    Alert.alert('Active court booking required', message, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Book a court', onPress: openCourtBooking },
    ]);
  }, [openCourtBooking]);

  const startMatch = async (configuration) => {
    try {
      if (!await verifyActiveCourtBooking(configuration.court)) {
        showCourtBookingRequired('The selected reservation is not active yet, has expired, or was cancelled. Choose an active booking before continuing.');
        await refreshCourtBookings();
        return;
      }
    } catch (error) {
      showCourtBookingRequired(error.message || 'Peakle could not verify this reservation.');
      return;
    }
    setMatch(Platform.OS === 'web' ? { ...configuration, clientMatchId: configuration.clientMatchId || globalThis.crypto.randomUUID() } : configuration);
    setResult(null);
    setResultSaveState('idle');
    setResultSaveError('');
    setScreen('pregame');
  };

  const startLiveMatch = async (serveDraw) => {
    try {
      if (!await verifyActiveCourtBooking(match?.court)) {
        showCourtBookingRequired('Your court reservation is no longer active. Return to setup or book another court.');
        return;
      }
    } catch (error) {
      showCourtBookingRequired(error.message || 'Peakle could not verify this reservation.');
      return;
    }
    handledSharedCompletion.current = null;
    const nextMatch = { ...match, firstServer: serveDraw.team, firstServerPlayer: serveDraw.player };
    const hasConnectedPlayers = (nextMatch.registeredPlayers || []).some((player) => player.id && player.id !== user?.id);
    if (hasConnectedPlayers) {
      try {
        const startedAt = Date.now();
        const initialState = {
          scores: [0, 0],
          games: [0, 0],
          gameScores: [],
          gameDurations: [],
          gameBreak: null,
          matchStartedAt: startedAt,
          gameStartedAt: startedAt,
          server: serveDraw.team,
          servingPlayerIndex: Math.max(0, nextMatch.players[serveDraw.team].indexOf(serveDraw.player)),
          serviceNumber: nextMatch.matchType === 'doubles' ? 2 : 1,
          paused: false,
        };
        const session = await nearbyPresence.startSharedMatch({
          setupId: nextMatch.setupId,
          configuration: nextMatch,
          initialState,
          scorerId: nextMatch.scorerId || user?.id,
        });
        nextMatch.sharedLiveMatchId = session.id;
        nextMatch.sharedState = session.state;
      } catch (error) {
        Alert.alert('Couldn’t start connected scoring', error.message || 'Check your connection and try again.');
        return;
      }
    }
    setMatch(nextMatch);
    setScreen('live');
  };

  useEffect(() => {
    const session = nearbyPresence.sharedLiveMatch;
    if (!session?.id || session.host_id === user?.id || !session.configuration || !session.state) return;
    const scorerMember = session.nearby_live_match_members?.find((member) => member.user_id === session.scorer_id);
    setMatch({
      ...session.configuration,
      scorerId: session.scorer_id,
      scorer: scorerMember?.profiles?.display_name || session.configuration.scorer,
      sharedLiveMatchId: session.id,
      sharedState: session.state,
    });
    if (session.status === 'live' || session.status === 'paused') setScreen('live');
  }, [nearbyPresence.sharedLiveMatch?.id, nearbyPresence.sharedLiveMatch?.revision, user?.id]);

  const syncSharedScore = useCallback(async (state, status = null) => {
    const session = nearbyPresence.sharedLiveMatch;
    if (!session?.id) return null;
    return nearbyPresence.syncSharedMatch(session.id, session.revision, state, status);
  }, [nearbyPresence.sharedLiveMatch?.id, nearbyPresence.sharedLiveMatch?.revision, nearbyPresence.syncSharedMatch]);

  const handoffSharedScorer = useCallback(async (scorerId) => {
    const session = nearbyPresence.sharedLiveMatch;
    if (!session?.id) return;
    try {
      await nearbyPresence.handoffSharedScorer(session.id, scorerId);
    } catch (error) {
      Alert.alert('Couldn’t change scorer', error.message || 'Check your connection and try again.');
    }
  }, [nearbyPresence.handoffSharedScorer, nearbyPresence.sharedLiveMatch?.id]);

  const recordCompletedResult = async (completedResult) => {
    if (!user?.id || completedResult.reason === 'unfinished') return completedResult;
    setResultSaveState('saving');
    setResultSaveError('');
    try {
      const savedMatch = await saveCompletedMatch(user.id, completedResult, user.name);
      const recordedResult = { ...completedResult, savedMatchId: savedMatch.id };
      setResult(recordedResult);
      setUnfinishedMatch(null);
      setResultSaveState('saved');
      return recordedResult;
    } catch (error) {
      const message = error.message || 'The result could not be recorded. Check your connection and retry.';
      setResultSaveState('failed');
      setResultSaveError(message);
      return null;
    }
  };

  const finishMatch = async (finishedResult) => {
    const sharedSession = nearbyPresence.sharedLiveMatch;
    if (sharedSession?.id && handledSharedCompletion.current !== sharedSession.id) {
      handledSharedCompletion.current = sharedSession.id;
      try {
        const terminalStatus = finishedResult.reason === 'completed' ? 'completed' : 'ended';
        const closeSession = (session) => nearbyPresence.syncSharedMatch(
          session.id,
          session.revision,
          { ...(session.state || {}), finalResult: finishedResult },
          terminalStatus,
        );
        try {
          await closeSession(sharedSession);
        } catch (firstError) {
          const latestSession = await nearbyPresence.refreshLiveMatch(sharedSession.id);
          if (!latestSession) throw firstError;
          if (!['completed', 'ended'].includes(latestSession.status)) await closeSession(latestSession);
        }
      } catch (error) {
        handledSharedCompletion.current = null;
        Alert.alert('Couldn’t close connected match', `${error.message || 'Refresh the live score and try again.'}\n\nThe match is still open; no result was lost.`);
        return;
      }
    }
    if (finishedResult.reason === 'unfinished') {
      setUnfinishedMatch(finishedResult);
      setMatch(null);
      setResult(null);
      setShowSetupBackToChoices(true);
      setScreen('setup');
      try {
        const saved = await saveUnfinishedMatch(user.id, finishedResult, user.name);
        setUnfinishedMatch(saved);
      } catch (error) {
        Alert.alert('Saved on this device only', error.message || 'The unfinished score could not be synced, but it remains available until you leave this session.');
      }
      return;
    }
    setResult(finishedResult);
    setScreen('result');
    await recordCompletedResult(finishedResult);
  };

  useEffect(() => {
    const session = nearbyPresence.sharedLiveMatch;
    const finalResult = session?.state?.finalResult;
    if (!session?.id || !['completed', 'ended'].includes(session.status) || !finalResult || handledSharedCompletion.current === session.id) return;
    handledSharedCompletion.current = session.id;
    setResult(finalResult);
    setScreen('result');
    // The scorer records one canonical match. Registered participants receive
    // access through match_participants; watcher devices must not create copies.
    if (finalResult.reason !== 'unfinished' && session.scorer_id === user?.id) {
      recordCompletedResult(finalResult);
    } else {
      setResultSaveState(finalResult.reason === 'unfinished' ? 'idle' : 'remote');
    }
    setResultSaveError('');
  }, [nearbyPresence.sharedLiveMatch?.id, nearbyPresence.sharedLiveMatch?.revision, nearbyPresence.sharedLiveMatch?.status, user?.id, user?.name]);

  const resumeMatch = () => {
    if (!unfinishedMatch) return;
    if (unfinishedMatch.resultPendingSave) {
      setResult(unfinishedMatch);
      setScreen('result');
      void recordCompletedResult(unfinishedMatch);
      return;
    }
    setMatch(unfinishedMatch);
    setResult(null);
    setScreen('live');
  };

  const reset = () => {
    setMatch(null);
    setResult(null);
    setResultSaveState('idle');
    setResultSaveError('');
    setFocusChallenge(null);
    setShowSetupBackToChoices(true);
    setScreen('setup');
    setOpenPlayMode(null);
  };

  const showPlayChoices = () => {
    setMatch(null);
    setResult(null);
    setFocusChallenge(null);
    setOpenPlayMode(null);
    setShowSetupBackToChoices(true);
    setScreen('choice');
  };

  useEffect(() => {
    const token = route?.params?.focusChallengeToken;
    if (!token || handledFocusToken.current === token) return;
    handledFocusToken.current = token;
    setFocusChallenge(route.params.focusChallenge);
    setMatch(null);
    setResult(null);
    setShowSetupBackToChoices(true);
    setScreen('setup');
    setOpenPlayMode(null);
  }, [route?.params?.focusChallengeToken, route?.params?.focusChallenge]);

  useEffect(() => {
    const token = route?.params?.startLiveToken;
    if (!token || handledStartToken.current === token) return;
    handledStartToken.current = token;
    setMatch(null);
    setResult(null);
    setShowSetupBackToChoices(false);
    setScreen('setup');
    setOpenPlayMode(null);
  }, [route?.params?.startLiveToken]);

  useEffect(() => {
    const token = route?.params?.joinedMatchToken;
    if (!token || handledJoinedMatchToken.current === token) return;
    handledJoinedMatchToken.current = token;
    setMatch(null);
    setResult(null);
    setFocusChallenge(null);
    setShowSetupBackToChoices(false);
    setScreen('setup');
    setOpenPlayMode(null);
  }, [route?.params?.joinedMatchToken]);

  useEffect(() => {
    const token = route?.params?.nearbyPlayersToken;
    if (!token || handledNearbyToken.current === token) return;
    handledNearbyToken.current = token;
    setMatch(null);
    setResult(null);
    setShowSetupBackToChoices(true);
    setScreen('setup');
    setOpenPlayMode(null);
  }, [route?.params?.nearbyPlayersToken]);

  const handledDemoLiveToken = useRef(null);
  useEffect(() => {
    if (!DEMO_MODE) return;
    const token = route?.params?.demoLiveToken;
    if (!token || handledDemoLiveToken.current === token) return;
    handledDemoLiveToken.current = token;
    setResult(null);
    setMatch(DEMO_LIVE_MATCH);
    setScreen('live');
  }, [route?.params?.demoLiveToken]);

  useEffect(() => {
    const openPlayCode = route?.params?.openPlayCode;
    if (!openPlayCode) return;
    setOpenPlayMode('join');
  }, [route?.params?.openPlayCode]);

  useEffect(() => {
    const token = route?.params?.openPlayToken;
    if (!token || handledOpenPlayToken.current === token) return;
    handledOpenPlayToken.current = token;
    setMatch(null);
    setResult(null);
    setFocusChallenge(null);
    setScreen('choice');
    setOpenPlayMode('join');
  }, [route?.params?.openPlayToken]);

  const leaveOpenPlay = () => {
    setOpenPlayMode(null);
    const returnTo = route?.params?.openPlayReturnTo;
    if (returnTo) navigation.navigate(returnTo);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={screen === 'live' || isDark ? 'light' : 'dark'} backgroundColor={screen === 'live' ? '#0E2321' : C.paper} />
      {openPlayMode === 'join' ? <PlayerOpenPlayScreen initialCode={route?.params?.openPlayCode || ''} initialSessionId={route?.params?.openPlaySessionId || null} navigationToken={route?.params?.openPlayToken || null} onBack={leaveOpenPlay} onDetailBack={route?.params?.openPlayDirect ? leaveOpenPlay : null} onOpenChat={(session) => navigation.navigate('CommunityChat', { eventKind: 'open_play', eventId: session.id, title: session.name, ownerTab: 'Play' })} /> : <>
      {screen === 'choice' && <PlayChoiceScreen onFindPlay={() => navigation.navigate('Pickleball', { openTab: 'Find play', ownerTab: 'Play' })} onSetupMatch={() => { setShowSetupBackToChoices(true); setScreen('setup'); }} unfinishedMatch={unfinishedMatch} onResume={resumeMatch} />}
      {screen === 'setup' && <SetupScreen courts={courts} courtsLoading={courtsLoading} courtsError={courtsError} onRefreshCourts={refreshCourtBookings} onBookCourt={openCourtBooking} nearbyPlayers={nearbyPresence.players} nearbyPresence={nearbyPresence} currentUserName={user?.name} currentUserId={user?.id} currentUserAvatar={user?.picture} onStart={startMatch} focusChallenge={focusChallenge} onBackToChoices={showPlayChoices} showBackToChoices={showSetupBackToChoices} onFindPlay={() => navigation.navigate('Pickleball', { openTab: 'Find play', ownerTab: 'Play' })} onMessagePlayer={(player) => navigation.navigate('DirectChat', { player: { id: player.id, name: player.name, avatar: player.avatar || null, area: player.area || null }, ownerTab: 'Play' })} onLeaveJoined={confirmLeaveJoinedMatch} unfinishedMatch={unfinishedMatch} onResume={resumeMatch} openNearbyPlayersToken={route?.params?.nearbyPlayersToken} />}
      {screen === 'pregame' && match && <PreGameScreen match={match} onBack={() => setScreen('setup')} onStart={startLiveMatch} />}
      {screen === 'live' && match && <LiveMatch key={DEMO_MODE ? `demo-${route?.params?.demoLiveToken || 0}` : 'live'} match={match} sharedSession={match.sharedLiveMatchId ? nearbyPresence.sharedLiveMatch : null} currentUserId={user?.id} onSyncSharedState={syncSharedScore} onHandoffScorer={handoffSharedScorer} onFinish={finishMatch} />}
      {screen === 'result' && result && <ResultScreen result={result} saveState={resultSaveState === 'idle' ? 'saved' : resultSaveState} saveError={resultSaveError} onRetrySave={() => recordCompletedResult(result)} onRematch={!match?.sharedLiveMatchId || nearbyPresence.sharedLiveMatch?.host_id === user?.id ? () => startMatch(match) : null} onNewMatch={reset} />}
      </>}
      <LeaveMatchDialog
        visible={leaveDialogOpen}
        hostName={nearbyPresence.joinedInvite?.sender?.display_name}
        busy={leavingMatch}
        error={leaveError}
        onCancel={cancelLeaveJoinedMatch}
        onConfirm={leaveJoinedMatch}
      />
    </SafeAreaView>
  );
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: .09, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } }, android: { elevation: 4 } });

const lightStyles = createMobileStyleSheet({
  safe: { flex: 1, backgroundColor: C.paper },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 126 },
  playChoiceContent: { paddingBottom: 126 },
  choiceHelpBadge: { minHeight: 34, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 17, backgroundColor: '#E5F0ED' },
  choiceHelpBadgeText: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .65 },
  choiceIntro: { marginTop: -2, marginBottom: 16 },
  choiceIntroTitle: { color: C.ink, fontSize: 16, lineHeight: 21, fontWeight: '900' },
  choiceIntroText: { maxWidth: 350, marginTop: 4, color: C.ink40, fontSize: 10, lineHeight: 15 },
  playChoices: { gap: 11 },
  playChoiceCard: { minHeight: 216, padding: 17, borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, overflow: 'hidden', ...shadow },
  playChoiceCardPrimary: { backgroundColor: C.ink },
  playChoiceCardSecondary: { minHeight: 204, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  playChoiceTop: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playChoiceIconPrimary: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: C.optic },
  playChoiceIconSecondary: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#E5F0ED' },
  playChoiceRecommended: { minHeight: 27, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: C.optic },
  playChoiceRecommendedText: { color: C.ink, fontSize: 6, fontWeight: '900', letterSpacing: .55 },
  playChoiceArrow: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: C.paper },
  playChoiceEyebrowPrimary: { marginTop: 16, color: C.optic, fontSize: 7, fontWeight: '900', letterSpacing: .8 },
  playChoiceEyebrowSecondary: { marginTop: 16, color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .8 },
  playChoiceTitlePrimary: { marginTop: 3, color: C.surface, fontSize: 24, lineHeight: 30, fontWeight: '900', letterSpacing: -.5 },
  playChoiceTitleSecondary: { marginTop: 3, color: C.ink, fontSize: 22, lineHeight: 28, fontWeight: '900', letterSpacing: -.4 },
  playChoiceTextPrimary: { maxWidth: 330, marginTop: 5, color: '#CBD7D2', fontSize: 9, lineHeight: 14 },
  playChoiceTextSecondary: { maxWidth: 330, marginTop: 5, color: C.ink40, fontSize: 9, lineHeight: 14 },
  playChoiceActionPrimary: { alignSelf: 'flex-start', minHeight: 37, marginTop: 14, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: C.optic },
  playChoiceActionPrimaryText: { color: C.ink, fontSize: 9, fontWeight: '900' },
  playChoiceActionSecondary: { alignSelf: 'flex-start', minHeight: 36, marginTop: 13, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 11, backgroundColor: '#E5F0ED' },
  playChoiceActionSecondaryText: { color: C.teal, fontSize: 9, fontWeight: '900' },
  choiceResumeCard: { marginTop: 13, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: '#B9D22C', backgroundColor: '#FAFCEB' },
  choiceTip: { marginTop: 14, paddingHorizontal: 5, flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  choiceTipText: { flex: 1, color: C.ink40, fontSize: 9, lineHeight: 14 },
  choiceTipStrong: { color: C.ink, fontWeight: '900' },
  resumeCard: { marginTop: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: '#B9D22C', backgroundColor: '#FAFCEB' }, resumeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, resumeEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, resumeTitle: { marginTop: 2, color: C.ink, fontSize: 10, fontWeight: '900' }, resumeMeta: { marginTop: 2, color: C.ink40, fontSize: 7, lineHeight: 11 }, resumeButton: { minHeight: 34, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, backgroundColor: C.teal }, resumeButtonText: { color: C.surface, fontSize: 8, fontWeight: '900' },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, headerCopy: { flex: 1, minWidth: 0 }, headerBack: { width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  eyebrow: { color: C.ink40, fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: .9 }, h1: { color: C.ink, fontSize: 22, lineHeight: 27, fontWeight: '900', letterSpacing: -.45 },
  playHeaderAvatar: { marginLeft: 10 },
  playHeaderBall: { width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.optic }, playHeaderBallImage: { width: 26, height: 26 },
  kitchen: { height: 7, marginTop: 18, marginBottom: 20 }, headerLine: { marginTop: 10, marginBottom: 16 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 }, solidLight: { backgroundColor: 'rgba(255,255,255,.78)' }, dashedLight: { borderColor: 'rgba(255,255,255,.38)' },
  liveChip: { minHeight: 34, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 18, backgroundColor: '#E5F0ED' }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.teal }, liveChipText: { color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .7 }, joinedChip: { minHeight: 34, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 18, backgroundColor: C.optic }, joinedChipText: { color: '#0E2321', fontSize: 8, fontWeight: '900', letterSpacing: .7 },
  invitesCard: { marginBottom: 12, padding: 13, borderRadius: 17, borderWidth: 1, borderColor: '#B9D22C', backgroundColor: '#FAFCEB' }, invitesTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, inviteBell: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, invitesEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, invitesTitle: { marginTop: 2, color: C.ink, fontSize: 11, fontWeight: '900' }, inviteRequest: { minHeight: 52, marginTop: 9, paddingTop: 9, flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: 1, borderColor: '#DFE8AD' }, inviteRequestCopy: { flex: 1, minWidth: 0 }, inviteSender: { color: C.ink, fontSize: 10, fontWeight: '900' }, inviteDetail: { marginTop: 2, color: C.ink40, fontSize: 7, lineHeight: 10 }, declineInvite: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E8C7BF', backgroundColor: C.surface }, acceptInvite: { minWidth: 62, height: 34, paddingHorizontal: 9, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: C.optic }, acceptInviteText: { color: C.ink, fontSize: 8, fontWeight: '900' },
  introCard: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.optic }, introIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(255,255,255,.48)' }, introCopy: { flex: 1 }, introTitle: { color: C.ink, fontSize: 14, fontWeight: '800' }, bodySmall: { marginTop: 3, color: C.ink40, fontSize: 10, lineHeight: 15 },
  matchmakingEntry: { minHeight: 78, marginBottom: 8, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, matchmakingEntryIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' },
  otherPlaySection: { marginTop: 28, paddingTop: 20, borderTopWidth: 1, borderColor: C.line }, otherPlayEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, otherPlayTitle: { marginTop: 3, color: C.ink, fontSize: 16, fontWeight: '900' }, otherPlayActions: { marginTop: 11, flexDirection: 'row', gap: 9 }, otherPlayAction: { position: 'relative', flex: 1, minHeight: 132, padding: 12, paddingRight: 28, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, otherPlayIcon: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.optic }, otherPlayIconMuted: { backgroundColor: '#E5F0ED' }, otherPlayActionTitle: { marginTop: 10, color: C.ink, fontSize: 10, lineHeight: 14, fontWeight: '900' }, otherPlayActionMeta: { marginTop: 3, color: C.ink40, fontSize: 7, lineHeight: 10 }, otherPlayArrow: { position: 'absolute', top: 14, right: 11 },
  focusSetupCard: { minHeight: 82, marginTop: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: '#B9D22C', backgroundColor: '#F9FCEB' }, focusSetupIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, focusSetupCopy: { flex: 1 }, focusSetupEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, focusSetupTitle: { marginTop: 3, color: C.ink, fontSize: 10, lineHeight: 14, fontWeight: '800' }, focusSetupMeta: { marginTop: 3, color: C.ink40, fontSize: 7 },
  setupGuide: { marginTop: 12, padding: 15, borderRadius: 19, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, setupGuideHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, setupGuideEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, setupGuideTitle: { marginTop: 2, color: C.ink, fontSize: 16, fontWeight: '900' }, setupProgressBadge: { minWidth: 48, minHeight: 30, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: C.optic }, setupProgressBadgeReady: { borderWidth: 1, borderColor: C.teal, backgroundColor: C.optic }, setupProgressText: { color: '#0E2321', fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: .2, fontVariant: ['tabular-nums'] }, setupSteps: { marginTop: 15, flexDirection: 'row', alignItems: 'flex-start' }, setupStep: { width: 52, alignItems: 'center' }, setupStepIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, setupStepIconDone: { borderColor: C.optic, backgroundColor: C.optic }, setupStepIconActive: { borderWidth: 2, borderColor: C.teal, backgroundColor: C.optic }, setupStepText: { marginTop: 5, color: C.ink40, fontSize: 7, fontWeight: '800' }, setupStepTextDone: { color: C.ink }, setupStepTextActive: { color: C.teal, fontWeight: '900' }, setupStepLine: { flex: 1, height: 2, marginTop: 16, backgroundColor: C.line }, setupStepLineDone: { backgroundColor: C.optic }, setupGuideMessage: { marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderColor: C.line, color: C.ink40, fontSize: 9, lineHeight: 14 }, setupGuideMessageReady: { color: C.teal, fontWeight: '800' }, formPart: { paddingBottom: 2 },
  preGameContent: { flexGrow: 1 }, drawHero: { padding: 22, alignItems: 'center', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: C.ink }, drawHeroIcon: { width: 66, height: 66, marginBottom: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 33, borderWidth: 6, borderColor: 'rgba(255,255,255,.16)', backgroundColor: C.optic }, drawEyebrow: { color: '#9FB3AC', fontSize: 8, fontWeight: '900', letterSpacing: 1 }, drawTitle: { marginTop: 4, color: C.surface, fontSize: 24, lineHeight: 30, fontWeight: '900', textAlign: 'center' }, drawLead: { maxWidth: 300, marginTop: 6, color: '#CBD7D2', fontSize: 10, lineHeight: 15, textAlign: 'center' }, drawTeams: { marginTop: 13, flexDirection: 'row', alignItems: 'stretch', gap: 10 }, drawTeam: { flex: 1, minHeight: 218, padding: 13, alignItems: 'center', borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, drawTeamAway: { backgroundColor: '#FFFDFC' }, drawTeamWinner: { borderWidth: 2, borderColor: C.optic, backgroundColor: '#FAFCEB' }, drawTeamBadge: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.teal }, drawTeamBadgeAway: { backgroundColor: C.brick }, drawTeamBadgeText: { color: C.surface, fontSize: 9, fontWeight: '900' }, drawTeamName: { minHeight: 38, marginTop: 9, color: C.ink, fontSize: 11, lineHeight: 15, fontWeight: '900', textAlign: 'center' }, serverChoices: { width: '100%', marginTop: 5, marginBottom: 12, gap: 6 }, serverChoice: { minHeight: 34, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, serverChoiceSelected: { borderColor: '#B9D22C', backgroundColor: C.optic }, serverChoiceText: { flex: 1, color: C.ink70, fontSize: 7, fontWeight: '800' }, serverChoiceTextSelected: { color: '#0E2321', fontWeight: '900' }, drawServeStatus: { minHeight: 29, marginTop: 'auto', paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 15, backgroundColor: C.paper }, drawServeStatusActive: { backgroundColor: C.optic }, drawServeStatusText: { color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, drawServeStatusTextActive: { color: '#0E2321' }, preGameSummary: { marginTop: 13, paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, preGameSummaryRow: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: C.line }, preGameSummaryLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, preGameSummaryValue: { marginTop: 2, color: C.ink, fontSize: 11, fontWeight: '900' }, preGameBack: { alignSelf: 'center', minHeight: 44, marginTop: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 }, preGameBackText: { color: C.ink40, fontSize: 9, fontWeight: '700' },
  quickStartButton: { minHeight: 60, marginTop: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, backgroundColor: C.ink }, quickStartIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: C.optic }, quickStartCopy: { flex: 1, minWidth: 0 }, quickStartTitle: { color: C.surface, fontSize: 11, fontWeight: '900' }, quickStartMeta: { marginTop: 3, color: 'rgba(255,255,255,.58)', fontSize: 7 },
  fieldGroup: { marginTop: 22 }, sectionLabel: { marginBottom: 8, color: C.ink, fontSize: 10, fontWeight: '800', letterSpacing: .9 }, sectionHeadingRow: { marginBottom: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, sectionHelper: { marginTop: -5, color: C.ink40, fontSize: 8, lineHeight: 12 }, rosterCount: { minWidth: 38, minHeight: 27, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: C.paper }, rosterCountReady: { backgroundColor: C.optic }, rosterCountText: { color: C.ink, fontSize: 8, fontWeight: '900' },
  playerSourceHelp: { marginTop: 9, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, playerSourceHelpIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, playerSourceHelpTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, playerSourceHelpText: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 },
  segment: { padding: 4, flexDirection: 'row', gap: 4, borderRadius: 14, backgroundColor: C.surface }, segmentItem: { flex: 1, minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10 }, segmentActive: { backgroundColor: C.optic, ...shadow }, segmentText: { color: C.ink40, fontSize: 11, fontWeight: '700' }, segmentTextActive: { color: C.ink, fontWeight: '800' },
  nearbyCard: { marginTop: 14, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, nearbyHead: { paddingBottom: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, nearbySubtitle: { marginTop: -4, color: C.ink40, fontSize: 9, lineHeight: 13 }, visibilityButton: { minWidth: 80, minHeight: 34, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 17, backgroundColor: C.paper }, visibilityButtonOn: { backgroundColor: C.optic }, visibilityDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.ink40 }, visibilityDotOn: { backgroundColor: '#0E2321' }, visibilityText: { color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .45 }, visibilityTextOn: { color: '#0E2321' }, playerSearch: { minHeight: 44, marginBottom: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: C.line, borderRadius: 12, backgroundColor: C.surface }, playerSearchInput: { minWidth: 0, flex: 1, paddingVertical: 10, color: C.ink, fontSize: 11, fontWeight: '700' }, nearbyCountRow: { paddingVertical: 5, borderTopWidth: 1, borderColor: C.line }, nearbyCount: { alignSelf: 'flex-start', paddingHorizontal: 7, minHeight: 23, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, backgroundColor: '#E5F0ED' }, nearbyCountText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .4 }, nearbyError: { marginBottom: 6, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11, backgroundColor: '#F9ECE8' }, nearbyErrorText: { flex: 1, color: C.brick, fontSize: 8, lineHeight: 12 }, nearbyEmpty: { paddingVertical: 15, alignItems: 'center', borderTopWidth: 1, borderColor: C.line }, nearbyEmptyTitle: { marginTop: 5, color: C.ink, fontSize: 10, fontWeight: '900' }, nearbyEmptyText: { maxWidth: 250, marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12, textAlign: 'center' }, nearbyPlayer: { minHeight: 61, flexDirection: 'row', alignItems: 'center', gap: 7 }, nearbyPlayerBorder: { borderTopWidth: 1, borderColor: C.line }, nearbyAvatar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 }, nearbyAvatarText: { color: C.surface, fontSize: 9, fontWeight: '900' }, nearbyCopy: { flex: 1 }, nearbyName: { color: C.ink, fontSize: 11, fontWeight: '800' }, nearbyMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, nearbyMessageButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, inviteButton: { minWidth: 58, minHeight: 32, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 10, backgroundColor: C.optic }, inviteButtonAdded: { borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' }, inviteButtonRemove: { width: 34, minWidth: 34, height: 34, minHeight: 34, paddingHorizontal: 0, borderWidth: 1, borderColor: '#E8C7BF', borderRadius: 11, backgroundColor: '#FFF5F2' }, inviteButtonDisabled: { backgroundColor: C.paper }, inviteButtonText: { color: '#0E2321', fontSize: 8, fontWeight: '900' }, inviteButtonTextAdded: { color: C.teal }, inviteButtonTextDisabled: { color: C.ink40 },
  courtSelect: { minHeight: 70, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: C.teal, backgroundColor: C.surface }, courtSelectChosen: { borderStyle: 'solid', borderColor: C.line }, courtSelectIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' }, courtSelectCopy: { flex: 1 }, courtSelectName: { color: C.ink, fontSize: 12, fontWeight: '800' }, courtSelectDetail: { marginTop: 4, color: C.ink40, fontSize: 8, lineHeight: 12 },
  bookingGateCard: { minHeight: 112, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, bookingGateIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' }, bookingGateTitle: { color: C.ink, fontSize: 12, fontWeight: '900' }, bookingGateText: { marginTop: 4, color: C.ink40, fontSize: 8, lineHeight: 12 }, bookingGateLink: { alignSelf: 'flex-start', marginTop: 7, paddingVertical: 3 }, bookingGateLinkText: { color: C.teal, fontSize: 9, fontWeight: '900' }, bookCourtButton: { alignSelf: 'flex-start', minHeight: 38, marginTop: 10, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11, backgroundColor: C.optic }, bookCourtButtonText: { color: '#0E2321', fontSize: 9, fontWeight: '900' }, bookingVerifiedNote: { marginTop: 9, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }, bookingVerifiedText: { flex: 1, color: C.ink40, fontSize: 8, lineHeight: 12 }, bookAnotherButton: { alignSelf: 'flex-start', minHeight: 36, marginTop: 5, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 5 }, bookAnotherText: { color: C.teal, fontSize: 9, fontWeight: '900' },
  scorerPicker: { marginTop: 9, paddingHorizontal: 11, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, scorerOption: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: C.line }, scorerOptionSelected: { marginHorizontal: -11, paddingHorizontal: 11, borderRadius: 14, borderBottomColor: 'transparent', backgroundColor: '#F4F9F7' }, scorerOptionAvatar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, scorerOptionInitials: { color: C.surface, fontSize: 9, fontWeight: '900' }, scorerOptionCopy: { flex: 1 }, scorerOptionName: { color: C.ink, fontSize: 11, fontWeight: '900' }, scorerOptionMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, scorerHint: { marginTop: 8, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }, scorerHintText: { flex: 1, color: C.ink40, fontSize: 8, lineHeight: 12 }, scorerReady: { paddingHorizontal: 7, minHeight: 25, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 13, backgroundColor: '#E5F0ED' }, scorerReadyText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .4 }, emptyScorerText: { marginTop: 8, color: C.brick, fontSize: 8, lineHeight: 12, textAlign: 'center' },
  teamsGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 8 }, teamSetup: { flex: 1, minWidth: 140, padding: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, teamSetupHead: { marginBottom: 2, flexDirection: 'row', alignItems: 'center', gap: 6 }, teamBar: { width: 18, height: 4, borderRadius: 2, backgroundColor: C.teal }, teamBarAway: { backgroundColor: C.brick }, teamLabel: { color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 }, inlineError: { marginTop: 9, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: '#F7EAE6' }, inlineErrorText: { color: C.brick, fontSize: 8, fontWeight: '800' }, swapSidesButton: { alignSelf: 'center', minHeight: 38, marginTop: 7, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }, swapSidesText: { color: C.teal, fontSize: 9, fontWeight: '800' }, lineupPreview: { marginTop: 22 }, readyPill: { minHeight: 27, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 14, backgroundColor: '#E5F0ED' }, readyPillText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .45 },
  playerInputWrap: { minHeight: 54, marginTop: 7, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: '#E8ECE5', backgroundColor: C.paper }, playerInputWrapEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.teal, backgroundColor: C.surface }, playerNumber: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: C.teal }, playerNumberAway: { backgroundColor: C.brick }, playerNumberText: { color: C.surface, fontSize: 8, fontWeight: '900' }, playerInputCopy: { flex: 1, minWidth: 0 }, playerInput: { minWidth: 0, paddingVertical: 0, color: C.ink, fontSize: 10, fontWeight: '800' }, playerStatus: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 3 }, playerStatusText: { flexShrink: 1, color: C.ink40, fontSize: 5, fontWeight: '800', letterSpacing: .35 }, playerStatusTextEmpty: { color: C.teal },
  advancedToggle: { minHeight: 66, marginTop: 22, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, advancedIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, advancedTitle: { color: C.ink, fontSize: 11, fontWeight: '900' }, advancedMeta: { marginTop: 3, color: C.ink40, fontSize: 7, lineHeight: 11 }, advancedPanel: { marginTop: 2, paddingHorizontal: 12, paddingBottom: 15, borderBottomLeftRadius: 17, borderBottomRightRadius: 17, borderWidth: 1, borderTopWidth: 0, borderColor: C.line, backgroundColor: C.surface },
  settingRow: { marginTop: 22, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, settingIcon: { width: 39, height: 39, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, settingCopy: { flex: 1 }, settingTitle: { color: C.ink, fontSize: 12, fontWeight: '800' }, toggle: { width: 42, height: 24, padding: 3, borderRadius: 12, backgroundColor: C.line }, toggleOn: { backgroundColor: C.optic }, toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: C.surface }, toggleKnobOn: { alignSelf: 'flex-end' },
  rankedNote: { marginTop: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#E5F0ED' }, rankedNoteText: { flex: 1, color: C.teal, fontSize: 9, lineHeight: 14, fontWeight: '700' },
  primaryButton: { minHeight: 54, marginTop: 24, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 15, backgroundColor: C.optic }, primaryText: { flex: 1, color: '#0E2321', fontSize: 13, fontWeight: '900', textAlign: 'center' }, wizardActions: { marginTop: 2, flexDirection: 'row', alignItems: 'flex-end', gap: 8 }, wizardPrimary: { flex: 1 }, wizardBack: { minWidth: 88, minHeight: 54, marginTop: 24, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, wizardBackText: { color: C.teal, fontSize: 10, fontWeight: '900' }, joinedMatchCard: { marginTop: 2, overflow: 'hidden', padding: 16, borderWidth: 1, borderColor: C.line, borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: C.surface, ...shadow }, joinedMatchHead: { flexDirection: 'row', alignItems: 'center', gap: 11 }, joinedHostAvatar: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 16 }, joinedHostInitials: { color: C.surface, fontSize: 11, fontWeight: '900' }, joinedMatchEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, joinedMatchHost: { marginTop: 2, color: C.ink, fontSize: 15, fontWeight: '900' }, joinedMatchLead: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 }, joinedConfirmedBadge: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: C.optic }, joinedMatchDetails: { minHeight: 67, marginTop: 15, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line }, joinedMatchDetail: { minWidth: 0, flex: 1, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }, joinedDetailIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#E5F0ED' }, joinedDetailLabel: { color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .65 }, joinedDetailValue: { marginTop: 2, color: C.ink, fontSize: 9, fontWeight: '900' }, joinedDetailDivider: { width: 1, height: 38, marginHorizontal: 7, backgroundColor: C.line }, joinedRulesRow: { minHeight: 34, paddingTop: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, joinedRulesText: { color: C.ink40, fontSize: 8, fontWeight: '700' }, joinedWaitingCard: { marginTop: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: C.teal, borderRadius: 18, backgroundColor: '#E5F0ED' }, joinedWaitingIcon: { width: 45, height: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: C.optic }, joinedWaitingEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, joinedWaitingTitle: { marginTop: 3, color: C.ink, fontSize: 13, fontWeight: '900' }, joinedWaitingText: { marginTop: 4, color: C.ink40, fontSize: 9, lineHeight: 14 }, leaveJoinedButton: { minWidth: 72, minHeight: 44, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: C.line, borderRadius: 13, backgroundColor: C.surface }, leaveJoinedText: { color: C.brick, fontSize: 10, fontWeight: '900' }, disabled: { opacity: .45 }, validation: { marginTop: 8, color: C.brick, fontSize: 9, textAlign: 'center' }, pressed: { opacity: .78, transform: [{ scale: .985 }] },
  liveContent: { paddingBottom: 42 }, liveHero: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, backgroundColor: C.ink }, liveHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }, heroIconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(255,255,255,.2)' }, liveHeaderCopy: { flex: 1 }, liveEyebrow: { color: 'rgba(255,255,255,.55)', fontSize: 8, fontWeight: '800', letterSpacing: .9 }, liveTitle: { marginTop: 2, color: C.surface, fontSize: 23, fontWeight: '800' }, timerChip: { minHeight: 34, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 17, backgroundColor: 'rgba(255,255,255,.12)' }, timerText: { color: C.surface, fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] }, matchMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, matchMetaText: { color: 'rgba(255,255,255,.62)', fontSize: 7, fontWeight: '800', letterSpacing: .5 }, metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: C.optic },
  scorerWatchBanner: { marginHorizontal: 20, marginTop: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: C.line, borderRadius: 13, backgroundColor: '#E5F0ED' }, scorerWatchTitle: { color: C.teal, fontSize: 10, fontWeight: '900' }, scorerWatchText: { marginTop: 2, color: C.ink40, fontSize: 8, lineHeight: 12 }, pausedBanner: { marginHorizontal: 20, marginTop: 14, padding: 11, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, borderRadius: 11, backgroundColor: '#E5F0ED' }, pausedText: { color: C.teal, fontSize: 10, fontWeight: '800' },
  focusTracker: { marginHorizontal: 20, marginTop: 14, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, focusTrackerAchieved: { borderColor: '#B9D22C', backgroundColor: '#FAFCEB' }, focusTrackerMissed: { borderColor: '#E2B5A9', backgroundColor: '#FFF9F7' }, focusTrackerHead: { flexDirection: 'row', alignItems: 'center', gap: 9 }, focusTrackerIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, focusTrackerCopy: { flex: 1 }, focusTrackerEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, focusTrackerTitle: { marginTop: 3, color: C.ink, fontSize: 10, lineHeight: 14, fontWeight: '800' }, focusTrackerScore: { color: C.ink, fontSize: 21, fontWeight: '900' }, returnDots: { marginTop: 13, flexDirection: 'row', justifyContent: 'space-between', gap: 3 }, returnDot: { flex: 1, aspectRatio: 1, maxWidth: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, returnDotDeep: { borderColor: C.teal, backgroundColor: C.teal }, returnDotShort: { borderColor: '#E2B5A9', backgroundColor: '#F7EAE6' }, returnDotText: { color: C.ink40, fontSize: 7, fontWeight: '900' }, returnDotTextRecorded: { color: C.surface }, returnActions: { marginTop: 13, flexDirection: 'row', gap: 8 }, returnButton: { flex: 1, minHeight: 45, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12 }, returnButtonDeep: { backgroundColor: C.teal }, returnButtonShort: { borderWidth: 1, borderColor: '#E2B5A9', backgroundColor: '#F7EAE6' }, returnButtonText: { color: C.surface, fontSize: 9, fontWeight: '900' }, returnButtonShortText: { color: C.brick, fontSize: 9, fontWeight: '900' }, returnUndo: { alignSelf: 'center', minHeight: 34, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4 }, returnUndoText: { color: C.ink40, fontSize: 8, fontWeight: '700' }, focusTrackerResult: { marginTop: 12, color: C.ink70, fontSize: 9, lineHeight: 14, fontWeight: '700', textAlign: 'center' },
  liveCourtCard: { marginHorizontal: 20, marginTop: 16, overflow: 'hidden', borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, liveCourtHead: { minHeight: 62, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, liveCourtEyebrow: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, liveCourtTitle: { marginTop: 1, color: C.ink, fontSize: 17, fontWeight: '900' }, liveNowPill: { minHeight: 27, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: C.ink }, liveNowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.optic }, liveNowText: { color: C.surface, fontSize: 7, fontWeight: '900', letterSpacing: .6 },
  liveCourt: { height: 220, marginHorizontal: 10, overflow: 'hidden', borderRadius: 15 }, liveCourtBounds: { ...StyleSheet.absoluteFillObject, margin: 13, borderWidth: 2, borderColor: 'rgba(255,255,255,.72)' }, liveCourtCenterTop: { position: 'absolute', top: 13, alignSelf: 'center', width: 2, height: 68, backgroundColor: 'rgba(255,255,255,.55)' }, liveCourtCenterBottom: { position: 'absolute', top: 139, bottom: 13, alignSelf: 'center', width: 2, backgroundColor: 'rgba(255,255,255,.55)' }, liveCourtKitchenTop: { position: 'absolute', top: 80, left: 13, right: 13, height: 2, backgroundColor: 'rgba(255,255,255,.72)' }, liveCourtKitchenBottom: { position: 'absolute', top: 138, left: 13, right: 13, height: 2, backgroundColor: 'rgba(255,255,255,.72)' }, liveCourtNet: { position: 'absolute', zIndex: 2, top: 107, left: 5, right: 5, height: 7, borderTopWidth: 3, borderBottomWidth: 1, borderColor: C.surface, backgroundColor: 'rgba(14,35,33,.42)' },
  liveCourtTeam: { position: 'absolute', zIndex: 3, top: 20, left: 24, right: 24, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }, liveCourtTeamAway: { top: 148 }, liveCourtPlayer: { maxWidth: '46%', alignItems: 'center' }, livePlayerMarker: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, borderWidth: 2, borderColor: C.surface, backgroundColor: C.ink }, livePlayerMarkerAway: { backgroundColor: C.brick }, livePlayerServing: { borderWidth: 4, borderColor: C.optic }, livePlayerInitials: { color: C.surface, fontSize: 8, fontWeight: '900' }, livePlayerName: { maxWidth: 105, marginTop: 3, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden', borderRadius: 7, color: C.surface, backgroundColor: 'rgba(14,35,33,.78)', fontSize: 6, fontWeight: '800' }, courtScoreBar: { position: 'absolute', zIndex: 8, top: 90, alignSelf: 'center', minWidth: 150, height: 40, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 2, borderColor: 'rgba(255,255,255,.35)', backgroundColor: 'rgba(14,35,33,.9)' }, courtScoreTeam: { flexDirection: 'row', alignItems: 'center', gap: 6 }, courtScoreTag: { color: C.optic, fontSize: 7, fontWeight: '900' }, courtScoreTagAway: { color: '#F5A58F' }, courtScoreNumber: { minWidth: 25, color: C.surface, textAlign: 'center', fontSize: 21, fontWeight: '900' }, courtGamePill: { marginHorizontal: 6, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(255,255,255,.1)' }, courtGameText: { color: 'rgba(255,255,255,.62)', fontSize: 5, fontWeight: '900', letterSpacing: .4 }, pointAnnouncement: { position: 'absolute', zIndex: 12, left: 22, right: 22, top: 35, bottom: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: 'rgba(14,35,33,.92)' }, pointAnnouncementPlayer: { color: C.optic, fontSize: 16, fontWeight: '900', textAlign: 'center' }, pointAnnouncementTeam: { maxWidth: '90%', marginTop: 3, color: C.surface, fontSize: 10, fontWeight: '800', textAlign: 'center' }, pointAnnouncementText: { marginTop: 6, color: 'rgba(255,255,255,.58)', fontSize: 8, fontWeight: '900', letterSpacing: 1.2 }, pointAnnouncementScore: { marginTop: 3, color: C.surface, fontSize: 25, fontWeight: '900' }, pointAnnouncementServe: { maxWidth: '92%', marginTop: 5, color: C.optic, textAlign: 'center', fontSize: 8, fontWeight: '800' },
  scorerBooth: { minHeight: 86, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, scorerBoothAvatar: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: C.ink }, scorerBoothInitials: { color: C.surface, fontSize: 11, fontWeight: '900' }, scorerOnline: { position: 'absolute', right: -2, bottom: -2, width: 13, height: 13, borderRadius: 7, borderWidth: 3, borderColor: C.surface, backgroundColor: C.optic }, scorerBoothCopy: { flex: 1, minWidth: 0 }, scorerBoothLabel: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .7 }, scorerBoothName: { marginTop: 2, color: C.ink, fontSize: 11, fontWeight: '900' }, scorerMessage: { marginTop: 3, color: C.ink40, fontSize: 7 }, scorerServing: { marginTop: 3, color: C.teal, fontSize: 7, fontWeight: '800' }, scorerControlBadge: { paddingHorizontal: 7, minHeight: 27, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 9, backgroundColor: '#E5F0ED' }, scorerControlText: { color: C.teal, fontSize: 5, fontWeight: '900', letterSpacing: .4 }, scorerChangeButton: { minHeight: 32, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: C.surface }, scorerChangeText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .4 },
  scoreboard: { marginHorizontal: 20, marginTop: 16, flexDirection: 'row', gap: 10 }, scoreTeam: { flex: 1, minHeight: 310, padding: 13, alignItems: 'center', borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, scoreTeamAway: { backgroundColor: '#FFFDFC' }, scoreTeamWinner: { borderColor: C.optic, borderWidth: 2 }, scoreTeamHead: { width: '100%', minHeight: 58, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, teamBadge: { width: 31, height: 31, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, teamBadgeAway: { backgroundColor: C.brick }, teamBadgeText: { color: C.surface, fontSize: 8, fontWeight: '900' }, scoreNameWrap: { flex: 1 }, scoreName: { color: C.ink, fontSize: 11, lineHeight: 15, fontWeight: '800' }, gamesText: { marginTop: 3, color: C.ink40, fontSize: 8 }, score: { marginTop: 8, color: C.ink, fontSize: 72, lineHeight: 80, fontWeight: '900', letterSpacing: -4, fontVariant: ['tabular-nums'] }, serveRow: { height: 24, flexDirection: 'row', alignItems: 'center', gap: 5 }, serveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.optic }, serveText: { color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .7 }, receiveText: { color: C.ink40, fontSize: 8, fontWeight: '800', letterSpacing: .5 }, pointButton: { width: '100%', minHeight: 55, marginTop: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 14, backgroundColor: C.teal }, pointButtonAway: { backgroundColor: C.brick }, pointDisabled: { opacity: .4 }, pointText: { color: C.surface, fontSize: 10, fontWeight: '900', letterSpacing: .8 },
  scorerActions: { marginHorizontal: 20, marginTop: 14, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, scorerActionHead: { marginBottom: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scorerActionTitle: { color: C.ink, fontSize: 14, fontWeight: '900' }, scorerActionMeta: { marginTop: 3, color: C.teal, fontSize: 8, fontWeight: '800' }, rallyWinnerButtons: { flexDirection: 'row', gap: 8 }, rallyWinnerButton: { minHeight: 82, flex: 1, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.teal }, rallyWinnerButtonAway: { backgroundColor: C.brick }, rallyWinnerTag: { color: 'rgba(255,255,255,.58)', fontSize: 6, fontWeight: '900', letterSpacing: .7 }, rallyWinnerName: { minHeight: 27, marginTop: 3, color: C.surface, textAlign: 'center', fontSize: 9, lineHeight: 13, fontWeight: '900' }, rallyWinnerAction: { marginTop: 3, color: C.surface, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, autoServeHint: { marginTop: 10, color: C.teal, textAlign: 'center', fontSize: 8, fontWeight: '800' }, correctServerButton: { minHeight: 40, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, correctServerText: { color: C.teal, fontSize: 9, fontWeight: '800' }, controls: { marginHorizontal: 20, marginTop: 12, flexDirection: 'row', gap: 8 }, controlButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, pauseButton: { borderColor: C.optic, backgroundColor: C.optic }, controlText: { color: C.teal, fontSize: 8, fontWeight: '800' }, pauseText: { color: C.ink, fontSize: 8, fontWeight: '900' }, controlDisabled: { opacity: .48 }, controlTextDisabled: { color: C.ink40 },
  gamesCard: { marginHorizontal: 20, marginTop: 20, padding: 14, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, gamesHead: { paddingBottom: 11, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: C.line }, gamesTitle: { color: C.ink, fontSize: 17, fontWeight: '800' }, gamesCount: { color: C.teal, fontSize: 22, fontWeight: '900' }, gameRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: C.line }, gameLabel: { color: C.ink40, fontSize: 9, fontWeight: '700' }, gameScore: { color: C.ink, fontSize: 13, fontWeight: '900' }, noGamesText: { paddingVertical: 15, color: C.ink40, fontSize: 9, textAlign: 'center' }, endLink: { alignSelf: 'center', minHeight: 42, marginTop: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 6 }, endLinkText: { color: C.brick, fontSize: 10, fontWeight: '800' },
  gameBreakCard: { marginHorizontal: 20, marginTop: 14, minHeight: 104, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: '#E5F0ED', ...shadow }, gameBreakTimer: { width: 58, height: 66, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: C.ink }, gameBreakTimerValue: { color: C.optic, fontSize: 24, lineHeight: 27, fontWeight: '900', fontVariant: ['tabular-nums'] }, gameBreakTimerUnit: { marginTop: 2, color: 'rgba(255,255,255,.58)', fontSize: 6, fontWeight: '900', letterSpacing: .8 }, gameBreakCopy: { minWidth: 0, flex: 1 }, gameBreakEyebrow: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .55 }, gameBreakTitle: { marginTop: 3, color: C.ink, fontSize: 11, lineHeight: 15, fontWeight: '900' }, gameBreakMeta: { marginTop: 4, color: C.ink40, fontSize: 7, lineHeight: 11 }, gameBreakContinue: { minWidth: 78, minHeight: 46, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 13, backgroundColor: C.optic }, gameBreakContinueText: { color: '#0E2321', fontSize: 7, fontWeight: '900' }, gameBreakWaiting: { width: 66, minHeight: 46, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, gameBreakWaitingText: { color: C.teal, fontSize: 5, fontWeight: '900', letterSpacing: .45 },
  boxScoreCard: { marginHorizontal: 20, marginTop: 12, overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: '#304743', backgroundColor: C.ink }, boxScoreHeader: { minHeight: 44, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: 'rgba(255,255,255,.1)', backgroundColor: '#17302D' }, boxScoreHeaderText: { color: C.surface, fontSize: 9, fontWeight: '900', letterSpacing: .8 }, boxScoreHeaderMeta: { color: '#9FB3AC', fontSize: 6, fontWeight: '900', letterSpacing: .45 }, boxScoreColumns: { minHeight: 28, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: 'rgba(255,255,255,.08)' }, boxScoreColumn: { width: 36, color: '#9FB3AC', textAlign: 'center', fontSize: 5, fontWeight: '900', letterSpacing: .45 }, boxScoreTeamColumn: { minWidth: 0, flex: 1, textAlign: 'left' }, boxScoreTeamRow: { minHeight: 58, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: 'rgba(255,255,255,.08)' }, boxScoreTeamMark: { width: 28, height: 28, marginRight: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: C.teal }, boxScoreTeamMarkAway: { backgroundColor: C.brick }, boxScoreTeamMarkText: { color: C.surface, fontSize: 7, fontWeight: '900' }, boxScoreTeamName: { minWidth: 0, flex: 1, paddingRight: 7, color: C.surface, fontSize: 10, lineHeight: 14, fontWeight: '900' }, boxScoreSetValue: { width: 36, color: C.surface, textAlign: 'center', fontSize: 15, fontWeight: '900' }, boxScoreGameValue: { width: 36, color: '#9FB3AC', textAlign: 'center', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }, boxScoreGameValueLive: { color: C.optic }, boxScoreTimeRow: { minHeight: 46, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }, boxScoreTimeLabel: { minWidth: 0, flex: 1, color: '#9FB3AC', textAlign: 'right', fontSize: 6, fontWeight: '900', letterSpacing: .55 }, boxScoreTimeTotal: { width: 46, color: C.surface, textAlign: 'center', fontSize: 8, fontWeight: '900', fontVariant: ['tabular-nums'] }, boxScoreTimeValue: { width: 36, color: '#9FB3AC', textAlign: 'center', fontSize: 7, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rallyLogCard: { marginHorizontal: 20, marginTop: 12, padding: 14, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, rallyLogHead: { paddingBottom: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottomWidth: 1, borderColor: C.line }, rallyLogTitle: { marginTop: 2, color: C.ink, fontSize: 15, fontWeight: '900' }, rallyLogCount: { minHeight: 26, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' }, rallyLogCountText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .45 }, rallyLogEmpty: { minHeight: 74, alignItems: 'center', justifyContent: 'center', gap: 5 }, rallyLogEmptyText: { color: C.ink40, textAlign: 'center', fontSize: 8, lineHeight: 12 }, rallyLogRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderColor: C.line }, rallyLogNumber: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.teal }, rallyLogNumberAway: { backgroundColor: C.brick }, rallyLogNumberText: { color: C.surface, fontSize: 8, fontWeight: '900' }, rallyLogCopy: { minWidth: 0, flex: 1 }, rallyLogResult: { color: C.ink, fontSize: 9, fontWeight: '900' }, rallyLogServe: { marginTop: 3, color: C.ink40, fontSize: 7 }, rallyLogScore: { alignItems: 'flex-end' }, rallyLogScoreText: { color: C.ink, fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] }, rallyLogGame: { marginTop: 2, color: C.teal, fontSize: 6, fontWeight: '900' }, rallyLogMore: { minHeight: 40, paddingTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }, rallyLogMoreText: { color: C.teal, fontSize: 8, fontWeight: '900' },
  modalBackdrop: { flex: 1, paddingHorizontal: 16, paddingTop: 16, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.7)' }, dialog: { width: '100%', maxWidth: 390, padding: 22, alignItems: 'center', borderRadius: 22, backgroundColor: C.surface }, dialogIcon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#F7EAE6' }, dialogTitle: { marginTop: 13, color: C.ink, fontSize: 21, fontWeight: '800' }, dialogBody: { marginTop: 6, color: C.ink40, fontSize: 11, lineHeight: 17, textAlign: 'center' }, dialogActions: { width: '100%', marginTop: 20, flexDirection: 'row', gap: 8 }, secondaryButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: C.line }, secondaryText: { color: C.teal, fontSize: 10, fontWeight: '800' }, endConfirmButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.brick }, endConfirmText: { color: C.surface, fontSize: 10, fontWeight: '800' },
  serverChoiceList: { width: '100%', marginTop: 18, gap: 9 }, serverChoiceRow: { minHeight: 50, padding: 7, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, serverChoiceName: { minWidth: 0, flex: 1, color: C.ink, fontSize: 9, fontWeight: '900' }, serverChoiceButton: { minHeight: 35, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.optic }, serverChoiceButtonText: { color: '#0E2321', fontSize: 7, fontWeight: '900' },
  saveUnfinishedButton: { width: '100%', minHeight: 50, marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, backgroundColor: C.optic }, saveUnfinishedText: { color: '#0E2321', fontSize: 10, fontWeight: '900' },
  courtSheet: { width: '100%', maxWidth: 420, minHeight: 220, padding: 16, overflow: 'hidden', borderRadius: 24, backgroundColor: C.paper }, courtList: { flex: 1, minHeight: 0 }, courtListContent: { paddingBottom: 6 }, sheetHandle: { alignSelf: 'center', width: 38, height: 4, marginBottom: 10, borderRadius: 2, backgroundColor: C.line }, sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sheetTitle: { color: C.ink, fontSize: 22, fontWeight: '800' }, sheetClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: C.surface }, sheetLead: { marginTop: 4, marginBottom: 2, color: C.ink40, fontSize: 10 }, courtOption: { minHeight: 70, marginTop: 8, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, courtOptionActive: { borderColor: C.teal, backgroundColor: '#F7FAF7' }, courtThumb: { width: 44, height: 50, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 10 }, courtThumbLine: { position: 'absolute', left: 6, right: 6, top: '50%', height: 1, backgroundColor: 'rgba(255,255,255,.58)' }, courtOptionCopy: { flex: 1, minWidth: 0 }, courtOptionName: { color: C.ink, fontSize: 11, fontWeight: '800' }, courtOptionDetail: { marginTop: 2, color: C.ink40, fontSize: 8 }, courtAvailable: { marginTop: 3, color: C.teal, fontSize: 8, fontWeight: '800' },
  scoringMethodSection: { marginTop: 5 },
  scoringMethodSelected: { minHeight: 27, marginTop: 18, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 14, backgroundColor: '#E5F0ED' },
  scoringMethodSelectedText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .55 },
  scoringMethodChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  scoringMethodChoice: { minHeight: 156, flexBasis: '47%', flexGrow: 1, padding: 13, overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  scoringMethodChoiceActive: { borderWidth: 2, borderColor: C.teal, backgroundColor: '#F4F9F7' },
  scoringMethodChoiceIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' },
  scoringMethodChoiceIconActive: { backgroundColor: C.optic },
  scoringMethodChoiceTitle: { marginTop: 11, color: C.ink, fontSize: 12, fontWeight: '900' },
  scoringMethodChoiceMeta: { marginTop: 5, color: C.ink40, fontSize: 8, lineHeight: 12 },
  scoringMethodRadio: { position: 'absolute', top: 13, right: 13, width: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  scoringMethodRadioActive: { borderColor: C.teal },
  scoringMethodRadioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.teal },
  liveScoringMethod: { minHeight: 67, marginHorizontal: 20, marginTop: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  liveScoringMethodCopy: { minWidth: 0, flex: 1 },
  liveScoringMethodLabel: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .65 },
  liveScoringMethodMeta: { marginTop: 3, color: C.ink40, fontSize: 7, lineHeight: 10 },
  liveScoringMethodSwitch: { width: 204, height: 42, padding: 3, flexDirection: 'row', borderRadius: 11, backgroundColor: '#E7EBE6' },
  liveScoringMethodOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 8 },
  liveScoringMethodOptionActive: { backgroundColor: C.optic },
  liveScoringMethodText: { color: C.ink40, fontSize: 7, fontWeight: '800' },
  liveScoringMethodTextActive: { color: '#0E2321', fontWeight: '900' },
  shoutFeedback: { minHeight: 40, marginHorizontal: 20, marginTop: 8, paddingHorizontal: 11, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, borderWidth: 1 },
  shoutFeedbackAccepted: { borderColor: '#CFE2D7', backgroundColor: '#EDF5E5' },
  shoutFeedbackRejected: { borderColor: '#F1CFC5', backgroundColor: '#FFF0EC' },
  shoutFeedbackText: { minWidth: 0, flex: 1, color: C.ink, fontSize: 8, lineHeight: 11, fontWeight: '800' },
  resultContent: { alignItems: 'center', paddingTop: 12, paddingBottom: 126 },
  resultIcon: { width: 72, height: 72, marginBottom: 15, alignItems: 'center', justifyContent: 'center', borderRadius: 23, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: C.optic },
  resultTopBar: { width: '100%', minHeight: 54, marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultTopButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  resultTopCopy: { alignItems: 'center' }, resultTopEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: 1.1 }, resultTopTitle: { marginTop: 2, color: C.ink, fontSize: 15, fontWeight: '900' },
  resultPoster: { width: '100%', padding: 20, overflow: 'hidden', borderRadius: 26, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: '#0E2321', ...shadow },
  posterGlow: { position: 'absolute', top: -90, right: -80, width: 250, height: 250, borderRadius: 125, backgroundColor: 'rgba(214,233,74,.09)' },
  posterBrandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, posterBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 }, posterBrandText: { color: C.surface, fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  posterBall: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.optic }, posterBallHoleOne: { position: 'absolute', top: 5, left: 6, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(14,35,33,.44)' }, posterBallHoleTwo: { position: 'absolute', top: 11, right: 5, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(14,35,33,.44)' }, posterBallHoleThree: { position: 'absolute', bottom: 4, left: 8, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(14,35,33,.44)' },
  posterFinalPill: { minHeight: 28, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,.15)', backgroundColor: 'rgba(255,255,255,.06)' }, posterFinalDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.optic }, posterFinalText: { color: C.surface, fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  posterMeta: { marginTop: 30, color: C.optic, fontSize: 8, fontWeight: '900', letterSpacing: 1.3 }, posterHeadline: { maxWidth: '90%', marginTop: 7, color: C.surface, fontSize: 27, lineHeight: 32, fontWeight: '900', letterSpacing: -.65 }, posterVenueRow: { marginTop: 10, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 5 }, posterVenue: { minWidth: 0, color: '#ABC0B9', fontSize: 9, fontWeight: '700' },
  posterScoreboard: { marginTop: 'auto', marginBottom: 'auto', overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,.13)', backgroundColor: 'rgba(255,255,255,.045)' }, posterScoreHead: { minHeight: 30, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: 'rgba(255,255,255,.1)' }, posterScoreLabel: { width: 29, color: '#82968F', textAlign: 'center', fontSize: 6, fontWeight: '900', letterSpacing: .6 }, posterTeamLabel: { minWidth: 0, flex: 1, textAlign: 'left' }, posterMatchLabel: { marginLeft: 4, color: C.optic }, posterMatchBadge: { width: 20, height: 14, marginLeft: 8, marginRight: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: C.optic, shadowColor: C.optic, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 4 }, posterMatchBadgeText: { color: '#0E2321', fontSize: 7, fontWeight: '900', letterSpacing: .5 },
  posterTeamRow: { minHeight: 72, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' }, posterTeamRowBorder: { borderTopWidth: 1, borderColor: 'rgba(255,255,255,.1)' }, posterTeamMark: { width: 30, height: 30, marginRight: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: C.teal }, posterTeamMarkAway: { backgroundColor: C.brick }, posterTeamMarkText: { color: C.surface, fontSize: 7, fontWeight: '900' }, posterTeamNameWrap: { minWidth: 0, flex: 1, paddingRight: 6 }, posterTeamName: { color: C.surface, fontSize: 10, lineHeight: 14, fontWeight: '900' }, posterWinnerTag: { marginTop: 3, color: C.optic, fontSize: 5, fontWeight: '900', letterSpacing: .7 }, posterGameScore: { width: 29, color: '#8EA19B', textAlign: 'center', fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }, posterGameScoreWon: { color: C.surface }, posterMatchScore: { width: 29, marginLeft: 4, color: '#8EA19B', textAlign: 'center', fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] }, posterMatchScoreWon: { color: C.optic },
  posterFooter: { paddingTop: 17, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderTopWidth: 1, borderColor: 'rgba(255,255,255,.12)' }, posterDuration: { alignItems: 'flex-end' }, posterFooterLabel: { color: '#71867F', fontSize: 5, fontWeight: '900', letterSpacing: .8 }, posterFooterValue: { marginTop: 4, color: C.surface, fontSize: 8, fontWeight: '900', fontVariant: ['tabular-nums'] },
  resultSectionHead: { width: '100%', marginTop: 24, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, resultSectionEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: 1 }, resultSectionTitle: { marginTop: 4, color: C.ink, fontSize: 18, fontWeight: '900' }, resultSectionMeta: { color: C.ink40, fontSize: 8, fontWeight: '800' },
  resultStats: { width: '100%', marginTop: 12, paddingVertical: 15, flexDirection: 'row', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, resultStat: { flex: 1, alignItems: 'center', borderRightWidth: 1, borderColor: C.line }, resultStatLast: { borderRightWidth: 0 }, resultStatIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#E5F0ED' }, resultStatValue: { marginTop: 7, color: C.ink, fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] }, resultStatLabel: { marginTop: 3, color: C.ink40, fontSize: 5, fontWeight: '900', letterSpacing: .55 },
  focusResultCard: { width: '100%', marginTop: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, focusResultAchieved: { borderColor: '#B9D22C', backgroundColor: '#FAFCEB' }, focusResultIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, focusResultTitle: { marginTop: 3, color: C.ink, fontSize: 11, lineHeight: 15, fontWeight: '900' }, focusResultMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 },
  resultSaveStatus: { width: '100%', minHeight: 62, marginTop: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, resultSaveFailed: { borderColor: '#E2B5A9', backgroundColor: '#FFF9F7' }, resultSaveIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#E5F0ED' }, resultDetailsTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, resultDetailsMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 11 }, resultRetryText: { color: C.brick, fontSize: 7, fontWeight: '900', letterSpacing: .7 },
  resultActions: { width: '100%', marginTop: 14, flexDirection: 'row', gap: 9 }, resultPrimaryAction: { minHeight: 52, flex: 1.35, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 15, backgroundColor: C.optic }, resultPrimaryActionText: { color: '#0E2321', fontSize: 10, fontWeight: '900' }, resultSecondaryAction: { minHeight: 52, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, resultSecondaryActionText: { color: C.teal, fontSize: 10, fontWeight: '900' },
  resultActionsBackdrop: { flex: 1, paddingHorizontal: 16, paddingBottom: 18, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.68)' }, resultActionsSheet: { width: '100%', maxWidth: 420, alignSelf: 'center', padding: 18, borderRadius: 24, backgroundColor: C.paper }, resultActionsHandle: { alignSelf: 'center', width: 38, height: 4, marginBottom: 14, borderRadius: 2, backgroundColor: C.line }, resultActionsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, resultActionsTitle: { marginTop: 3, color: C.ink, fontSize: 21, fontWeight: '900' }, resultActionsClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.surface }, resultActionsLead: { marginTop: 7, marginBottom: 6, color: C.ink40, fontSize: 9, lineHeight: 14 }, resultActionRow: { minHeight: 68, marginTop: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, resultActionIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' }, resultActionTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, resultActionMeta: { marginTop: 3, color: C.ink40, fontSize: 7, lineHeight: 11 },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
