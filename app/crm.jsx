"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { createClient } from "@/utils/supabase/client";
import AgendaPanel from "@/components/crm/AgendaPanel";
import ConversationsPanel from "@/components/crm/ConversationsPanel";
import KanbanBoard from "@/components/crm/KanbanBoard";
import LeadsTable from "@/components/crm/LeadsTable";
import LeadDetailModal from "@/components/crm/LeadDetailModal";
import NewAppointmentModal from "@/components/crm/NewAppointmentModal";
import NewLeadModal from "@/components/crm/NewLeadModal";
import SeguimientosPanel from "@/components/crm/SeguimientosPanel";
import ReactivacionesPanel from "@/components/crm/ReactivacionesPanel";
import { chunkArray } from "@/lib/db-utils";
import { esDiplomado } from "@/lib/whatsapp/programas";
const supabase = createClient();

const STAGES = [
  { id: "primer_contacto", label: "📞 Primer contacto", color: "#2C4A8C", bg: "#eef2fb" },
  { id: "examen_ubicacion", label: "📝 Examen de ubicación", color: "#b45309", bg: "#fef3c7" },
  { id: "clase_muestra", label: "🎓 Clase muestra", color: "#A8263C", bg: "#fee2e8" },
  { id: "segundo_contacto", label: "🔁 Segundo contacto", color: "#7c3aed", bg: "#ede9fe" },
  { id: "promocion_enviada", label: "🏷️ Promoción enviada", color: "#c2410c", bg: "#ffedd5" },
  { id: "tercer_contacto", label: "📲 Tercer contacto", color: "#2C4A8C", bg: "#dbeafe" },
  { id: "inscripcion_pendiente", label: "📋 Inscripción pendiente", color: "#92400e", bg: "#fef9c3" },
  { id: "inscrito", label: "✅ Inscrito", color: "#15803d", bg: "#dcfce7" },
  { id: "perdido", label: "❌ Perdido", color: "#64748b", bg: "#f1f5f9" },
  { id: "archivado", label: "📦 Archivado", color: "#94a3b8", bg: "#f8fafc" },
];

const LEGACY_STAGE_MAP = {
  nuevo: "primer_contacto",
  contactado: "primer_contacto",
  interesado: "segundo_contacto",
  propuesta: "inscripcion_pendiente",
  cerrado: "inscrito",
};

const CURSOS = ["Inglés para niños", "Inglés para adultos", "Licenciaturas", "Maestrías", "Diplomados"];
const SESSION_HOURS = 12;
const formatPeso = (v) => `$${Number(v).toLocaleString("es-MX")}`;
const todayCST = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

const WA_TEMPLATES = {
  primer_contacto: (nombre, curso) => `Hola ${nombre}. Gracias por tu interés en *${curso}* en Instituto Windsor. Con gusto te orientamos sobre el siguiente paso.`,
  examen_ubicacion: (nombre, curso) => `Hola ${nombre}. Te doy seguimiento con tu proceso de *${curso}*. Si quieres, avanzamos con tu examen de ubicación.`,
  clase_muestra: (nombre, curso) => `Hola ${nombre}. Seguimos atentos con tu proceso de *${curso}*. Si te parece, avanzamos con tu clase muestra.`,
  segundo_contacto: (nombre, curso) => `Hola ${nombre}. Te doy seguimiento sobre *${curso}*. Si quieres, te ayudo a resolver dudas y avanzar.`,
  promocion_enviada: (nombre, curso) => `${nombre}, ya te compartimos la promoción vigente para *${curso}*. Si deseas, te apoyo con el siguiente paso.`,
  tercer_contacto: (nombre, curso) => `Hola ${nombre}. Retomo tu proceso de *${curso}* para saber si aún te interesa avanzar con Instituto Windsor.`,
  inscripcion_pendiente: (nombre, curso) => `${nombre}, tu proceso de *${curso}* está listo para inscripción. Si deseas, te ayudo a cerrarlo hoy mismo.`,
  inscrito: (nombre, curso) => `¡Felicidades ${nombre}! Tu inscripción en *${curso}* quedó confirmada con Instituto Windsor.`,
};

const normalizeStage = (stage) => LEGACY_STAGE_MAP[stage] || stage || "primer_contacto";
const AGENDAR_LINK = "https://crm.windsor.edu.mx/agendar/hola@windsor.edu.mx";

const getProgramaResumen = (curso) => {
  const original = String(curso || "").trim();
  const value = original.toLowerCase();
  if (!original || original === "WhatsApp - Instituto Windsor") return null;
  if (esDiplomado(original)) return { group: "diplomados", key: original, label: original.replace(/^diplomado en\s+/i, "") };
  if (/ingl[eé]s para ni[ñn]os?/.test(value)) return { group: "idiomas", key: "ingles-ninos", label: "Inglés para niños" };
  if (/ingl[eé]s para adultos?/.test(value)) return { group: "idiomas", key: "ingles-adultos", label: "Inglés para adultos" };
  if (/franc[eé]s/.test(value)) return { group: "idiomas", key: "frances", label: "Francés" };
  if (/italiano/.test(value)) return { group: "idiomas", key: "italiano", label: "Italiano" };
  if (/verano.*ni[ñn]|summer.*ni[ñn]/.test(value)) return { group: "idiomas", key: "verano-ninos", label: "Verano niños" };
  if (/verano.*adult|summer.*adult/.test(value)) return { group: "idiomas", key: "verano-adultos", label: "Verano adultos" };
  if (/bachillerato|prepa/.test(value)) return { group: "bachillerato", key: "bachillerato", label: "Bachillerato" };
  if (/licenciatura.*ingl[eé]s|ingl[eé]s.*licenciatura/.test(value)) return { group: "licenciaturas", key: "lic-ingles", label: "Lic. en Inglés" };
  if (/administraci[oó]n tur[ií]stica/.test(value)) return { group: "licenciaturas", key: "administracion-turistica", label: "Administración Turística" };
  if (/relaciones p[úu]blicas|mercadotecnia/.test(value)) return { group: "licenciaturas", key: "rrpp-mercadotecnia", label: "RR. PP. y Mercadotecnia" };
  if (/^psicolog[ií]a$/.test(value)) return { group: "licenciaturas", key: "psicologia", label: "Psicología" };
  if (/^licenciaturas?$/.test(value)) return { group: "licenciaturas", key: "lic-sin-especificar", label: "Licenciaturas sin especificar" };
  if (/innovaci[oó]n empresarial/.test(value)) return { group: "maestrias", key: "innovacion-empresarial", label: "Innovación Empresarial" };
  if (/multiculturalidad|pluriling[üu]ismo/.test(value)) return { group: "maestrias", key: "multiculturalidad", label: "Multiculturalidad y Plurilingüismo" };
  if (/^maestr[ií]as?$/.test(value)) return { group: "maestrias", key: "maestrias-sin-especificar", label: "Maestrías sin especificar" };
  return { group: "otros", key: original, label: original };
};

const OFERTA_LABELS = {
  idiomas: "Cursos de idiomas",
  bachillerato: "Bachillerato",
  licenciaturas: "Licenciaturas",
  maestrias: "Maestrías",
  diplomados: "Diplomados",
  otros: "Otros programas",
};

const getInfoTemplateForLead = (lead) => {
  const nombre = lead?.nombre?.split(" ")[0] || "Hola";
  const curso = String(lead?.curso || "").toLowerCase();

  if (curso.includes("niños")) {
    return `Hola ${nombre}. Gracias por tu interés en *Inglés para niños* en Instituto Windsor. Te comparto información general: trabajamos por niveles, con acompañamiento cercano y un enfoque práctico para desarrollar comprensión y conversación. Si deseas, con gusto te apoyamos con *examen de ubicación* y *clase muestra*.`;
  }

  if (curso.includes("adultos") || curso.includes("ingles")) {
    return `Hola ${nombre}. Gracias por tu interés en *Inglés para adultos* en Instituto Windsor. Te comparto información general: avance por niveles, enfoque conversacional y práctica constante para usar el idioma en contextos reales. Si deseas, con gusto te apoyamos con *examen de ubicación* y *clase muestra*.`;
  }

  if (curso.includes("licenciatura")) {
    return `Hola ${nombre}. Gracias por tu interés en *Licenciaturas* en Instituto Windsor. Con gusto te compartimos información general sobre el proceso de admisión, orientación académica y acompañamiento para ayudarte a elegir la mejor opción. Si deseas, podemos continuar con *promoción vigente* e *inscripción*.`;
  }

  if (curso.includes("maestr")) {
    return `Hola ${nombre}. Gracias por tu interés en *Maestrías* en Instituto Windsor. Con gusto te compartimos información general sobre admisión, orientación académica y acompañamiento para revisar la opción que mejor se ajuste a tu perfil. Si deseas, podemos continuar con *promoción vigente* e *inscripción*.`;
  }

  if (curso.includes("diplomado")) {
    return `Hola ${nombre}. Gracias por tu interés en *Diplomados* en Instituto Windsor. Con gusto te compartimos información general sobre nuestras opciones de formación práctica y actualización profesional. Si deseas, podemos continuar con *promoción vigente* e *inscripción*.`;
  }

  return `Hola ${nombre}. Gracias por tu interés en Instituto Windsor. Con gusto te compartimos información general del programa que nos solicitaste. Si deseas, también podemos ayudarte con el siguiente paso desde aquí: ${AGENDAR_LINK}`;
};


export default function CRM() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("kanban");
  const [pendientesCount, setPendientesCount] = useState(0);
  const [selectedLead, setSelectedLead] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showCitaForm, setShowCitaForm] = useState(false);
  const [leadTimeline, setLeadTimeline] = useState([]);
  const [leadTimelineLoading, setLeadTimelineLoading] = useState(false);
  const [filterVendedor, setFilterVendedor] = useState("Todos");
  const [filterFuente, setFilterFuente] = useState("Todos");
  const [filterOferta, setFilterOferta] = useState("Todos");
  const [search, setSearch] = useState("");
  const [dragId, setDragId] = useState(null);
  const [toast, setToast] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [vendedores, setVendedores] = useState([]);
  const [newLead, setNewLead] = useState({ nombre: "", email: "", whatsapp: "", curso: CURSOS[0], valor: "", notas: "", asignado_a: "" });
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      role: "assistant",
      content:
        "Hola, soy tu asistente comercial de Instituto Windsor. Cuéntame sobre tus prospectos y te doy recomendaciones concretas para dar mejor seguimiento.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [citas, setCitas] = useState([]);
  const [nuevaCita, setNuevaCita] = useState({
    lead_id: "",
    fecha: "",
    hora: "",
    tipo: "asesoria",
    duracion: 30,
    notas: "",
  });
  const [documentos, setDocumentos] = useState([]);
  const [ragUploading, setRagUploading] = useState(false);
  const [ragTexto, setRagTexto] = useState("");
  const [ragTitulo, setRagTitulo] = useState("");
  const [expandedDoc, setExpandedDoc] = useState(null);
  const [editingDoc, setEditingDoc] = useState(null);
  const [editTexto, setEditTexto] = useState("");
  const [revisionFilas, setRevisionFilas] = useState([]);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionGenerating, setRevisionGenerating] = useState(false);
  const [whatsConvs, setWhatsConvs] = useState([]);
  const [ultimoUsuarioAtPorConv, setUltimoUsuarioAtPorConv] = useState({});
  const [selectedConv, setSelectedConv] = useState(null);
  const [convMessages, setConvMessages] = useState([]);
  const [convSearch, setConvSearch] = useState("");
  const [convModeFilter, setConvModeFilter] = useState("todos");
  const [convPhaseFilter, setConvPhaseFilter] = useState("todas");
  const [convVentanaFilter, setConvVentanaFilter] = useState(false);
  const [convAtoradaFilter, setConvAtoradaFilter] = useState(false);
  const [selectedAtoradaIds, setSelectedAtoradaIds] = useState([]);
  const [marcandoPerdidas, setMarcandoPerdidas] = useState(false);
  const [editTitulo, setEditTitulo] = useState("");
  const [flowRules, setFlowRules] = useState([]);
  const [flowLoading, setFlowLoading] = useState(false);
  const [flowSaving, setFlowSaving] = useState(false);
  const [flowId, setFlowId] = useState(null);
  const [botPrompt, setBotPrompt] = useState("");
  const [botLoading, setBotLoading] = useState(false);
  const [botSaving, setBotSaving] = useState(false);
  const [sendingAgent, setSendingAgent] = useState(false);
  const sendingAgentRef = useRef(false);
  const [sendingReactivacion, setSendingReactivacion] = useState(false);
  const [plantillas, setPlantillas] = useState([]);
  const [loadingPlantillas, setLoadingPlantillas] = useState(false);
  const [sendingInfoLeadId, setSendingInfoLeadId] = useState(null);
  const [leadInfoDraft, setLeadInfoDraft] = useState("");
  const [labScenario, setLabScenario] = useState("ads");
  const [labStarted, setLabStarted] = useState(false);
  const [labMessages, setLabMessages] = useState([]);
  const [labInput, setLabInput] = useState("");
  const [labSending, setLabSending] = useState(false);
  const [labWalkinData, setLabWalkinData] = useState({
    nombre: "",
    email: "",
    programa: CURSOS[0],
    whatsapp: "",
  });
  const [labState, setLabState] = useState({
    origen: "ads",
    nombre: "",
    email: "",
    programa: "",
    fase: "saludo",
    nextStep: "Pedir nombre",
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAyuda, setShowAyuda] = useState(false);
  const [exitDecisionOpen, setExitDecisionOpen] = useState(false);
  const [pendingExitAction, setPendingExitAction] = useState(null);
  const leadsRequestRef = useRef(0);
  const whatsConvsRequestRef = useRef(0);
  const whatsConvsPollingRef = useRef(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const logLeadActivity = async ({
    leadId,
    eventType,
    title,
    detail = "",
    meta = {},
  }) => {
    if (!leadId || !eventType || !title) return null;
    try {
      const res = await fetch("/api/leads/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          event_type: eventType,
          title,
          detail,
          meta,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data?.activity || null;
    } catch {
      return null;
    }
  };

  const buildActivityTimelineItem = (activity) => {
    const toneMap = {
      stage_changed: "#E8A838",
      lead_assigned: "#8ac0ff",
      notes_updated: "#c58cff",
      appointment_created: "#ffb15c",
      appointment_status_changed: "#72d99a",
      agent_reply_sent: "#c58cff",
      lead_created: "#5fd18c",
    };

    return {
      id: activity.id,
      title: activity.title,
      detail: activity.detail,
      date: activity.created_at,
      tone: toneMap[activity.event_type] || "#777",
      source: "activity",
    };
  };

  const loadDocumentos = async () => {
    const { data } = await supabase.from("documentos").select("id, titulo, contenido, created_at").order("created_at", { ascending: false });
    setDocumentos(data || []);
  };

  const uploadTexto = async () => {
    if (!ragTexto.trim()) return;
    setRagUploading(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000); // 2 min

      const res = await fetch("/api/rag/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ contenido: ragTexto, titulo: ragTitulo }),
      });

      clearTimeout(timeout);

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showToast((data?.error || "Error al indexar") + (data?.detail ? ": " + data.detail : " (HTTP " + res.status + ")"), "error");
        return;
      }

      if (data.ok) {
        showToast(`Indexado: ${data.chunks_indexed} fragmentos`);
        setRagTexto("");
        setRagTitulo("");
        loadDocumentos();
      } else {
        showToast(data.error || "Error al indexar", "error");
      }
    } catch (e) {
      const msg =
        e?.name === "AbortError"
          ? "Indexación tardó demasiado (timeout). Intenta con menos texto."
          : "Error de red indexando. Reintenta."
      showToast(msg, "error");
    } finally {
      setRagUploading(false);
    }
  };

  const deleteDocumento = async (id) => {
    await supabase.from("documentos").delete().eq("id", id);
    setDocumentos((prev) => prev.filter((d) => d.id !== id));
    showToast("Documento eliminado");
  };

  const saveDocumento = async (id) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000); // 2 min

      const res = await fetch("/api/rag/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ contenido: editTexto, titulo: editTitulo }),
      });

      clearTimeout(timeout);

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showToast(data?.error || "Error al guardar (HTTP " + res.status + ")", "error");
        return;
      }

      if (data.ok) {
        await supabase.from("documentos").delete().eq("id", id);
        setEditingDoc(null);
        showToast("Documento actualizado");
        loadDocumentos();
      } else {
        showToast(data.error || "Error al guardar", "error");
      }
    } catch (e) {
      const msg =
        e?.name === "AbortError"
          ? "Guardado tardó demasiado (timeout). Intenta con menos texto."
          : "Error de red guardando. Reintenta."
      showToast(msg, "error");
    }
  };

  const isAdmin = currentProfile?.rol === "admin";

  useEffect(() => {
    loadUser();
    fetch("/api/seguimientos")
      .then(r => r.json())
      .then(d => setPendientesCount((d.seguimientos || []).length))
      .catch(() => {});
    if (window.innerWidth <= 768) {
      setView("convs");
    }
  }, []);

  useEffect(() => {
    if (!selectedLead?.id) {
      setLeadTimeline([]);
      setLeadTimelineLoading(false);
      return;
    }

    let cancelled = false;

    const fetchLeadTimeline = async () => {
      setLeadTimelineLoading(true);
      try {
        const { data: activityRows } = await supabase
          .from("lead_activities")
          .select("id, event_type, title, detail, meta, created_at")
          .eq("lead_id", selectedLead.id)
          .order("created_at", { ascending: false })
          .limit(8);

        const persistedTimeline = (activityRows || []).map(buildActivityTimelineItem);
        const { data: conv } = await supabase
          .from("whatsapp_conversaciones")
          .select("id, fase, estado, ultimo_mensaje_at, modo_humano")
          .eq("lead_id", selectedLead.id)
          .order("ultimo_mensaje_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const timeline = [...persistedTimeline];

        if (conv) {
          timeline.push({
            id: `conv-${conv.id}`,
            title: `Conversacion en fase ${getPhaseLabel(conv.fase)}`,
            detail: `${conv.modo_humano ? "Tomada por humano" : "Atendida por bot"} · Estado ${conv.estado || "abierta"}`,
            date: conv.ultimo_mensaje_at,
            tone: conv.estado === "cerrada" ? "#72d99a" : "#E8A838",
          });

          const { data: messages } = await supabase
            .from("whatsapp_mensajes")
            .select("id, rol, contenido, created_at")
            .eq("conversacion_id", conv.id)
            .order("created_at", { ascending: false })
            .limit(4);

          (messages || []).forEach((message) => {
            timeline.push({
              id: message.id,
              title: message.rol === "usuario" ? "Mensaje del prospecto" : message.rol === "agente" ? "Respuesta del vendedor" : "Mensaje del bot",
              detail: message.contenido,
              date: message.created_at,
              tone: message.rol === "usuario" ? "#8ac0ff" : message.rol === "agente" ? "#c58cff" : "#5fd18c",
            });
          });
        }

        const leadCitas = citas
          .filter((cita) => cita.lead_id === selectedLead.id)
          .sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`))
          .slice(0, 3)
          .map((cita) => ({
            id: `cita-${cita.id}`,
            title: `Cita ${cita.status || "pendiente"}`,
            detail: `${cita.tipo === "clase_prueba" ? "Clase muestra" : cita.tipo === "asesoria" ? "Asesoría" : cita.tipo === "examen_ubicacion" ? "Examen de ubicación" : "Inscripción"} · ${cita.fecha} ${cita.hora?.slice(0, 5) || ""}`,
            date: `${cita.fecha}T${cita.hora || "00:00:00"}`,
            tone: "#ffb15c",
          }));

        if (!cancelled) {
          setLeadTimeline(
            [...timeline, ...leadCitas]
              .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
              .slice(0, 10)
          );
        }
      } finally {
        if (!cancelled) setLeadTimelineLoading(false);
      }
    };

    fetchLeadTimeline();

    return () => {
      cancelled = true;
    };
  }, [selectedLead?.id, citas]);

  useEffect(() => {
    if (!selectedLead?.id) {
      setLeadInfoDraft("");
      return;
    }
    setLeadInfoDraft(getInfoTemplateForLead(selectedLead));
  }, [selectedLead?.id, selectedLead?.curso]);

  const loadUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = '/login';
      return;
    }

    const loginAt = localStorage.getItem('windsor_login_at');
    const expired = !loginAt || (Date.now() - parseInt(loginAt, 10)) > SESSION_HOURS * 3600 * 1000;
    if (expired) {
      await supabase.auth.signOut();
      window.location.href = '/login';
      return;
    }
    setCurrentUser(user);

    // Cargar perfil propio y lista de vendedores en paralelo (antes eran 2 vueltas
    // al servidor una tras otra, sumando latencia al arranque de la app).
    let [{ data: profile }, { data: allProfiles }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("profiles").select("*"),
    ]);
    if (!profile) {
      const { data: newProfile } = await supabase.from("profiles")
        .insert([{ id: user.id, email: user.email, nombre: user.email.split("@")[0], rol: "vendedor" }])
        .select().single();
      profile = newProfile;
      allProfiles = [...(allProfiles || []), newProfile].filter(Boolean);
    }
    setCurrentProfile(profile);
    setVendedores(allProfiles || []);

    // Preseleccionar el usuario actual como asignado
    setNewLead(prev => ({ ...prev, asignado_a: user.id }));

    fetchLeads(user.id, profile?.rol === "admin");
    fetchCitas(user.id, profile?.rol === "admin");
    fetchWhatsConvs();
  };

  const fetchLeads = async (userId = currentUser?.id, admin = currentProfile?.rol === "admin") => {
    setLoading(true);
    const requestId = ++leadsRequestRef.current;
    // Pintamos primero una parte pequeña del pipeline y cargamos el resto después.
    // Esto conserva la búsqueda y el Kanban completos sin congelar el arranque móvil.
    const INITIAL_PAGE_SIZE = 250;
    const PAGE_SIZE = 500;
    const makeQuery = (from, to) => {
      let query = supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to);
      if (!admin) query = query.eq("asignado_a", userId);
      return query;
    };

    const { data: initialPage, error: initialError } = await makeQuery(0, INITIAL_PAGE_SIZE - 1);
    if (requestId !== leadsRequestRef.current) return [];
    if (initialError) {
      showToast("Error cargando leads", "error");
      setLoading(false);
      return [];
    }

    let all = initialPage || [];
    setLeads(all);
    setLoading(false);
    if (all.length < INITIAL_PAGE_SIZE) return all;

    // Ceder un frame al navegador antes de completar la carga histórica.
    await new Promise((resolve) => setTimeout(resolve, 0));
    let from = INITIAL_PAGE_SIZE;
    for (;;) {
      const { data, error } = await makeQuery(from, from + PAGE_SIZE - 1);
      if (requestId !== leadsRequestRef.current) return all;
      if (error) { showToast("No se pudieron cargar todos los leads", "error"); break; }
      all = all.concat(data || []);
      setLeads(all);
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  };

  const openConversationForLead = async (lead) => {
    if (!lead) return;
    setSelectedLead(null);
    setView("convs");
    setConvSearch("");
    const refreshedConvs = await fetchWhatsConvs();
    const conv = (refreshedConvs || []).find((c) => c.lead_id === lead.id || c.whatsapp === lead.whatsapp);
    if (!conv) {
      showToast("Este lead no tiene una conversación vinculada", "error");
      return;
    }
    setSelectedConv(conv);
    await fetchConvMessages(conv.id);
  };

  const fetchCitas = async (userId, admin) => {
    let query = supabase
      .from("citas")
      .select("*, leads(nombre, email, whatsapp, curso, notas)")
      .order("fecha", { ascending: true })
      .order("hora", { ascending: true });

    if (!admin) {
      query = query.eq("vendedor_id", userId);
    }

    const { data, error } = await query;
    if (error) {
      showToast("Error cargando citas", "error");
    } else {
      setCitas(data || []);
    }
  };

  const fetchRevisionDiaria = async () => {
    setRevisionLoading(true);
    try {
      const res = await fetch("/api/revision-diaria");
      const data = await res.json();
      setRevisionFilas(data.filas || []);
    } finally {
      setRevisionLoading(false);
    }
  };

  const generarRevisionDiaria = async () => {
    setRevisionGenerating(true);
    try {
      const res = await fetch("/api/revision-diaria", { method: "POST" });
      const data = await res.json();
      if (data.filas) setRevisionFilas(data.filas);
    } finally {
      setRevisionGenerating(false);
    }
  };

  const updateRevisionFila = async (id, patch) => {
    setRevisionFilas((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    const res = await fetch(`/api/revision-diaria/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data.fila) setRevisionFilas((prev) => prev.map((f) => (f.id === id ? data.fila : f)));
  };

  const fetchWhatsConvs = async () => {
    // Antes traía las 2200+ conversaciones completas (3 vueltas de 1000) antes de
    // pintar cualquier cosa — con el celular abriendo directo en Conversaciones,
    // eso eran los 5-10s de carga inicial reportados por Harold (2-sep-2026).
    // Mismo patrón que fetchLeads: pintamos una primera página rápido y el resto
    // se sigue cargando después, sin bloquear. Ordenado por ultimo_mensaje_at desc,
    // así que lo más relevante siempre llega en la primera página.
    const requestId = ++whatsConvsRequestRef.current;
    const INITIAL_PAGE_SIZE = 300;
    const PAGE_SIZE = 1000;
    const selectColsFull = "id, whatsapp, lead_id, estado, ultimo_mensaje_at, modo_humano, tomado_por, fase, visto_at";
    const selectColsFallback = "id, whatsapp, lead_id, estado, ultimo_mensaje_at";
    const runQuery = (selectCols, from, to) =>
      supabase
        .from("whatsapp_conversaciones")
        .select(selectCols)
        .order("ultimo_mensaje_at", { ascending: false })
        .range(from, to);

    let selectCols = selectColsFull;
    let all;
    {
      const { data, error } = await runQuery(selectCols, 0, INITIAL_PAGE_SIZE - 1);
      if (error) {
        selectCols = selectColsFallback;
        const fallback = await runQuery(selectCols, 0, INITIAL_PAGE_SIZE - 1);
        if (fallback.error) {
          showToast("Error cargando conversaciones de WhatsApp", "error");
          return [];
        }
        all = fallback.data || [];
      } else {
        all = data || [];
      }
    }
    if (requestId !== whatsConvsRequestRef.current) return all;
    setWhatsConvs(all);
    fetchUltimosUsuarioMensajes(all);
    if (all.length < INITIAL_PAGE_SIZE) return all;

    // Ceder un frame al navegador antes de completar la carga histórica.
    await new Promise((resolve) => setTimeout(resolve, 0));
    let from = INITIAL_PAGE_SIZE;
    for (;;) {
      const { data, error } = await runQuery(selectCols, from, from + PAGE_SIZE - 1);
      if (requestId !== whatsConvsRequestRef.current) return all;
      if (error) { showToast("No se pudieron cargar todas las conversaciones", "error"); break; }
      all = all.concat(data || []);
      setWhatsConvs(all);
      fetchUltimosUsuarioMensajes(all);
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  };

  // Se usa para dos cosas que necesitan el último mensaje del LEAD (rol
  // "usuario"), no `ultimo_mensaje_at` (que también se actualiza cuando
  // responde el bot/agente humano):
  // 1) la ventana de servicio de 24h de WhatsApp
  // 2) el punto verde de "no leído" (una conversación NO es no-leída solo
  //    porque el asesor/bot acaba de contestar)
  // Para no consultar whatsapp_mensajes de todas las conversaciones, solo se
  // pide para las que hacen falta: las que están dentro de las últimas 24h
  // (para el punto 1) o las que el chequeo básico (ultimo_mensaje_at vs
  // visto_at) marca como posible no-leída (para el punto 2) — el resto ya
  // está garantizado fuera de ventana / leída sin necesidad de consultarlo.
  const fetchUltimosUsuarioMensajes = async (convs, { merge = false } = {}) => {
    const ahora = Date.now();
    const convIds = convs
      .filter((c) => {
        if (!c.ultimo_mensaje_at) return false;
        const dentroVentana = (ahora - new Date(c.ultimo_mensaje_at).getTime()) < 24 * 60 * 60 * 1000;
        const candidatoNoLeido = !c.visto_at || new Date(c.ultimo_mensaje_at) > new Date(c.visto_at);
        return dentroVentana || candidatoNoLeido;
      })
      .map((c) => c.id);
    if (convIds.length === 0) {
      if (!merge) setUltimoUsuarioAtPorConv({});
      return;
    }
    const mapa = {};
    for (const chunk of chunkArray(convIds, 200)) {
      const { data: msgs, error } = await supabase
        .from("whatsapp_mensajes")
        .select("conversacion_id, created_at")
        .in("conversacion_id", chunk)
        .eq("rol", "usuario")
        .order("created_at", { ascending: false });
      if (error) continue;
      for (const m of msgs || []) {
        if (!mapa[m.conversacion_id]) mapa[m.conversacion_id] = m.created_at;
      }
    }
    // El polling de la lista (merge: true) solo trae las conversaciones más
    // recientes — reemplazar el mapa completo borraría el estado "no leído"
    // de conversaciones viejas que quedaron fuera de esa muestra.
    if (merge) setUltimoUsuarioAtPorConv((prev) => ({ ...prev, ...mapa }));
    else setUltimoUsuarioAtPorConv(mapa);
  };

  // Auto-refresh de TODA la lista de conversaciones (no solo la abierta) mientras
  // Harold está en la sección — antes tenía que salir y volver a entrar para ver
  // mensajes nuevos de leads distintos al que tenía abierto (reportado 2-sep-2026).
  // Ojo con repetir el bug de antes (commit a063c65): esto NO debe reemplazar
  // whatsConvs entero ni tocar ningún estado de texto que el asesor esté
  // escribiendo — solo trae las conversaciones más recientes (barato, indexado
  // por ultimo_mensaje_at) y actualiza/reordena en el arreglo existente. Si nada
  // cambió, ni siquiera dispara un re-render (misma referencia de arreglo).
  const pollWhatsConvsRecientes = async () => {
    if (whatsConvsPollingRef.current) return;
    whatsConvsPollingRef.current = true;
    try {
      const { data, error } = await supabase
        .from("whatsapp_conversaciones")
        .select("id, whatsapp, lead_id, estado, ultimo_mensaje_at, modo_humano, tomado_por, fase, visto_at")
        .order("ultimo_mensaje_at", { ascending: false })
        .limit(100);
      if (error || !data) return;
      let huboCambios = false;
      setWhatsConvs((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]));
        for (const fresh of data) {
          const old = byId.get(fresh.id);
          if (
            !old ||
            old.ultimo_mensaje_at !== fresh.ultimo_mensaje_at ||
            old.fase !== fresh.fase ||
            old.modo_humano !== fresh.modo_humano ||
            old.visto_at !== fresh.visto_at ||
            old.estado !== fresh.estado ||
            old.tomado_por !== fresh.tomado_por
          ) {
            byId.set(fresh.id, { ...old, ...fresh });
            huboCambios = true;
          }
        }
        if (!huboCambios) return prev;
        return Array.from(byId.values()).sort((a, b) => new Date(b.ultimo_mensaje_at) - new Date(a.ultimo_mensaje_at));
      });
      if (huboCambios) fetchUltimosUsuarioMensajes(data, { merge: true });
    } finally {
      whatsConvsPollingRef.current = false;
    }
  };

  useEffect(() => {
    if (view !== "convs") return;
    // Sin chequeo de document.visibilityState a propósito: en el PWA de iPhone
    // (agregado a pantalla de inicio) ese valor se queda mal reportado como "no
    // visible" aunque la app esté abierta y en primer plano, así que el check
    // bloqueaba el refresh por completo — reportado por Harold 2-sep-2026 (solo
    // veía mensajes nuevos al cerrar y volver a abrir la app entera).
    const interval = setInterval(() => {
      pollWhatsConvsRecientes();
    }, 10000);
    return () => clearInterval(interval);
  }, [view]);

  const fetchConvMessages = async (convId, { silent = false } = {}) => {
    if (!silent) setConvMessages([]);
    const { data, error } = await supabase
      .from("whatsapp_mensajes")
      .select("id, rol, contenido, media_url, media_tipo, created_at")
      .eq("conversacion_id", convId)
      .order("created_at", { ascending: true });
    if (error) {
      if (!silent) showToast("Error cargando mensajes de WhatsApp", "error");
      return;
    }
    const next = data || [];
    // En refrescos silenciosos (polling) evitamos cambiar la referencia si el
    // contenido es igual, para no disparar el auto-scroll ni el re-render
    // del chat mientras el asesor está leyendo o escribiendo una respuesta.
    setConvMessages((prev) => {
      if (
        silent &&
        prev.length === next.length &&
        prev[prev.length - 1]?.id === next[next.length - 1]?.id
      ) {
        return prev;
      }
      return next;
    });
  };

  const loadWhatsappFlow = async () => {
    setFlowLoading(true);
    try {
      const { data, error } = await supabase
        .from("whatsapp_flows")
        .select("id, config")
        .eq("activo", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        showToast("Error cargando flow de WhatsApp", "error");
        return;
      }

      setFlowId(data?.id || null);
      const cfg = data?.config && typeof data.config === "object" ? data.config : { rules: [] };
      const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
      if (rules.length) {
        setFlowRules(
          rules.map((r) => ({
            match: r.match || "",
            type: r.use_rag || r.type === "rag" ? "rag" : "fixed",
            answer: r.answer || r.response || "",
          }))
        );
      } else {
        setFlowRules([
          {
            match: "hola",
            type: "fixed",
            answer:
              "¡Hola! 👋 Soy el asistente de Instituto Windsor. ¿Te interesa conocer nuestros programas educativos? Responde SÍ para más información.",
          },
          {
            match: "precio",
            type: "rag",
            answer: "",
          },
        ]);
      }
    } catch {
      showToast("Error cargando flow de WhatsApp", "error");
    } finally {
      setFlowLoading(false);
    }
  };

  const loadBotConfig = async () => {
    if (!isAdmin) return;
    setBotLoading(true);
    try {
      const { data, error } = await supabase
        .from("whatsapp_flows")
        .select("id, config")
        .eq("activo", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        showToast("Error cargando configuración del bot", "error");
        return;
      }

      setFlowId(data?.id || null);
      const cfg = data?.config && typeof data.config === "object" ? data.config : {};
      setBotPrompt(typeof cfg.bot_prompt === "string" ? cfg.bot_prompt : "");
    } catch {
      showToast("Error cargando configuración del bot", "error");
    } finally {
      setBotLoading(false);
    }
  };

  const saveWhatsappFlow = async () => {
    if (!isAdmin) return;

    const cleanedRules = flowRules
      .map((r) => ({
        match: (r.match || "").trim().toLowerCase(),
        type: r.type === "rag" ? "rag" : "fixed",
        answer: (r.answer || "").trim(),
      }))
      .filter((r) => r.match);

    if (!cleanedRules.length) {
      showToast("Agrega al menos una regla con palabra clave", "error");
      return;
    }

    const config = {
      rules: cleanedRules.map((r) => ({
        match: r.match,
        answer: r.type === "fixed" ? r.answer : undefined,
        use_rag: r.type === "rag",
      })),
    };

    setFlowSaving(true);
    try {
      if (flowId) {
        const { error } = await supabase
          .from("whatsapp_flows")
          .update({ config })
          .eq("id", flowId);

        if (error) {
          showToast("Error guardando flow de WhatsApp", "error");
        } else {
          showToast("Flow de WhatsApp guardado");
        }
      } else {
        const { data, error } = await supabase
          .from("whatsapp_flows")
          .insert([
            {
              nombre: "Flow principal WhatsApp",
              descripcion: "Reglas básicas para el bot de WhatsApp",
              activo: true,
              config,
            },
          ])
          .select("id")
          .single();

        if (error) {
          showToast("Error guardando flow de WhatsApp", "error");
        } else {
          setFlowId(data?.id || null);
          showToast("Flow de WhatsApp guardado");
        }
      }
    } catch {
      showToast("Error guardando flow de WhatsApp", "error");
    } finally {
      setFlowSaving(false);
    }
  };

  const saveBotConfig = async () => {
    if (!isAdmin) return;

    const prompt = (botPrompt || "").trim();
    if (!prompt) {
      showToast("Escribe la identidad y comportamiento del bot antes de guardar", "error");
      return;
    }

    setBotSaving(true);
    try {
      const { data: activeFlow, error: loadError } = await supabase
        .from("whatsapp_flows")
        .select("id, config")
        .eq("activo", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (loadError) {
        showToast("Error cargando la configuración actual del bot", "error");
        return;
      }

      const currentConfig =
        activeFlow?.config && typeof activeFlow.config === "object"
          ? activeFlow.config
          : {};

      const nextConfig = {
        ...currentConfig,
        bot_prompt: prompt,
      };

      if (activeFlow?.id) {
        const { error } = await supabase
          .from("whatsapp_flows")
          .update({ config: nextConfig })
          .eq("id", activeFlow.id);

        if (error) {
          showToast("Error guardando la configuración del bot", "error");
          return;
        }

        setFlowId(activeFlow.id);
      } else {
        const { data, error } = await supabase
          .from("whatsapp_flows")
          .insert([
            {
              nombre: "Flow principal WhatsApp",
              descripcion: "Configuración principal del bot de WhatsApp",
              activo: true,
              config: {
                rules: [],
                bot_prompt: prompt,
              },
            },
          ])
          .select("id")
          .single();

        if (error) {
          showToast("Error guardando la configuración del bot", "error");
          return;
        }

        setFlowId(data?.id || null);
      }

      showToast("Configuración del bot guardada");
    } catch {
      showToast("Error guardando la configuración del bot", "error");
    } finally {
      setBotSaving(false);
    }
  };

  const setHumanMode = async (conv, enabled) => {
    if (!conv) return;
    const { error } = await supabase
      .from("whatsapp_conversaciones")
      .update({
        modo_humano: enabled,
        tomado_por: enabled ? currentUser?.id || null : null,
      })
      .eq("id", conv.id);
    if (error) {
      showToast(error.message || "Error cambiando modo de conversación. ¿Ejecutaste el SQL de RLS en Supabase?", "error");
      return;
    }
    setSelectedConv((prev) => (prev && prev.id === conv.id ? { ...prev, modo_humano: enabled, tomado_por: enabled ? currentUser?.id || null : null } : prev));
    setWhatsConvs((prev) =>
      prev.map((c) =>
        c.id === conv.id ? { ...c, modo_humano: enabled, tomado_por: enabled ? currentUser?.id || null : null } : c
      )
    );
    showToast(enabled ? "Ahora la conversación está en modo HUMANO" : "La conversación volvió al BOT");
  };

  const setConvVisto = async (conv, visto) => {
    if (!conv) return;
    // Fecha sentinel para "no leído" manual. Evita confundir una base que aún
    // no tenga la migración `visto_at` aplicada con una conversación pendiente.
    const visto_at = visto ? new Date().toISOString() : "1970-01-01T00:00:00.000Z";
    const { error } = await supabase
      .from("whatsapp_conversaciones")
      .update({ visto_at })
      .eq("id", conv.id);
    if (error) return; // no bloquear la UI por esto — no es crítico
    setSelectedConv((prev) => (prev && prev.id === conv.id ? { ...prev, visto_at } : prev));
    setWhatsConvs((prev) => prev.map((c) => (c.id === conv.id ? { ...c, visto_at } : c)));
    if (!visto) showToast("Conversación marcada como no leída");
  };

  /** Marca en bulk como "perdidas" las conversaciones seleccionadas (limpieza de atoradas viejas sin caso). */
  const marcarPerdidasBulk = async (convIds) => {
    if (!convIds.length) return;
    setMarcandoPerdidas(true);
    try {
      const leadIds = whatsConvs
        .filter((c) => convIds.includes(c.id) && c.lead_id)
        .map((c) => c.lead_id);

      const { error: convError } = await supabase
        .from("whatsapp_conversaciones")
        .update({ estado: "cerrada", fase: "perdido" })
        .in("id", convIds);
      if (convError) { showToast("Error cerrando conversaciones", "error"); return; }

      if (leadIds.length) {
        await supabase.from("leads").update({ stage: "perdido" }).in("id", leadIds);
        await supabase.from("lead_activities").insert(
          leadIds.map((leadId) => ({
            lead_id: leadId,
            actor_id: currentUser?.id || null,
            event_type: "stage_changed",
            title: "Lead perdido",
            detail: "Marcado en bulk desde limpieza de conversaciones atoradas",
          }))
        );
      }

      setWhatsConvs((prev) =>
        prev.map((c) => (convIds.includes(c.id) ? { ...c, estado: "cerrada", fase: "perdido" } : c))
      );
      setLeads((prev) => prev.map((l) => (leadIds.includes(l.id) ? { ...l, stage: "perdido" } : l)));
      setSelectedAtoradaIds([]);
      showToast(`${convIds.length} conversaciones marcadas como perdidas`);
    } finally {
      setMarcandoPerdidas(false);
    }
  };

  /** Al salir de una conversación tomada por un asesor, permite elegir si el bot retoma el control o si se conserva el modo humano. */
  const confirmReturnToBotIfNeeded = async (thenDo) => {
    if (view !== "convs" || !selectedConv?.modo_humano) {
      thenDo();
      return;
    }
    setPendingExitAction(() => thenDo);
    setExitDecisionOpen(true);
  };

  const continueManualAndLeave = () => {
    const action = pendingExitAction;
    setExitDecisionOpen(false);
    setPendingExitAction(null);
    action?.();
  };

  const returnToBotAndLeave = async () => {
    const action = pendingExitAction;
    setExitDecisionOpen(false);
    setPendingExitAction(null);
    await setHumanMode(selectedConv, false);
    action?.();
  };

  const sendAgentReply = async (messageText) => {
    const text = (messageText ?? "").trim();
    if (!selectedConv || !text || sendingAgentRef.current) return false;
    sendingAgentRef.current = true;
    setSendingAgent(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selectedConv.whatsapp,
          body: text,
          leadId: selectedConv.lead_id,
          agentUserId: currentUser?.id || null,
        }),
      });
      if (!res.ok) {
        let errMsg = "Error enviando mensaje de WhatsApp";
        try {
          const data = await res.json();
          if (data?.detail) errMsg = data.detail;
          else if (data?.error) errMsg = data.error;
        } catch {}
        showToast(errMsg, "error");
        return false;
      }

      const now = new Date().toISOString();
      const msgToShow = { id: `local-${now}`, rol: "agente", contenido: text, created_at: now };

      // El insert y update reales ya los hace /api/whatsapp/send del lado del servidor.
      // Aquí solo reflejamos el envío en la UI de forma optimista, sin volver a escribir en la base.
      setConvMessages((prev) => [...prev, msgToShow]);
      setSelectedConv((prev) =>
        prev ? { ...prev, ultimo_mensaje_at: now, modo_humano: true, tomado_por: currentUser?.id || null } : prev
      );
      setWhatsConvs((prev) =>
        prev.map((c) =>
          c.id === selectedConv.id
            ? { ...c, ultimo_mensaje_at: now, modo_humano: true, tomado_por: currentUser?.id || null }
            : c
        )
      );
      showToast("Mensaje enviado. Si no llega a WhatsApp, el número debe haber iniciado chat con el bot (sandbox).");

      await logLeadActivity({
        leadId: selectedConv.lead_id,
        eventType: "agent_reply_sent",
        title: "Respuesta enviada por vendedor",
        detail: text,
        meta: { conversacion_id: selectedConv.id, whatsapp: selectedConv.whatsapp },
      });
      return true;
    } catch (e) {
      showToast(e?.message || "Error enviando mensaje de WhatsApp", "error");
      return false;
    } finally {
      sendingAgentRef.current = false;
      setSendingAgent(false);
    }
  };

  const fetchPlantillas = async () => {
    setLoadingPlantillas(true);
    try {
      const res = await fetch("/api/whatsapp/plantillas");
      const data = await res.json();
      setPlantillas(data?.templates || []);
    } catch (e) {
      showToast("Error cargando plantillas aprobadas", "error");
    } finally {
      setLoadingPlantillas(false);
    }
  };

  const sendPlantilla = async (templateName, renderedBody, templateParams) => {
    if (!selectedConv || sendingReactivacion) return;
    setSendingReactivacion(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selectedConv.whatsapp,
          templateName,
          templateParams,
          body: renderedBody,
          leadId: selectedConvLead?.id || null,
          agentUserId: currentUser?.id || null,
          fase: "seguimiento",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data?.error || data?.detail || "Error enviando plantilla", "error");
        return;
      }
      const now = new Date().toISOString();
      setConvMessages((prev) => [...prev, { id: `local-${now}`, rol: "agente", contenido: renderedBody, created_at: now }]);
      showToast("Plantilla enviada. El lead puede responderte ahora.");
    } catch (e) {
      showToast(e?.message || "Error enviando plantilla", "error");
    } finally {
      setSendingReactivacion(false);
    }
  };

  const sendLeadInformation = async (lead) => {
    if (!lead?.id || (!lead?.whatsapp && !lead?.messenger_psid)) {
      showToast("Este lead no tiene WhatsApp ni Messenger registrado", "error");
      return;
    }

    const existingConversation = whatsConvs.find(
      (conv) => conv.lead_id === lead.id || conv.whatsapp === (lead.whatsapp || lead.messenger_psid)
    );

    if (!existingConversation) {
      showToast("Este lead aún no ha iniciado chat. Para un primer mensaje por WhatsApp necesitas una template aprobada.", "error");
      return;
    }

    const message = (leadInfoDraft || "").trim();
    if (!message) {
      showToast("Escribe el mensaje que deseas enviar", "error");
      return;
    }

    setSendingInfoLeadId(lead.id);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: lead.whatsapp || lead.messenger_psid,
          body: message,
          leadId: lead.id,
          agentUserId: currentUser?.id || null,
          fase: "seguimiento",
        }),
      });

      if (!res.ok) {
        let errMsg = "Error enviando información por WhatsApp";
        try {
          const data = await res.json();
          if (data?.detail) errMsg = data.detail;
          else if (data?.error) errMsg = data.error;
        } catch {}
        showToast(errMsg, "error");
        return;
      }

      const responseData = await res.json().catch(() => ({}));

      await logLeadActivity({
        leadId: lead.id,
        eventType: "agent_reply_sent",
        title: "Información enviada por WhatsApp",
        detail: message,
        meta: { whatsapp: lead.whatsapp, source: "lead_detail", provider_status: responseData?.status || null },
      });

      const now = new Date().toISOString();
      setWhatsConvs((prev) => {
        const existing = prev.find((conv) => conv.lead_id === lead.id || conv.whatsapp === lead.whatsapp);
        if (!existing) return prev;
        return prev.map((conv) =>
          conv.id === existing.id
            ? {
                ...conv,
                lead_id: lead.id,
                ultimo_mensaje_at: now,
                modo_humano: true,
                tomado_por: currentUser?.id || null,
                fase: "seguimiento",
                estado: "abierta",
              }
            : conv
        );
      });

      showToast("Mensaje aceptado por WhatsApp. Si no llega, revisa la ventana activa de 24 horas o usa template.");
    } catch (e) {
      showToast(e?.message || "Error enviando información por WhatsApp", "error");
    } finally {
      setSendingInfoLeadId(null);
    }
  };

  const getFuenteLead = (l) => {
    if (l.origen === "meta_ads" || l.origen === "ads") return "meta_ads";
    if (l.origen === "walkin") return "walkin";
    if (l.origen === "registro_wa") return "registro_wa";
    if (l.origen === "manual") return "manual";
    if (l.origen === "bot" || (!l.origen && l.notas?.includes("automáticamente desde WhatsApp"))) return "bot";
    return "manual";
  };
  const FUENTE_LABELS = {
    bot: "Bot WhatsApp",
    manual: "Manual",
    meta_ads: "Meta Ads",
    walkin: "Walk-in",
    registro_wa: "Registro WhatsApp",
  };

  // Mismo cálculo que el desglose "Por programa" (stats), pero sobre todos los leads y
  // expuesto como opciones agrupadas para el filtro (valor = key específico, no el group).
  const ofertaOptions = useMemo(() => {
    const conteo = { idiomas: {}, bachillerato: {}, licenciaturas: {}, maestrias: {}, otros: {}, diplomados: {} };
    leads.forEach(l => {
      const programa = getProgramaResumen(l.curso);
      if (!programa) return;
      const bucket = conteo[programa.group];
      bucket[programa.key] = bucket[programa.key] || { key: programa.key, label: programa.label, count: 0 };
      bucket[programa.key].count += 1;
    });
    return ["idiomas", "bachillerato", "licenciaturas", "maestrias", "diplomados", "otros"]
      .map((group) => ({
        group,
        label: OFERTA_LABELS[group],
        items: Object.values(conteo[group]).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es")),
      }))
      .filter((g) => g.items.length > 0);
  }, [leads]);

  const filteredLeads = useMemo(() => leads.filter(l => {
    // Asesores solo ven sus propios leads
    if (!isAdmin && currentProfile?.id) {
      if (l.asignado_a !== currentProfile.id) return false;
    }
    const matchV = filterVendedor === "Todos" || l.asignado_a === filterVendedor;
    const matchF = filterFuente === "Todos" || getFuenteLead(l) === filterFuente;
    const matchO = filterOferta === "Todos" || getProgramaResumen(l.curso)?.key === filterOferta;
    const searchClean = search.replace(/\D/g, '');
    const whatsappClean = (l.whatsapp || '').replace(/\D/g, '');
    const matchS = (l.nombre || '').toLowerCase().includes(search.toLowerCase()) ||
      (l.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (searchClean.length >= 4 && whatsappClean.includes(searchClean)) ||
      (!searchClean && (l.whatsapp || '').toLowerCase().includes(search.toLowerCase()));
    return matchV && matchF && matchO && matchS;
  }), [leads, isAdmin, currentProfile?.id, filterVendedor, filterFuente, filterOferta, search]);

  // Conversaciones "atoradas": abiertas, en fase temprana sin resolver, sin actividad hace +3h.
  const FASES_ATORABLES = ["saludo", "programa", "correo", "verano_disambig"];
  const esAtorada = (conv) =>
    conv.estado !== "cerrada" &&
    FASES_ATORABLES.includes(conv.fase) &&
    !!conv.ultimo_mensaje_at &&
    (Date.now() - new Date(conv.ultimo_mensaje_at).getTime()) > 3 * 60 * 60 * 1000;
  const atoradasCount = useMemo(() => whatsConvs.filter(esAtorada).length, [whatsConvs]);

  const conversationPhaseOptions = useMemo(
    () => ["todas", ...Array.from(new Set(whatsConvs.map((c) => c.fase).filter(Boolean)))],
    [whatsConvs]
  );
  const conversacionesVentanaActiva = useMemo(() => {
    const ahora = Date.now();
    return whatsConvs.filter((conv) => {
      const ultimoUsuarioAt = ultimoUsuarioAtPorConv[conv.id];
      if (!ultimoUsuarioAt) return false;
      const elapsed = ahora - new Date(ultimoUsuarioAt).getTime();
      return elapsed >= 0 && elapsed < 24 * 60 * 60 * 1000;
    }).length;
  }, [whatsConvs, ultimoUsuarioAtPorConv]);
  const filteredWhatsConvs = useMemo(() => whatsConvs.filter((conv) => {
    // Asesores solo ven conversaciones de sus leads
    if (!isAdmin && currentProfile?.id) {
      const lead = leads.find((l) => l.id === conv.lead_id);
      if (lead && lead.asignado_a !== currentProfile.id) return false;
    }
    const searchValue = convSearch.trim().toLowerCase();
    const matchesSearch =
      !searchValue ||
      conv.whatsapp?.toLowerCase().includes(searchValue) ||
      leads.find((lead) => lead.id === conv.lead_id)?.nombre?.toLowerCase().includes(searchValue) ||
      leads.find((lead) => lead.id === conv.lead_id)?.email?.toLowerCase().includes(searchValue);
    const matchesMode =
      convModeFilter === "todos" ||
      (convModeFilter === "humano" ? !!conv.modo_humano : !conv.modo_humano);
    const matchesPhase =
      convPhaseFilter === "todas" || (conv.fase || "—") === convPhaseFilter;
    // La ventana de WhatsApp se abre por el ÚLTIMO mensaje del prospecto,
    // no por una respuesta posterior del bot o del asesor.
    const ultimoUsuarioAt = ultimoUsuarioAtPorConv[conv.id];
    const elapsedDesdeUsuario = ultimoUsuarioAt ? Date.now() - new Date(ultimoUsuarioAt).getTime() : null;
    const matchesVentana = !convVentanaFilter ||
      (elapsedDesdeUsuario !== null && elapsedDesdeUsuario >= 0 && elapsedDesdeUsuario < 24 * 60 * 60 * 1000);
    const matchesAtorada = !convAtoradaFilter || esAtorada(conv);
    return matchesSearch && matchesMode && matchesPhase && matchesVentana && matchesAtorada;
  }), [whatsConvs, ultimoUsuarioAtPorConv, isAdmin, currentProfile, leads, convSearch, convModeFilter, convPhaseFilter, convVentanaFilter, convAtoradaFilter]);

  const selectedConvLead = leads.find((lead) => lead.id === selectedConv?.lead_id) || null;
  const selectedConvOwner = vendedores.find((v) => v.id === selectedConv?.tomado_por) || null;
  const selectedLeadAssigned = vendedores.find((v) => v.id === selectedConvLead?.asignado_a) || null;

  const getPhaseLabel = (fase) => {
    const labels = {
      saludo: "Saludo",
      programa: "Programa",
      correo: "Correo",
      info_enviada: "Info enviada",
      dudas: "Dudas",
      accion: "Acción",
      seguimiento: "Seguimiento",
      cerrado: "Cerrado",
      perdido: "Perdido",
    };
    return labels[fase] || fase || "Sin fase";
  };

  const getModeLabel = (conv) => conv?.modo_humano ? "Humano" : "Bot";

  const getConversationBadgeStyle = (type, value) => {
    if (type === "mode") {
      return value
        ? { background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d" }
        : { background: "#dcfce7", color: "#15803d", border: "1px solid #86efac" };
    }

    if (type === "phase") {
      const palette = {
        saludo: ["#dbeafe", "#1e40af", "#93c5fd"],
        programa: ["#fef3c7", "#92400e", "#fcd34d"],
        correo: ["#e0f2fe", "#0369a1", "#7dd3fc"],
        info_enviada: ["#dcfce7", "#15803d", "#86efac"],
        dudas: ["#ede9fe", "#6d28d9", "#c4b5fd"],
        accion: ["#ffedd5", "#c2410c", "#fdba74"],
        seguimiento: ["#fef9c3", "#854d0e", "#fde047"],
        cerrado: ["#d1fae5", "#065f46", "#6ee7b7"],
        perdido: ["#fee2e2", "#991b1b", "#fca5a5"],
      };
      const [bg, color, border] = palette[value] || ["#f1f5f9", "#64748b", "#cbd5e1"];
      return { background: bg, color, border: `1px solid ${border}` };
    }

    return { background: "#f1f5f9", color: "#64748b", border: "1px solid #cbd5e1" };
  };

  const getLeadNextStep = (lead) => {
    const currentStage = normalizeStage(lead?.stage);
    const relatedConv = whatsConvs.find((conv) => conv.lead_id === lead?.id);
    const upcomingCita = citas
      .filter((cita) => cita.lead_id === lead?.id)
      .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`))[0];

    if (upcomingCita) {
      return `Confirmar ${upcomingCita.tipo === "clase_prueba" ? "clase muestra" : upcomingCita.tipo === "asesoria" ? "asesoría" : upcomingCita.tipo === "examen_ubicacion" ? "examen de ubicación" : "proceso de inscripción"} del ${upcomingCita.fecha} a las ${upcomingCita.hora?.slice(0, 5) || "hora pendiente"}.`;
    }
    if (relatedConv?.fase === "dudas") return "Responder dudas y llevar al prospecto al siguiente paso.";
    if (relatedConv?.fase === "accion" || relatedConv?.fase === "seguimiento") return "Cerrar con CTA claro: asesoría, examen de ubicación o inscripción.";
    if (currentStage === "primer_contacto") return "Hacer primer contacto y confirmar interés real.";
    if (currentStage === "examen_ubicacion") return "Invitar o confirmar examen de ubicación.";
    if (currentStage === "clase_muestra") return "Agendar o confirmar clase muestra.";
    if (currentStage === "segundo_contacto") return "Dar segundo seguimiento y resolver dudas pendientes.";
    if (currentStage === "promocion_enviada") return "Confirmar recepción de la promoción y medir interés.";
    if (currentStage === "tercer_contacto") return "Hacer último seguimiento comercial antes de archivar.";
    if (currentStage === "inscripcion_pendiente") return "Cerrar inscripción y acompañar el proceso administrativo.";
    if (currentStage === "inscrito") return "Mantener seguimiento post-inscripción.";
    if (currentStage === "perdido") return "Revisar si conviene reactivar más adelante.";
    if (currentStage === "archivado") return "Lead archivado; reactivar solo si vuelve a mostrar interés.";
    return "Actualizar siguiente paso comercial.";
  };

  const getCitaStatusStyle = (status) => {
    const map = {
      pendiente: { background: "#fef9c3", color: "#854d0e", border: "1px solid #fde047" },
      confirmada: { background: "#dcfce7", color: "#15803d", border: "1px solid #86efac" },
      completada: { background: "#dbeafe", color: "#1e40af", border: "1px solid #93c5fd" },
      cancelada: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" },
    };
    return map[status] || { background: "#f1f5f9", color: "#64748b", border: "1px solid #cbd5e1" };
  };

  const getConversationPhaseForStage = (stage) => {
    const map = {
      primer_contacto: "saludo",
      examen_ubicacion: "accion",
      clase_muestra: "accion",
      segundo_contacto: "seguimiento",
      promocion_enviada: "seguimiento",
      tercer_contacto: "seguimiento",
      inscripcion_pendiente: "accion",
      inscrito: "cerrado",
      perdido: "perdido",
      archivado: "seguimiento",
    };
    return map[normalizeStage(stage)] || null;
  };

  const conversationKeys = useMemo(() => {
    const keys = new Set();
    for (const c of whatsConvs) {
      if (c.lead_id) keys.add(`id:${c.lead_id}`);
      if (c.whatsapp) keys.add(`wa:${c.whatsapp}`);
    }
    return keys;
  }, [whatsConvs]);
  const hasConversation = (lead) => conversationKeys.has(`id:${lead.id}`) || conversationKeys.has(`wa:${lead.whatsapp}`);

  const leadsByStage = useMemo(() => {
    const map = {};
    for (const l of filteredLeads) {
      const stageId = normalizeStage(l.stage);
      (map[stageId] ||= []).push(l);
    }
    return map;
  }, [filteredLeads]);
  const byStage = (stageId) => leadsByStage[stageId] || [];

  const moveStage = async (leadId, newStage, notas = "") => {
    const lead = leads.find((item) => item.id === leadId);
    const previousStage = normalizeStage(lead?.stage);
    const { data: updData, error } = await supabase.from("leads").update({ stage: newStage }).eq("id", leadId).select("id");
    if (error) return showToast("Error actualizando: " + error.message, "error");
    if (!updData || updData.length === 0) return showToast("Sin permiso para mover este lead", "error");

    const nextFase = getConversationPhaseForStage(newStage);
    if (nextFase) {
      const nextEstado = ["cerrado", "perdido"].includes(nextFase) ? "cerrada" : "abierta";
      await supabase
        .from("whatsapp_conversaciones")
        .update({ fase: nextFase, estado: nextEstado })
        .eq("lead_id", leadId);

      setWhatsConvs((prev) =>
        prev.map((conv) =>
          conv.lead_id === leadId ? { ...conv, fase: nextFase, estado: nextEstado } : conv
        )
      );

      setSelectedConv((prev) =>
        prev && prev.lead_id === leadId ? { ...prev, fase: nextFase, estado: nextEstado } : prev
      );
    }

    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: newStage } : l));
    const notaTrim = (notas || "").trim();
    await logLeadActivity({
      leadId,
      eventType: "stage_changed",
      title: "Etapa actualizada",
      detail: `${STAGES.find((s) => s.id === previousStage)?.label || previousStage || "Sin etapa"} -> ${STAGES.find((s) => s.id === newStage)?.label || newStage}` + (notaTrim ? `\nNota: ${notaTrim}` : ""),
      meta: { from: previousStage || null, to: newStage },
    });
    showToast("Lead movido a " + STAGES.find(s => s.id === newStage)?.label);
  };

  const handleDrop = (stageId) => {
    if (dragId) { moveStage(dragId, stageId); setDragId(null); }
  };

  const normalizarWhatsapp = (num) => {
    if (!num) return num;
    let n = num.replace(/\s+/g, "").replace(/[^\d+]/g, "");
    if (!n.startsWith("+")) {
      const digits = n.replace(/\D/g, "");
      if (digits.length === 10) n = `+52${digits}`;
      else if (digits.length === 12 && digits.startsWith("52")) n = `+${digits}`;
      else n = `+${digits}`;
    }
    return n;
  };

  const addLead = async () => {
    if (!newLead.nombre) return showToast("El nombre es requerido", "error");
    if (newLead.whatsapp) {
      const digits = newLead.whatsapp.replace(/\D/g, "");
      if (digits.length > 0 && digits.length < 10) return showToast("El número WhatsApp debe tener 10 dígitos (ej. 7471234567)", "error");
      const normalized = normalizarWhatsapp(newLead.whatsapp);
      const existente = leads.find(l => l.whatsapp && l.whatsapp.replace(/\D/g, '') === normalized.replace(/\D/g, ''));
      if (existente) return showToast(`Este número ya existe: ${existente.nombre || existente.whatsapp}`, "error");
    }
    const lead = {
      ...newLead,
      whatsapp: normalizarWhatsapp(newLead.whatsapp),
      stage: "primer_contacto",
      fecha: todayCST(),
      valor: Number(newLead.valor) || 0,
      user_id: currentUser.id,
      asignado_a: newLead.asignado_a || currentUser.id,
      origen: "manual",
    };
    const { data, error } = await supabase.from("leads").insert([lead]).select();
    if (error) {
      const detalle = error.message || error.code || "desconocido";
      return showToast(`Error al guardar lead: ${detalle}`, "error");
    }
    setLeads(prev => [data[0], ...prev]);
    await logLeadActivity({
      leadId: data[0].id,
      eventType: "lead_created",
      title: "Lead creado manualmente",
      detail: `${data[0].nombre} · ${data[0].curso}`,
      meta: { source: "crm_manual" },
    });
    setShowForm(false);
    setNewLead({ nombre: "", email: "", whatsapp: "", curso: CURSOS[0], valor: "", notas: "", asignado_a: currentUser.id });
    showToast("Lead guardado ✓");
    if (data[0].whatsapp) {
      fetch("/api/whatsapp/bienvenida", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: data[0].id }),
      }).then(async (res) => {
        if (res.ok) {
          showToast("WhatsApp de bienvenida enviado ✓");
          fetchWhatsConvs();
        } else {
          const err = await res.json().catch(() => ({}));
          const motivo = err.error || "Error Meta";
          showToast(`Lead guardado ✓ — WhatsApp no enviado: ${motivo}`, "error");
        }
      }).catch(() => {});
    }
  };

  const deleteLead = async (id) => {
    const { error, data } = await supabase.from("leads").delete().eq("id", id).select();
    if (error) return showToast("Error eliminando: " + error.message, "error");
    if (!data || data.length === 0) return showToast("Sin permiso para eliminar este lead", "error");
    setLeads(prev => prev.filter(l => l.id !== id));
    setSelectedLead(null);
    showToast("Lead eliminado");
  };

  const updateNotas = async (id, notas) => {
    const { data, error } = await supabase.from("leads").update({ notas }).eq("id", id).select("id");
    if (error) { showToast("Error guardando notas: " + error.message, "error"); return; }
    if (!data || data.length === 0) { showToast("Sin permiso para editar este lead", "error"); return; }
    setLeads(prev => prev.map(l => l.id === id ? { ...l, notas } : l));
  };

  const updateLeadField = async (id, field, value) => {
    const { error, data } = await supabase.from("leads").update({ [field]: value }).eq("id", id).select();
    if (error) return showToast("Error guardando: " + error.message, "error");
    if (!data || data.length === 0) return showToast("Sin permiso para editar este lead", "error");
    setLeads(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
    showToast("Guardado ✓");
  };

  const reasignarLead = async (leadId, nuevoAsignadoId) => {
    const { error } = await supabase.from("leads").update({ asignado_a: nuevoAsignadoId }).eq("id", leadId);
    if (error) return showToast("Error reasignando", "error");
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, asignado_a: nuevoAsignadoId } : l));
    setSelectedLead(prev => ({ ...prev, asignado_a: nuevoAsignadoId }));
    const nombre = vendedores.find(v => v.id === nuevoAsignadoId)?.nombre || "vendedor";
    await logLeadActivity({
      leadId,
      eventType: "lead_assigned",
      title: "Lead reasignado",
      detail: `Asignado a ${nombre}`,
      meta: { asignado_a: nuevoAsignadoId || null },
    });
    showToast(`Lead reasignado a ${nombre} ✓`);
  };

  const getNombreVendedor = (id) => vendedores.find(v => v.id === id)?.nombre || vendedores.find(v => v.id === id)?.email?.split("@")[0] || "—";

  const totalRevenue = leads.filter((l) => normalizeStage(l.stage) === "inscrito").reduce((a, b) => a + b.valor, 0);
  const pipelineValue = leads.filter((l) => !["inscrito", "perdido", "archivado"].includes(normalizeStage(l.stage))).reduce((a, b) => a + b.valor, 0);
  const convRate = leads.length ? Math.round((leads.filter((l) => normalizeStage(l.stage) === "inscrito").length / leads.length) * 100) : 0;

  const openWA = (lead) => {
    if (!lead.whatsapp) {
      return showToast("Este lead llegó por Messenger, no tiene número de WhatsApp", "error");
    }
    const template = WA_TEMPLATES[normalizeStage(lead.stage)] || WA_TEMPLATES["primer_contacto"];
    const msg = encodeURIComponent(template((lead.nombre || '').split(" ")[0] || 'estimado/a', lead.curso));
    const num = lead.whatsapp.replace(/\D/g, "");
    window.open(`https://wa.me/${num}?text=${msg}`, "_blank");
  };

  const guardarCita = async () => {
    if (!nuevaCita.lead_id || !nuevaCita.fecha || !nuevaCita.hora) {
      return showToast("Lead, fecha y hora son obligatorios", "error");
    }

    const citaDateTime = new Date(`${nuevaCita.fecha}T${nuevaCita.hora}`);
    if (Number.isNaN(citaDateTime.getTime())) {
      return showToast("La fecha u hora de la cita no es válida", "error");
    }
    if (citaDateTime.getTime() < Date.now() - 60 * 1000) {
      return showToast("No puedes agendar una cita en el pasado", "error");
    }

    const lead = leads.find((l) => l.id === nuevaCita.lead_id);
    if (!lead || !currentUser) {
      return showToast("Lead o usuario no válido", "error");
    }

    const titulo = `${nuevaCita.tipo === "clase_prueba" ? "Clase muestra" : nuevaCita.tipo === "asesoria" ? "Asesoría" : nuevaCita.tipo === "examen_ubicacion" ? "Examen de ubicación" : "Inscripción"} con ${lead.nombre}`;

    const { data, error } = await supabase
      .from("citas")
      .insert([
        {
          lead_id: nuevaCita.lead_id,
          vendedor_id: currentUser.id,
          titulo,
          fecha: nuevaCita.fecha,
          hora: nuevaCita.hora,
          duracion: nuevaCita.duracion,
          tipo: nuevaCita.tipo,
          notas: nuevaCita.notas,
          status: "pendiente",
        },
      ])
      .select();

    if (error) {
      showToast("Error guardando la cita", "error");
      return;
    }

    const stageForTipo = {
      clase_prueba: "clase_muestra",
      examen_ubicacion: "examen_ubicacion",
      inscripcion: "inscripcion_pendiente",
      asesoria: "segundo_contacto",
    };
    const newStage = stageForTipo[nuevaCita.tipo] || "segundo_contacto";

    await supabase.from("leads").update({ stage: newStage }).eq("id", lead.id);
    setCitas((prev) => [...prev, data[0]]);
    setLeads((prev) => prev.map((item) => item.id === lead.id ? { ...item, stage: newStage } : item));
    setSelectedLead((prev) => prev && prev.id === lead.id ? { ...prev, stage: newStage } : prev);
    await logLeadActivity({
      leadId: lead.id,
      eventType: "appointment_created",
      title: "Cita agendada",
      detail: `${titulo} · ${nuevaCita.fecha} ${nuevaCita.hora}`,
      meta: { cita_id: data[0].id, status: "pendiente", tipo: nuevaCita.tipo },
    });
    await logLeadActivity({
      leadId: lead.id,
      eventType: "stage_changed",
      title: "Etapa actualizada",
      detail: `${STAGES.find((s) => s.id === normalizeStage(lead.stage))?.label || normalizeStage(lead.stage)} -> ${STAGES.find((s) => s.id === newStage)?.label || newStage}`,
      meta: { from: normalizeStage(lead.stage), to: newStage, reason: "appointment_created" },
    });
    setShowCitaForm(false);
    setNuevaCita({
      lead_id: "",
      fecha: "",
      hora: "",
      tipo: "asesoria",
      duracion: 30,
      notas: "",
    });
    showToast("Cita agendada ✓");
  };

  const updateCitaStatus = async (citaId, status) => {
    const { error } = await supabase.from("citas").update({ status }).eq("id", citaId);
    if (error) {
      showToast("Error actualizando estado de cita", "error");
      return;
    }
    const cita = citas.find((item) => item.id === citaId);
    setCitas((prev) => prev.map((cita) => cita.id === citaId ? { ...cita, status } : cita));
    if (cita?.lead_id) {
      await logLeadActivity({
        leadId: cita.lead_id,
        eventType: "appointment_status_changed",
        title: "Estado de cita actualizado",
        detail: `La cita ${cita.titulo || citaId} ahora esta ${status}`,
        meta: { cita_id: citaId, status },
      });
    }
    showToast(`Cita marcada como ${status}`);
  };

  const leadsForAI = leads.map((l) => {
    const vendedor = vendedores.find((v) => v.id === l.asignado_a);
    const asignadoNombre =
      vendedor?.nombre || vendedor?.email?.split("@")[0] || null;

    return {
      id: l.id,
      nombre: l.nombre,
      email: l.email,
      curso: l.curso,
      stage: l.stage,
      valor: l.valor,
      asignado_id: l.asignado_a || null,
      asignado_nombre: asignadoNombre,
      fecha: l.fecha,
    };
  });

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const newMessages = [
      ...chatMessages,
      { role: "user", content: chatInput.trim() },
    ];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, leads: leadsForAI }),
      });

      if (!res.ok) {
        showToast("Error hablando con el asistente de ventas", "error");
        setChatLoading(false);
        return;
      }

      const data = await res.json();
      const reply = data?.reply?.content || "No pude generar una respuesta.";

      setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      showToast("Error de red con el asistente", "error");
    } finally {
      setChatLoading(false);
    }
  };

  const startLabSimulation = () => {
    const initialState =
      labScenario === "walkin"
        ? {
            origen: "walkin",
            nombre: labWalkinData.nombre,
            email: labWalkinData.email,
            programa: labWalkinData.programa,
            fase: "info_enviada",
            nextStep: "Resolver dudas o llevar al siguiente paso",
          }
        : {
            origen: "ads",
            nombre: "",
            email: "",
            programa: "",
            fase: "saludo",
            nextStep: "Capturar nombre",
          };

    const openingMessage =
      labScenario === "walkin"
        ? `Hola ${labWalkinData.nombre || ""}, soy el asistente de Instituto Windsor. Ya tenemos tu registro de interés en *${labWalkinData.programa || "el programa"}*. ¿Tienes alguna duda o quieres saber el siguiente paso?`
        : "Hola, gracias por comunicarte con Instituto Windsor. ¿Me compartes tu nombre, por favor?";

    setLabState(initialState);
    setLabMessages([{ role: "assistant", content: openingMessage }]);
    setLabInput("");
    setLabStarted(true);
  };

  const sendLabMessage = async () => {
    if (!labInput.trim() || labSending) return;
    const userMessage = labInput.trim();
    setLabSending(true);
    const nextMessages = [...labMessages, { role: "user", content: userMessage }];
    setLabMessages(nextMessages);
    setLabInput("");

    try {
      const res = await fetch("/api/whatsapp/lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: labMessages,
          state: labState,
          userMessage,
          scenario: labScenario,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setLabMessages([...nextMessages, { role: "assistant", content: "Error al conectar con el bot. Intenta de nuevo." }]);
        setLabSending(false);
        return;
      }

      const newState = {
        ...labState,
        fase: data.siguienteFase || labState.fase,
        nextStep: data.nextStep || labState.nextStep,
        nombre: data.nombre || labState.nombre,
        email: data.email || labState.email,
        programa: data.programa || labState.programa,
      };

      setLabState(newState);
      setLabMessages([...nextMessages, { role: "assistant", content: data.respuesta || "..." }]);
    } catch {
      setLabMessages([...nextMessages, { role: "assistant", content: "Error de red. Intenta de nuevo." }]);
    } finally {
      setLabSending(false);
    }
  };

  const resetLabSimulation = () => {
    setLabStarted(false);
    setLabMessages([]);
    setLabInput("");
    setLabSending(false);
    setLabState({
      origen: labScenario,
      nombre: "",
      email: "",
      programa: "",
      fase: "saludo",
      nextStep: labScenario === "walkin" ? "Cargar contexto inicial" : "Pedir nombre",
    });
  };

  return (
    <div style={{ fontFamily: "'DM Mono', 'Courier New', monospace", background: "#f5f7fa", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", color: "#1a1a1a" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #e2e8f0; }
        ::-webkit-scrollbar-thumb { background: #2C4A8C; border-radius: 2px; }
        .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; transition: all 0.2s; cursor: grab; }
        .card:hover { border-color: #A8263C; transform: translateY(-2px); box-shadow: 0 4px 20px rgba(200,16,46,0.12); }
        .card:active { cursor: grabbing; }
        .btn { border: none; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 500; transition: all 0.15s; }
        .btn-primary { background: #A8263C; color: #ffffff; padding: 8px 16px; }
        .btn-primary:hover { background: #8a1e30; }
        .btn-ghost { background: transparent; color: #64748b; padding: 6px 12px; border: 1px solid #cbd5e1; }
        .btn-ghost:hover { border-color: #2C4A8C; color: #2C4A8C; }
        .btn-wa { background: #25D366; color: white; padding: 5px 10px; }
        .btn-wa:hover { background: #20b858; }
        .input { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; color: #1a1a1a; font-family: inherit; font-size: 13px; padding: 8px 12px; width: 100%; outline: none; transition: border 0.2s; }
        .input:focus { border-color: #2C4A8C; }
        .select { appearance: none; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; color: #1a1a1a; font-family: inherit; font-size: 13px; padding: 8px 12px; width: 100%; outline: none; cursor: pointer; }
        .select:focus { border-color: #2C4A8C; }
        .tag { display: inline-block; border-radius: 4px; font-size: 10px; font-weight: 500; padding: 2px 7px; letter-spacing: 0.5px; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9000; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .modal { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 520px; width: 100%; max-height: 90vh; overflow-y: auto; }
        .toast { position: fixed; bottom: 24px; right: 24px; z-index: 9999; padding: 12px 20px; border-radius: 8px; font-size: 13px; animation: slideUp 0.3s ease; }
        @keyframes slideUp { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform: translateY(0); } }
        .col-drop { min-height: 80px; border-radius: 6px; transition: background 0.2s; }
        .col-drop.drag-over { background: rgba(200,16,46,0.05); border: 1px dashed #A8263C; }
        .stat-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; }
        .nav-btn { background: transparent; border: none; cursor: pointer; font-family: inherit; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; padding: 8px 16px; border-radius: 6px; transition: all 0.15s; }
        .nav-btn.active { background: #A8263C; color: #ffffff; font-weight: 500; }
        .nav-btn:not(.active) { color: rgba(255,255,255,0.7); }
        .nav-btn:not(.active):hover { color: #ffffff; background: rgba(255,255,255,0.1); }
        textarea { resize: vertical; min-height: 60px; }
        .loading { display: flex; align-items: center; justify-content: center; height: 200px; font-size: 14px; color: #64748b; }
        .admin-badge { background: rgba(200,16,46,0.12); color: #A8263C; border: 1px solid rgba(200,16,46,0.3); border-radius: 4px; font-size: 10px; padding: 2px 8px; letter-spacing: 1px; }
        .hamburger-btn { background: transparent; border: none; cursor: pointer; padding: 8px; color: #ffffff; }
        .mobile-only { display: none; }
        .crm-tagline { display: inline; }
        .program-summary { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; }
        .program-summary > summary, .program-diplomados > summary { list-style: none; cursor: pointer; }
        .program-summary > summary::-webkit-details-marker, .program-diplomados > summary::-webkit-details-marker { display: none; }
        .program-summary > summary { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; color: #334155; font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
        .program-summary > summary::after { content: "▸"; color: #64748b; font-size: 14px; }
        .program-summary[open] > summary::after { content: "⌄"; }
        .program-summary-content { padding: 0 14px 12px; }
        .program-group-title { margin: 10px 0 5px; color: #888; font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; }
        .program-group-title:first-child { margin-top: 2px; }
        .program-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px; border-bottom: 1px solid #f1f5f9; color: #334155; font-size: 12px; }
        .program-row:last-child { border-bottom: none; }
        .program-count { color: #2C4A8C; font-weight: 700; }
        .program-diplomados { margin-top: 10px; border-top: 1px solid #e2e8f0; }
        .program-diplomados > summary { display: flex; align-items: center; justify-content: space-between; padding-top: 10px; color: #334155; font-size: 11px; font-weight: 600; }
        .program-diplomados > summary::before { content: "▸"; margin-right: 7px; color: #64748b; }
        .program-diplomados[open] > summary::before { content: "⌄"; }
        .program-diplomados > summary span:first-of-type { flex: 1; }
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .desktop-user { display: none !important; }
          .mobile-only { display: flex !important; align-items: center; gap: 8px; }
          .crm-tagline { display: none !important; }
          .crm-admin-badge { display: none !important; }
          .crm-title { font-size: 22px !important; }
          .mobile-menu { display: flex; flex-direction: column; position: absolute; top: 100%; left: 0; right: 0; background: #2C4A8C; border-bottom: 2px solid rgba(200,16,46,0.4); box-shadow: 0 8px 24px rgba(0,0,0,0.2); z-index: 400; padding: 8px 0; }
          .mobile-menu .nav-btn { text-align: left; padding: 12px 20px; border-radius: 0; font-size: 13px; border-bottom: 1px solid rgba(255,255,255,0.1); }
          .mobile-menu .nav-btn:last-child { border-bottom: none; }
          .stat-card-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .modal { max-width: 100% !important; margin: 0 !important; border-radius: 12px 12px 0 0 !important; position: fixed !important; bottom: 0 !important; left: 0 !important; right: 0 !important; max-height: 92vh !important; }
          .modal-overlay { align-items: flex-end !important; padding: 0 !important; }
          .lab-grid { grid-template-columns: 1fr !important; }
          .lab-state-panel { order: 2; }
          .lab-chat-panel { order: 1; min-height: 420px !important; }
          .lab-state-compact { display: flex; flex-wrap: wrap; gap: 8px 16px; }
          .lab-state-compact div { font-size: 11px; }
          .kanban-wrapper { overflow-x: auto !important; -webkit-overflow-scrolling: touch; padding-bottom: 16px; padding-left: 8px !important; padding-right: 8px !important; max-width: 100vw !important; }
          .kanban-wrapper > * { min-width: max-content; }
        }
      `}</style>

      {/* HEADER */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.15)", padding: "0 24px", position: "sticky", top: 0, zIndex: 300, background: "#2C4A8C", overflow: "visible", flexShrink: 0 }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="crm-title" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 3, color: "#ffffff" }}>WINDSOR CRM</span>
            <span className="crm-tagline" style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: 2 }}>CRM v1.0</span>
            {isAdmin && <span className="admin-badge crm-admin-badge">ADMIN</span>}
          </div>

          {/* Desktop nav */}
          <div className="desktop-nav" style={{ display: "flex", gap: 8 }}>
            <button className={`nav-btn ${view === "kanban" ? "active" : ""}`} onClick={() => confirmReturnToBotIfNeeded(() => setView("kanban"))}>KANBAN</button>
            <button className={`nav-btn ${view === "lista" ? "active" : ""}`} onClick={() => confirmReturnToBotIfNeeded(() => setView("lista"))}>LISTA</button>
            <button className={`nav-btn ${view === "agenda" ? "active" : ""}`} onClick={() => confirmReturnToBotIfNeeded(() => setView("agenda"))}>AGENDA</button>
            <button
              className={`nav-btn ${view === "convs" ? "active" : ""}`}
              onClick={() => confirmReturnToBotIfNeeded(() => { setView("convs"); fetchWhatsConvs(); setSelectedConv(null); setConvMessages([]); })}
            >CONVERSACIONES</button>
            <button
              className={`nav-btn ${view === "seguimientos" ? "active" : ""}`}
              onClick={() => confirmReturnToBotIfNeeded(() => { setView("seguimientos"); setPendientesCount(0); })}
              style={{ position: "relative" }}
            >
              SEGUIMIENTOS
              {pendientesCount > 0 && (
                <span style={{ position: "absolute", top: 2, right: 2, background: "#A8263C", color: "#fff", borderRadius: 99, fontSize: 10, padding: "1px 5px", fontWeight: 700, lineHeight: 1.4 }}>
                  {pendientesCount}
                </span>
              )}
            </button>
            <button className={`nav-btn ${view === "reactivaciones" ? "active" : ""}`} onClick={() => confirmReturnToBotIfNeeded(() => setView("reactivaciones"))}>REACTIVACIONES</button>
            <button
              className={`nav-btn ${view === "revision" ? "active" : ""}`}
              onClick={() => confirmReturnToBotIfNeeded(() => { setView("revision"); fetchRevisionDiaria(); })}
            >REVISIÓN</button>
            {isAdmin && (
              <>
                <button className={`nav-btn ${view === "base" ? "active" : ""}`} onClick={() => confirmReturnToBotIfNeeded(() => { setView("base"); loadDocumentos(); })}>BASE</button>
                <button className={`nav-btn ${view === "bot" ? "active" : ""}`} onClick={() => confirmReturnToBotIfNeeded(() => { setView("bot"); loadBotConfig(); })}>BOT</button>
                <button className={`nav-btn ${view === "lab" ? "active" : ""}`} onClick={() => confirmReturnToBotIfNeeded(() => { setView("lab"); resetLabSimulation(); })}>LAB BOT</button>
                <button className={`nav-btn ${view === "flows" ? "active" : ""}`} onClick={() => confirmReturnToBotIfNeeded(() => { setView("flows"); loadWhatsappFlow(); })}>FLOWS</button>
              </>
            )}
          </div>

          {/* Desktop user */}
          <div className="desktop-user" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, color: "#555" }}>{currentProfile?.email || currentUser?.email}</span>
            <button className="btn btn-ghost" style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.25)" }} onClick={() => setShowAyuda(true)}>? Ayuda</button>
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ NUEVO LEAD</button>
          </div>

          {/* Mobile: hamburger + nuevo lead */}
          <div className="mobile-only">
            <button className="btn btn-primary" onClick={() => setShowForm(true)} style={{ fontSize: 18, padding: "6px 12px" }}>+</button>
            <button className="hamburger-btn" onClick={() => setMobileMenuOpen(o => !o)} aria-label="Menú">
              {mobileMenuOpen
                ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              }
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown — inside header so position:absolute top:100% anchors to header bottom */}
        {mobileMenuOpen && (
          <div className="mobile-menu">
            {[
              { label: "KANBAN", v: "kanban", action: () => setView("kanban") },
              { label: "LISTA", v: "lista", action: () => setView("lista") },
              { label: "AGENDA", v: "agenda", action: () => setView("agenda") },
              { label: "CONVERSACIONES", v: "convs", action: () => { setView("convs"); fetchWhatsConvs(); setSelectedConv(null); setConvMessages([]); } },
              { label: `SEGUIMIENTOS${pendientesCount > 0 ? ` (${pendientesCount})` : ""}`, v: "seguimientos", action: () => { setView("seguimientos"); setPendientesCount(0); } },
              { label: "REACTIVACIONES", v: "reactivaciones", action: () => setView("reactivaciones") },
              { label: "REVISIÓN", v: "revision", action: () => { setView("revision"); fetchRevisionDiaria(); } },
              ...(isAdmin ? [
                { label: "BASE", v: "base", action: () => { setView("base"); loadDocumentos(); } },
                { label: "BOT", v: "bot", action: () => { setView("bot"); loadBotConfig(); } },
                { label: "LAB BOT", v: "lab", action: () => { setView("lab"); resetLabSimulation(); } },
                { label: "FLOWS", v: "flows", action: () => { setView("flows"); loadWhatsappFlow(); } },
              ] : []),
            ].map(item => (
              <button
                key={item.v}
                className={`nav-btn ${view === item.v ? "active" : ""}`}
                onClick={() => { confirmReturnToBotIfNeeded(item.action); setMobileMenuOpen(false); }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ maxWidth: view === "agenda" ? "none" : 1400, width: "100%", minWidth: 0, boxSizing: "border-box", margin: "0 auto", padding: view === "agenda" ? "12px 16px" : view === "convs" ? "0" : "24px", flex: 1, minHeight: 0, display: (view === "convs" || view === "agenda") ? "flex" : "block", flexDirection: "column", overflowY: (view === "convs" || view === "agenda") ? "hidden" : "auto", overscrollBehaviorX: "contain" }}>
        {/* STATS */}
        <div style={{ display: (view === "convs" || view === "agenda") ? "none" : "block", marginBottom: 20 }}>
          {/* Stats compactas */}
          <div className="stat-card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 10 }}>
            {[
              { label: "PIPELINE TOTAL", value: formatPeso(pipelineValue), sub: `${filteredLeads.filter((l) => !["inscrito","perdido","archivado"].includes(normalizeStage(l.stage))).length} activos`, color: "#4A90D9" },
              { label: "INSCRITOS", value: formatPeso(totalRevenue), sub: `${leads.filter((l) => normalizeStage(l.stage) === "inscrito").length} cierres`, color: "#27AE60" },
              { label: "TASA DE CIERRE", value: `${convRate}%`, sub: `de ${leads.length} totales`, color: "#E8A838" },
              { label: "LEADS HOY", value: leads.filter(l => l.fecha === todayCST()).length, sub: "nuevos ingresos", color: "#E85D38" },
            ].map((s, i) => (
              <div key={i} className="stat-card">
                <div style={{ fontSize: 9, color: "#888", letterSpacing: 1.5, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "#777", marginTop: 3 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Desglose por oferta educativa */}
          {(() => {
            const activos = leads.filter(l => !["inscrito","perdido","archivado"].includes(normalizeStage(l.stage)));
            const conteo = { idiomas: {}, bachillerato: {}, licenciaturas: {}, maestrias: {}, otros: {}, diplomados: {} };
            activos.forEach(l => {
              const programa = getProgramaResumen(l.curso);
              if (!programa) return;
              const bucket = conteo[programa.group];
              bucket[programa.key] = bucket[programa.key] || { label: programa.label, count: 0 };
              bucket[programa.key].count += 1;
            });
            const groups = [
              ["idiomas", "Cursos de idiomas"],
              ["bachillerato", "Bachillerato"],
              ["licenciaturas", "Licenciaturas"],
              ["maestrias", "Maestrías"],
              ["otros", "Otros programas"],
            ].map(([key, label]) => ({ key, label, items: Object.values(conteo[key]).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es")) }))
              .filter((group) => group.items.length > 0);
            const diplomados = Object.values(conteo.diplomados).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"));
            if (groups.length === 0 && diplomados.length === 0) return null;
            return (
              <details className="program-summary">
                <summary>Por programa</summary>
                <div className="program-summary-content">
                  {groups.map((group) => (
                    <div key={group.key}>
                      <div className="program-group-title">{group.label}</div>
                      {group.items.map((item) => <div className="program-row" key={item.label}><span>{item.label}</span><strong className="program-count">{item.count}</strong></div>)}
                    </div>
                  ))}
                  {diplomados.length > 0 && (
                    <details className="program-diplomados">
                      <summary><span>Diplomados</span><strong className="program-count">{diplomados.reduce((total, item) => total + item.count, 0)}</strong></summary>
                      {diplomados.map((item) => <div className="program-row" key={item.label}><span>{item.label}</span><strong className="program-count">{item.count}</strong></div>)}
                    </details>
                  )}
                </div>
              </details>
            );
          })()}
        </div>

        {/* FILTROS */}
        <div style={{ display: (view === "convs" || view === "agenda") ? "none" : "flex", flexWrap: "wrap", gap: 12, marginBottom: 24, alignItems: "center" }}>
          <input className="input" style={{ maxWidth: 260, flex: "1 1 180px" }} placeholder="🔍  Buscar lead..." value={search} onChange={e => setSearch(e.target.value)} />
          {isAdmin && (
            <select className="select" style={{ maxWidth: 200, flex: "1 1 160px" }} value={filterVendedor} onChange={e => setFilterVendedor(e.target.value)}>
              <option value="Todos">Todos los vendedores</option>
              {vendedores.map(v => <option key={v.id} value={v.id}>{v.nombre || v.email}</option>)}
            </select>
          )}
          {(
            <select className="select" style={{ maxWidth: 200, flex: "1 1 160px" }} value={filterFuente} onChange={e => setFilterFuente(e.target.value)}>
              <option value="Todos">Todas las fuentes</option>
              {Object.entries(FUENTE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          )}
          {(
            <select className="select" style={{ maxWidth: 220, flex: "1 1 180px" }} value={filterOferta} onChange={e => setFilterOferta(e.target.value)}>
              <option value="Todos">Todas las ofertas</option>
              {ofertaOptions.map((group) => (
                <optgroup key={group.group} label={group.label}>
                  {group.items.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </optgroup>
              ))}
            </select>
          )}
          <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "#555" }}>{filteredLeads.length} leads mostrados</span>
            <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => {
              const headers = ["Nombre","Email","WhatsApp","Programa","Stage","Fecha","Valor","Notas"];
              const rows = filteredLeads.map(l => [
                l.nombre||"", l.email||"", l.whatsapp||"", l.curso||"",
                normalizeStage(l.stage)||"", l.fecha||"", l.valor||"", (l.notas||"").replace(/\n/g," ")
              ]);
              const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
              const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = `leads_${todayCST()}.csv`; a.click(); URL.revokeObjectURL(url);
            }}>⬇ CSV</button>
            {isAdmin && (
              <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={async () => {
                const { error } = await supabase.from("leads").update({ stage: "primer_contacto" }).is("stage", null);
                if (error) { showToast("Error moviendo leads", "error"); return; }
                await fetchLeads(); showToast("Leads sin stage movidos a Primer contacto");
              }}>🔧 Fix huérfanos</button>
            )}
          </div>
        </div>

        {loading && <div className="loading">Cargando leads...</div>}

        {/* KANBAN */}
        {!loading && view === "kanban" && (
          <div style={{ width: "100%", maxWidth: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch", overscrollBehaviorX: "contain", paddingBottom: 16 }}>
          <KanbanBoard
            STAGES={STAGES}
            byStage={byStage}
            formatPeso={formatPeso}
            dragId={dragId}
            setDragId={setDragId}
            handleDrop={handleDrop}
            setSelectedLead={setSelectedLead}
            getNombreVendedor={getNombreVendedor}
            goToConversation={(lead) => {
              openConversationForLead(lead);
            }}
            hasConversation={hasConversation}
          />
          </div>
        )}

        {/* LISTA */}
        {!loading && view === "lista" && (
          <LeadsTable
            filteredLeads={filteredLeads}
            STAGES={STAGES}
            normalizeStage={normalizeStage}
            setSelectedLead={setSelectedLead}
            formatPeso={formatPeso}
            getNombreVendedor={getNombreVendedor}
            openWA={openWA}
          />
        )}

        {/* BASE DE CONOCIMIENTO */}
        {view === "base" && isAdmin && (
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 24 }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "#1a1a1a", marginBottom: 4 }}>BASE DE CONOCIMIENTO</div>
              <div style={{ fontSize: 11, color: "#777" }}>Sube PDFs para que el bot de WhatsApp pueda responder preguntas</div>
            </div>

            {/* Upload */}
            <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="text"
                placeholder="Título del documento (ej: Cursos Windsor)"
                value={ragTitulo}
                onChange={(e) => setRagTitulo(e.target.value)}
                style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 12px", color: "#1a1a1a", fontSize: 12 }}
              />
              <textarea
                placeholder="Pega aquí el texto del documento..."
                value={ragTexto}
                onChange={(e) => setRagTexto(e.target.value)}
                rows={8}
                style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 12px", color: "#1a1a1a", fontSize: 12, resize: "vertical", fontFamily: "inherit" }}
              />
              <button
                className="btn btn-primary"
                onClick={uploadTexto}
                disabled={ragUploading || !ragTexto.trim()}
              >
                {ragUploading ? "Indexando..." : "Indexar texto"}
              </button>
            </div>

            {/* Lista de documentos */}
            {documentos.length === 0 ? (
              <div style={{ padding: 20, borderRadius: 8, border: "1px dashed #333", textAlign: "center", color: "#555", fontSize: 12 }}>
                No hay documentos indexados todavía.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {documentos.map((doc) => (
                  <div key={doc.id} style={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, overflow: "hidden" }}>
                    <div
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", cursor: "pointer" }}
                      onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)}
                    >
                      <div>
                        <div style={{ color: "#1a1a1a", marginBottom: 2 }}>{doc.titulo || "Sin título"}</div>
                        <div style={{ color: "#555", fontSize: 11 }}>{doc.contenido?.slice(0, 80)}...</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ color: "#555", fontSize: 16 }}>{expandedDoc === doc.id ? "▲" : "▼"}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingDoc(doc.id); setEditTitulo(doc.titulo || ""); setEditTexto(doc.contenido || ""); setExpandedDoc(doc.id); }}
                          style={{ background: "none", border: "1px solid #444", borderRadius: 4, color: "#aaa", cursor: "pointer", fontSize: 11, padding: "2px 8px" }}
                        >editar</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteDocumento(doc.id); }}
                          style={{ background: "none", border: "none", color: "#E85D38", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
                        >×</button>
                      </div>
                    </div>
                    {expandedDoc === doc.id && (
                      <div style={{ padding: "10px 14px", borderTop: "1px solid #e2e8f0" }}>
                        {editingDoc === doc.id ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <input
                              value={editTitulo}
                              onChange={(e) => setEditTitulo(e.target.value)}
                              style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", color: "#1a1a1a", fontSize: 12 }}
                            />
                            <textarea
                              value={editTexto}
                              onChange={(e) => setEditTexto(e.target.value)}
                              rows={10}
                              style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", color: "#1a1a1a", fontSize: 11, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
                            />
                            <div style={{ display: "flex", gap: 8 }}>
                              <button className="btn btn-primary" onClick={() => saveDocumento(doc.id)}>Guardar y re-indexar</button>
                              <button className="btn" onClick={() => setEditingDoc(null)} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#aaa", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ color: "#aaa", fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{doc.contenido}</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CONFIGURACIÓN DEL BOT */}
        {view === "bot" && isAdmin && (
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 24 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#1a1a1a", marginBottom: 4 }}>CONFIGURACIÓN DEL BOT</div>
              <div style={{ fontSize: 11, color: "#777" }}>
                Aquí defines la identidad y la forma en que debe comportarse el bot. Esta configuración se guarda desde el CRM y, por ahora, no reemplaza el flujo actual en producción.
              </div>
            </div>

            <div style={{ marginBottom: 12, fontSize: 11, color: "#555", lineHeight: 1.6 }}>
              Sugerencia: describe quién es el bot, cuál es su objetivo, cómo debe hablar, qué debe evitar y cuándo debe escalar a un asesor humano.
            </div>

            <textarea
              value={botPrompt}
              onChange={(e) => setBotPrompt(e.target.value)}
              placeholder={`Eres el asistente de admisiones de Instituto Windsor por WhatsApp. Debes hablar de forma amable, clara, breve e institucional. Tu objetivo es orientar al prospecto, identificar su interés y llevarlo al siguiente paso. No inventes información. Si no sabes algo, dilo con honestidad y ofrece apoyo humano. Si el usuario pide asesor, deja la conversación lista para seguimiento.`}
              rows={14}
              style={{
                width: "100%",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "12px 14px",
                color: "#1a1a1a",
                fontSize: 12,
                lineHeight: 1.7,
                resize: "vertical",
                marginBottom: 14,
              }}
            />

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                className="btn btn-primary"
                onClick={saveBotConfig}
                disabled={botSaving}
              >
                {botSaving ? "Guardando..." : "Guardar configuración del bot"}
              </button>
              {(botLoading || flowLoading) && (
                <div style={{ fontSize: 11, color: "#777" }}>
                  Cargando configuración...
                </div>
              )}
            </div>
          </div>
        )}

        {view === "lab" && isAdmin && (
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 24 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#1a1a1a", marginBottom: 4 }}>LAB BOT</div>
              <div style={{ fontSize: 11, color: "#777" }}>
                Simula cómo se comportaría el bot según el escenario del lead, sin afectar el bot productivo.
              </div>
            </div>

            <div className="lab-grid" style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr", gap: 16 }}>
              <div className="lab-state-panel" style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>ESCENARIO</div>
                <select
                  className="select"
                  value={labScenario}
                  onChange={(e) => {
                    setLabScenario(e.target.value);
                    setLabStarted(false);
                    setLabMessages([]);
                    setLabInput("");
                  }}
                  style={{ marginBottom: 14 }}
                >
                  <option value="ads">Ads</option>
                  <option value="walkin">Walk-in</option>
                </select>

                {labScenario === "walkin" && (
                  <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                    <input
                      className="input"
                      placeholder="Nombre"
                      value={labWalkinData.nombre}
                      onChange={(e) => setLabWalkinData((prev) => ({ ...prev, nombre: e.target.value }))}
                    />
                    <input
                      className="input"
                      placeholder="Correo"
                      value={labWalkinData.email}
                      onChange={(e) => setLabWalkinData((prev) => ({ ...prev, email: e.target.value }))}
                    />
                    <select
                      className="select"
                      value={labWalkinData.programa}
                      onChange={(e) => setLabWalkinData((prev) => ({ ...prev, programa: e.target.value }))}
                    >
                      {CURSOS.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <input
                      className="input"
                      placeholder="WhatsApp (opcional)"
                      value={labWalkinData.whatsapp}
                      onChange={(e) => setLabWalkinData((prev) => ({ ...prev, whatsapp: e.target.value }))}
                    />
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  <button className="btn btn-primary" onClick={startLabSimulation}>
                    {labStarted ? "Reiniciar simulación" : "Iniciar simulación"}
                  </button>
                  {labStarted && (
                    <button className="btn btn-ghost" onClick={resetLabSimulation}>
                      Limpiar
                    </button>
                  )}
                </div>

                <div style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>ESTADO DEL LEAD</div>
                  <div className="lab-state-compact" style={{ fontSize: 12, color: "#ddd", lineHeight: 1.8 }}>
                    <div><strong>Origen:</strong> {labState.origen || labScenario}</div>
                    <div><strong>Nombre:</strong> {labState.nombre || "—"}</div>
                    <div><strong>Correo:</strong> {labState.email || "—"}</div>
                    <div><strong>Programa:</strong> {labState.programa || "—"}</div>
                    <div><strong>Fase:</strong> {labState.fase || "—"}</div>
                    <div><strong>Siguiente paso:</strong> {labState.nextStep || "—"}</div>
                  </div>
                </div>
              </div>

              <div className="lab-chat-panel" style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", minHeight: 480 }}>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>CHAT DE PRUEBA</div>
                <div style={{ flex: 1, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
                  {!labStarted && (
                    <div style={{ fontSize: 12, color: "#666" }}>
                      Selecciona un escenario y empieza la simulación para probar cómo hablaría el bot.
                    </div>
                  )}
                  {labMessages.map((msg, idx) => (
                    <div
                      key={`${msg.role}-${idx}`}
                      style={{
                        alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                        background: msg.role === "user" ? "#2C4A8C" : "#f1f5f9",
                        color: msg.role === "user" ? "#ffffff" : "#1a1a1a",
                        border: `1px solid ${msg.role === "user" ? "#3f68b5" : "#2d5a35"}`,
                        borderRadius: 10,
                        padding: "10px 12px",
                        maxWidth: "82%",
                        fontSize: 12,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {msg.content}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <input
                    className="input"
                    placeholder={labStarted ? "Escribe como si fueras el prospecto..." : "Inicia primero la simulación"}
                    value={labInput}
                    onChange={(e) => setLabInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !labSending) {
                        e.preventDefault();
                        sendLabMessage();
                      }
                    }}
                    disabled={!labStarted || labSending}
                  />
                  <button className="btn btn-primary" onClick={sendLabMessage} disabled={!labStarted || labSending}>
                    {labSending ? "Consultando..." : "Enviar"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* REVISIÓN DIARIA */}
        {view === "revision" && (
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, color: "#1a1a1a", fontWeight: 600 }}>REVISIÓN DIARIA</div>
                <div style={{ fontSize: 11, color: "#777" }}>Conversaciones con actividad en las últimas 24h — deja tus instrucciones y marca &quot;Analizar&quot; cuando termines.</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={fetchRevisionDiaria} disabled={revisionLoading}>
                  {revisionLoading ? "Cargando..." : "Actualizar"}
                </button>
                <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={generarRevisionDiaria} disabled={revisionGenerating}>
                  {revisionGenerating ? "Generando..." : "Generar revisión de hoy"}
                </button>
              </div>
            </div>

            {revisionFilas.length === 0 ? (
              <div style={{ fontSize: 12, color: "#777", padding: 20, textAlign: "center" }}>
                Sin filas todavía — haz clic en &quot;Generar revisión de hoy&quot; para traer las conversaciones de las últimas 24h.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e2e8f0", textAlign: "left" }}>
                      <th style={{ padding: "8px 6px" }}>Teléfono</th>
                      <th style={{ padding: "8px 6px" }}>Nombre</th>
                      <th style={{ padding: "8px 6px", minWidth: 220 }}>Notas</th>
                      <th style={{ padding: "8px 6px", minWidth: 220 }}>Propuesta</th>
                      <th style={{ padding: "8px 6px" }}>Estado</th>
                      <th style={{ padding: "8px 6px" }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revisionFilas.map((fila) => (
                      <tr key={fila.id} style={{ borderBottom: "1px solid #f1f5f9", verticalAlign: "top" }}>
                        <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{fila.telefono}</td>
                        <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{fila.nombre || "—"}</td>
                        <td style={{ padding: "8px 6px" }}>
                          <textarea
                            className="input"
                            style={{ width: "100%", minHeight: 44, fontSize: 12, resize: "vertical" }}
                            defaultValue={fila.notas_harold || ""}
                            placeholder="Instrucción para esta conversación..."
                            onBlur={(e) => {
                              if (e.target.value !== (fila.notas_harold || "")) {
                                updateRevisionFila(fila.id, { notas_harold: e.target.value });
                              }
                            }}
                          />
                        </td>
                        <td style={{ padding: "8px 6px", color: "#555", whiteSpace: "pre-wrap" }}>
                          {fila.propuesta_claude || <span style={{ color: "#aaa" }}>—</span>}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          <span style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 600,
                            background: fila.estado === "resuelto" ? "#dcfce7" : fila.estado === "analizado" ? "#dbeafe" : fila.estado === "pendiente_analisis" ? "#fef3c7" : "#f1f5f9",
                            color: fila.estado === "resuelto" ? "#166534" : fila.estado === "analizado" ? "#1e40af" : fila.estado === "pendiente_analisis" ? "#92400e" : "#64748b",
                          }}>
                            {fila.estado}
                          </span>
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 10, padding: "4px 8px" }}
                              onClick={() => {
                                const conv = whatsConvs.find(c => c.id === fila.conversacion_id || c.lead_id === fila.lead_id || c.whatsapp === fila.telefono);
                                setConvVentanaFilter(false);
                                setConvSearch(fila.telefono);
                                fetchWhatsConvs().then(() => {
                                  setView("convs");
                                  if (conv) { setSelectedConv(conv); fetchConvMessages(conv.id); }
                                });
                              }}
                            >Ir a conversación</button>
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 10, padding: "4px 8px" }}
                              disabled={fila.estado === "pendiente_analisis"}
                              onClick={() => updateRevisionFila(fila.id, { estado: "pendiente_analisis" })}
                            >Analizar</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* FLOWS WHATSAPP */}
        {view === "flows" && isAdmin && (
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 24 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#1a1a1a", marginBottom: 4 }}>FLOWS WHATSAPP</div>
              <div style={{ fontSize: 11, color: "#777" }}>
                Define reglas simples por palabra clave. El bot aplica la primera que coincida antes de usar RAG.
              </div>
            </div>
            <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 11, color: "#64748b", lineHeight: 1.6 }}>
              Próximo paso: esta sección evolucionará a un constructor visual del flujo conversacional, tipo canvas, sin quitar la configuración actual por palabra clave.
            </div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>
              Ejemplo: si el mensaje contiene <code>hola</code>, responde un texto fijo. Si contiene <code>precio</code>, usa la base RAG.
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 3fr", background: "#f8fafc", fontSize: 11, color: "#777" }}>
                <div style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>PALABRA CLAVE CONTIENE</div>
                <div style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>ACCIÓN</div>
                <div style={{ padding: "8px 10px" }}>RESPUESTA (si es texto fijo)</div>
              </div>
              {flowRules.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "#555" }}>
                  No hay reglas aún. Agrega una con el botón de abajo.
                </div>
              ) : (
                flowRules.map((rule, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1.2fr 3fr",
                      borderTop: "1px solid #e2e8f0",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                      <input
                        value={rule.match}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFlowRules((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, match: v } : r))
                          );
                        }}
                        placeholder="ej. hola"
                        style={{
                          width: "100%",
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderRadius: 4,
                          padding: "6px 8px",
                          color: "#1a1a1a",
                          fontSize: 12,
                        }}
                      />
                    </div>
                    <div style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                      <select
                        value={rule.type === "rag" ? "rag" : "fixed"}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFlowRules((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, type: v === "rag" ? "rag" : "fixed" } : r
                            )
                          );
                        }}
                        style={{
                          width: "100%",
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderRadius: 4,
                          padding: "6px 8px",
                          color: "#1a1a1a",
                          fontSize: 12,
                        }}
                      >
                        <option value="fixed">Responder texto fijo</option>
                        <option value="rag">Usar RAG (base de conocimiento)</option>
                      </select>
                    </div>
                    <div style={{ padding: "8px 10px", display: "flex", gap: 6, alignItems: "flex-start" }}>
                      {rule.type !== "rag" ? (
                        <textarea
                          value={rule.answer}
                          onChange={(e) => {
                            const v = e.target.value;
                            setFlowRules((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, answer: v } : r))
                            );
                          }}
                          rows={2}
                          placeholder="Texto que enviará el bot"
                          style={{
                            flex: 1,
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderRadius: 4,
                            padding: "6px 8px",
                            color: "#1a1a1a",
                            fontSize: 12,
                            resize: "vertical",
                          }}
                        />
                      ) : (
                        <div style={{ fontSize: 11, color: "#777" }}>
                          El bot buscará respuesta en la base RAG.
                        </div>
                      )}
                      <button
                        onClick={() =>
                          setFlowRules((prev) => prev.filter((_, i) => i !== idx))
                        }
                        style={{
                          background: "none",
                          border: "none",
                          color: "#E85D38",
                          cursor: "pointer",
                          fontSize: 16,
                          lineHeight: 1,
                        }}
                        title="Eliminar regla"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button
                className="btn"
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  color: "#1a1a1a",
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
                onClick={() =>
                  setFlowRules((prev) => [
                    ...prev,
                    { match: "", type: "fixed", answer: "" },
                  ])
                }
              >
                + Agregar regla
              </button>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
              <button
                className="btn btn-primary"
                onClick={saveWhatsappFlow}
                disabled={flowSaving}
              >
                {flowSaving ? "Guardando..." : "Guardar flow"}
              </button>
              {flowLoading && (
                <div style={{ fontSize: 11, color: "#777" }}>
                  Cargando flow...
                </div>
              )}
            </div>
          </div>
        )}

        {/* CONVERSACIONES WHATSAPP */}
        {view === "convs" && (
          <ConversationsPanel
            key={selectedConv?.id || "no-selected-conv"}
            filteredWhatsConvs={filteredWhatsConvs}
            ultimoUsuarioAtPorConv={ultimoUsuarioAtPorConv}
            convSearch={convSearch}
            setConvSearch={setConvSearch}
            convModeFilter={convModeFilter}
            setConvModeFilter={setConvModeFilter}
            convPhaseFilter={convPhaseFilter}
            setConvPhaseFilter={setConvPhaseFilter}
            conversationPhaseOptions={conversationPhaseOptions}
            convVentanaFilter={convVentanaFilter}
            setConvVentanaFilter={setConvVentanaFilter}
            conversacionesVentanaActiva={conversacionesVentanaActiva}
            convAtoradaFilter={convAtoradaFilter}
            setConvAtoradaFilter={setConvAtoradaFilter}
            atoradasCount={atoradasCount}
            esAtorada={esAtorada}
            selectedAtoradaIds={selectedAtoradaIds}
            setSelectedAtoradaIds={setSelectedAtoradaIds}
            marcarPerdidasBulk={marcarPerdidasBulk}
            marcandoPerdidas={marcandoPerdidas}
            getPhaseLabel={getPhaseLabel}
            selectedConv={selectedConv}
            setSelectedConv={setSelectedConv}
            confirmReturnToBotIfNeeded={confirmReturnToBotIfNeeded}
            fetchConvMessages={fetchConvMessages}
            setView={setView}
            setSelectedLead={setSelectedLead}
            leads={leads}
            vendedores={vendedores}
            getConversationBadgeStyle={getConversationBadgeStyle}
            getModeLabel={getModeLabel}
            selectedConvLead={selectedConvLead}
            selectedConvOwner={selectedConvOwner}
            selectedLeadAssigned={selectedLeadAssigned}
            setHumanMode={setHumanMode}
            setConvVisto={setConvVisto}
            convMessages={convMessages}
            sendAgentReply={sendAgentReply}
            sendingAgent={sendingAgent}
            fetchPlantillas={fetchPlantillas}
            plantillas={plantillas}
            loadingPlantillas={loadingPlantillas}
            sendPlantilla={sendPlantilla}
            sendingReactivacion={sendingReactivacion}
            moveStage={moveStage}
            STAGES={STAGES}
            normalizeStage={normalizeStage}
          />
        )}

        {/* SEGUIMIENTOS */}
        {view === "seguimientos" && (
          <SeguimientosPanel
            goToKanban={(leadId) => {
              const lead = leads.find(l => l.id === leadId);
              setSelectedLead(lead || null);
              confirmReturnToBotIfNeeded(() => setView("kanban"));
            }}
            goToConversation={(leadId, whatsapp) => {
              const conv = whatsConvs.find(c => c.lead_id === leadId || c.whatsapp === whatsapp);
              fetchWhatsConvs().then(() => {
                setView("convs");
                if (conv) {
                  setSelectedConv(conv);
                  fetchConvMessages(conv.id);
                }
              });
            }}
          />
        )}

        {view === "reactivaciones" && (
          <ReactivacionesPanel
            onOpenConversation={(conversationId) => {
              const conv = whatsConvs.find(c => c.id === conversationId);
              setView("convs");
              if (conv) { setSelectedConv(conv); fetchConvMessages(conv.id); }
              else fetchWhatsConvs();
            }}
          />
        )}

        {/* AGENDA */}
        {!loading && view === "agenda" && (
          <AgendaPanel
            citas={citas}
            setShowCitaForm={setShowCitaForm}
            getCitaStatusStyle={getCitaStatusStyle}
            updateCitaStatus={updateCitaStatus}
          />
        )}
      </div>

      {/* MODAL AYUDA */}
      {showAyuda && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setShowAyuda(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 2, color: "#2C4A8C" }}>GUÍA DEL ASESOR</div>
              <button onClick={() => setShowAyuda(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#555" }}>✕</button>
            </div>
            {[
              {
                icon: "👤", title: "Tus leads",
                body: "En KANBAN y LISTA solo verás los leads que te están asignados. Si no ves un lead, puede que esté asignado a otro asesor."
              },
              {
                icon: "💬", title: "Cómo responder por WhatsApp",
                body: "Ve a CONVERSACIONES. Selecciona un chat de la lista izquierda. Escribe tu mensaje en la caja de texto y presiona Enter o el botón de enviar. Solo puedes responder cuando la conversación está en modo HUMANO."
              },
              {
                icon: "🤝", title: "Tomar una conversación",
                body: "Clic en el botón TOMAR en el encabezado del chat. El bot dejará de responder automáticamente y podrás atender al prospecto directamente."
              },
              {
                icon: "🤖", title: "Devolver al bot",
                body: "Clic en BOT para que el asistente retome la conversación. Úsalo cuando el prospecto quede en modo de espera o ya no necesites atención directa."
              },
              {
                icon: "✅", title: "Cerrar un lead",
                body: "Clic en CERRAR (botón amarillo) en el chat → elige Inscrito o Perdido → escribe el motivo si aplica → presiona Confirmar. El lead se mueve automáticamente en el Kanban."
              },
              {
                icon: "📋", title: "Registrar un nuevo lead manual",
                body: "Clic en + NUEVO LEAD (botón rojo arriba a la derecha). Llena nombre, WhatsApp y programa. El lead aparece en tu Kanban en Primer contacto."
              },
              {
                icon: "⚠️", title: "Si el bot no responde bien",
                body: "Toma la conversación con TOMAR y atiende al prospecto directamente. Avisa al administrador para revisar la configuración del bot."
              },
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 12, marginBottom: 18, padding: "12px 14px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{s.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: "#1a1a1a" }}>{s.title}</div>
                  <div style={{ fontSize: 12, color: "#555", lineHeight: 1.6 }}>{s.body}</div>
                </div>
              </div>
            ))}
            <div style={{ textAlign: "center", marginTop: 8, fontSize: 11, color: "#94a3b8" }}>Windsor CRM — Soporte: hola@windsor.edu.mx</div>
          </div>
        </div>
      )}

      {/* MODAL DETALLE LEAD */}
      {selectedLead && (() => {
        const lead = leads.find(l => l.id === selectedLead.id) || selectedLead;
        const stage = STAGES.find(s => s.id === normalizeStage(lead.stage));
        return (
          <LeadDetailModal
            lead={lead}
            stage={stage}
            isAdmin={isAdmin}
            vendedores={vendedores}
            getNombreVendedor={getNombreVendedor}
            reasignarLead={reasignarLead}
            STAGES={STAGES}
            moveStage={moveStage}
            setSelectedLead={setSelectedLead}
            updateNotas={updateNotas}
            WA_TEMPLATES={WA_TEMPLATES}
            openWA={openWA}
            sendLeadInformation={sendLeadInformation}
            sendingInfoLeadId={sendingInfoLeadId}
            leadInfoDraft={leadInfoDraft}
            setLeadInfoDraft={setLeadInfoDraft}
            activeConversation={whatsConvs.find((conv) => conv.lead_id === lead.id || conv.whatsapp === lead.whatsapp) || null}
            getLeadNextStep={getLeadNextStep}
            leadTimelineLoading={leadTimelineLoading}
            leadTimeline={leadTimeline}
            setShowCitaForm={setShowCitaForm}
            setNuevaCita={setNuevaCita}
            deleteLead={deleteLead}
            updateLeadField={updateLeadField}
            goToConversation={(l) => {
              openConversationForLead(l);
            }}
          />
        );
      })()}

      <NewLeadModal
        showForm={showForm}
        setShowForm={setShowForm}
        newLead={newLead}
        setNewLead={setNewLead}
        vendedores={vendedores}
        addLead={addLead}
      />

      <NewAppointmentModal
        showCitaForm={showCitaForm}
        setShowCitaForm={setShowCitaForm}
        nuevaCita={nuevaCita}
        setNuevaCita={setNuevaCita}
        leads={leads}
        guardarCita={guardarCita}
      />

      {/* CHATBOT IA */}
      <button
        onClick={() => setChatOpen((v) => !v)}
        style={{
          position: "fixed",
          bottom: 96,
          right: 24,
          zIndex: 900,
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: "none",
          background: "#2C4A8C",
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 24px rgba(44,74,140,0.35)",
          cursor: "pointer",
          fontSize: 22,
        }}
        aria-label="Abrir asistente de ventas"
      >
        💬
      </button>

      {chatOpen && (
        <div
          style={{
            position: "fixed",
            bottom: 160,
            right: 24,
            width: 360,
            maxHeight: 520,
            background: "#ffffff",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 16px 40px rgba(0,0,0,0.15)",
            zIndex: 901,
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#f8fafc",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: "#2C4A8C",
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                }}
              >
                Asistente Windsor
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                IA enfocada en admisiones y seguimiento de prospectos
              </div>
            </div>
            <button
              className="btn-ghost"
              style={{ border: "none", background: "transparent", color: "#777" }}
              onClick={() => setChatOpen(false)}
            >
              ✕
            </button>
          </div>

          <div
            style={{
              padding: "10px 12px",
              flex: 1,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {chatMessages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  background:
                    m.role === "user" ? "#2C4A8C" : "#f1f5f9",
                  color: m.role === "user" ? "#ffffff" : "#1a1a1a",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontSize: 12,
                  lineHeight: 1.5,
                  border:
                    m.role === "user"
                      ? "none"
                      : "1px solid #e2e8f0",
                }}
              >
                {m.content}
              </div>
            ))}
            {chatLoading && (
              <div
                style={{
                  alignSelf: "flex-start",
                  fontSize: 11,
                  color: "#64748b",
                }}
              >
                Pensando recomendaciones...
              </div>
            )}
          </div>

          <div
            style={{
              borderTop: "1px solid #e2e8f0",
              padding: "8px 10px",
              background: "#f8fafc",
              display: "flex",
              gap: 6,
            }}
          >
            <input
              className="input"
              style={{ fontSize: 12, padding: "8px 10px" }}
              placeholder="Pregúntame cómo avanzar tus leads..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
            />
            <button
              className="btn btn-primary"
              style={{ padding: "0 14px", fontSize: 12, whiteSpace: "nowrap" }}
              onClick={sendChat}
              disabled={chatLoading}
            >
              {chatLoading ? "Enviando..." : "Enviar"}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" style={{ background: toast.type === "error" ? "#fee2e2" : "#dcfce7", border: `1px solid ${toast.type === "error" ? "#fca5a5" : "#86efac"}`, color: toast.type === "error" ? "#991b1b" : "#15803d" }}>
          {toast.msg}
        </div>
      )}

      {exitDecisionOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="exit-chat-title">
          <div className="modal" style={{ maxWidth: 440, padding: 24 }}>
            <div id="exit-chat-title" style={{ fontSize: 18, fontWeight: 700, color: "#1e293b" }}>¿Qué quieres hacer con este chat?</div>
            <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.55, margin: "10px 0 20px" }}>
              Este prospecto está en modo manual. Puedes dejar el control al asesor o devolver la conversación al bot antes de salir.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <button className="btn" onClick={continueManualAndLeave} style={{ padding: "12px 14px", textAlign: "left", background: "#fff", border: "1px solid #cbd5e1", color: "#1e293b" }}>
                <strong>Continuar manual</strong><span style={{ display: "block", fontSize: 11, color: "#64748b", marginTop: 3 }}>El asesor conserva el control; el bot no responderá.</span>
              </button>
              <button className="btn" onClick={returnToBotAndLeave} style={{ padding: "12px 14px", textAlign: "left", background: "#2C4A8C", color: "#fff" }}>
                <strong>Regresar al bot</strong><span style={{ display: "block", fontSize: 11, opacity: .8, marginTop: 3 }}>El bot podrá responder al prospecto nuevamente.</span>
              </button>
              <button className="btn" onClick={() => { setExitDecisionOpen(false); setPendingExitAction(null); }} style={{ padding: "8px", background: "transparent", color: "#64748b" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
