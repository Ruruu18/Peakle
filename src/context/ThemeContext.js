import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@peakle/color-mode';
const ThemeContext = createContext(null);

export const LIGHT_CONTENT_COLORS = Object.freeze({
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', brick: '#B6472E', error: '#A63B2B', ink70: '#3C4A45',
  ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED', brickWash: '#F7EAE6',
});

// These colors are used by values supplied directly in JSX (icons, placeholders,
// and status bars). StyleSheet colors are converted separately below.
export const DARK_CONTENT_COLORS = Object.freeze({
  ink: '#F3F5EF', paper: '#0E2321', surface: '#F3F5EF', optic: '#D6E94A',
  teal: '#72C7BE', brick: '#FF9A80', error: '#FF9A80', ink70: '#C6D2CC',
  ink40: '#9FB3AC', line: '#304743', tealWash: '#203B37', brickWash: '#402C29',
});

const FOREGROUND_COLORS = {
  '#0E2321': '#F3F5EF',
  '#3C4A45': '#C6D2CC',
  '#7C8983': '#9FB3AC',
  '#1C6B66': '#72C7BE',
  '#B6472E': '#FF9A80',
  '#A63B2B': '#FF9A80',
  '#7A5A08': '#E4C765',
  '#46515B': '#C3CDD5',
  '#9F2F25': '#FF9A80',
  '#DDE3DA': '#304743',
};

const BACKGROUND_COLORS = {
  '#F3F5EF': '#0E2321',
  '#FFFFFF': '#17302D',
  '#FFFDFC': '#17302D',
  '#FFF9F7': '#402C29',
  '#F8F9F5': '#17302D',
  '#0E2321': '#102825',
  '#3C4A45': '#24433F',
  '#E5F0ED': '#203B37',
  '#E5E9E3': '#203B37',
  '#E7EBE7': '#203B37',
  '#E7EBE6': '#203B37',
  '#E9ECE7': '#203B37',
  '#ECEFEA': '#203B37',
  '#DDE3DA': '#304743',
  '#C9D0CB': '#304743',
  '#A6C6C0': '#35534E',
  '#F0F6D4': '#34412E',
  '#F1F4D3': '#34412E',
  '#F9FCEB': '#34412E',
  '#FAFCEB': '#34412E',
  '#F4F9F7': '#203B37',
  '#F6FAF8': '#203B37',
  '#F7FAF7': '#203B37',
  '#D9E8E3': '#203B37',
  '#F7EAE6': '#402C29',
  '#F8EDE9': '#402C29',
  '#F7E7E4': '#402C29',
  '#F5E4DF': '#402C29',
  '#F9ECE8': '#402C29',
  '#FBEDEA': '#402C29',
  '#FDECEA': '#402C29',
  '#FFF5F2': '#402C29',
  '#FBF5E4': '#463C24',
  '#EEF1F3': '#2C363D',
  '#F4F1E7': '#2E3B36',
};

const BORDER_COLORS = {
  '#DDE3DA': '#304743',
  '#BFD8D2': '#35534E',
  '#C8D8D3': '#35534E',
  '#C9DCD7': '#35534E',
  '#E2C4BC': '#67433A',
  '#E7CFC7': '#67433A',
  '#E2B5A9': '#67433A',
  '#E8C7BF': '#67433A',
  '#E5B8AE': '#67433A',
  '#E5F0ED': '#35534E',
  '#DFE8AD': '#4A5430',
  '#E8ECE5': '#304743',
  '#8C98A3': '#53616C',
  '#0E2321': '#9FB3AC',
  '#F3F5EF': '#304743',
  '#FFFFFF': '#304743',
};

const ACCENT_INK_STYLES = new Set([
  'primaryText', 'heroTitle', 'heroMeta', 'heroBody', 'gpsTitle', 'gpsBody',
  'stepNumberText', 'addPlayerText', 'matchPointText', 'coachStep', 'coachTitle',
  'coachMeta', 'timeTextActive', 'appModeOptionTextActive', 'editChoiceTextActive',
  'tabTextActive', 'hubTabTextActive', 'segmentTextActive', 'matchMonth', 'matchDay',
  'avatarBadgeText', 'surpriseText',
  'saveText', 'addText', 'createVenueText', 'approveVenueText', 'repairLocationText',
  'modalConfirmText', 'confirmText', 'retryText',
  'choiceTextActive', 'calendarDayTextActive', 'timeOptionTextActive',
  'lineupModeTextActive', 'staffVenueTextActive', 'approveText', 'spotsText',
  'newPillText', 'stepIntroTitle', 'stepIntroBody', 'organizerMonitorText',
  'operationTabTextActive', 'countPillText', 'useCurrentBaseTitle', 'useCurrentBaseMeta', 'coverJoinedText', 'coverJoined',
  'acceptButtonText', 'acceptText', 'acceptInviteText', 'inviteButtonText', 'joinedChipText',
  'serverChoiceTextSelected', 'drawServeStatusTextActive',
  'courtFormatText', 'tvNextNames', 'tvReason', 'saveUnfinishedText', 'pauseText',
  'joinButtonText', 'invitePlayerText', 'chatSafetyPrimaryText', 'wizardDotTextActive',
  'locGpsBtnTitle', 'positionNumber', 'nearlyText', 'inlineActionPillText', 'ownerText',
  'switchDestinationText', 'gameBreakContinueText', 'openPlayRallyTagAccent',
  'openPlayRallyNameAccent', 'openPlayRallyActionAccent', 'openPlayFinishText',
  'openPlayPlayFinishText', 'liveMatchPillText'
]);

// Active switches keep the brighter yellow-green brand accent in dark mode.
const DARK_SWITCH_ACTIVE_BACKGROUNDS = new Set(['toggleOn', 'visibilityButtonOn']);
const DARK_SWITCH_ACTIVE_FOREGROUNDS = new Set(['visibilityDotOn', 'visibilityTextOn']);

function mapStyleColor(styleName, property, value) {
  if (typeof value !== 'string') return value;
  const normalized = value.toUpperCase();
  if (DARK_SWITCH_ACTIVE_BACKGROUNDS.has(styleName) && property === 'backgroundColor') return LIGHT_CONTENT_COLORS.optic;
  if (DARK_SWITCH_ACTIVE_FOREGROUNDS.has(styleName) && (property === 'backgroundColor' || property === 'color')) return LIGHT_CONTENT_COLORS.ink;
  if (property === 'backgroundColor') return BACKGROUND_COLORS[normalized] || value;
  if (property === 'shadowColor') return normalized === '#0E2321' ? '#000000' : value;
  if (property.includes('border') && property.endsWith('Color')) return BORDER_COLORS[normalized] || FOREGROUND_COLORS[normalized] || value;
  if (property === 'color' || property === 'tintColor' || property === 'textDecorationColor' || property === 'textShadowColor') {
    if (ACCENT_INK_STYLES.has(styleName) && (normalized === '#0E2321' || normalized === '#3C4A45')) return value;
    return FOREGROUND_COLORS[normalized] || value;
  }
  return value;
}

/** Create a cached dark counterpart from an existing light React Native StyleSheet. */
export function createDarkStyleSheet(lightStyles) {
  const darkDefinitions = Object.fromEntries(Object.entries(lightStyles).map(([name, registeredStyle]) => {
    const flatStyle = StyleSheet.flatten(registeredStyle) || {};
    return [name, Object.fromEntries(Object.entries(flatStyle).map(([property, value]) => [property, mapStyleColor(name, property, value)]))];
  }));
  return StyleSheet.create(darkDefinitions);
}

export function ThemeProvider({ children }) {
  const [colorMode, setColorModeState] = useState('light');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((savedMode) => {
        if (savedMode === 'light' || savedMode === 'dark') setColorModeState(savedMode);
      })
      .catch(() => {});
  }, []);

  const setColorMode = (nextMode) => {
    if (nextMode !== 'light' && nextMode !== 'dark') return;
    setColorModeState(nextMode);
    AsyncStorage.setItem(STORAGE_KEY, nextMode).catch(() => {});
  };

  const value = useMemo(() => ({
    colorMode,
    isDark: colorMode === 'dark',
    setColorMode,
    toggleColorMode: () => setColorMode(colorMode === 'dark' ? 'light' : 'dark'),
  }), [colorMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
