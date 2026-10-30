import { LIVE_API, apiBase } from './api-base';

describe('apiBase', () => {
  test('an installed app talks to the live server, even when nothing is configured', () => {
    expect(apiBase(undefined, false)).toBe(LIVE_API);
    expect(apiBase('', false)).toBe(LIVE_API);
  });

  test('local development talks to the local server', () => {
    expect(apiBase(undefined, true)).toBe('http://localhost:8000');
  });

  test('an override wins and loses its trailing slash', () => {
    expect(apiBase('https://example.test/', false)).toBe('https://example.test');
  });
});
