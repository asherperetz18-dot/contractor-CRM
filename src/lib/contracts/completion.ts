/**
 * The default completion certificate.
 *
 * Seeded into a company's templates the first time one is needed, then
 * editable like the contract -- this is a starting point, not wording
 * anybody is stuck with.
 *
 * Written against the contract this system already sends: the one-year
 * labour warranty is section 10, and the lien-release right is section 11.
 * Deliberately NOT a "Notice of Completion", which in many states is a
 * different instrument the owner records with the county -- calling this
 * that would tell a homeowner something untrue about what they had just
 * signed.
 *
 * No state's rules in the wording: it used to name the CSLB and
 * California law for every company, wherever it worked (DECISIONS #117).
 * A company that wants its own state's wording edits it like the
 * contract.
 */
export const DEFAULT_COMPLETION_CERTIFICATE = `CERTIFICATE OF COMPLETION

Contract {{contract_no}}
Project address: {{project_address}}
Contractor: {{company_name}}, Licence No. {{license_no}}

1. Completion
The Contractor has completed the work described in the above contract, together with any change orders signed by both parties. The Owner has inspected the work and accepts it as complete, subject only to the outstanding items recorded below.

2. Outstanding items
Any items listed below remain the Contractor's responsibility and are not waived by signing this certificate. If none are listed, the Owner accepts the work in full.

3. Warranty
The one-year labour warranty described in the contract begins on the date of completion stated below. Manufacturer warranties on installed materials apply separately and are unaffected by this certificate.

4. Final payment
The remaining balance under the payment schedule becomes due on acceptance. Before releasing final payment the Owner may request, and the Contractor will provide, signed lien releases from subcontractors and material suppliers who worked on the project.

5. Acknowledgment
By signing, the Owner confirms the work has been inspected and accepted as described above. This certificate does not waive any right the Owner has under the contract or under the law.

Date of completion: {{completion_date}}
`;
