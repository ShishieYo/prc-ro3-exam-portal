import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui/ui'
import { Brand } from '@/layout/Brand'

export function Privacy() {
  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-line bg-white px-4 py-3"><Link to="/"><Brand /></Link></header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-8 text-sm leading-relaxed">
        <h1 className="text-xl font-semibold text-navy-900">Privacy Notice and Terms of Use</h1>
        <Alert tone="warning" title="Draft pending legal review">
          This notice is a working draft prepared for the portal. PRC must have it reviewed by its Data Protection Officer, legal office and records management
          before production use. Technical safeguards in this portal do not by themselves establish compliance with the Data Privacy Act of 2012 (RA 10173).
        </Alert>
        <section><h2 className="font-semibold text-navy-900">1. Purpose</h2>
          <p>PRC Regional Office III collects and processes the information you provide to register you as volunteer examination personnel, evaluate your qualifications, assign you to licensure examinations, record your attendance, process any applicable allowance and record your participation for CPD purposes.</p></section>
        <section><h2 className="font-semibold text-navy-900">2. Information collected</h2>
          <p>Identity and contact details, emergency contact, professional registration details, employment information, supporting documents, and — only for allowance processing — your TIN and LandBank account details. Only information with an identified operational or legal purpose is requested.</p></section>
        <section><h2 className="font-semibold text-navy-900">3. Access and protection</h2>
          <p>Access is limited by role. TIN and bank details are masked by default and visible only to authorised finance personnel for a stated purpose; each such access is logged. Documents are stored privately. Privileged actions are recorded in an audit trail.</p></section>
        <section><h2 className="font-semibold text-navy-900">4. Sharing and retention</h2>
          <p>Information is used within PRC for the purposes above and is not published. Retention periods follow PRC and government records policies (configured in the portal and subject to PRC approval).</p></section>
        <section><h2 className="font-semibold text-navy-900">5. Your rights</h2>
          <p>You may request access to, correction of, or deletion of your personal data, subject to legal retention requirements, by contacting PRC Regional Office III or its Data Protection Officer.</p></section>
        <section><h2 className="font-semibold text-navy-900">6. Terms of use</h2>
          <p>Submitting an examination preference is not an assignment. You may not assign yourself, alter attendance, payment or CPD records. CPD units shown are recorded by this portal from verified participation and are subject to approval; they are not your complete PRC CPD balance. Misuse may result in suspension of your account.</p></section>
        <p><Link to="/register" className="font-medium text-prc-600 hover:underline">Back to registration</Link></p>
      </main>
    </div>
  )
}
