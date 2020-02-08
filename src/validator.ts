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

export interface ValidationErrorItem {
  code: 'missingRequired' | 'invalid';
  key: string;
  type: string;
  message?: string;
}

export function validator<T extends RuleMap>(
  rules: T,
  data: Record<string, unknown>
): [ValidationResult<T>, ValidationErrorItem[]] {
  const obj = {};

  const errors: ValidationErrorItem[] = [];
  for (const key of Object.keys(rules)) {
    const rule = rules[key];
    const val = data[key];

    if (val === undefined) {
      if (rule['required']) {
        // TODO: return errors lol
        const type = rule.type.name;
        errors.push({
          code: 'missingRequired',
          key,
          type,
        });
      } else {
        obj[key] = undefined;
      }
    } else {
      if (typeof val !== 'string') {
        throw new Error(`somehow got a non-string value for ${key}`);
      }

      const result = rule.type.decode(val);
      if (isLeft(result)) {
        const err = result.left[0];
        const type = err.context[0].type.name;
        const error: ValidationErrorItem = {
          code: 'invalid',
          key,
          type,
          message: err.message,
        };
        errors.push(error);
      } else {
        obj[key] = result.right;
      }
    }
  }

  return [obj as ValidationResult<T>, errors];
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
