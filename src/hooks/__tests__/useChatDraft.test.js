import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TestRenderer, { act } from 'react-test-renderer';
import { useChatDraft } from '../useChatDraft';

let current;
function Probe({ chatKey, paused }) {
  current = useChatDraft(chatKey, { paused });
  return null;
}
const stored = (key) => AsyncStorage.getItem(`peakle:chat-draft:${key}`);
async function render(props) {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(<Probe {...props} />); });
  return renderer;
}
const type = (text) => act(async () => { current[1](text); });

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('useChatDraft', () => {
  it('saves what is typed and restores it after a reload', async () => {
    const first = await render({ chatKey: 'dm:me:ana' });
    await type('See you at 6');
    expect(await stored('dm:me:ana')).toBe('See you at 6');
    act(() => first.unmount());

    await render({ chatKey: 'dm:me:ana' });
    expect(current[0]).toBe('See you at 6');
  });

  it('removes the draft once the message is sent', async () => {
    await render({ chatKey: 'dm:me:ana' });
    await type('On my way');
    await type('');
    expect(await stored('dm:me:ana')).toBeNull();
  });

  it('keeps each chat separate when switching chats', async () => {
    await AsyncStorage.setItem('peakle:chat-draft:team:me:b', 'Team B draft');
    const renderer = await render({ chatKey: 'team:me:a' });
    await type('Team A draft');
    await act(async () => { renderer.update(<Probe chatKey="team:me:b" />); });
    expect(current[0]).toBe('Team B draft');
    expect(await stored('team:me:a')).toBe('Team A draft');
    await act(async () => { renderer.update(<Probe chatKey="team:me:c" />); });
    expect(current[0]).toBe('');
    expect(await stored('team:me:c')).toBeNull();
  });

  it('does not save while paused, such as when editing a sent message', async () => {
    await AsyncStorage.setItem('peakle:chat-draft:team:me:a', 'Unsent');
    await render({ chatKey: 'team:me:a', paused: true });
    await type('Edited text of a sent message');
    expect(await stored('team:me:a')).toBe('Unsent');
  });

  it('keeps plain state without a key', async () => {
    await render({ chatKey: null });
    await type('Hello');
    expect(current[0]).toBe('Hello');
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });
});
