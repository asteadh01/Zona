import { readNotification } from './notification-payload';

const DEFAULT = 'expo.modules.notifications.actions.DEFAULT';

describe('readNotification', () => {
  test('a tap opens the screen and the nudge it names', () => {
    expect(readNotification({ url: '/water?nudge=workout:123', ml: 400 }, DEFAULT)).toEqual({ route: '/water', nudgeKey: 'workout:123' });
  });

  test('the Log it button logs the amount in the payload', () => {
    expect(readNotification({ url: '/water?nudge=workout:1', ml: 400 }, 'log')).toEqual({ route: '/water', nudgeKey: 'workout:1', logMl: 400 });
  });

  test('the fixed buttons log their own amount, whatever the payload says', () => {
    expect(readNotification({ url: '/water', ml: 400 }, 'add250').logMl).toBe(250);
    expect(readNotification({ url: '/water' }, 'add500').logMl).toBe(500);
  });

  test('anything unexpected falls back to Home and logs nothing', () => {
    expect(readNotification({ url: 'https://evil.example' }, DEFAULT)).toEqual({ route: '/' });
    expect(readNotification({ url: '/sign-in' }, DEFAULT)).toEqual({ route: '/' });
    expect(readNotification(null, DEFAULT)).toEqual({ route: '/' });
    expect(readNotification({ url: 42 }, DEFAULT)).toEqual({ route: '/' });
  });

  test('bad amounts and nudge keys are dropped', () => {
    expect(readNotification({ url: '/water', ml: 99999 }, 'log').logMl).toBeUndefined();
    expect(readNotification({ url: '/water', ml: '400' }, 'log').logMl).toBeUndefined();
    expect(readNotification({ url: '/water?nudge=../../etc' }, DEFAULT).nudgeKey).toBeUndefined();
    expect(readNotification({ url: '/water' }, 'constructor').logMl).toBeUndefined();
  });
});
