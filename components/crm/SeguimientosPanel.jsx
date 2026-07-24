"use client";
import { useState, useEffect, useCallback } from "react";

// ─── Constantes ───────────────────────────────────────────────────────────────

const TIER_CONFIG = {
  1: { label: "Tier 1", color: "#dc2626", bg: "#fef2f2", desc: "Mensaje WA personalizado" },
  2: { label: "Tier 2", color: "#d97706", bg: "#fffbeb", desc: "Llamada telefónica" },
  3: { label: "Tier 3", color: "#f59e0b", bg: "#fffbeb", desc: "Template de reactivación" },
  4: { label: "Tier 4", color: "#6366f1", bg: "#eef2ff", desc: "Segunda llamada" },
  5: { label: "Tier 5", color: "#64748b", bg: "#f8fafc", desc: "Último template antes de cerrar" },
};

const TIPO_ICON = {
  mensaje_wa: "💬",
  llamada: "📞",
  template: "📋",
};

const STAGE_LABEL = {
  primer_contacto: "1er contacto",
  contactado: "Contactado",
  interesado: "Interesado",
  seguimiento: "Seguimiento",
  inscripcion_pendiente: "Inscripción pend.",
  examen_ubicacion: "Examen ubic.",
  clase_muestra: "Clase muestra",
};

function diasDesde(fechaStr) {
  if (!fechaStr) return null;
  return Math.floor((Date.now() - new Date(fechaStr).getTime()) / (1000 * 60 * 60 * 24));
}

function tiempoRestanteVentana(fechaStr) {
  if (!fechaStr) return null;
  const cierraEn = new Date(fechaStr).getTime() + 24 * 60 * 60 * 1000 - Date.now();
  if (cierraEn <= 0) return null;
  const horas = Math.floor(cierraEn / (1000 * 60 * 60));
  const minutos = Math.floor((cierraEn % (1000 * 60 * 60)) / (1000 * 60));
  return horas > 0 ? `${horas}h ${minutos}min` : `${minutos}min`;
}

function formatTelefono(wa) {
  if (!wa) return "";
  return wa.replace(/^52/, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1 $2 $3");
}

// ─── Tarjeta de Mensaje WA ────────────────────────────────────────────────────

function TarjetaMensaje({ seg, onAccion }) {
  const [texto, setTexto] = useState(seg.contenido_sugerido || "");
  const [editado, setEditado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);

  async function personalizar() {
    setDrafting(true);
    try {
      const r = await fetch(`/api/seguimientos/${seg.id}/draft`, { method: "POST" });
      const data = await r.json();
      if (data.draft) { setTexto(data.draft); setEditado(true); }
    } catch {}
    setDrafting(false);
  }
  const tier = TIER_CONFIG[seg.tier] || TIER_CONFIG[1];
  const dias = diasDesde(seg.ultimo_usuario_at);
  const restanteVentana = seg.en_ventana_24h ? tiempoRestanteVentana(seg.ultimo_usuario_at) : null;

  async function enviar() {
    setBusy(true);
    await onAccion(seg.id, "enviar", { mensaje_editado: editado ? texto : undefined });
    setBusy(false);
  }

  async function saltar() {
    setBusy(true);
    await onAccion(seg.id, "saltar", {});
    setBusy(false);
  }

  return (
    <div style={{
      background: "#fff",
      border: `1.5px solid ${tier.color}33`,
      borderLeft: `4px solid ${tier.color}`,
      borderRadius: 12,
      padding: 18,
      boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{
              background: tier.bg, color: tier.color,
              fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
            }}>
              {TIPO_ICON.mensaje_wa} {tier.label}
            </span>
            {seg.en_ventana_24h
              ? <span style={{ fontSize: 11, background: "#dcfce7", color: "#15803d", padding: "2px 8px", borderRadius: 6, fontWeight: 500 }}>✅ Cierra en {restanteVentana || "menos de 1min"}</span>
              : <span style={{ fontSize: 11, background: "#fef9c3", color: "#92400e", padding: "2px 8px", borderRadius: 6, fontWeight: 500 }}>⏰ Fuera de ventana</span>
            }
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>
            {seg.lead_nombre || "Sin nombre"}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 1 }}>
            {seg.lead_whatsapp && <a href={`https://wa.me/${seg.lead_whatsapp}`} target="_blank" rel="noreferrer" style={{ color: "#128C7E", textDecoration: "none" }}>
              📱 {formatTelefono(seg.lead_whatsapp)}
            </a>}
            {seg.lead_curso && <> · {seg.lead_curso}</>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {seg.lead_stage && (
            <span style={{ fontSize: 11, background: "#eef2fb", color: "#2C4A8C", padding: "2px 8px", borderRadius: 6, fontWeight: 500 }}>
              {STAGE_LABEL[seg.lead_stage] || seg.lead_stage}
            </span>
          )}
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            {dias === null ? "Sin historial"
              : dias === 0 ? "Respondió hoy"
              : dias === 1 ? "Respondió ayer"
              : `Silencio: ${dias} días`}
          </span>
        </div>
      </div>

      {/* Último mensaje del lead */}
      {seg.ultimo_usuario_msg && (
        <div style={{ fontSize: 12, color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", marginBottom: 10, fontStyle: "italic" }}>
          💬 "{seg.ultimo_usuario_msg.slice(0, 100)}{seg.ultimo_usuario_msg.length > 100 ? "…" : ""}"
        </div>
      )}

      {/* Mensaje sugerido (editable) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>
          Mensaje sugerido {editado && <span style={{ color: "#2C4A8C" }}>· editado</span>}
        </div>
        <button onClick={personalizar} disabled={drafting}
          style={{ fontSize: 11, background: drafting ? "#f1f5f9" : "#faf5ff", color: drafting ? "#94a3b8" : "#7c3aed", border: "1px solid #e9d5ff", borderRadius: 6, padding: "3px 10px", cursor: drafting ? "not-allowed" : "pointer", fontWeight: 500 }}>
          {drafting ? "Generando…" : "✨ Personalizar con IA"}
        </button>
      </div>
      <textarea
        value={texto}
        onChange={e => { setTexto(e.target.value); setEditado(e.target.value !== (seg.contenido_sugerido || "")); }}
        style={{
          width: "100%", minHeight: 72, padding: "10px 12px",
          border: editado ? "1.5px solid #2C4A8C" : "1px solid #e2e8f0",
          borderRadius: 8, fontSize: 13, color: "#1e293b", resize: "vertical",
          fontFamily: "inherit", background: editado ? "#f8faff" : "#f8fafc",
          boxSizing: "border-box",
        }}
      />

      {/* Acciones */}
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        {editado && (
          <button onClick={() => { setTexto(seg.contenido_sugerido || ""); setEditado(false); }}
            style={{ padding: "7px 12px", background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 7, cursor: "pointer", fontSize: 12 }}>
            Restaurar
          </button>
        )}
        <button onClick={saltar} disabled={busy}
          style={{ padding: "7px 14px", background: "#fff", color: "#94a3b8", border: "1px solid #e2e8f0", borderRadius: 7, cursor: busy ? "not-allowed" : "pointer", fontSize: 12 }}>
          Saltar
        </button>
        <button onClick={enviar} disabled={busy || !texto.trim()}
          style={{ padding: "7px 18px", background: busy ? "#94a3b8" : "#2C4A8C", color: "#fff", border: "none", borderRadius: 7, cursor: busy ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600 }}>
          {busy ? "Enviando…" : "✓ Aprobar y enviar"}
        </button>
      </div>
    </div>
  );
}

// ─── Tarjeta de Llamada ───────────────────────────────────────────────────────

function TarjetaLlamada({ seg, onAccion }) {
  const [notas, setNotas] = useState("");
  const [expandido, setExpandido] = useState(false);
  const [busy, setBusy] = useState(false);
  const tier = TIER_CONFIG[seg.tier] || TIER_CONFIG[2];
  const dias = diasDesde(seg.ultimo_usuario_at);

  async function completar() {
    setBusy(true);
    await onAccion(seg.id, "completar_llamada", { notas });
    setBusy(false);
  }

  async function saltar() {
    setBusy(true);
    await onAccion(seg.id, "saltar", {});
    setBusy(false);
  }

  const telLimpio = seg.lead_whatsapp
    ? seg.lead_whatsapp.replace(/^52/, "").replace(/\D/g, "")
    : "";

  return (
    <div style={{
      background: "#fff",
      border: `1.5px solid ${tier.color}33`,
      borderLeft: `4px solid ${tier.color}`,
      borderRadius: 12,
      padding: 18,
      boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{
              background: tier.bg, color: tier.color,
              fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
            }}>
              {TIPO_ICON.llamada} {tier.label} — Llamada
            </span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>
            {seg.lead_nombre || "Sin nombre"}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 1 }}>
            {seg.lead_curso || "Programa por definir"}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {seg.lead_stage && (
            <span style={{ fontSize: 11, background: "#eef2fb", color: "#2C4A8C", padding: "2px 8px", borderRadius: 6, fontWeight: 500 }}>
              {STAGE_LABEL[seg.lead_stage] || seg.lead_stage}
            </span>
          )}
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            {dias === null ? "Sin historial"
              : dias === 0 ? "Respondió hoy"
              : dias === 1 ? "Respondió ayer"
              : `Silencio: ${dias} días`}
          </span>
        </div>
      </div>

      {/* Número de teléfono (grande y clickeable) */}
      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, color: "#15803d", fontWeight: 600, marginBottom: 2 }}>NÚMERO A LLAMAR</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b", letterSpacing: 1 }}>
            {formatTelefono(seg.lead_whatsapp)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {telLimpio && (
            <a href={`tel:+52${telLimpio}`}
              style={{ padding: "8px 14px", background: "#15803d", color: "#fff", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
              📞 Llamar
            </a>
          )}
          {seg.lead_whatsapp && (
            <a href={`https://wa.me/${seg.lead_whatsapp}`} target="_blank" rel="noreferrer"
              style={{ padding: "8px 14px", background: "#128C7E", color: "#fff", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
              💬 WA
            </a>
          )}
        </div>
      </div>

      {/* Notas (expandible) */}
      {!expandido ? (
        <button onClick={() => setExpandido(true)}
          style={{ background: "none", border: "none", color: "#64748b", fontSize: 12, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
          + Agregar notas de la llamada
        </button>
      ) : (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 500, marginBottom: 4 }}>Notas (solo internas)</div>
          <textarea
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="¿Qué pasó en la llamada? ¿Contestó? ¿Qué dijo? ¿Próximo paso acordado?"
            style={{
              width: "100%", minHeight: 72, padding: "10px 12px",
              border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13,
              color: "#1e293b", resize: "vertical", fontFamily: "inherit",
              background: "#fafafa", boxSizing: "border-box",
            }}
          />
        </div>
      )}

      {/* Acciones */}
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        <button onClick={saltar} disabled={busy}
          style={{ padding: "7px 14px", background: "#fff", color: "#94a3b8", border: "1px solid #e2e8f0", borderRadius: 7, cursor: busy ? "not-allowed" : "pointer", fontSize: 12 }}>
          Saltar
        </button>
        <button onClick={completar} disabled={busy}
          style={{ padding: "7px 18px", background: busy ? "#94a3b8" : "#15803d", color: "#fff", border: "none", borderRadius: 7, cursor: busy ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600 }}>
          {busy ? "Guardando…" : "✓ Llamada hecha"}
        </button>
      </div>
    </div>
  );
}

// ─── Tarjeta de Template ──────────────────────────────────────────────────────

function TarjetaTemplate({ seg, onAccion }) {
  const [busy, setBusy] = useState(false);
  const tier = TIER_CONFIG[seg.tier] || TIER_CONFIG[3];
  const dias = diasDesde(seg.ultimo_usuario_at);

  async function enviar() {
    setBusy(true);
    await onAccion(seg.id, "enviar", {});
    setBusy(false);
  }

  async function saltar() {
    setBusy(true);
    await onAccion(seg.id, "saltar", {});
    setBusy(false);
  }

  return (
    <div style={{
      background: "#fff",
      border: `1.5px solid ${tier.color}33`,
      borderLeft: `4px solid ${tier.color}`,
      borderRadius: 12,
      padding: 18,
      boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ background: tier.bg, color: tier.color, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>
              {TIPO_ICON.template} {tier.label} — Template
            </span>
            <span style={{ fontSize: 11, background: "#fef9c3", color: "#92400e", padding: "2px 8px", borderRadius: 6, fontWeight: 500 }}>
              📋 {seg.template_name || "seguimiento_general"}
            </span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>{seg.lead_nombre || "Sin nombre"}</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 1 }}>{seg.lead_curso || "Programa por definir"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {seg.lead_stage && (
            <span style={{ fontSize: 11, background: "#eef2fb", color: "#2C4A8C", padding: "2px 8px", borderRadius: 6, fontWeight: 500 }}>
              {STAGE_LABEL[seg.lead_stage] || seg.lead_stage}
            </span>
          )}
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            {dias === null ? "Sin historial" : dias === 0 ? "Hoy" : `${dias}d sin respuesta`}
          </span>
        </div>
      </div>

      {seg.contenido_sugerido && (
        <div style={{ fontSize: 12, color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 12px", marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#64748b" }}>Vista previa del template:</div>
          {seg.contenido_sugerido.replace("{{nombre}}", seg.lead_nombre || "{{nombre}}")}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={saltar} disabled={busy}
          style={{ padding: "7px 14px", background: "#fff", color: "#94a3b8", border: "1px solid #e2e8f0", borderRadius: 7, cursor: busy ? "not-allowed" : "pointer", fontSize: 12 }}>
          Saltar
        </button>
        <button onClick={enviar} disabled={busy}
          style={{ padding: "7px 18px", background: busy ? "#94a3b8" : "#6366f1", color: "#fff", border: "none", borderRadius: 7, cursor: busy ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600 }}>
          {busy ? "Enviando…" : "✓ Enviar template"}
        </button>
      </div>
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────

export default function SeguimientosPanel({ goToKanban, goToConversation }) {
  const [segs, setSegs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("todos"); // todos | mensaje_wa | llamada | template

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/seguimientos");
      const data = await r.json();
      setSegs(data.seguimientos || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function enviarTodos() {
    const templates = filtrados.filter(s => s.tipo === "template");
    if (!window.confirm(`¿Enviar ${templates.length} templates? Esta acción no se puede deshacer.`)) return;
    for (const seg of templates) {
      await onAccion(seg.id, "enviar", {});
      await new Promise(r => setTimeout(r, 300)); // pequeña pausa entre envíos
    }
  }

  async function onAccion(id, accion, extra) {
    try {
      const r = await fetch(`/api/seguimientos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, ...extra }),
      });
      const data = await r.json();
      if (data.ok) {
        setSegs(prev => prev.filter(s => s.id !== id));
      } else {
        alert("Error: " + (data.error || "desconocido"));
      }
    } catch (e) {
      alert("Error de conexión");
    }
  }

  const filtrados = filtro === "todos" ? segs : segs.filter(s => s.tipo === filtro);
  const countMsgs = segs.filter(s => s.tipo === "mensaje_wa").length;
  const countLlamadas = segs.filter(s => s.tipo === "llamada").length;
  const countTemplates = segs.filter(s => s.tipo === "template").length;

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Cargando seguimientos…</div>;
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>
            Seguimientos
            {segs.length > 0 && (
              <span style={{ marginLeft: 10, background: "#A8263C", color: "#fff", borderRadius: 99, fontSize: 13, padding: "2px 10px", fontWeight: 600 }}>
                {segs.length}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
            Cola de acciones pendientes. Tier 1 primero.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={cargar}
            style={{ padding: "8px 16px", background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
            ↻ Recargar
          </button>
          {filtrados.filter(s => s.tipo === "template").length > 0 && (
            <button onClick={enviarTodos}
              style={{ padding: "8px 16px", background: "#15803d", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              Enviar todos los templates ({filtrados.filter(s => s.tipo === "template").length})
            </button>
          )}
        </div>
      </div>

      {/* Filtros */}
      {segs.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[
            { k: "todos", label: `Todos (${segs.length})` },
            { k: "mensaje_wa", label: `💬 Mensajes (${countMsgs})` },
            { k: "llamada", label: `📞 Llamadas (${countLlamadas})` },
            { k: "template", label: `📋 Templates (${countTemplates})` },
          ].map(({ k, label }) => (
            <button key={k} onClick={() => setFiltro(k)}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                fontWeight: filtro === k ? 600 : 400,
                background: filtro === k ? "#2C4A8C" : "#f1f5f9",
                color: filtro === k ? "#fff" : "#475569",
                border: filtro === k ? "none" : "1px solid #e2e8f0",
              }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Lista vacía */}
      {segs.length === 0 && (
        <div style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 16, color: "#64748b" }}>No hay seguimientos pendientes.</div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>El cron genera nuevas acciones diariamente a las 9am.</div>
          <button onClick={cargar}
            style={{ marginTop: 16, padding: "8px 20px", background: "#2C4A8C", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
            Recargar
          </button>
        </div>
      )}

      {/* Tarjetas */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {filtrados.map(seg => {
          if (seg.tipo === "mensaje_wa") {
            return <TarjetaMensaje key={seg.id} seg={seg} onAccion={onAccion} />;
          }
          if (seg.tipo === "llamada") {
            return <TarjetaLlamada key={seg.id} seg={seg} onAccion={onAccion} />;
          }
          return <TarjetaTemplate key={seg.id} seg={seg} onAccion={onAccion} />;
        })}
      </div>
    </div>
  );
}
