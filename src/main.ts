import http, { IncomingMessage } from 'http';
import url from 'url';
import { HasProps, TypeOf, TypeC } from 'io-ts';
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
  TReturns extends HasProps | undefined = undefined
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
  TReturns extends HasProps | undefined = undefined
> {
  params?: TParams;
  query?: TQuery;
  returns?: TReturns;
}

type Handler<
  TCtx,
  TParams extends TypeC<any> | undefined = undefined,
  TQuery extends TypeC<any> | undefined = undefined,
  TReturns extends HasProps | undefined = undefined
> = (
  ctx: TCtx & {
    params: TParams extends undefined
      ? never
      : TParams extends TypeC<any>
      ? TypeOf<TParams>
      : never;
    query: TQuery extends undefined
      ? never
      : TQuery extends TypeC<any>
      ? TypeOf<TQuery>
      : never;
  }
) => Promise<TReturns extends HasProps ? TypeOf<TReturns> : void>;

class Router<TCtx> {
  withContext: WithContext<TCtx>;

  routes: Route[] = [];

  constructor(withContext: WithContext<TCtx>) {
    this.withContext = withContext;
  }

  route<
    TParams extends TypeC<any> | undefined = undefined,
    TQuery extends TypeC<any> | undefined = undefined,
    TReturns extends HasProps | undefined = undefined
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

  handleRoute<
    TParams extends TypeC<any> | undefined,
    TQuery extends TypeC<any> | undefined,
    TReturns extends HasProps | undefined
  >(
    pathname: string,
    req: http.ClientRequest,
    res: http.ServerResponse,
    route: Route<TCtx, TParams, TQuery, TReturns>
  ) {
    // first: apply context
    this.withContext(async (ctx) => {
      // then: apply params & query
      const paramsValidator = route.validators.params;

      if (paramsValidator) {
        // TODO: cache the fn here on Route
        const paramsFromPath = regexpToFunction(
          route.regexp,
          route.keys
        )(pathname);

        const params = validateOrThrow(paramsValidator!, paramsFromPath);
        ctx = { ...ctx, ...params };
      }
      const result = await route.handler(ctx);
    });
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

    for (const router of this.routers) {
      for (const route of router.routes) {
        if (
          route.method === req.method &&
          route.regexp.test(urlParts.pathname!)
        ) {
          router.handleRoute(req, res, route);
        }
      }
    }

    throw new Error('TODO: 404 route not found sry');
  }
}
