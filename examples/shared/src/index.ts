import { z } from 'zod';

export const TodoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  userId: z.string(),
});

export type Todo = z.infer<typeof TodoSchema>;

export type AppSignal = {
  key: ['todos'] | ['todos', { userId: string }];
  exact?: boolean;
  action?: 'invalidate' | 'refetch' | 'remove';
};

export type ClientMeta = { userId: string };

export const DemoUsers = [
  { id: 'ada', name: 'Ada Lovelace' },
  { id: 'grace', name: 'Grace Hopper' },
  { id: 'linus', name: 'Linus Torvalds' },
] as const;

export type DemoUser = (typeof DemoUsers)[number];
export const UserIdSchema = z.enum(['ada', 'grace', 'linus']);
export const CreateTodoSchema = z.object({
  text: z.string().min(1, 'Todo text is required'),
});
export const UpdateTodoSchema = z.object({
  text: z.string().optional(),
  completed: z.boolean().optional(),
});

export function createTodoApi(onTodosChanged: (userId: string) => void) {
  const userTodos = new Map<string, Todo[]>();

  function getTodos(userId: string): Todo[] {
    let todos = userTodos.get(userId);
    if (!todos) {
      todos = [];
      userTodos.set(userId, todos);
    }
    return todos;
  }

  return {
    getTodos,
    create(userId: string, text: string): Todo {
      const todo: Todo = { id: crypto.randomUUID(), text, completed: false, userId };
      getTodos(userId).push(todo);
      onTodosChanged(userId);
      return todo;
    },
    update(userId: string, id: string, update: z.infer<typeof UpdateTodoSchema>): Todo | null {
      const todo = getTodos(userId).find((item) => item.id === id);
      if (!todo) return null;
      if (update.text !== undefined) todo.text = update.text;
      if (update.completed !== undefined) todo.completed = update.completed;
      onTodosChanged(userId);
      return todo;
    },
    delete(userId: string, id: string): boolean {
      const todos = getTodos(userId);
      const index = todos.findIndex((item) => item.id === id);
      if (index === -1) return false;
      todos.splice(index, 1);
      onTodosChanged(userId);
      return true;
    },
  };
}
