import http from 'http';
import url from 'url';
import { TypeOf, TypeC } from 'io-ts';
import { pathToRegexp, Key as PathKey, regexpToFunction } from 'path-to-regexp';
import validateOrThrow from './validateOrThrow';

export type WithContext<TCtx> = (
  run: (ctx: TCtx) => Promise<void>
) => Promise<any>;

// probably forgetting something
type HTTPMethod =
  | 'GET'
  | 'POST'
  | 'PATCH'
  | 'DELETE'
  | 'PUT'
  | 'HEAD'
  | 'OPTIONS';

interface Route<
  TCtx,
  TParams extends TypeC<any> | undefined = undefined,
  TQuery extends TypeC<any> | undefined = undefined,
  TReturns extends TypeC<any> | undefined = undefined
> {
  method: HTTPMethod;
  validators: Validators<TParams, TQuery, TReturns>;
  handler: Handler<TCtx, TParams, TQuery, TReturns>;
  regexp: RegExp;
  keys: PathKey[];
}

interface Validators<
  TParams extends TypeC<any> | undefined = undefined,
  TQuery extends TypeC<any> | undefined = undefined,
  TReturns extends TypeC<any> | undefined = undefined
> {
  params?: TParams;
  query?: TQuery;
  returns?: TReturns;
}

type Handler<
  TCtx,
  TParams extends TypeC<any> | undefined = undefined,
  TQuery extends TypeC<any> | undefined = undefined,
  TReturns extends TypeC<any> | undefined = undefined
> = (
  ctx: TCtx & {
    params: TParams extends undefined
      ? {}
      : TParams extends TypeC<any>
      ? TypeOf<TParams>
      : {};
    query: TQuery extends undefined
      ? {}
      : TQuery extends TypeC<any>
      ? TypeOf<TQuery>
      : {};
  }
) => Promise<TReturns extends TypeC<any> ? TypeOf<TReturns> : void>;

class Router<TCtx> {
  withContext: WithContext<TCtx>;

  routes: Route<TCtx, any, any, any>[] = [];

  constructor(withContext: WithContext<TCtx>) {
    this.withContext = withContext;
  }

  route<
    TParams extends TypeC<any> | undefined = undefined,
    TQuery extends TypeC<any> | undefined = undefined,
    TReturns extends TypeC<any> | undefined = undefined
  >(
    method: HTTPMethod,
    path: string,
    validators: Validators<TParams, TQuery, TReturns>,
    handler: Handler<TCtx, TParams, TQuery, TReturns>
  ) {
    const { regexp, keys } = this.getRegexp(path, validators.params);

    this.routes.push({
      method,
      validators,
      handler,
      regexp,
      keys,
    });
  }

  async handleRoute(
    urlParts: url.UrlWithStringQuery,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    route: Route<
      TCtx,
      TypeC<any> | undefined,
      TypeC<any> | undefined,
      TypeC<any> | undefined
    >
  ) {
    // TODO: move this somewhere else
    function getParams<T extends TypeC<any> | undefined>(
      val: T
    ): { [key: string]: any } {
      if (val) {
        // TODO: cache the fn here on Route
        const match = regexpToFunction(
          route.regexp,
          route.keys
        )(urlParts.pathname!);

        if (!match) {
          throw new Error("couldn't match");
        }

        const paramsFromPath = match.params;
        const params = validateOrThrow(val!, paramsFromPath);
        return params;
      } else {
        return {};
      }
    }

    try {
      await this.withContext(async (ctx) => {
        const paramsValidator = route.validators.params;

        const params = getParams(paramsValidator);

        // const queryValidator = route.validators.query;

        // if (queryValidator) {
        //   const search = urlParts.query;
        //   const params = validateOrThrow(queryValidator!, search);
        //   ctx = { ...ctx, ...params };
        // }

        const result = await route.handler({
          ...ctx,
          params,
          query: {
            // TODO
          },
        });

        if (result) {
          if (!route.validators.returns) {
            throw new Error(
              'got non-void result from handler but no return validator is set'
            );
          }
          const parsedResult = validateOrThrow(
            route.validators.returns!,
            result
          );

          const body = JSON.stringify(parsedResult);
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(body, 'utf8');
        } else {
          res.statusCode = 204;
          res.end();
        }
      });
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.end();
    }
  }

  private getRegexp(
    path: string,
    paramsValidator: TypeC<any> | undefined
  ): { regexp: RegExp; keys: PathKey[] } {
    // TODO: like... register this and do something with it
    const keys: PathKey[] = [];
    const regexp = pathToRegexp(path, keys);

    if (!paramsValidator && keys.length > 0) {
      throw new Error(
        'missing param validators for route with defined parameters'
      );
    }

    if (!paramsValidator) {
      return { regexp, keys };
    }

    for (const key of keys) {
      if (typeof key.name === 'number') {
        throw new Error(
          'cannot use positional parameters - please name per https://github.com/pillarjs/path-to-regexp#custom-matching-parameters'
        );
      }
    }

    const routeKeyNames = keys.map((key) => key.name) as string[];

    // ensure keys are present on both sides
    for (const key of routeKeyNames) {
      if (!paramsValidator.props[key]) {
        throw new Error(`missing route parameter :${key} in params validator`);
      }
    }

    for (const key of Object.keys(paramsValidator.props)) {
      if (!routeKeyNames.includes(key)) {
        throw new Error(`missing route parameter :${key} in route definition`);
      }
    }

    return { regexp, keys };
  }
}

export class Newts {
  routers: Router<any>[] = [];

  constructor() {
    // TODO
  }

  router<TCtx>(withContext: WithContext<TCtx>): Router<TCtx> {
    const router = new Router(withContext);
    this.routers.push(router);
    return router;
  }

  listen(port: number) {
    const server = http.createServer((req, res) => {
      console.log('got request');
      this.match(req, res);
    });
    server.listen(port);
    console.log(`listening on port ${port}`);
  }

  private match(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!req.url) {
      throw new Error('missing req.url i guess???');
    }

    const urlParts = url.parse(req.url);
    const pathname = urlParts.pathname!;

    for (const router of this.routers) {
      for (const route of router.routes) {
        if (route.method === req.method && route.regexp.test(pathname)) {
          router.handleRoute(urlParts, req, res, route);
          return;
        }
      }
    }

    // TODO: write something to the body here
    res.statusCode = 404;
    res.end();
  }
}
