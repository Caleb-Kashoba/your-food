let realtimeInstanceSequence = 0;

export function createRealtimeInstanceId() {
  realtimeInstanceSequence += 1;

  return [
    Date.now().toString(36),
    realtimeInstanceSequence.toString(36),
    Math.random().toString(36).slice(2, 10)
  ].join('-');
}

export function createTableRealtimeTopic(
  table: string,
  organizationId: string,
  instanceId: string,
  subscriptionGeneration: number
) {
  return [
    'table-realtime',
    encodeURIComponent(table),
    encodeURIComponent(organizationId),
    instanceId,
    subscriptionGeneration.toString(36)
  ].join(':');
}

export function registerBeforeSubscribe<TChannel>(
  channel: TChannel,
  register: (channel: TChannel) => void,
  subscribe: (channel: TChannel) => void
) {
  register(channel);
  subscribe(channel);

  return channel;
}
