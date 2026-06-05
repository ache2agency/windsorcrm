"use client";
import { useState, useRef, useEffect } from "react";

const RESPUESTAS_RAPIDAS = [
  { grupo: "Idiomas", items: [
    { label: "Inglés adultos", texto: `¡Excelente elección! 😊 Te comparto la información de nuestro Curso de Inglés:

*📚 Curso de Inglés para Adultos*
Dirigido a personas de 13 años en adelante

*🎓 Modalidad:* Presencial y Online

*🕐 Horarios presenciales:*
• Matutino: 10:00 - 12:00 hrs
• Vespertino: 17:00 - 19:00 hrs
• Sabatino: 09:00 - 13:00 hrs

*🛜 Horarios online:*
• Vespertino: 17:00 - 19:00 hrs
• Sabatino: 09:00 - 13:00 hrs

*⏳ Duración:* 5 meses (10 meses sabatino)

*💰 Inversión:*
• Inscripción: $750
• Mensualidad desde $990

*🎉 Promoción del mes:*
• Inscripción: ~$750~ → $375 (50% de descuento)
• ¡Primer mes gratis!

Al terminar obtienes un Diploma con validez oficial.

¿Cómo te gustaría continuar?
*A)* Tengo dudas 🤔
*B)* Agendar mi examen de ubicación gratuito 📝` },
    { label: "Inglés niños", texto: `¡Qué gran decisión para el futuro de tu hij@! 😊 Te comparto la información de nuestro Curso de Inglés para Niños:

*📚 Curso de Inglés para Niños*
Dirigido a niños de 4 a 12 años

*🎓 Modalidad:* Presencial y Online

*🕐 Horarios presenciales:*
• Martes a jueves: 13:00 - 14:00 hrs o 17:00 - 18:00 hrs
• Sabatino: 09:00 - 13:00 hrs

*🛜 Horarios online:*
• Lunes a jueves: 17:00 - 18:00 hrs
• Sabatino: 09:00 - 13:00 hrs

*⏳ Duración:* 5 meses

*💰 Inversión:*
• Inscripción: $800
• Mensualidad: $780

*🎉 Promoción del mes:*
• Inscripción: ~$800~ → $400 (50% de descuento)
• ¡Primer mes gratis!

Al terminar obtiene un Diploma con validez oficial.

¿Cómo te gustaría continuar?
*A)* Tengo dudas 🤔
*B)* Agendar mi examen de ubicación gratuito 📝` },
  ]},
  { grupo: "Licenciaturas", items: [
    { label: "Lic. en Inglés", texto: `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Inglés:

*🎓 Licenciatura en Inglés*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino, Vespertino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,150 (incluye credencial)
• Mensualidad: $2,750

*🎉 Promoción del mes:*
• Inscripción: ~$2,150~ → $645 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Docente, traductor, asesor editorial, call centers, centros de investigación y organismos internacionales.

📄 Plan de estudios: https://drive.google.com/file/d/1M_K1sIqh-8LgZdTsiAmIRMOkVIiTw295/view

¿Cómo te gustaría continuar?
*A)* Tengo dudas 🤔
*B)* Quiero inscribirme ✍️` },
    { label: "Psicología", texto: `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Psicología:

*🎓 Licenciatura en Psicología*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,300 (incluye credencial)
• Mensualidad: $2,750

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Salud, educación, medio ambiente, producción, consumo y convivencia social.

📄 Plan de estudios: https://drive.google.com/file/d/1mw16jhbwN3K2dBy3ajcb3qREOPVXZ9rb/view

¿Cómo te gustaría continuar?
*A)* Tengo dudas 🤔
*B)* Quiero inscribirme ✍️` },
    { label: "RR.PP. y Mercadotecnia", texto: `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Relaciones Públicas y Mercadotecnia:

*🎓 Licenciatura en Relaciones Públicas y Mercadotecnia*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino, Vespertino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,300 (incluye credencial)
• Mensualidad: $2,750

*🎉 Promoción del mes:*
• Inscripción: ~$2,300~ → $690 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*✨ Incluye 3 certificaciones:* Marketing digital, creación de páginas web y diseño gráfico.

*💼 Campo laboral:* Agencias de publicidad, marketing, medios de comunicación, gobierno, tecnología, entretenimiento.

📄 Plan de estudios: https://drive.google.com/file/d/1tv2023m30ZVHJRryfwhNm6tT9wICHvnZ/view

¿Cómo te gustaría continuar?
*A)* Tengo dudas 🤔
*B)* Quiero inscribirme ✍️` },
    { label: "Adm. Turística", texto: `¡Excelente elección! 😊 Te comparto la información de nuestra Licenciatura en Administración Turística:

*🎓 Licenciatura en Administración Turística*
Modalidad: Presencial | Duración: 3 años

*🕐 Horarios:* Matutino, Vespertino y Sabatino

*💰 Inversión:*
• Inscripción semestral: $2,200 (incluye credencial)
• Mensualidad: $2,750

*🎉 Promoción del mes:*
• Inscripción: ~$2,200~ → $660 (70% de descuento)
• Mensualidad: ~$2,750~ → $1,925 (30% de descuento)

*💼 Campo laboral:* Agencias de viajes, hoteles, resorts, operadores turísticos, eventos y convenciones.

📄 Plan de estudios: https://drive.google.com/file/d/1FMFbZ4pupnqkD_X1pBUcxlVo0HmRxUPb/view

¿Cómo te gustaría continuar?
*A)* Tengo dudas 🤔
*B)* Quiero inscribirme ✍️` },
  ]},
  { grupo: "Cursos de Verano", items: [
    { label: "Verano niños", texto: `👋 ¡Hola! Gracias por tu interés en *My Best Summer 2026* de Instituto Windsor. ☀️

📅 *Fechas:* Del 13 de julio al 07 de agosto.

👧🧒 Contamos con grupos por edades:

🔹 *Kids* (4 a 6 años)
• Idiomas (Inglés y Francés)
• Origami
• Arte y pintura
• Ritmo y movimiento musical
• Repostería
• Kung Fu

🔹 *Juniors* (7 a 9 años)
• Idiomas
• Repostería
• Robótica
• Origami
• Arte y pintura
• Diseño de videojuegos
• Ritmo y movimiento musical
• Kung Fu

🔹 *Seniors* (10 a 12 años)
• Arte y pintura
• Robótica
• Idiomas
• Kung Fu
• Origami
• Repostería
• Diseño de videojuegos

🕘 *Horario:* De 9:00 a.m. a 1:30 p.m.

🍽️ *Cafetería:* Las instalaciones cuentan con servicio de cafetería, el cual opera de manera independiente. Los paquetes y costos los podrás consultar directamente con ellos — lo que sí podemos confirmar es que ofrecen opciones especiales para los cursos de verano.

🚌 Los viernes realizamos salidas especiales al Zoológico, Museo La Avispa y Bomberos.

📍 *Ubicación:* Calle Sofía Tena #1, Col. Viguri.

📄 Programa completo: https://drive.google.com/file/d/1I7kD2vtkRsJ_XlYa1ZaLijuRfUUgkW6j/view?usp=sharing

💰 *Inversión:* $2,100 MXN + $400 materiales.
💳 *Pago:* Puedes apartar tu lugar con el 50% y cubrir el resto al inicio del curso.

🚨 *Inscripciones abiertas | Cupo limitado*

¿Cómo te gustaría continuar?
*A)* Tengo dudas 🤔
*B)* Quiero inscribir a mi hij@ ✍️` },
    { label: "Verano adultos", texto: `👋 ¡Hola! Gracias por tu interés en *My Best Summer* para Adolescentes y Adultos de Instituto Windsor. 🌟

📅 *Fechas:* Del 13 de julio al 07 de agosto.

Ofrecemos cursos Extra Intensivos de Idiomas para que avances tu nivel en pocas semanas.

🇬🇧 *Inglés*

🔹 Beginner X Intensivo
🕘 9:00 a.m. a 12:00 p.m. o 1:00 p.m. a 4:00 p.m.

🔹 Elementary X Intensivo
🕐 1:00 p.m. a 4:00 p.m.

🔹 Pre-Intermediate X Intensivo
🕐 1:00 p.m. a 4:00 p.m.

🇫🇷 *Francés Intensivo*
🕐 1:00 p.m. a 3:00 p.m.

🇮🇹 *Italiano Intensivo*
🕐 1:00 p.m. a 3:00 p.m.

💰 *Inversión:* $2,200 MXN por curso.
📚 Manual para cursos de inglés: $150 MXN adicionales.

📍 *Ubicación:* Calle Sofía Tena #1, Col. Viguri.

📄 Programa completo: https://drive.google.com/file/d/17H3avjLp_BDilOsaqSbs6gXBIlH5BcAz/view?usp=sharing

🚨 *Inscripciones abiertas | Cupo limitado*

¿Cómo te gustaría continuar?
*A)* Tengo dudas 🤔
*B)* Quiero inscribirme ✍️` },
  ]},
  { grupo: "Bachillerato", items: [
    { label: "Bachillerato", texto: `¡Excelente elección! 😊 Te comparto la información de nuestra Prepa Windsor:

*🎓 Bachillerato — Prepa Windsor*
Modalidad: Presencial | Duración: 2 años

*🕐 Horarios:* Matutino y Vespertino

*💰 Inversión:*
• Inscripción cuatrimestral: $1,100 (incluye credencial)
• Mensualidad: $1,800

*🎉 Promoción del mes:*
• Inscripción: ~$1,100~ → $550 (50% de descuento)
• Mensualidad: ~$1,800~ → $1,440 (20% de descuento)

📄 Más información: https://drive.google.com/file/d/1txVAaLEpi-WPTybWtSKKMu3mn6fC5TkK/view

¿Cómo te gustaría continuar?
*A)* Tengo dudas 🤔
*B)* Quiero inscribirme ✍️` },
  ]},
];

const WA_GREEN = "#075E54";
const WA_TEAL = "#128C7E";
const WA_BUBBLE_OUT = "#DCF8C6";
const WA_BUBBLE_IN = "#FFFFFF";
const WA_BG = "#E5DDD5";

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(" ");
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : parts[0][0].toUpperCase();
}

const AVATAR_COLORS = ["#A8263C","#2C4A8C","#128C7E","#7B5EA7","#D97706","#0891B2"];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || "?").length; i++) h = (name.charCodeAt(i) + h * 31) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export default function ConversationsPanel({
  filteredWhatsConvs,
  convSearch,
  setConvSearch,
  convModeFilter,
  setConvModeFilter,
  convPhaseFilter,
  setConvPhaseFilter,
  conversationPhaseOptions,
  getPhaseLabel,
  convVentanaFilter,
  setConvVentanaFilter,
  selectedConv,
  setSelectedConv,
  confirmReturnToBotIfNeeded,
  fetchConvMessages,
  setAgentMessage,
  leads,
  vendedores,
  getConversationBadgeStyle,
  getModeLabel,
  selectedConvLead,
  selectedConvOwner,
  selectedLeadAssigned,
  setHumanMode,
  setView,
  setSelectedLead,
  convMessages,
  agentMessage,
  sendAgentReply,
  sendingAgent,
  sendReactivacion,
  sendingReactivacion,
  closeLead,
}) {
  const [mobileView, setMobileView] = useState("list");
  const [showInfoCards, setShowInfoCards] = useState(false);
  const [showCerrarModal, setShowCerrarModal] = useState(false);
  const [cerrarStage, setCerrarStage] = useState("inscrito");
  const [cerrarMotivo, setCerrarMotivo] = useState("");
  const [cerrando, setCerrando] = useState(false);
  const [showRR, setShowRR] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convMessages]);

  const handleSelectConv = async (c) => {
    if (c.id === selectedConv?.id) return;
    setShowInfoCards(false);
    await confirmReturnToBotIfNeeded(async () => {
      setSelectedConv(c);
      await fetchConvMessages(c.id);
      setAgentMessage("");
      setMobileView("chat");
    });
  };

  const getDisplayName = (c) => {
    const lead = leads.find((l) => l.id === c.lead_id);
    return lead?.nombre || c.whatsapp;
  };

  const getModeColor = (c) => c.modo_humano ? "#A8263C" : WA_TEAL;
  const getModeIcon = (c) => c.modo_humano ? "👤" : "🤖";

  return (
    <>
      <style>{`
        .wa-root {
          display: flex;
          flex-direction: row;
          flex: 1;
          min-height: 0;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 2px 12px rgba(0,0,0,0.12);
        }

        /* LIST */
        .wa-list { width: 360px; flex-shrink: 0; display: flex; flex-direction: column; background: #fff; border-right: 1px solid #e9edef; min-height: 0; }
        .wa-list-header { background: ${WA_GREEN}; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; }
        .wa-list-title { color: #fff; font-size: 17px; font-weight: 700; }
        .wa-search { padding: 8px 12px; background: #f0f2f5; }
        .wa-search input { width: 100%; background: #fff; border: none; border-radius: 20px; padding: 8px 14px; font-size: 13px; color: #1a1a1a; outline: none; box-sizing: border-box; }
        .wa-filters { padding: 6px 12px; display: flex; gap: 6px; border-bottom: 1px solid #e9edef; }
        .wa-filters select { flex: 1; background: #f0f2f5; border: none; border-radius: 12px; padding: 5px 8px; font-size: 11px; color: #54656f; outline: none; }
        .wa-convs-count { padding: 5px 16px; font-size: 11px; color: #8696a0; }
        .wa-list-items { flex: 1; overflow-y: auto; }
        .wa-item { display: flex; align-items: center; gap: 12px; padding: 10px 16px; cursor: pointer; border-bottom: 1px solid #f0f2f5; transition: background 0.1s; }
        .wa-item:hover { background: #f5f6f6; }
        .wa-item.active { background: #f0f2f5; }
        .wa-avatar { width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; color: #fff; flex-shrink: 0; }
        .wa-item-body { flex: 1; min-width: 0; }
        .wa-item-row1 { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; }
        .wa-item-name { font-size: 14px; font-weight: 600; color: #111b21; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 190px; }
        .wa-item-time { font-size: 11px; color: #8696a0; flex-shrink: 0; }
        .wa-item-row2 { display: flex; align-items: center; gap: 6px; }
        .wa-item-preview { font-size: 12px; color: #667781; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
        .wa-badge { font-size: 10px; border-radius: 999px; padding: 1px 7px; font-weight: 600; flex-shrink: 0; }

        /* CHAT */
        .wa-chat { flex: 1; display: flex; flex-direction: column; background: ${WA_BG}; position: relative; min-height: 0; overflow: hidden; }
        .wa-chat-header { background: ${WA_GREEN}; padding: 10px 16px; display: flex; align-items: center; gap: 10px; flex-shrink: 0; z-index: 1; }
        .wa-back-btn { background: none; border: none; color: #fff; font-size: 22px; cursor: pointer; padding: 0; display: none; line-height: 1; }
        .wa-chat-header-info { flex: 1; min-width: 0; }
        .wa-chat-name { color: #fff; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wa-chat-sub { color: rgba(255,255,255,0.72); font-size: 11px; margin-top: 1px; }
        .wa-chat-actions { display: flex; gap: 6px; flex-shrink: 0; }
        .wa-ctrl-btn { border-radius: 6px; padding: 5px 10px; font-size: 11px; font-weight: 600; border: none; cursor: pointer; }
        .wa-ctrl-btn:disabled { opacity: 0.35; cursor: default; }

        /* info cards */
        .wa-info-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 8px 12px; flex-shrink: 0; z-index: 1; }
        .wa-info-card { background: rgba(255,255,255,0.88); border-radius: 8px; padding: 8px 10px; }
        .wa-info-card-title { font-size: 9px; color: #8696a0; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 4px; font-weight: 700; }

        /* messages */
        .wa-messages { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 3px; z-index: 1; }
        .wa-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #8696a0; font-size: 13px; }
        .wa-msg { max-width: 75%; padding: 6px 10px 18px; border-radius: 8px; position: relative; word-break: break-word; white-space: pre-wrap; font-size: 13.5px; line-height: 1.45; box-shadow: 0 1px 2px rgba(0,0,0,0.12); margin-bottom: 1px; }
        .wa-msg.in  { align-self: flex-start; background: ${WA_BUBBLE_IN}; border-top-left-radius: 2px; margin-left: 8px; color: #111b21; }
        .wa-msg.out { align-self: flex-end;   background: ${WA_BUBBLE_OUT}; border-top-right-radius: 2px; margin-right: 8px; color: #111b21; }
        .wa-msg.in::before  { content:''; position:absolute; top:0; left:-8px; border:8px solid transparent; border-top-color:${WA_BUBBLE_IN}; border-right-color:${WA_BUBBLE_IN}; }
        .wa-msg.out::after  { content:''; position:absolute; top:0; right:-8px; border:8px solid transparent; border-top-color:${WA_BUBBLE_OUT}; border-left-color:${WA_BUBBLE_OUT}; }
        .wa-msg-role { font-size: 10px; font-weight: 700; margin-bottom: 3px; }
        .wa-msg-time { position:absolute; bottom:4px; right:8px; font-size:10px; color:#8696a0; }
        .wa-msg.out .wa-msg-time { color: #6a9e7a; }

        /* input */
        .wa-input-bar { padding: 8px 12px; background: #f0f2f5; display: flex; align-items: flex-end; gap: 8px; flex-shrink: 0; z-index: 1; }
        .wa-input-bar textarea { flex:1; background:#fff; border:none; border-radius:20px; padding:10px 14px; font-size:14px; color:#111b21; resize:none; outline:none; font-family:inherit; max-height:120px; line-height:1.4; }
        .wa-send-btn { width:44px; height:44px; border-radius:50%; background:${WA_GREEN}; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:background 0.15s; }
        .wa-send-btn:hover:not(:disabled) { background:${WA_TEAL}; }
        .wa-send-btn:disabled { opacity:0.45; cursor:default; }

        /* placeholder */
        .wa-placeholder { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:12px; color:#8696a0; }
        .wa-placeholder-icon { font-size:64px; opacity:0.25; }

        /* mobile */
        @media (max-width: 768px) {
          .wa-root { flex-direction: column; width: 100vw; max-width: 100vw; border-radius: 0; overflow: hidden; }
          .wa-list { display: ${mobileView === "list" ? "flex" : "none"}; width: 100%; max-width: 100%; overflow-x: hidden; }
          .wa-chat { display: ${mobileView === "chat" ? "flex" : "none"}; width: 100%; max-width: 100%; overflow-x: hidden; }
          .wa-chat-header { padding: 8px 10px; gap: 6px; overflow: hidden; }
          .wa-chat-actions { gap: 4px; }
          .wa-ctrl-btn { padding: 4px 7px; font-size: 10px; }
          .wa-back-btn { display: block !important; font-size: 18px; }
          .wa-info-cards { grid-template-columns: 1fr 1fr; display: ${showInfoCards ? "grid" : "none"}; padding: 6px 10px; gap: 6px; }
          .wa-info-card { padding: 6px 8px; }
          .wa-info-toggle { display: flex !important; }
          .wa-messages { padding: 8px; overflow-x: hidden; }
          .wa-msg { max-width: 88%; overflow-wrap: anywhere; word-break: break-word; }
          .wa-msg.in::before { display: none; }
          .wa-msg.out::after { display: none; }
        }
        .wa-info-toggle { display: none; align-items: center; justify-content: center; padding: 3px 12px; background: #f0f2f5; border: none; cursor: pointer; font-size: 10px; color: #667781; letter-spacing: 0.5px; gap: 4px; flex-shrink: 0; }
      `}</style>

      {showCerrarModal && selectedConvLead && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: "100%", maxWidth: 400, boxShadow: "0 16px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Cerrar lead: {selectedConvLead.nombre || selectedConv.whatsapp}</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "2px solid", borderColor: cerrarStage === "inscrito" ? "#15803d" : "#e2e8f0", background: cerrarStage === "inscrito" ? "#dcfce7" : "#fff", color: cerrarStage === "inscrito" ? "#15803d" : "#555", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
                onClick={() => setCerrarStage("inscrito")}
              >✅ Inscrito</button>
              <button
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "2px solid", borderColor: cerrarStage === "perdido" ? "#A8263C" : "#e2e8f0", background: cerrarStage === "perdido" ? "#fee2e8" : "#fff", color: cerrarStage === "perdido" ? "#A8263C" : "#555", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
                onClick={() => setCerrarStage("perdido")}
              >❌ Perdido</button>
            </div>
            <textarea
              value={cerrarMotivo}
              onChange={e => setCerrarMotivo(e.target.value)}
              placeholder={cerrarStage === "inscrito" ? "Notas de cierre (opcional)..." : "Motivo de pérdida (opcional)..."}
              rows={3}
              style={{ width: "100%", borderRadius: 8, border: "1px solid #e2e8f0", padding: "10px 12px", fontSize: 13, resize: "none", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#555", cursor: "pointer", fontSize: 13 }}
                onClick={() => setShowCerrarModal(false)}
              >Cancelar</button>
              <button
                disabled={cerrando}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: cerrarStage === "inscrito" ? "#15803d" : "#A8263C", color: "#fff", fontWeight: 700, cursor: cerrando ? "default" : "pointer", fontSize: 13, opacity: cerrando ? 0.6 : 1 }}
                onClick={async () => {
                  if (!closeLead || !selectedConvLead?.id) return;
                  setCerrando(true);
                  await closeLead(selectedConvLead.id, cerrarStage, cerrarMotivo);
                  setCerrando(false);
                  setShowCerrarModal(false);
                }}
              >{cerrando ? "Guardando..." : "Confirmar"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="wa-root">

        {/* ── LISTA ── */}
        <div className="wa-list">
          <div className="wa-list-header">
            <span className="wa-list-title">Chats Windsor</span>
            <span style={{ color: "rgba(255,255,255,0.65)", fontSize: 11 }}>WhatsApp</span>
          </div>

          <div className="wa-search">
            <input
              value={convSearch}
              onChange={(e) => setConvSearch(e.target.value)}
              placeholder="🔍  Buscar..."
            />
          </div>

          <div className="wa-filters">
            <select value={convModeFilter} onChange={(e) => setConvModeFilter(e.target.value)}>
              <option value="todos">Todos los modos</option>
              <option value="bot">Solo BOT</option>
              <option value="humano">Solo humano</option>
            </select>
            <select value={convPhaseFilter} onChange={(e) => setConvPhaseFilter(e.target.value)}>
              {conversationPhaseOptions.map((p) => (
                <option key={p} value={p}>{p === "todas" ? "Todas las fases" : getPhaseLabel(p)}</option>
              ))}
            </select>
          </div>
          {setConvVentanaFilter && (
            <div style={{ padding: "4px 12px 6px" }}>
              <button
                onClick={() => setConvVentanaFilter(!convVentanaFilter)}
                style={{
                  width: "100%", fontSize: 11, padding: "5px 0", borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 600,
                  background: convVentanaFilter ? "#25D366" : "#f0f2f5",
                  color: convVentanaFilter ? "#fff" : "#54656f",
                }}
                title="Mostrar solo conversaciones con actividad en las últimas 24h"
              >
                ⚡ Ventana activa (24h)
              </button>
            </div>
          )}

          <div className="wa-convs-count">{filteredWhatsConvs.length} conversaciones</div>

          <div className="wa-list-items">
            {filteredWhatsConvs.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#8696a0", fontSize: 13 }}>Sin conversaciones</div>
            ) : (
              filteredWhatsConvs.map((c) => {
                const name = getDisplayName(c);
                const owner = vendedores.find((v) => v.id === c.tomado_por);
                const time = c.ultimo_mensaje_at
                  ? new Date(c.ultimo_mensaje_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" })
                  : "";
                return (
                  <div
                    key={c.id}
                    className={`wa-item${selectedConv?.id === c.id ? " active" : ""}`}
                    onClick={() => handleSelectConv(c)}
                  >
                    <div className="wa-avatar" style={{ background: avatarColor(name) }}>
                      {getInitials(name)}
                    </div>
                    <div className="wa-item-body">
                      <div className="wa-item-row1">
                        <span className="wa-item-name">{name}</span>
                        <span className="wa-item-time">{time}</span>
                      </div>
                      <div className="wa-item-row2">
                        <span className="wa-item-preview">{getModeIcon(c)} {c.whatsapp}</span>
                        <span className="wa-badge" style={{ background: getModeColor(c) + "22", color: getModeColor(c) }}>
                          {getPhaseLabel(c.fase)}
                        </span>
                      </div>
                      {owner && (
                        <div style={{ fontSize: 10, color: "#8696a0", marginTop: 1 }}>{owner.nombre || owner.email}</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── CHAT ── */}
        <div className="wa-chat">
          {!selectedConv ? (
            <div className="wa-placeholder">
              <div className="wa-placeholder-icon">💬</div>
              <div style={{ fontSize: 14 }}>Selecciona una conversación</div>
            </div>
          ) : (
            <>
              <div className="wa-chat-header">
                <button className="wa-back-btn" onClick={() => setMobileView("list")}>←</button>
                <div className="wa-avatar" style={{ width: 38, height: 38, fontSize: 13, flexShrink: 0, background: avatarColor(selectedConvLead?.nombre || selectedConv.whatsapp) }}>
                  {getInitials(selectedConvLead?.nombre || selectedConv.whatsapp)}
                </div>
                <div className="wa-chat-header-info">
                  <div className="wa-chat-name">{selectedConvLead?.nombre || selectedConv.whatsapp}</div>
                  <div className="wa-chat-sub">{getModeLabel(selectedConv)} · {getPhaseLabel(selectedConv.fase)}</div>
                </div>
                <div className="wa-chat-actions">
                  {selectedConvLead && (
                    <button
                      className="wa-ctrl-btn"
                      style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}
                      onClick={() => { setView("kanban"); setSelectedLead(selectedConvLead); }}
                      title="Ver tarjeta del lead en el Kanban"
                    >
                      ← Kanban
                    </button>
                  )}
                  <button
                    className="wa-ctrl-btn"
                    style={{ background: selectedConv.modo_humano ? "rgba(255,255,255,0.15)" : "#fff", color: selectedConv.modo_humano ? "rgba(255,255,255,0.35)" : WA_GREEN }}
                    onClick={() => setHumanMode(selectedConv, true)}
                    disabled={selectedConv.modo_humano}
                  >
                    Tomar
                  </button>
                  <button
                    className="wa-ctrl-btn"
                    style={{ background: selectedConv.modo_humano ? "#A8263C" : "rgba(255,255,255,0.15)", color: "#fff" }}
                    onClick={() => setHumanMode(selectedConv, false)}
                    disabled={!selectedConv.modo_humano}
                  >
                    BOT
                  </button>
                  <button
                    className="wa-ctrl-btn"
                    style={{ background: "#7B5EA7", color: "#fff", opacity: sendingReactivacion ? 0.6 : 1 }}
                    onClick={sendReactivacion}
                    disabled={sendingReactivacion}
                    title="Enviar plantilla de seguimiento cuando la ventana de 24h venció"
                  >
                    {sendingReactivacion ? "..." : "Reactivar"}
                  </button>
                  <button
                    className="wa-ctrl-btn"
                    style={{ background: "#E8A838", color: "#fff" }}
                    onClick={() => { setCerrarStage("inscrito"); setCerrarMotivo(""); setShowCerrarModal(true); }}
                  >
                    Cerrar
                  </button>
                </div>
              </div>

              <button className="wa-info-toggle" onClick={() => setShowInfoCards(v => !v)}>
                {showInfoCards ? "▲ Ocultar info" : "▼ Ver lead · " + (selectedConvLead?.nombre || selectedConv?.whatsapp || "")}
              </button>

              <div className="wa-info-cards">
                <div className="wa-info-card">
                  <div className="wa-info-card-title">Lead</div>
                  <div style={{ fontWeight: 600, color: "#111b21", fontSize: 12 }}>{selectedConvLead?.nombre || "Sin nombre"}</div>
                  <div style={{ color: "#667781", fontSize: 11, marginTop: 2 }}>{selectedConvLead?.email || "Sin email"}</div>
                  <div style={{ color: "#667781", fontSize: 11 }}>{selectedConvLead?.curso || "—"}</div>
                  <div style={{ color: "#667781", fontSize: 11 }}>Stage: {selectedConvLead?.stage || "—"}</div>
                  {selectedConvLead?.created_at && (
                    <div style={{ color: "#667781", fontSize: 11, marginTop: 2 }}>
                      Entró: {new Date(selectedConvLead.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Mexico_City" })}
                    </div>
                  )}
                </div>
                <div className="wa-info-card">
                  <div className="wa-info-card-title">Responsable</div>
                  <div style={{ fontWeight: 600, color: "#111b21", fontSize: 12 }}>{selectedConvOwner?.nombre || selectedConvOwner?.email || "Sin dueño"}</div>
                  <div style={{ color: "#667781", fontSize: 11, marginTop: 2 }}>Asignado: {selectedLeadAssigned?.nombre || selectedLeadAssigned?.email || "—"}</div>
                  <div style={{ color: "#667781", fontSize: 11, marginTop: 2 }}>{selectedConv.whatsapp}</div>
                </div>
              </div>

              <div className="wa-messages">
                {convMessages.length === 0 ? (
                  <div className="wa-empty">Sin mensajes registrados</div>
                ) : (
                  convMessages.map((m) => {
                    const isOut = m.rol === "bot" || m.rol === "agente";
                    const time = m.created_at ? new Date(m.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" }) : "";
                    return (
                      <div key={m.id} className={`wa-msg ${isOut ? "out" : "in"}`}>
                        {m.rol === "agente" && <div className="wa-msg-role" style={{ color: "#A8263C" }}>Vendedor</div>}
                        {m.rol === "bot" && <div className="wa-msg-role" style={{ color: WA_TEAL }}>Bot</div>}
                        {m.contenido}
                        <div className="wa-msg-time">{time}</div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {showRR && (
                <div style={{ background: "#fff", borderTop: "1px solid #e9edef", maxHeight: 300, overflowY: "auto" }}>
                  {RESPUESTAS_RAPIDAS.map((grupo) => (
                    <div key={grupo.grupo}>
                      <div style={{ fontSize: 10, color: "#888", letterSpacing: 1, padding: "8px 14px 4px", fontWeight: 600, textTransform: "uppercase" }}>{grupo.grupo}</div>
                      {grupo.items.map((item) => (
                        <button
                          key={item.label}
                          onClick={() => { setAgentMessage(item.texto); setShowRR(false); }}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", background: "none", border: "none", borderBottom: "1px solid #f0f0f0", cursor: "pointer", fontSize: 13, color: "#111" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f5f5f5"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                        >
                          ⚡ {item.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <div className="wa-input-bar">
                <button
                  onClick={() => setShowRR(v => !v)}
                  title="Respuestas rápidas"
                  style={{ background: showRR ? "#E8A838" : "#f0f2f5", border: "none", borderRadius: 20, width: 36, height: 36, cursor: "pointer", fontSize: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  ⚡
                </button>
                <textarea
                  value={agentMessage}
                  onChange={(e) => setAgentMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!sendingAgent && agentMessage.trim()) sendAgentReply();
                    }
                  }}
                  rows={1}
                  placeholder="Escribe un mensaje..."
                />
                <button
                  className="wa-send-btn"
                  onClick={sendAgentReply}
                  disabled={sendingAgent || !agentMessage.trim()}
                >
                  <span style={{ color: "#fff", fontSize: 18 }}>{sendingAgent ? "⏳" : "➤"}</span>
                </button>
              </div>
            </>
          )}
        </div>

      </div>
    </>
  );
}
