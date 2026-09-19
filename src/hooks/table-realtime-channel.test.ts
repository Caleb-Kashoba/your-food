import { describe, expect, it } from 'vitest';

import {
  createRealtimeInstanceId,
  createTableRealtimeTopic,
  registerBeforeSubscribe
} from '@/hooks/table-realtime-channel';

class RealtimeChannelMock {
  readonly calls: string[] = [];
  private subscribed = false;

  onPostgresChanges() {
    if (this.subscribed) throw new Error('listener added after subscribe');
    this.calls.push('on:postgres_changes');
  }

  subscribe() {
    this.calls.push('subscribe');
    this.subscribed = true;
  }
}

describe('table realtime channels', () => {
  it('registers postgres_changes before subscribing', () => {
    const channel = new RealtimeChannelMock();

    expect(() =>
      registerBeforeSubscribe(
        channel,
        (currentChannel) => currentChannel.onPostgresChanges(),
        (currentChannel) => currentChannel.subscribe()
      )
    ).not.toThrow();
    expect(channel.calls).toEqual(['on:postgres_changes', 'subscribe']);
  });

  it('gives simultaneous consumers of the same table and organization different topics', () => {
    const firstTopic = createTableRealtimeTopic('deliveries', 'organization-1', createRealtimeInstanceId(), 1);
    const secondTopic = createTableRealtimeTopic('deliveries', 'organization-1', createRealtimeInstanceId(), 1);

    expect(firstTopic).not.toBe(secondTopic);
  });

  it('gives a Strict Mode effect remount a fresh topic while cleanup is pending', () => {
    const instanceId = createRealtimeInstanceId();
    const firstTopic = createTableRealtimeTopic('payments', 'organization-1', instanceId, 1);
    const remountTopic = createTableRealtimeTopic('payments', 'organization-1', instanceId, 2);

    expect(firstTopic).not.toBe(remountTopic);
  });
});
