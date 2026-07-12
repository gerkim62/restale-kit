import React, { useState, useEffect } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createRoute,
  createRootRoute,
  createRouter,
  RouterProvider, 
  useNavigate,
  Outlet,
} from '@tanstack/react-router';
import { useReStale } from 'restale-kit/react';
import { tanstackAdapter } from 'restale-kit/tanstack-query';
import { AppSignalSchema, type AppSignal, type Todo } from '@restale-kit-example/shared';

type Server = 'express' | 'hono' | 'fastify' | 'node';

const servers: ReadonlyArray<{ value: Server; label: string }> = [
  { value: 'express', label: 'Express · Node adapter' },
  { value: 'hono', label: 'Hono · Fetch adapter' },
  { value: 'fastify', label: 'Fastify · Node adapter' },
  { value: 'node', label: 'Native Node · Node adapter' },
];

function isServer(value: string): value is Server {
  return servers.some((server) => server.value === value);
}

// Create TanStack Query Client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: Infinity, // Rely on server SSE to invalidate/refresh cache
    },
  },
});

/******************************************************************************
                             Login Page Component
******************************************************************************/

function Login() {
  const [userIdInput, setUserIdInput] = useState('');
  const navigate = useNavigate();

  // If already logged in, redirect to dashboard
  useEffect(() => {
    const savedUser = sessionStorage.getItem('todo_user_id');
    if (savedUser) {
      navigate({ to: '/' });
    }
  }, [navigate]);

  const handleLogin = (id: string) => {
    if (!id.trim()) return;
    sessionStorage.setItem('todo_user_id', id.trim());
    navigate({ to: '/' });
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      flexGrow: 1,
      padding: '40px 20px',
    }}>
      <div className="glow-card" style={{
        maxWidth: '440px',
        width: '100%',
        padding: '40px 32px',
        textAlign: 'center',
      }}>
        <h1 style={{ fontSize: '32px', margin: '0 0 12px 0', background: 'linear-gradient(135deg, #c084fc 0%, #8b5cf6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Reactive Todo Space
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '15px', marginBottom: '32px', lineHeight: '1.5' }}>
          Sync your tasks in real-time across tabs and windows instantaneously using the ReStale SSE protocol.
        </p>

        <form onSubmit={(e) => { e.preventDefault(); handleLogin(userIdInput); }} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <input
            type="text"
            className="input-text"
            placeholder="Enter simulated User ID (e.g. user-1)"
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            required
            autoFocus
          />
          <button type="submit" className="btn-primary" style={{ width: '100%' }}>
            Enter Space
          </button>
        </form>

        <div style={{ margin: '32px 0 16px 0', borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'block', marginBottom: '16px' }}>
            OR SELECT A TEST PROFILE
          </span>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button className="btn-secondary" onClick={() => handleLogin('user-alice')}>
              👤 Alice (user-alice)
            </button>
            <button className="btn-secondary" onClick={() => handleLogin('user-bob')}>
              👤 Bob (user-bob)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/******************************************************************************
                           Dashboard Page Component
******************************************************************************/

function Dashboard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [newTodoText, setNewTodoText] = useState('');
  const [server, setServer] = useState<Server>('express');
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    const savedUser = sessionStorage.getItem('todo_user_id');
    if (!savedUser) {
      navigate({ to: '/login' });
    } else {
      setUserId(savedUser);
    }
  }, [navigate]);

  const apiBase = `/api/${server}`;
  const todoQueryKey = ['todos', { userId, server }];

  // Connect to the selected server implementation's SSE stream.
  const { connection, reconnect } = useReStale<AppSignal>(
    userId ? `${apiBase}/sse?userId=${userId}` : '',
    {
      disabled: !userId,
      signalSchema: AppSignalSchema,
      onInvalidate: tanstackAdapter(qc),
      autoReconnect: true,
      reconnect: {
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        jitter: true,
      },
    }
  );
 
  // Fetch todos query
  const { data: todos = [], isLoading, error } = useQuery<Todo[]>({
    queryKey: todoQueryKey,
    queryFn: async () => {
      if (!userId) return [];
      const res = await fetch(`${apiBase}/todos?userId=${userId}`);
      if (!res.ok) throw new Error('Failed to fetch todos');
      return res.json();
    },
    enabled: !!userId,
  });

  // Create todo mutation
  const createTodoMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch(`${apiBase}/todos?userId=${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      return res.json();
    },
    onSuccess: (newTodo) => {
      // Local optimistic update or manual invalidation for current tab
      qc.setQueryData<Todo[]>(todoQueryKey, (prev = []) => [...prev, newTodo]);
    },
  });

  // Toggle todo mutation
  const toggleTodoMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const res = await fetch(`${apiBase}/todos/${id}?userId=${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      return res.json();
    },
    onSuccess: (updatedTodo) => {
      qc.setQueryData<Todo[]>(todoQueryKey, (prev = []) =>
        prev.map((t) => (t.id === updatedTodo.id ? updatedTodo : t))
      );
    },
  });

  // Delete todo mutation
  const deleteTodoMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`${apiBase}/todos/${id}?userId=${userId}`, {
        method: 'DELETE',
      });
      return id;
    },
    onSuccess: (deletedId) => {
      qc.setQueryData<Todo[]>(todoQueryKey, (prev = []) =>
        prev.filter((t) => t.id !== deletedId)
      );
    },
  });

  if (!userId) return null;

  const handleLogout = () => {
    sessionStorage.removeItem('todo_user_id');
    navigate({ to: '/login' });
  };

  const handleAddTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodoText.trim()) return;
    createTodoMutation.mutate(newTodoText);
    setNewTodoText('');
  };

  const openSyncWindow = () => {
    window.open(window.location.href, '_blank');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: '24px 20px', maxWidth: '800px', width: '100%', margin: '0 auto' }}>
      
      {/* Header Panel */}
      <header className="glow-card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', marginBottom: '24px', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '20px', fontWeight: 'bold' }}>✍️ Taskroom</span>
          <span style={{ color: 'var(--text-muted)' }}>|</span>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            Logged as: <strong style={{ color: 'var(--accent)' }}>{userId}</strong>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="status-indicator">
            <span className={`dot ${connection.status}`} />
            <span>SSE: {connection.status.toUpperCase()}</span>
            {connection.status === 'error' && (
              <button 
                onClick={reconnect} 
                style={{ marginLeft: '8px', border: 'none', background: 'var(--accent)', color: 'white', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}
              >
                Reconnect
              </button>
            )}
          </div>
          <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Server{' '}
            <select value={server} onChange={(event) => {
              if (isServer(event.target.value)) setServer(event.target.value);
            }}>
              {servers.map((serverOption) => (
                <option key={serverOption.value} value={serverOption.value}>{serverOption.label}</option>
              ))}
            </select>
          </label>
          <button className="btn-secondary" onClick={handleLogout} style={{ padding: '6px 12px', fontSize: '13px' }}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Todo Input Form */}
      <section className="glow-card" style={{ padding: '24px', marginBottom: '24px' }}>
        <form onSubmit={handleAddTodo} style={{ display: 'flex', gap: '12px' }}>
          <input
            type="text"
            className="input-text"
            placeholder="What needs to be done?"
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            disabled={createTodoMutation.isPending}
          />
          <button type="submit" className="btn-primary" disabled={createTodoMutation.isPending || !newTodoText.trim()}>
            {createTodoMutation.isPending ? 'Adding...' : 'Add Task'}
          </button>
        </form>
      </section>

      {/* Todos Container */}
      <main className="glow-card" style={{ padding: '24px', marginBottom: '24px', minHeight: '200px' }}>
        <h2 style={{ fontSize: '18px', margin: '0 0 16px 0', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Active Todo List</span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Total: {todos.length}
          </span>
        </h2>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>Loading your space...</div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--danger)' }}>Error loading todos!</div>
        ) : todos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎉</div>
            <div>All caught up! Add a new task above.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {todos.map((todo) => (
              <div key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
                <div style={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
                  <input
                    type="checkbox"
                    className="checkbox-custom"
                    checked={todo.completed}
                    onChange={(e) => toggleTodoMutation.mutate({ id: todo.id, completed: e.target.checked })}
                  />
                  <span className="todo-text">{todo.text}</span>
                </div>
                <button
                  className="btn-danger"
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  onClick={() => deleteTodoMutation.mutate(todo.id)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Sync Test Panel */}
      <section className="glow-card" style={{ padding: '24px', textAlign: 'left', borderStyle: 'dashed', borderColor: 'var(--accent-light-border)' }}>
        <h3 style={{ fontSize: '15px', margin: '0 0 8px 0', color: 'var(--accent)', fontWeight: 'bold' }}>
          🔄 Multi-Tab Sync Test Suite
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '16px' }}>
          Open another sync window under the same User ID, perform any action, and witness immediate reactive state updates synchronized across all tabs via ReStale Server-Sent Events.
        </p>
        <button className="btn-primary" onClick={openSyncWindow} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
          👥 Open Sync Test Window
        </button>
      </section>
    </div>
  );
}

/******************************************************************************
                            TanStack Router Setup
******************************************************************************/

const rootRoute = createRootRoute({
  component: () => (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%' }}>
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
      <footer style={{ borderTop: '1px solid var(--border-color)', padding: '20px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>
        Powered by ReStale SSE Invalidator & TanStack Query & TanStack Router
      </footer>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
});

const routeTree = rootRoute.addChildren([indexRoute, loginRoute]);

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

// Declare safety types for TanStack Router
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/******************************************************************************
                             Main App Root wrapper
******************************************************************************/

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
