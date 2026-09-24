import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePublicEnvironment } from './public-env.mjs';

const jwt = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
const environment = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon'),
};

test('accepts public anon JWTs and publishable keys', () => {
  assert.doesNotThrow(() => validatePublicEnvironment(environment));
  assert.doesNotThrow(() => validatePublicEnvironment({ ...environment, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_example' }));
});

test('rejects privileged and malformed credentials without printing them', () => {
  for (const key of [jwt('service_role'), jwt('authenticated'), 'sb_secret_example', 'malformed']) {
    assert.throws(() => validatePublicEnvironment({ ...environment, NEXT_PUBLIC_SUPABASE_ANON_KEY: key }), (error) => {
      assert.match(error.message, /publishable or anon key/);
      assert.ok(!error.message.includes(key));
      return true;
    });
  }
});

test('rejects missing and placeholder configuration', () => {
  for (const values of [{}, { ...environment, NEXT_PUBLIC_SUPABASE_URL: 'https://your-project.supabase.co' }, { ...environment, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'your-key' }]) {
    assert.throws(() => validatePublicEnvironment(values), /Configure/);
  }
});

test('rejects unsafe Supabase URL schemes and embedded credentials', () => {
  for (const url of ['javascript:alert(1)', 'https://user:password@example.com']) {
    assert.throws(() => validatePublicEnvironment({ ...environment, NEXT_PUBLIC_SUPABASE_URL: url }), /HTTP\(S\) URL without credentials/);
  }
});

test('permits an unpublished player app or a public HTTPS destination', () => {
  for (const url of ['', '  ', 'https://play.example.com/']) {
    assert.doesNotThrow(() => validatePublicEnvironment({ ...environment, NEXT_PUBLIC_PLAYER_APP_URL: url }));
  }
});

test('rejects localhost, insecure, executable, and credential-bearing player links', () => {
  for (const url of ['http://localhost:8081', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'http://play.example.com', 'javascript:alert(1)', 'https://user:password@play.example.com']) {
    assert.throws(() => validatePublicEnvironment({ ...environment, NEXT_PUBLIC_PLAYER_APP_URL: url }), /public HTTPS player app URL/);
  }
});
