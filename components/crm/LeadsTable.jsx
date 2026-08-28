"use client";

const esLeadBot = (lead) =>
  lead.origen === "bot" || (!lead.origen && lead.notas?.includes("automáticamente desde WhatsApp"));

const FbIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="#1877F2" xmlns="http://www.w3.org/2000/svg" style={{ display: "inline", verticalAlign: "middle" }}>
    <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.253h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
  </svg>
);

const origenIcon = (lead) => {
  if (lead.origen === "meta_ads") return <FbIcon />;
  if (esLeadBot(lead)) return "🤖";
  return "👤";
};

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
    <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
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
                  <span title={lead.origen === "meta_ads" ? "Meta Ads" : esLeadBot(lead) ? "WhatsApp bot" : "Manual"} style={{ fontSize: 14 }}>
                    {origenIcon(lead)}
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
