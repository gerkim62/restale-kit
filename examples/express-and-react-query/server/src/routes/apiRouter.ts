import { Router, Request, Response, NextFunction } from 'express';
import { attachSSE as attachNodeSSE } from 'restale-kit/node';
import { AppSignalSchema } from 'restale-kit-example-shared';
import { group } from '@src/common/invalidator';
import { TodoService } from '@src/services/TodoService';
import { z } from 'zod';

const apiRouter = Router();

// Zod schemas for request validation
const UserIdQuerySchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

const CreateTodoBodySchema = z.object({
  text: z.string().min(1, 'Todo text is required'),
});

const UpdateTodoBodySchema = z.object({
  text: z.string().optional(),
  completed: z.boolean().optional(),
});

// GET /sse - Real-time SSE endpoint
apiRouter.get('/sse', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = UserIdQuerySchema.parse(req.query);

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
    const { userId } = UserIdQuerySchema.parse(req.query);
    const todos = TodoService.getTodos(userId);
    res.json(todos);
  } catch (error) {
    next(error);
  }
});

// POST /todos - Create a todo
apiRouter.post('/todos', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = UserIdQuerySchema.parse(req.query);
    const { text } = CreateTodoBodySchema.parse(req.body);

    const todo = TodoService.addTodo(userId, text);

    // Broadcast invalidation signal to all other tabs of the same user
    group.broadcast(
      { key: ['todos', { userId }], action: 'invalidate' },
      (meta) => meta.userId === userId
    );

    res.status(201).json(todo);
  } catch (error) {
    next(error);
  }
});

// PATCH /todos/:id - Update a todo
apiRouter.patch('/todos/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = UserIdQuerySchema.parse(req.query);
    const id = req.params.id as string;
    const { text, completed } = UpdateTodoBodySchema.parse(req.body);

    const todo = TodoService.updateTodo(userId, id, text, completed);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    // Broadcast invalidation signal
    group.broadcast(
      { key: ['todos', { userId }], action: 'invalidate' },
      (meta) => meta.userId === userId
    );

    res.json(todo);
  } catch (error) {
    next(error);
  }
});

// DELETE /todos/:id - Delete a todo
apiRouter.delete('/todos/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = UserIdQuerySchema.parse(req.query);
    const id = req.params.id as string;

    const deleted = TodoService.deleteTodo(userId, id);
    if (!deleted) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    // Broadcast invalidation signal
    group.broadcast(
      { key: ['todos', { userId }], action: 'invalidate' },
      (meta) => meta.userId === userId
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default apiRouter;
