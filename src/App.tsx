import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'
import { RequireAuth } from '@/auth/guards'
import { Spinner } from '@/components/ui/ui'
import { useMyVolunteer } from '@/hooks/useMyVolunteer'
import { AppLayout } from '@/layout/AppLayout'
import { Landing } from '@/pages/public/Landing'
import { AccountBlocked, ForgotPassword, ResetPassword, VerifyEmail } from '@/pages/public/Misc'
import { Privacy } from '@/pages/public/Privacy'
import { Register } from '@/pages/public/Register'
import { SignIn } from '@/pages/public/SignIn'
import { AccountSettings, Notifications } from '@/pages/volunteer/account'
import { VolunteerDashboard } from '@/pages/volunteer/dashboard'
import { MyPreferences, Opportunities, VolunteerCalendar } from '@/pages/volunteer/opportunities'
import { AllowanceStep, DocumentsStep, EmploymentStep, PersonalStep, ProfessionalStep, ProfileLayout } from '@/pages/volunteer/profile'
import { AssignmentDetail, MyAllowances, MyAssignments, MyAttendance, MyCpd } from '@/pages/volunteer/records'

const AdminRoutes = lazy(() => import('@/pages/admin/routes'))

/** Staff-only accounts land on the management dashboard; everyone else on the volunteer dashboard. */
function Home() {
  const { isStaff, canAny } = useAuth()
  const { data: vol, isLoading } = useMyVolunteer()
  if (isLoading) return <Spinner />
  if (isStaff && !vol?.last_name && canAny(['reports.view'])) return <Navigate to="/admin" replace />
  return <VolunteerDashboard />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RequireAuthOrLanding />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/account-blocked" element={<AccountBlocked />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="/home" element={<Home />} />
        <Route path="profile" element={<ProfileLayout />}>
          <Route index element={<PersonalStep />} />
          <Route path="professional" element={<ProfessionalStep />} />
          <Route path="employment" element={<EmploymentStep />} />
          <Route path="allowance" element={<AllowanceStep />} />
          <Route path="documents" element={<DocumentsStep />} />
        </Route>
        <Route path="opportunities" element={<Opportunities />} />
        <Route path="calendar" element={<VolunteerCalendar />} />
        <Route path="preferences" element={<MyPreferences />} />
        <Route path="assignments" element={<MyAssignments />} />
        <Route path="assignments/:id" element={<AssignmentDetail />} />
        <Route path="attendance" element={<MyAttendance />} />
        <Route path="allowances" element={<MyAllowances />} />
        <Route path="cpd" element={<MyCpd />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<AccountSettings />} />
        <Route path="admin/*" element={<Suspense fallback={<Spinner />}><AdminRoutes /></Suspense>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

/** Public landing for visitors; signed-in users go to their home screen. */
function RequireAuthOrLanding() {
  const { loading, session } = useAuth()
  if (loading) return <Spinner />
  return session ? <Navigate to="/home" replace /> : <Landing />
}
