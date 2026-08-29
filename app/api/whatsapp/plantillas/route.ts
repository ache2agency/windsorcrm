import { fetchApprovedTemplates } from '@/lib/whatsapp/provider'

export const dynamic = 'force-dynamic'

export async function GET() {
  const templates = await fetchApprovedTemplates()
  return Response.json({ templates })
}
