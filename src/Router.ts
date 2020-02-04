import http from 'http';
import url from 'url';
import { TypeOf, TypeC } from 'io-ts';
import {
  pathToRegexp,
  Key as PathKey,
  regexpToFunction,
  MatchFunction,
} from 'path-to-regexp';
import validateOrThrow from './validateOrThrow';
import { HttpError } from './HttpError';

export type ContextProvider<TCtx> = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
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

// TODO: Lots of hoops jumped through to make these potentially undefined and
// handle that case, and since TS doesn't support generic union narrowing among
// other issues it sucks to manage.
//
// Might be able to use function overloads or similar to better handle this.

interface Route<
  TCtx,
  TParams extends TypeC<any> | undefined = undefined,
  TQuery extends TypeC<any> | undefined = undefined,
  TReturns extends TypeC<any> | undefined = undefined
> {
  method: HTTPMethod;
  validators: Validators<TParams, TQuery, TReturns>;
  handler: Handler<TCtx, TParams, TQuery, TReturns>;
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

export class Router<TCtx> {
  withContext: ContextProvider<TCtx>;

  routes: Route<TCtx, any, any, any>[] = [];

  constructor(withContext: ContextProvider<TCtx>) {
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
    const match = regexpToFunction(regexp, keys);

    this.routes.push({
      method,
      validators,
      handler,
      keys,
      regexp,
      match,
    });
  }

  async handleRoute(
    urlParts: url.UrlWithParsedQuery,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    route: Route<
      TCtx,
      TypeC<any> | undefined,
      TypeC<any> | undefined,
      TypeC<any> | undefined
    >
  ) {
    try {
      await this.withContext(req, res, async (ctx) => {
        const params = this.getParams(
          route,
          urlParts.pathname!,
          route.validators.params
        );

        const query = this.getQuery(urlParts.query, route.validators.query);

        const result = await route.handler({
          ...ctx,
          params,
          query,
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
      // TODO: implement an actual onError hook
      if (err instanceof HttpError) {
        const body = JSON.stringify(err.toJSON());
        res.statusCode = err.statusCode;
        res.setHeader('content-type', 'application/json');
        res.end(body, 'utf8');
      } else {
        console.error(err);
        res.statusCode = 500;
        res.end();
      }
    }
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
    route: Route<TCtx, any, any, any>,
    pathname: string,
    val: TypeC<any> | undefined
  ): { [key: string]: any } {
    if (!val) {
      return {};
    }
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
}
