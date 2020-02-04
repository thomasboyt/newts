import { Handle, mapDecode } from '@tboyt/jareth';
import * as t from 'io-ts';

const UserCodec = t.type({
  name: t.string,
  id: t.number,
});

export type User = t.TypeOf<typeof UserCodec>;

export async function getUserById(
  handle: Handle,
  userId: number
): Promise<t.TypeOf<typeof UserCodec>> {
  const user = await handle
    .createQuery('select * from users where id=${id}')
    .one(
      { id: userId },
      // This is just fake validation:
      mapDecode(UserCodec)
    );

  return user;
}

export async function getUserFromAuthToken(
  handle: Handle,
  authToken: string | undefined
): Promise<t.TypeOf<typeof UserCodec> | null> {
  if (!authToken) {
    return null;
  }

  const row = await handle
    .createQuery(
      'select user_id from auth_tokens where auth_token=${authToken}'
    )
    .oneOrNone({ authToken }, mapDecode(t.type({ userId: t.number })));

  if (row === null) {
    return null;
  }

  const user = await getUserById(handle, row.userId);
  return user;
}
