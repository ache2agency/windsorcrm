import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import RevisionInscripcion from './RevisionInscripcion'
export const metadata = { title: 'Revisar inscripción · Windsor', robots: { index: false, follow: false }, referrer: 'no-referrer' as const }
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user) redirect('/login')
  return <RevisionInscripcion id={(await params).id} />
}
