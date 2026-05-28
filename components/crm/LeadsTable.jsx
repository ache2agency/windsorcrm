"use client";

const esLeadBot = (lead) =>
  lead.origen === "bot" || (!lead.origen && lead.notas?.includes("automáticamente desde WhatsApp"));

export default function LeadsTable({
  filteredLeads,
  STAGES,
  setSelectedLead,
  formatPeso,
  getNombreVendedor,
  openWA,
  normalizeStage,
}) {
  return (
    <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
            {["NOMBRE", "ORIGEN", "CURSO", "ETAPA", "VALOR", "ASIGNADO A", "FECHA", "ACCIONES"].map((h) => (
              <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 10, color: "#94a3b8", letterSpacing: 1.5, fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredLeads.map((lead) => {
            const stage = STAGES.find((s) => s.id === normalizeStage(lead.stage));
            return (
              <tr
                key={lead.id}
                style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                onClick={() => setSelectedLead(lead)}
              >
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ fontWeight: 500, color: "#1e293b" }}>{lead.nombre || lead.whatsapp}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{lead.email}</div>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "center" }}>
                  <span title={esLeadBot(lead) ? "WhatsApp bot" : "Manual"} style={{ fontSize: 14 }}>
                    {esLeadBot(lead) ? "🤖" : "👤"}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", color: "#64748b", fontSize: 12 }}>{lead.curso}</td>
                <td style={{ padding: "12px 16px" }}>
                  <span className="tag" style={{ background: stage?.color + "22", color: stage?.color }}>{stage?.label}</span>
                </td>
                <td style={{ padding: "12px 16px", color: stage?.color, fontWeight: 600 }}>{formatPeso(lead.valor)}</td>
                <td style={{ padding: "12px 16px", color: "#64748b", fontSize: 12 }}>{getNombreVendedor(lead.asignado_a)}</td>
                <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 11 }}>{lead.fecha}</td>
                <td style={{ padding: "12px 16px" }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-wa" onClick={() => openWA(lead)}>WA</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
