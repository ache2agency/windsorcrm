import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { ETAPAS_KANBAN, normalizarEtapa, etapaParaFase, etapaTrasBot, etapaMigrada } from '../lib/crm/kanban'
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
  for (const [i, desde] of ETAPAS_KANBAN.entries()) for (const hasta of ETAPAS_KANBAN) {
    const r = etapaTrasBot(desde.id,hasta.id,'Inglés para adultos')
    assert.ok(ETAPAS_KANBAN.findIndex(e => e.id === r) >= i)
    if (['inscrito','perdido'].includes(hasta.id) || ['inscrito','perdido'].includes(desde.id)) assert.equal(r,desde.id)
  }
  assert.equal(etapaTrasBot('inscripcion_pendiente','segundo_contacto','Diplomado en Epidemiología'),'inscripcion_pendiente')
  assert.equal(etapaTrasBot('inscripcion_pendiente','archivado','Inglés para niños'),'inscripcion_pendiente')
  assert.equal(etapaTrasBot('primer_contacto','examen_ubicacion','Psicología'),'primer_contacto')
})
test('migración conserva avance, combina fase y respeta terminales', () => {
  assert.equal(etapaMigrada({stage:'contactado'},'accion'),'segundo_contacto')
  assert.equal(etapaMigrada({stage:'inscripcion_pendiente'},'dudas'),'inscripcion_pendiente')
  assert.equal(etapaMigrada({stage:'inscrito'},'perdido'),'inscrito')
  assert.equal(etapaMigrada({stage:'perdido'},'accion'),'perdido')
  assert.equal(etapaMigrada({stage:'cerrado'},'correo'),'archivado')
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
