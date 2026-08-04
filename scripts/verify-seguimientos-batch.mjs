// Verifica que el refactor batch de app/api/seguimientos/route.ts (POST) produce
// EXACTAMENTE las mismas decisiones que el código anterior (N+1), sin escribir nada.
//
// Uso: node scripts/verify-seguimientos-batch.mjs   (desde windsorcrm/)
//
// Estrategia: una sola foto en memoria de todo lo relevante, y dos formas de
// ensamblar los datos por lead a partir de ESA MISMA foto — "batch" (orden total,
// primer visto = más reciente) y "legacy" (filtrar por lead, ordenar con
// NULLS FIRST explícito, tomar el primero — replica exacta de .order().limit(1)
// por lead). Si ambas coinciden para todos los leads, el refactor es un cambio
// puro de performance. Además, una muestra dirigida corre las 4 queries reales
// (una por una, tal cual el código viejo) contra producción para confirmar que
// la réplica en JS de la semántica de Postgres es fiel.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
function getVar(name) {
  const line = env.split('\n').find((l) => l.startsWith(name + '='));
  if (!line) return null;
  let val = line.slice(name.length + 1).trim();
  val = val.replace(/^"|"$/g, '').replace(/\\n$/, '');
  return val;
}

const url = getVar('NEXT_PUBLIC_SUPABASE_URL');
const key = getVar('SUPABASE_SERVICE_ROLE_KEY');
const realSupabase = createClient(url, key);

// ─── Salvaguarda: bloquear cualquier escritura, aunque el script se copie mal ──
const BLOCKED = ['insert', 'update', 'upsert', 'delete'];
function guardQueryBuilder(qb) {
  return new Proxy(qb, {
    get(target, prop) {
      if (BLOCKED.includes(prop)) {
        throw new Error(`[GUARD] Este script es solo lectura — se intentó llamar .${String(prop)}()`);
      }
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}
const supabase = new Proxy(realSupabase, {
  get(target, prop) {
    if (prop === 'from') {
      return (table) => guardQueryBuilder(target.from(table));
    }
    return target[prop];
  },
});

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Copia EXACTA de las constantes/lógica de app/api/seguimientos/route.ts ───
// (si route.ts cambia, actualizar aquí también)

const STAGES_ACTIVOS = [
  'primer_contacto', 'contactado', 'interesado',
  'examen_ubicacion', 'clase_muestra',
  'seguimiento', 'inscripcion_pendiente',
];
const UMBRALES_ESTANDAR = [12, 48, 96, 144, 192];
const UMBRALES_INSCRIPCION = [24, 48, 72, 120, 168];
const TIPOS_POR_TIER = ['mensaje_wa', 'llamada', 'template', 'llamada', 'template'];

function selectTemplate(tier, stage) {
  if (stage === 'inscripcion_pendiente') return 'windsor_inscripcion_pendiente';
  if (tier === 5) return 'windsor_promocion';
  return 'seguimiento_general';
}

function horasDesde(fecha) {
  return (Date.now() - fecha.getTime()) / (1000 * 60 * 60);
}

function decidirSeguimiento(lead, horas, ultimoTier) {
  const nextTier = ultimoTier + 1;
  if (nextTier > 5) {
    return horas > 264 ? { accion: 'cerrado' } : { accion: 'ignorado' };
  }
  const esInscripcion = lead.stage === 'inscripcion_pendiente';
  const umbrales = esInscripcion ? UMBRALES_INSCRIPCION : UMBRALES_ESTANDAR;
  if (horas < umbrales[nextTier - 1]) return { accion: 'saltado' };

  let tipo = TIPOS_POR_TIER[nextTier - 1];
  let contenidoSugerido = null;
  let templateName = null;
  if (tipo === 'mensaje_wa' && horas > 24) tipo = 'template';

  if (tipo === 'mensaje_wa') {
    const nombre = lead.nombre ? ` ${lead.nombre.split(' ')[0]}` : '';
    contenidoSugerido = `Hola${nombre} 👋 ¿Pudiste revisar la información sobre Instituto Windsor? Si tienes alguna duda, con gusto te ayudo 😊`;
  } else if (tipo === 'template') {
    templateName = selectTemplate(nextTier, lead.stage);
    contenidoSugerido = templateName === 'seguimiento_general'
      ? `Hola {{nombre}} 👋 ¿Pudiste revisar la información que te compartimos sobre Instituto Windsor? Si tienes alguna duda, con gusto te ayudamos. 😊`
      : templateName === 'windsor_promocion'
        ? `¡Hola {{nombre}}! 🎉 Tenemos una promoción especial activa para ti. ¿Te gustaría que un asesor te llame para darte los detalles?`
        : `Hola {{nombre}}, notamos que tu inscripción quedó pendiente. ¿Te ayudamos a completarla hoy? 😊`;
  }
  return { accion: 'generado', tier: nextTier, tipo, contenidoSugerido, templateName };
}

const CHUNK = 200;

// ─── 1. Foto única en memoria ──────────────────────────────────────────────

console.log('Trayendo foto de leads activos (paginado)...');
const leads = [];
{
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data: page } = await supabase
      .from('leads')
      .select('id, nombre, whatsapp, curso, stage, asignado_a')
      .in('stage', STAGES_ACTIVOS)
      .not('whatsapp', 'is', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    leads.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }
}

const leadIds = leads.map((l) => l.id);
console.log(`Total leads: ${leadIds.length}`);

let allSeguimientos = [];
for (const chunk of chunkArray(leadIds, CHUNK)) {
  const { data } = await supabase.from('seguimientos').select('lead_id, estado, tier').in('lead_id', chunk);
  allSeguimientos = allSeguimientos.concat(data || []);
}

let allConvs = [];
for (const chunk of chunkArray(leadIds, CHUNK)) {
  const { data } = await supabase.from('whatsapp_conversaciones').select('id, lead_id, ultimo_mensaje_at, fase').in('lead_id', chunk);
  allConvs = allConvs.concat(data || []);
}

const convIds = allConvs.map((c) => c.id);
let allMsgsUsuario = [];
for (const chunk of chunkArray(convIds, CHUNK)) {
  const { data } = await supabase.from('whatsapp_mensajes').select('conversacion_id, created_at').in('conversacion_id', chunk).eq('rol', 'usuario');
  allMsgsUsuario = allMsgsUsuario.concat(data || []);
}

console.log(`Foto lista: ${allSeguimientos.length} seguimientos, ${allConvs.length} conversaciones, ${allMsgsUsuario.length} mensajes de usuario.\n`);

// ─── 2a. Ensamblado "batch" (orden total, primer visto = más reciente) ────────

function ensamblarEstiloBatch() {
  const pendientesPorLead = new Set();
  for (const s of allSeguimientos) if (s.estado === 'pendiente') pendientesPorLead.add(s.lead_id);

  const tierMaxPorLead = new Map();
  for (const s of allSeguimientos) {
    if (s.estado === 'completado' || s.estado === 'saltado') {
      const actual = tierMaxPorLead.get(s.lead_id);
      if (actual === undefined || s.tier > actual) tierMaxPorLead.set(s.lead_id, s.tier);
    }
  }

  // Orden total descendente por ultimo_mensaje_at (NULLS FIRST, como Postgres DESC)
  const convsOrdenadas = [...allConvs].sort((a, b) => {
    if (a.ultimo_mensaje_at === null && b.ultimo_mensaje_at === null) return 0;
    if (a.ultimo_mensaje_at === null) return -1; // null primero
    if (b.ultimo_mensaje_at === null) return 1;
    return new Date(b.ultimo_mensaje_at) - new Date(a.ultimo_mensaje_at);
  });
  const conversacionesPorLead = new Map();
  for (const c of convsOrdenadas) {
    if (!conversacionesPorLead.has(c.lead_id)) conversacionesPorLead.set(c.lead_id, c);
  }

  const msgsOrdenados = [...allMsgsUsuario].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const ultimoUsuarioPorConv = new Map();
  for (const m of msgsOrdenados) {
    if (!ultimoUsuarioPorConv.has(m.conversacion_id)) ultimoUsuarioPorConv.set(m.conversacion_id, m.created_at);
  }

  return { pendientesPorLead, tierMaxPorLead, conversacionesPorLead, ultimoUsuarioPorConv };
}

// ─── 2b. Ensamblado "legacy" (por lead, replicando .order().limit(1) uno por uno) ──

function ensamblarEstiloLegacy() {
  const pendientesPorLead = new Set();
  for (const s of allSeguimientos) if (s.estado === 'pendiente') pendientesPorLead.add(s.lead_id);

  const tierMaxPorLead = new Map();
  const porLeadTiers = new Map();
  for (const s of allSeguimientos) {
    if (s.estado === 'completado' || s.estado === 'saltado') {
      if (!porLeadTiers.has(s.lead_id)) porLeadTiers.set(s.lead_id, []);
      porLeadTiers.get(s.lead_id).push(s.tier);
    }
  }
  for (const [leadId, tiers] of porLeadTiers) {
    tiers.sort((a, b) => b - a); // DESC, tomar [0]
    tierMaxPorLead.set(leadId, tiers[0]);
  }

  const conversacionesPorLead = new Map();
  const porLeadConvs = new Map();
  for (const c of allConvs) {
    if (!porLeadConvs.has(c.lead_id)) porLeadConvs.set(c.lead_id, []);
    porLeadConvs.get(c.lead_id).push(c);
  }
  for (const [leadId, convs] of porLeadConvs) {
    convs.sort((a, b) => {
      if (a.ultimo_mensaje_at === null && b.ultimo_mensaje_at === null) return 0;
      if (a.ultimo_mensaje_at === null) return -1;
      if (b.ultimo_mensaje_at === null) return 1;
      return new Date(b.ultimo_mensaje_at) - new Date(a.ultimo_mensaje_at);
    });
    conversacionesPorLead.set(leadId, convs[0]); // .limit(1).maybeSingle()
  }

  const ultimoUsuarioPorConv = new Map();
  const porConvMsgs = new Map();
  for (const m of allMsgsUsuario) {
    if (!porConvMsgs.has(m.conversacion_id)) porConvMsgs.set(m.conversacion_id, []);
    porConvMsgs.get(m.conversacion_id).push(m);
  }
  for (const [convId, msgs] of porConvMsgs) {
    msgs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    ultimoUsuarioPorConv.set(convId, msgs[0].created_at);
  }

  return { pendientesPorLead, tierMaxPorLead, conversacionesPorLead, ultimoUsuarioPorConv };
}

function decidirParaTodos(ensamblado) {
  const { pendientesPorLead, tierMaxPorLead, conversacionesPorLead, ultimoUsuarioPorConv } = ensamblado;
  const resultados = new Map();

  for (const lead of leads) {
    if (pendientesPorLead.has(lead.id)) { resultados.set(lead.id, { accion: 'saltado', motivo: 'pendiente' }); continue; }
    const conv = conversacionesPorLead.get(lead.id);
    if (!conv) { resultados.set(lead.id, { accion: 'saltado', motivo: 'sin_conv' }); continue; }

    const lastUserAt = ultimoUsuarioPorConv.get(conv.id);
    const refDate = lastUserAt ? new Date(lastUserAt) : (conv.ultimo_mensaje_at ? new Date(conv.ultimo_mensaje_at) : null);
    if (!refDate) { resultados.set(lead.id, { accion: 'saltado', motivo: 'sin_fecha' }); continue; }

    const horas = horasDesde(refDate);
    const ultimoTier = tierMaxPorLead.get(lead.id) ?? 0;
    const decision = decidirSeguimiento(lead, horas, ultimoTier);
    resultados.set(lead.id, decision);
  }
  return resultados;
}

// ─── 3. Comparar ────────────────────────────────────────────────────────────

console.log('Calculando decisiones (estilo batch vs estilo legacy)...\n');
const resultadosBatch = decidirParaTodos(ensamblarEstiloBatch());
const resultadosLegacy = decidirParaTodos(ensamblarEstiloLegacy());

let diferencias = 0;
for (const lead of leads) {
  const b = resultadosBatch.get(lead.id);
  const l = resultadosLegacy.get(lead.id);
  if (JSON.stringify(b) !== JSON.stringify(l)) {
    diferencias++;
    console.log(`DIFERENCIA — lead ${lead.id} (${lead.nombre || '(sin nombre)'})`);
    console.log('  batch: ', JSON.stringify(b));
    console.log('  legacy:', JSON.stringify(l));
  }
}

console.log(`\n=== RESULTADO: ${leads.length - diferencias}/${leads.length} coinciden, ${diferencias} diferencias ===\n`);

// ─── 4. Muestra dirigida: comparar "legacy" (en memoria) contra las 4 queries REALES ──

function elegirMuestra() {
  const porLeadConvCount = new Map();
  for (const c of allConvs) porLeadConvCount.set(c.lead_id, (porLeadConvCount.get(c.lead_id) || 0) + 1);

  const sinConversacion = leads.filter((l) => !porLeadConvCount.has(l.id)).slice(0, 8);
  const conMultiplesConvs = leads.filter((l) => (porLeadConvCount.get(l.id) || 0) > 1).slice(0, 8);
  const inscripcionPendiente = leads.filter((l) => l.stage === 'inscripcion_pendiente').slice(0, 10);
  const resto = leads.filter((l) =>
    !sinConversacion.includes(l) && !conMultiplesConvs.includes(l) && !inscripcionPendiente.includes(l)
  );
  // resto: muestreo aleatorio simple hasta completar ~50
  const restoBarajado = resto.sort(() => Math.random() - 0.5);
  const faltan = Math.max(0, 50 - sinConversacion.length - conMultiplesConvs.length - inscripcionPendiente.length);

  return [...sinConversacion, ...conMultiplesConvs, ...inscripcionPendiente, ...restoBarajado.slice(0, faltan)];
}

const muestra = elegirMuestra();
console.log(`Validando ${muestra.length} leads contra las 4 queries REALES (una por una, como el código viejo)...\n`);

let diferenciasMuestra = 0;
for (const lead of muestra) {
  // Réplica EXACTA de las 4 queries actuales de producción (solo lectura)
  const { data: pendiente } = await supabase.from('seguimientos').select('id').eq('lead_id', lead.id).eq('estado', 'pendiente').maybeSingle();
  if (pendiente) {
    const legacy = resultadosLegacy.get(lead.id);
    if (legacy.accion !== 'saltado' || legacy.motivo !== 'pendiente') {
      diferenciasMuestra++;
      console.log(`MUESTRA DIFIERE (pendiente) — lead ${lead.id}: real=pendiente, legacy=${JSON.stringify(legacy)}`);
    }
    continue;
  }

  const { data: conv } = await supabase.from('whatsapp_conversaciones').select('id, ultimo_mensaje_at, fase').eq('lead_id', lead.id).order('ultimo_mensaje_at', { ascending: false }).limit(1).maybeSingle();
  const legacyConv = resultadosLegacy.get(lead.id);

  if (!conv) {
    if (legacyConv.accion !== 'saltado' || legacyConv.motivo !== 'sin_conv') {
      diferenciasMuestra++;
      console.log(`MUESTRA DIFIERE (sin conv) — lead ${lead.id}: legacy=${JSON.stringify(legacyConv)}`);
    }
    continue;
  }

  const { data: lastUserMsg } = await supabase.from('whatsapp_mensajes').select('created_at').eq('conversacion_id', conv.id).eq('rol', 'usuario').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const refDateReal = lastUserMsg?.created_at ? new Date(lastUserMsg.created_at) : (conv.ultimo_mensaje_at ? new Date(conv.ultimo_mensaje_at) : null);

  const { data: anteriores } = await supabase.from('seguimientos').select('tier').eq('lead_id', lead.id).in('estado', ['completado', 'saltado']).order('tier', { ascending: false }).limit(1);
  const tierReal = anteriores?.[0]?.tier ?? 0;

  const horasReal = refDateReal ? horasDesde(refDateReal) : null;
  const decisionReal = refDateReal ? decidirSeguimiento(lead, horasReal, tierReal) : { accion: 'saltado', motivo: 'sin_fecha' };

  if (JSON.stringify(decisionReal) !== JSON.stringify(legacyConv)) {
    diferenciasMuestra++;
    console.log(`MUESTRA DIFIERE — lead ${lead.id} (${lead.nombre || '(sin nombre)'})`);
    console.log('  real (4 queries):', JSON.stringify(decisionReal));
    console.log('  legacy (memoria):', JSON.stringify(legacyConv));
  }
}

console.log(`\n=== MUESTRA: ${muestra.length - diferenciasMuestra}/${muestra.length} coinciden con las queries reales, ${diferenciasMuestra} diferencias ===\n`);

if (diferencias === 0 && diferenciasMuestra === 0) {
  console.log('✅ TODO COINCIDE — el refactor batch es equivalente al código anterior.');
} else {
  console.log('❌ HAY DIFERENCIAS — revisar antes de desplegar a producción.');
  process.exitCode = 1;
}
