"use client";

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
                  <span title={lead.origen === "bot" ? "Lead por WhatsApp bot" : "Lead manual"} style={{ fontSize: 11 }}>{lead.origen === "bot" ? "🤖" : "👤"}</span>
                </div>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 8 }}>{lead.curso}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: stage.color, fontWeight: 600 }}>{formatPeso(lead.valor)}</span>
                  <span style={{ fontSize: 10, color: "#555" }}>{getNombreVendedor(lead.asignado_a)}</span>
                </div>
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
