"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  RotateCcw,
  X,
  Plus,
  AlertTriangle,
  Pencil,
  Trash2,
  CalendarOff,
  Loader2,
} from "lucide-react";

import { DOCTORS, DOCTOR_MAP, SHIFT_DEFS, SHIFT_ORDER, WEEKDAY_LABELS, AXIS_START, AXIS_END } from "@/lib/constants";
import type { RosterData, Leave, RosterApiResponse } from "@/lib/types";

/* ---------------- date helpers (client-safe) ---------------- */

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (y: number, mZero: number, d: number) => `${y}-${pad(mZero + 1)}-${pad(d)}`;
const daysInMonth = (y: number, mZero: number) => new Date(y, mZero + 1, 0).getDate();
const dowOf = (iso: string) => new Date(iso + "T00:00:00").getDay();
const monthLabel = (y: number, mZero: number) =>
  new Date(y, mZero, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

/* ---------------- API helpers ---------------- */

async function fetchRosterApi(year: number, month: number): Promise<RosterApiResponse> {
  const res = await fetch(`/api/roster?year=${year}&month=${month}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Failed to load roster");
  }
  return res.json();
}

async function generateRosterApi(
  year: number,
  month: number,
  resetManual: boolean
): Promise<RosterApiResponse> {
  const res = await fetch("/api/roster/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, month, resetManual }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Failed to generate roster");
  }
  return res.json();
}

async function mutateAssignment(payload: {
  rosterId: string;
  date: string;
  shiftTypeId: string;
  action: "add" | "remove" | "clear" | "toggle_active";
  doctorId?: string;
  note?: string;
  year: number;
  month: number;
}): Promise<RosterApiResponse & { warnings?: string[] }> {
  const res = await fetch("/api/assignments", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Failed to update assignment");
  }
  return res.json();
}

async function addLeaveApi(
  doctorId: string,
  date: string,
  year: number,
  month: number
): Promise<RosterApiResponse> {
  const res = await fetch("/api/leaves", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doctorId, date, year, month }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Failed to add leave");
  }
  return res.json();
}

async function removeLeaveApi(
  id: string,
  year: number,
  month: number
): Promise<RosterApiResponse> {
  const res = await fetch(`/api/leaves/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, month }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Failed to remove leave");
  }
  return res.json();
}

/* ---------------- small UI atoms ---------------- */

function DayTimeline({ shifts }: { shifts: RosterData[string]["shifts"] }) {
  return (
    <div className="flex flex-col gap-[2px] mt-1.5">
      {SHIFT_ORDER.map((k) => {
        const def = SHIFT_DEFS[k];
        const s = shifts[k];
        if (!s) return null;
        const left = ((def.startH - AXIS_START) / (AXIS_END - AXIS_START)) * 100;
        const width = ((def.endH - def.startH) / (AXIS_END - AXIS_START)) * 100;
        const filled = s.active && s.assignments.length > 0;
        return (
          <div key={k} className="relative h-[5px] rounded-full bg-slate-100 overflow-hidden">
            {s.active ? (
              <div
                className="absolute top-0 bottom-0 rounded-full"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: filled ? def.color : "transparent",
                  border: filled ? "none" : `1.5px dashed ${def.color}66`,
                }}
              />
            ) : (
              <div
                className="absolute top-0 bottom-0 rounded-full opacity-30"
                style={{ left: `${left}%`, width: `${width}%`, backgroundColor: "#9AA3AF" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DoctorChip({
  doctorId,
  onRemove,
  manual,
}: {
  doctorId: string;
  onRemove?: (id: string) => void;
  manual?: boolean;
}) {
  const d = DOCTOR_MAP[doctorId];
  if (!d) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-[11px] font-medium text-white"
      style={{ backgroundColor: d.chip }}
    >
      {d.initials}
      {manual && <span className="w-1.5 h-1.5 rounded-full bg-white/80" title="Manually edited" />}
      {onRemove && (
        <button
          onClick={() => onRemove(doctorId)}
          className="hover:bg-white/20 rounded-full p-0.5"
          aria-label={`Remove ${d.name}`}
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-slate-200 ${className ?? ""}`}
    />
  );
}

/* ---------------- main component ---------------- */

export default function DutyRoster() {
  const [year, setYear] = useState(2026);
  const [monthZero, setMonthZero] = useState(5); // June 2026

  const [roster, setRoster] = useState<RosterData>({});
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [rosterId, setRosterId] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmKind, setConfirmKind] = useState<"regen" | "reset" | null>(null);
  const [addLeaveOpen, setAddLeaveOpen] = useState(false);
  const [leaveDraft, setLeaveDraft] = useState({ doctorId: DOCTORS[0].id, date: "2026-06-01" });
  const [pendingAdd, setPendingAdd] = useState<Record<string, string>>({});

  // ── Data fetching ────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setApiError(null);
      try {
        const res = await fetch(`/api/roster?year=${year}&month=${monthZero + 1}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load roster");
        if (!cancelled) {
          setRoster(data.roster);
          setLeaves(data.leaves);
          setRosterId(data.rosterId);
          setSelected(null);
        }
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        if (!cancelled) {
          setApiError(err instanceof Error ? err.message : "Failed to load roster");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [year, monthZero]);

  // ── Derived values ───────────────────────────────────────

  const days = useMemo(() => {
    const n = daysInMonth(year, monthZero);
    return Array.from({ length: n }, (_, i) => toISO(year, monthZero, i + 1));
  }, [year, monthZero]);

  const leadingBlanks = dowOf(toISO(year, monthZero, 1));

  const hasManualThisMonth = useMemo(
    () => days.some(iso => roster[iso] && Object.values(roster[iso].manualCells ?? {}).some(Boolean)),
    [days, roster]
  );

  const selectedDay = selected ? roster[selected] : null;

  // ── Mutations ────────────────────────────────────────────

  async function runMutation<T>(fn: () => Promise<T>): Promise<T | null> {
    setIsMutating(true);
    setApiError(null);
    try {
      return await fn();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Operation failed");
      return null;
    } finally {
      setIsMutating(false);
    }
  }

  function applyApiResponse(data: RosterApiResponse) {
    setRoster(data.roster);
    setLeaves(data.leaves);
    setRosterId(data.rosterId);
  }

  async function regenerate(resetManual: boolean) {
    setConfirmKind(null);
    setWarnings([]);
    const data = await runMutation(() => generateRosterApi(year, monthZero + 1, resetManual));
    if (data) applyApiResponse(data);
  }

  function shiftMonth(delta: number) {
    let m = monthZero + delta,
      y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonthZero(m);
    setYear(y);
  }

  async function addDoctorToShift(iso: string, shiftKey: string, doctorId: string) {
    if (!rosterId) return;
    const data = await runMutation(() =>
      mutateAssignment({
        rosterId,
        date: iso,
        shiftTypeId: shiftKey,
        action: "add",
        doctorId,
        year,
        month: monthZero + 1,
      })
    );
    if (data) {
      applyApiResponse(data);
      setWarnings(data.warnings ?? []);
      setPendingAdd(p => ({ ...p, [shiftKey]: "" }));
    }
  }

  async function removeDoctorFromShift(iso: string, shiftKey: string, doctorId: string) {
    if (!rosterId) return;
    const data = await runMutation(() =>
      mutateAssignment({
        rosterId,
        date: iso,
        shiftTypeId: shiftKey,
        action: "remove",
        doctorId,
        year,
        month: monthZero + 1,
      })
    );
    if (data) applyApiResponse(data);
  }

  async function clearShift(iso: string, shiftKey: string) {
    if (!rosterId) return;
    const data = await runMutation(() =>
      mutateAssignment({
        rosterId,
        date: iso,
        shiftTypeId: shiftKey,
        action: "clear",
        year,
        month: monthZero + 1,
      })
    );
    if (data) applyApiResponse(data);
  }

  async function toggleShiftActive(iso: string, shiftKey: string) {
    if (!rosterId) return;
    const data = await runMutation(() =>
      mutateAssignment({
        rosterId,
        date: iso,
        shiftTypeId: shiftKey,
        action: "toggle_active",
        year,
        month: monthZero + 1,
      })
    );
    if (data) applyApiResponse(data);
  }

  async function addLeave() {
    const data = await runMutation(() =>
      addLeaveApi(leaveDraft.doctorId, leaveDraft.date, year, monthZero + 1)
    );
    if (data) {
      applyApiResponse(data);
      setAddLeaveOpen(false);
    }
  }

  async function removeLeave(id: string) {
    const data = await runMutation(() => removeLeaveApi(id, year, monthZero + 1));
    if (data) applyApiResponse(data);
  }

  // ── Render ───────────────────────────────────────────────

  return (
    <div
      className="w-full min-h-full"
      style={{
        background: "#EEF1F5",
        fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui",
        color: "#1B2430",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap');
      `}</style>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* header */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
          <div>
            <div
              className="text-[11px] tracking-[0.16em] uppercase font-medium"
              style={{ color: "#5B6472", fontFamily: "'IBM Plex Mono', monospace" }}
            >
              Emergency Department · Duty Roster
            </div>
            <h1
              className="text-2xl sm:text-3xl font-semibold mt-0.5"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {monthLabel(year, monthZero)}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => shiftMonth(-1)}
              disabled={isMutating || isLoading}
              className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => shiftMonth(1)}
              disabled={isMutating || isLoading}
              className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => setConfirmKind("regen")}
              disabled={isMutating || isLoading}
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              style={{ backgroundColor: "#1B2430" }}
            >
              {isMutating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Generate roster
            </button>
            <button
              onClick={() => setConfirmKind("reset")}
              disabled={isMutating || isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40"
            >
              <RotateCcw size={14} /> Reset month
            </button>
          </div>
        </div>

        {/* legend */}
        <div className="flex flex-wrap gap-3 mb-4 text-[12px]" style={{ color: "#5B6472" }}>
          {SHIFT_ORDER.map((k) => (
            <div
              key={k}
              className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-full pl-2 pr-2.5 py-1"
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SHIFT_DEFS[k].color }} />
              <span className="font-medium" style={{ color: "#1B2430" }}>
                {SHIFT_DEFS[k].label}
              </span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{SHIFT_DEFS[k].time}</span>
            </div>
          ))}
        </div>

        {hasManualThisMonth && !isLoading && (
          <div className="mb-4 text-[12px] inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1.5">
            <Pencil size={12} /> This month has manually edited shifts — regeneration will keep them unless
            you reset the month.
          </div>
        )}

        {/* API error banner */}
        {apiError && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-[13px]">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <span className="font-semibold">Error: </span>{apiError}
            </div>
            <button onClick={() => setApiError(null)} className="shrink-0 hover:opacity-70">
              <X size={14} />
            </button>
          </div>
        )}

        {/* calendar grid */}
        <div className={`grid grid-cols-7 gap-2 mb-6 transition-opacity ${isMutating ? "opacity-60 pointer-events-none" : ""}`}>
          {WEEKDAY_LABELS.map((w) => (
            <div
              key={w}
              className="text-center text-[11px] font-semibold tracking-wide"
              style={{ color: "#5B6472", fontFamily: "'IBM Plex Mono', monospace" }}
            >
              {w.toUpperCase()}
            </div>
          ))}
          {Array.from({ length: leadingBlanks }).map((_, i) => <div key={"b" + i} />)}

          {isLoading
            ? Array.from({ length: daysInMonth(year, monthZero) }).map((_, i) => (
                <Skeleton key={i} className="h-[72px]" />
              ))
            : days.map((iso) => {
                const day = roster[iso];
                if (!day) return <div key={iso} />;
                const dayNum = Number(iso.slice(-2));
                const isSelected = selected === iso;
                const leaveNames = day.meta.onLeave.map((id) => DOCTOR_MAP[id]?.initials ?? id);
                const unfilled = SHIFT_ORDER.some(
                  (k) => day.shifts[k]?.active && day.shifts[k].assignments.length === 0
                );
                return (
                  <button
                    key={iso}
                    onClick={() => setSelected(iso)}
                    className="text-left rounded-xl border p-2 transition-colors"
                    style={{
                      backgroundColor: isSelected ? "#1B2430" : "#FFFFFF",
                      borderColor: isSelected ? "#1B2430" : "#D7DCE3",
                      color: isSelected ? "#EEF1F5" : "#1B2430",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="text-sm font-semibold"
                        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                      >
                        {dayNum}
                      </span>
                      <div className="flex items-center gap-1">
                        {(day.meta.removeObgyn || day.meta.removeDay) && (
                          <span title="Reduced staffing" className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                        )}
                        {unfilled && (
                          <span title="Unfilled mandatory shift" className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        )}
                        {leaveNames.length > 0 && (
                          <CalendarOff size={11} className={isSelected ? "text-slate-300" : "text-slate-400"} />
                        )}
                      </div>
                    </div>
                    <DayTimeline shifts={day.shifts} />
                  </button>
                );
              })}
        </div>

        {/* day detail */}
        {selected && selectedDay && (
          <div className="rounded-2xl bg-white border border-slate-200 p-5 mb-6">
            <div className="flex items-start justify-between mb-1">
              <div>
                <div
                  className="text-[11px] tracking-[0.14em] uppercase"
                  style={{ color: "#5B6472", fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  {WEEKDAY_LABELS[dowOf(selected)]} · {selected}
                </div>
                <h2
                  className="text-lg font-semibold"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  Day detail &amp; editing
                </h2>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X size={16} />
              </button>
            </div>

            {(selectedDay.meta.off.length > 0 || selectedDay.meta.onLeave.length > 0) && (
              <div className="text-[12px] text-slate-500 mb-3 flex flex-wrap gap-x-4 gap-y-1">
                {selectedDay.meta.off.length > 0 && (
                  <span>
                    Weekly off:{" "}
                    {selectedDay.meta.off.map((id) => DOCTOR_MAP[id]?.name ?? id).join(", ")}
                  </span>
                )}
                {selectedDay.meta.onLeave.length > 0 && (
                  <span>
                    On leave:{" "}
                    {selectedDay.meta.onLeave.map((id) => DOCTOR_MAP[id]?.name ?? id).join(", ")}
                  </span>
                )}
              </div>
            )}

            {(selectedDay.meta.removeObgyn || selectedDay.meta.removeDay) && (
              <div className="text-[12px] mb-3 inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 px-3 py-1">
                <AlertTriangle size={12} />
                Reduced staffing ({selectedDay.meta.unavailableCount} unavailable):{" "}
                {selectedDay.meta.removeDay ? "OBGYN and Day removed" : "OBGYN removed"}
              </div>
            )}

            <div className={`space-y-3 ${isMutating ? "opacity-60 pointer-events-none" : ""}`}>
              {SHIFT_ORDER.map((k) => {
                const def = SHIFT_DEFS[k];
                const s = selectedDay.shifts[k];
                if (!s) return null;
                const manual = selectedDay.manualCells?.[k];
                const eligible = DOCTORS.filter((d) =>
                  def.eligibility === "female" ? d.gender === "F" : true
                );
                return (
                  <div key={k} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: def.color }}
                        />
                        <span className="font-medium text-sm">{def.label}</span>
                        <span
                          className="text-[11px] text-slate-400"
                          style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                        >
                          {def.time}
                        </span>
                        {manual && (
                          <span className="text-[10px] rounded-full bg-slate-100 text-slate-500 px-1.5 py-0.5">
                            edited
                          </span>
                        )}
                        {!s.active && (
                          <span className="text-[10px] rounded-full bg-rose-50 text-rose-600 px-1.5 py-0.5">
                            inactive
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => toggleShiftActive(selected, k)}
                        className="text-[11px] text-slate-500 hover:text-slate-800 underline decoration-dotted"
                      >
                        {s.active ? "Mark inactive" : "Reactivate"}
                      </button>
                    </div>

                    {s.active && (
                      <>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {s.assignments.length === 0 && (
                            <span className="text-[12px] text-slate-400">Unfilled</span>
                          )}
                          {s.assignments.map((id) => (
                            <DoctorChip
                              key={id}
                              doctorId={id}
                              manual={manual}
                              onRemove={(docId) => removeDoctorFromShift(selected, k, docId)}
                            />
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={pendingAdd[k] ?? ""}
                            onChange={(e) =>
                              setPendingAdd((p) => ({ ...p, [k]: e.target.value }))
                            }
                            className="text-[12px] border border-slate-300 rounded-lg px-2 py-1.5 bg-white"
                          >
                            <option value="">Add doctor…</option>
                            {eligible.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                                {s.assignments.includes(d.id) ? " (assigned)" : ""}
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={!pendingAdd[k]}
                            onClick={() =>
                              pendingAdd[k] && addDoctorToShift(selected, k, pendingAdd[k])
                            }
                            className="inline-flex items-center gap-1 text-[12px] rounded-lg px-2.5 py-1.5 disabled:opacity-40"
                            style={{ backgroundColor: "#1B2430", color: "white" }}
                          >
                            <Plus size={12} /> Add
                          </button>
                          {s.assignments.length > 0 && (
                            <button
                              onClick={() => clearShift(selected, k)}
                              className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-rose-600 ml-1"
                            >
                              <Trash2 size={12} /> Clear
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {warnings.length > 0 && (
              <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3">
                <div className="flex items-center gap-1.5 text-amber-800 text-[12px] font-medium mb-1">
                  <AlertTriangle size={13} /> This edit conflicts with scheduling rules
                </div>
                <ul className="text-[12px] text-amber-800 list-disc pl-5 space-y-0.5">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                <div className="text-[11px] text-amber-700 mt-1.5">
                  Kept as a manual override — the note above is informational only.
                </div>
                <button
                  onClick={() => setWarnings([])}
                  className="text-[11px] underline text-amber-700 mt-1"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        {/* leaves panel */}
        <div className="rounded-2xl bg-white border border-slate-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Approved leave
            </h2>
            <button
              onClick={() => setAddLeaveOpen((v) => !v)}
              disabled={isMutating}
              className="inline-flex items-center gap-1.5 text-[12px] rounded-lg px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 disabled:opacity-40"
            >
              <Plus size={13} /> Add leave day
            </button>
          </div>

          {addLeaveOpen && (
            <div className="flex flex-wrap items-center gap-2 mb-3 bg-slate-50 rounded-xl p-3">
              <select
                value={leaveDraft.doctorId}
                onChange={(e) => setLeaveDraft((d) => ({ ...d, doctorId: e.target.value }))}
                className="text-[12px] border border-slate-300 rounded-lg px-2 py-1.5"
              >
                {DOCTORS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={leaveDraft.date}
                onChange={(e) => setLeaveDraft((d) => ({ ...d, date: e.target.value }))}
                className="text-[12px] border border-slate-300 rounded-lg px-2 py-1.5"
              />
              <button
                onClick={addLeave}
                disabled={isMutating}
                className="text-[12px] rounded-lg px-3 py-1.5 text-white disabled:opacity-40 inline-flex items-center gap-1.5"
                style={{ backgroundColor: "#1B2430" }}
              >
                {isMutating ? <Loader2 size={12} className="animate-spin" /> : null}
                Save &amp; regenerate
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {isLoading
              ? [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-7 w-48" />)
              : leaves
                  .slice()
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((l) => (
                    <div
                      key={l.id}
                      className="inline-flex items-center gap-2 text-[12px] bg-slate-50 border border-slate-200 rounded-full pl-3 pr-1.5 py-1"
                    >
                      <span className="font-medium">
                        {DOCTOR_MAP[l.doctorId]?.name ?? l.doctorId}
                      </span>
                      <span
                        style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#5B6472" }}
                      >
                        {l.date}
                      </span>
                      <button
                        onClick={() => removeLeave(l.id)}
                        disabled={isMutating}
                        className="hover:bg-slate-200 rounded-full p-1 disabled:opacity-40"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
          </div>
        </div>

        <div className="text-[12px] text-slate-500 leading-relaxed border-t border-slate-200 pt-4">
          Roster data is persisted in Supabase (PostgreSQL) via raw SQL. Manual overrides are saved
          immediately and survive page refresh. Regeneration preserves manual edits unless you
          explicitly choose &ldquo;Reset month.&rdquo;
        </div>
      </div>

      {/* confirm dialog */}
      {confirmKind && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
          onClick={() => setConfirmKind(null)}
        >
          <div
            className="bg-white rounded-2xl p-5 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold mb-1.5" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              {confirmKind === "reset" ? "Reset this month?" : "Regenerate this month?"}
            </h3>
            <p className="text-[13px] text-slate-500 mb-4">
              {confirmKind === "reset"
                ? `This clears every manual override for ${monthLabel(year, monthZero)} and rebuilds the roster from scratch.`
                : `This fills any open shifts for ${monthLabel(year, monthZero)}. Manually edited shifts are kept as-is.`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmKind(null)}
                className="text-[13px] px-3 py-1.5 rounded-lg border border-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={() => regenerate(confirmKind === "reset")}
                className="text-[13px] px-3 py-1.5 rounded-lg text-white inline-flex items-center gap-1.5"
                style={{ backgroundColor: confirmKind === "reset" ? "#B3432F" : "#1B2430" }}
              >
                {isMutating && <Loader2 size={12} className="animate-spin" />}
                {confirmKind === "reset" ? "Reset & regenerate" : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
