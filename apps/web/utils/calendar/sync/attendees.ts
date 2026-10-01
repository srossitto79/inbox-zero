export type StoredAttendee = {
  email: string;
  name?: string;
  responseStatus?: string;
  isSelf?: true;
  isOrganizer?: true;
};

/** Prisma JSON columns reject `undefined` members, so absent fields are omitted. */
export function buildAttendee({
  email,
  name,
  responseStatus,
  isSelf,
  isOrganizer,
}: {
  email: string;
  name?: string | null;
  responseStatus?: string | null;
  isSelf?: boolean | null;
  isOrganizer?: boolean | null;
}): StoredAttendee {
  return {
    email,
    ...(name ? { name } : {}),
    ...(responseStatus ? { responseStatus } : {}),
    ...(isSelf ? { isSelf: true as const } : {}),
    ...(isOrganizer ? { isOrganizer: true as const } : {}),
  };
}
