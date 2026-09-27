import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AppIcon from './AppIcon';
import ProfilePhoto from './ProfilePhoto';

// @mentions for team chats. Typing "@" opens a list of teammates (and
// @everyone); picking one writes "@Name" into the message and remembers who
// it was, so the server can notify them.

export const EVERYONE = { id: 'everyone', name: 'everyone' };
const EVERYONE_PATTERN = /(^|\s)@everyone\b/i;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The "@query" right before the cursor, if the player is typing a mention.
export function findMentionQuery(text, cursor) {
  const before = text.slice(0, cursor ?? text.length);
  const match = before.match(/(^|\s)@([^\s@]{0,30})$/);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

export function matchMentionPeople(people, query) {
  const needle = (query || '').toLowerCase();
  const everyone = !needle || 'everyone'.startsWith(needle) ? [EVERYONE] : [];
  const members = people.filter((person) => {
    if (!needle) return true;
    const name = (person.name || '').toLowerCase();
    return name.startsWith(needle) || name.split(/\s+/).some((word) => word.startsWith(needle));
  });
  return [...everyone, ...members].slice(0, 8);
}

// Replaces the "@query" being typed with "@Name ".
export function insertMention(text, mention, person) {
  const end = mention.start + 1 + mention.query.length;
  const inserted = `@${person.name} `;
  return { text: `${text.slice(0, mention.start)}${inserted}${text.slice(end)}`, cursor: mention.start + inserted.length };
}

// Who a finished message still mentions: picked people whose "@Name" is still
// in the text, and whether it says @everyone.
export function collectMentions(text, picked) {
  const ids = [...new Set(picked
    .filter((person) => person.id !== EVERYONE.id && text.includes(`@${person.name}`))
    .map((person) => person.id))];
  return { mentions: ids, mentionsEveryone: EVERYONE_PATTERN.test(text) };
}

export function MentionSuggestions({ people, query, colors, onPick }) {
  const options = useMemo(() => matchMentionPeople(people, query), [people, query]);
  if (!options.length) return null;
  return (
    <View style={[styles.list, { borderColor: colors.line, backgroundColor: colors.surface }]}>
      <ScrollView keyboardShouldPersistTaps="always" style={styles.scroll}>
        {options.map((person) => (
          <Pressable
            key={person.id}
            accessibilityRole="button"
            accessibilityLabel={person.id === EVERYONE.id ? 'Mention everyone in this team' : `Mention ${person.name}`}
            onPress={() => onPick(person)}
            style={({ pressed, hovered }) => [styles.option, (pressed || hovered) && { backgroundColor: colors.tealWash || colors.paper }]}
          >
            {person.id === EVERYONE.id ? (
              <View style={[styles.everyoneIcon, { backgroundColor: colors.tealWash || colors.paper }]}><AppIcon name="people" size={17} color={colors.teal} /></View>
            ) : (
              <ProfilePhoto photo={person.avatar} name={person.name} size={30} />
            )}
            <View style={styles.optionCopy}>
              <Text numberOfLines={1} style={[styles.optionName, { color: colors.ink }]}>{person.id === EVERYONE.id ? '@everyone' : person.name}</Text>
              {person.id === EVERYONE.id ? <Text numberOfLines={1} style={[styles.optionHint, { color: colors.ink40 }]}>Notify everyone in this team</Text> : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// Message text with "@Name" and "@everyone" highlighted.
export function MentionText({ text, names, style, mentionStyle, ...props }) {
  const parts = useMemo(() => {
    const known = [...new Set((names || []).filter(Boolean))].sort((a, b) => b.length - a.length).map(escapeRegExp);
    const pattern = new RegExp(`@(?:everyone\\b${known.length ? `|${known.join('|')}` : ''})`, 'gi');
    const pieces = [];
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > last) pieces.push({ text: text.slice(last, match.index) });
      pieces.push({ text: match[0], mention: true });
      last = match.index + match[0].length;
    }
    if (last < text.length) pieces.push({ text: text.slice(last) });
    return pieces;
  }, [names, text]);
  return (
    <Text style={style} {...props}>
      {parts.map((part, index) => (part.mention ? <Text key={index} style={mentionStyle}>{part.text}</Text> : part.text))}
    </Text>
  );
}

const styles = StyleSheet.create({
  list: { marginHorizontal: 12, marginBottom: 6, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  scroll: { maxHeight: 232 },
  option: { minHeight: 46, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  everyoneIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  optionCopy: { flex: 1, minWidth: 0 },
  optionName: { fontSize: 14, fontWeight: '700' },
  optionHint: { marginTop: 1, fontSize: 11 },
});
