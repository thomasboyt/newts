import { ExtendableContext } from 'koa';

// remove index type from context
// see: https://stackoverflow.com/a/51956054
type KnownKeys<T> = {
  [K in keyof T]: string extends K ? never : number extends K ? never : K;
} extends { [_ in keyof T]: infer U }
  ? {} extends U
    ? never
    : U
  : never;
type RequiredOnly<T extends Record<any, any>> = Pick<T, KnownKeys<T>>;

/**
 * A stricter version of Koa's context that does not allow extending `ctx.state`
 * or any property not defined on the base context.
 */
export type KoaContext = RequiredOnly<ExtendableContext> & {
  state: {};
};
