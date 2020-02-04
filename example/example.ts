import { Newts, ContextProvider, HttpError } from '../src';

import * as t from 'io-ts';
import { IntFromString } from 'io-ts-types/lib/IntFromString';
import Jareth, { Handle } from '@tboyt/jareth';
import { getUserFromAuthToken, getUserById, User } from './models';

interface AppContext {
  handle: Handle;
  currentUser: User | null;
}

function buildContext(db: Jareth): ContextProvider<AppContext> {
  return (req, res, run) => {
    return db.withHandle(async (handle) => {
      // TODO: node headers have a really dumb type signature because set-cookie
      // can be an array: https://nodejs.org/api/http.html#http_message_headers
      // should maybe add a `getHeader()` helper
      const authToken = req.headers['x-auth-token'] as string | undefined;

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

  const app = new Newts();

  // each router can have its own context. this could make it easy to have e.g.
  // auth vs unauth routers
  const router = app.router(buildContext(db));

  // this should eventually be router.get, router.post, etc. for now it's easier
  // to only define one method lol
  router.route(
    'GET',
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
    async (ctx) => {
      const user = await getUserById(ctx.handle, ctx.params.id);
      return {
        name: user.name,
        queryParam: ctx.query.param,
      };
    }
  );

  router.route(
    'GET',
    '/me',
    {
      returns: t.type({
        name: t.string,
        id: t.number,
      }),
    },
    async (ctx) => {
      if (!ctx.currentUser) {
        throw new HttpError(401, 'unauthorized: no user');
      }

      return {
        name: ctx.currentUser.name,
        id: ctx.currentUser.id,
      };
    }
  );

  app.listen(4000);
}

main();
