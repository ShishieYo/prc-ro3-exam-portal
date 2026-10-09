import { useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { activeBadge, CrudCard, yesNo, type FieldDef } from '@/components/CrudCard'
import { Alert, PageHeader } from '@/components/ui/ui'

export function Venues() {
  const { can } = useAuth()
  const edit = can('venues.manage')
  const [center, setCenter] = useState<string | null>(null)
  const [building, setBuilding] = useState<string | null>(null)
  const [floor, setFloor] = useState<string | null>(null)
  return (
    <div className="space-y-4">
      <PageHeader title="Examination Centers, Buildings, Floors and Rooms" description="Select a row to drill down. These are reusable across examination events." />
      {!edit && <Alert tone="info">You have read-only access to venue data.</Alert>}
      <CrudCard title="Examination centers" table="examination_centers" orderBy="name" canEdit={edit} canDelete selectedId={center} onSelect={(r) => { setCenter(r.id); setBuilding(null); setFloor(null) }}
        fields={[{ name: 'name', label: 'Center / school name', required: true }, { name: 'province', label: 'Province' }, { name: 'city_municipality', label: 'City / municipality' }, { name: 'address', label: 'Address', type: 'textarea' }, { name: 'active', label: 'Active', type: 'checkbox', default: true }] as FieldDef[]}
        columns={[{ header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span> }, { header: 'City / municipality', cell: (r) => r.city_municipality }, { header: 'Province', cell: (r) => r.province }, { header: 'Status', cell: (r) => activeBadge(r.active) }]} />
      <div className="grid gap-4 lg:grid-cols-3">
        <CrudCard title="Buildings" table="buildings" orderBy="name" filter={{ column: 'center_id', value: center }} fixed={{ center_id: center }} canEdit={edit} canDelete selectedId={building} onSelect={(r) => { setBuilding(r.id); setFloor(null) }} emptyHint="Select a center"
          fields={[{ name: 'name', label: 'Building name', required: true }, { name: 'active', label: 'Active', type: 'checkbox', default: true }]}
          columns={[{ header: 'Name', cell: (r) => r.name }, { header: 'Status', cell: (r) => activeBadge(r.active) }]} />
        <CrudCard title="Floors" table="floors" orderBy="level_no" filter={{ column: 'building_id', value: building }} fixed={{ building_id: building }} canEdit={edit} canDelete selectedId={floor} onSelect={(r) => setFloor(r.id)} emptyHint="Select a building"
          fields={[{ name: 'label', label: 'Floor label (e.g. 2F)', required: true }, { name: 'level_no', label: 'Level number', type: 'number', default: 1 }]}
          columns={[{ header: 'Floor', cell: (r) => r.label }, { header: 'Level', cell: (r) => r.level_no }]} />
        <CrudCard title="Rooms" table="rooms" orderBy="name" filter={{ column: 'floor_id', value: floor }} fixed={{ floor_id: floor }} canEdit={edit} canDelete emptyHint="Select a floor"
          fields={[{ name: 'name', label: 'Room / area', required: true }, { name: 'capacity', label: 'Capacity', type: 'number' }, { name: 'active', label: 'Active', type: 'checkbox', default: true }]}
          columns={[{ header: 'Room', cell: (r) => r.name }, { header: 'Capacity', cell: (r) => r.capacity }, { header: 'Status', cell: (r) => activeBadge(r.active) }]} />
      </div>
    </div>
  )
}

export function PositionsPage() {
  const { can } = useAuth()
  const edit = can('positions.manage')
  const fields: FieldDef[] = [
    { name: 'name', label: 'Position name', required: true }, { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'personnel_type', label: 'Personnel type', type: 'select', required: true, default: 'volunteer', options: [{ value: 'volunteer', label: 'Volunteer' }, { value: 'prc_staff', label: 'PRC staff' }, { value: 'pnp', label: 'PNP' }, { value: 'other_external', label: 'Other external personnel' }] },
    { name: 'default_headcount', label: 'Default headcount', type: 'number', default: 1 }, { name: 'min_staffing', label: 'Minimum staffing', type: 'number' }, { name: 'max_staffing', label: 'Maximum staffing', type: 'number' },
    { name: 'required_training', label: 'Required training / qualifications', type: 'textarea' },
    { name: 'requires_registered_professional', label: 'Requires a registered professional', type: 'checkbox' }, { name: 'requires_verified_license', label: 'Requires a verified PRC license', type: 'checkbox' },
    { name: 'allowance_eligible', label: 'Eligible for volunteer allowance', type: 'checkbox', hint: 'Subject to approved policy' }, { name: 'cpd_eligible', label: 'Eligible for CPD credit', type: 'checkbox', hint: 'Subject to approved policy' },
    { name: 'attendance_verification_required', label: 'Attendance verification required', type: 'checkbox', default: true }, { name: 'sort_order', label: 'Sort order', type: 'number', default: 0 }, { name: 'active', label: 'Active', type: 'checkbox', default: true },
  ]
  return (
    <div>
      <PageHeader title="Positions and Staffing Requirements" description="The assignment position catalog. Allowance and CPD eligibility are configurable per position and are never assumed to be equal." />
      <CrudCard title="Assignment positions" table="assignment_positions" orderBy="sort_order" canEdit={edit} canDelete={false} fields={fields}
        columns={[{ header: 'Position', cell: (r) => <span className="font-medium">{r.name}</span> }, { header: 'Type', cell: (r) => r.personnel_type }, { header: 'Headcount', cell: (r) => r.default_headcount }, { header: 'Registered pro', cell: (r) => yesNo(r.requires_registered_professional) },
          { header: 'Verified license', cell: (r) => yesNo(r.requires_verified_license) }, { header: 'Allowance', cell: (r) => yesNo(r.allowance_eligible) }, { header: 'CPD', cell: (r) => yesNo(r.cpd_eligible) }, { header: 'Status', cell: (r) => activeBadge(r.active) }]} />
    </div>
  )
}
