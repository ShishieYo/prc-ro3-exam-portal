import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/auth/AuthProvider'
import { supabase, unwrap } from '@/lib/supabase'
import type { VolunteerProfile } from '@/types/db'

/** The signed-in user's own volunteer profile (every account has one; staff-only accounts leave it empty). */
export function useMyVolunteer() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['me', 'volunteer', session?.user.id],
    enabled: !!session,
    queryFn: async () => unwrap(await supabase.from('volunteer_profiles').select('*').eq('user_id', session!.user.id).single()) as VolunteerProfile,
  })
}
