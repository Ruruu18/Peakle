import React from 'react';
import { AppState } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { requireSupabase } from '../../lib/supabase';
import useMatchVerificationSync from '../useMatchVerificationSync';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));

function buildClient() {
  const handlers = {};
  const channel = {
    on: jest.fn((type, { table }, handler) => { handlers[table] = handler; return channel; }),
    subscribe: jest.fn(() => channel),
  };
  return { handlers, channel, client: { channel: jest.fn(() => channel), removeChannel: jest.fn() } };
}

function Probe({ userId, onChange }) {
  useMatchVerificationSync(userId, onChange);
  return null;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

it('subscribes to match, confirmation and rating changes and debounces bursts into one refresh', () => {
  const { handlers, client } = buildClient();
  requireSupabase.mockReturnValue(client);
  const onChange = jest.fn();
  act(() => { TestRenderer.create(<Probe userId="u1" onChange={onChange} />); });

  expect(Object.keys(handlers).sort()).toEqual(['match_result_confirmations', 'matches', 'player_ratings']);
  handlers.match_result_confirmations();
  handlers.matches();
  handlers.player_ratings();
  expect(onChange).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(250); });
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('refreshes when the app returns to the foreground', () => {
  const { client } = buildClient();
  requireSupabase.mockReturnValue(client);
  let listener;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => { listener = handler; return { remove }; });
  const onChange = jest.fn();
  let renderer;
  act(() => { renderer = TestRenderer.create(<Probe userId="u1" onChange={onChange} />); });

  listener('active');
  act(() => { jest.advanceTimersByTime(250); });
  expect(onChange).toHaveBeenCalledTimes(1);

  act(() => { renderer.unmount(); });
  expect(remove).toHaveBeenCalled();
  expect(client.removeChannel).toHaveBeenCalled();
});

it('does nothing without a signed-in player', () => {
  const { client } = buildClient();
  requireSupabase.mockReturnValue(client);
  act(() => { TestRenderer.create(<Probe userId={null} onChange={jest.fn()} />); });
  expect(client.channel).not.toHaveBeenCalled();
});
