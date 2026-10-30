import type { Href } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';

import { api } from '@/services/api';
import { readNotification } from '@/utils/notification-payload';

type Props = { onOpen: (href: Href) => void };

/** Acts on a tapped notification or one of its buttons, including the one that launched the app. Draws nothing. */
export function NotificationResponses({ onOpen }: Props) {
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response) return;
    const id = response.notification.request.identifier + response.actionIdentifier;
    if (handled.current === id) return;
    handled.current = id;
    Notifications.clearLastNotificationResponse(); // otherwise signing out and back in would log the same water again
    const action = readNotification(response.notification.request.content.data, response.actionIdentifier);
    const open = () => onOpen((action.nudgeKey ? `${action.route}?nudge=${action.nudgeKey}` : action.route) as Href);
    if (action.logMl) void api.logWater(action.logMl, 'nudge').catch(() => undefined).finally(open);
    else open();
  }, [response, onOpen]);

  return null;
}
