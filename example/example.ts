import Koa from 'koa';
import * as t from 'io-ts';
import { IntFromString } from 'io-ts-types/lib/IntFromString';
import Jareth, { Handle } from '@tboyt/jareth';
import { Router, param, CustomContextProvider } from '../src';

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
      params: {
        id: param.required(IntFromString),
      },
      query: {
        param: param.optional(t.string),
      },
      returns: t.type({
        name: t.string,
        queryParam: t.union([t.string, t.undefined]),
      }),
    },
    async ({ params, query, handle }) => {
      const user = await getUserById(handle, params.id);
      return {
        name: user.name,
        queryParam: query.param,
      };
    }
  );

  router.get(
    '/me',
    {
      returns: t.type({
        name: t.string,
        id: t.number,
      }),
    },
    async ({ currentUser }) => {
      if (!currentUser) {
        // TODO:
        // throw koaCtx.throw(401, 'unauthorized');
        throw new Error('unauthorized');
      }

      return {
        name: currentUser.name,
        id: currentUser.id,
      };
    }
  );

  app.use(router.routes());

  app.listen(4000);
}

main();
