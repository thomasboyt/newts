import { Newts } from './main';
import * as t from 'io-ts';
import { IntFromString } from 'io-ts-types/lib/IntFromString';
import Jareth, { Handle } from '@tboyt/jareth';

interface AppContext {
  db: Handle;
}

const db = new Jareth('postgres://postgres:@localhost:5433/jambuds');
function withContext(run: (ctx: AppContext) => Promise<void>) {
  return db.withHandle(async (handle) => {
    const context = {
      db: handle,
    };
    await run(context);
  });
}

const app = new Newts();

// each router can have its own context
// this could make it easy to have e.g. auth vs unauth routers
const router = app.router(withContext);

// TODO: this should eventually be router.get, router.post, etc.
// for now it's easier to only define one method lol
router.route(
  'GET',
  '/users/:id',
  {
    // query: ...
    // body: ...
    params: t.type({
      id: IntFromString,
    }),
    returns: t.type({
      name: t.string,
    }),
  },
  async (ctx) => {
    const user = await ctx.db
      .createQuery('select * from users where id=${id}')
      .one(
        { id: ctx.params.id },
        // This is just fake validation:
        (row) => row as { name: string; id: number }
      );
    return {
      name: user.name,
    };
  }
);

app.listen(4000);
