import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import LocationPicker from '../components/LocationPicker';
import { useAuth } from '../context/AuthContext';
import { distanceInKm, formatDistance, geocodeArea, useUserLocation } from '../context/LocationContext';
import { createTeamRecord, inviteTeamMember, listMyTeamInvitations, listMyTeamRequests, listTeamMessages, listTeamRequests, listTeams, requestTeamJoin, respondTeamInvitation, reviewTeamRequest, searchTeamInviteCandidates, sendTeamMessage, updateTeamRecord, uploadTeamImage } from '../services/database';
import { supabase } from '../lib/supabase';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';

const LIGHT_C = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA' };
let C = LIGHT_C;
const canEditTeam = (team) => ['Owner', 'Admin'].includes(team?.role);
const canReviewRequests = (team) => ['Owner', 'Admin', 'Co-admin'].includes(team?.role);
const makeTag = (name) => name.replace(/[^a-z0-9 ]/gi, '').split(/\s+/).filter(Boolean).map((word) => word[0]).join('').slice(0, 4).toUpperCase() || 'TEAM';
const teamStatusText = (team) => team?.status === 'active' ? 'ACTIVE' : `FORMING ${Math.min(team?.members || 0, 4)}/4`;
const servingPlayer = (match) => match?.servingTeam === 'home' ? match.homePlayers?.[match.servingPlayerIndex] : match?.awayPlayers?.[match.servingPlayerIndex];
const servingTeamName = (match) => match?.servingTeam === 'home' ? match.home : match?.away;

function Icon({ name, size = 20, color = C.ink }) { return <Ionicons name={name} size={size} color={color} />; }
function Crest({ team, size = 54, onPress, showEdit }) {
  const content = team.image ? (
    <Image source={{ uri: team.image }} style={{ width: size, height: size, borderRadius: size * .34, borderBottomLeftRadius: size * .14, borderBottomRightRadius: size * .14 }} />
  ) : (
    <>
      <Icon name={team.icon} size={size * .42} color={C.surface} />
      <Text style={[styles.crestTag, { fontSize: size * .12 }]}>{team.tag}</Text>
    </>
  );
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={[styles.crest, { width: size, height: size, borderRadius: size * .34, borderBottomLeftRadius: size * .14, borderBottomRightRadius: size * .14, backgroundColor: team.image ? C.surface : team.color }]}>
      {content}

    </Pressable>
  );
}

function KitchenLine() { return <View style={styles.kitchen}><View style={styles.solid} /><View style={styles.dashed} /></View>; }

function TeamCard({ team, joined, requested, onJoin, onOpen }) {
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.teamCard, pressed && styles.pressed]}>
      <View style={styles.teamHead}><Crest team={team} /><View style={styles.teamCopy}><View style={styles.nameRow}><Text numberOfLines={1} style={styles.teamName}>{team.name}</Text>{joined && <View style={styles.joinedBadge}><Icon name="checkmark" size={10} color={C.teal} /><Text style={styles.joinedText}>JOINED</Text></View>}</View><View style={styles.teamMetaRow}><Text style={styles.teamMotto}>{team.motto}</Text><View style={[styles.statusBadge, team.status === 'active' && styles.statusBadgeActive]}><Text style={[styles.statusBadgeText, team.status === 'active' && styles.statusBadgeTextActive]}>{teamStatusText(team)}</Text></View></View></View><Icon name="chevron-forward" size={18} color={C.ink40} /></View>
      <View style={styles.stats}><View style={styles.stat}><Text style={styles.statValue}>{team.rating}</Text><Text style={styles.statLabel}>RATING</Text></View><View style={styles.stat}><Text style={styles.statValue}>{team.members}/{team.capacity}</Text><Text style={styles.statLabel}>MEMBERS</Text></View><View style={[styles.level, team.level === 'Advanced' && styles.levelAdvanced]}><Text style={[styles.levelText, team.level === 'Advanced' && styles.levelTextAdvanced]}>{team.level}</Text></View></View>
      <View style={styles.teamFoot}><View style={styles.teamPlace}><Icon name="location-outline" size={14} color={C.ink40} /><Text style={styles.footText}>{team.location}{team.distance ? ` · ${team.distance}` : ''}</Text></View><View style={styles.visibilityLabel}><Icon name={team.isDiscoverable ? 'globe-outline' : 'lock-closed-outline'} size={12} color={C.ink40} /><Text style={styles.footText}>{team.isDiscoverable ? 'Public' : 'Private'}</Text></View></View>
      {!joined && <Pressable onPress={(event) => { event.stopPropagation?.(); onJoin(); }} disabled={requested} style={[styles.joinButton, requested && styles.requestedButton]}><Icon name={requested ? 'time-outline' : 'add'} size={17} color={requested ? C.teal : C.ink} /><Text style={[styles.joinButtonText, requested && styles.requestedText]}>{requested ? 'Request sent' : 'Ask to join'}</Text></Pressable>}
    </Pressable>
  );
}

function TeamDetail({ team, joined, requested, onBack, onJoin, onViewHub, onChat, onUpdateImage, onShare }) {
  const editable = canEditTeam(team);
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.detailHeader}><Pressable onPress={onBack} accessibilityLabel="Go back" style={styles.iconButton}><Icon name="arrow-back" /></Pressable><View style={styles.detailHeaderCopy}><Text style={styles.eyebrow}>TEAM PROFILE</Text><Text style={styles.detailHeaderTitle}>{team.name}</Text></View><Pressable accessibilityLabel={`Share ${team.name}`} onPress={onShare} style={styles.iconButton}><Icon name="share-social-outline" /></Pressable></View><KitchenLine />
      <View style={[styles.hero, { backgroundColor: team.color }]}><Crest team={{ ...team, color: 'rgba(255,255,255,.18)' }} size={92} onPress={editable ? () => onUpdateImage(team.id) : undefined} showEdit={editable} /><Text style={styles.heroTitle}>{team.name}</Text><Text style={styles.heroMotto}>“{team.motto}”</Text><View style={styles.heroLocation}><Icon name="location-outline" size={15} color="rgba(255,255,255,.7)" /><Text style={styles.heroLocationText}>{team.location}</Text></View></View>
      <View style={styles.detailStats}><View style={styles.detailStat}><Text style={styles.detailStatValue}>{team.rating}</Text><Text style={styles.statLabel}>TEAM RATING</Text></View><View style={styles.detailStat}><Text style={styles.detailStatValue}>{team.members}</Text><Text style={styles.statLabel}>MEMBERS</Text></View><View style={styles.detailStat}><Text style={styles.detailStatValue}>—</Text><Text style={styles.statLabel}>WIN RATE</Text></View></View>
      <Text style={styles.sectionLabel}>ABOUT THE TEAM</Text><Text style={styles.about}>{team.about || 'A friendly local team looking for reliable players and great games.'}</Text>
      <View style={styles.requirement}><Icon name="checkmark-circle-outline" color={C.teal} /><View style={styles.requirementCopy}><Text style={styles.requirementTitle}>Good fit for you</Text><Text style={styles.footText}>{team.level} · Doubles · Weekday evenings</Text></View></View>
      <View style={styles.sectionHead}><Text style={styles.sectionLabel}>MEMBERS</Text><Text style={styles.sectionLink}>{team.members} total</Text></View><View style={styles.members}>{(team.roster || []).slice(0, 4).map((member, index) => <View key={member.id} style={[styles.avatar, index > 0 && styles.avatarOffset, { backgroundColor: member.color || C.teal }]}><Text style={styles.avatarText}>{member.initials}</Text></View>)}</View>
      {joined ? <View style={styles.memberActions}><Pressable onPress={onChat} style={styles.messageButton}><Icon name="chatbubble-outline" size={18} color={C.teal} /><Text style={styles.messageText}>Team chat</Text></Pressable><Pressable onPress={onViewHub} style={styles.primaryButton}><Text style={styles.primaryText}>View team hub</Text><Icon name="arrow-forward" size={17} color="#0E2321" /></Pressable></View> : <Pressable disabled={requested} onPress={onJoin} style={[styles.primaryButton, requested && styles.requestedLarge]}><Icon name={requested ? 'time-outline' : 'people-outline'} color="#0E2321" /><Text style={styles.primaryText}>{requested ? 'Request sent' : 'Ask to join team'}</Text></Pressable>}
    </ScrollView>
  );
}

function TypingBubble({ name = 'Mia' }) {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const timer = setInterval(() => setDots((value) => value === 3 ? 1 : value + 1), 380);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={styles.typingRow}>
      <View style={[styles.chatAvatar, { backgroundColor: C.brick }]}><Text style={styles.avatarText}>MC</Text></View>
      <View><Text style={styles.sender}>{name} is typing</Text><View style={[styles.bubble, styles.typingBubble]}><Text style={styles.typingDots}>{'.'.repeat(dots)}</Text></View></View>
    </View>
  );
}

function LiveMatchCard({ match, onPress }) {
  if (!match) return null;
  return (
    <Pressable onPress={onPress} style={styles.liveCard}>
      <View style={styles.liveCardHead}><View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveBadgeText}>LIVE MATCH</Text></View><Text style={styles.liveGame}>GAME {match.game}</Text></View>
      <Text style={styles.livePlayers}>{match.players}</Text>
      <View style={styles.liveScoreRow}><View style={styles.liveTeam}><Text style={styles.liveTag}>{match.homeTag}</Text><Text numberOfLines={1} style={styles.liveTeamName}>{match.home}</Text></View><Text style={styles.liveScore}>{match.homeScore}</Text><Text style={styles.liveDash}>–</Text><Text style={styles.liveScore}>{match.awayScore}</Text><View style={[styles.liveTeam, styles.liveTeamAway]}><Text style={styles.liveTag}>{match.awayTag}</Text><Text numberOfLines={1} style={styles.liveTeamName}>{match.away}</Text></View></View>
      <View style={styles.cardServing}><View style={styles.servingDot} /><Text style={styles.cardServingText}>{servingPlayer(match)} serving for {servingTeamName(match)} · Server {match.serviceNumber}</Text></View>
      <View style={styles.liveCardFoot}><Text numberOfLines={1} style={styles.liveLastPlay}>{match.lastPlay}</Text><View style={styles.watchLive}><Text style={styles.watchLiveText}>Watch live</Text><Icon name="arrow-forward" size={14} color={C.ink} /></View></View>
    </Pressable>
  );
}

function TeamChat({ team, messages, typing, liveMatch, onBack, onSend, onWatchLive, onInfo, onAttach }) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);
  const send = () => {
    const clean = draft.trim();
    if (!clean) return;
    onSend(clean);
    setDraft('');
  };
  return (
    <KeyboardAvoidingView style={styles.chatScreen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
      <View style={[styles.detailHeader, styles.chatHeader]}><Pressable onPress={onBack} accessibilityLabel="Go back" style={styles.iconButton}><Icon name="arrow-back" /></Pressable><Crest team={team} size={43} /><View style={styles.detailHeaderCopy}><Text style={styles.detailHeaderTitle}>{team.name}</Text><View style={styles.onlineRow}><Text style={styles.chatStatus}>{team.members} {team.members === 1 ? 'member' : 'members'}</Text></View></View><Pressable accessibilityLabel="Team information" onPress={onInfo} style={styles.iconButton}><Icon name="information-circle-outline" /></Pressable></View>
      <View style={styles.chatRule} />
      <ScrollView ref={scrollRef} style={styles.chatMessages} contentContainerStyle={styles.chatContent} showsVerticalScrollIndicator={false} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        <Text style={styles.chatDay}>TODAY</Text>
        {messages.map((message, index) => {
          if (message.type === 'live-match') return <View key={message.id} style={styles.autoMatchMessage}><View style={styles.autoMatchLabel}><Icon name="radio-outline" size={14} color={C.teal} /><Text style={styles.autoMatchLabelText}>Peakle Match Center posted automatically</Text></View><LiveMatchCard match={liveMatch} onPress={onWatchLive} /></View>;
          const previous = messages[index - 1];
          const grouped = previous?.sender === message.sender && previous?.mine === message.mine;
          return <View key={message.id} style={[styles.messageRow, message.mine && styles.messageRowMine, grouped && styles.messageGrouped]}>{!message.mine && !grouped && <View style={[styles.chatAvatar, { backgroundColor: message.color || C.brick }]}><Text style={styles.avatarText}>{message.initials}</Text></View>}{!message.mine && grouped && <View style={styles.chatAvatarSpacer} />}<View style={[styles.messageBlock, message.mine && styles.messageBlockMine]}>{!message.mine && !grouped && <Text style={styles.sender}>{message.sender}</Text>}<View style={[styles.bubble, message.mine && styles.bubbleMine]}>{message.image && <Image source={{ uri: message.image }} style={styles.chatAttachmentImage} />}<Text style={[styles.bubbleText, message.mine && styles.bubbleTextMine]}>{message.text}</Text></View><Text style={[styles.messageTime, message.mine && styles.messageTimeMine]}>{message.time}{message.mine ? ' · Sent' : ''}</Text></View></View>;
        })}
        {typing && <TypingBubble />}
      </ScrollView>
      <View style={styles.composer}><Pressable accessibilityLabel="Add photo attachment" onPress={onAttach} style={styles.addAttachment}><Icon name="add" size={23} color={C.teal} /></Pressable><View style={styles.composerInput}><TextInput value={draft} onChangeText={setDraft} onSubmitEditing={send} returnKeyType="send" multiline placeholder={`Message ${team.name}`} placeholderTextColor={C.ink40} style={styles.chatInput} /><Pressable disabled={!draft.trim()} onPress={send} accessibilityLabel="Send message" style={[styles.sendButton, !draft.trim() && styles.sendDisabled]}><Icon name="arrow-up" size={19} color="#0E2321" /></Pressable></View></View>
    </KeyboardAvoidingView>
  );
}

function LiveScore({ team, match, scoringMode, currentUserId, onBack, onRally, onSwitchServe }) {
  if (!match) return null;
  const canControl = scoringMode && match.scorerId === currentUserId;
  const games = [...(match.completedGames || []), { home: match.homeScore, away: match.awayScore, current: true }];
  const homeGamesWon = (match.completedGames || []).filter((game) => game.home > game.away).length;
  const awayGamesWon = (match.completedGames || []).filter((game) => game.away > game.home).length;
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.detailHeader}><Pressable onPress={onBack} accessibilityLabel="Back to team chat" style={styles.iconButton}><Icon name="arrow-back" /></Pressable><View style={styles.detailHeaderCopy}><Text style={styles.eyebrow}>LIVE SCORING</Text><Text style={styles.detailHeaderTitle}>{team.name}</Text></View><View style={styles.liveHeaderBadge}><View style={styles.liveDot} /><Text style={styles.liveHeaderText}>LIVE</Text></View></View><KitchenLine />
      <View style={styles.scoreHero}>
        <Text style={styles.scoreVenue}>{match.venue}</Text><Text style={styles.scoreGame}>GAME {match.game}</Text>
        <View style={styles.scoreTeams}><View style={styles.scoreTeam}><View style={[styles.scoreCrest, { backgroundColor: C.teal }]}><Text style={styles.scoreCrestText}>{match.homeTag}</Text></View><Text style={styles.scoreTeamName}>{match.home}</Text></View><View style={styles.scoreNumbers}><Text style={styles.scoreNumber}>{match.homeScore}</Text><Text style={styles.scoreSeparator}>:</Text><Text style={styles.scoreNumber}>{match.awayScore}</Text></View><View style={styles.scoreTeam}><View style={[styles.scoreCrest, { backgroundColor: C.brick }]}><Text style={styles.scoreCrestText}>{match.awayTag}</Text></View><Text style={styles.scoreTeamName}>{match.away}</Text></View></View>
        <View style={styles.servingRow}><View style={styles.servingDot} /><Text style={styles.servingText}>{servingPlayer(match)} serving for {servingTeamName(match)} · Server {match.serviceNumber}</Text></View>
      </View>
      {canControl ? <View style={styles.scorerPanel}><View style={styles.scorerHead}><View><Text style={styles.eyebrow}>SCORER CONTROLS</Text><Text style={styles.scorerTitle}>{match.scorer} is scoring</Text></View><View style={styles.scorerBadge}><Icon name="create-outline" size={13} color={C.teal} /><Text style={styles.scorerBadgeText}>SCORER</Text></View></View><Text style={styles.scorerHelp}>Choose the rally winner. A serving team scores a point; a receiving team win advances or switches the serve.</Text><View style={styles.rallyButtons}><Pressable onPress={() => onRally('home')} style={[styles.rallyButton, match.servingTeam === 'home' && styles.rallyButtonServing]}><Text style={styles.rallyTag}>{match.homeTag}</Text><Text style={styles.rallyButtonText}>Won rally</Text>{match.servingTeam === 'home' && <Text style={styles.rallyServingText}>SERVING</Text>}</Pressable><Pressable onPress={() => onRally('away')} style={[styles.rallyButton, match.servingTeam === 'away' && styles.rallyButtonServing]}><Text style={styles.rallyTag}>{match.awayTag}</Text><Text style={styles.rallyButtonText}>Won rally</Text>{match.servingTeam === 'away' && <Text style={styles.rallyServingText}>SERVING</Text>}</Pressable></View><Pressable onPress={onSwitchServe} style={styles.switchServeButton}><Icon name="swap-horizontal" size={19} color={C.surface} /><Text style={styles.switchServeText}>Correct Server</Text></Pressable></View> : <View style={styles.viewerNotice}><Icon name="eye-outline" color={C.teal} /><View style={styles.rosterCopy}><Text style={styles.rosterName}>View-only live coverage</Text><Text style={styles.footText}>Only assigned scorer {match.scorer} can update points and serving.</Text></View><View style={styles.viewerBadge}><Text style={styles.viewerBadgeText}>VIEWER</Text></View></View>}
      <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>BOX SCORE</Text><Text style={styles.h2}>Score by set</Text></View><Text style={styles.sectionLink}>{homeGamesWon}–{awayGamesWon} sets</Text></View>
      <View style={styles.boxScore}><View style={styles.boxScoreRow}><Text style={[styles.boxTeam, styles.boxHeader]}>TEAM</Text>{games.map((game, index) => <Text key={`head-${index}`} style={[styles.boxValue, styles.boxHeader]}>S{index + 1}{game.current ? '*' : ''}</Text>)}<Text style={[styles.boxValue, styles.boxHeader]}>W</Text></View><View style={[styles.boxScoreRow, styles.boxScoreBorder]}><Text numberOfLines={1} style={styles.boxTeam}>{match.homeTag} · {match.home}</Text>{games.map((game, index) => <Text key={`home-${index}`} style={[styles.boxValue, game.current && styles.boxCurrent]}>{game.home}</Text>)}<Text style={[styles.boxValue, styles.boxWon]}>{homeGamesWon}</Text></View><View style={[styles.boxScoreRow, styles.boxScoreBorder]}><Text numberOfLines={1} style={styles.boxTeam}>{match.awayTag} · {match.away}</Text>{games.map((game, index) => <Text key={`away-${index}`} style={[styles.boxValue, game.current && styles.boxCurrent]}>{game.away}</Text>)}<Text style={[styles.boxValue, styles.boxWon]}>{awayGamesWon}</Text></View><Text style={styles.boxFootnote}>* Current set</Text></View>
      <View style={styles.liveInfoCard}><Icon name="people-outline" color={C.teal} /><View style={styles.rosterCopy}><Text style={styles.rosterName}>{match.players}</Text><Text style={styles.footText}>Players on court</Text></View></View>
      <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>POINT BY POINT</Text><Text style={styles.h2}>Match activity</Text></View><View style={styles.syncBadge}><Icon name="sync" size={12} color={C.teal} /><Text style={styles.syncText}>Scorer-synced</Text></View></View>
      <View style={styles.liveActivity}><View style={styles.liveActivityIcon}><Icon name="tennisball-outline" size={18} color={C.teal} /></View><View style={styles.rosterCopy}><Text style={styles.rosterName}>{match.lastPlay}</Text><Text style={styles.footText}>Just now · Score {match.homeScore}–{match.awayScore}</Text></View></View>
      <View style={styles.liveNotice}><Icon name="notifications-outline" color={C.teal} /><Text style={styles.liveNoticeText}>Score changes are automatically shared in {team.name}'s group chat so teammates can follow from anywhere.</Text></View>
    </ScrollView>
  );
}

function FormField({ label, value, onChangeText, placeholder, multiline, keyboardType }) {
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={C.ink40} multiline={multiline} keyboardType={keyboardType} style={[styles.formInput, multiline && styles.formTextarea]} />
    </View>
  );
}

function TeamForm({ team, onBack, onSave }) {
  const editing = Boolean(team);
  const [name, setName] = useState(team?.name || '');
  const [motto, setMotto] = useState(team?.motto || '');
  const [about, setAbout] = useState(team?.about || '');
  const [location, setLocation] = useState(team?.location || '');
  const [capacity, setCapacity] = useState(String(team?.capacity || 12));
  const [level, setLevel] = useState(team?.level || 'Open level');
  const [image, setImage] = useState(team?.image);
  const [isDiscoverable, setIsDiscoverable] = useState(team?.isDiscoverable ?? false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (!result.canceled) setImage(result.assets[0].uri);
  };
  const submit = () => {
    const cleanName = name.trim();
    const cleanLocation = location.trim();
    const maxMembers = Number.parseInt(capacity, 10);
    if (!cleanName || !cleanLocation || !motto.trim() || !about.trim()) {
      Alert.alert('Complete team details', 'Please add a name, location, motto, and description.');
      return;
    }
    const minimumCapacity = Math.max(4, team?.members || 1);
    if (!Number.isFinite(maxMembers) || maxMembers < minimumCapacity || maxMembers > 100) {
      Alert.alert('Check team capacity', `Capacity must be between ${minimumCapacity} and 100.`);
      return;
    }
    onSave({
      ...team,
      name: cleanName,
      tag: team?.tag || makeTag(cleanName),
      location: cleanLocation,
      motto: motto.trim(),
      about: about.trim(),
      capacity: maxMembers,
      level,
      image,
      isDiscoverable,
    });
  };

  const preview = { name: name || 'New Team', tag: makeTag(name), icon: 'people-outline', color: team?.color || C.teal, image };
  return (
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.detailHeader}><Pressable onPress={onBack} accessibilityLabel="Go back" style={styles.iconButton}><Icon name="arrow-back" /></Pressable><View style={styles.detailHeaderCopy}><Text style={styles.eyebrow}>{editing ? 'TEAM SETTINGS' : 'START A TEAM'}</Text><Text style={styles.detailHeaderTitle}>{editing ? 'Edit team details' : 'Create your team'}</Text></View></View><KitchenLine />
        <View style={styles.formPhoto}><Crest team={preview} size={82} onPress={pickImage} showEdit /><View style={styles.formPhotoCopy}><Text style={styles.formPhotoTitle}>Team photo</Text><Text style={styles.footText}>Choose a square image. Only owners and admins can change it.</Text><Pressable onPress={pickImage} style={styles.photoButton}><Text style={styles.photoButtonText}>{image ? 'Change photo' : 'Add photo'}</Text></Pressable></View></View>
        <FormField label="TEAM NAME" value={name} onChangeText={setName} placeholder="e.g. Manila Smashers" />
        <FormField label="MOTTO" value={motto} onChangeText={setMotto} placeholder="What does your team play for?" />
        <FormField label="ABOUT" value={about} onChangeText={setAbout} placeholder="Describe your team, schedule, and expectations" multiline />
        <FormField label="HOME LOCATION" value={location} onChangeText={setLocation} placeholder="City or neighborhood" />
        <FormField label="MAX MEMBERS" value={capacity} onChangeText={setCapacity} placeholder="12" keyboardType="number-pad" />
        <Text style={styles.formLabel}>SKILL LEVEL</Text>
        <View style={styles.levelOptions}>{['Open level', 'Intermediate', 'Advanced'].map((item) => <Pressable key={item} onPress={() => setLevel(item)} style={[styles.levelOption, level === item && styles.levelOptionActive]}><Text style={[styles.levelOptionText, level === item && styles.levelOptionTextActive]}>{item}</Text></Pressable>)}</View>
        <Text style={styles.formLabel}>TEAM VISIBILITY</Text>
        <View style={styles.visibilityOptions}>
          <Pressable onPress={() => setIsDiscoverable(false)} style={[styles.visibilityOption, !isDiscoverable && styles.visibilityOptionActive]}><Icon name="lock-closed-outline" color={!isDiscoverable ? C.surface : C.teal} /><View style={styles.visibilityCopy}><Text style={[styles.visibilityTitle, !isDiscoverable && styles.visibilityTitleActive]}>Private</Text><Text style={[styles.visibilityHelp, !isDiscoverable && styles.visibilityHelpActive]}>Only players you invite can join.</Text></View></Pressable>
          <Pressable onPress={() => setIsDiscoverable(true)} style={[styles.visibilityOption, isDiscoverable && styles.visibilityOptionActive]}><Icon name="globe-outline" color={isDiscoverable ? C.surface : C.teal} /><View style={styles.visibilityCopy}><Text style={[styles.visibilityTitle, isDiscoverable && styles.visibilityTitleActive]}>Public</Text><Text style={[styles.visibilityHelp, isDiscoverable && styles.visibilityHelpActive]}>Players can find you and ask to join.</Text></View></Pressable>
        </View>
        <View style={styles.formNotice}><Icon name="shield-checkmark-outline" color={C.teal} /><Text style={styles.formNoticeText}>{editing ? 'Changing visibility never allows automatic joining. You still control membership.' : 'You will be the Owner. The team stays Forming until four confirmed players have joined.'}</Text></View>
        <Pressable onPress={submit} style={styles.saveButton}><Text style={styles.primaryText}>{editing ? 'Save changes' : 'Create team'}</Text><Icon name={editing ? 'checkmark' : 'arrow-forward'} size={18} color="#0E2321" /></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PlayerInviteScreen({ team, onBack }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [sent, setSent] = useState([]);
  const memberIds = useMemo(() => new Set((team.roster || []).map((member) => member.id)), [team.roster]);

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchTeamInviteCandidates(clean)
        .then((players) => setResults(players.filter((player) => !memberIds.has(player.id))))
        .catch((error) => Alert.alert('Player search unavailable', error.message))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, memberIds]);

  const invite = async (player) => {
    try {
      await inviteTeamMember(team.id, player.id);
      setSent((current) => current.includes(player.id) ? current : [...current, player.id]);
    } catch (error) {
      Alert.alert('Invitation not sent', error.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.detailHeader}><Pressable onPress={onBack} accessibilityLabel="Go back" style={styles.iconButton}><Icon name="arrow-back" /></Pressable><View style={styles.detailHeaderCopy}><Text style={styles.eyebrow}>PRIVATE INVITATIONS</Text><Text style={styles.detailHeaderTitle}>Invite players</Text></View></View><KitchenLine />
      <View style={styles.inviteProgress}><View style={styles.inviteProgressIcon}><Icon name="people" color={C.teal} /></View><View style={styles.rosterCopy}><Text style={styles.inviteProgressTitle}>{teamStatusText(team)}</Text><Text style={styles.footText}>{team.status === 'active' ? `${team.name} is active. You can keep building the roster.` : `Invite ${Math.max(0, 4 - team.members)} more confirmed ${Math.max(0, 4 - team.members) === 1 ? 'player' : 'players'} to activate the team.`}</Text></View></View>
      <View style={styles.search}><Icon name="search-outline" color={C.ink40} /><TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search by player name" placeholderTextColor={C.ink40} style={styles.searchInput} /></View>
      <Text style={styles.invitePrivacy}><Icon name="lock-closed-outline" size={12} color={C.teal} /> Invitations are tied to the selected Peakle account, expire after seven days, and cannot be forwarded.</Text>
      {searching && <Text style={styles.searchingText}>Searching players…</Text>}
      {!searching && query.trim().length >= 2 && !results.length && <View style={styles.emptyRequests}><Icon name="person-outline" size={34} color={C.ink40} /><Text style={styles.emptyTitle}>No matching players</Text><Text style={styles.footText}>Check the player’s Peakle display name and try again.</Text></View>}
      <View style={styles.playerResults}>{results.map((player, index) => {
        const invited = sent.includes(player.id);
        const initials = (player.display_name || 'P').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
        return <View key={player.id} style={[styles.playerResult, index > 0 && styles.rosterBorder]}><View style={styles.rosterAvatar}><Text style={styles.avatarText}>{initials}</Text></View><View style={styles.rosterCopy}><Text style={styles.rosterName}>{player.display_name}</Text><Text style={styles.footText}>{player.home_area || 'Peakle player'} · ID {player.id.slice(0, 6).toUpperCase()}</Text></View><Pressable disabled={invited} onPress={() => invite(player)} style={[styles.invitePlayerButton, invited && styles.invitePlayerButtonSent]}><Icon name={invited ? 'checkmark' : 'person-add-outline'} size={15} color={invited ? C.teal : C.ink} /><Text style={[styles.invitePlayerText, invited && styles.invitePlayerTextSent]}>{invited ? 'Sent' : 'Invite'}</Text></Pressable></View>;
      })}</View>
    </ScrollView>
  );
}

function TeamInvitationCard({ invitation, onAccept, onDecline }) {
  const team = invitation.teams;
  if (!team) return null;
  return (
    <View style={styles.invitationCard}>
      <View style={styles.teamHead}><Crest team={{ tag: team.tag, name: team.name, image: team.image_url, icon: 'people-outline', color: team.color || C.teal }} /><View style={styles.teamCopy}><Text style={styles.invitationEyebrow}>PRIVATE TEAM INVITATION</Text><Text style={styles.teamName}>{team.name}</Text><Text style={styles.teamMotto}>{team.motto}</Text></View><Icon name="lock-closed" size={18} color={C.teal} /></View>
      <View style={styles.invitationMeta}><Icon name="location-outline" size={14} color={C.ink40} /><Text style={styles.footText}>{team.location || 'Location not set'} · {team.skill_level || 'Open level'}</Text></View>
      <Text style={styles.invitationExpiry}>This invitation expires {new Date(invitation.expires_at).toLocaleDateString()}.</Text>
      <View style={styles.requestActions}><Pressable onPress={onDecline} style={styles.declineButton}><Text style={styles.declineText}>Decline</Text></Pressable><Pressable onPress={onAccept} style={styles.acceptButton}><Icon name="checkmark" size={17} color="#0E2321" /><Text style={styles.primaryText}>Join team</Text></Pressable></View>
    </View>
  );
}

function TeamHub({ team, requests, liveMatch, onBack, onUpdateImage, onEdit, onAccept, onDecline, onScoreMatch, onInvite }) {
  const [section, setSection] = useState('Roster');
  const editable = canEditTeam(team);
  const reviewer = canReviewRequests(team);
  const roster = team.roster || [];
  const tabs = reviewer ? ['Roster', 'Requests', 'Matches', 'Activity'] : ['Roster', 'Matches', 'Activity'];
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.detailHeader}><Pressable onPress={onBack} accessibilityLabel="Go back" style={styles.iconButton}><Icon name="arrow-back" /></Pressable><View style={styles.detailHeaderCopy}><Text style={styles.eyebrow}>YOUR TEAM · {team.role?.toUpperCase()}</Text><Text style={styles.detailHeaderTitle}>{team.name}</Text></View>{editable && <Pressable onPress={onEdit} accessibilityLabel="Edit team" style={styles.iconButton}><Icon name="settings-outline" /></Pressable>}</View><KitchenLine />
      <View style={[styles.hubHero, { backgroundColor: team.color }]}><View style={styles.hubIdentity}><Crest team={team} size={65} onPress={editable ? () => onUpdateImage(team.id) : undefined} showEdit={editable} /><View style={styles.hubIdentityCopy}><Text style={styles.hubTitle}>{team.name}</Text><Text style={styles.hubMeta}>{team.members} members · {teamStatusText(team)} · {team.isDiscoverable ? 'Public' : 'Private'}</Text><View style={styles.rolePill}><Icon name="shield-checkmark" size={11} color={C.surface} /><Text style={styles.rolePillText}>{team.role}</Text></View></View></View><View style={styles.hubRecord}><View><Text style={styles.hubRecordValue}>—</Text><Text style={styles.hubRecordLabel}>SEASON RECORD</Text></View><View><Text style={styles.hubRecordValue}>—</Text><Text style={styles.hubRecordLabel}>WIN RATE</Text></View><View><Text style={styles.hubRecordValue}>—</Text><Text style={styles.hubRecordLabel}>LOCAL RANK</Text></View></View></View>
      {team.status !== 'active' && <View style={styles.formingNotice}><Icon name="people-outline" color={C.teal} /><View style={styles.rosterCopy}><Text style={styles.requirementTitle}>Team is still forming</Text><Text style={styles.footText}>Reach four confirmed members to unlock team competition. You need {Math.max(0, 4 - team.members)} more.</Text></View>{reviewer && <Pressable onPress={onInvite} style={styles.noticeInvite}><Text style={styles.inviteButtonText}>Invite</Text></Pressable>}</View>}
      <View style={styles.hubTabs}>{tabs.map((item) => <Pressable key={item} onPress={() => setSection(item)} style={[styles.hubTab, section === item && styles.hubTabActive]}><Text style={[styles.hubTabText, section === item && styles.hubTabTextActive]}>{item}{item === 'Requests' && requests.length ? ` (${requests.length})` : ''}</Text></Pressable>)}</View>
      {section === 'Roster' && <><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>LINEUP</Text><Text style={styles.h2}>Team roster</Text></View><Pressable accessibilityLabel={`Invite players to ${team.name}`} onPress={onInvite} style={styles.inviteButton}><Icon name="person-add-outline" size={16} color={C.teal} /><Text style={styles.inviteButtonText}>Invite</Text></Pressable></View><View style={styles.rosterCard}>{roster.map((player, index) => <View key={player.name} style={[styles.rosterRow, index > 0 && styles.rosterBorder]}><View style={[styles.rosterAvatar, { backgroundColor: player.color }]}><Text style={styles.avatarText}>{player.initials}</Text></View><View style={styles.rosterCopy}><Text style={styles.rosterName}>{player.name}</Text><Text style={styles.footText}>{player.role}</Text></View><View style={styles.rosterRating}><Text style={styles.rosterRatingValue}>{player.rating}</Text><Text style={styles.statLabel}>RATING</Text></View></View>)}</View></>}
      {section === 'Requests' && <><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>MEMBERSHIP</Text><Text style={styles.h2}>Join requests</Text></View><Text style={styles.sectionLink}>{requests.length} pending</Text></View>{requests.length ? requests.map((request) => <View key={request.id} style={styles.requestCard}><View style={styles.requestHead}><View style={[styles.rosterAvatar, { backgroundColor: request.color }]}><Text style={styles.avatarText}>{request.initials}</Text></View><View style={styles.rosterCopy}><Text style={styles.rosterName}>{request.name}</Text><Text style={styles.footText}>{request.level} · Rating {request.rating}</Text></View></View><Text style={styles.requestNote}>{request.note}</Text><View style={styles.requestActions}><Pressable onPress={() => onDecline(request.id)} style={styles.declineButton}><Text style={styles.declineText}>Decline</Text></Pressable><Pressable onPress={() => onAccept(request)} style={styles.acceptButton}><Icon name="checkmark" size={17} color="#0E2321" /><Text style={styles.primaryText}>Accept</Text></Pressable></View></View>) : <View style={styles.emptyRequests}><Icon name="checkmark-circle-outline" size={34} color={C.teal} /><Text style={styles.emptyTitle}>You're all caught up</Text><Text style={styles.footText}>New join requests will appear here.</Text></View>}</>}
      {section === 'Matches' && <><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>SCHEDULE</Text><Text style={styles.h2}>Team matches</Text></View></View><View style={styles.empty}><Icon name={team.status === 'active' ? 'calendar-outline' : 'lock-closed-outline'} size={35} color={C.ink40} /><Text style={styles.emptyTitle}>{team.status === 'active' ? 'No team matches recorded' : 'Competition unlocks at four'}</Text><Text style={styles.footText}>{team.status === 'active' ? 'Scheduled and completed team matches will appear here when saved.' : 'Invite or approve more players before entering team matches and rankings.'}</Text></View></>}
      {section === 'Activity' && <><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>RECENT</Text><Text style={styles.h2}>Team activity</Text></View></View><View style={styles.empty}><Icon name="pulse-outline" size={35} color={C.ink40} /><Text style={styles.emptyTitle}>No team activity yet</Text><Text style={styles.footText}>Real membership and match updates will appear here.</Text></View></>}
    </ScrollView>
  );
}

const SCREEN_HEIGHT = Dimensions.get('window').height;

export default function TeamScreen() {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const { user } = useAuth();
  const { userLocation } = useUserLocation();
  const [tab, setTab] = useState('Discover');
  const [filter, setFilter] = useState('For you');
  const [query, setQuery] = useState('');
  const [requested, setRequested] = useState([]);
  const [joined, setJoined] = useState([]);
  const [availableTeams, setAvailableTeams] = useState([]);
  const [selected, setSelected] = useState(null);
  const [hubTeam, setHubTeam] = useState(null);
  const [chatTeam, setChatTeam] = useState(null);
  const [liveScoreTeam, setLiveScoreTeam] = useState(null);
  const [liveScoreMode, setLiveScoreMode] = useState('viewer');
  const [typingByTeam, setTypingByTeam] = useState({});
  const [liveMatches, setLiveMatches] = useState({});
  const responseTimers = useRef({});
  const [creating, setCreating] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [invitingTeam, setInvitingTeam] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const createSlide = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  const openCreate = useCallback(() => {
    createSlide.setValue(SCREEN_HEIGHT);
    setCreating(true);
    Animated.timing(createSlide, {
      toValue: 0,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [createSlide]);

  const closeCreate = useCallback(() => {
    Animated.timing(createSlide, {
      toValue: SCREEN_HEIGHT,
      duration: 300,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setCreating(false));
  }, [createSlide]);
  const [joinRequests, setJoinRequests] = useState({});
  const [locationOpen, setLocationOpen] = useState(false);
  const [messages, setMessages] = useState({});

  const loadTeamData = useCallback(async () => {
    const [teams, pending, incomingInvitations] = await Promise.all([listTeams(), listMyTeamRequests(), listMyTeamInvitations()]);
      const mine = teams.filter((team) => team.role);
      setJoined(mine);
      setAvailableTeams(teams.filter((team) => !team.role && team.isDiscoverable));
      setRequested(pending);
      setInvitations(incomingInvitations);
      const manageable = mine.filter(canReviewRequests).map((team) => team.id);
      const rows = await listTeamRequests(manageable);
      setJoinRequests(rows.reduce((groups, row) => ({ ...groups, [row.team_id]: [...(groups[row.team_id] || []), { id: row.id, team_id: row.team_id, user_id: row.user_id, name: row.profiles?.display_name || 'Player', initials: (row.profiles?.display_name || 'P').split(/\s+/).map((part) => part[0]).join('').slice(0, 2), rating: row.profiles?.skill_rating || '—', note: row.note || '' }] }), {}));
  }, []);

  useEffect(() => {
    loadTeamData().catch((error) => Alert.alert('Teams unavailable', error.message));
  }, [loadTeamData]);

  useEffect(() => {
    if (!chatTeam?.id || messages[chatTeam.id]) return;
    listTeamMessages(chatTeam.id).then((rows) => setMessages((current) => ({ ...current, [chatTeam.id]: rows.map((row) => ({ id: row.id, sender: row.profiles?.display_name || 'Player', initials: (row.profiles?.display_name || 'P').split(/\s+/).map((part) => part[0]).join('').slice(0, 2), text: row.body, image: row.image_url, time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })) }))).catch((error) => Alert.alert('Chat unavailable', error.message));
  }, [chatTeam?.id]);
  useEffect(() => {
    if (!chatTeam?.id || !supabase) return undefined;
    const channel = supabase.channel(`team-chat-${chatTeam.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages', filter: `team_id=eq.${chatTeam.id}` }, () => {
      listTeamMessages(chatTeam.id).then((rows) => setMessages((current) => ({ ...current, [chatTeam.id]: rows.map((row) => ({ id: row.id, sender: row.profiles?.display_name || 'Player', initials: (row.profiles?.display_name || 'P').split(/\s+/).map((part) => part[0]).join('').slice(0, 2), text: row.body, image: row.image_url, time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })) }))).catch(() => {});
    }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chatTeam?.id]);
  useEffect(() => {
    return () => Object.values(responseTimers.current).forEach(clearTimeout);
  }, []);
  const requestJoin = async (id) => { try { await requestTeamJoin(id); setRequested((value) => value.includes(id) ? value : [...value, id]); } catch (error) { Alert.alert('Request not sent', error.message); } };
  const respondInvitation = async (invitation, accept) => {
    try {
      await respondTeamInvitation(invitation.id, accept);
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      if (accept) {
        await loadTeamData();
        setTab('Joined');
      }
    } catch (error) {
      Alert.alert(accept ? 'Could not join team' : 'Could not decline invitation', error.message);
    }
  };
  const discoverTeams = useMemo(() => availableTeams.map((team) => {
    const distanceKm = distanceInKm(userLocation, team);
    return { ...team, distanceKm, distance: formatDistance(distanceKm) };
  }).filter((team) => {
    const matchesSearch = `${team.name} ${team.location} ${team.level}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'For you' || (filter === 'Nearby' && team.distanceKm != null && team.distanceKm <= 25) || (filter === 'My level' && team.level === 'Advanced') || (filter === 'Open spots' && team.members < team.capacity);
    return matchesSearch && matchesFilter;
  }).sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY)), [availableTeams, query, filter, userLocation]);
  const sendMessage = async (text) => {
    const teamId = chatTeam.id;
    try {
      const row = await sendTeamMessage(teamId, text);
      const message = { id: row.id, sender: row.profiles?.display_name || 'You', initials: (row.profiles?.display_name || 'Y').split(/\s+/).map((part) => part[0]).join('').slice(0, 2), mine: true, text: row.body, time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) };
      setMessages((current) => ({ ...current, [teamId]: [...(current[teamId] || []), message] }));
    } catch (error) { Alert.alert('Message not sent', error.message); }
  };
  const shareTeam = (team, invite = false) => Share.share({
    title: invite ? `Join ${team.name} on Peakle` : team.name,
    message: invite
      ? `Join ${team.name} on Peakle. ${team.motto} · ${team.location} · ${team.members}/${team.capacity} members.`
      : `Check out ${team.name} on Peakle. ${team.motto} · ${team.location} · Rating ${team.rating}.`,
  });
  const attachPhoto = async () => {
    if (!chatTeam) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: .85 });
    if (result.canceled) return;
    const teamId = chatTeam.id;
    try {
      const image = await uploadTeamImage(teamId, result.assets[0].uri);
      const row = await sendTeamMessage(teamId, 'Shared a photo', image);
      setMessages((current) => ({ ...current, [teamId]: [...(current[teamId] || []), { id: row.id, sender: row.profiles?.display_name || 'You', initials: 'Y', mine: true, text: row.body, image, time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }] }));
    } catch (error) { Alert.alert('Photo not sent', error.message); }
  };
  const advanceServe = (match) => {
    if (match.serviceNumber === 1) {
      return { ...match, serviceNumber: 2, servingPlayerIndex: match.servingPlayerIndex === 0 ? 1 : 0 };
    }
    return { ...match, servingTeam: match.servingTeam === 'home' ? 'away' : 'home', serviceNumber: 1, servingPlayerIndex: 0 };
  };
  const switchMatchServe = (teamId) => {
    if (liveScoreMode !== 'scorer' || liveMatches[teamId]?.scorerId !== user?.id) return;
    setLiveMatches((current) => {
      const match = current[teamId];
      if (!match) return current;
      const updated = advanceServe(match);
      return { ...current, [teamId]: { ...updated, lastPlay: `Serve switched. ${servingPlayer(updated)} is now serving for ${servingTeamName(updated)}.` } };
    });
  };
  const recordRally = (teamId, winner) => {
    if (liveScoreMode !== 'scorer' || liveMatches[teamId]?.scorerId !== user?.id) return;
    setLiveMatches((current) => {
      const match = current[teamId];
      if (!match || match.status !== 'LIVE') return current;
      if (winner !== match.servingTeam) {
        const updated = advanceServe(match);
        const winnerName = winner === 'home' ? match.home : match.away;
        return { ...current, [teamId]: { ...updated, lastPlay: `${winnerName} won the rally. ${servingPlayer(updated)} now has the serve.` } };
      }
      let homeScore = match.homeScore + (winner === 'home' ? 1 : 0);
      let awayScore = match.awayScore + (winner === 'away' ? 1 : 0);
      let game = match.game;
      let updated = { ...match, homeScore, awayScore, lastPlay: `${servingPlayer(match)} wins a point for ${servingTeamName(match)}.` };
      if ((homeScore >= 11 || awayScore >= 11) && Math.abs(homeScore - awayScore) >= 2) {
        const gameWinner = winner === 'home' ? match.home : match.away;
        game += 1;
        updated = { ...updated, completedGames: [...(match.completedGames || []), { home: homeScore, away: awayScore }], homeScore: 0, awayScore: 0, game, servingTeam: winner === 'home' ? 'away' : 'home', servingPlayerIndex: 0, serviceNumber: 2, lastPlay: `${gameWinner} won Game ${game - 1}. Game ${game} is ready to start.` };
      }
      return { ...current, [teamId]: updated };
    });
  };
  const replaceTeam = (updated) => {
    setJoined((current) => current.map((team) => team.id === updated.id ? updated : team));
    if (selected?.id === updated.id) setSelected(updated);
    if (hubTeam?.id === updated.id) setHubTeam(updated);
  };
  const createTeam = async (details) => {
    try {
    const coords = await geocodeArea(details.location);
    if (!coords) throw new Error('We could not locate that team area. Try a city and country.');
    details = { ...details, ...coords };
    const row = await createTeamRecord(details);
    const image = await uploadTeamImage(row.id, details.image);
    if (image !== details.image) await updateTeamRecord(row.id, { ...details, image });
    const created = { ...details, image, id: row.id, members: 1, rating: '—', color: C.teal, icon: 'people-outline', role: 'Owner', status: row.status || 'forming', isDiscoverable: row.is_discoverable, roster: [{ id: user.id, name: user.name, initials: user.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), role: 'Owner', rating: 'Unrated', color: C.teal }], acceptedMembers: [] };
    setJoined((current) => [...current, created]);
    setJoinRequests((current) => ({ ...current, [row.id]: [] }));
    setMessages((current) => ({ ...current, [row.id]: [] }));
    setCreating(false);
    setTab('Joined');
    setHubTeam(created);
    } catch (error) { Alert.alert('Team not created', error.message); }
  };
  const saveTeam = async (updated) => {
    if (!canEditTeam(editingTeam)) return;
    try {
    if (updated.location !== editingTeam.location || ![updated.latitude, updated.longitude].every(Number.isFinite)) {
      const coords = await geocodeArea(updated.location);
      if (!coords) throw new Error('We could not locate that team area. Try a city and country.');
      updated = { ...updated, ...coords };
    }
    const image = await uploadTeamImage(updated.id, updated.image);
    updated = { ...updated, image };
    await updateTeamRecord(updated.id, updated);
    replaceTeam(updated);
    setEditingTeam(null);
    setHubTeam(updated);
    } catch (error) { Alert.alert('Team not saved', error.message); }
  };
  const acceptRequest = async (team, request) => {
    if (!canReviewRequests(team) || team.members >= team.capacity) {
      if (team.members >= team.capacity) Alert.alert('Team is full', 'Increase the team capacity before accepting another player.');
      return;
    }
    try { await reviewTeamRequest(request, true); } catch (error) { Alert.alert('Request not accepted', error.message); return; }
    const nextMemberCount = team.members + 1;
    const updated = { ...team, members: nextMemberCount, status: nextMemberCount >= 4 ? 'active' : 'forming', acceptedMembers: [...(team.acceptedMembers || []), request] };
    replaceTeam(updated);
    setJoinRequests((current) => ({ ...current, [team.id]: (current[team.id] || []).filter((item) => item.id !== request.id) }));
  };
  const declineRequest = async (team, requestId) => {
    if (!canReviewRequests(team)) return;
    const request = (joinRequests[team.id] || []).find((item) => item.id === requestId);
    try { await reviewTeamRequest(request, false); } catch (error) { Alert.alert('Request not declined', error.message); return; }
    setJoinRequests((current) => ({ ...current, [team.id]: (current[team.id] || []).filter((item) => item.id !== requestId) }));
  };
  const updateTeamImage = async (teamId) => {
    const team = joined.find((item) => item.id === teamId);
    if (!canEditTeam(team)) {
      Alert.alert('Admin permission required', 'Only the team creator or an admin can change the team photo.');
      return;
    }
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (!result.canceled) {
      try {
        const image = await uploadTeamImage(teamId, result.assets[0].uri);
        const updated = { ...team, image };
        await updateTeamRecord(teamId, updated);
        replaceTeam(updated);
      } catch (error) { Alert.alert('Photo not saved', error.message); }
    }
  };
  if (editingTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><TeamForm team={editingTeam} onBack={() => { setEditingTeam(null); setHubTeam(editingTeam); }} onSave={saveTeam} /></SafeAreaView>;
  if (invitingTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><PlayerInviteScreen team={invitingTeam} onBack={() => { setInvitingTeam(null); setHubTeam(invitingTeam); }} /></SafeAreaView>;
  if (liveScoreTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><LiveScore team={liveScoreTeam} match={liveMatches[liveScoreTeam.id]} scoringMode={liveScoreMode === 'scorer'} currentUserId={user?.id} onRally={(winner) => recordRally(liveScoreTeam.id, winner)} onSwitchServe={() => switchMatchServe(liveScoreTeam.id)} onBack={() => { setLiveScoreTeam(null); setLiveScoreMode('viewer'); }} /></SafeAreaView>;
  if (chatTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><TeamChat team={chatTeam} messages={messages[chatTeam.id] || []} typing={typingByTeam[chatTeam.id]} liveMatch={liveMatches[chatTeam.id]} onWatchLive={() => { setLiveScoreMode('viewer'); setLiveScoreTeam(chatTeam); }} onSend={sendMessage} onAttach={attachPhoto} onInfo={() => { setSelected(chatTeam); setChatTeam(null); }} onBack={() => { setSelected(chatTeam); setChatTeam(null); }} /></SafeAreaView>;
  if (hubTeam) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><TeamHub team={hubTeam} requests={joinRequests[hubTeam.id] || []} liveMatch={liveMatches[hubTeam.id]} onScoreMatch={() => { if (liveMatches[hubTeam.id]?.scorerId === user?.id) { setLiveScoreMode('scorer'); setLiveScoreTeam(hubTeam); } }} onBack={() => { setHubTeam(null); setSelected(hubTeam); }} onUpdateImage={updateTeamImage} onEdit={() => { if (canEditTeam(hubTeam)) { setEditingTeam(hubTeam); setHubTeam(null); } }} onInvite={() => { setInvitingTeam(hubTeam); setHubTeam(null); }} onAccept={(request) => acceptRequest(hubTeam, request)} onDecline={(requestId) => declineRequest(hubTeam, requestId)} /></SafeAreaView>;
  if (selected) return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><TeamDetail team={selected} joined={joined.some((team) => team.id === selected.id)} requested={requested.includes(selected.id)} onBack={() => setSelected(null)} onJoin={() => requestJoin(selected.id)} onShare={() => shareTeam(selected)} onChat={() => { setChatTeam(selected); setSelected(null); }} onViewHub={() => { setHubTeam(selected); setSelected(null); }} onUpdateImage={updateTeamImage} /></SafeAreaView>;
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}><View><Text style={styles.eyebrow}>FIND YOUR PEOPLE</Text><Text style={styles.h1}>Teams</Text></View><View style={styles.headerActions}><Pressable accessibilityLabel="Change search location" onPress={() => setLocationOpen(true)} style={styles.teamLocation}><Icon name="location" size={15} color={C.optic} /><Text numberOfLines={1} style={styles.teamLocationText}>{userLocation.label}</Text></Pressable><Pressable onPress={openCreate} style={styles.createButton}><Icon name="add" size={18} color="#000000" /><Text style={styles.createText}>Create</Text></Pressable></View></View><KitchenLine />
        <View style={styles.tabs}>{['Joined', 'Discover'].map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text>{item === 'Joined' && <View style={[styles.count, tab === item && styles.countActive]}><Text style={[styles.countText, tab === item && styles.countTextActive]}>{joined.length + invitations.length}</Text></View>}</Pressable>)}</View>
        {tab === 'Discover' && <><View style={styles.search}><Icon name="search-outline" color={C.ink40} /><TextInput value={query} onChangeText={setQuery} placeholder="Search teams, area, or level" placeholderTextColor={C.ink40} style={styles.searchInput} /></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{['For you', 'Nearby', 'My level', 'Open spots'].map((item) => <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.filterActive]}><Text style={filter === item ? styles.filterActiveText : styles.filterText}>{item}</Text></Pressable>)}</ScrollView><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>NEAREST TO {userLocation.label.toUpperCase()}</Text><Text style={styles.h2}>{discoverTeams.length} teams to explore</Text></View><Text style={styles.sectionLink}>Closest first</Text></View>{discoverTeams.map((team) => <TeamCard key={team.id} team={team} requested={requested.includes(team.id)} onJoin={() => requestJoin(team.id)} onOpen={() => setSelected(team)} />)}{!discoverTeams.length && <View style={styles.empty}><Icon name="people-outline" size={35} color={C.ink40} /><Text style={styles.emptyTitle}>No teams found</Text><Text style={styles.footText}>Try another filter or change your search location.</Text></View>}</>}
        {tab === 'Joined' && <><View style={styles.joinedIntro}><View style={styles.joinedIcon}><Icon name="people" color={C.teal} /></View><View style={styles.joinedIntroCopy}><Text style={styles.joinedIntroTitle}>Your teams live here</Text><Text style={styles.footText}>Open a team to see members, matches, and chat.</Text></View></View>{invitations.length > 0 && <><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>ACTION REQUIRED</Text><Text style={styles.h2}>Team invitations</Text></View><Text style={styles.sectionLink}>{invitations.length} pending</Text></View>{invitations.map((invitation) => <TeamInvitationCard key={invitation.id} invitation={invitation} onAccept={() => respondInvitation(invitation, true)} onDecline={() => respondInvitation(invitation, false)} />)}</>}<View style={styles.sectionHead}><View><Text style={styles.eyebrow}>YOUR ROSTER</Text><Text style={styles.h2}>Teams you've joined</Text></View></View>{joined.map((team) => <TeamCard key={team.id} team={team} joined onOpen={() => setSelected(team)} />)}<Pressable onPress={() => setTab('Discover')} style={styles.exploreButton}><Icon name="compass-outline" color={C.teal} /><View style={styles.exploreCopy}><Text style={styles.exploreTitle}>Find another team</Text><Text style={styles.footText}>Browse public teams with open spots.</Text></View><Icon name="arrow-forward" color={C.teal} /></Pressable></>}
      </ScrollView>
      <LocationPicker visible={locationOpen} onClose={() => setLocationOpen(false)} />

      {/* Slide-up Create Team sheet */}
      {creating && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { transform: [{ translateY: createSlide }] },
          ]}
        >
          <SafeAreaView style={styles.safe}>
            <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
            <TeamForm onBack={closeCreate} onSave={createTeam} />
          </SafeAreaView>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: .08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 } });
const lightStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper }, content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 40 }, header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerActions: { maxWidth: '58%', flexDirection: 'row', alignItems: 'center', gap: 7 }, teamLocation: { maxWidth: 118, minHeight: 42, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, teamLocationText: { flexShrink: 1, color: C.teal, fontSize: 9, fontWeight: '800' }, eyebrow: { color: C.ink40, fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1 }, h1: { color: C.ink, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -.8 }, h2: { color: C.ink, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -.5 }, createButton: { minHeight: 42, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 13, backgroundColor: C.optic }, createText: { color: '#000000', fontSize: 11, fontWeight: '800' }, kitchen: { height: 7, marginTop: 18, marginBottom: 22 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 },
  tabs: { padding: 4, flexDirection: 'row', borderRadius: 13, backgroundColor: '#E5E9E3' }, tab: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10 }, tabActive: { backgroundColor: C.optic, ...shadow }, tabText: { color: C.ink40, fontSize: 12, fontWeight: '800' }, tabTextActive: { color: C.ink }, count: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.line }, countActive: { backgroundColor: C.ink }, countText: { color: C.ink40, fontSize: 8, fontWeight: '800' }, countTextActive: { color: C.paper }, search: { height: 50, marginTop: 15, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, searchInput: { flex: 1, color: C.ink, fontSize: 13 }, filters: { gap: 8, paddingVertical: 12 }, filter: { minHeight: 35, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, filterActive: { borderColor: C.ink, backgroundColor: C.ink }, filterText: { color: C.ink70, fontSize: 10, fontWeight: '700' }, filterActiveText: { color: C.paper, fontSize: 10, fontWeight: '800' }, sectionHead: { marginTop: 9, marginBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, sectionLink: { color: C.teal, fontSize: 9, fontWeight: '700' },
  teamCard: { marginBottom: 13, padding: 15, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, ...shadow }, teamHead: { flexDirection: 'row', alignItems: 'center', gap: 11 }, crest: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, crestTag: { position: 'absolute', bottom: 4, color: 'rgba(255,255,255,.68)', fontWeight: '900', letterSpacing: .5 }, teamCopy: { flex: 1 }, nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, teamName: { maxWidth: '70%', color: C.ink, fontSize: 16, fontWeight: '800' }, teamMetaRow: { marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 7 }, teamMotto: { flexShrink: 1, color: C.ink40, fontSize: 10 }, statusBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: '#F7EAE6' }, statusBadgeActive: { backgroundColor: '#E5F0ED' }, statusBadgeText: { color: C.brick, fontSize: 6, fontWeight: '900', letterSpacing: .35 }, statusBadgeTextActive: { color: C.teal }, joinedBadge: { paddingHorizontal: 6, height: 19, flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 6, backgroundColor: '#E5F0ED' }, joinedText: { color: C.teal, fontSize: 7, fontWeight: '900' }, stats: { marginTop: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 14, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line }, stat: { paddingRight: 14, borderRightWidth: 1, borderColor: C.line }, statValue: { color: C.ink, fontSize: 15, fontWeight: '800' }, statLabel: { marginTop: 2, color: C.ink40, fontSize: 7, fontWeight: '800', letterSpacing: .7 }, level: { marginLeft: 'auto', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 7, backgroundColor: C.paper }, levelAdvanced: { backgroundColor: '#F7EAE6' }, levelText: { color: C.teal, fontSize: 8, fontWeight: '800' }, levelTextAdvanced: { color: C.brick }, teamFoot: { minHeight: 37, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }, teamPlace: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 }, visibilityLabel: { flexDirection: 'row', alignItems: 'center', gap: 3 }, footText: { color: C.ink40, fontSize: 9, lineHeight: 14 }, joinButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 11, backgroundColor: C.optic }, joinButtonText: { color: C.ink, fontSize: 11, fontWeight: '800' }, requestedButton: { borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' }, requestedText: { color: C.teal }, pressed: { opacity: .78, transform: [{ scale: .985 }] },
  joinedIntro: { marginTop: 15, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: '#E5F0ED' }, joinedIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.surface }, joinedIntroCopy: { flex: 1 }, joinedIntroTitle: { color: C.ink, fontSize: 12, fontWeight: '800' }, exploreButton: { minHeight: 68, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed' }, exploreCopy: { flex: 1 }, exploreTitle: { color: C.teal, fontSize: 12, fontWeight: '800' }, empty: { paddingVertical: 60, alignItems: 'center' }, emptyTitle: { marginTop: 10, marginBottom: 3, color: C.ink, fontSize: 17, fontWeight: '800' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, iconButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface }, detailHeaderCopy: { flex: 1 }, detailHeaderTitle: { color: C.ink, fontSize: 20, fontWeight: '800' }, hero: { paddingVertical: 25, alignItems: 'center', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 }, heroTitle: { marginTop: 12, color: C.surface, fontSize: 24, fontWeight: '800' }, heroMotto: { marginTop: 4, color: 'rgba(255,255,255,.72)', fontSize: 11 }, heroLocation: { marginTop: 13, flexDirection: 'row', alignItems: 'center', gap: 4 }, heroLocationText: { color: 'rgba(255,255,255,.72)', fontSize: 10 }, detailStats: { marginTop: 13, padding: 15, flexDirection: 'row', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, detailStat: { flex: 1, alignItems: 'center', borderRightWidth: 1, borderColor: C.line }, detailStatValue: { color: C.ink, fontSize: 22, fontWeight: '800' }, sectionLabel: { marginTop: 23, marginBottom: 8, color: C.ink, fontSize: 10, fontWeight: '800', letterSpacing: .9 }, about: { color: C.ink70, fontSize: 12, lineHeight: 19 }, requirement: { marginTop: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 13, backgroundColor: '#E5F0ED' }, requirementCopy: { flex: 1 }, requirementTitle: { color: C.ink, fontSize: 11, fontWeight: '800' }, members: { flexDirection: 'row', marginBottom: 22 }, avatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: C.paper, alignItems: 'center', justifyContent: 'center' }, avatarOffset: { marginLeft: -9 }, avatarText: { color: C.surface, fontSize: 9, fontWeight: '800' }, primaryButton: { minHeight: 52, paddingHorizontal: 17, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: C.optic }, primaryText: { color: C.ink, fontSize: 12, fontWeight: '800' }, requestedLarge: { backgroundColor: '#D9E8E3' }, memberActions: { flexDirection: 'row', gap: 9 }, messageButton: { minHeight: 52, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, messageText: { color: C.teal, fontSize: 11, fontWeight: '800' },
  hubHero: { padding: 18, borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 }, hubIdentity: { flexDirection: 'row', alignItems: 'center', gap: 13 }, hubIdentityCopy: { flex: 1 }, hubTitle: { color: C.surface, fontSize: 22, fontWeight: '800' }, hubMeta: { marginTop: 3, color: 'rgba(255,255,255,.68)', fontSize: 10 }, rolePill: { alignSelf: 'flex-start', marginTop: 7, paddingHorizontal: 7, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, backgroundColor: 'rgba(255,255,255,.16)' }, rolePillText: { color: C.surface, fontSize: 8, fontWeight: '800' }, hubRecord: { marginTop: 18, paddingTop: 15, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderColor: 'rgba(255,255,255,.2)' }, hubRecordValue: { color: C.surface, fontSize: 20, fontWeight: '800' }, hubRecordLabel: { marginTop: 2, color: 'rgba(255,255,255,.55)', fontSize: 7, fontWeight: '800', letterSpacing: .6 }, formingNotice: { marginTop: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 13, backgroundColor: '#E5F0ED' }, noticeInvite: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, backgroundColor: C.surface }, hubTabs: { marginTop: 14, padding: 4, flexDirection: 'row', borderRadius: 13, backgroundColor: '#E5E9E3' }, hubTab: { flex: 1, minHeight: 40, paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, hubTabActive: { backgroundColor: C.optic, ...shadow }, hubTabText: { color: C.ink40, fontSize: 9, fontWeight: '800' }, hubTabTextActive: { color: C.ink }, inviteButton: { minHeight: 38, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, inviteButtonText: { color: C.teal, fontSize: 10, fontWeight: '800' }, rosterCard: { overflow: 'hidden', borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, rosterRow: { minHeight: 67, marginHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, rosterBorder: { borderTopWidth: 1, borderColor: C.line }, rosterAvatar: { width: 39, height: 39, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, rosterCopy: { flex: 1 }, rosterName: { color: C.ink, fontSize: 11, fontWeight: '800' }, rosterRating: { alignItems: 'flex-end' }, rosterRatingValue: { color: C.teal, fontSize: 16, fontWeight: '800' }, requestCard: { marginBottom: 11, padding: 14, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, requestHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, requestNote: { marginTop: 11, color: C.ink70, fontSize: 10, lineHeight: 16 }, requestActions: { marginTop: 13, flexDirection: 'row', gap: 8 }, declineButton: { minHeight: 40, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: C.line }, declineText: { color: C.ink70, fontSize: 10, fontWeight: '800' }, acceptButton: { minHeight: 40, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 11, backgroundColor: C.optic }, emptyRequests: { paddingVertical: 55, alignItems: 'center' }, matchDate: { width: 48, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: C.optic }, matchMonth: { color: C.ink, fontSize: 7, fontWeight: '900' }, matchDay: { color: C.ink, fontSize: 20, fontWeight: '900' }, matchCopy: { flex: 1 }, matchLabel: { color: C.teal, fontSize: 7, fontWeight: '800', letterSpacing: .7 }, matchTitle: { marginVertical: 3, color: C.ink, fontSize: 13, fontWeight: '800' }, nextTeamMatch: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }, resultCard: { marginTop: 10, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, resultMark: { width: 34, height: 34, paddingTop: 9, borderRadius: 9, overflow: 'hidden', color: C.teal, backgroundColor: '#E5F0ED', textAlign: 'center', fontSize: 11, fontWeight: '900' }, resultScore: { color: C.teal, fontSize: 16, fontWeight: '900' }, activityCard: { overflow: 'hidden', borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, activityRow: { minHeight: 76, marginHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, activityIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, activityText: { color: C.ink70, fontSize: 11, lineHeight: 16 },
  formPhoto: { marginBottom: 20, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, backgroundColor: '#E5F0ED' }, formPhotoCopy: { flex: 1 }, formPhotoTitle: { color: C.ink, fontSize: 13, fontWeight: '800' }, photoButton: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: C.surface }, photoButtonText: { color: C.teal, fontSize: 9, fontWeight: '800' }, formField: { marginBottom: 15 }, formLabel: { marginBottom: 7, color: C.ink70, fontSize: 9, fontWeight: '800', letterSpacing: .8 }, formInput: { minHeight: 50, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: C.line, color: C.ink, backgroundColor: C.surface, fontSize: 12 }, formTextarea: { minHeight: 100, paddingTop: 13, textAlignVertical: 'top' }, levelOptions: { marginBottom: 17, flexDirection: 'row', gap: 7 }, levelOption: { minHeight: 38, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, levelOptionActive: { borderColor: C.ink, backgroundColor: C.ink }, levelOptionText: { color: C.ink70, fontSize: 8, fontWeight: '800' }, levelOptionTextActive: { color: C.surface }, visibilityOptions: { marginBottom: 17, flexDirection: 'row', gap: 8 }, visibilityOption: { minHeight: 82, flex: 1, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, visibilityOptionActive: { borderColor: C.ink, backgroundColor: C.ink }, visibilityCopy: { flex: 1 }, visibilityTitle: { color: C.ink, fontSize: 10, fontWeight: '900' }, visibilityTitleActive: { color: C.surface }, visibilityHelp: { marginTop: 4, color: C.ink40, fontSize: 8, lineHeight: 12 }, visibilityHelpActive: { color: 'rgba(255,255,255,.65)' }, formNotice: { marginBottom: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#E5F0ED' }, formNoticeText: { flex: 1, color: C.ink70, fontSize: 9, lineHeight: 14 }, saveButton: { minHeight: 53, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: C.optic },
  inviteProgress: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: '#E5F0ED' }, inviteProgressIcon: { width: 43, height: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface }, inviteProgressTitle: { color: C.ink, fontSize: 12, fontWeight: '900' }, invitePrivacy: { marginTop: 12, color: C.ink40, fontSize: 9, lineHeight: 14 }, searchingText: { paddingVertical: 24, color: C.ink40, textAlign: 'center', fontSize: 10 }, playerResults: { marginTop: 12, overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, playerResult: { minHeight: 70, marginHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, invitePlayerButton: { minHeight: 37, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, backgroundColor: C.optic }, invitePlayerButtonSent: { borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: '#E5F0ED' }, invitePlayerText: { color: C.ink, fontSize: 9, fontWeight: '900' }, invitePlayerTextSent: { color: C.teal }, invitationCard: { marginBottom: 12, padding: 15, borderRadius: 20, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: C.surface, ...shadow }, invitationEyebrow: { marginBottom: 3, color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, invitationMeta: { marginTop: 13, paddingTop: 11, flexDirection: 'row', alignItems: 'center', gap: 4, borderTopWidth: 1, borderColor: C.line }, invitationExpiry: { marginTop: 5, color: C.ink40, fontSize: 8 },
  chatScreen: { flex: 1 }, chatHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }, onlineRow: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 4 }, onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.teal }, chatStatus: { color: C.ink40, fontSize: 8 }, chatRule: { height: 1, backgroundColor: C.line }, chatMessages: { flex: 1 }, chatContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 16 }, chatDay: { marginBottom: 13, color: C.ink40, textAlign: 'center', fontSize: 7, fontWeight: '900', letterSpacing: .8 }, messageRow: { marginTop: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 7 }, messageRowMine: { justifyContent: 'flex-end' }, messageGrouped: { marginTop: 4 }, chatAvatar: { width: 31, height: 31, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, chatAvatarSpacer: { width: 31 }, messageBlock: { maxWidth: '76%', alignItems: 'flex-start' }, messageBlockMine: { alignItems: 'flex-end' }, sender: { marginLeft: 4, marginBottom: 3, color: C.ink40, fontSize: 8, fontWeight: '800' }, bubble: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 15, borderBottomLeftRadius: 4, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }, bubbleMine: { borderBottomLeftRadius: 15, borderBottomRightRadius: 4, borderColor: C.teal, backgroundColor: C.teal }, bubbleText: { color: C.ink, fontSize: 11, lineHeight: 16 }, bubbleTextMine: { color: C.surface }, messageTime: { marginTop: 3, marginLeft: 4, color: C.ink40, fontSize: 7 }, messageTimeMine: { marginLeft: 0, marginRight: 4 }, composer: { paddingHorizontal: 12, paddingTop: 9, paddingBottom: 9, flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.surface }, addAttachment: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, composerInput: { minHeight: 43, flex: 1, paddingLeft: 13, paddingRight: 4, flexDirection: 'row', alignItems: 'center', borderRadius: 22, backgroundColor: C.paper }, chatInput: { flex: 1, maxHeight: 92, paddingVertical: 10, color: C.ink, fontSize: 11 }, sendButton: { width: 35, height: 35, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, sendDisabled: { opacity: .35 },
  chatAttachmentImage: { width: 180, height: 130, marginBottom: 7, borderRadius: 10 }, typingRow: { marginTop: 9, flexDirection: 'row', alignItems: 'flex-end', gap: 7 }, typingBubble: { width: 51, height: 35, paddingVertical: 3, alignItems: 'center', justifyContent: 'center' }, typingDots: { minWidth: 25, color: C.ink40, fontSize: 20, lineHeight: 20, fontWeight: '900', letterSpacing: 2 }, autoMatchMessage: { marginTop: 17 }, autoMatchLabel: { marginBottom: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }, autoMatchLabelText: { color: C.ink40, fontSize: 7, fontWeight: '700' }, liveCard: { overflow: 'hidden', borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: C.surface, ...shadow }, liveCardHead: { paddingHorizontal: 13, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, liveBadge: { paddingHorizontal: 7, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 7, backgroundColor: '#F7EAE6' }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.brick }, liveBadgeText: { color: C.brick, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, liveGame: { color: C.ink40, fontSize: 7, fontWeight: '800', letterSpacing: .6 }, livePlayers: { marginTop: 9, color: C.ink40, textAlign: 'center', fontSize: 8 }, liveScoreRow: { minHeight: 75, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }, liveTeam: { width: 65, alignItems: 'center' }, liveTeamAway: { alignItems: 'center' }, liveTag: { color: C.teal, fontSize: 8, fontWeight: '900' }, liveTeamName: { marginTop: 3, color: C.ink70, textAlign: 'center', fontSize: 7 }, liveScore: { width: 38, color: C.ink, textAlign: 'center', fontSize: 29, fontWeight: '900' }, liveDash: { color: C.ink40, fontSize: 16 }, cardServing: { marginHorizontal: 12, marginBottom: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 9, backgroundColor: '#E5F0ED' }, cardServingText: { color: C.teal, fontSize: 7, fontWeight: '800' }, liveCardFoot: { minHeight: 43, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderColor: C.line, backgroundColor: '#F8F9F5' }, liveLastPlay: { flex: 1, color: C.ink40, fontSize: 7 }, watchLive: { flexDirection: 'row', alignItems: 'center', gap: 3 }, watchLiveText: { color: C.ink, fontSize: 8, fontWeight: '900' },
  liveHeaderBadge: { paddingHorizontal: 9, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 9, backgroundColor: '#F7EAE6' }, liveHeaderText: { color: C.brick, fontSize: 8, fontWeight: '900' }, scoreHero: { padding: 18, alignItems: 'center', borderRadius: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: C.ink }, scoreVenue: { color: 'rgba(255,255,255,.6)', fontSize: 9 }, scoreGame: { marginTop: 8, color: C.optic, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, scoreTeams: { width: '100%', marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scoreTeam: { width: 82, alignItems: 'center' }, scoreCrest: { width: 49, height: 49, borderRadius: 17, borderBottomLeftRadius: 7, borderBottomRightRadius: 7, alignItems: 'center', justifyContent: 'center' }, scoreCrestText: { color: C.surface, fontSize: 9, fontWeight: '900' }, scoreTeamName: { marginTop: 7, color: C.surface, textAlign: 'center', fontSize: 9, fontWeight: '800' }, scoreNumbers: { flexDirection: 'row', alignItems: 'center' }, scoreNumber: { width: 48, color: C.surface, textAlign: 'center', fontSize: 43, fontWeight: '900' }, scoreSeparator: { color: 'rgba(255,255,255,.35)', fontSize: 24 }, servingRow: { marginTop: 17, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.1)' }, servingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.optic }, servingText: { color: C.surface, fontSize: 8, fontWeight: '800' }, scorerPanel: { marginTop: 13, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: C.surface }, scorerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scorerTitle: { color: C.ink, fontSize: 14, fontWeight: '800' }, scorerBadge: { paddingHorizontal: 7, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, backgroundColor: '#E5F0ED' }, scorerBadgeText: { color: C.teal, fontSize: 7, fontWeight: '900' }, scorerHelp: { marginTop: 9, color: C.ink40, fontSize: 9, lineHeight: 14 }, rallyButtons: { marginTop: 12, flexDirection: 'row', gap: 8 }, rallyButton: { minHeight: 70, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, rallyButtonServing: { borderColor: C.teal, backgroundColor: '#E5F0ED' }, rallyTag: { color: C.teal, fontSize: 8, fontWeight: '900' }, rallyButtonText: { marginTop: 3, color: C.ink, fontSize: 10, fontWeight: '800' }, rallyServingText: { marginTop: 4, color: C.brick, fontSize: 6, fontWeight: '900', letterSpacing: .7 }, switchServeButton: { minHeight: 50, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, backgroundColor: C.teal, ...shadow }, switchServeText: { color: C.surface, fontSize: 11, fontWeight: '900', letterSpacing: .3 }, liveInfoCard: { marginTop: 13, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, syncBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 }, syncText: { color: C.teal, fontSize: 8, fontWeight: '800' }, liveActivity: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, liveActivityIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, liveNotice: { marginTop: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 13, backgroundColor: '#E5F0ED' }, liveNoticeText: { flex: 1, color: C.ink70, fontSize: 9, lineHeight: 14 },
  viewerNotice: { marginTop: 13, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, viewerBadge: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7, backgroundColor: C.paper }, viewerBadgeText: { color: C.ink40, fontSize: 7, fontWeight: '900' }, boxScore: { overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, boxScoreRow: { minHeight: 45, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' }, boxScoreBorder: { borderTopWidth: 1, borderColor: C.line }, boxTeam: { flex: 1, color: C.ink, fontSize: 9, fontWeight: '800' }, boxValue: { width: 35, color: C.ink, textAlign: 'center', fontSize: 13, fontWeight: '900' }, boxHeader: { color: C.ink40, fontSize: 7, letterSpacing: .5 }, boxCurrent: { color: C.teal, backgroundColor: '#E5F0ED', borderRadius: 6, overflow: 'hidden', lineHeight: 25 }, boxWon: { color: C.teal }, boxFootnote: { paddingHorizontal: 12, paddingBottom: 9, color: C.ink40, fontSize: 7 }, scorerAssignment: { marginBottom: 11, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: '#BFD8D2', backgroundColor: C.surface }, scorerAssignmentHead: { marginBottom: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, openScorerButton: { minHeight: 43, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: C.optic },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
