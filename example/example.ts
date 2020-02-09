import Koa from 'koa';
import { createSchema as S } from 'ts-json-validator';
import Jareth, { Handle } from '@tboyt/jareth';
import { Router, CustomContextProvider } from '../src';

import { getUserFromAuthToken, getUserById, User } from './models';

interface AppContext {
  handle: Handle;
  currentUser: User | null;
}

function buildRouterContext(db: Jareth): CustomContextProvider<AppContext> {
  return (req, res, run) => {
    return db.withHandle(async (handle) => {
      const authToken = req.headers['x-auth-token'];

      const currentUser =
        typeof authToken === 'string'
          ? await getUserFromAuthToken(handle, authToken)
          : null;

      const context = {
        handle,
        currentUser,
      };
      await run(context);
    });
  };
}

function main() {
  const db = new Jareth('postgres://postgres:@localhost:5433/jambuds');

  const app = new Koa();

  // each router can have its own context. this could make it easy to have e.g.
  // auth vs unauth routers
  const router = new Router(buildRouterContext(db));

  router.get(
    '/users/:id',
    {
      params: S({
        type: 'object',
        properties: {
          id: S({ type: 'integer' }),
        },
        required: ['id'],
      }),
      query: S({
        type: 'object',
        properties: {
          includeEmail: S({ type: 'boolean' }),
        },
      }),
      returns: S({
        type: 'object',
        properties: {
          name: S({ type: 'string' }),
          email: S({ type: 'string' }),
        },
        required: ['name'],
      }),
    },
    async ({ params, query, handle }) => {
      const user = await getUserById(handle, params.id);
      return {
        name: user.name,
        email: query.includeEmail ? user.email : undefined,
      };
    }
  );

  router.get(
    '/me',
    {
      returns: S({
        type: 'object',
        properties: {
          name: S({ type: 'string' }),
          id: S({ type: 'number' }),
          email: S({ type: 'string' }),
        },
        required: ['name', 'id', 'email'],
      }),
    },
    async ({ currentUser }) => {
      if (!currentUser) {
        // TODO:
        // throw koaCtx.throw(401, 'unauthorized');
        throw new Error('unauthorized');
      }

      const out = {
        name: currentUser.name,
        id: currentUser.id,
        email: currentUser.email,
      };

      return out;
    }
  );

  app.use(router.routes());

  app.listen(4000);
}

main();
