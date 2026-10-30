import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

type Loaded<T> = {
  data: T | null;
  error: string | null;
  refreshing: boolean;
  /** Reload and show the pull-to-refresh spinner. */
  refresh: () => Promise<void>;
  /** Reload quietly, for example after saving something. */
  reload: () => Promise<void>;
};

/** Fetches when the screen comes into focus and whenever the key changes; old data stays on screen while it reloads. */
export function useLoad<T>(fetcher: () => Promise<T>, key: unknown = null): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    const id = ++latest.current;
    try {
      const value = await fetcherRef.current();
      if (id === latest.current) {
        setData(value);
        setError(null);
      }
    } catch (e) {
      if (id === latest.current) setError(e instanceof Error ? e.message : "Zona couldn't reach its server.");
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload, key]), // eslint-disable-line react-hooks/exhaustive-deps -- key is what triggers the refetch
  );

  return { data, error, refreshing, refresh, reload };
}
