import { Header, LoadState, Screen } from '@/components/ui';
import { TrainView } from '@/features/train/train-view';
import { useLoad } from '@/hooks/use-load';
import { api } from '@/services/api';

const loadTrain = async () => {
  const [plan, me, home] = await Promise.all([api.plan(), api.me(), api.home()]);
  return { plan, me, sync: home.sync };
};

export default function TrainScreen() {
  const train = useLoad(loadTrain);
  return (
    <Screen refreshing={train.refreshing} onRefresh={() => void train.refresh()}>
      <Header title="Train" small="Your week plan" />
      {train.data
        ? <TrainView plan={train.data.plan} me={train.data.me} sync={train.data.sync} onChanged={() => void train.reload()} />
        : <LoadState error={train.error} onRetry={() => void train.reload()} />}
    </Screen>
  );
}
