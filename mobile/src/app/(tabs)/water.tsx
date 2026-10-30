import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Banner, Header, LoadState, Screen } from '@/components/ui';
import { WaterView } from '@/features/water/water-view';
import { useLoad } from '@/hooks/use-load';
import { api } from '@/services/api';
import { fmtDay } from '@/utils/format';

const NUDGE_KEY = /^workout:\d{1,20}$/;

export default function WaterScreen() {
  const { nudge: nudgeParam } = useLocalSearchParams<{ nudge?: string }>();
  const nudgeKey = typeof nudgeParam === 'string' && NUDGE_KEY.test(nudgeParam) ? nudgeParam : null;
  const [saveError, setSaveError] = useState<string | null>(null);
  const water = useLoad(async () => {
    const [home, me, opened] = await Promise.all([
      api.home(),
      api.me(),
      nudgeKey ? api.nudge(nudgeKey).catch(() => null) : Promise.resolve(null), // an old link just shows the normal screen
    ]);
    return { home, me, nudge: opened ?? home.water.latest_nudge };
  }, nudgeKey);
  const data = water.data;
  return (
    <Screen refreshing={water.refreshing} onRefresh={() => void water.refresh()}>
      <Header title="Water" small={data ? fmtDay(data.home.date) : ''} />
      {saveError ? <Banner title="That didn't save">{saveError}</Banner> : null}
      {data ? (
        <WaterView water={data.home.water} settings={data.home.settings} nowH={data.home.now_h} nudge={data.nudge} fake={data.me.fake}
          onChanged={() => { setSaveError(null); void water.reload(); }} onError={setSaveError} />
      ) : <LoadState error={water.error} onRetry={() => void water.reload()} />}
    </Screen>
  );
}
