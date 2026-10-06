import type Anthropic from "@anthropic-ai/sdk";

/**
 * The client, counting every answer it gets (DECISIONS #132): `count`
 * receives the answer's usage once the answer is complete. A request
 * that fails isn't counted. Both ways the CRM asks -- a whole answer
 * (create) and a streamed one (stream) -- are covered; counting never
 * changes what the caller gets back.
 */
export function metered(
  client: Anthropic,
  count: (usage: Anthropic.Usage | undefined) => Promise<unknown>
): Anthropic {
  const create = client.messages.create.bind(client.messages) as (
    ...args: unknown[]
  ) => Promise<{ usage?: Anthropic.Usage }>;
  const stream = client.messages.stream.bind(client.messages);

  client.messages.create = ((...args: unknown[]) => {
    const call = create(...args);
    // stream() below asks through create({ stream: true }) and calls
    // .withResponse() on what comes back, so that call must get the
    // SDK's own promise untouched -- a .then() here broke every streamed
    // answer. stream() counts it from the final message instead.
    if ((args[0] as { stream?: boolean } | undefined)?.stream) return call;
    return call.then(async (message) => {
      await count(message?.usage);
      return message;
    });
  }) as unknown as typeof client.messages.create;

  client.messages.stream = ((...args: Parameters<typeof stream>) => {
    const live = stream(...args);
    live
      .finalMessage()
      .then((message) => count(message.usage))
      .catch(() => {});
    return live;
  }) as typeof client.messages.stream;

  return client;
}
