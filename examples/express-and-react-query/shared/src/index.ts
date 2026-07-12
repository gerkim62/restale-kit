import { z } from 'zod';

export const TodoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  userId: z.string(),
});

export type Todo = z.infer<typeof TodoSchema>;

export const AppSignalSchema = z.object({
  key: z.union([
    z.tuple([z.literal('todos')]),
    z.tuple([z.literal('todos'), z.object({ userId: z.string() })]),
  ]),
  exact: z.boolean().optional(),
  action: z.enum(['invalidate', 'refetch', 'remove']).optional(),
});

export type AppSignal = z.infer<typeof AppSignalSchema>;

export const ClientMetaSchema = z.object({
  userId: z.string(),
});

export type ClientMeta = z.infer<typeof ClientMetaSchema>;
