import { Router, Request, Response, NextFunction } from 'express';
import { attachSSE as attachNodeSSE } from 'restale-kit/node';
import {
  AppSignalSchema,
  CreateTodoSchema,
  createTodoApi,
  UpdateTodoSchema,
  UserIdSchema,
} from '@restale-kit-example/shared';
import { group } from '@src/common/invalidator';

const apiRouter = Router();

const todos = createTodoApi((userId) => {
  group.broadcast(
    { key: ['todos', { userId }], action: 'invalidate' },
    (meta) => meta.userId === userId
  );
});

// GET /sse - Real-time SSE endpoint
apiRouter.get('/sse', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = UserIdSchema.parse(req.query.userId);

    // Attach SSE headers and get ReStale channel
    const channel = attachNodeSSE(req, res, { signalSchema: AppSignalSchema });

    // Register channel into ReStale connection group with userId metadata
    group.register(channel, { userId });

    console.log(`[SSE] Connected user: ${userId}`);

    // Cleanup on disconnect
    req.on('close', () => {
      console.log(`[SSE] Disconnected user: ${userId}`);
      group.deregister(channel);
    });
  } catch (error) {
    next(error);
  }
});

// GET /todos - Fetch user todos
apiRouter.get('/todos', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = UserIdSchema.parse(req.query.userId);
    res.json(todos.getTodos(userId));
  } catch (error) {
    next(error);
  }
});

// POST /todos - Create a todo
apiRouter.post('/todos', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = UserIdSchema.parse(req.query.userId);
    const { text } = CreateTodoSchema.parse(req.body);
    const todo = todos.create(userId, text);

    res.status(201).json(todo);
  } catch (error) {
    next(error);
  }
});

// PATCH /todos/:id - Update a todo
apiRouter.patch('/todos/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = UserIdSchema.parse(req.query.userId);
    const id = req.params.id as string;
    const update = UpdateTodoSchema.parse(req.body);

    const todo = todos.update(userId, id, update);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    res.json(todo);
  } catch (error) {
    next(error);
  }
});

// DELETE /todos/:id - Delete a todo
apiRouter.delete('/todos/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = UserIdSchema.parse(req.query.userId);
    const id = req.params.id as string;

    const deleted = todos.delete(userId, id);
    if (!deleted) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default apiRouter;
