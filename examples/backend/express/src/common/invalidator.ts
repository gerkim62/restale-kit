import { SSEChannelGroup } from 'restale-kit';
import { AppSignal, ClientMeta, ClientMetaSchema } from '@restale-kit-example/shared';

// Create a connection group managed by restale-kit
export const group = new SSEChannelGroup<AppSignal, ClientMeta>({
  metaSchema: ClientMetaSchema,
});
