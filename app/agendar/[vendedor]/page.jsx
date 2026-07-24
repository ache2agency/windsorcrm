"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// Bloques fijos por tipo y día de la semana
function getAvailableBlocks(tipo, date) {
  if (!tipo || !date) return [];
  const dow = date.getDay(); // 0=Dom,1=Lun,2=Mar,3=Mié,4=Jue,5=Vie,6=Sáb

  if (tipo === "inscripcion") {
    if (dow >= 1 && dow <= 5) {
      return [
        { label: "08:00", value: "08:00" },
        { label: "09:00", value: "09:00" },
        { label: "10:00", value: "10:00" },
        { label: "11:00", value: "11:00" },
        { label: "12:00", value: "12:00" },
        { label: "13:00", value: "13:00" },
        { label: "17:00", value: "17:00" },
        { label: "18:00", value: "18:00" },
        { label: "19:00", value: "19:00" },
      ];
    } else if (dow === 6) {
      return [
        { label: "08:00", value: "08:00" },
        { label: "09:00", value: "09:00" },
        { label: "10:00", value: "10:00" },
        { label: "11:00", value: "11:00" },
        { label: "12:00", value: "12:00" },
        { label: "13:00", value: "13:00" },
      ];
    }
    return [];
  }

  if (tipo === "adulto") {
    if (dow >= 1 && dow <= 5) {
      return [
        { label: "10:00–12:00", value: "10:00" },
        { label: "17:00–19:00", value: "17:00" },
      ];
    } else if (dow === 6) {
      return [
        { label: "09:00–13:00", value: "09:00" },
        { label: "13:00–17:00", value: "13:00" },
      ];
    }
    return [];
  }

  // Niños: Mar/Mié/Jue → dos bloques · Sáb → un bloque
  if (dow === 2 || dow === 3 || dow === 4) {
    return [
      { label: "13:00–14:00", value: "13:00" },
      { label: "17:00–18:00", value: "17:00" },
    ];
  } else if (dow === 6) {
    return [{ label: "09:00–13:00", value: "09:00" }];
  }
  return [];
}

function isDayAvailable(tipo, date) {
  return getAvailableBlocks(tipo, date).length > 0;
}

export default function AgendarPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const vendedorEmail = params?.vendedor ? decodeURIComponent(String(params.vendedor)) : "";

  // Parámetros del URL enviados por el bot
  const tipoParam = searchParams.get("tipo") || ""; // 'clase_prueba' | 'inscripcion'
  const nombreParam = searchParams.get("nombre") || "";
  const emailParam = searchParams.get("email") || "";
  const programaParam = searchParams.get("programa") || "";
  const telefonoParam = searchParams.get("telefono") || "";

  const isInscripcion = tipoParam === "inscripcion";

  const today = useMemo(() => new Date(), []);

  const [vendedor, setVendedor] = useState(null);
  const [loadingVendedor, setLoadingVendedor] = useState(true);
  // Para clase_prueba el usuario elige adulto/ninos; para inscripcion se deriva del URL
  const [tipoAlumno, setTipoAlumno] = useState(null); // "adulto" | "ninos"
  // tipo efectivo para bloques y calendario — derivado, nunca stale
  const tipo = isInscripcion ? "inscripcion" : tipoAlumno;
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  // Pre-llenar con datos del bot (via useEffect para evitar problemas de hidratación)
  const [nombre, setNombre] = useState("");
  const [edad, setEdad] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  useEffect(() => {
    if (nombreParam) setNombre(nombreParam);
    if (emailParam) setEmail(emailParam);
    if (telefonoParam) setWhatsapp(telefonoParam);
  }, [nombreParam, emailParam, telefonoParam]);
  const [notas, setNotas] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(null);

  const daysInMonth = useMemo(
    () => new Date(calYear, calMonth + 1, 0).getDate(),
    [calYear, calMonth]
  );

  const firstDayOfWeek = useMemo(
    () => new Date(calYear, calMonth, 1).getDay(),
    [calYear, calMonth]
  );

  const todayMidnight = useMemo(
    () => new Date(today.getFullYear(), today.getMonth(), today.getDate()),
    [today]
  );

  const isCurrentMonth =
    calYear === today.getFullYear() && calMonth === today.getMonth();

  const goNextMonth = () => {
    if (calMonth === 11) {
      setCalMonth(0);
      setCalYear(calYear + 1);
    } else {
      setCalMonth(calMonth + 1);
    }
    setSelectedDate(null);
    setSelectedTime(null);
  };

  useEffect(() => {
    if (!vendedorEmail) {
      setLoadingVendedor(false);
      return;
    }
    const loadVendedor = async () => {
      setLoadingVendedor(true);
      setError("");
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("email", vendedorEmail)
        .maybeSingle();
      if (error || !data) {
        setError("No encontramos a este vendedor. Verifica el enlace.");
      } else {
        setVendedor(data);
      }
      setLoadingVendedor(false);
    };
    loadVendedor();
  }, [vendedorEmail]);

  const onConfirm = async () => {
    if (!vendedor) return;
    if (!isInscripcion && !tipoAlumno) {
      setError("Selecciona si es para adulto o niño.");
      return;
    }
    if (!selectedDate || !selectedTime) {
      setError(`Selecciona un día y un horario para tu ${isInscripcion ? "visita" : "clase de prueba"}.`);
      return;
    }
    if (!nombre.trim() || !email.trim()) {
      setError("Nombre y email son obligatorios.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const fechaIso = selectedDate.toISOString().slice(0, 10);
      const hora = `${selectedTime}:00`;

      let cursoLabel;
      if (isInscripcion) {
        cursoLabel = programaParam || "Inscripción";
      } else {
        cursoLabel = tipoAlumno === "adulto" ? "Inglés para adultos" : "Inglés para niños";
      }

      const notasCompletas = [
        !isInscripcion && edad.trim() ? `Edad: ${edad.trim()} años` : null,
        notas.trim() || null,
      ].filter(Boolean).join("\n");

      const stage = isInscripcion ? "inscripcion_pendiente" : "clase_muestra";
      const citaTipo = isInscripcion ? "inscripcion" : "clase_prueba";
      const citaTitulo = isInscripcion
        ? `Visita de inscripción (${cursoLabel}) - ${nombre.trim()}`
        : `Clase de prueba (${cursoLabel}) - ${nombre.trim()}`;

      const res = await fetch("/api/agendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendedorEmail,
          nombre: nombre.trim(),
          email: email.trim(),
          whatsapp: whatsapp.trim(),
          cursoLabel,
          notas: notasCompletas,
          stage,
          fechaIso,
          hora,
          duracion: isInscripcion ? 30 : 60,
          citaTipo,
          citaTitulo,
        }),
      });
      const result = await res.json();

      if (!res.ok || !result.lead || !result.cita) {
        setError(result.error || "No pudimos guardar tu cita. Intenta de nuevo.");
        setSubmitting(false);
        return;
      }

      const { lead: leadData, cita: citaData } = result;

      setConfirmed({ lead: leadData, cita: citaData });

      if (!isInscripcion) {
        try {
          await fetch("/api/emails/sequence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lead_id: leadData.id,
              email: leadData.email,
              nombre: leadData.nombre,
            }),
          });
        } catch {
          // Secuencia opcional; no bloquear confirmación
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const renderCalendar = () => {
    const cells = [];

    DAY_LABELS.forEach((label) => {
      cells.push(
        <div
          key={`header-${label}`}
          style={{
            fontSize: 10,
            color: "#555",
            textAlign: "center",
            paddingBottom: 4,
            letterSpacing: 0.5,
          }}
        >
          {label}
        </div>
      );
    });

    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push(<div key={`empty-${i}`} />);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(calYear, calMonth, d);
      const isPast = date < todayMidnight;
      const noBlocks = !isPast && !isDayAvailable(tipo, date);
      const disabled = isPast || noBlocks || !tipo;
      const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString();

      cells.push(
        <button
          key={d}
          disabled={disabled}
          onClick={() => {
            setSelectedDate(date);
            setSelectedTime(null);
          }}
          style={{
            borderRadius: 6,
            padding: "6px 0",
            border: `1px solid ${isSelected ? "#E8A838" : "#2a2a2a"}`,
            background: isSelected ? "#E8A838" : "transparent",
            color: isSelected ? "#0e0e0e" : disabled ? "#252525" : "#e0e0e0",
            fontSize: 12,
            cursor: disabled ? "default" : "pointer",
          }}
        >
          {d}
        </button>
      );
    }

    return (
      <>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <button
            onClick={() => {
              if (isCurrentMonth) return;
              if (calMonth === 0) {
                setCalMonth(11);
                setCalYear(calYear - 1);
              } else {
                setCalMonth(calMonth - 1);
              }
              setSelectedDate(null);
              setSelectedTime(null);
            }}
            disabled={isCurrentMonth}
            style={{
              background: "transparent",
              border: "1px solid #2a2a2a",
              borderRadius: 6,
              color: isCurrentMonth ? "#252525" : "#777",
              fontSize: 14,
              cursor: isCurrentMonth ? "default" : "pointer",
              padding: "2px 10px",
              lineHeight: 1.4,
            }}
          >
            ←
          </button>
          <span style={{ fontSize: 12, color: "#e0e0e0" }}>
            {MONTH_NAMES[calMonth]} {calYear}
          </span>
          <button
            onClick={goNextMonth}
            style={{
              background: "transparent",
              border: "1px solid #2a2a2a",
              borderRadius: 6,
              color: "#777",
              fontSize: 14,
              cursor: "pointer",
              padding: "2px 10px",
              lineHeight: 1.4,
            }}
          >
            →
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {cells}
        </div>
      </>
    );
  };

  const renderBlocks = () => {
    if (!tipo) {
      return <div style={{ fontSize: 12, color: "#555" }}>Selecciona el tipo de alumno primero.</div>;
    }
    if (!selectedDate) {
      return <div style={{ fontSize: 12, color: "#777" }}>Elige un día para ver los horarios disponibles.</div>;
    }
    const blocks = getAvailableBlocks(tipo, selectedDate);
    if (blocks.length === 0) {
      return <div style={{ fontSize: 12, color: "#555" }}>No hay horarios disponibles este día.</div>;
    }
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {blocks.map((block) => {
          const isSelected = selectedTime === block.value;
          return (
            <button
              key={block.value}
              onClick={() => setSelectedTime(block.value)}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: `1px solid ${isSelected ? "#E8A838" : "#333"}`,
                background: isSelected ? "#E8A838" : "#1a1a1a",
                color: isSelected ? "#0e0e0e" : "#e0e0e0",
                fontSize: 13,
                cursor: "pointer",
                letterSpacing: 0.5,
              }}
            >
              {block.label}
            </button>
          );
        })}
      </div>
    );
  };

  // ── Estados de carga y error ──────────────────────────────────────────────

  if (loadingVendedor) {
    return (
      <div style={{ fontFamily: "'DM Mono', monospace", background: "#0e0e0e", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#777" }}>
        Cargando agenda...
      </div>
    );
  }

  if (!vendedor && error) {
    return (
      <div style={{ fontFamily: "'DM Mono', monospace", background: "#0e0e0e", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#E85D38", padding: 24, textAlign: "center" }}>
        {error}
      </div>
    );
  }

  if (confirmed) {
    const { lead, cita } = confirmed;
    const allBlocks = getAvailableBlocks(tipo, selectedDate);
    const block = allBlocks.find((b) => b.value === selectedTime);
    return (
      <div style={{ fontFamily: "'DM Mono', monospace", background: "#0e0e0e", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');`}</style>
        <div style={{ background: "#161616", borderRadius: 12, border: "1px solid #2a2a2a", padding: 28, maxWidth: 460, width: "100%" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 3, color: "#E8A838", marginBottom: 6 }}>
            INSTITUTO WINDSOR
          </div>
          <div style={{ fontSize: 12, color: "#777", marginBottom: 24 }}>
            {isInscripcion ? "Tu visita de inscripción quedó agendada." : "Tu clase de prueba quedó agendada."}
          </div>
          <div style={{ fontSize: 13, color: "#e0e0e0", marginBottom: 6 }}>{lead.nombre}</div>
          <div style={{ fontSize: 12, color: "#777", marginBottom: 16 }}>{lead.email} · {lead.whatsapp}</div>
          <div style={{ fontSize: 12, color: "#e0e0e0", marginBottom: 4 }}>Programa: {lead.curso}</div>
          <div style={{ fontSize: 12, color: "#e0e0e0", marginBottom: 4 }}>Fecha: {cita.fecha}</div>
          <div style={{ fontSize: 12, color: "#e0e0e0", marginBottom: 4 }}>
            Hora: {block ? block.label : cita.hora?.slice(0, 5)}
          </div>
          <div style={{ fontSize: 12, color: "#777", marginTop: 12 }}>
            Te enviaremos un recordatorio por WhatsApp. ¡Nos vemos pronto!
          </div>
        </div>
      </div>
    );
  }

  // ── Vista principal ───────────────────────────────────────────────────────

  return (
    <div
      style={{
        fontFamily: "'DM Mono', monospace",
        background: "#0e0e0e",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        color: "#e0e0e0",
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');`}</style>
      <div
        style={{
          maxWidth: 900,
          width: "100%",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.2fr)",
          gap: 32,
        }}
      >
        {/* Columna izquierda — Calendario */}
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 3, color: "#E8A838", marginBottom: 6 }}>
            INSTITUTO WINDSOR
          </div>
          <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, marginBottom: 24 }}>
            Agenda de admisiones
          </div>
          <div style={{ fontSize: 14, color: "#e0e0e0", marginBottom: 4 }}>
            {isInscripcion ? "Agenda tu visita de inscripción" : "Agenda tu clase de prueba"}
          </div>
          <div style={{ fontSize: 12, color: "#777", marginBottom: 16 }}>
            {vendedor?.nombre || vendedorEmail} · Presencial
            {isInscripcion && programaParam && (
              <span style={{ color: "#555", marginLeft: 8 }}>· {programaParam}</span>
            )}
          </div>

          {/* Selector tipo alumno — solo para clase de prueba */}
          {!isInscripcion && (
            <div style={{ background: "#161616", borderRadius: 10, border: "1px solid #2a2a2a", padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#777", marginBottom: 10 }}>¿Para quién es la clase?</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { value: "adulto", label: "Adulto", sub: "12 años en adelante" },
                  { value: "ninos", label: "Niño", sub: "4 a 12 años" },
                ].map((opt) => {
                  const isActive = tipoAlumno === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setTipoAlumno(opt.value);
                        setSelectedDate(null);
                        setSelectedTime(null);
                      }}
                      style={{
                        borderRadius: 8,
                        padding: "10px 8px",
                        border: `1px solid ${isActive ? "#E8A838" : "#2a2a2a"}`,
                        background: isActive ? "rgba(232,168,56,0.12)" : "#0e0e0e",
                        color: isActive ? "#E8A838" : "#777",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{opt.label}</div>
                      <div style={{ fontSize: 10, color: isActive ? "#b07820" : "#444", marginTop: 2 }}>{opt.sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Horarios disponibles info — solo para inscripcion */}
          {isInscripcion && (
            <div style={{ background: "#161616", borderRadius: 10, border: "1px solid #2a2a2a", padding: 14, marginBottom: 16, fontSize: 11, color: "#555" }}>
              🕐 Lun–Vie 8:00–14:00 y 17:00–20:00 &nbsp;|&nbsp; Sáb 8:00–14:00
            </div>
          )}

          {/* Calendario */}
          <div style={{ background: "#161616", borderRadius: 10, border: "1px solid #2a2a2a", padding: 16 }}>
            <div style={{ fontSize: 11, color: "#777", marginBottom: 12 }}>
              Selecciona un día
              {!isInscripcion && tipo === "ninos" && (
                <span style={{ color: "#444", marginLeft: 8 }}>— Mar · Mié · Jue · Sáb</span>
              )}
            </div>
            {renderCalendar()}
          </div>

          {/* Bloques de horario */}
          <div style={{ marginTop: 16, background: "#161616", borderRadius: 10, border: "1px solid #2a2a2a", padding: 16 }}>
            <div style={{ fontSize: 11, color: "#777", marginBottom: 10 }}>
              {isInscripcion ? "Elige tu hora de llegada" : "Horario disponible"}
            </div>
            {renderBlocks()}
          </div>
        </div>

        {/* Columna derecha — Formulario */}
        <div>
          <div style={{ background: "#161616", borderRadius: 10, border: "1px solid #2a2a2a", padding: 20 }}>
            <div style={{ fontSize: 12, color: "#e0e0e0", marginBottom: 16 }}>Tus datos</div>
            <div style={{ display: "grid", gap: 12 }}>
              {/* Si vienen del bot: mostrar como confirmación; si no: campo editable */}
              {nombreParam ? (
                <div>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 4 }}>NOMBRE</div>
                  <div style={{ fontSize: 13, color: "#e0e0e0" }}>{nombre}</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 6 }}>NOMBRE</div>
                  <input className="input" style={{ width: "100%" }} placeholder="Tu nombre completo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                </div>
              )}
              {/* Edad solo para clase de prueba y solo si no viene pre-llenado */}
              {!isInscripcion && (
                <div>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 6 }}>EDAD</div>
                  <input className="input" style={{ width: "100%" }} placeholder="Ej. 25" type="number" min="4" max="99" value={edad} onChange={(e) => setEdad(e.target.value)} />
                </div>
              )}
              {emailParam ? (
                <div>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 4 }}>EMAIL</div>
                  <div style={{ fontSize: 13, color: "#e0e0e0" }}>{email}</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 6 }}>EMAIL</div>
                  <input className="input" style={{ width: "100%" }} placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              )}
              {telefonoParam ? (
                <div>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 4 }}>WHATSAPP</div>
                  <div style={{ fontSize: 13, color: "#e0e0e0" }}>{whatsapp}</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 6 }}>WHATSAPP</div>
                  <input className="input" style={{ width: "100%" }} placeholder="+52 55 XXXX XXXX" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
                </div>
              )}
              {!isInscripcion && (
                <div>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 6 }}>NOTAS</div>
                  <textarea className="input" style={{ width: "100%", minHeight: 80 }} placeholder="Cuéntanos brevemente qué te interesa mejorar o aprender." value={notas} onChange={(e) => setNotas(e.target.value)} />
                </div>
              )}
            </div>
            {error && (
              <div style={{ marginTop: 12, fontSize: 11, color: "#E85D38" }}>{error}</div>
            )}
            <button
              className="btn btn-primary"
              style={{ marginTop: 16, width: "100%", padding: "10px 0", fontSize: 13 }}
              onClick={onConfirm}
              disabled={submitting}
            >
              {submitting ? "Agendando..." : isInscripcion ? "Confirmar visita →" : "Confirmar clase de prueba →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
