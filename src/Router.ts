import { Next } from 'koa';
import {
  pathToRegexp,
  Key as PathKey,
  regexpToFunction,
  MatchFunction,
} from 'path-to-regexp';
import { KoaContext } from './KoaContext';
import { CustomContextProvider, TuskBaseCtx } from './types';
import { json as parseCtxJson } from 'co-body';

import { Validated, createSchema, TsjsonParser } from 'ts-json-validator';
// TODO: This should be exported from ts-json-validator, I think?
import { SchemaLike, Schema } from 'ts-json-validator/dist/json-schema';

import { SchemaValidationError } from './errors';

const isObjectSchema = (s: unknown): s is Schema<'object', any, any> => {
  return (
    typeof s === 'object' &&
    s !== null &&
    s['type'] === 'object' &&
    s['properties'] !== null &&
    typeof s['properties'] === 'object'
  );
};

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
  TParams extends SchemaLike,
  TQuery extends SchemaLike,
  TBody extends SchemaLike,
  TReturns extends SchemaLike | null
> {
  method: HTTPMethod;
  validators: Validators<TParams, TQuery, TBody, TReturns>;
  handler: Handler<TCustomCtx, any, any, any, any>;
  keys: PathKey[];
  regexp: RegExp;
  // TODO: could this be typed more specifically?
  match: MatchFunction<object>;
}

interface Validators<
  TParams extends SchemaLike,
  TQuery extends SchemaLike,
  TBody extends SchemaLike,
  TReturns extends SchemaLike | null
> {
  params: TParams;
  query: TQuery;
  body: TBody;
  returns: TReturns;
}

interface ValidatorsArg<
  TParams extends SchemaLike | undefined = undefined,
  TQuery extends SchemaLike | undefined = undefined,
  TBody extends SchemaLike | undefined = undefined,
  TReturns extends SchemaLike | undefined = undefined
> {
  params?: TParams;
  query?: TQuery;
  body?: TBody;
  returns?: TReturns;
}

type Handler<
  TCustomCtx,
  TParamResults extends Validated<any>,
  TQueryResults extends Validated<any>,
  TParsedBody extends Validated<any>,
  TReturns extends Validated<any> | void
> = (
  routeCtx: TCustomCtx & TuskBaseCtx<TParamResults, TQueryResults, TParsedBody>
) => Promise<TReturns>;

export class Router<TCustomCtx extends {}> {
  withContext: CustomContextProvider<TCustomCtx>;

  private _routes: Route<
    TCustomCtx,
    SchemaLike,
    SchemaLike,
    SchemaLike,
    SchemaLike | null
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

  async handleRoute<
    TParams extends SchemaLike,
    TQuery extends SchemaLike,
    TBody extends SchemaLike,
    TReturns extends SchemaLike | null
  >(
    koaCtx: KoaContext,
    route: Route<TCustomCtx, TParams, TQuery, TBody, TReturns>
  ) {
    koaCtx.assert(koaCtx.request.accepts('application/json'), 406);
    koaCtx.set('content-type', 'application/json');

    const { req, res } = koaCtx;

    await this.withContext(req, res, async (customCtx) => {
      // TODO: use result types here...
      let params;
      try {
        params = this.parseParams(
          route.match,
          koaCtx.path,
          route.validators.params
        );
      } catch (err) {
        if (err instanceof SchemaValidationError) {
          return this.returnSchemaValidationError(koaCtx, 'parameters', err);
        }
        throw err;
      }

      let query;
      try {
        query = this.parseQuery(koaCtx.query, route.validators.query);
      } catch (err) {
        if (err instanceof SchemaValidationError) {
          return this.returnSchemaValidationError(koaCtx, 'query', err);
        }
        throw err;
      }

      let body;
      try {
        body = this.parseBody(
          await parseCtxJson(koaCtx),
          route.validators.body
        );
      } catch (err) {
        if (err instanceof SchemaValidationError) {
          return this.returnSchemaValidationError(koaCtx, 'body', err);
        }
        throw err;
      }

      const baseCtx: TuskBaseCtx<
        Validated<TParams>,
        Validated<TQuery>,
        Validated<TBody>
      > = {
        req: koaCtx.req,
        res: koaCtx.res,
        body: body,
        params,
        query,
      };

      const ctx = { ...baseCtx, ...customCtx };

      // Call and validate response
      const result = await route.handler(ctx);

      if (!result) {
        // 204 no content :)
        koaCtx.status = 204;
        return;
      }

      if (!route.validators.returns) {
        throw new Error(
          'got non-void result from handler but no return validator is set'
        );
      }

      const returnParser = new TsjsonParser(route.validators.body);

      if (!returnParser.validates(result)) {
        const errors = returnParser.getErrors();
        console.error(
          'Invalid response returned from handler for:',
          koaCtx.method,
          koaCtx.path
        );
        console.error(errors);
        throw new Error('Invalid response returned from handler');
      }

      const responseBody = JSON.stringify(result);
      koaCtx.status = 200;
      koaCtx.body = responseBody;
    });
  }

  private parseParams<T extends SchemaLike>(
    matchFn: MatchFunction<object>,
    pathname: string,
    schema: T
  ): Validated<T> {
    const match = matchFn(pathname);

    if (!match) {
      throw new Error("couldn't match");
    }

    const paramsFromPath = match.params;

    const queryParser = new TsjsonParser(schema, { coerceTypes: true });

    if (!queryParser.validates(paramsFromPath)) {
      const errors = queryParser.getErrors();
      throw new SchemaValidationError(errors!);
    }

    return paramsFromPath;
  }

  private parseQuery<T extends SchemaLike>(
    query: unknown,
    schema: T
  ): Validated<T> {
    const queryParser = new TsjsonParser(schema, { coerceTypes: true });

    if (!queryParser.validates(query)) {
      const errors = queryParser.getErrors();
      throw new SchemaValidationError(errors!);
    }

    return query;
  }

  private parseBody<T extends SchemaLike>(
    body: unknown,
    schema: T
  ): Validated<T> {
    const queryParser = new TsjsonParser(schema);

    if (!queryParser.validates(body)) {
      const errors = queryParser.getErrors();
      throw new SchemaValidationError(errors!);
    }

    return body;
  }

  // private returnParamValidationError(
  //   koaCtx: KoaContext,
  //   err: SchemaVa
  // ) {
  //   const error = {
  //     code: 'INVALID_PARAMETER',
  //     message: `Invalid path parameter ${err.key}`,
  //     validationError: err.error,
  //   };

  //   const body = JSON.stringify({ error });
  //   koaCtx.status = 400;
  //   koaCtx.body = body;
  // }

  private returnSchemaValidationError(
    koaCtx: KoaContext,
    type: 'parameters' | 'query' | 'body',
    err: SchemaValidationError
  ) {
    const error = {
      code: `INVALID_${type.toUpperCase()}`,
      message: `Invalid ${type}`,
      validationErrors: err.errors,
    };

    const body = JSON.stringify({ error });
    koaCtx.status = 400;
    koaCtx.body = body;
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
      TParams extends SchemaLike | undefined = undefined,
      TQuery extends SchemaLike | undefined = undefined,
      TBody extends SchemaLike | undefined = undefined,
      TReturns extends SchemaLike | undefined = undefined
    >(
      path: string,
      validators: ValidatorsArg<TParams, TQuery, TBody, TReturns>,
      handler: Handler<
        TCustomCtx,
        TParams extends SchemaLike ? Validated<TParams> : {},
        TQuery extends SchemaLike ? Validated<TQuery> : {},
        TBody extends SchemaLike ? Validated<TBody> : {},
        TReturns extends SchemaLike ? Validated<TReturns> : void
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
          query: validators.query || {},
          body: validators.body || createSchema({ type: 'object' }),
          returns: validators.returns || null,
        },
        handler,
        keys,
        regexp,
        match,
      };

      this._routes.push(
        route as Route<
          TCustomCtx,
          SchemaLike,
          SchemaLike,
          SchemaLike,
          SchemaLike | null
        >
      );
    };
  }

  private getRegexp(
    path: string,
    paramsValidator: SchemaLike | undefined
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

    if (!isObjectSchema(paramsValidator)) {
      throw new Error(
        'params validator must be an object validator with properties'
      );
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
      if (!paramsValidator.properties[key]) {
        throw new Error(`missing route parameter :${key} in params validator`);
      }
    }

    for (const key of Object.keys(paramsValidator.properties)) {
      if (!routeKeyNames.includes(key)) {
        throw new Error(`missing route parameter :${key} in route definition`);
      }
    }

    return { regexp, keys };
  }
}
