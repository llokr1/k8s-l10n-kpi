"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Member = { login: string; name: string; team: string };
export default function ReviewerDropdown({ label, children, members, value, author, revision, onApply }: {
  label: string; children: ReactNode; members: Member[]; value: string[]; author: string;
  revision: string; onApply: (value: string[], revision: string) => Promise<void>;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [baseRevision, setBaseRevision] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
    const close = (event: PointerEvent) => {
      if (!saving && !panel.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) { setOpen(false); button.current?.focus(); }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open, saving]);
  function toggle() {
    if (open) { if (!saving) setOpen(false); return; }
    const rect = button.current!.getBoundingClientRect();
    setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - Math.min(520, window.innerHeight - 16))), left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)) });
    setChosen([...value]); setBaseRevision(revision); setError(""); setOpen(true);
  }
  async function apply() {
    setSaving(true); setError("");
    try { await onApply(chosen, baseRevision); setOpen(false); button.current?.focus(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "저장 실패"); }
    finally { setSaving(false); }
  }
  return <>
    <button ref={button} className="prSelectTrigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}><span>{children}</span><span aria-hidden="true">▾</span></button>
    {open && createPortal(<div ref={panel} className="prSelectPanel" role="dialog" aria-label={label} style={position}>
      <header><strong>{label}</strong><button disabled={saving} onClick={() => { setOpen(false); button.current?.focus(); }} aria-label="선택 취소">×</button></header>
      <div className="prSelectOptions">{["kubernetes", "volunteer"].map(team => <fieldset key={team} disabled={saving}><legend>{team === "kubernetes" ? "쿠버네티스" : "오픈스택"}</legend>{members.filter(member => member.team === team).map(member => <label key={member.login} className={"prSelectMember " + team}><input type="checkbox" disabled={member.login === author.toLowerCase()} checked={chosen.includes(member.login)} onChange={event => setChosen(event.target.checked ? [...chosen, member.login] : chosen.filter(login => login !== member.login))} /><span>{member.name}<small>@{member.login}{member.login === author.toLowerCase() ? " · 작성자" : ""}</small></span></label>)}</fieldset>)}</div>
      {error && <p className="prError" role="alert">{error}</p>}
      <footer><small>적용 시 저장 · 취소하면 변경하지 않음</small><button disabled={saving} onClick={apply}>{saving ? "저장 중…" : "적용"}</button></footer>
    </div>, document.body)}
  </>;
}
