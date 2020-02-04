import Koa from 'koa';
import * as t from 'io-ts';
import { Router, RouterContextProvider } from '../src';
import supertest from 'supertest';

describe('tusk', () => {
  it('deserializes parameters', async () => {
    const app = new Koa();
    const router = new Router();

    router.get(
      '/echo/:message',
      {
        params: t.type({ message: t.string }),
        query: t.type({ message: t.string }),
        returns: t.type({ param: t.string, query: t.string }),
      },
      async (ctx) => {
        return { param: ctx.params.message, query: ctx.query.message };
      }
    );

    app.use(router.routes());

    const request = supertest(app.callback());
    await request
      .get('/echo/hello%20params?message=hello%20query')
      .expect({ param: 'hello params', query: 'hello query' });
  });

  it('supplies router context', async () => {
    const app = new Koa();
    type AppContext = { message: string };
    const fn: RouterContextProvider<AppContext> = async (kctx, run) =>
      run({ message: 'hello world' });

    const router = new Router(fn);

    router.get(
      '/hello',
      {
        returns: t.type({ message: t.string }),
      },
      async (ctx) => {
        return { message: ctx.message };
      }
    );

    app.use(router.routes());

    const request = supertest(app.callback());
    await request.get('/hello').expect({ message: 'hello world' });
  });
});
