"use client";

import { useState } from "react";
import { backupLabels, exportBackup, parseBackup, previewBackup, readBackupData, restoreBackup, type Backup } from "@/lib/backup";
import { localDate } from "@/lib/finance-display";
import type { DomainRepositories } from "@/lib/repository-types";
import { FormError, useDialogFocus } from "./dialog";

export default function BackupModal({ repositories, onClose, onSaved, onBusyChange, onError }: {
  repositories: DomainRepositories;
  onClose: () => void;
  onSaved: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [backup, setBackup] = useState<Backup | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof previewBackup>>([]);
  const [confirmed, setConfirmed] = useState(false);
  const ref = useDialogFocus(true, () => { if (!busy) onClose(); });
  const button = "min-h-11 rounded-2xl border border-line px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:opacity-50";
  const setWorking = (value: boolean) => { setBusy(value); onBusyChange(value); if (value) onError(""); };
  const reportError = (message: string) => { setError(message); onError(message); };

  const download = async () => {
    setWorking(true); setError("");
    try {
      const data = await exportBackup(repositories);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `gagebu-backup-${localDate()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { reportError(reason instanceof Error ? reason.message : "백업을 만들지 못했습니다."); }
    finally { setWorking(false); }
  };
  const select = async (file?: File) => {
    if (!file) return;
    setWorking(true); setError(""); setBackup(null); setPreview([]); setConfirmed(false);
    try {
      // ponytail: parse in memory up to 20MB; stream if larger backups are needed.
      if (file.size > 20 * 1024 * 1024) throw new Error("백업 파일은 20MB 이하로 선택해주세요.");
      const parsed = parseBackup(await file.text());
      setPreview(previewBackup(parsed, await readBackupData(repositories)));
      setBackup(parsed);
    } catch (reason) { reportError(reason instanceof Error ? reason.message : "백업 파일을 확인하지 못했습니다."); }
    finally { setWorking(false); }
  };
  const restore = async () => {
    if (!backup || !confirmed || busy) return;
    setWorking(true); setError("");
    try {
      const result = await restoreBackup(backup, repositories);
      onSaved(`${result.added}건을 복원했습니다 · 기존·중복 ${result.skipped}건 유지`);
      onClose();
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : "백업을 복원하지 못했습니다.");
      // Recalculate after a partial failure so the retry preview stays accurate.
      try { setPreview(previewBackup(backup, await readBackupData(repositories))); } catch { /* Keep the original preview if disconnected. */ }
    } finally { setWorking(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim backdrop-blur-sm sm:items-center sm:p-6">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="backup-title" className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-line-strong bg-surface p-5 shadow-2xl sm:rounded-3xl sm:p-6">
      <div className="flex items-start justify-between gap-3"><h2 id="backup-title" className="text-xl font-semibold text-ink">백업·복원</h2><button type="button" className={button} disabled={busy} onClick={onClose} aria-label="백업 닫기">닫기</button></div>
      <p className="mt-3 text-sm leading-6 text-muted">수입·지출, 예금·적금, 주식 주문, 작업과 카테고리를 JSON 파일로 보관합니다.</p>
      <button type="button" className={`${button} mt-4 w-full bg-emerald-400 text-slate-950`} disabled={busy} onClick={download}>전체 백업 다운로드</button>
      <div className="mt-6 border-t border-line pt-5"><label htmlFor="backup-file" className="text-sm font-medium text-body">복원할 JSON 파일 (최대 20MB)</label><input id="backup-file" type="file" accept=".json,application/json" disabled={busy} className="mt-3 min-h-11 w-full min-w-0 text-sm text-body file:mr-2 file:min-h-11 file:rounded-xl file:border-0 file:bg-card-strong file:px-3 file:text-body" onChange={event => { void select(event.target.files?.[0]); event.target.value = ""; }} /></div>
      {backup && <div className="mt-4">
        <p className="text-xs text-faint">백업 시각: {new Date(backup.exportedAt).toLocaleString("ko-KR")}</p>
        <table className="mt-3 w-full text-left text-sm"><caption className="sr-only">복원 변경 내역</caption><thead><tr className="border-b border-line"><th className="py-2">종류</th><th className="text-right">추가</th><th className="text-right">기존·중복 유지</th></tr></thead><tbody>{preview.map(row => <tr key={row.key} className="border-b border-line"><th scope="row" className="py-3 font-normal">{backupLabels[row.key]}</th><td className="text-right">{row.added}건</td><td className="text-right">{row.skipped}건</td></tr>)}</tbody></table>
        <p className="mt-3 text-xs leading-5 text-muted">같은 ID 또는 가져오기 식별자가 있으면 현재 기록을 유지합니다. 기존 카테고리와 ID가 같으면 현재 카테고리 이름을 사용합니다. 기존 기록은 삭제하지 않습니다.</p>
        <label className="mt-4 flex min-h-11 items-start gap-3 rounded-2xl border border-line p-3 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />추가·유지할 기록을 확인했습니다.</label>
        <button type="button" disabled={busy || !confirmed || !preview.some(row => row.added)} onClick={restore} className={`${button} mt-4 w-full bg-sky-400 text-slate-950`}>{busy ? "처리 중…" : "없는 기록만 복원"}</button>
      </div>}
      <FormError message={error} />
    </div>
  </div>;
}
