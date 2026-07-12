import { Todo } from '@restale-kit-example/shared';

// In-memory data store for simulated users
const userTodos = new Map<string, Todo[]>();

export const TodoService = {
  getTodos(userId: string): Todo[] {
    if (!userTodos.has(userId)) {
      userTodos.set(userId, []);
    }
    return userTodos.get(userId) || [];
  },

  addTodo(userId: string, text: string): Todo {
    const todos = this.getTodos(userId);
    const newTodo: Todo = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
      text,
      completed: false,
      userId,
    };
    todos.push(newTodo);
    return newTodo;
  },

  updateTodo(userId: string, id: string, text?: string, completed?: boolean): Todo | null {
    const todos = this.getTodos(userId);
    const todo = todos.find((t) => t.id === id);
    if (!todo) {
      return null;
    }
    if (text !== undefined) {
      todo.text = text;
    }
    if (completed !== undefined) {
      todo.completed = completed;
    }
    return todo;
  },

  deleteTodo(userId: string, id: string): boolean {
    const todos = this.getTodos(userId);
    const index = todos.findIndex((t) => t.id === id);
    if (index === -1) {
      return false;
    }
    todos.splice(index, 1);
    return true;
  },
};
