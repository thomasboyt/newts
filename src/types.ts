import { IncomingMessage, ServerResponse } from 'http';
import { Validated } from 'ts-json-validator';

/**
 * The base context passed to a route handler. The custom context is mixed
 * into this to create the "tuskCtx" argument.
 */
export type TuskBaseCtx<
  TParams extends Validated<any>,
  TQuery extends Validated<any>,
  TParsedBody extends Validated<any>
> = {
  params: TParams;
  query: TQuery;
  body: TParsedBody;
  req: IncomingMessage;
  res: ServerResponse;
};

/**
 * The type of a "custom context provider" attached to a Router. This provider
 * injects a custom set of context into the tuskCtx passed to route handlers.
 */
export type CustomContextProvider<TCustomContext> = (
  req: IncomingMessage,
  res: ServerResponse,
  run: (customCtx: TCustomContext) => Promise<void>
) => Promise<any>;
