import Koa from 'koa';
import { createSchema as S } from 'ts-json-validator';
import { Router, CustomContextProvider } from '../src';
import supertest from 'supertest';

describe('tusk', () => {
  describe('input/output parsing', () => {
    describe('path parameters', () => {
      const makeApp = () => {
        const app = new Koa();
        const router = new Router();

        router.get(
          '/users/:id',
          {
            params: S({
              type: 'object',
              properties: {
                id: S({ type: 'number' }),
              },
              required: ['id'],
            }),
            returns: S({
              type: 'object',
              properties: {
                userId: S({ type: 'number' }),
              },
              required: ['userId'],
            }),
          },
          async ({ params }) => {
            return {
              userId: params.id,
            };
          }
        );

        app.use(router.routes());

        return app;
      };

      it('works', async () => {
        const app = makeApp();
        const request = supertest(app.callback());
        await request.get('/users/1').expect({ userId: 1 });
      });

      it('returns a 400 when invalid', async () => {
        const app = makeApp();
        const request = supertest(app.callback());
        await request.get('/users/foo').expect(400);
      });
    });

    describe('query parameters', () => {
      const makeApp = () => {
        const app = new Koa();
        const router = new Router();

        router.get(
          '/search',
          {
            query: S({
              type: 'object',
              properties: {
                searchQuery: S({ type: 'string' }),
                before: S({ type: 'string', format: 'date-time' }),
              },
              required: ['searchQuery'],
            }),
            returns: S({
              type: 'object',
              properties: {
                results: S({
                  type: 'array',
                  items: S({
                    type: 'object',
                    properties: {
                      id: S({ type: 'number' }),
                    },
                    required: ['id'],
                  }),
                }),
                meta: S({
                  type: 'object',
                  properties: {
                    searchQuery: S({ type: 'string' }),
                    before: S({ type: 'string', format: 'date-time' }),
                  },
                  required: ['searchQuery'],
                }),
              },
              required: ['results', 'meta'],
            }),
          },
          async ({ query }) => {
            return {
              results: [{ id: 1 }],
              meta: {
                searchQuery: query.searchQuery,
                before: query.before,
              },
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
          .get('/search?searchQuery=asdf')
          .expect({ results: [{ id: 1 }], meta: { searchQuery: 'asdf' } });
      });

      it('returns a 400 when a query parameter is invalid', async () => {
        const app = makeApp();
        const request = supertest(app.callback());
        await request.get('/search?searchQuery=asdf&before=asdf').expect(400);
      });
    });

    describe('body', () => {
      const makeApp = () => {
        const app = new Koa();

        const router = new Router();

        router.post(
          '/echo',
          {
            body: S({
              type: 'object',
              properties: {
                message: S({ type: 'string', maxLength: 20 }),
              },
              required: ['message'],
            }),
            returns: S({
              type: 'object',
              properties: {
                message: S({ type: 'string' }),
              },
              required: ['message'],
            }),
          },
          async (ctx) => {
            return { message: ctx.body.message };
          }
        );

        app.use(router.routes());

        return app;
      };

      it('is supported', async () => {
        const app = makeApp();

        await supertest(app.callback())
          .post('/echo')
          .send({ message: 'hello body' })
          .expect({ message: 'hello body' });
      });

      it('returns 400 for missing body when one was expected', async () => {
        const app = makeApp();

        await supertest(app.callback())
          .post('/echo')
          .expect(400);
      });

      it('returns 400 for param of wrong type', async () => {
        const app = makeApp();

        await supertest(app.callback())
          .post('/echo')
          .send({ message: 123 })
          .expect(400);
      });

      it('returns 400 for invalid param', async () => {
        const app = makeApp();
        await supertest(app.callback())
          .post('/echo')
          .send({ message: 'this is a string that is much too long!' })
          .expect(400);
      });
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
        returns: S({
          type: 'object',
          properties: { message: S({ type: 'string' }) },
          required: ['message'],
        }),
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
