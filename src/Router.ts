import { TypeOf, TypeC } from 'io-ts';
import {
  pathToRegexp,
  Key as PathKey,
  regexpToFunction,
  MatchFunction,
} from 'path-to-regexp';
import validateOrThrow from './validateOrThrow';
import { Context as KoaUnsafeCtx, Next } from 'koa';

/**
 * A stricter version of Koa's context that does not allow accessing `ctx.state`
 * or any property not defined on the base context.
 */
export type KoaContext = KoaUnsafeCtx & { state: never; [key: string]: never };

export type RouterContextProvider<TRouterCtx> = (
  kctx: KoaContext,
  run: (routerCtx: TRouterCtx) => Promise<void>
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

// TODO: Lots of hoops jumped through to make these potentially undefined and
// handle that case, and since TS doesn't support generic union narrowing among
// other issues it sucks to manage.
//
// Might be able to use function overloads or similar to better handle this.

interface Route<
  TRouterCtx,
  TParams extends TypeC<any> | undefined = undefined,
  TQuery extends TypeC<any> | undefined = undefined,
  TReturns extends TypeC<any> | undefined = undefined
> {
  method: HTTPMethod;
  validators: Validators<TParams, TQuery, TReturns>;
  handler: Handler<TRouterCtx, TParams, TQuery, TReturns>;
  keys: PathKey[];
  regexp: RegExp;
  // TODO: could this be typed more specifically?
  match: MatchFunction<object>;
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
  TRouterCtx,
  TParams extends TypeC<any> | undefined = undefined,
  TQuery extends TypeC<any> | undefined = undefined,
  TReturns extends TypeC<any> | undefined = undefined
> = (
  routeCtx: TRouterCtx & {
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
  },
  koaCtx: KoaContext
) => Promise<TReturns extends TypeC<any> ? TypeOf<TReturns> : void>;

export class Router<TRouterCtx extends {}> {
  withContext: RouterContextProvider<TRouterCtx>;

  private _routes: Route<TRouterCtx, any, any, any>[] = [];

  constructor(
    withContext: RouterContextProvider<TRouterCtx> = (kctx, run) =>
      run({} as TRouterCtx)
  ) {
    this.withContext = withContext;
  }

  get = this.routeCreatorForMethod('GET');
  post = this.routeCreatorForMethod('POST');
  put = this.routeCreatorForMethod('PUT');
  patch = this.routeCreatorForMethod('PATCH');
  delete = this.routeCreatorForMethod('DELETE');
  head = this.routeCreatorForMethod('HEAD');
  options = this.routeCreatorForMethod('OPTIONS');

  /**
   * Returns a middleware to be `use()`d by your Koa app:
   *
   * ```ts
   * const app = new Koa();
   * const router = new Router();
   * // ...define some routes...
   * app.use(router.routes());
   * ```
   */
  routes() {
    return async (koaCtx: KoaContext, next: Next) => {
      for (const route of this._routes) {
        if (route.method === koaCtx.method && route.regexp.test(koaCtx.path)) {
          await this.handleRoute(koaCtx, route);
          // TODO: should next actually get called lol
          await next();
          return;
        }
      }
    };
  }

  async handleRoute(
    koaCtx: KoaContext,
    route: Route<
      TRouterCtx,
      TypeC<any> | undefined,
      TypeC<any> | undefined,
      TypeC<any> | undefined
    >
  ) {
    koaCtx.assert(koaCtx.request.accepts('application/json'), 406);

    await this.withContext(koaCtx, async (routerCtx) => {
      const params = this.getParams(
        route,
        koaCtx.path,
        route.validators.params
      );
      const query = this.getQuery(koaCtx.query, route.validators.query);
      const routeCtx = { ...routerCtx, params, query };

      const result = await route.handler(routeCtx, koaCtx);

      if (result) {
        if (!route.validators.returns) {
          throw new Error(
            'got non-void result from handler but no return validator is set'
          );
        }
        const parsedResult = validateOrThrow(route.validators.returns!, result);

        const body = JSON.stringify(parsedResult);
        koaCtx.status = 200;
        koaCtx.set('content-type', 'application/json');
        koaCtx.body = body;
      } else {
        koaCtx.status = 204;
      }
    });
  }

  private getRegexp(
    path: string,
    paramsValidator: TypeC<any> | undefined
  ): { regexp: RegExp; keys: PathKey[] } {
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

  private getParams(
    route: Route<TRouterCtx, any, any, any>,
    pathname: string,
    val: TypeC<any> | undefined
  ): { [key: string]: any } {
    if (!val) {
      return {};
    }

    // TODO:
    const match = route.match(pathname);

    if (!match) {
      throw new Error("couldn't match");
    }

    const paramsFromPath = match.params;
    const params = validateOrThrow(val!, paramsFromPath);
    return params;
  }

  private getQuery(
    query: { [key: string]: any },
    val: TypeC<any> | undefined
  ): { [key: string]: any } {
    if (!val) {
      return {};
    }

    const validated = validateOrThrow(val!, query);
    return validated;
  }

  private routeCreatorForMethod(method: HTTPMethod) {
    return <
      TParams extends TypeC<any> | undefined = undefined,
      TQuery extends TypeC<any> | undefined = undefined,
      TReturns extends TypeC<any> | undefined = undefined
    >(
      path: string,
      validators: Validators<TParams, TQuery, TReturns>,
      handler: Handler<TRouterCtx, TParams, TQuery, TReturns>
    ) => {
      const { regexp, keys } = this.getRegexp(path, validators.params);
      const match = regexpToFunction(regexp, keys, {
        decode: decodeURIComponent,
      });

      this._routes.push({
        method,
        validators,
        handler,
        keys,
        regexp,
        match,
      });
    };
  }
}
