import { useCallback, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Star, Check, Loader2, Download, Image, FileText } from 'lucide-react';
import clsx from 'clsx';
import { Tooltip } from './Tooltip';
import { useDiagramStore, type SaveStatus } from '../store/useDiagramStore';
import { renderDiagramPng } from '../lib/exportImage';
import { api } from '../lib/api';

export function TopBar() {
  const navigate = useNavigate();
  const title = useDiagramStore((s) => s.title);
  const setTitle = useDiagramStore((s) => s.setTitle);
  const starred = useDiagramStore((s) => s.starred);
  const setStarred = useDiagramStore((s) => s.setStarred);
  const diagramId = useDiagramStore((s) => s.diagramId);
  const saveStatus = useDiagramStore((s) => s.saveStatus);

  const toggleStar = useCallback(async () => {
    if (!diagramId) return;
    const result = await api.toggleStar(diagramId);
    setStarred(result.starred);
  }, [diagramId, setStarred]);

  return (
    <div className="pointer-events-none absolute left-4 right-4 top-4 z-20 flex items-center justify-between">
      <div className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-white/95 py-1.5 pl-2 pr-2 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-black/[0.04] backdrop-blur">
        <Tooltip label="Back to dashboard" side="bottom">
          <button
            onClick={() => navigate('/')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-700/50 transition hover:bg-black/[0.04] hover:text-ink-700"
          >
            <ArrowLeft size={15} />
          </button>
        </Tooltip>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-0 max-w-[16rem] bg-transparent text-[14px] font-semibold text-ink-900 outline-none"
        />
        <Tooltip label={starred ? 'Unstar' : 'Star'} side="bottom">
          <button
            onClick={toggleStar}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-700/50 transition hover:bg-black/[0.04] hover:text-ink-700"
          >
            <Star size={15} className={clsx(starred && 'fill-yellow-400 text-yellow-400')} />
          </button>
        </Tooltip>
        <SaveIndicator status={saveStatus} />
      </div>

      <ExportMenu />
    </div>
  );
}

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const title = useDiagramStore((s) => s.title);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const exportPng = useCallback(async () => {
    setOpen(false);
    // Null for an empty diagram — nothing worth downloading.
    const dataUrl = await renderDiagramPng();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${title || 'diagram'}.png`;
    a.click();
  }, [title]);

  const exportSvg = useCallback(async () => {
    setOpen(false);
    const dataUrl = await renderDiagramPng();
    if (!dataUrl) return;
    const printWindow = window.open('');
    if (!printWindow) return;
    printWindow.document.write(`<img src="${dataUrl}" style="max-width:100%" />`);
    printWindow.document.title = title || 'diagram';
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }, [title]);

  return (
    <div ref={menuRef} className="pointer-events-auto relative">
      <div className="flex items-center gap-2 rounded-2xl bg-white/95 px-2 py-1.5 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-black/[0.04] backdrop-blur">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-ink-700 hover:bg-black/[0.04]"
        >
          <Download size={15} /> Export
        </button>
      </div>
      {open && (
        <div className="panel-in absolute right-0 top-full mt-2 flex w-44 flex-col gap-0.5 rounded-xl bg-ink-950 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]">
          <button
            onClick={exportPng}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
          >
            <Image size={15} /> Export as PNG
          </button>
          <button
            onClick={exportSvg}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
          >
            <FileText size={15} /> Print / PDF
          </button>
        </div>
      )}
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'saving') {
    return (
      <span className="ml-1 flex items-center gap-1.5 text-xs text-ink-600/50">
        <Loader2 size={12} className="animate-spin" /> Saving...
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="ml-1 flex items-center gap-1.5 text-xs text-green-500/70">
        <Check size={12} /> Saved
      </span>
    );
  }
  if (status === 'error') {
    return <span className="ml-1 text-xs text-red-500">Save failed</span>;
  }
  return null;
}
