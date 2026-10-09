# Email and notifications
In-app notifications are the only channel the application sends. The database never sends email or SMS, and the UI never claims it did. Supabase Auth sends verification/reset emails through the project's configured SMTP provider.

Suggested templates for a future provider (to be wired through an Edge Function with a verified sender): *Assignment offered* ("{event}: you have an assignment offer; confirm by {deadline}"), *Assignment changed/cancelled*, *Reporting reminder*, *Document needs resubmission*, *Allowance status changed*, *CPD record decision*. Notification preferences (`notification_preferences.email`) are stored for that purpose but have no effect yet.
