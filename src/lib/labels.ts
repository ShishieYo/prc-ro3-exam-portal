import { titleCase } from './format'

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand'

const TONES: Record<string, Tone> = {
  // generic positive / negative
  active: 'success', verified: 'success', approved: 'success', paid: 'success', confirmed: 'success', completed: 'success', released: 'success',
  present: 'success', eligible: 'success', open_for_registration: 'info', fully_staffed: 'success',
  pending: 'warning', submitted: 'info', under_review: 'info', for_validation: 'warning', for_approval: 'warning', awaiting_volunteer_confirmation: 'warning',
  offered: 'info', pending_approval: 'warning', for_cpd_review: 'warning', pending_attendance_verification: 'warning', partially_paid: 'info',
  processing: 'info', for_processing: 'info', ready_for_payment: 'info', shortlisted: 'info', late: 'warning', for_review: 'warning',
  partially_completed: 'warning', pending_requirements: 'warning', requirements_incomplete: 'warning', awaiting_confirmation: 'warning',
  partially_staffed: 'warning', understaffed: 'danger', unassigned: 'danger',
  rejected: 'danger', declined: 'danger', disapproved: 'danger', cancelled: 'danger', suspended: 'danger', absent: 'danger', no_show: 'danger',
  requires_resubmission: 'danger', expired: 'danger', on_hold: 'danger', returned_failed: 'danger', revoked_corrected: 'danger', voided: 'danger', not_eligible: 'neutral',
  draft: 'neutral', unverified: 'neutral', not_yet_paid: 'neutral', not_yet_recorded: 'neutral', not_evaluated: 'neutral', waitlisted: 'neutral',
  archived: 'neutral', withdrawn: 'neutral', reassigned: 'neutral', excused: 'neutral', not_submitted: 'neutral',
  under_staffing: 'brand', assignments_released: 'brand', ready_for_deployment: 'brand', ongoing: 'brand', assigned: 'success',
}

export function toneOf(status: string | null | undefined): Tone {
  return TONES[status ?? ''] ?? 'neutral'
}

export function statusLabel(status: string | null | undefined): string {
  return titleCase(status)
}

export const ROLE_LABEL: Record<string, string> = {
  volunteer: 'Volunteer',
  admin: 'PRC Administrator',
  system_admin: 'System Administrator',
  coordinator: 'Examination Personnel Coordinator',
  attendance_officer: 'Attendance / Operations Officer',
  finance_officer: 'Finance / Allowance Officer',
  cpd_officer: 'CPD / Participation Records Officer',
  supervisor: 'Examination Supervisor',
  auditor: 'Read-only Management / Auditor',
}
