import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RequirePermission } from '@/auth/guards'
import { AttendanceManagement } from './attendance'
import { CpdMonitoring, CpdReview } from './cpd'
import { ManagementDashboard } from './dashboard'
import { AdminCalendar, EventDetail, EventList, EventNew } from './events'
import { ExternalPersonnel, ImportsPage } from './external'
import { AllowanceMonitoring, AllowanceProcessing, PaymentTransactions } from './finance'
import { PlanningBoard, PreferencesReview, Roster } from './planning'
import { Announcements, AuditLogs, Reports, SettingsPage, UsersPage } from './system'
import { PositionsPage, Venues } from './venues'
import { CredentialQueue, DocumentQueue, VolunteerDirectory, VolunteerReview } from './volunteers'

const P = (any: string[], el: ReactNode) => <RequirePermission any={any}>{el}</RequirePermission>

/** All staff routes. Each is guarded in the UI; the database enforces the same permissions with RLS. */
export default function AdminRoutes() {
  return (
    <Routes>
      <Route index element={P(['reports.view'], <ManagementDashboard />)} />
      <Route path="volunteers" element={P(['volunteers.view'], <VolunteerDirectory />)} />
      <Route path="volunteers/:id" element={P(['volunteers.view'], <VolunteerReview />)} />
      <Route path="documents" element={P(['documents.review'], <DocumentQueue />)} />
      <Route path="credentials" element={P(['credentials.verify', 'credentials.view'], <CredentialQueue />)} />
      <Route path="events" element={P(['events.view_all', 'assignments.view_scoped'], <EventList />)} />
      <Route path="events/new" element={P(['events.manage'], <EventNew />)} />
      <Route path="events/:id" element={P(['events.view_all', 'assignments.view_scoped'], <EventDetail />)} />
      <Route path="calendar" element={P(['events.view_all'], <AdminCalendar />)} />
      <Route path="venues" element={P(['venues.manage', 'events.manage'], <Venues />)} />
      <Route path="positions" element={P(['positions.manage', 'events.manage'], <PositionsPage />)} />
      <Route path="preferences" element={P(['preferences.view'], <PreferencesReview />)} />
      <Route path="planning" element={P(['assignments.manage'], <PlanningBoard />)} />
      <Route path="roster" element={P(['assignments.view', 'assignments.view_scoped'], <Roster />)} />
      <Route path="external" element={P(['external.view'], <ExternalPersonnel />)} />
      <Route path="attendance" element={P(['attendance.view', 'attendance.view_scoped', 'attendance.record'], <AttendanceManagement />)} />
      <Route path="allowances" element={P(['allowance.view'], <AllowanceMonitoring />)} />
      <Route path="allowances/processing" element={P(['allowance.process', 'allowance.approve'], <AllowanceProcessing />)} />
      <Route path="payments" element={P(['allowance.view'], <PaymentTransactions />)} />
      <Route path="cpd" element={P(['cpd.view'], <CpdMonitoring />)} />
      <Route path="cpd/review" element={P(['cpd.review', 'cpd.approve', 'cpd.adjust'], <CpdReview />)} />
      <Route path="reports" element={P(['reports.view'], <Reports />)} />
      <Route path="announcements" element={P(['announcements.send'], <Announcements />)} />
      <Route path="imports" element={P(['imports.manage'], <ImportsPage />)} />
      <Route path="users" element={P(['users.manage'], <UsersPage />)} />
      <Route path="audit" element={P(['audit.view'], <AuditLogs />)} />
      <Route path="settings" element={P(['settings.manage', 'allowance.rules.manage', 'cpd.rules.manage'], <SettingsPage />)} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  )
}
