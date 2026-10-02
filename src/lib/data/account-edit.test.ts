import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountEditBlock,
  ACCOUNT_NOT_IN_COMPANY,
  ACCOUNT_PROTECTED,
  ACCOUNT_SHARED,
} from "./account-edit.ts";

/**
 * A person's name, phone, sign-in email and password belong to the
 * person, not to one company: the same account can work in several. So an
 * Office or Admin user may change an account only when every company
 * that person works in is one they run too -- otherwise one company could
 * take over, or redirect the texts of, somebody who works for another.
 */

const A = "aaaaaaaa-0000-0000-0000-000000000000";
const B = "bbbbbbbb-0000-0000-0000-000000000000";
const ACTOR = "11111111-0000-0000-0000-000000000000";
const TARGET = "22222222-0000-0000-0000-000000000000";

const base = {
  actorId: ACTOR,
  targetId: TARGET,
  companyId: A,
  actorAdminCompanyIds: [A],
  targetIsProtected: false,
};

test("someone who works only in this company can be edited", () => {
  assert.equal(
    accountEditBlock({ ...base, targetMemberships: [{ company_id: A }] }),
    null
  );
});

test("someone with no place in this company can't be edited from it", () => {
  assert.equal(
    accountEditBlock({ ...base, targetMemberships: [{ company_id: B }] }),
    ACCOUNT_NOT_IN_COMPANY
  );
  assert.equal(accountEditBlock({ ...base, targetMemberships: [] }), ACCOUNT_NOT_IN_COMPANY);
});

test("a seat that exists only because the person is a platform admin doesn't count", () => {
  assert.equal(
    accountEditBlock({
      ...base,
      targetMemberships: [{ company_id: A, granted_via_platform_admin: true }],
    }),
    ACCOUNT_NOT_IN_COMPANY
  );
});

test("someone who also works for a company the editor doesn't run is off limits", () => {
  // The take-over: add another company's rep to your own company, then
  // change their password or phone. The second membership stops it.
  assert.equal(
    accountEditBlock({
      ...base,
      targetMemberships: [{ company_id: A }, { company_id: B }],
    }),
    ACCOUNT_SHARED
  );
});

test("an archived seat elsewhere still counts -- it can be switched back on", () => {
  assert.equal(
    accountEditBlock({
      ...base,
      targetMemberships: [{ company_id: A }, { company_id: B, status: "Archived" }],
    }),
    ACCOUNT_SHARED
  );
});

test("an owner who runs both companies can edit someone who works in both", () => {
  assert.equal(
    accountEditBlock({
      ...base,
      actorAdminCompanyIds: [A, B],
      targetMemberships: [{ company_id: A }, { company_id: B }],
    }),
    null
  );
});

test("platform and super admin accounts are changed only by their owner", () => {
  assert.equal(
    accountEditBlock({
      ...base,
      actorAdminCompanyIds: [A, B],
      targetIsProtected: true,
      targetMemberships: [{ company_id: A }],
    }),
    ACCOUNT_PROTECTED
  );
});

test("anyone may edit their own account", () => {
  assert.equal(
    accountEditBlock({
      ...base,
      targetId: ACTOR,
      targetIsProtected: true,
      targetMemberships: [{ company_id: A, granted_via_platform_admin: true }, { company_id: B }],
    }),
    null
  );
});
