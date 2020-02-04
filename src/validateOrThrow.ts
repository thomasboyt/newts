import * as t from 'io-ts';
import { isLeft } from 'fp-ts/lib/Either';
import { PathReporter } from 'io-ts/lib/PathReporter';

type IoTypeC = t.TypeC<any> | t.IntersectionC<any>;

export default function validateOrThrow<T extends IoTypeC>(
  codec: T,
  obj: any
): t.TypeOf<T> {
  const result = t.exact(codec).decode(obj);

  if (isLeft(result)) {
    // TODO: this format kinda sucks
    const report = PathReporter.report(result).join('\n');
    // TODO: create a specific error for this that can turn into a
    // 400/422/whatever
    throw new Error(report);
  }

  return result.right;
}
