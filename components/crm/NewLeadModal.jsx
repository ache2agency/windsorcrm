"use client";
import { useState } from "react";

const PROGRAMAS = [
  { group: "Inglés", options: ["Inglés para adultos", "Inglés para niños", "Francés", "Italiano", "Verano adultos", "Verano niños"] },
  { group: "Licenciaturas", options: ["Licenciatura en Inglés", "Relaciones públicas y mercadotecnia", "Administración turística", "Psicología"] },
  { group: "Maestrías", options: ["Maestría en Innovación empresarial", "Maestría en Multiculturalidad y Plurilingüismo"] },
  { group: "Bachillerato", options: ["Bachillerato"] },
  { group: "Diplomados", options: [
    "Administración de Instituciones de la Salud", "Administración de recursos humanos",
    "Administración de restaurantes", "Análisis y Evaluación de Políticas Públicas",
    "Comunicación y Liderazgo en el Sector Público", "Comunicación y Liderazgo empresarial",
    "Competencias educativas", "Comunicación y Gobierno Digital", "Contabilidad",
    "Creación y dirección de franquicias", "Ciencias del deporte", "Enfermería",
    "Epidemiología", "Equidad de género y diversidad sexual", "Farmacología",
    "Gamificación educativa", "Gerontología", "Innovación y Gobierno Digital",
    "Mindfulness", "Nutrición deportiva", "Nutrición y Dietética",
    "Políticas y Procesos de Participación Ciudadana", "Psicología criminológica",
    "Psicología educativa", "Realidad Virtual", "Salud pública", "Tecnología educativa",
    "Terapia ocupacional", "Tanatología", "Enseñanza del idioma inglés",
    "Enseñanza del idioma español",
  ]},
];

export default function NewLeadModal({
  showForm,
  setShowForm,
  newLead,
  setNewLead,
  vendedores,
  addLead,
}) {
  const [saving, setSaving] = useState(false);
  if (!showForm) return null;

  const handleAdd = async () => {
    if (saving) return;
    setSaving(true);
    await addLead();
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={() => setShowForm(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 24 }}>
          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 24, color: "#E8A838", letterSpacing: 2, marginBottom: 20 }}>NUEVO LEAD</div>
          <div style={{ display: "grid", gap: 14 }}>
            {[
              { label: "NOMBRE *", key: "nombre", placeholder: "Nombre completo" },
              { label: "EMAIL", key: "email", placeholder: "correo@email.com" },
              { label: "WHATSAPP", key: "whatsapp", placeholder: "+52 55 XXXX XXXX" },
              { label: "VALOR ESTIMADO ($)", key: "valor", placeholder: "0" },
            ].map((f) => (
              <div key={f.key}>
                <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 6 }}>{f.label}</div>
                <input
                  className="input"
                  placeholder={f.placeholder}
                  value={newLead[f.key]}
                  onChange={(e) => setNewLead((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
            <div>
              <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 6 }}>PROGRAMA INTERESADO</div>
              <select className="select" value={newLead.curso} onChange={(e) => setNewLead((p) => ({ ...p, curso: e.target.value }))}>
                {PROGRAMAS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 6 }}>ASIGNAR A VENDEDOR</div>
              <select className="select" value={newLead.asignado_a} onChange={(e) => setNewLead((p) => ({ ...p, asignado_a: e.target.value }))}>
                {vendedores.map((v) => (
                  <option key={v.id} value={v.id}>{v.nombre || v.email} {v.rol === "admin" ? "(admin)" : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 6 }}>NOTAS INICIALES</div>
              <textarea className="input" placeholder="¿De dónde llegó? ¿Qué necesita?" value={newLead.notas}
                onChange={(e) => setNewLead((p) => ({ ...p, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleAdd} disabled={saving}>{saving ? "GUARDANDO..." : "AGREGAR LEAD →"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
