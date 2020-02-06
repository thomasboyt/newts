import * as t from 'io-ts';
import { isLeft } from 'fp-ts/lib/Either';

interface OptionalRule<T extends t.Type<any, string>> {
  type: T;
}
interface RequiredRule<T extends t.Type<any, string>> {
  type: T;
  required: true;
}
type Rule<T extends t.Type<any, string>> = OptionalRule<T> | RequiredRule<T>;

type RuleType<P> = P extends RequiredRule<infer T>
  ? t.TypeOf<T>
  : P extends OptionalRule<infer T>
  ? t.TypeOf<T> | undefined
  : never;

export interface RuleMap {
  [key: string]: Rule<t.Type<any, string>>;
}

export type ValidationResult<T extends RuleMap> = {
  [K in keyof T]: RuleType<T[K]>;
};

export function validator<T extends RuleMap>(
  rules: T,
  data: Record<string, unknown>
): ValidationResult<T> {
  const obj = {};

  for (const key of Object.keys(rules)) {
    const rule = rules[key];
    const val = data[key];

    if (val === undefined) {
      if (rule['required']) {
        // TODO: return errors lol
        throw new Error(`missing required param ${key}`);
      } else {
        obj[key] = undefined;
      }
    } else {
      if (typeof val !== 'string') {
        throw new Error(`somehow got a non-string value for ${key}`);
      }

      const result = rule.type.decode(val);
      if (isLeft(result)) {
        throw new Error(`Invalid value ${val} supplied for ${key}`);
      }

      obj[key] = result.right;
    }
  }

  return obj as ValidationResult<T>;
}

// param factories: because no one wants to use "as const" and we might want to
// add e.g. default values
export const param = {
  required<T>(type: T) {
    return { type, required: true as const };
  },
  optional<T>(type: T) {
    return { type };
  },
};
