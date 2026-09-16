import { cleanAuthUrl, readAuthParams } from '../authLinks';

it('reads both native token fragments and browser PKCE codes', () => {
  expect(readAuthParams('peakle://reset-password#access_token=token&type=recovery').get('type')).toBe('recovery');
  expect(readAuthParams('https://beta.example/oauth/callback?code=one-use-code').get('code')).toBe('one-use-code');
});

it('removes credentials and OAuth errors from browser history', () => {
  expect(cleanAuthUrl('https://beta.example/oauth/callback?code=secret&keep=yes#access_token=secret')).toBe('/?keep=yes');
  expect(cleanAuthUrl('https://beta.example/reset-password#error=access_denied&error_description=Expired')).toBe('/');
});

it('preserves normal player links and route parameters', () => {
  expect(cleanAuthUrl('https://beta.example/compete?openTab=Compete#divisions')).toBe('/compete?openTab=Compete#divisions');
});
