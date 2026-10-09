export type StaffingIndicator = 'fully_staffed' | 'partially_staffed' | 'understaffed' | 'awaiting_confirmation' | 'unassigned'

export interface StaffingCounts { required_count: number; assigned_count: number; confirmed_count: number }

/** Indicator derived from actual counts (never hard-coded). */
export function staffingIndicator(c: StaffingCounts): StaffingIndicator {
  if (c.assigned_count === 0) return 'unassigned'
  if (c.confirmed_count >= c.required_count) return 'fully_staffed'
  if (c.assigned_count >= c.required_count) return 'awaiting_confirmation'
  if (c.assigned_count * 2 < c.required_count) return 'understaffed'
  return 'partially_staffed'
}

export const INDICATOR_LABEL: Record<StaffingIndicator, string> = {
  fully_staffed: 'Fully staffed',
  partially_staffed: 'Partially staffed',
  understaffed: 'Understaffed',
  awaiting_confirmation: 'Awaiting confirmation',
  unassigned: 'Unassigned',
}
