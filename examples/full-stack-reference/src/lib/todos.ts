export interface Todo {
  id: string
  text: string
  completed: boolean
  userId: string
}

declare global {
  // eslint-disable-next-line no-var
  var __todos_store__: Map<string, Todo[]> | undefined
}

const store = globalThis.__todos_store__ ?? (globalThis.__todos_store__ = new Map<string, Todo[]>())

export function getTodos(userId: string): Todo[] {
  return store.get(userId) ?? []
}

export function createTodo(userId: string, text: string): Todo {
  const todos = store.get(userId) ?? []
  const newTodo: Todo = {
    id: crypto.randomUUID(),
    text,
    completed: false,
    userId,
  }
  todos.push(newTodo)
  store.set(userId, todos)
  return newTodo
}

export function updateTodo(
  userId: string,
  id: string,
  updates: Partial<Pick<Todo, 'text' | 'completed'>>,
): Todo | null {
  const todos = store.get(userId) ?? []
  const todo = todos.find((t) => t.id === id)
  if (!todo) return null
  if (updates.text !== undefined) todo.text = updates.text
  if (updates.completed !== undefined) todo.completed = updates.completed
  return todo
}

export function deleteTodo(userId: string, id: string): boolean {
  const todos = store.get(userId) ?? []
  const index = todos.findIndex((t) => t.id === id)
  if (index === -1) return false
  todos.splice(index, 1)
  return true
}
