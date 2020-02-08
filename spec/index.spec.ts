import Koa from 'koa';
import * as t from 'io-ts';
import { DateFromISOString } from 'io-ts-types/lib/DateFromISOString';
import { Router, CustomContextProvider, param } from '../src';
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
            date: param.optional(DateFromISOString),
          },
          returns: t.type({ param: t.string, query: t.string }),
        },
        async ({ params, query }) => {
          return {
            param: params.message,
            query: query.message,
          };
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

    it('returns a 400 when missing a required query parameter', async () => {
      const app = makeApp();
      const request = supertest(app.callback());
      await request.get('/echo/hello%20params').expect(400);
    });

    it('returns a 400 when a query parameter is invalid', async () => {
      const app = makeApp();
      const request = supertest(app.callback());
      const resp = await request
        .get('/echo/hello%20params?message=foo&date=invalid-date')
        .expect(400);

      const expectedError = {
        error: {
          code: 'INVALID_QUERY',
          message: 'Invalid query parameters',
          errors: [
            {
              code: 'invalid',
              key: 'date',
              type: 'DateFromISOString',
            },
          ],
        },
      };

      expect(resp.body).toEqual(expectedError);
    });
  });

  it('supplies router context', async () => {
    const app = new Koa();
    type AppContext = { message: string };
    const fn: CustomContextProvider<AppContext> = async (req, res, run) =>
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
