export interface Candidate {
  volunteer_id: string; volunteer_no: string; full_name: string; is_registered: boolean; profile_verified: boolean; license_verified: boolean
  availability_declared: boolean; available: boolean; preferred_event: boolean; preferred_position_ids: string[]; preferred_center_ids: string[]
  prior_completed: number; prior_no_show: number; prior_total: number; recent_assignments: number; has_experience: boolean
  has_training: boolean; has_conflict: boolean; assigned_this_day: boolean; blockers: string[]
}

export interface PositionNeed { id: string; name: string; requires_registered_professional: boolean; requires_verified_license: boolean }

export interface Weights { availability: number; preference: number; position: number; qualification: number; experience: number; reliability: number; fairness: number; shortage: number }

export const DEFAULT_WEIGHTS: Weights = { availability: 30, preference: 20, position: 15, qualification: 10, experience: 10, reliability: 10, fairness: 10, shortage: 5 }

export interface Recommendation { candidate: Candidate; score: number; reasons: string[]; eligible: boolean; blockedBy: string[] }

/**
 * Ranks candidates for one position/day. Uses only operational criteria (availability, preference, qualifications,
 * experience, verified reliability, fairness of distribution). Personal characteristics are never inputs.
 * The result is advisory: a PRC officer must review and confirm.
 */
export function recommend(candidates: Candidate[], position: PositionNeed, centerId: string | null, weights: Weights = DEFAULT_WEIGHTS, vacancyRatio = 1): Recommendation[] {
  const maxRecent = Math.max(1, ...candidates.map((c) => c.recent_assignments))
  const out = candidates.map<Recommendation>((c) => {
    const reasons: string[] = []
    const blockedBy: string[] = [...c.blockers]
    if (c.assigned_this_day) blockedBy.push('Already assigned on this day')
    if (c.has_conflict) blockedBy.push('Schedule conflict with another assignment')
    if (position.requires_registered_professional && !c.is_registered) blockedBy.push('Position requires a registered professional')
    if (position.requires_verified_license && !c.license_verified) blockedBy.push('Position requires a verified PRC license')
    let score = 0
    if (c.available) { score += weights.availability; reasons.push('Declared available for this date') }
    else if (!c.availability_declared) reasons.push('No availability declared')
    else reasons.push('Declared unavailable for this date')
    if (c.preferred_event) { score += weights.preference; reasons.push('Applied for this examination') }
    if (c.preferred_position_ids.includes(position.id)) { score += weights.position; reasons.push(`Prefers ${position.name}`) }
    if (centerId && c.preferred_center_ids.includes(centerId)) { score += weights.position / 3; reasons.push('Prefers this center') }
    if (c.license_verified) { score += weights.qualification; reasons.push('Verified PRC license') }
    if (c.has_training) { score += weights.qualification / 2; reasons.push('Has relevant training') }
    if (c.has_experience || c.prior_completed > 0) { score += weights.experience; reasons.push(c.prior_completed > 0 ? `${c.prior_completed} completed prior assignment(s)` : 'Relevant experience declared') }
    if (c.prior_total > 0) {
      const reliability = (c.prior_total - c.prior_no_show) / c.prior_total
      score += weights.reliability * reliability
      reasons.push(c.prior_no_show > 0 ? `${c.prior_no_show} no-show(s) in ${c.prior_total} verified assignment(s)` : 'No recorded no-shows')
    }
    const fairness = 1 - c.recent_assignments / (maxRecent + 1)
    score += weights.fairness * fairness
    if (c.recent_assignments === 0) reasons.push('No assignments in the last 12 months (fair distribution)')
    else reasons.push(`${c.recent_assignments} assignment(s) in the last 12 months`)
    score += weights.shortage * vacancyRatio
    return { candidate: c, score: Math.round(score * 10) / 10, reasons, eligible: blockedBy.length === 0, blockedBy }
  })
  return out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.candidate.full_name.localeCompare(b.candidate.full_name))
}
