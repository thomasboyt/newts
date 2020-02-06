import Koa from 'koa';
import * as t from 'io-ts';
import { Router, RouterContextProvider, param } from '../src';
import supertest from 'supertest';

describe('tusk', () => {
  describe('parameter deserialization', () => {
    const makeApp = () => {
      const app = new Koa();
      const router = new Router();

      router.get(
        '/echo/:message',
        {
          params: {
            message: param.required(t.string),
          },
          query: {
            message: param.required(t.string),
          },
          returns: t.type({ param: t.string, query: t.string }),
        },
        async (ctx) => {
          return { param: ctx.params.message, query: ctx.query.message };
        }
      );

      app.use(router.routes());

      return app;
    };

    it('works', async () => {
      const app = makeApp();
      const request = supertest(app.callback());
      await request
        .get('/echo/hello%20params?message=hello%20query')
        .expect({ param: 'hello params', query: 'hello query' });
    });

    it('returns a 400 when invalid', async () => {
      const app = makeApp();
      const request = supertest(app.callback());
      await request.get('/echo/hello%20params').expect(400);
    });
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
