"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TEMPLATES_APROBADOS, renderizarTemplate } from "@/lib/whatsapp/templates-aprobados";

const STAGE_LABELS = {
  primer_contacto: "Primer contacto",
  examen_ubicacion: "Examen de ubicación",
  clase_muestra: "Clase muestra",
  segundo_contacto: "Segundo contacto",
  promocion_enviada: "Promoción enviada",
  tercer_contacto: "Tercer contacto",
  inscripcion_pendiente: "Inscripción pendiente",
};

function fechaCorta(value) {
  if (!value) return "Sin actividad registrada";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function ReactivacionCard({ item, onProcessed, onOpenConversation }) {
  const [templateSeleccionado, setTemplateSeleccionado] = useState("");
  const [busy, setBusy] = useState(false);
  const primerNombre = (item.nombre || "").trim().split(/\s+/)[0] || "ahí";
  const template = useMemo(
    () => TEMPLATES_APROBADOS.find((t) => t.name === templateSeleccionado) || null,
    [templateSeleccionado]
  );
  const previewTemplate = template ? renderizarTemplate(template.body, primerNombre) : "";

  async function procesar(accion) {
    if (accion === "enviar" && !template) return;
    if (accion === "descartar" && !window.confirm("¿Descartar esta sugerencia? No se enviará ningún mensaje.")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/whatsapp/mensajes-pendientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          accion,
          template_name: accion === "enviar" ? template.name : undefined,
          template_params: accion === "enviar" ? [primerNombre] : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No fue posible procesar la sugerencia.");
      onProcessed(item.id, accion);
    } catch (error) {
      window.alert(error.message || "Error de conexión.");
    } finally {
      setBusy(false);
    }
  }

  return <article style={{ background: "#fff", border: "1px solid #e2e8f0", borderLeft: "4px solid #7B5EA7", borderRadius: 12, padding: 18, boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
    <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
      <div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 5 }}>
          <span style={{ background: "#f3e8ff", color: "#6b21a8", borderRadius: 99, padding: "3px 8px", fontSize: 11, fontWeight: 700 }}>REACTIVACIÓN SUGERIDA</span>
          <span style={{ background: item.en_ventana_24h ? "#dcfce7" : "#fef3c7", color: item.en_ventana_24h ? "#166534" : "#92400e", borderRadius: 99, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}>
            {item.en_ventana_24h ? "Dentro de ventana 24 h" : "Requiere template"}
          </span>
        </div>
        <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b" }}>{item.nombre || "Sin nombre"}</div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{item.curso || "Programa por definir"} · {STAGE_LABELS[item.stage] || item.stage || "Etapa no definida"}</div>
      </div>
      {item.conversacion_id && <button onClick={() => onOpenConversation(item.conversacion_id)} style={{ border: "1px solid #cbd5e1", background: "#fff", color: "#2C4A8C", borderRadius: 7, padding: "6px 9px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>Ver chat</button>}
    </div>

    {item.ultimo_usuario_msg && <div style={{ background: "#f8fafc", color: "#475569", borderRadius: 7, padding: "8px 10px", fontSize: 12, marginBottom: 10 }}>
      Último mensaje: “{item.ultimo_usuario_msg.slice(0, 140)}{item.ultimo_usuario_msg.length > 140 ? "…" : ""}”
    </div>}
    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>Última respuesta del prospecto: {fechaCorta(item.ultimo_usuario_at)} · Sugerido: {fechaCorta(item.creado_at)}</div>
    {item.mensaje && <div style={{ background: "#f8fafc", color: "#94a3b8", borderRadius: 7, padding: "8px 10px", fontSize: 11, marginBottom: 10, fontStyle: "italic" }}>
      Sugerencia original (solo referencia, no se envía): “{item.mensaje.slice(0, 160)}{item.mensaje.length > 160 ? "…" : ""}”
    </div>}
    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 5 }}>Template aprobado a enviar</label>
    <select
      value={templateSeleccionado}
      onChange={(e) => setTemplateSeleccionado(e.target.value)}
      style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", font: "inherit", fontSize: 13, color: "#1e293b", background: "#fff", marginBottom: 10 }}
    >
      <option value="">Selecciona un template…</option>
      {TEMPLATES_APROBADOS.map((t) => (
        <option key={t.name} value={t.name}>{t.label}</option>
      ))}
    </select>

    {template && (
      <>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 5 }}>
          Vista previa del template aprobado por Meta ({template.category}) — no editable
        </div>
        <div style={{ width: "100%", minHeight: 88, boxSizing: "border-box", border: "1.5px solid #7B5EA7", borderRadius: 8, padding: 10, fontSize: 13, color: "#1e293b", background: "#f8f6fc" }}>
          {previewTemplate}
        </div>
      </>
    )}
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
      <button disabled={busy} onClick={() => procesar("descartar")} style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", borderRadius: 7, padding: "8px 12px", cursor: busy ? "wait" : "pointer", fontSize: 12 }}>Descartar</button>
      <button disabled={busy || !template} onClick={() => procesar("enviar")} style={{ border: "none", background: busy ? "#94a3b8" : "#15803d", color: "#fff", borderRadius: 7, padding: "8px 15px", cursor: busy ? "wait" : "pointer", fontSize: 12, fontWeight: 700 }}>{busy ? "Procesando…" : "Aprobar y enviar"}</button>
    </div>
  </article>;
}

export default function ReactivacionesPanel({ onOpenConversation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/whatsapp/mensajes-pendientes");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      setItems(data.mensajes || []);
    } catch (error) {
      window.alert(error.message || "No fue posible cargar las reactivaciones.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Cargando reactivaciones sugeridas…</div>;

  return <section style={{ maxWidth: 860, margin: "0 auto" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 20 }}>
      <div><h1 style={{ margin: 0, fontSize: 20, color: "#1e293b" }}>Reactivaciones sugeridas {items.length > 0 && <span style={{ fontSize: 13, background: "#7B5EA7", color: "#fff", borderRadius: 99, padding: "3px 9px", verticalAlign: "middle" }}>{items.length}</span>}</h1><p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 13 }}>Elige el template aprobado para cada caso antes de enviarlo. Nada se envía automáticamente.</p></div>
      <button onClick={cargar} style={{ border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 8, padding: "8px 12px", cursor: "pointer", color: "#475569" }}>↻ Recargar</button>
    </div>
    {items.length === 0 ? <div style={{ textAlign: "center", padding: 42, color: "#64748b", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12 }}><div style={{ fontSize: 34 }}>✓</div><div style={{ marginTop: 8 }}>No hay reactivaciones por revisar.</div></div> : <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{items.map(item => <ReactivacionCard key={item.id} item={item} onOpenConversation={onOpenConversation} onProcessed={(id) => setItems(prev => prev.filter(x => x.id !== id))} />)}</div>}
  </section>;
}
