export interface CompletenessInput {
  profile: {
    last_name: string | null; first_name: string | null; mobile_no: string | null; address: string | null; city_municipality: string | null
    province: string | null; emergency_name: string | null; emergency_contact_no: string | null; is_registered_professional: boolean | null
  }
  credentialCount: number
  hasEmploymentRecord: boolean
  hasTin: boolean
  hasBankAccount: boolean
  requiredDocs: { id: string; name: string; registeredOnly: boolean }[]
  submittedDocIds: Set<string>
}

export interface Completeness { percent: number; missing: string[] }

/** Required items for a usable profile. Documents/financial items may be completed later but are listed. */
export function profileCompleteness(i: CompletenessInput): Completeness {
  const checks: [string, boolean][] = [
    ['Last name', !!i.profile.last_name],
    ['First name', !!i.profile.first_name],
    ['Mobile number', !!i.profile.mobile_no],
    ['Residential address', !!i.profile.address],
    ['City / municipality', !!i.profile.city_municipality],
    ['Province', !!i.profile.province],
    ['Emergency contact name', !!i.profile.emergency_name],
    ['Emergency contact number', !!i.profile.emergency_contact_no],
    ['Registered professional (Yes / No)', i.profile.is_registered_professional !== null],
    ['Employment information', i.hasEmploymentRecord],
    ['TIN', i.hasTin],
    ['LandBank account number', i.hasBankAccount],
  ]
  if (i.profile.is_registered_professional) checks.push(['PRC license details', i.credentialCount > 0])
  for (const d of i.requiredDocs) {
    if (d.registeredOnly && !i.profile.is_registered_professional) continue
    checks.push([`Document: ${d.name}`, i.submittedDocIds.has(d.id)])
  }
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label)
  return { percent: Math.round(((checks.length - missing.length) / checks.length) * 100), missing }
}
