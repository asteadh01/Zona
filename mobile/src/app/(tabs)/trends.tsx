import { useState } from 'react';
import { View } from 'react-native';

import { Header, LoadState, Screen, Seg } from '@/components/ui';
import { TrendsView } from '@/features/trends/trends-view';
import { useLoad } from '@/hooks/use-load';
import { api } from '@/services/api';

const RANGES = [{ value: 4, label: '4W' }, { value: 12, label: '12W' }] as const;

export default function TrendsScreen() {
  const [weeks, setWeeks] = useState<4 | 12>(12);
  const trends = useLoad(() => api.trends(weeks), weeks);
  return (
    <Screen refreshing={trends.refreshing} onRefresh={() => void trends.refresh()}>
      <Header title="Trends" small={`Last ${weeks} weeks`} right={<View style={{ width: 112, paddingBottom: 4 }}><Seg label="Range" options={RANGES} value={weeks} onChange={setWeeks} /></View>} />
      {trends.data && trends.data.weeks.length === weeks
        ? <TrendsView trends={trends.data} />
        : <LoadState error={trends.error} onRetry={() => void trends.reload()} />}
    </Screen>
  );
}
