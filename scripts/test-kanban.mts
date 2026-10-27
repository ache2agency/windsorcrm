import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { ETAPAS_KANBAN, normalizarEtapa, etapaParaFase, etapaTrasBot, etapaMigrada } from '../lib/crm/kanban'
import { intentarAvanzarEtapaBot } from '../lib/crm/etapas-bot'
import { autorDeSesion } from '../lib/crm/autoria'

test('siete columnas y qué esperamos, en el orden del mapa', () => {
  assert.deepEqual(ETAPAS_KANBAN.map(e => e.label), ['Nuevo','Informado','Agendado','Inscribiéndose','Inscrito','Archivado','Perdido'])
  assert.ok(ETAPAS_KANBAN.every(e => e.esperamos))
})
test('mapeo de todas las etapas antiguas y cerrado sin falso Inscrito', () => {
  for (const stage of ['nuevo','contactado','primer_contacto',null]) assert.equal(normalizarEtapa(stage), 'primer_contacto')
  for (const stage of ['interesado','promocion_enviada','tercer_contacto','segundo_contacto']) assert.equal(normalizarEtapa(stage), 'segundo_contacto')
  assert.equal(normalizarEtapa('clase_muestra'),'examen_ubicacion')
  assert.equal(normalizarEtapa('propuesta'),'inscripcion_pendiente')
  assert.equal(normalizarEtapa('cerrado'),'archivado')
})
test('fases del mapa, idiomas y fases que no promueven', () => {
  for (const f of ['saludo','programa','correo']) assert.equal(etapaParaFase(f),'primer_contacto')
  for (const f of ['info_enviada','accion','dudas']) assert.equal(etapaParaFase(f),'segundo_contacto')
  for (const f of ['inscripcion','inscripcion_pendiente','inscribiendo']) assert.equal(etapaParaFase(f),'inscripcion_pendiente')
  for (const curso of ['Inglés para niños','Francés','Italiano','Cursos de verano niños']) assert.equal(etapaParaFase('clase_prueba',curso),'examen_ubicacion')
  for (const curso of ['Psicología','Diplomado en Epidemiología','Licenciatura en Inglés']) assert.equal(etapaParaFase('examen',curso),'segundo_contacto')
  for (const f of ['pendiente','asesor','con_asesor','vacante','nota','inscrito']) assert.equal(etapaParaFase(f),null)
})
test('matriz del bot: nunca retrocede, ni marca Inscrito/Perdido, ni deshace cierre humano', () => {
  const ordenActivo = ['primer_contacto','segundo_contacto','examen_ubicacion','inscripcion_pendiente']
  for (const desde of ETAPAS_KANBAN) for (const hasta of ETAPAS_KANBAN) {
    const r = etapaTrasBot(desde.id,hasta.id,'Inglés para adultos')
    if (['inscrito','perdido'].includes(hasta.id) || ['inscrito','perdido'].includes(desde.id)) assert.equal(r,desde.id)
    if (ordenActivo.includes(desde.id) && ordenActivo.includes(hasta.id)) assert.ok(ordenActivo.indexOf(r) >= ordenActivo.indexOf(desde.id))
  }
  assert.equal(etapaTrasBot('inscripcion_pendiente','segundo_contacto','Diplomado en Epidemiología'),'inscripcion_pendiente')
  assert.equal(etapaTrasBot('inscripcion_pendiente','archivado','Inglés para niños'),'inscripcion_pendiente')
  assert.equal(etapaTrasBot('primer_contacto','examen_ubicacion','Psicología'),'primer_contacto')
  assert.equal(etapaTrasBot('archivado','inscripcion_pendiente','Inglés para niños'),'inscripcion_pendiente')
  assert.equal(etapaTrasBot('archivado','segundo_contacto','Diplomado en Epidemiología'),'segundo_contacto')
  assert.equal(etapaTrasBot('archivado','examen_ubicacion','Francés'),'examen_ubicacion')
  assert.equal(etapaTrasBot('archivado','examen_ubicacion','Psicología'),'archivado')
  assert.equal(etapaTrasBot('archivado','perdido','Francés'),'archivado')
})
test('migración conserva avance, combina fase y respeta terminales', () => {
  assert.equal(etapaMigrada({stage:'contactado'},'accion'),'segundo_contacto')
  assert.equal(etapaMigrada({stage:'inscripcion_pendiente'},'dudas'),'inscripcion_pendiente')
  assert.equal(etapaMigrada({stage:'inscrito'},'perdido'),'inscrito')
  assert.equal(etapaMigrada({stage:'perdido'},'accion'),'perdido')
  assert.equal(etapaMigrada({stage:'cerrado'},'correo'),'primer_contacto')
  assert.equal(etapaMigrada({stage:'archivado'},'inscribiendo'),'inscripcion_pendiente')
  assert.equal(etapaMigrada({stage:'clase_muestra',curso:'Psicología'},'clase_prueba'),'segundo_contacto')
})
test('autor del mensaje proviene de la sesión y perfil, no del asignado ni de un envío interno', async t => {
  const db = createClient('https://kanban-test.supabase.co','fake',{auth:{persistSession:false}})
  let role = 'vendedor', nombre = 'Ana Demo', calls = 0
  t.mock.method(globalThis,'fetch',async (input: any, init?: RequestInit) => {
    const req = new Request(input,init), url = new URL(req.url)
    assert.equal(req.method,'GET'); assert.equal(url.hostname,'kanban-test.supabase.co')
    assert.equal(url.searchParams.get('id'),'eq.asesor-de-la-sesion')
    calls++; return Response.json({id:'asesor-de-la-sesion',rol:role,nombre,email:'demo@example.test'})
  })
  assert.deepEqual(await autorDeSesion(db,'asesor-de-la-sesion'),{enviado_por:'asesor-de-la-sesion',enviado_por_nombre:'Ana Demo'})
  nombre = 'Nombre Nuevo'
  assert.equal((await autorDeSesion(db,'asesor-de-la-sesion')).enviado_por_nombre,'Nombre Nuevo')
  role = 'alumno'; await assert.rejects(autorDeSesion(db,'asesor-de-la-sesion'),/autorizado/)
  const before = calls
  assert.deepEqual(await autorDeSesion(db,null),{enviado_por:null,enviado_por_nombre:'Sistema (envío interno)'})
  assert.equal(calls,before)
})

test('fallo de RPC registra actividad y permite que el flujo continúe', async t => {
  const db = createClient('https://kanban-test.supabase.co','fake',{auth:{persistSession:false}})
  const llamadas: string[] = []
  t.mock.method(console,'error',()=>{})
  t.mock.method(globalThis,'fetch',async (input: any, init?: RequestInit) => {
    const req = new Request(input,init), url = new URL(req.url)
    llamadas.push(`${req.method} ${url.pathname}`)
    if (url.pathname.endsWith('/rpc/avanzar_etapa_bot')) return Response.json({message:'RPC no disponible'},{status:503})
    if (url.pathname.endsWith('/lead_activities')) return Response.json([], {status:201})
    return Response.json({message:'inesperado'},{status:500})
  })
  assert.equal(await intentarAvanzarEtapaBot(db,'lead-ficticio','segundo_contacto'),null)
  assert.deepEqual(llamadas,['POST /rest/v1/rpc/avanzar_etapa_bot','POST /rest/v1/lead_activities'])
})
