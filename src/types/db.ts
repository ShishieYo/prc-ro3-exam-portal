// Row shapes used by the UI (kept in sync with supabase/migrations by hand).
export interface Profession { id: string; code: string; name: string; active: boolean }
export interface Center { id: string; name: string; province: string | null; city_municipality: string | null; address: string | null; active: boolean }
export interface Building { id: string; center_id: string; name: string; active: boolean }
export interface Floor { id: string; building_id: string; label: string; level_no: number }
export interface Room { id: string; floor_id: string; name: string; capacity: number | null; active: boolean }
export interface Position {
  id: string; name: string; description: string | null; personnel_type: 'volunteer' | 'prc_staff' | 'pnp' | 'other_external'
  requires_registered_professional: boolean; requires_verified_license: boolean; required_training: string | null; default_headcount: number
  min_staffing: number | null; max_staffing: number | null; allowance_eligible: boolean; cpd_eligible: boolean; attendance_verification_required: boolean
  sort_order: number; active: boolean
}
export interface ExamEvent {
  id: string; event_no: string; name: string; profession_id: string | null; exam_type: string | null; start_date: string | null; end_date: string | null
  recruitment_open: string | null; recruitment_close: string | null; confirmation_deadline: string | null; status: string; staffing_target: number | null
  supervisor_id: string | null; instructions: string | null; internal_remarks: string | null; created_at: string; updated_at: string
  professions?: { name: string } | null
}
export interface ExamDate { id: string; event_id: string; exam_date: string; report_time: string | null; start_time: string | null; end_time: string | null; notes: string | null }
export interface EventSite { id: string; event_id: string; center_id: string; building_id: string | null }
export interface StaffingRequirement {
  id: string; event_id: string; exam_date_id: string | null; center_id: string; building_id: string | null; floor_id: string | null; room_id: string | null
  position_id: string; required_count: number; notes: string | null
}
export interface StaffingRow {
  requirement_id: string; event_id: string; exam_date_id: string | null; center_id: string; building_id: string | null; floor_id: string | null; room_id: string | null
  position_id: string; required_count: number; assigned_count: number; confirmed_count: number; awaiting_count: number; vacant_count: number
}
export interface VolunteerProfile {
  id: string; user_id: string; volunteer_no: string; last_name: string | null; first_name: string | null; middle_name: string | null; name_extension: string | null
  preferred_name: string | null; date_of_birth: string | null; sex: string | null; mobile_no: string | null; alt_contact_no: string | null; address: string | null
  city_municipality: string | null; province: string | null; emergency_name: string | null; emergency_relationship: string | null; emergency_contact_no: string | null
  is_registered_professional: boolean | null; experience_notes: string | null; prior_assignments_notes: string | null; skills: string | null
  training_certifications: string | null; verification_status: string; verified_at: string | null; verification_remarks: string | null; created_at: string; updated_at: string
  profiles?: { email: string; account_status: string; email_verified_at: string | null } | null
}
export interface Credential {
  id: string; volunteer_id: string; profession_id: string; license_no: string; initial_registration_date: string | null; expiry_date: string | null
  registration_status: string | null; verification_status: string; verified_at: string | null; verification_remarks: string | null; professions?: { name: string } | null
  volunteer_profiles?: { last_name: string | null; first_name: string | null; volunteer_no: string } | null
}
export interface Employment { volunteer_id: string; is_employed: boolean; employer_name: string | null; employer_address: string | null; position: string | null; sector: string | null }
export interface DocRequirement {
  id: string; code: string; name: string; description: string | null; required_for_assignment: boolean; required_for_allowance: boolean
  registered_professional_only: boolean; allowed_mime_types: string[]; max_size_mb: number; valid_for_days: number | null; sort_order: number; active: boolean
}
export interface VolunteerDoc {
  id: string; volunteer_id: string; requirement_id: string; storage_path: string; file_name: string; mime_type: string; size_bytes: number
  status: string; effective_status: string; expires_on: string | null; review_reason: string | null; reviewed_at: string | null; submitted_at: string
}
export interface Preference {
  id: string; volunteer_id: string; event_id: string; rank: number; preferred_position_ids: string[]; preferred_center_ids: string[]
  status: string; remarks: string | null; staff_remarks: string | null; submitted_at: string
  examination_events?: ExamEvent | null; volunteer_profiles?: VolunteerProfile | null
}
export interface RosterRow {
  id: string; assignment_no: string; event_id: string; event_name: string; exam_date_id: string; exam_date: string; personnel_category: string
  volunteer_id: string | null; external_id: string | null; person_name: string; person_no: string | null; position_id: string; position_name: string
  center_id: string; center_name: string; building_id: string | null; building_name: string | null; floor_id: string | null; floor_label: string | null
  room_id: string | null; room_name: string | null; report_time: string | null; expected_end_time: string | null; status: string
  volunteer_response: string | null; confirmed_at: string | null; remarks: string | null; requirement_id: string | null; created_at: string
}
export interface ExternalPerson {
  id: string; ext_no: string; full_name: string; category: 'pnp' | 'other_external'; rank_position: string | null; agency_unit: string | null
  contact_info: string | null; allowance_eligible: boolean; remarks: string | null; active: boolean; created_at: string
}
export interface AttendanceRow {
  id: string; assignment_id: string; event_id: string; exam_date_id: string; check_in_at: string | null; check_out_at: string | null
  status: string; verification_status: string; remarks: string | null; discrepancy_reason: string | null; verified_at: string | null
  assignments?: { person_name: string; person_no: string | null; personnel_category: string; assignment_positions: { name: string } | null; report_time: string | null; status: string } | null
  examination_dates?: { exam_date: string } | null
}
export interface AllowanceRow {
  id: string; record_no: string; assignment_id: string; event_id: string; event_name: string; payee_name: string; personnel_category: string
  position_name: string; duty_date: string; approved_amount: number | null; currency: string; eligibility_status: string; processing_status: string
  payment_status: string; requirements_note: string | null; remarks: string | null; needs_review: boolean; review_note: string | null
  total_paid: number; balance: number; payment_date: string | null; payment_reference: string | null; voucher_ref: string | null; rule_version: number | null
}
export interface PaymentRow { id: string; allowance_id: string; amount: number; paid_on: string; reference_no: string; batch_ref: string | null; status: string; remarks: string | null; exception_reason: string | null; return_reason: string | null; created_at: string }
export interface CpdRow {
  id: string; record_no: string; volunteer_id: string; volunteer_name: string; license_ref: string | null; event_id: string; event_name: string
  position_name: string; profession_name: string | null; service_date: string; rule_version: number | null; units_proposed: number; units_approved: number
  status: string; remarks: string | null; needs_review: boolean; review_note: string | null; certificate_ref: string | null; approved_at: string | null
}
export interface NotificationRow { id: string; category: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }
