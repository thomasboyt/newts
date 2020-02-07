import { TypeC, TypeOf } from 'io-ts';
import { Next } from 'koa';
import {
  pathToRegexp,
  Key as PathKey,
  regexpToFunction,
  MatchFunction,
} from 'path-to-regexp';
import validateOrThrow from './validateOrThrow';
import { KoaContext } from './KoaContext';
import { validator, RuleMap, ValidationResult } from './validator';
import { CustomContextProvider, TuskBaseCtx } from './types';

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
  TCustomCtx,
  TParams extends RuleMap,
  TQuery extends RuleMap,
  TReturns extends TypeC<any> | undefined = undefined
> {
  method: HTTPMethod;
  validators: Validators<TParams, TQuery, TReturns>;
  handler: Handler<TCustomCtx, any, any, TReturns>;
  keys: PathKey[];
  regexp: RegExp;
  // TODO: could this be typed more specifically?
  match: MatchFunction<object>;
}

interface Validators<
  TParams extends RuleMap,
  TQuery extends RuleMap,
  TReturns extends TypeC<any> | undefined = undefined
> {
  params: TParams;
  query: TQuery;
  returns?: TReturns;
}

interface ValidatorsArg<
  TParams extends RuleMap | undefined = undefined,
  TQuery extends RuleMap | undefined = undefined,
  TReturns extends TypeC<any> | undefined = undefined
> {
  params?: TParams;
  query?: TQuery;
  returns?: TReturns;
}

type Handler<
  TCustomCtx,
  TParamResults extends ValidationResult<any>,
  TQueryResults extends ValidationResult<any>,
  TReturns extends TypeC<any> | undefined = undefined
> = (
  routeCtx: TCustomCtx & TuskBaseCtx<TParamResults, TQueryResults>
) => Promise<TReturns extends TypeC<any> ? TypeOf<TReturns> : void>;

export class Router<TCustomCtx extends {}> {
  withContext: CustomContextProvider<TCustomCtx>;

  private _routes: Route<
    TCustomCtx,
    RuleMap,
    RuleMap,
    TypeC<any> | undefined
  >[] = [];

  constructor(
    withContext: CustomContextProvider<TCustomCtx> = (req, res, run) =>
      run({} as TCustomCtx)
  ) {
    this.withContext = withContext;
  }

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

  /*
   * -----------------
   *  Route execution
   * -----------------
   */

  async handleRoute<TParams extends RuleMap, TQuery extends RuleMap>(
    koaCtx: KoaContext,
    route: Route<TCustomCtx, TParams, TQuery, TypeC<any> | undefined>
  ) {
    koaCtx.assert(koaCtx.request.accepts('application/json'), 406);

    const { req, res } = koaCtx;

    await this.withContext(req, res, async (customCtx) => {
      const params = this.getParams(
        route.match,
        koaCtx.path,
        route.validators.params
      );

      const query = this.getQuery(koaCtx.query, route.validators.query);

      const baseCtx: TuskBaseCtx<
        ValidationResult<TParams>,
        ValidationResult<TQuery>
      > = {
        req: koaCtx.req,
        res: koaCtx.res,
        params,
        query,
      };

      const ctx = { ...baseCtx, ...customCtx };

      const result = await route.handler(ctx);

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

  private getParams<T extends RuleMap>(
    matchFn: MatchFunction<object>,
    pathname: string,
    rules: T
  ): ValidationResult<T> {
    const match = matchFn(pathname);

    if (!match) {
      throw new Error("couldn't match");
    }

    const paramsFromPath = match.params;
    const params = validator(rules, paramsFromPath as {});
    return params;
  }

  private getQuery<T extends RuleMap>(
    query: { [key: string]: any },
    rules: T
  ): ValidationResult<T> {
    const validated = validator(rules, query);
    return validated;
  }

  /*
   * ----------------
   *  Route creation
   * ----------------
   */

  get = this.routeCreatorForMethod('GET');
  post = this.routeCreatorForMethod('POST');
  put = this.routeCreatorForMethod('PUT');
  patch = this.routeCreatorForMethod('PATCH');
  delete = this.routeCreatorForMethod('DELETE');
  head = this.routeCreatorForMethod('HEAD');
  options = this.routeCreatorForMethod('OPTIONS');

  private routeCreatorForMethod(method: HTTPMethod) {
    return <
      TParams extends RuleMap | undefined = undefined,
      TQuery extends RuleMap | undefined = undefined,
      TReturns extends TypeC<any> | undefined = undefined
    >(
      path: string,
      validators: ValidatorsArg<TParams, TQuery, TReturns>,
      handler: Handler<
        TCustomCtx,
        TParams extends RuleMap ? ValidationResult<TParams> : {},
        TQuery extends RuleMap ? ValidationResult<TQuery> : {},
        TReturns
      >
    ) => {
      const { regexp, keys } = this.getRegexp(path, validators.params);
      const match = regexpToFunction(regexp, keys, {
        decode: decodeURIComponent,
      });

      const route = {
        method,
        validators: {
          params: validators.params || {},
          query: validators.params || {},
          returns: validators.returns,
        },
        handler,
        keys,
        regexp,
        match,
      };

      this._routes.push(route as Route<TCustomCtx, RuleMap, RuleMap, TReturns>);
    };
  }

  private getRegexp(
    path: string,
    paramsValidator: RuleMap | undefined
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
      if (!paramsValidator[key]) {
        throw new Error(`missing route parameter :${key} in params validator`);
      }
    }

    for (const key of Object.keys(paramsValidator)) {
      if (!routeKeyNames.includes(key)) {
        throw new Error(`missing route parameter :${key} in route definition`);
      }
    }

    return { regexp, keys };
  }
}
