import { useState, useRef, useEffect } from 'react';
import type { CompanyTemplate } from '../../types';
import { BUILTIN_TEMPLATES } from '../../core/builtinTemplates';

// ─── Extended template list ───────────────────────────────────────────────────
// BUILTIN_TEMPLATES has 3 entries (Full-Stack Team, Startup MVP, Code Review Squad).
// We augment it with Enterprise Team and Empty Company here in the dialog.

interface DialogTemplate {
  id: string;
  icon: string;
  description: string;
  template: CompanyTemplate;
}

const DIALOG_TEMPLATES: DialogTemplate[] = [
  {
    id: 'fullstack',
    icon: '⚙️',
    description: 'Engineering + Security — 개발 + 보안 감사',
    template: BUILTIN_TEMPLATES[0]!,
  },
  {
    id: 'startup',
    icon: '🚀',
    description: 'Product + Design — 빠른 프로토타이핑',
    template: BUILTIN_TEMPLATES[1]!,
  },
  {
    id: 'review',
    icon: '🔍',
    description: 'Review + QA — 코드 품질 집중',
    template: BUILTIN_TEMPLATES[2]!,
  },
  {
    id: 'enterprise',
    icon: '🏢',
    description: 'Engineering + Design + QA + DevOps — 대규모 프로젝트',
    template: {
      name: 'Enterprise Team',
      departments: [
        {
          name: 'Engineering',
          leadName: 'Software Architect',
          members: [
            { name: 'FE Dev', preset: 'frontend-developer' },
            { name: 'BE Dev', preset: 'backend-architect' },
            { name: 'Data Engineer', preset: 'data-engineer' },
          ],
        },
        {
          name: 'Design',
          leadName: 'UX Architect',
          members: [
            { name: 'UI Designer', preset: 'ui-designer' },
          ],
        },
        {
          name: 'QA',
          leadName: 'Studio Producer',
          members: [
            { name: 'Tester', preset: 'test-automator' },
            { name: 'Performance', preset: 'performance-benchmarker' },
          ],
        },
        {
          name: 'DevOps',
          leadName: 'DevOps Automator',
          members: [
            { name: 'SRE', preset: 'sre' },
          ],
        },
      ],
    },
  },
  {
    id: 'empty',
    icon: '📝',
    description: 'CEO만 생성 — 직접 부서 추가',
    template: {
      name: 'Empty Company',
      departments: [],
    },
  },
];

// ─── Public result type ───────────────────────────────────────────────────────

export interface CompanyTemplateResult {
  name: string;
  template: CompanyTemplate;
  skipPermissions: boolean;
  workDir: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CreateCompanyDialogProps {
  onConfirm: (result: CompanyTemplateResult) => void;
  onCancel: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CreateCompanyDialog({ onConfirm, onCancel }: CreateCompanyDialogProps) {
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string>('fullstack');
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [workDir, setWorkDir] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // ── Focus management: disable xterm textareas + initial focus ──
  useEffect(() => {
    // Disable xterm helper textareas so they don't steal focus.
    const xtermTextareas = document.querySelectorAll<HTMLTextAreaElement>('.xterm-helper-textarea');
    const xtermPrevStates: { el: HTMLTextAreaElement; disabled: boolean }[] = [];
    xtermTextareas.forEach((ta) => {
      xtermPrevStates.push({ el: ta, disabled: ta.disabled });
      ta.disabled = true;
    });

    // Initial focus with delay to beat xterm's own scheduling.
    const focusInput = () => inputRef.current?.focus();
    let deferredTimer: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => {
      focusInput();
      deferredTimer = setTimeout(focusInput, 120);
    });

    return () => {
      xtermPrevStates.forEach(({ el, disabled }) => { el.disabled = disabled; });
      cancelAnimationFrame(raf);
      if (deferredTimer !== undefined) clearTimeout(deferredTimer);
    };
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────────

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const entry = DIALOG_TEMPLATES.find((t) => t.id === selectedId) ?? DIALOG_TEMPLATES[0]!;
    onConfirm({
      name: trimmed,
      template: entry.template,
      skipPermissions,
      workDir: workDir.trim(),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') onCancel();
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      onMouseDown={(e) => e.stopPropagation()}
      onFocus={(e) => e.stopPropagation()}
    >
      <div
        ref={dialogRef}
        className="flex flex-col rounded-xl shadow-2xl overflow-y-auto"
        tabIndex={-1}
        style={{
          width: 440,
          maxHeight: 'calc(100vh - 80px)',
          backgroundColor: 'var(--bg-base)',
          border: '1px solid var(--bg-surface)',
          padding: '20px',
          boxShadow: '0 25px 60px rgba(0,0,0,0.7)',
        }}
      >
        {/* ── Title ── */}
        <h2
          className="text-sm font-bold font-mono mb-4 tracking-wider"
          style={{ color: 'var(--text-main)' }}
        >
          Create Company
        </h2>

        {/* ── Company name ── */}
        <label
          className="block text-[10px] font-mono mb-1"
          style={{ color: 'var(--text-muted)' }}
        >
          Company Name
        </label>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. My AI Project"
          className="w-full rounded px-3 py-1.5 text-[12px] font-mono focus:outline-none transition-colors mb-3 placeholder:text-[color:var(--text-muted)]"
          style={{
            backgroundColor: 'var(--bg-mantle)',
            color: 'var(--text-main)',
            border: '1px solid var(--bg-surface)',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--bg-surface)'; }}
        />

        {/* ── Template selection ── */}
        <label
          className="block text-[10px] font-mono mb-2"
          style={{ color: 'var(--text-muted)' }}
        >
          Template
        </label>
        <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 220 }}>
          {DIALOG_TEMPLATES.map((entry) => {
            const isSelected = selectedId === entry.id;
            const depts = entry.template.departments;
            const totalAgents = depts.reduce((sum, d) => sum + d.members.length + 1, 0);

            return (
              <button
                key={entry.id}
                type="button"
                className="w-full text-left px-3 py-2 rounded transition-colors"
                onClick={() => setSelectedId(entry.id)}
                style={{
                  backgroundColor: isSelected
                    ? 'rgba(var(--accent-blue-rgb, 137, 180, 250), 0.10)'
                    : 'var(--bg-mantle)',
                  border: isSelected
                    ? '1px solid var(--accent-blue)'
                    : '1px solid var(--bg-surface)',
                }}
              >
                {/* Row: icon + name + badge */}
                <div className="flex items-center gap-2">
                  <span className="text-sm select-none">{entry.icon}</span>
                  <span
                    className="text-[11px] font-mono font-semibold"
                    style={{ color: 'var(--text-main)' }}
                  >
                    {entry.template.name}
                  </span>
                  {depts.length > 0 && (
                    <span
                      className="ml-auto text-[9px] font-mono"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {depts.length} dept &middot; {totalAgents} agents
                    </span>
                  )}
                </div>

                {/* Description */}
                <p
                  className="text-[9px] font-mono mt-0.5 ml-6"
                  style={{ color: 'var(--text-subtle)' }}
                >
                  {entry.description}
                </p>

                {/* Dept breakdown when selected */}
                {isSelected && depts.length > 0 && (
                  <div className="mt-1.5 ml-6 space-y-0.5">
                    {depts.map((d) => (
                      <div
                        key={d.name}
                        className="text-[9px] font-mono"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <span style={{ color: 'var(--accent-blue)' }}>├</span>
                        {' '}{d.name}: {d.leadName}
                        {d.members.length > 0 && (
                          <> + {d.members.map((m) => m.name).join(', ')}</>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Working directory ── */}
        <label
          className="block text-[10px] font-mono mb-1 mt-3"
          style={{ color: 'var(--text-muted)' }}
        >
          Working Directory
        </label>
        <input
          type="text"
          value={workDir}
          onChange={(e) => setWorkDir(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. D:\projects\my-app  (optional)"
          className="w-full rounded px-3 py-1.5 text-[12px] font-mono focus:outline-none transition-colors mb-1 placeholder:text-[color:var(--text-muted)]"
          style={{
            backgroundColor: 'var(--bg-mantle)',
            color: 'var(--text-main)',
            border: '1px solid var(--bg-surface)',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--bg-surface)'; }}
        />
        <p
          className="text-[8px] font-mono mb-2"
          style={{ color: 'var(--text-muted)' }}
        >
          All agents will work in this directory. Leave empty for current dir.
        </p>

        {/* ── Dangerous options ── */}
        <div
          className="mt-3 pt-3"
          style={{ borderTop: '1px solid var(--bg-surface)' }}
        >
          <button
            type="button"
            className="w-full flex items-center gap-2"
            onClick={() => setSkipPermissions((v) => !v)}
          >
            <span
              className="text-[9px] font-mono font-semibold min-w-0 shrink truncate"
              style={{ color: 'var(--accent-red)' }}
            >
              --dangerously-skip-permissions
            </span>
            {/* Toggle pill */}
            <div
              className="relative w-8 h-4 rounded-full transition-colors shrink-0"
              style={{ backgroundColor: skipPermissions ? 'var(--accent-red)' : 'var(--bg-surface)' }}
            >
              <div
                className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                style={{ left: skipPermissions ? '16px' : '2px' }}
              />
            </div>
          </button>
          {skipPermissions && (
            <p
              className="text-[8px] font-mono mt-1"
              style={{ color: 'var(--accent-red)', opacity: 0.6 }}
            >
              All agents will skip permission prompts. Use with caution.
            </p>
          )}
        </div>

        {/* ── Action buttons ── */}
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-[11px] font-mono rounded transition-colors"
            style={{
              color: 'var(--text-muted)',
              border: '1px solid var(--bg-surface)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-main)';
              e.currentTarget.style.borderColor = 'var(--bg-overlay)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.borderColor = 'var(--bg-surface)';
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-3 py-1.5 text-[11px] font-mono rounded transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--accent-blue)',
              color: 'var(--bg-base)',
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
