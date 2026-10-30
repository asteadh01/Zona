import { appVersionLabel, installLatestUpdate } from './app-updates';

const mockUpdates = {
  isEnabled: true,
  isEmbeddedLaunch: true,
  createdAt: null as Date | null,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
};

jest.mock('expo-updates', () => ({
  get isEnabled() { return mockUpdates.isEnabled; },
  get isEmbeddedLaunch() { return mockUpdates.isEmbeddedLaunch; },
  get createdAt() { return mockUpdates.createdAt; },
  checkForUpdateAsync: () => mockUpdates.checkForUpdateAsync(),
  fetchUpdateAsync: () => mockUpdates.fetchUpdateAsync(),
  reloadAsync: () => mockUpdates.reloadAsync(),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockUpdates, { isEnabled: true, isEmbeddedLaunch: true, createdAt: null });
});

describe('installLatestUpdate', () => {
  test('outside the installed app it checks nothing', async () => {
    mockUpdates.isEnabled = false;
    await expect(installLatestUpdate()).resolves.toBe('Updates only work in the installed app.');
    expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  test('with nothing new it does not restart', async () => {
    mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: false });
    await expect(installLatestUpdate()).resolves.toBe('Zona is up to date.');
    expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
  });

  test('a new update is downloaded before the app restarts', async () => {
    const order: string[] = [];
    mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
    mockUpdates.fetchUpdateAsync.mockImplementation(async () => order.push('fetch'));
    mockUpdates.reloadAsync.mockImplementation(async () => order.push('reload'));
    await installLatestUpdate();
    expect(order).toEqual(['fetch', 'reload']);
  });

  test('a failed check reaches the caller, so the screen can say so', async () => {
    mockUpdates.checkForUpdateAsync.mockRejectedValue(new Error('offline'));
    await expect(installLatestUpdate()).rejects.toThrow('offline');
  });
});

describe('appVersionLabel', () => {
  test('names the installed build until an update has been applied', () => {
    expect(appVersionLabel()).toBe('App 1.0.0, as installed.');
  });

  test('says when the running update was published', () => {
    Object.assign(mockUpdates, { isEmbeddedLaunch: false, createdAt: new Date(2026, 9, 30, 15, 2) });
    expect(appVersionLabel()).toMatch(/^App 1\.0\.0, updated .*30/);
  });
});
