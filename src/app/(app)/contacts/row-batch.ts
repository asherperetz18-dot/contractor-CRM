/** Shared between the server page and the client table: how many rows
 *  each fetch carries. Comfortably more than a screenful. Lives in its
 *  own module because a constant exported from a "use client" file is
 *  not readable from a Server Component. */
export const CONTACT_ROW_BATCH = 60;
