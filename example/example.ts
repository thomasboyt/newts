import Koa from 'koa';
import { RouterContextProvider, Router } from '../src';

import * as t from 'io-ts';
import { IntFromString } from 'io-ts-types/lib/IntFromString';
import Jareth, { Handle } from '@tboyt/jareth';
import { getUserFromAuthToken, getUserById, User } from './models';

interface AppContext {
  handle: Handle;
  currentUser: User | null;
}

function buildRouterContext(db: Jareth): RouterContextProvider<AppContext> {
  return (koaCtx, run) => {
    return db.withHandle(async (handle) => {
      const authToken = koaCtx.get('x-auth-token');

      const currentUser = await getUserFromAuthToken(handle, authToken);

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
      query: t.type({
        param: t.union([t.string, t.undefined]),
      }),
      params: t.type({
        id: IntFromString,
      }),
      returns: t.type({
        name: t.string,
        queryParam: t.union([t.string, t.undefined]),
      }),
    },
    async (routeCtx) => {
      const user = await getUserById(routeCtx.handle, routeCtx.params.id);
      return {
        name: user.name,
        queryParam: routeCtx.query.param,
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
    async (routeCtx, koaCtx) => {
      if (!routeCtx.currentUser) {
        throw koaCtx.throw(401, 'unauthorized');
      }

      return {
        name: routeCtx.currentUser.name,
        id: routeCtx.currentUser.id,
      };
    }
  );

  app.use(router.routes());

  app.listen(4000);
}

main();
