import {
  LayoutDashboard, UserRound, Search, CalendarDays, ClipboardList, BriefcaseBusiness, Clock, Banknote, Award, Bell, Settings,
  Users, FileCheck2, BadgeCheck, CalendarRange, Building2, ListChecks, Inbox, KanbanSquare, Table2, Shield, CheckCheck, Wallet, Receipt,
  Medal, FileBarChart, Megaphone, Upload, UserCog, ScrollText, SlidersHorizontal, type LucideIcon,
} from 'lucide-react'

export interface NavItem { label: string; to: string; icon: LucideIcon; any?: string[]; end?: boolean }
export interface NavGroup { title: string; items: NavItem[]; volunteer?: boolean }

export const NAV: NavGroup[] = [
  {
    title: 'My Volunteer Portal', volunteer: true,
    items: [
      { label: 'Dashboard', to: '/home', icon: LayoutDashboard, end: true },
      { label: 'My Profile', to: '/profile', icon: UserRound },
      { label: 'Opportunities', to: '/opportunities', icon: Search },
      { label: 'Calendar', to: '/calendar', icon: CalendarDays },
      { label: 'My Preferences', to: '/preferences', icon: ClipboardList },
      { label: 'My Assignments', to: '/assignments', icon: BriefcaseBusiness },
      { label: 'My Attendance', to: '/attendance', icon: Clock },
      { label: 'My Allowances', to: '/allowances', icon: Banknote },
      { label: 'My CPD Records', to: '/cpd', icon: Award },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Management Dashboard', to: '/admin', icon: LayoutDashboard, any: ['reports.view'], end: true },
      { label: 'Volunteer Directory', to: '/admin/volunteers', icon: Users, any: ['volunteers.view'] },
      { label: 'Document Review', to: '/admin/documents', icon: FileCheck2, any: ['documents.review'] },
      { label: 'Credential Verification', to: '/admin/credentials', icon: BadgeCheck, any: ['credentials.verify', 'credentials.view'] },
      { label: 'Examination Events', to: '/admin/events', icon: CalendarRange, any: ['events.view_all', 'assignments.view_scoped'] },
      { label: 'Exam Calendar', to: '/admin/calendar', icon: CalendarDays, any: ['events.view_all'] },
      { label: 'Venues', to: '/admin/venues', icon: Building2, any: ['venues.manage', 'events.manage'] },
      { label: 'Positions', to: '/admin/positions', icon: ListChecks, any: ['positions.manage', 'events.manage'] },
      { label: 'Preferences & Availability', to: '/admin/preferences', icon: Inbox, any: ['preferences.view'] },
      { label: 'Assignment Planning Board', to: '/admin/planning', icon: KanbanSquare, any: ['assignments.manage'] },
      { label: 'Assignment Roster', to: '/admin/roster', icon: Table2, any: ['assignments.view', 'assignments.view_scoped'] },
      { label: 'PNP / External Personnel', to: '/admin/external', icon: Shield, any: ['external.view'] },
      { label: 'Attendance', to: '/admin/attendance', icon: CheckCheck, any: ['attendance.view', 'attendance.view_scoped', 'attendance.record'] },
    ],
  },
  {
    title: 'Allowances',
    items: [
      { label: 'Allowance Monitoring', to: '/admin/allowances', icon: Wallet, any: ['allowance.view'], end: true },
      { label: 'Approval & Processing', to: '/admin/allowances/processing', icon: Receipt, any: ['allowance.process', 'allowance.approve'] },
      { label: 'Payment Transactions', to: '/admin/payments', icon: Banknote, any: ['allowance.view'] },
    ],
  },
  {
    title: 'CPD',
    items: [
      { label: 'CPD Monitoring', to: '/admin/cpd', icon: Medal, any: ['cpd.view'], end: true },
      { label: 'CPD Review & Approval', to: '/admin/cpd/review', icon: BadgeCheck, any: ['cpd.review', 'cpd.approve', 'cpd.adjust'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Reports & Exports', to: '/admin/reports', icon: FileBarChart, any: ['reports.view'] },
      { label: 'Announcements', to: '/admin/announcements', icon: Megaphone, any: ['announcements.send'] },
      { label: 'Imports', to: '/admin/imports', icon: Upload, any: ['imports.manage'] },
      { label: 'Users & Roles', to: '/admin/users', icon: UserCog, any: ['users.manage'] },
      { label: 'Audit Logs', to: '/admin/audit', icon: ScrollText, any: ['audit.view'] },
      { label: 'System Settings', to: '/admin/settings', icon: SlidersHorizontal, any: ['settings.manage', 'allowance.rules.manage', 'cpd.rules.manage'] },
    ],
  },
  {
    title: 'Account',
    volunteer: false,
    items: [
      { label: 'Notifications', to: '/notifications', icon: Bell },
      { label: 'Account Settings', to: '/settings', icon: Settings },
    ],
  },
]

export const CRUMBS: Record<string, string> = {
  admin: 'Administration', volunteers: 'Volunteers', documents: 'Document Review', credentials: 'Credentials', events: 'Examination Events',
  calendar: 'Calendar', venues: 'Venues', positions: 'Positions', preferences: 'Preferences', planning: 'Planning Board', roster: 'Roster',
  external: 'External Personnel', attendance: 'Attendance', allowances: 'Allowances', processing: 'Processing', payments: 'Payments', cpd: 'CPD',
  review: 'Review', reports: 'Reports', announcements: 'Announcements', imports: 'Imports', users: 'Users & Roles', audit: 'Audit Logs',
  settings: 'Settings', profile: 'My Profile', professional: 'Professional', employment: 'Employment', allowance: 'Allowance Info',
  opportunities: 'Opportunities', assignments: 'Assignments', notifications: 'Notifications', new: 'New',
}
