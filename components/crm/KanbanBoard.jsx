"use client";

const esLeadBot = (lead) =>
  lead.origen === "bot" || (!lead.origen && lead.notas?.includes("automáticamente desde WhatsApp"));

const FbIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="#1877F2" xmlns="http://www.w3.org/2000/svg" style={{ display: "inline", verticalAlign: "middle" }}>
    <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.253h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
  </svg>
);

const origenIcon = (lead) => {
  if (lead.origen === "meta_ads") return <FbIcon />;
  if (esLeadBot(lead)) return "🤖";
  return "👤";
};

export default function KanbanBoard({
  STAGES,
  byStage,
  formatPeso,
  dragId,
  setDragId,
  handleDrop,
  setSelectedLead,
  getNombreVendedor,
  goToConversation,
  hasConversation,
}) {
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 14, paddingBottom: 8, minWidth: "max-content" }}>
      {STAGES.map((stage) => (
        <div
          key={stage.id}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }}
          onDragLeave={(e) => e.currentTarget.classList.remove("drag-over")}
          onDrop={(e) => { e.currentTarget.classList.remove("drag-over"); handleDrop(stage.id); }}
          className="col-drop"
          style={{ minWidth: 220, flex: "0 0 220px" }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, padding: "10px 12px", background: stage.bg, borderRadius: 8, border: `1px solid ${stage.color}22` }}>
            <div>
              <div style={{ fontSize: 11, color: stage.color, fontWeight: 500, letterSpacing: 0.5 }}>{stage.label}</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{formatPeso(byStage(stage.id).reduce((a, b) => a + b.valor, 0))}</div>
            </div>
            <div style={{ background: stage.color + "22", color: stage.color, borderRadius: "50%", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>
              {byStage(stage.id).length}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {byStage(stage.id).map((lead) => (
              <div
                key={lead.id}
                className="card"
                draggable
                onDragStart={() => setDragId(lead.id)}
                onDragEnd={() => setDragId(null)}
                onClick={() => setSelectedLead(lead)}
                style={{ padding: 12, opacity: dragId === lead.id ? 0.7 : 1 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{lead.nombre || lead.whatsapp}</span>
                  <span title={lead.origen === "meta_ads" ? "Meta Ads" : esLeadBot(lead) ? "Lead por WhatsApp bot" : "Lead manual"} style={{ fontSize: 11 }}>{origenIcon(lead)}</span>
                </div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 8 }}>{lead.curso}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: stage.color, fontWeight: 600 }}>{formatPeso(lead.valor)}</span>
                  <span style={{ fontSize: 10, color: "#555" }}>{getNombreVendedor(lead.asignado_a)}</span>
                </div>
                {lead.created_at && (
                  <div style={{ marginTop: 5, fontSize: 10, color: "#999" }}>
                    Entró: {new Date(lead.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Mexico_City" })}
                  </div>
                )}
                {lead.notas && (
                  <div style={{ marginTop: 8, fontSize: 10, color: "#666", borderTop: "1px solid #222", paddingTop: 6, lineHeight: 1.4 }}>
                    {lead.notas.slice(0, 50)}{lead.notas.length > 50 ? "…" : ""}
                  </div>
                )}
                {hasConversation(lead) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); goToConversation(lead); }}
                    style={{ marginTop: 8, width: "100%", background: "#e8f5e9", border: "1px solid #25D36633", borderRadius: 6, color: "#128C7E", fontSize: 10, fontWeight: 600, padding: "5px 0", cursor: "pointer", letterSpacing: 0.5 }}
                  >
                    💬 Ver conversación
                  </button>
                )}
              </div>
            ))}
            {byStage(stage.id).length === 0 && (
              <div style={{ textAlign: "center", padding: "20px 0", fontSize: 11, color: "#333" }}>vacio</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
