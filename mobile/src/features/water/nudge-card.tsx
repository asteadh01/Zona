import { useState } from 'react';
import { Text } from 'react-native';

import { Btn, BtnRow, Card, Done, Lead, useStyles } from '@/components/ui';
import { api } from '@/services/api';
import type { Nudge, Water } from '@/types/api';
import { dur, hhmm, litres } from '@/utils/format';

type Props = { nudge: Nudge | null; logs: Water['logs']; onLogged: () => void };

/** The card after a workout syncs: what the notification said, and buttons to log the water. */
export function NudgeCard({ nudge, logs, onLogged }: Props) {
  const s = useStyles();
  const [loggedKey, setLoggedKey] = useState<string | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!nudge || nudge.key === dismissedKey) return null;

  const { payload: p } = nudge;
  const ml = p.ml ?? 0;
  const drink = ml >= 1000 ? litres(ml) : `${ml} ml`;
  const title = p.title ?? `${(p.names ?? []).join(' and ')} · ${dur(p.minutes ?? 0)}`;
  const log = async (amount: number) => {
    try {
      await api.logWater(Math.min(2000, amount), 'nudge');
      setLoggedKey(nudge.key);
      setError(null);
      onLogged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.");
    }
  };

  if (nudge.status === 'skipped' && (nudge.reason === 'short' || nudge.reason === 'off')) {
    return (
      <Card title={title} sub="goal updated" wash>
        <Text style={s.headerTitle}>{`+${drink}`}</Text>
        <Lead>{nudge.reason === 'short' ? 'Sessions under 20 minutes raise the goal without a nudge.' : 'Nudges are off, so Zona only raised the goal.'}</Lead>
      </Card>
    );
  }
  const created = new Date(nudge.created);
  const at = created.getHours() + created.getMinutes() / 60 + created.getSeconds() / 3600;
  // Water logged from the notification's own button, or before a reload, shouldn't be offered again.
  const isLogged = loggedKey === nudge.key || logs.some((log) => log.source === 'nudge' && log.h >= at);
  const lead = nudge.reason === 'quiet'
    ? 'It was after your active hours, so nothing buzzed. Have some before bed.'
    : `Spread it ${ml >= 1000 ? 'over the next two hours' : 'over the next hour'}.${(p.minutes ?? 0) >= 120 ? ' After a session this long, add some salt or a sports drink.' : ''}`;
  return (
    <Card title={title} sub={nudge.status === 'sent' ? `nudged ${hhmm(at)}` : 'no buzz'} wash>
      <Text style={[s.headerTitle, { fontSize: 27 }]}>{`Drink about ${drink}`}</Text>
      <Lead>{lead}</Lead>
      {isLogged ? <Done>Logged. It counts toward today's water.</Done> : (
        <>
          <Btn label={`Log ${drink}`} onPress={() => void log(ml)} />
          <BtnRow>
            <Btn label="+250 ml" kind="ghost" onPress={() => void log(250)} />
            <Btn label="Not now" kind="ghost" onPress={() => setDismissedKey(nudge.key)} />
          </BtnRow>
        </>
      )}
      {error ? <Lead>{error}</Lead> : null}
    </Card>
  );
}
