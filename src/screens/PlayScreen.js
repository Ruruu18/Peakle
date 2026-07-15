import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Alert,
  Easing,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import OpenPlayScreen from './OpenPlayScreen';
import { useAuth } from '../context/AuthContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { listVenues, loadUnfinishedMatch, saveCompletedMatch, saveUnfinishedMatch } from '../services/database';
import useNearbyPlayers from '../hooks/useNearbyPlayers';

const LIGHT_C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA',
};
let C = LIGHT_C;

const emptyLineup = (currentUserName) => [[currentUserName || 'You', ''], ['', '']];
const normalizedPlayerName = (name) => name?.trim().toLocaleLowerCase() || '';

function Icon({ name, size = 20, color = C.ink }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function KitchenLine({ dark = false }) {
  return <View style={styles.kitchen}><View style={[styles.solid, dark && styles.solidLight]} /><View style={[styles.dashed, dark && styles.dashedLight]} /></View>;
}

function Header({ eyebrow, title, action }) {
  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerCopy}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.h1}>{title}</Text></View>
        {action}
      </View>
      <KitchenLine />
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
        useNativeDriver: true,
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
              {option.icon && <Icon name={option.icon} size={16} color={isActive ? '#0E2321' : C.ink40} />}
              <Text style={[styles.segmentText, isActive && styles.segmentTextActive, isActive && { color: '#0E2321' }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function PlayerInput({ value, onChangeText, team, number, visible }) {
  if (!visible) return null;
  const initials = value.trim()
    ? value.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    : String(number);
  return (
    <View style={styles.playerInputWrap}>
      <View style={[styles.playerNumber, team === 1 && styles.playerNumberAway]}><Text style={styles.playerNumberText}>{initials}</Text></View>
      <View style={styles.playerInputCopy}>
        <TextInput
          accessibilityLabel={`Team ${team + 1} player ${number}`}
          value={value}
          onChangeText={onChangeText}
          placeholder={`Open player ${number}`}
          placeholderTextColor={C.ink40}
          maxLength={24}
          selectTextOnFocus
          style={styles.playerInput}
        />
        <View style={styles.playerStatus}><View style={styles.playerStatusDot} /><Text numberOfLines={1} adjustsFontSizeToFit style={styles.playerStatusText}>{value.trim() ? `PLAYER ${number} · READY` : `PLAYER ${number} · OPEN`}</Text></View>
      </View>
    </View>
  );
}

function CourtPlayerAvatar({ name, avatar }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [avatar]);

  if (avatar && !imageFailed) {
    return <Image source={{ uri: avatar }} resizeMode="cover" onError={() => setImageFailed(true)} style={styles.courtPlayerAvatar} />;
  }

  const playerInitials = name.trim()
    ? name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    : '?';
  return <Text style={[styles.courtPlayerInitials, { color: '#0E2321' }]}>{playerInitials}</Text>;
}

function CourtLineup({ players, matchType, court, onSwap, currentUserName, currentUserAvatar, registeredPlayers = [] }) {
  const visiblePlayers = matchType === 'singles' ? 1 : 2;
  const currentUserKey = normalizedPlayerName(currentUserName);
  const avatarFor = (name) => {
    const playerKey = normalizedPlayerName(name);
    if ((playerKey === currentUserKey || playerKey === 'you') && currentUserAvatar) return currentUserAvatar;
    return registeredPlayers.find((player) => normalizedPlayerName(player.name) === playerKey)?.avatar || null;
  };

  return (
    <View style={[styles.courtModel, { backgroundColor: court?.color || C.teal }]}>
      <View style={styles.courtGlow} />
      <View style={styles.courtGrain} />
      <View style={styles.courtOutline} />
      <View style={[styles.kitchenZone, styles.kitchenZoneTop]} />
      <View style={[styles.kitchenZone, styles.kitchenZoneBottom]} />
      <View style={[styles.courtCenterLine, styles.courtCenterLineTop]} />
      <View style={[styles.courtCenterLine, styles.courtCenterLineBottom]} />
      <View style={styles.courtKitchenTop} />
      <View style={styles.courtKitchenBottom} />
      <View style={styles.courtNetShadow} />
      <View style={styles.courtNet}>
        <View style={styles.netPost} /><View style={[styles.netPost, styles.netPostRight]} />
        <View style={styles.courtNetSolid} /><View style={styles.courtNetMesh} /><View style={styles.courtNetDash} />
      </View>
      <View style={styles.venuePill}><Icon name="location" size={9} color={C.surface} /><Text numberOfLines={1} style={styles.venuePillText}>{court?.name || 'PICKLE COURT'}</Text></View>
      {[0, 1].map((team) => (
        <View key={team} style={[styles.courtSide, team === 1 && styles.courtSideAway]}>
          {players[team].slice(0, visiblePlayers).map((name, index) => {
            const playerAvatar = avatarFor(name);
            return (
              <View key={`${team}-${index}`} style={[styles.courtPlayer, visiblePlayers === 1 && styles.courtPlayerSingle]}>
                <View style={styles.playerMarkerShadow} />
                <CourtPlayerAvatar name={name} avatar={playerAvatar} />
                <Text numberOfLines={1} style={styles.courtPlayerName}>{name.trim() || `Open spot ${index + 1}`}</Text>
              </View>
            );
          })}
        </View>
      ))}
      <Pressable accessibilityLabel="Swap teams on court" onPress={onSwap} style={({ pressed }) => [styles.courtSwap, pressed && styles.pressed]}>
        <Icon name="swap-vertical" size={16} color="#0E2321" /><Text style={[styles.courtSwapText, { color: '#0E2321' }]}>SWAP</Text>
      </Pressable>
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
    const active = selected?.id === court.id;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        key={court.id}
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
      <Pressable accessibilityLabel="Close court picker" style={[styles.modalBackdrop, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={onClose}>
        <Pressable accessibilityRole="dialog" testID="court-picker-sheet" style={[styles.courtSheet, { height: sheetHeight }]} onPress={(event) => event.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHead}><View><Text style={styles.eyebrow}>BEFORE YOU PLAY</Text><Text style={styles.sheetTitle}>Choose a court</Text></View><Pressable accessibilityLabel="Close" onPress={onClose} style={styles.sheetClose}><Icon name="close" /></Pressable></View>
          <Text style={styles.sheetLead}>Select where this match will take place.</Text>
          <FlatList
            testID="court-picker-list"
            data={courts}
            renderItem={renderCourt}
            keyExtractor={(court) => court.id}
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
      <View style={styles.invitesTitleRow}><View style={styles.inviteBell}><Icon name="notifications" size={17} color="#0E2321" /></View><View style={styles.flex}><Text style={styles.invitesEyebrow}>MATCH INVITATION</Text><Text style={styles.invitesTitle}>{invites.length === 1 ? 'A nearby player invited you' : `${invites.length} players invited you`}</Text></View></View>
      {invites.map((invite) => {
        const senderName = invite.sender?.display_name || 'A nearby player';
        const payload = invite.match_payload || {};
        const detail = `${payload.matchType === 'singles' ? 'Singles' : 'Doubles'} · ${payload.mode === 'ranked' ? 'Ranked' : 'Casual'}${payload.court?.name ? ` · ${payload.court.name}` : ''}`;
        return <View key={invite.id} style={styles.inviteRequest}><View style={styles.inviteRequestCopy}><Text style={styles.inviteSender}>{senderName}</Text><Text numberOfLines={2} style={styles.inviteDetail}>{detail}</Text></View><Pressable accessibilityLabel={`Decline invitation from ${senderName}`} onPress={() => onRespond(invite.id, false)} style={styles.declineInvite}><Icon name="close" size={17} color={C.brick} /></Pressable><Pressable accessibilityLabel={`Accept invitation from ${senderName}`} onPress={() => onRespond(invite.id, true)} style={styles.acceptInvite}><Icon name="checkmark" size={17} color="#0E2321" /><Text style={styles.acceptInviteText}>Join</Text></Pressable></View>;
      })}
    </View>
  );
}

function NearbyLobby({ players, invited, outgoingInvites, onToggle, full, visible, loading, error, onVisibility }) {
  return (
    <View style={styles.nearbyCard}>
      <View style={styles.nearbyHead}><View style={styles.flex}><Text style={styles.sectionLabel}>NEARBY PLAYERS</Text><Text style={styles.nearbySubtitle}>{visible ? 'Online players within 25 km. Your exact position stays private.' : 'Go visible to find online players around you.'}</Text></View><Pressable disabled={loading} accessibilityRole="switch" accessibilityState={{ checked: visible }} accessibilityLabel={visible ? 'Stop showing me to nearby players' : 'Show me to nearby players'} onPress={() => onVisibility(!visible)} style={[styles.visibilityButton, visible && styles.visibilityButtonOn, loading && styles.disabled]}><View style={[styles.visibilityDot, visible && styles.visibilityDotOn]} /><Text style={[styles.visibilityText, visible && styles.visibilityTextOn]}>{loading ? 'WAIT' : visible ? 'VISIBLE' : 'GO VISIBLE'}</Text></Pressable></View>
      {!!error && <View style={styles.nearbyError}><Icon name="alert-circle-outline" size={16} color={C.brick} /><Text style={styles.nearbyErrorText}>{error}</Text></View>}
      {visible && <View style={styles.nearbyCountRow}><View style={styles.nearbyCount}><View style={styles.liveDot} /><Text style={styles.nearbyCountText}>{players.length} ONLINE NEARBY</Text></View></View>}
      {visible && !players.length && !error && <View style={styles.nearbyEmpty}><Icon name="navigate-outline" size={22} color={C.ink40} /><Text style={styles.nearbyEmptyTitle}>No one nearby yet</Text><Text style={styles.nearbyEmptyText}>Open Peakle on a second account, choose Public, and turn on visibility to test it.</Text></View>}
      {visible && players.map((player, index) => {
        const added = invited.includes(player.id);
        const latestInvite = outgoingInvites.find((invite) => invite.recipient_id === player.id && invite.match_payload?.setupId);
        const pending = latestInvite?.status === 'pending';
        const disabled = (full && !added && !pending) || added;
        return (
          <View key={player.id} style={[styles.nearbyPlayer, index > 0 && styles.nearbyPlayerBorder]}>
            <View style={[styles.nearbyAvatar, { backgroundColor: player.color }]}><Text style={styles.nearbyAvatarText}>{player.initials}</Text></View>
            <View style={styles.nearbyCopy}><Text style={styles.nearbyName}>{player.name}</Text><Text style={styles.nearbyMeta}>★ {player.rating} · {player.distance} away · online</Text></View>
            <Pressable disabled={disabled} accessibilityLabel={`${added ? 'Accepted' : pending ? 'Cancel invitation for' : disabled ? 'Lineup full for' : 'Invite'} ${player.name}`} onPress={() => onToggle(player, latestInvite)} style={({ pressed }) => [styles.inviteButton, (added || pending) && styles.inviteButtonAdded, disabled && !added && styles.inviteButtonDisabled, pressed && !disabled && styles.pressed]}>
              <Icon name={added ? 'checkmark' : pending ? 'time-outline' : disabled ? 'remove' : 'add'} size={15} color={added || pending ? C.teal : disabled ? C.ink40 : C.ink} /><Text style={[styles.inviteButtonText, (added || pending) && styles.inviteButtonTextAdded, disabled && !added && styles.inviteButtonTextDisabled]}>{added ? 'Added' : pending ? 'Pending' : disabled ? 'Full' : 'Invite'}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function SetupScreen({ courts, nearbyPlayers, nearbyPresence, currentUserName, currentUserId, currentUserAvatar, onStart, focusChallenge, onOpenPlay, unfinishedMatch, onResume }) {
  const [matchType, setMatchType] = useState('doubles');
  const [mode, setMode] = useState('casual');
  const [access, setAccess] = useState('private');
  const [target, setTarget] = useState(11);
  const [bestOf, setBestOf] = useState(3);
  const [winByTwo, setWinByTwo] = useState(true);
  const [players, setPlayers] = useState(() => emptyLineup(currentUserName));
  const [invited, setInvited] = useState([]);
  const [court, setCourt] = useState(courts[0] || null);
  const [scorerSource, setScorerSource] = useState('court');
  const [scorer, setScorer] = useState(currentUserName || 'You');
  const [showCourts, setShowCourts] = useState(false);
  const setupId = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`).current;
  const appliedInviteIds = useRef(new Set());
  const requiredPlayers = matchType === 'doubles' ? 2 : 1;

  const updatePlayer = (team, index, value) => {
    setPlayers((current) => current.map((group, groupIndex) => (
      groupIndex === team ? group.map((name, nameIndex) => nameIndex === index ? value : name) : group
    )));
  };

  const trimmedPlayers = players.map((team) => team.slice(0, requiredPlayers).map((name) => name.trim()));
  const onCourtScorers = trimmedPlayers.flat().filter(Boolean);
  useEffect(() => { if (!court && courts.length) setCourt(courts[0]); }, [courts, court]);
  const nearbyScorers = nearbyPlayers.filter((person) => !onCourtScorers.includes(person.name));
  const scorerIsValid = scorerSource === 'court' ? onCourtScorers.includes(scorer) : nearbyScorers.some((person) => person.name === scorer);
  const canStart = Boolean(court) && scorerIsValid && trimmedPlayers.flat().every(Boolean);
  const acceptedProfiles = nearbyPresence.outgoingInvites.filter((invite) => invite.status === 'accepted' && invite.match_payload?.setupId === setupId).map((invite) => invite.recipient).filter(Boolean);
  const registeredPlayers = [{ id: currentUserId, name: currentUserName }, ...acceptedProfiles.map((profile) => ({ id: profile.id, name: profile.display_name }))];
  const matchConfiguration = { matchType, mode, access, target, bestOf, winByTwo, players: trimmedPlayers, registeredPlayers, court, scorer, scorerSource, focusChallenge };

  useEffect(() => {
    const invite = nearbyPresence.outgoingInvites.find((item) => item.status === 'accepted' && item.match_payload?.setupId === setupId && !appliedInviteIds.current.has(item.id) && item.recipient?.display_name);
    if (!invite) return;
    const slots = matchType === 'doubles' ? [[0, 0], [0, 1], [1, 0], [1, 1]] : [[0, 0], [1, 0]];
    const openSlot = slots.find(([team, index]) => !players[team][index].trim());
    if (!openSlot) return;
    appliedInviteIds.current.add(invite.id);
    setInvited((ids) => ids.includes(invite.recipient.id) ? ids : [...ids, invite.recipient.id]);
    setPlayers((current) => current.map((team, teamIndex) => team.map((name, nameIndex) => teamIndex === openSlot[0] && nameIndex === openSlot[1] ? invite.recipient.display_name : name)));
  }, [matchType, nearbyPresence.outgoingInvites, players, setupId]);

  const changeScorerSource = (source) => {
    setScorerSource(source);
    if (source === 'court') setScorer(onCourtScorers[0] || '');
    else setScorer(nearbyScorers[0]?.name || '');
  };

  const changeAccess = (value) => {
    if (value === access) return;
    setAccess(value);
    if (value === 'public') {
      setPlayers(emptyLineup(currentUserName));
      setInvited([]);
    } else {
      setPlayers(emptyLineup(currentUserName));
      setInvited([]);
    }
  };

  const toggleNearbyPlayer = async (player, existingInvite) => {
    if (existingInvite?.status === 'pending') {
      await nearbyPresence.cancel(existingInvite.id);
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
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Header
        eyebrow="MATCH DAY"
        title="Set up a match"
        action={<View style={styles.liveChip}><View style={styles.liveDot} /><Text style={styles.liveChipText}>COURT-SIDE</Text></View>}
      />

      <IncomingInvites invites={nearbyPresence.incomingInvites} onRespond={nearbyPresence.respond} />

      {unfinishedMatch && <View style={styles.resumeCard}><View style={styles.resumeIcon}><Icon name="bookmark" size={20} color={C.ink} /></View><View style={styles.flex}><Text style={styles.resumeEyebrow}>UNFINISHED MATCH SAVED</Text><Text style={styles.resumeTitle}>{teamName(unfinishedMatch.players[0])} · {unfinishedMatch.scores[0]}–{unfinishedMatch.scores[1]} · {teamName(unfinishedMatch.players[1])}</Text><Text style={styles.resumeMeta}>Continue from the saved score when you have court time again.</Text></View><Pressable accessibilityRole="button" onPress={onResume} style={({ pressed }) => [styles.resumeButton, pressed && styles.pressed]}><Text style={styles.resumeButtonText}>Resume</Text><Icon name="play" size={13} color={C.surface} /></Pressable></View>}

      <Pressable onPress={onOpenPlay} style={({ pressed }) => [styles.openPlayEntry, pressed && styles.pressed]}>
        <View style={styles.openPlayEntryIcon}><Icon name="people" size={23} /></View>
        <View style={styles.flex}><Text style={styles.openPlayEntryEyebrow}>ORGANIZER MODE</Text><Text style={styles.openPlayEntryTitle}>Run an open play session</Text><Text style={styles.openPlayEntryMeta}>Manage courts, the player queue, scorers, and live matches.</Text></View>
        <Icon name="chevron-forward" color={C.teal} />
      </Pressable>

      <View style={styles.introCard}>
        <View style={styles.introIcon}><Icon name="tennisball-outline" size={26} color="#0E2321" /></View>
        <View style={styles.introCopy}><Text style={[styles.introTitle, { color: '#0E2321' }]}>Ready when you are.</Text><Text style={[styles.bodySmall, { color: '#3C4A45' }]}>Choose the format, add players, then keep score point by point.</Text></View>
      </View>
      {focusChallenge && (
        <View style={styles.focusSetupCard}>
          <View style={styles.focusSetupIcon}><Icon name="locate" size={18} color="#0E2321" /></View>
          <View style={styles.focusSetupCopy}><Text style={styles.focusSetupEyebrow}>FOCUS CHALLENGE ACTIVE</Text><Text style={styles.focusSetupTitle}>{focusChallenge.instruction}</Text><Text style={styles.focusSetupMeta}>You’ll track each return during the live match.</Text></View>
          <Icon name="checkmark-circle" size={20} color={C.teal} />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try a live match with the default lineup"
        disabled={!canStart}
        onPress={() => onStart(matchConfiguration)}
        style={({ pressed }) => [styles.quickStartButton, !canStart && styles.disabled, pressed && canStart && styles.pressed]}
      >
        <View style={styles.quickStartIcon}><Icon name="person" size={17} color="#0E2321" /></View>
        <View style={styles.quickStartCopy}><Text style={styles.quickStartTitle}>Choose the first server</Text><Text numberOfLines={1} style={styles.quickStartMeta}>{scorer || 'Scorer needed'} will make the pre-game decision</Text></View>
        <Icon name="arrow-forward" size={18} color={C.surface} />
      </Pressable>

      <SegmentedControl label="FORMAT" value={matchType} onChange={setMatchType} options={[
        { value: 'singles', label: 'Singles', icon: 'person-outline' },
        { value: 'doubles', label: 'Doubles', icon: 'people-outline' },
      ]} />
      <SegmentedControl label="PLAY TYPE" value={mode} onChange={setMode} options={[
        { value: 'casual', label: 'Casual', icon: 'happy-outline' },
        { value: 'ranked', label: 'Ranked', icon: 'podium-outline' },
      ]} />
      <SegmentedControl label="WHO CAN JOIN" value={access} onChange={changeAccess} options={[
        { value: 'private', label: 'Private', icon: 'lock-closed-outline' },
        { value: 'public', label: 'Public', icon: 'globe-outline' },
      ]} />

      {access === 'public' && <NearbyLobby players={nearbyPlayers} invited={invited} outgoingInvites={nearbyPresence.outgoingInvites.filter((invite) => invite.match_payload?.setupId === setupId)} onToggle={toggleNearbyPlayer} full={trimmedPlayers.flat().every(Boolean)} visible={nearbyPresence.visible} loading={nearbyPresence.loading} error={nearbyPresence.error} onVisibility={nearbyPresence.setDiscoveryVisible} />}

      <View style={styles.fieldGroup}>
        <Text style={styles.sectionLabel}>COURT</Text>
        <Pressable accessibilityLabel="Choose a court" onPress={() => setShowCourts(true)} style={({ pressed }) => [styles.courtSelect, court && styles.courtSelectChosen, pressed && styles.pressed]}>
          <View style={[styles.courtSelectIcon, court && { backgroundColor: court.color }]}><Icon name={court ? 'tennisball-outline' : 'location-outline'} color={court ? C.surface : C.teal} /></View>
          <View style={styles.courtSelectCopy}><Text style={styles.courtSelectName}>{court ? court.name : 'Select a court'}</Text><Text style={styles.courtSelectDetail}>{court ? `${court.detail} · ${court.next}` : 'Required before starting the match'}</Text></View>
          <Icon name={court ? 'create-outline' : 'chevron-forward'} color={C.teal} />
        </Pressable>
      </View>

      <SegmentedControl
        label="MATCH SCORER"
        value={scorerSource}
        onChange={changeScorerSource}
        options={[
          { value: 'court', label: 'On court', icon: 'tennisball-outline' },
          { value: 'nearby', label: 'Nearby', icon: 'navigate-outline' }
        ]}
      />
      <View>
        <View style={styles.scorerPicker}>
          {(scorerSource === 'court' ? onCourtScorers.map((name, index) => ({ id: `court-${index}-${name}`, name, meta: `Team ${index < requiredPlayers ? 1 : 2} · playing`, color: index < requiredPlayers ? C.teal : C.brick })) : nearbyScorers.map((person) => ({ ...person, meta: `${person.distance} away · available` }))).map((person) => {
            const selected = scorer === person.name;
            return (
              <Pressable key={person.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`Choose ${person.name} as scorer`} onPress={() => setScorer(person.name)} style={({ pressed }) => [styles.scorerOption, selected && styles.scorerOptionSelected, pressed && styles.pressed]}>
                <View style={[styles.scorerOptionAvatar, { backgroundColor: person.color || C.teal }]}><Text style={styles.scorerOptionInitials}>{initials(person.name)}</Text></View>
                <View style={styles.scorerOptionCopy}><Text style={styles.scorerOptionName}>{person.name}</Text><Text style={styles.scorerOptionMeta}>{person.meta}</Text></View>
                <Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} color={selected ? C.teal : C.ink40} />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.scorerHint}><Icon name="information-circle-outline" size={15} color={C.teal} /><Text style={styles.scorerHintText}>{scorerSource === 'court' ? 'An on-court player will update the score between rallies.' : 'A nearby scorer can officiate without joining the lineup.'}</Text></View>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.sectionLabel}>COURT LINEUP</Text>
        <CourtLineup players={players} matchType={matchType} court={court} onSwap={() => setPlayers(([first, second]) => [second, first])} currentUserName={currentUserName} currentUserAvatar={currentUserAvatar} registeredPlayers={nearbyPlayers} />
        <Text style={styles.lineupHint}>Edit a player below or swap both sides directly on the court.</Text>
        <View style={styles.teamsGrid}>
          {[0, 1].map((team) => (
            <View key={team} style={styles.teamSetup}>
              <View style={styles.teamSetupHead}><View style={[styles.teamBar, team === 1 && styles.teamBarAway]} /><Text style={styles.teamLabel}>TEAM {team + 1}</Text></View>
              <PlayerInput team={team} number={1} value={players[team][0]} onChangeText={(value) => updatePlayer(team, 0, value)} visible />
              <PlayerInput team={team} number={2} value={players[team][1]} onChangeText={(value) => updatePlayer(team, 1, value)} visible={matchType === 'doubles'} />
            </View>
          ))}
        </View>
      </View>

      <SegmentedControl label="POINTS TO WIN" value={target} onChange={setTarget} options={[11, 15, 21].map((value) => ({ value, label: String(value) }))} />
      <SegmentedControl label="MATCH LENGTH" value={bestOf} onChange={setBestOf} options={[
        { value: 1, label: '1 game' },
        { value: 3, label: 'Best of 3' },
      ]} />

      <Pressable accessibilityRole="switch" accessibilityState={{ checked: winByTwo }} onPress={() => setWinByTwo((value) => !value)} style={styles.settingRow}>
        <View style={styles.settingIcon}><Icon name="add-circle-outline" color={C.teal} /></View>
        <View style={styles.settingCopy}><Text style={styles.settingTitle}>Win by 2</Text><Text style={styles.bodySmall}>Play continues until one team leads by two points.</Text></View>
        <View style={[styles.toggle, winByTwo && styles.toggleOn]}><View style={[styles.toggleKnob, winByTwo && styles.toggleKnobOn]} /></View>
      </Pressable>

      {mode === 'ranked' && <View style={styles.rankedNote}><Icon name="shield-checkmark-outline" color={C.teal} /><Text style={styles.rankedNoteText}>Ranked result will be included in your local rating history.</Text></View>}

      <Pressable
        accessibilityRole="button"
        disabled={!canStart}
        onPress={() => onStart(matchConfiguration)}
        style={({ pressed }) => [styles.primaryButton, !canStart && styles.disabled, pressed && canStart && styles.pressed]}
      >
        <Icon name="person" size={19} color="#0E2321" /><Text style={styles.primaryText}>Choose first server</Text><Icon name="arrow-forward" size={18} color="#0E2321" />
      </Pressable>
      {!canStart && <Text style={styles.validation}>{!court ? 'Choose a court and complete the lineup to start.' : !scorerIsValid ? 'Choose an available match scorer.' : 'Add a name for every player to start.'}</Text>}
      <CourtPicker courts={courts} visible={showCourts} selected={court} onClose={() => setShowCourts(false)} onSelect={(selected) => { setCourt(selected); setShowCourts(false); }} />
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
        <Text style={styles.drawEyebrow}>{match.scorerSource === 'court' ? 'ON-COURT SCORER' : 'NEARBY SCORER'} · {match.scorer.toUpperCase()}</Text>
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
                  return <Pressable key={player} accessibilityRole="radio" accessibilityState={{ checked: playerSelected }} accessibilityLabel={`Choose ${player} to serve first`} onPress={() => setServeChoice({ team, player })} style={({ pressed }) => [styles.serverChoice, playerSelected && styles.serverChoiceSelected, pressed && styles.pressed]}><Icon name={playerSelected ? 'tennisball' : 'person-outline'} size={13} color={playerSelected ? C.ink : C.ink40} /><Text numberOfLines={1} style={[styles.serverChoiceText, playerSelected && styles.serverChoiceTextSelected]}>{player}</Text></Pressable>;
                })}
              </View>
              <View style={[styles.drawServeStatus, selected && styles.drawServeStatusActive]}><Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={selected ? C.ink : C.ink40} /><Text numberOfLines={1} style={[styles.drawServeStatusText, selected && styles.drawServeStatusTextActive]}>{selected ? 'FIRST SERVE' : 'NOT SELECTED'}</Text></View>
            </View>
          );
        })}
      </View>

      <View style={styles.preGameSummary}>
        <View style={styles.preGameSummaryRow}><Icon name="location-outline" color={C.teal} /><View style={styles.flex}><Text style={styles.preGameSummaryLabel}>COURT</Text><Text style={styles.preGameSummaryValue}>{match.court.name}</Text></View></View>
        <View style={styles.preGameSummaryRow}><Icon name={match.scorerSource === 'court' ? 'tennisball-outline' : 'navigate-outline'} color={C.teal} /><View style={styles.flex}><Text style={styles.preGameSummaryLabel}>{match.scorerSource === 'court' ? 'ON-COURT SCORER' : 'NEARBY SCORER'}</Text><Text style={styles.preGameSummaryValue}>{match.scorer}</Text></View><View style={styles.scorerReady}><View style={styles.liveDot} /><Text style={styles.scorerReadyText}>READY</Text></View></View>
      </View>

      <Pressable accessibilityRole="button" disabled={!serveChoice} onPress={() => onStart(serveChoice)} style={({ pressed }) => [styles.primaryButton, !serveChoice && styles.disabled, pressed && serveChoice && styles.pressed]}><Icon name="play" size={19} color="#0E2321" /><Text style={styles.primaryText}>{serveChoice ? `Start with ${serveChoice.player}` : 'Select a first server'}</Text><Icon name="arrow-forward" size={18} color="#0E2321" /></Pressable>
      <Pressable accessibilityRole="button" onPress={onBack} style={({ pressed }) => [styles.preGameBack, pressed && styles.pressed]}><Icon name="arrow-back" size={15} color={C.ink40} /><Text style={styles.preGameBackText}>Back to match setup</Text></Pressable>
    </ScrollView>
  );
}

function LiveCourt({ match, ballBounce, rallyTravel, scorerMessage, paused, scores, server, servingPlayerIndex, serviceNumber, celebration, pointAnnouncement }) {
  const ballSquash = ballBounce.interpolate({ inputRange: [0, .78, 1], outputRange: [1, 1.05, .9] });
  const shadowScale = ballBounce.interpolate({ inputRange: [0, 1], outputRange: [1, .45] });
  const shadowOpacity = ballBounce.interpolate({ inputRange: [0, 1], outputRange: [.24, .08] });
  const doubles = match.matchType === 'doubles';
  const rallyStops = doubles
    ? [0, .06, .23, .25, .29, .48, .5, .54, .73, .75, .79, .98, 1]
    : [0, .08, .46, .5, .54, .92, 1];
  const rallyX = rallyTravel.interpolate({
    inputRange: rallyStops,
    outputRange: doubles
      ? [-70, -64, 64, 70, 64, 70, 70, 64, -64, -70, -64, -70, -70]
      : [0, -7, 7, 0, 7, -7, 0],
  });
  const rallyY = rallyTravel.interpolate({
    inputRange: rallyStops,
    outputRange: doubles
      ? [-60, -51, 47, 58, 47, -51, -60, -51, 47, 58, 47, -51, -60]
      : [-60, -51, 47, 58, 47, -51, -60],
  });
  const rallySquash = rallyTravel.interpolate({
    inputRange: rallyStops,
    outputRange: doubles
      ? [.72, 1, 1, .72, 1, 1, .72, 1, 1, .72, 1, 1, .72]
      : [.72, 1, 1, .72, 1, 1, .72],
  });
  const playerOpacity = celebration.interpolate({ inputRange: [0, .1, .88, 1], outputRange: [1, 0, 0, 1] });
  const announcementOpacity = celebration.interpolate({ inputRange: [0, .1, .88, 1], outputRange: [0, 1, 1, 0] });
  const announcementScale = celebration.interpolate({ inputRange: [0, .18, .82, 1], outputRange: [.86, 1, 1, .94] });

  return (
    <View style={styles.liveCourtCard}>
      <View style={styles.liveCourtHead}>
        <View><Text style={styles.liveCourtEyebrow}>ON COURT NOW</Text><Text style={styles.liveCourtTitle}>Live court</Text></View>
        <View style={styles.liveNowPill}><View style={styles.liveNowDot} /><Text style={styles.liveNowText}>{paused ? 'PAUSED' : 'PLAYING'}</Text></View>
      </View>
      <View style={[styles.liveCourt, { backgroundColor: match.court.color || C.teal }]}> 
        <View style={styles.liveCourtBounds} />
        <View style={styles.liveCourtCenterTop} />
        <View style={styles.liveCourtCenterBottom} />
        <View style={styles.liveCourtKitchenTop} />
        <View style={styles.liveCourtKitchenBottom} />
        <View style={styles.liveCourtNet} />
        <View style={styles.courtScoreBar}><View style={styles.courtScoreTeam}><Text style={styles.courtScoreTag}>T1</Text><Text style={styles.courtScoreNumber}>{scores[0]}</Text></View><View style={styles.courtGamePill}><Text style={styles.courtGameText}>LIVE SCORE</Text></View><View style={styles.courtScoreTeam}><Text style={styles.courtScoreNumber}>{scores[1]}</Text><Text style={[styles.courtScoreTag, styles.courtScoreTagAway]}>T2</Text></View></View>
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
        {pointAnnouncement && <Animated.View pointerEvents="none" style={[styles.pointAnnouncement, { opacity: announcementOpacity, transform: [{ scale: announcementScale }] }]}><Text style={styles.pointAnnouncementPlayer}>{pointAnnouncement.player}</Text><Text style={styles.pointAnnouncementTeam}>{pointAnnouncement.team}</Text><Text style={styles.pointAnnouncementText}>{pointAnnouncement.action}</Text><Text style={styles.pointAnnouncementScore}>{pointAnnouncement.score}</Text>{pointAnnouncement.nextServe && <Text style={styles.pointAnnouncementServe}>{pointAnnouncement.nextServe}</Text>}</Animated.View>}
        <Animated.View style={[styles.liveBallShadow, { opacity: shadowOpacity, transform: [{ translateX: rallyX }, { translateY: rallyY }, { scaleX: shadowScale }] }]} />
        <Animated.View accessibilityLabel="Pickleball rallying from player to player" style={[styles.liveBall, { transform: [{ translateX: rallyX }, { translateY: rallyY }, { scaleY: rallySquash }, { scaleY: ballSquash }] }]}>
          <View style={styles.ballHoleOne} /><View style={styles.ballHoleTwo} /><View style={styles.ballHoleThree} />
        </Animated.View>
      </View>
      <View style={styles.scorerBooth}>
        <View style={styles.scorerBoothAvatar}><Text style={styles.scorerBoothInitials}>{initials(match.scorer)}</Text><View style={styles.scorerOnline} /></View>
        <View style={styles.scorerBoothCopy}><Text style={styles.scorerBoothLabel}>{match.scorerSource === 'court' ? 'ON-COURT SCORER' : 'NEARBY SCORER'}</Text><Text style={styles.scorerBoothName}>{match.scorer}</Text><Text accessibilityLiveRegion="polite" numberOfLines={1} style={styles.scorerMessage}>{paused ? 'Scoring paused. Resume when players are ready.' : scorerMessage}</Text><Text style={styles.scorerServing}>{match.players[server][servingPlayerIndex]} serving · Server {serviceNumber}</Text></View>
        <View style={styles.scorerControlBadge}><Icon name="create-outline" size={14} color={C.teal} /><Text style={styles.scorerControlText}>UPDATING</Text></View>
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
      <Pressable accessibilityLabel="Cancel ending match" style={styles.modalBackdrop} onPress={onCancel}>
        <Pressable accessibilityRole="dialog" style={styles.dialog} onPress={(event) => event.stopPropagation()}>
          <View style={styles.dialogIcon}><Icon name="flag-outline" size={26} color={C.brick} /></View>
          <Text style={styles.dialogTitle}>End this match?</Text>
          <Text style={styles.dialogBody}>Save it as unfinished to resume later without affecting your record, or end it now as a final result.</Text>
          <Pressable onPress={onSaveUnfinished} style={({ pressed }) => [styles.saveUnfinishedButton, pressed && styles.pressed]}><Icon name="bookmark-outline" size={16} color={C.ink} /><Text style={styles.saveUnfinishedText}>Save as unfinished</Text></Pressable>
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
      <Pressable accessibilityLabel="Cancel server selection" style={styles.modalBackdrop} onPress={onCancel}>
        <Pressable accessibilityRole="dialog" style={styles.dialog} onPress={(event) => event.stopPropagation()}>
          <View style={[styles.dialogIcon, { backgroundColor: '#E5F0ED' }]}><Icon name="tennisball-outline" size={26} color={C.teal} /></View>
          <Text style={styles.dialogTitle}>Who scored the point?</Text>
          <Text style={styles.dialogBody}>Select the player from {teamName} to manually award the rally and set them as the server.</Text>
          <View style={styles.dialogActions}>
            <Pressable onPress={() => onSelect(0)} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, { backgroundColor: C.optic, borderColor: C.optic }]}><Text style={[styles.secondaryText, { color: C.ink }]}>{players[0]}</Text></Pressable>
            {players.length > 1 && <Pressable onPress={() => onSelect(1)} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, { backgroundColor: C.optic, borderColor: C.optic }]}><Text style={[styles.secondaryText, { color: C.ink }]}>{players[1]}</Text></Pressable>}
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

function LiveMatch({ match, onFinish }) {
  const [scores, setScores] = useState(() => match.scores ? [...match.scores] : [0, 0]);
  const [games, setGames] = useState(() => match.games ? [...match.games] : [0, 0]);
  const [gameScores, setGameScores] = useState(() => match.gameScores?.map((item) => [...item]) || []);
  const [server, setServer] = useState(match.server ?? match.firstServer ?? 0);
  const [servingPlayerIndex, setServingPlayerIndex] = useState(() => match.servingPlayerIndex ?? Math.max(0, match.players[match.firstServer ?? 0].indexOf(match.firstServerPlayer)));
  const [serviceNumber, setServiceNumber] = useState(match.serviceNumber ?? (match.matchType === 'doubles' ? 2 : 1));
  const [paused, setPaused] = useState(false);
  const [pointPause, setPointPause] = useState(false);
  const [pointAnnouncement, setPointAnnouncement] = useState(null);
  const [elapsed, setElapsed] = useState(match.elapsed || 0);
  const [history, setHistory] = useState([]);
  const [swapped, setSwapped] = useState(false);
  const [manualServeTeam, setManualServeTeam] = useState(null);
  const [showEnd, setShowEnd] = useState(false);
  const [focusReturns, setFocusReturns] = useState(match.focusReturns || []);
  const [scorerMessage, setScorerMessage] = useState(match.reason === 'unfinished' ? 'Match resumed from the saved score.' : `Match started — ${match.firstServerPlayer || teamName(match.players[match.firstServer ?? 0])} serves first.`);
  const finishedRef = useRef(false);
  const ballBounce = useRef(new Animated.Value(0)).current;
  const rallyTravel = useRef(new Animated.Value(0)).current;
  const celebration = useRef(new Animated.Value(0)).current;

  const bounceBall = useCallback((iterations = 1) => {
    ballBounce.stopAnimation();
    ballBounce.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(ballBounce, { toValue: 1, duration: 190, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(ballBounce, { toValue: 0, duration: 270, easing: Easing.bounce, useNativeDriver: true }),
      ]),
      { iterations },
    ).start();
  }, [ballBounce]);

  useEffect(() => {
    bounceBall(3);
    return () => { ballBounce.stopAnimation(); celebration.stopAnimation(); };
  }, [ballBounce, bounceBall, celebration]);

  useEffect(() => {
    rallyTravel.stopAnimation();
    if (paused || pointPause) return undefined;
    rallyTravel.setValue(0);
    const rally = Animated.loop(
      Animated.timing(rallyTravel, { toValue: 1, duration: match.matchType === 'doubles' ? 3800 : 2300, easing: Easing.linear, useNativeDriver: true }),
    );
    rally.start();
    return () => rally.stop();
  }, [match.matchType, paused, pointPause, rallyTravel]);

  useEffect(() => {
    if (paused || pointPause) return undefined;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [paused, pointPause]);

  const gamesNeeded = Math.ceil(match.bestOf / 2);
  const scoringLocked = paused || pointPause;

  const finish = (finalState, reason = 'completed') => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish({ ...match, ...finalState, elapsed, reason, focusReturns });
  };

  const runPointCelebration = (announcement, onComplete) => {
    setPointAnnouncement(announcement);
    setPointPause(true);
    celebration.stopAnimation();
    celebration.setValue(0);
    Animated.timing(celebration, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(() => {
      setPointAnnouncement(null);
      setPointPause(false);
      celebration.setValue(0);
      onComplete?.();
    });
  };

  const nextServeState = () => {
    if (match.matchType === 'doubles' && serviceNumber === 1) {
      return { server, servingPlayerIndex: servingPlayerIndex === 0 ? 1 : 0, serviceNumber: 2 };
    }
    return { server: 1 - server, servingPlayerIndex: 0, serviceNumber: 1 };
  };

  const recordRally = (team, forcePlayerIndex = null) => {
    if (paused || pointPause || finishedRef.current) return;
    const snapshot = { scores: [...scores], games: [...games], gameScores: gameScores.map((item) => [...item]), server, servingPlayerIndex, serviceNumber };
    setHistory((items) => [...items, snapshot]);
    bounceBall();

    if (team !== server) {
      const next = nextServeState();
      const newServer = team;
      const newPlayerIndex = forcePlayerIndex !== null ? forcePlayerIndex : next.servingPlayerIndex;
      const newServiceNumber = forcePlayerIndex !== null ? 1 : next.serviceNumber;

      setServer(newServer);
      setServingPlayerIndex(newPlayerIndex);
      setServiceNumber(newServiceNumber);
      const nextPlayer = match.players[newServer][newPlayerIndex];
      const nextTeam = teamName(match.players[newServer]);
      setScorerMessage(`${teamName(match.players[team])} won the rally · ${nextPlayer} serves next`);
      runPointCelebration({ player: teamName(match.players[team]), team: 'wins the rally', action: newServiceNumber === 2 ? 'SECOND SERVER' : 'SIDE OUT', score: `${scores[0]} – ${scores[1]}`, nextServe: `${nextPlayer} serves for ${nextTeam}` });
      return;
    }

    const nextScores = [...scores];
    nextScores[team] += 1;
    const lead = nextScores[team] - nextScores[1 - team];
    const wonGame = nextScores[team] >= match.target && lead >= (match.winByTwo ? 2 : 1);
    setScores(nextScores);
    
    if (forcePlayerIndex !== null) {
      setServingPlayerIndex(forcePlayerIndex);
    }
    
    const announcementPlayer = forcePlayerIndex !== null ? match.players[team][forcePlayerIndex] : match.players[team][servingPlayerIndex];
    const announcement = { player: announcementPlayer, team: teamName(match.players[team]), action: 'SCORES!', score: `${nextScores[0]} – ${nextScores[1]}` };

    if (!wonGame) {
      setScorerMessage(`Point to ${teamName(match.players[team])} · ${nextScores[0]}–${nextScores[1]}`);
      runPointCelebration(announcement);
      return;
    }

    const nextGames = [...games];
    nextGames[team] += 1;
    const nextGameScores = [...gameScores, nextScores];
    setGames(nextGames);
    setGameScores(nextGameScores);
    setScorerMessage(`Game to ${teamName(match.players[team])} · ${nextScores[0]}–${nextScores[1]}`);

    if (nextGames[team] >= gamesNeeded) {
      runPointCelebration(announcement, () => {
        setPaused(true);
        finish({ scores: nextScores, games: nextGames, gameScores: nextGameScores, winner: team });
      });
    } else {
      runPointCelebration(announcement, () => {
        const nextTeam = 1 - team;
        setScores([0, 0]);
        setServer(nextTeam);
        setServingPlayerIndex(0);
        setServiceNumber(match.matchType === 'doubles' ? 2 : 1);
      });
    }
  };



  const undo = () => {
    if (!history.length || paused || pointPause || finishedRef.current) return;
    const previous = history[history.length - 1];
    setScores(previous.scores);
    setGames(previous.games);
    setGameScores(previous.gameScores);
    setServer(previous.server);
    setServingPlayerIndex(previous.servingPlayerIndex);
    setServiceNumber(previous.serviceNumber);
    setHistory((items) => items.slice(0, -1));
    setScorerMessage(`Last rally removed · ${previous.scores[0]}–${previous.scores[1]}`);
    bounceBall();
  };

  const endEarly = () => {
    const winner = games[0] !== games[1] ? (games[0] > games[1] ? 0 : 1) : scores[0] !== scores[1] ? (scores[0] > scores[1] ? 0 : 1) : null;
    setShowEnd(false);
    finish({ scores, games, gameScores: [...gameScores, scores], winner }, 'ended');
  };

  const saveUnfinished = () => {
    setShowEnd(false);
    finish({ scores, games, gameScores, server, servingPlayerIndex, serviceNumber, winner: null }, 'unfinished');
  };

  return (
    <ScrollView contentContainerStyle={styles.liveContent} showsVerticalScrollIndicator={false}>
      <View style={styles.liveHero}>
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

      {paused && <View style={styles.pausedBanner}><Icon name="pause-circle" color={C.teal} /><Text style={styles.pausedText}>Match paused — scoring is locked.</Text></View>}
      {pointPause && <View style={styles.pointPauseBanner}><Icon name="time-outline" color={C.brick} /><View style={styles.flex}><Text style={styles.pointPauseTitle}>Rally confirmed</Text><Text style={styles.pointPauseText}>Court pauses for 3 seconds while score and serving rotation update.</Text></View></View>}

      <LiveCourt match={match} ballBounce={ballBounce} rallyTravel={rallyTravel} scorerMessage={scorerMessage} paused={scoringLocked} scores={scores} server={server} servingPlayerIndex={servingPlayerIndex} serviceNumber={serviceNumber} celebration={celebration} pointAnnouncement={pointAnnouncement} />

      <FocusTracker challenge={match.focusChallenge} returns={focusReturns} paused={scoringLocked} onRecord={(deep) => setFocusReturns((items) => items.length < match.focusChallenge.attempts ? [...items, deep] : items)} onUndo={() => setFocusReturns((items) => items.slice(0, -1))} />

      <View style={styles.scorerActions}><View style={styles.scorerActionHead}><View><Text style={styles.eyebrow}>WHO WON THE RALLY?</Text><Text style={styles.scorerActionTitle}>One tap updates score and serve</Text><Text style={styles.scorerActionMeta}>{match.players[server][servingPlayerIndex]} serving · Server {serviceNumber}</Text></View><View style={[styles.teamBadge, server === 1 && styles.teamBadgeAway]}><Text style={styles.teamBadgeText}>T{server + 1}</Text></View></View><View style={styles.rallyWinnerButtons}>{[0, 1].map((team) => <Pressable key={team} accessibilityLabel={`${teamName(match.players[team])} won the rally`} disabled={scoringLocked} onPress={() => recordRally(team)} onLongPress={() => { if (match.matchType === 'doubles') setManualServeTeam(team); else recordRally(team, 0); }} style={({ pressed }) => [styles.rallyWinnerButton, team === 1 && styles.rallyWinnerButtonAway, scoringLocked && styles.pointDisabled, pressed && !scoringLocked && styles.pressed]}><Text style={styles.rallyWinnerTag}>TEAM {team + 1}</Text><Text numberOfLines={2} style={styles.rallyWinnerName}>{teamName(match.players[team])}</Text><Text style={styles.rallyWinnerAction}>WON RALLY</Text></Pressable>)}</View><Text style={styles.autoServeHint}><Icon name="flash-outline" size={11} color={C.teal} /> Serving rotation updates automatically</Text></View>

      <View style={styles.controls}>
        <Pressable accessibilityLabel="Undo last point" disabled={!history.length || scoringLocked} onPress={undo} style={({ pressed }) => [styles.controlButton, (!history.length || scoringLocked) && styles.controlDisabled, pressed && styles.pressed]}><Icon name="arrow-undo-outline" color={!history.length || scoringLocked ? C.ink40 : C.teal} /><Text style={[styles.controlText, (!history.length || scoringLocked) && styles.controlTextDisabled]}>Undo</Text></Pressable>
        <Pressable accessibilityLabel={paused ? 'Resume match' : 'Pause match'} disabled={pointPause} onPress={() => setPaused((value) => !value)} style={({ pressed }) => [styles.controlButton, styles.pauseButton, pointPause && styles.controlDisabled, pressed && !pointPause && styles.pressed]}><Icon name={paused ? 'play' : 'pause'} color="#0E2321" /><Text style={styles.pauseText}>{paused ? 'Resume' : 'Pause'}</Text></Pressable>
      </View>

      <View style={styles.gamesCard}>
        <View style={styles.gamesHead}><View><Text style={styles.eyebrow}>MATCH CARD</Text><Text style={styles.gamesTitle}>Games</Text></View><Text style={styles.gamesCount}>{games[0]} – {games[1]}</Text></View>
        {gameScores.length ? gameScores.map((game, index) => <View key={`game-${index + 1}`} style={styles.gameRow}><Text style={styles.gameLabel}>Game {index + 1}</Text><Text style={styles.gameScore}>{game[0]} – {game[1]}</Text></View>) : <Text style={styles.noGamesText}>Completed games will appear here.</Text>}
      </View>

      <Pressable onPress={() => setShowEnd(true)} style={({ pressed }) => [styles.endLink, pressed && styles.pressed]}><Icon name="flag-outline" size={17} color={C.brick} /><Text style={styles.endLinkText}>End match early</Text></Pressable>
      <ConfirmEndModal visible={showEnd} onCancel={() => setShowEnd(false)} onConfirm={endEarly} onSaveUnfinished={saveUnfinished} />
      <ServerSelectionModal visible={manualServeTeam !== null} teamName={manualServeTeam !== null ? teamName(match.players[manualServeTeam]) : ''} players={manualServeTeam !== null ? match.players[manualServeTeam] : []} onCancel={() => setManualServeTeam(null)} onSelect={(playerIndex) => { recordRally(manualServeTeam, playerIndex); setManualServeTeam(null); }} />
    </ScrollView>
  );
}

function ResultScreen({ result, onRematch, onNewMatch }) {
  const winnerName = result.winner === null ? null : teamName(result.players[result.winner]);
  const completeScores = result.gameScores.length ? result.gameScores : [result.scores];
  const focusSuccesses = result.focusReturns?.filter(Boolean).length || 0;
  const focusComplete = result.focusChallenge && result.focusReturns?.length >= result.focusChallenge.attempts;
  const focusAchieved = focusComplete && focusSuccesses >= result.focusChallenge.target;

  return (
    <ScrollView contentContainerStyle={[styles.content, styles.resultContent]} showsVerticalScrollIndicator={false}>
      <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'flex-start', marginTop: -15, marginBottom: 10 }}>
        <Pressable accessibilityRole="button" onPress={onNewMatch} style={({ pressed }) => [{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, pressed && styles.pressed]}>
          <Icon name="arrow-back" size={20} color={C.ink} />
        </Pressable>
      </View>
      <View style={styles.resultIcon}><Icon name={winnerName ? 'trophy' : 'flag'} size={34} /></View>
      <Text style={styles.eyebrow}>{result.reason === 'completed' ? 'MATCH COMPLETE' : 'MATCH ENDED'}</Text>
      <Text style={styles.resultTitle}>{winnerName ? `${winnerName} wins!` : 'Match drawn.'}</Text>
      <Text style={styles.resultLead}>{result.mode === 'ranked' ? `Your ranked result at ${result.court.name} is recorded.` : `Good game at ${result.court.name} — your result is ready.`}</Text>

      <View style={styles.resultScoreCard}>
        <View style={styles.resultTeams}>
          {[0, 1].map((team) => <View key={team} style={styles.resultTeam}><Text numberOfLines={2} style={styles.resultTeamName}>{teamName(result.players[team])}</Text><Text style={[styles.resultGames, result.winner === team && styles.resultGamesWinner]}>{result.games[team]}</Text><Text style={styles.resultGamesLabel}>GAMES</Text></View>)}
        </View>
        <View style={styles.resultDivider} />
        {completeScores.map((game, index) => <View key={`result-game-${index + 1}`} style={styles.resultGameRow}><Text style={styles.resultGameLabel}>GAME {index + 1}</Text><Text style={styles.resultGameScore}>{game[0]} — {game[1]}</Text></View>)}
      </View>

      <View style={styles.resultStats}>
        <View style={styles.resultStat}><Icon name="time-outline" color={C.teal} /><Text style={styles.resultStatValue}>{formatTime(result.elapsed)}</Text><Text style={styles.resultStatLabel}>DURATION</Text></View>
        <View style={styles.resultStat}><Icon name="tennisball-outline" color={C.teal} /><Text style={styles.resultStatValue}>{completeScores.reduce((total, game) => total + game[0] + game[1], 0)}</Text><Text style={styles.resultStatLabel}>POINTS</Text></View>
        <View style={styles.resultStat}><Icon name={result.mode === 'ranked' ? 'podium-outline' : 'happy-outline'} color={C.teal} /><Text style={styles.resultStatValue}>{result.mode === 'ranked' ? 'Ranked' : 'Casual'}</Text><Text style={styles.resultStatLabel}>PLAY TYPE</Text></View>
      </View>

      {result.focusChallenge && (
        <View style={[styles.focusResultCard, focusAchieved && styles.focusResultAchieved]}>
          <View style={styles.focusResultIcon}><Icon name={focusAchieved ? 'checkmark' : 'locate'} size={21} /></View>
          <View style={styles.flex}><Text style={styles.focusTrackerEyebrow}>{focusAchieved ? 'FOCUS GOAL ACHIEVED' : focusComplete ? 'FOCUS GOAL RESULT' : 'FOCUS GOAL INCOMPLETE'}</Text><Text style={styles.focusResultTitle}>{focusSuccesses} of {result.focusReturns.length} returns landed past mid-court</Text><Text style={styles.focusResultMeta}>{focusAchieved ? 'Great depth. Keep this target for your next match.' : focusComplete ? `Target: ${result.focusChallenge.target} of ${result.focusChallenge.attempts}.` : `Record all ${result.focusChallenge.attempts} returns next time to complete the challenge.`}</Text></View>
        </View>
      )}

      <Pressable onPress={onRematch} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}><Icon name="refresh" color="#0E2321" /><Text style={styles.primaryText}>Play a rematch</Text></Pressable>
      <Pressable onPress={onNewMatch} style={({ pressed }) => [styles.newMatchButton, pressed && styles.pressed]}><Icon name="options-outline" color={C.teal} /><Text style={styles.newMatchText}>Set up a new match</Text></Pressable>
    </ScrollView>
  );
}

export default function PlayScreen({ route }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { user } = useAuth();
  const nearbyPresence = useNearbyPlayers(25);
  const [courts, setCourts] = useState([]);
  const [screen, setScreen] = useState('setup');
  const [match, setMatch] = useState(null);
  const [result, setResult] = useState(null);
  const [focusChallenge, setFocusChallenge] = useState(null);
  const [openPlay, setOpenPlay] = useState(false);
  const [unfinishedMatch, setUnfinishedMatch] = useState(null);
  const handledStartToken = useRef(null);
  const handledFocusToken = useRef(null);

  useEffect(() => {
    listVenues().then((venues) => {
      setCourts(venues.flatMap((venue) => venue.courts.filter((court) => court.active).map((court) => ({ id: court.id, name: venue.name, detail: `${court.name} · ${court.environment}`, distance: venue.area, next: 'Available by booking schedule', color: venue.color || C.teal }))));
    }).catch((error) => console.warn('Play setup data failed:', error.message));
  }, []);

  useEffect(() => {
    loadUnfinishedMatch().then(setUnfinishedMatch).catch((error) => console.warn('Unfinished match load failed:', error.message));
  }, [user?.id]);

  const startMatch = (configuration) => {
    setMatch(configuration);
    setResult(null);
    setScreen('pregame');
  };

  const startLiveMatch = (serveDraw) => {
    setMatch((current) => ({ ...current, firstServer: serveDraw.team, firstServerPlayer: serveDraw.player }));
    setScreen('live');
  };

  const finishMatch = async (finishedResult) => {
    if (finishedResult.reason === 'unfinished') {
      setUnfinishedMatch(finishedResult);
      setMatch(null);
      setResult(null);
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
    if (finishedResult.savedMatchId) setUnfinishedMatch(null);
    saveCompletedMatch(user.id, finishedResult, user.name).catch((error) => console.warn('Match save failed:', error.message));
  };

  const resumeMatch = () => {
    if (!unfinishedMatch) return;
    setMatch(unfinishedMatch);
    setResult(null);
    setScreen('live');
  };

  const reset = () => {
    setMatch(null);
    setResult(null);
    setFocusChallenge(null);
    setScreen('setup');
    setOpenPlay(false);
  };

  useEffect(() => {
    const token = route?.params?.focusChallengeToken;
    if (!token || handledFocusToken.current === token) return;
    handledFocusToken.current = token;
    setFocusChallenge(route.params.focusChallenge);
    setMatch(null);
    setResult(null);
    setScreen('setup');
    setOpenPlay(false);
  }, [route?.params?.focusChallengeToken, route?.params?.focusChallenge]);

  useEffect(() => {
    const token = route?.params?.startLiveToken;
    if (!token || handledStartToken.current === token) return;
    handledStartToken.current = token;
    setMatch(null);
    setResult(null);
    setScreen('setup');
    setOpenPlay(false);
  }, [route?.params?.startLiveToken]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={screen === 'live' || isDark ? 'light' : 'dark'} backgroundColor={screen === 'live' ? '#0E2321' : C.paper} />
      {openPlay ? <OpenPlayScreen onExit={() => setOpenPlay(false)} /> : <>
      {screen === 'setup' && <SetupScreen courts={courts} nearbyPlayers={nearbyPresence.players} nearbyPresence={nearbyPresence} currentUserName={user?.name} currentUserId={user?.id} currentUserAvatar={user?.picture} onStart={startMatch} focusChallenge={focusChallenge} onOpenPlay={() => setOpenPlay(true)} unfinishedMatch={unfinishedMatch} onResume={resumeMatch} />}
      {screen === 'pregame' && match && <PreGameScreen match={match} onBack={() => setScreen('setup')} onStart={startLiveMatch} />}
      {screen === 'live' && match && <LiveMatch match={match} onFinish={finishMatch} />}
      {screen === 'result' && result && <ResultScreen result={result} onRematch={() => startMatch(match)} onNewMatch={reset} />}
      </>}
    </SafeAreaView>
  );
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: .09, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } }, android: { elevation: 4 } });

const lightStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 42 },
  resumeCard: { marginTop: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: '#B9D22C', backgroundColor: '#FAFCEB' }, resumeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, resumeEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, resumeTitle: { marginTop: 2, color: C.ink, fontSize: 10, fontWeight: '900' }, resumeMeta: { marginTop: 2, color: C.ink40, fontSize: 7, lineHeight: 11 }, resumeButton: { minHeight: 34, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, backgroundColor: C.teal }, resumeButtonText: { color: C.surface, fontSize: 8, fontWeight: '900' },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, headerCopy: { flex: 1 },
  eyebrow: { color: C.ink40, fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1 }, h1: { color: C.ink, fontSize: 29, lineHeight: 35, fontWeight: '800', letterSpacing: -.8 },
  kitchen: { height: 7, marginTop: 18, marginBottom: 20 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 }, solidLight: { backgroundColor: 'rgba(255,255,255,.78)' }, dashedLight: { borderColor: 'rgba(255,255,255,.38)' },
  liveChip: { minHeight: 34, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 18, backgroundColor: '#E5F0ED' }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.teal }, liveChipText: { color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .7 },
  invitesCard: { marginBottom: 12, padding: 13, borderRadius: 17, borderWidth: 1, borderColor: '#B9D22C', backgroundColor: '#FAFCEB' }, invitesTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, inviteBell: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, invitesEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, invitesTitle: { marginTop: 2, color: C.ink, fontSize: 11, fontWeight: '900' }, inviteRequest: { minHeight: 52, marginTop: 9, paddingTop: 9, flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: 1, borderColor: '#DFE8AD' }, inviteRequestCopy: { flex: 1, minWidth: 0 }, inviteSender: { color: C.ink, fontSize: 10, fontWeight: '900' }, inviteDetail: { marginTop: 2, color: C.ink40, fontSize: 7, lineHeight: 10 }, declineInvite: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E8C7BF', backgroundColor: C.surface }, acceptInvite: { minWidth: 62, height: 34, paddingHorizontal: 9, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: C.optic }, acceptInviteText: { color: C.ink, fontSize: 8, fontWeight: '900' },
  introCard: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.optic }, introIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(255,255,255,.48)' }, introCopy: { flex: 1 }, introTitle: { color: C.ink, fontSize: 14, fontWeight: '800' }, bodySmall: { marginTop: 3, color: C.ink40, fontSize: 10, lineHeight: 15 },
  openPlayEntry: { minHeight: 78, marginBottom: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.teal, backgroundColor: C.surface }, openPlayEntryIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, openPlayEntryEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, openPlayEntryTitle: { marginTop: 2, color: C.ink, fontSize: 11, fontWeight: '900' }, openPlayEntryMeta: { marginTop: 3, color: C.ink40, fontSize: 7, lineHeight: 11 },
  focusSetupCard: { minHeight: 82, marginTop: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: '#B9D22C', backgroundColor: '#F9FCEB' }, focusSetupIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, focusSetupCopy: { flex: 1 }, focusSetupEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, focusSetupTitle: { marginTop: 3, color: C.ink, fontSize: 10, lineHeight: 14, fontWeight: '800' }, focusSetupMeta: { marginTop: 3, color: C.ink40, fontSize: 7 },
  preGameContent: { flexGrow: 1 }, drawHero: { padding: 22, alignItems: 'center', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: C.ink }, drawHeroIcon: { width: 66, height: 66, marginBottom: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 33, borderWidth: 6, borderColor: 'rgba(255,255,255,.16)', backgroundColor: C.optic }, drawEyebrow: { color: '#9FB3AC', fontSize: 8, fontWeight: '900', letterSpacing: 1 }, drawTitle: { marginTop: 4, color: C.surface, fontSize: 24, lineHeight: 30, fontWeight: '900', textAlign: 'center' }, drawLead: { maxWidth: 300, marginTop: 6, color: '#CBD7D2', fontSize: 10, lineHeight: 15, textAlign: 'center' }, drawTeams: { marginTop: 13, flexDirection: 'row', alignItems: 'stretch', gap: 10 }, drawTeam: { flex: 1, minHeight: 218, padding: 13, alignItems: 'center', borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, drawTeamAway: { backgroundColor: '#FFFDFC' }, drawTeamWinner: { borderWidth: 2, borderColor: C.optic, backgroundColor: '#FAFCEB' }, drawTeamBadge: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.teal }, drawTeamBadgeAway: { backgroundColor: C.brick }, drawTeamBadgeText: { color: C.surface, fontSize: 9, fontWeight: '900' }, drawTeamName: { minHeight: 38, marginTop: 9, color: C.ink, fontSize: 11, lineHeight: 15, fontWeight: '900', textAlign: 'center' }, serverChoices: { width: '100%', marginTop: 5, marginBottom: 12, gap: 6 }, serverChoice: { minHeight: 34, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, serverChoiceSelected: { borderColor: '#B9D22C', backgroundColor: C.optic }, serverChoiceText: { flex: 1, color: C.ink70, fontSize: 7, fontWeight: '800' }, serverChoiceTextSelected: { color: C.ink, fontWeight: '900' }, drawServeStatus: { minHeight: 29, marginTop: 'auto', paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 15, backgroundColor: C.paper }, drawServeStatusActive: { backgroundColor: C.optic }, drawServeStatusText: { color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .5 }, drawServeStatusTextActive: { color: C.ink }, preGameSummary: { marginTop: 13, paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, preGameSummaryRow: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: C.line }, preGameSummaryLabel: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, preGameSummaryValue: { marginTop: 2, color: C.ink, fontSize: 11, fontWeight: '900' }, preGameBack: { alignSelf: 'center', minHeight: 44, marginTop: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 }, preGameBackText: { color: C.ink40, fontSize: 9, fontWeight: '700' },
  quickStartButton: { minHeight: 60, marginTop: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, backgroundColor: C.ink }, quickStartIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: C.optic }, quickStartCopy: { flex: 1, minWidth: 0 }, quickStartTitle: { color: C.surface, fontSize: 11, fontWeight: '900' }, quickStartMeta: { marginTop: 3, color: 'rgba(255,255,255,.58)', fontSize: 7 },
  fieldGroup: { marginTop: 22 }, sectionLabel: { marginBottom: 8, color: C.ink, fontSize: 10, fontWeight: '800', letterSpacing: .9 },
  segment: { padding: 4, flexDirection: 'row', gap: 4, borderRadius: 14, backgroundColor: C.surface }, segmentItem: { flex: 1, minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10 }, segmentActive: { backgroundColor: C.optic, ...shadow }, segmentText: { color: C.ink40, fontSize: 11, fontWeight: '700' }, segmentTextActive: { color: C.ink, fontWeight: '800' },
  nearbyCard: { marginTop: 14, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, nearbyHead: { paddingBottom: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, nearbySubtitle: { marginTop: -4, color: C.ink40, fontSize: 9, lineHeight: 13 }, visibilityButton: { minWidth: 80, minHeight: 34, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 17, backgroundColor: C.paper }, visibilityButtonOn: { backgroundColor: C.optic }, visibilityDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.ink40 }, visibilityDotOn: { backgroundColor: C.ink }, visibilityText: { color: C.ink40, fontSize: 6, fontWeight: '900', letterSpacing: .45 }, visibilityTextOn: { color: C.ink }, nearbyCountRow: { paddingVertical: 5, borderTopWidth: 1, borderColor: C.line }, nearbyCount: { alignSelf: 'flex-start', paddingHorizontal: 7, minHeight: 23, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, backgroundColor: '#E5F0ED' }, nearbyCountText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .4 }, nearbyError: { marginBottom: 6, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11, backgroundColor: '#F9ECE8' }, nearbyErrorText: { flex: 1, color: C.brick, fontSize: 8, lineHeight: 12 }, nearbyEmpty: { paddingVertical: 15, alignItems: 'center', borderTopWidth: 1, borderColor: C.line }, nearbyEmptyTitle: { marginTop: 5, color: C.ink, fontSize: 10, fontWeight: '900' }, nearbyEmptyText: { maxWidth: 250, marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12, textAlign: 'center' }, nearbyPlayer: { minHeight: 61, flexDirection: 'row', alignItems: 'center', gap: 9 }, nearbyPlayerBorder: { borderTopWidth: 1, borderColor: C.line }, nearbyAvatar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 }, nearbyAvatarText: { color: C.surface, fontSize: 9, fontWeight: '900' }, nearbyCopy: { flex: 1 }, nearbyName: { color: C.ink, fontSize: 11, fontWeight: '800' }, nearbyMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, inviteButton: { minWidth: 66, minHeight: 32, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 10, backgroundColor: C.optic }, inviteButtonAdded: { borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' }, inviteButtonDisabled: { backgroundColor: C.paper }, inviteButtonText: { color: C.ink, fontSize: 8, fontWeight: '900' }, inviteButtonTextAdded: { color: C.teal }, inviteButtonTextDisabled: { color: C.ink40 },
  courtSelect: { minHeight: 70, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: C.teal, backgroundColor: C.surface }, courtSelectChosen: { borderStyle: 'solid', borderColor: C.line }, courtSelectIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E5F0ED' }, courtSelectCopy: { flex: 1 }, courtSelectName: { color: C.ink, fontSize: 12, fontWeight: '800' }, courtSelectDetail: { marginTop: 4, color: C.ink40, fontSize: 8, lineHeight: 12 },
  scorerPicker: { marginTop: 9, paddingHorizontal: 11, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, scorerOption: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: C.line }, scorerOptionSelected: { marginHorizontal: -11, paddingHorizontal: 11, borderRadius: 14, borderBottomColor: 'transparent', backgroundColor: '#F4F9F7' }, scorerOptionAvatar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, scorerOptionInitials: { color: C.surface, fontSize: 9, fontWeight: '900' }, scorerOptionCopy: { flex: 1 }, scorerOptionName: { color: C.ink, fontSize: 11, fontWeight: '900' }, scorerOptionMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, scorerHint: { marginTop: 8, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }, scorerHintText: { flex: 1, color: C.ink40, fontSize: 8, lineHeight: 12 }, scorerReady: { paddingHorizontal: 7, minHeight: 25, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 13, backgroundColor: '#E5F0ED' }, scorerReadyText: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .4 },
  courtModel: { height: 250, padding: 10, overflow: 'hidden', borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, ...shadow },
  courtGlow: { position: 'absolute', width: 260, height: 260, top: -150, right: -85, borderRadius: 130, backgroundColor: 'rgba(255,255,255,.08)' },
  courtGrain: { ...StyleSheet.absoluteFillObject, borderWidth: 10, borderColor: 'rgba(5,38,35,.12)' },
  courtOutline: { ...StyleSheet.absoluteFillObject, margin: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,.72)' },
  kitchenZone: { position: 'absolute', left: 16, right: 16, height: 31, backgroundColor: 'rgba(216,233,74,.07)' }, kitchenZoneTop: { top: 94 }, kitchenZoneBottom: { top: 125 },
  courtCenterLine: { position: 'absolute', alignSelf: 'center', width: 2, backgroundColor: 'rgba(255,255,255,.48)' }, courtCenterLineTop: { top: 16, height: 78 }, courtCenterLineBottom: { top: 156, bottom: 16 },
  courtKitchenTop: { position: 'absolute', top: 93, left: 16, right: 16, height: 2, backgroundColor: 'rgba(255,255,255,.72)' }, courtKitchenBottom: { position: 'absolute', top: 155, left: 16, right: 16, height: 2, backgroundColor: 'rgba(255,255,255,.72)' },
  courtNetShadow: { position: 'absolute', zIndex: 2, top: 126, left: 7, right: 7, height: 8, backgroundColor: 'rgba(5,25,23,.2)' },
  courtNet: { position: 'absolute', top: 120, left: 7, right: 7, height: 13, zIndex: 4 }, courtNetSolid: { height: 3, backgroundColor: C.surface }, courtNetMesh: { height: 7, backgroundColor: 'rgba(14,35,33,.38)', borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,.6)' }, courtNetDash: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.72)' }, netPost: { position: 'absolute', zIndex: 2, left: -3, top: -3, width: 5, height: 18, borderRadius: 2, backgroundColor: C.surface }, netPostRight: { left: undefined, right: -3 },
  venuePill: { position: 'absolute', zIndex: 2, top: 6, alignSelf: 'center', width: 124, minHeight: 20, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 10, backgroundColor: C.ink }, venuePillText: { flexShrink: 1, color: C.surface, fontSize: 6, fontWeight: '900', letterSpacing: .5 },
  courtSide: { position: 'absolute', top: 28, left: 18, right: 18, height: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }, courtSideAway: { top: 150 }, courtPlayer: { width: '45%', alignItems: 'center' }, courtPlayerSingle: { width: '72%' }, playerMarkerShadow: { position: 'absolute', top: 30, width: 40, height: 11, borderRadius: 20, backgroundColor: 'rgba(5,25,23,.2)' }, courtPlayerInitials: { width: 40, height: 40, paddingTop: 11, overflow: 'hidden', borderRadius: 20, borderWidth: 3, borderColor: C.surface, color: '#0E2321', backgroundColor: C.optic, fontSize: 9, fontWeight: '900', textAlign: 'center', ...shadow }, courtPlayerAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: C.surface, backgroundColor: C.optic, ...shadow }, courtPlayerName: { maxWidth: 105, marginTop: 4, paddingHorizontal: 7, paddingVertical: 3, overflow: 'hidden', borderRadius: 8, color: C.surface, backgroundColor: 'rgba(14,35,33,.82)', fontSize: 7, fontWeight: '800', textAlign: 'center' }, courtSwap: { position: 'absolute', zIndex: 6, top: 102, alignSelf: 'center', width: 60, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, borderWidth: 3, borderColor: C.surface, backgroundColor: C.optic, ...shadow }, courtSwapText: { color: C.ink, fontSize: 5, fontWeight: '900', letterSpacing: .6 }, lineupHint: { marginTop: 10, marginBottom: 12, color: C.ink40, fontSize: 9, lineHeight: 13, textAlign: 'center' },
  teamsGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 8 }, teamSetup: { flex: 1, minWidth: 140, padding: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, teamSetupHead: { marginBottom: 2, flexDirection: 'row', alignItems: 'center', gap: 6 }, teamBar: { width: 18, height: 4, borderRadius: 2, backgroundColor: C.teal }, teamBarAway: { backgroundColor: C.brick }, teamLabel: { color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: .8 },
  playerInputWrap: { minHeight: 50, marginTop: 7, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: '#E8ECE5', backgroundColor: C.paper }, playerNumber: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: C.teal }, playerNumberAway: { backgroundColor: C.brick }, playerNumberText: { color: C.surface, fontSize: 8, fontWeight: '900' }, playerInputCopy: { flex: 1, minWidth: 0 }, playerInput: { minWidth: 0, paddingVertical: 0, color: C.ink, fontSize: 10, fontWeight: '800' }, playerStatus: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 3 }, playerStatusDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.optic }, playerStatusText: { flexShrink: 1, color: C.ink40, fontSize: 5, fontWeight: '800', letterSpacing: .35 },
  settingRow: { marginTop: 22, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, settingIcon: { width: 39, height: 39, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, settingCopy: { flex: 1 }, settingTitle: { color: C.ink, fontSize: 12, fontWeight: '800' }, toggle: { width: 42, height: 24, padding: 3, borderRadius: 12, backgroundColor: C.line }, toggleOn: { backgroundColor: C.optic }, toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: C.surface }, toggleKnobOn: { alignSelf: 'flex-end' },
  rankedNote: { marginTop: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#E5F0ED' }, rankedNoteText: { flex: 1, color: C.teal, fontSize: 9, lineHeight: 14, fontWeight: '700' },
  primaryButton: { minHeight: 54, marginTop: 24, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 15, backgroundColor: C.optic }, primaryText: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '900', textAlign: 'center' }, disabled: { opacity: .45 }, validation: { marginTop: 8, color: C.brick, fontSize: 9, textAlign: 'center' }, pressed: { opacity: .78, transform: [{ scale: .985 }] },
  liveContent: { paddingBottom: 42 }, liveHero: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, backgroundColor: C.ink }, liveHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }, heroIconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, borderWidth: 1, borderColor: 'rgba(255,255,255,.2)' }, liveHeaderCopy: { flex: 1 }, liveEyebrow: { color: 'rgba(255,255,255,.55)', fontSize: 8, fontWeight: '800', letterSpacing: .9 }, liveTitle: { marginTop: 2, color: C.surface, fontSize: 23, fontWeight: '800' }, timerChip: { minHeight: 34, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 17, backgroundColor: 'rgba(255,255,255,.12)' }, timerText: { color: C.surface, fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] }, matchMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, matchMetaText: { color: 'rgba(255,255,255,.62)', fontSize: 7, fontWeight: '800', letterSpacing: .5 }, metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: C.optic },
  pausedBanner: { marginHorizontal: 20, marginTop: 14, padding: 11, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, borderRadius: 11, backgroundColor: '#E5F0ED' }, pausedText: { color: C.teal, fontSize: 10, fontWeight: '800' }, pointPauseBanner: { marginHorizontal: 20, marginTop: 12, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#F7EAE6' }, pointPauseTitle: { color: C.brick, fontSize: 10, fontWeight: '900' }, pointPauseText: { marginTop: 2, color: C.ink40, fontSize: 7, lineHeight: 11 },
  focusTracker: { marginHorizontal: 20, marginTop: 14, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, focusTrackerAchieved: { borderColor: '#B9D22C', backgroundColor: '#FAFCEB' }, focusTrackerMissed: { borderColor: '#E2B5A9', backgroundColor: '#FFF9F7' }, focusTrackerHead: { flexDirection: 'row', alignItems: 'center', gap: 9 }, focusTrackerIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, focusTrackerCopy: { flex: 1 }, focusTrackerEyebrow: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, focusTrackerTitle: { marginTop: 3, color: C.ink, fontSize: 10, lineHeight: 14, fontWeight: '800' }, focusTrackerScore: { color: C.ink, fontSize: 21, fontWeight: '900' }, returnDots: { marginTop: 13, flexDirection: 'row', justifyContent: 'space-between', gap: 3 }, returnDot: { flex: 1, aspectRatio: 1, maxWidth: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, returnDotDeep: { borderColor: C.teal, backgroundColor: C.teal }, returnDotShort: { borderColor: '#E2B5A9', backgroundColor: '#F7EAE6' }, returnDotText: { color: C.ink40, fontSize: 7, fontWeight: '900' }, returnDotTextRecorded: { color: C.surface }, returnActions: { marginTop: 13, flexDirection: 'row', gap: 8 }, returnButton: { flex: 1, minHeight: 45, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12 }, returnButtonDeep: { backgroundColor: C.teal }, returnButtonShort: { borderWidth: 1, borderColor: '#E2B5A9', backgroundColor: '#F7EAE6' }, returnButtonText: { color: C.surface, fontSize: 9, fontWeight: '900' }, returnButtonShortText: { color: C.brick, fontSize: 9, fontWeight: '900' }, returnUndo: { alignSelf: 'center', minHeight: 34, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4 }, returnUndoText: { color: C.ink40, fontSize: 8, fontWeight: '700' }, focusTrackerResult: { marginTop: 12, color: C.ink70, fontSize: 9, lineHeight: 14, fontWeight: '700', textAlign: 'center' },
  liveCourtCard: { marginHorizontal: 20, marginTop: 16, overflow: 'hidden', borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, liveCourtHead: { minHeight: 62, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, liveCourtEyebrow: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .8 }, liveCourtTitle: { marginTop: 1, color: C.ink, fontSize: 17, fontWeight: '900' }, liveNowPill: { minHeight: 27, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: C.ink }, liveNowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.optic }, liveNowText: { color: C.surface, fontSize: 7, fontWeight: '900', letterSpacing: .6 },
  liveCourt: { height: 220, marginHorizontal: 10, overflow: 'hidden', borderRadius: 15 }, liveCourtBounds: { ...StyleSheet.absoluteFillObject, margin: 13, borderWidth: 2, borderColor: 'rgba(255,255,255,.72)' }, liveCourtCenterTop: { position: 'absolute', top: 13, alignSelf: 'center', width: 2, height: 68, backgroundColor: 'rgba(255,255,255,.55)' }, liveCourtCenterBottom: { position: 'absolute', top: 139, bottom: 13, alignSelf: 'center', width: 2, backgroundColor: 'rgba(255,255,255,.55)' }, liveCourtKitchenTop: { position: 'absolute', top: 80, left: 13, right: 13, height: 2, backgroundColor: 'rgba(255,255,255,.72)' }, liveCourtKitchenBottom: { position: 'absolute', top: 138, left: 13, right: 13, height: 2, backgroundColor: 'rgba(255,255,255,.72)' }, liveCourtNet: { position: 'absolute', zIndex: 2, top: 107, left: 5, right: 5, height: 7, borderTopWidth: 3, borderBottomWidth: 1, borderColor: C.surface, backgroundColor: 'rgba(14,35,33,.42)' },
  liveCourtTeam: { position: 'absolute', zIndex: 3, top: 20, left: 24, right: 24, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }, liveCourtTeamAway: { top: 148 }, liveCourtPlayer: { maxWidth: '46%', alignItems: 'center' }, livePlayerMarker: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, borderWidth: 2, borderColor: C.surface, backgroundColor: C.ink }, livePlayerMarkerAway: { backgroundColor: C.brick }, livePlayerServing: { borderWidth: 4, borderColor: C.optic }, livePlayerInitials: { color: C.surface, fontSize: 8, fontWeight: '900' }, livePlayerName: { maxWidth: 105, marginTop: 3, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden', borderRadius: 7, color: C.surface, backgroundColor: 'rgba(14,35,33,.78)', fontSize: 6, fontWeight: '800' }, courtScoreBar: { position: 'absolute', zIndex: 8, top: 90, alignSelf: 'center', minWidth: 150, height: 40, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 2, borderColor: 'rgba(255,255,255,.35)', backgroundColor: 'rgba(14,35,33,.9)' }, courtScoreTeam: { flexDirection: 'row', alignItems: 'center', gap: 6 }, courtScoreTag: { color: C.optic, fontSize: 7, fontWeight: '900' }, courtScoreTagAway: { color: '#F5A58F' }, courtScoreNumber: { width: 25, color: C.surface, textAlign: 'center', fontSize: 21, fontWeight: '900' }, courtGamePill: { marginHorizontal: 6, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(255,255,255,.1)' }, courtGameText: { color: 'rgba(255,255,255,.62)', fontSize: 5, fontWeight: '900', letterSpacing: .4 }, pointAnnouncement: { position: 'absolute', zIndex: 12, left: 22, right: 22, top: 35, bottom: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: 'rgba(14,35,33,.92)' }, pointAnnouncementPlayer: { color: C.optic, fontSize: 16, fontWeight: '900', textAlign: 'center' }, pointAnnouncementTeam: { maxWidth: '90%', marginTop: 3, color: C.surface, fontSize: 10, fontWeight: '800', textAlign: 'center' }, pointAnnouncementText: { marginTop: 6, color: 'rgba(255,255,255,.58)', fontSize: 8, fontWeight: '900', letterSpacing: 1.2 }, pointAnnouncementScore: { marginTop: 3, color: C.surface, fontSize: 25, fontWeight: '900' }, pointAnnouncementServe: { maxWidth: '92%', marginTop: 5, color: C.optic, textAlign: 'center', fontSize: 8, fontWeight: '800' },
  liveBall: { position: 'absolute', zIndex: 6, top: 98, left: '50%', marginLeft: -12, width: 25, height: 25, borderRadius: 13, borderWidth: 2, borderColor: 'rgba(14,35,33,.18)', backgroundColor: C.optic }, liveBallShadow: { position: 'absolute', zIndex: 5, top: 119, left: '50%', marginLeft: -13, width: 26, height: 7, borderRadius: 13, backgroundColor: C.ink }, ballHoleOne: { position: 'absolute', top: 5, left: 6, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(14,35,33,.36)' }, ballHoleTwo: { position: 'absolute', top: 12, right: 5, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(14,35,33,.36)' }, ballHoleThree: { position: 'absolute', bottom: 4, left: 8, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(14,35,33,.36)' },
  scorerBooth: { minHeight: 86, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, scorerBoothAvatar: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: C.ink }, scorerBoothInitials: { color: C.surface, fontSize: 11, fontWeight: '900' }, scorerOnline: { position: 'absolute', right: -2, bottom: -2, width: 13, height: 13, borderRadius: 7, borderWidth: 3, borderColor: C.surface, backgroundColor: C.optic }, scorerBoothCopy: { flex: 1, minWidth: 0 }, scorerBoothLabel: { color: C.teal, fontSize: 6, fontWeight: '900', letterSpacing: .7 }, scorerBoothName: { marginTop: 2, color: C.ink, fontSize: 11, fontWeight: '900' }, scorerMessage: { marginTop: 3, color: C.ink40, fontSize: 7 }, scorerServing: { marginTop: 3, color: C.teal, fontSize: 7, fontWeight: '800' }, scorerControlBadge: { paddingHorizontal: 7, minHeight: 27, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 9, backgroundColor: '#E5F0ED' }, scorerControlText: { color: C.teal, fontSize: 5, fontWeight: '900', letterSpacing: .4 },
  scoreboard: { marginHorizontal: 20, marginTop: 16, flexDirection: 'row', gap: 10 }, scoreTeam: { flex: 1, minHeight: 310, padding: 13, alignItems: 'center', borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, scoreTeamAway: { backgroundColor: '#FFFDFC' }, scoreTeamWinner: { borderColor: C.optic, borderWidth: 2 }, scoreTeamHead: { width: '100%', minHeight: 58, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, teamBadge: { width: 31, height: 31, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, teamBadgeAway: { backgroundColor: C.brick }, teamBadgeText: { color: C.surface, fontSize: 8, fontWeight: '900' }, scoreNameWrap: { flex: 1 }, scoreName: { color: C.ink, fontSize: 11, lineHeight: 15, fontWeight: '800' }, gamesText: { marginTop: 3, color: C.ink40, fontSize: 8 }, score: { marginTop: 8, color: C.ink, fontSize: 72, lineHeight: 80, fontWeight: '900', letterSpacing: -4, fontVariant: ['tabular-nums'] }, serveRow: { height: 24, flexDirection: 'row', alignItems: 'center', gap: 5 }, serveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.optic }, serveText: { color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .7 }, receiveText: { color: C.ink40, fontSize: 8, fontWeight: '800', letterSpacing: .5 }, pointButton: { width: '100%', minHeight: 55, marginTop: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 14, backgroundColor: C.teal }, pointButtonAway: { backgroundColor: C.brick }, pointDisabled: { opacity: .4 }, pointText: { color: C.surface, fontSize: 10, fontWeight: '900', letterSpacing: .8 },
  scorerActions: { marginHorizontal: 20, marginTop: 14, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, scorerActionHead: { marginBottom: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scorerActionTitle: { color: C.ink, fontSize: 14, fontWeight: '900' }, scorerActionMeta: { marginTop: 3, color: C.teal, fontSize: 8, fontWeight: '800' }, rallyWinnerButtons: { flexDirection: 'row', gap: 8 }, rallyWinnerButton: { minHeight: 82, flex: 1, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.teal }, rallyWinnerButtonAway: { backgroundColor: C.brick }, rallyWinnerTag: { color: 'rgba(255,255,255,.58)', fontSize: 6, fontWeight: '900', letterSpacing: .7 }, rallyWinnerName: { minHeight: 27, marginTop: 3, color: C.surface, textAlign: 'center', fontSize: 9, lineHeight: 13, fontWeight: '900' }, rallyWinnerAction: { marginTop: 3, color: C.surface, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, autoServeHint: { marginTop: 10, color: C.teal, textAlign: 'center', fontSize: 8, fontWeight: '800' }, correctServerButton: { minHeight: 40, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, correctServerText: { color: C.teal, fontSize: 9, fontWeight: '800' }, controls: { marginHorizontal: 20, marginTop: 12, flexDirection: 'row', gap: 8 }, controlButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, pauseButton: { borderColor: C.optic, backgroundColor: C.optic }, controlText: { color: C.teal, fontSize: 8, fontWeight: '800' }, pauseText: { color: C.ink, fontSize: 8, fontWeight: '900' }, controlDisabled: { opacity: .48 }, controlTextDisabled: { color: C.ink40 },
  gamesCard: { marginHorizontal: 20, marginTop: 20, padding: 14, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, gamesHead: { paddingBottom: 11, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: C.line }, gamesTitle: { color: C.ink, fontSize: 17, fontWeight: '800' }, gamesCount: { color: C.teal, fontSize: 22, fontWeight: '900' }, gameRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: C.line }, gameLabel: { color: C.ink40, fontSize: 9, fontWeight: '700' }, gameScore: { color: C.ink, fontSize: 13, fontWeight: '900' }, noGamesText: { paddingVertical: 15, color: C.ink40, fontSize: 9, textAlign: 'center' }, endLink: { alignSelf: 'center', minHeight: 42, marginTop: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 6 }, endLinkText: { color: C.brick, fontSize: 10, fontWeight: '800' },
  modalBackdrop: { flex: 1, paddingHorizontal: 16, paddingTop: 16, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.7)' }, dialog: { width: '100%', maxWidth: 390, padding: 22, alignItems: 'center', borderRadius: 22, backgroundColor: C.surface }, dialogIcon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#F7EAE6' }, dialogTitle: { marginTop: 13, color: C.ink, fontSize: 21, fontWeight: '800' }, dialogBody: { marginTop: 6, color: C.ink40, fontSize: 11, lineHeight: 17, textAlign: 'center' }, dialogActions: { width: '100%', marginTop: 20, flexDirection: 'row', gap: 8 }, secondaryButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: C.line }, secondaryText: { color: C.teal, fontSize: 10, fontWeight: '800' }, endConfirmButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.brick }, endConfirmText: { color: C.surface, fontSize: 10, fontWeight: '800' },
  saveUnfinishedButton: { width: '100%', minHeight: 50, marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, backgroundColor: C.optic }, saveUnfinishedText: { color: C.ink, fontSize: 10, fontWeight: '900' },
  courtSheet: { width: '100%', maxWidth: 420, minHeight: 220, padding: 16, overflow: 'hidden', borderRadius: 24, backgroundColor: C.paper }, courtList: { flex: 1, minHeight: 0 }, courtListContent: { paddingBottom: 6 }, sheetHandle: { alignSelf: 'center', width: 38, height: 4, marginBottom: 10, borderRadius: 2, backgroundColor: C.line }, sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sheetTitle: { color: C.ink, fontSize: 22, fontWeight: '800' }, sheetClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: C.surface }, sheetLead: { marginTop: 4, marginBottom: 2, color: C.ink40, fontSize: 10 }, courtOption: { minHeight: 70, marginTop: 8, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, courtOptionActive: { borderColor: C.teal, backgroundColor: '#F7FAF7' }, courtThumb: { width: 44, height: 50, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 10 }, courtThumbLine: { position: 'absolute', left: 6, right: 6, top: '50%', height: 1, backgroundColor: 'rgba(255,255,255,.58)' }, courtOptionCopy: { flex: 1, minWidth: 0 }, courtOptionName: { color: C.ink, fontSize: 11, fontWeight: '800' }, courtOptionDetail: { marginTop: 2, color: C.ink40, fontSize: 8 }, courtAvailable: { marginTop: 3, color: C.teal, fontSize: 8, fontWeight: '800' },
  resultContent: { alignItems: 'center', paddingTop: 38 }, resultIcon: { width: 72, height: 72, marginBottom: 15, alignItems: 'center', justifyContent: 'center', borderRadius: 23, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: C.optic }, resultTitle: { marginTop: 4, color: C.ink, fontSize: 27, lineHeight: 34, fontWeight: '900', textAlign: 'center', letterSpacing: -.6 }, resultLead: { marginTop: 4, color: C.ink40, fontSize: 11, textAlign: 'center' }, resultScoreCard: { width: '100%', marginTop: 22, padding: 16, borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, resultTeams: { flexDirection: 'row' }, resultTeam: { flex: 1, alignItems: 'center', paddingHorizontal: 5 }, resultTeamName: { minHeight: 34, color: C.ink, fontSize: 11, lineHeight: 16, fontWeight: '800', textAlign: 'center' }, resultGames: { marginTop: 8, color: C.ink40, fontSize: 46, lineHeight: 52, fontWeight: '900' }, resultGamesWinner: { color: C.teal }, resultGamesLabel: { color: C.ink40, fontSize: 7, fontWeight: '800', letterSpacing: .7 }, resultDivider: { marginVertical: 13, borderTopWidth: 1, borderColor: C.line }, resultGameRow: { minHeight: 35, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, resultGameLabel: { color: C.ink40, fontSize: 8, fontWeight: '800', letterSpacing: .6 }, resultGameScore: { color: C.ink, fontSize: 12, fontWeight: '900' },
  resultStats: { width: '100%', marginTop: 12, paddingVertical: 13, flexDirection: 'row', borderRadius: 14, backgroundColor: '#E5F0ED' }, resultStat: { flex: 1, alignItems: 'center', borderRightWidth: 1, borderColor: '#C9DCD7' }, resultStatValue: { marginTop: 4, color: C.ink, fontSize: 11, fontWeight: '900' }, resultStatLabel: { marginTop: 2, color: C.ink40, fontSize: 6, fontWeight: '800', letterSpacing: .5 },
  focusResultCard: { width: '100%', marginTop: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, focusResultAchieved: { borderColor: '#B9D22C', backgroundColor: '#FAFCEB' }, focusResultIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, focusResultTitle: { marginTop: 3, color: C.ink, fontSize: 11, lineHeight: 15, fontWeight: '900' }, focusResultMeta: { marginTop: 3, color: C.ink40, fontSize: 8, lineHeight: 12 },
  newMatchButton: { minHeight: 50, marginTop: 10, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, newMatchText: { color: C.teal, fontSize: 11, fontWeight: '800' },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
