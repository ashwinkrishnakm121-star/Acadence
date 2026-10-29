import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Check, CircleAlert, FileDown, LoaderCircle, Plus, RefreshCw, Save, Sparkles, WandSparkles } from 'lucide-react'
import './module.css'
import EvaluationWorkspace from './EvaluationWorkspace'
import { apiUrl } from './api'

type DemoUser = { id: number; username: string; display_name: string; role: string; capabilities: string[] }
type ApiRequest = <T>(path: string, init?: RequestInit, identity?: string) => Promise<T>
type Props = { section: string; user: DemoUser; request: ApiRequest; onRefresh: () => void }
type ClassRow = { id: number; name: string; grade: number; section: string }
type SubjectRow = { id: number; name: string }
type ChapterRow = { id: number; subject_id: number; name: string }
type Blueprint = { id: number; name: string; subject_id: number; total_marks: number; sections: { name: string; question_type: string; count: number; marks_each: number; difficulty_counts?: Record<string, number> }[]; required_chapters: number[] }
type Question = { id: number; subject_id: number; prompt: string; question_type: string; marks: number; difficulty: string; chapter_ids: number[]; answer_reference: string; approved: boolean }
type PaperItem = { section: string; question_id: number; prompt: string; question_type: string; marks: number; difficulty: string; chapter_ids: number[] }
type Assessment = { id: number; title: string; class_id: number; subject_id: number; examination_type: string; chapters: number[]; total_marks: number; duration_minutes: number; blueprint_id: number; status: string; paper: PaperItem[]; validation: { valid: boolean; errors: string[] }; current_version: number; review_comment?: string }
type Schedule = { id: number; version: number; status: string; solver_status: string; assignments: { class_id: number; subject_id: number; teacher_id: number; day: string; period: number }[]; constraints: Record<string, unknown>[]; validation: { valid: boolean; errors: string[] } }
type TeacherAssignment = { id: number; class_id: number; subject_id: number; teacher_id: number; weekly_lessons: number; unavailable_slots: { day: string; period: number }[] }
const statusText: Record<string, string> = { draft: 'Draft', submitted: 'Submitted for review', approved: 'Approved', rejected: 'Rejected', changes_requested: 'Changes requested', published: 'Published', awaiting_preparation: 'Awaiting preparation', awaiting_review: 'Awaiting review', completed: 'Completed', accepted: 'Accepted', unsupported: 'Unsupported instruction' }
const pillClass = (value: string) => `status-badge status-${value.replaceAll('_', '-')}`

function Notice({ text, error = false, onClose }: { text: string; error?: boolean; onClose: () => void }) {
  if (!text) return null
  return <div className={`module-notice ${error ? 'error' : 'success'}`}><span>{text}</span><button onClick={onClose}>Dismiss</button></div>
}
function Busy({ text }: { text: string }) { return <div className="module-loading"><LoaderCircle size={16} className="spin"/>{text}</div> }
function Panel({ title, detail, children, action }: { title: string; detail?: string; children: React.ReactNode; action?: React.ReactNode }) { return <section className="panel module-panel"><div className="module-panel-heading"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</div>{children}</section> }
function Status({ value }: { value: string }) { return <span className={pillClass(value)}>{statusText[value] || value}</span> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="module-field"><span>{label}</span>{children}</label> }

export default function ModuleWorkspace(props: Props) {
  if (props.section === 'Assessment Studio') return <AssessmentWorkspace {...props}/>
  if (props.section === 'Timetable generation') return <TimetableWorkspace {...props}/>
  if (props.section === 'Academic Planner') return <PlannerWorkspace {...props}/>
  if (props.section === 'Academic coordination') return <CoordinationWorkspace {...props}/>
  return <EvaluationWorkspace user={props.user} request={props.request}/>
}

function AssessmentWorkspace({ user, request }: Props) {
  const [academic, setAcademic] = useState<{ classes: ClassRow[]; subjects: SubjectRow[]; chapters: ChapterRow[] }>({ classes: [], subjects: [], chapters: [] })
  const [blueprints, setBlueprints] = useState<Blueprint[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [versions, setVersions] = useState<{ version: number; action: string; comment: string; created_at: string }[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState<number | null>(null)
  const [promptDraft, setPromptDraft] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [form, setForm] = useState({ title: '', class_id: 0, subject_id: 0, examination_type: 'Unit test', chapters: [] as number[], total_marks: 0, duration_minutes: 60, blueprint_id: 0 })
  const [qform, setQform] = useState({ prompt: '', subject_id: 0, question_type: 'short_answer', marks: 2, difficulty: 'easy', chapter_ids: [] as number[], answer_reference: '' })
  const [bpForm, setBpForm] = useState({ name: '', subject_id: 0, total_marks: 0, sections: [{ name: 'Section A', question_type: 'short_answer', count: 1, marks_each: 1, difficulty_counts: { easy: 0, medium: 0, hard: 0 } }], required_chapters: [] as number[] })
  const [showQuestion, setShowQuestion] = useState(false)
  const [showBlueprint, setShowBlueprint] = useState(false)
  const [showChapter, setShowChapter] = useState(false)
  const [chapterName, setChapterName] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const selected = assessments.find(row => row.id === selectedId) || null
  const canWrite = user.capabilities.includes('assessments:write')
  const canConfigure = user.capabilities.includes('school:write')
  const canReview = user.capabilities.includes('assessments:review')

  async function refresh() {
    setLoading(true); setError('')
    try {
      const [data, bps, qs, rows] = await Promise.all([
        request<typeof academic>('/api/academic-data'), request<Blueprint[]>('/api/assessment-blueprints'),
        request<Question[]>('/api/questions'), request<Assessment[]>('/api/assessments'),
      ])
      setAcademic(data); setBlueprints(bps); setQuestions(qs); setAssessments(rows)
      if (!selectedId && rows.length) setSelectedId(rows[0].id)
      const firstClass = data.classes[0]?.id || 0, firstSubject = data.subjects[0]?.id || 0, firstBp = bps[0]
      setForm(prev => ({ ...prev, class_id: prev.class_id || firstClass, subject_id: prev.subject_id || firstSubject, blueprint_id: prev.blueprint_id || firstBp?.id || 0, total_marks: prev.total_marks || firstBp?.total_marks || 0, chapters: prev.chapters.length ? prev.chapters : data.chapters.filter(c => c.subject_id === firstSubject).slice(0, 2).map(c => c.id) }))
      setBpForm(prev => ({ ...prev, subject_id: prev.subject_id || firstSubject }))
      setQform(prev => ({ ...prev, subject_id: prev.subject_id || firstSubject, chapter_ids: prev.chapter_ids.length ? prev.chapter_ids : data.chapters.filter(c => c.subject_id === firstSubject).slice(0, 1).map(c => c.id) }))
    } catch (e) { setError(e instanceof Error ? e.message : 'Assessment data could not be loaded.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => { const bp = blueprints.find(row => row.id === form.blueprint_id); if (bp) setForm(v => ({ ...v, total_marks: bp.total_marks, subject_id: bp.subject_id, chapters: bp.required_chapters })) }, [form.blueprint_id, blueprints])

  async function createAssessment(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const row = await request<Assessment>('/api/assessments', { method: 'POST', body: JSON.stringify(form) })
      const generated = await request<Assessment>(`/api/assessments/${row.id}/generate`, { method: 'POST' })
      setAssessments(rows => [generated, ...rows]); setSelectedId(generated.id)
      setNotice(generated.validation?.valid ? 'Assessment created and a valid paper was selected from the question bank.' : 'Assessment created, but the paper does not yet meet its blueprint.')
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Assessment could not be created.') }
    finally { setBusy(false) }
  }
  async function refreshPaper() {
    if (!selected) return
    setBusy(true); setError('')
    try { const row = await request<Assessment>(`/api/assessments/${selected.id}/generate`, { method: 'POST' }); setAssessments(old => old.map(a => a.id === row.id ? row : a)); setNotice(row.validation.valid ? 'Paper generated and validated.' : 'Paper is invalid. Review the specific blueprint errors below.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Paper generation failed.') } finally { setBusy(false) }
  }
  async function saveQuestion(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { const row = await request<Question>('/api/questions', { method: 'POST', body: JSON.stringify(qform) }); setQuestions(qs => [...qs, row]); setShowQuestion(false); setQform(v => ({ ...v, prompt: '', answer_reference: '' })); setNotice('Question saved to the shared question bank.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Question could not be saved.') } finally { setBusy(false) }
  }
  async function saveChapter(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { const chapter = await request<ChapterRow>('/api/chapters', { method: 'POST', body: JSON.stringify({ subject_id: qform.subject_id, name: chapterName }) }); setAcademic(v => ({ ...v, chapters: [...v.chapters, chapter] })); setQform(v => ({ ...v, chapter_ids: [...v.chapter_ids, chapter.id] })); setChapterName(''); setShowChapter(false); setNotice('Chapter added to the shared academic structure.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Chapter could not be saved.') } finally { setBusy(false) }
  }
  async function saveBlueprint(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { const sections = bpForm.sections.map(({ difficulty_counts, ...section }) => ({ ...section, ...(Object.values(difficulty_counts).some(value => value > 0) ? { difficulty_counts: Object.fromEntries(Object.entries(difficulty_counts).filter(([, value]) => value > 0)) } : {}) })); const row = await request<Blueprint>('/api/assessment-blueprints', { method: 'POST', body: JSON.stringify({ ...bpForm, sections, internal_choice_rules: { mode: 'none' } }) }); setBlueprints(bps => [...bps, row]); setForm(v => ({ ...v, blueprint_id: row.id })); setShowBlueprint(false); setNotice('Blueprint saved. Internal choice is not supported in this stage.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Blueprint is invalid.') } finally { setBusy(false) }
  }
  async function replaceQuestion(index: number, id: number) {
    if (!selected) return
    const ids = selected.paper.map(item => item.question_id); ids[index] = id; await savePaper(ids)
  }
  async function shiftQuestion(index: number, dir: number) {
    if (!selected) return
    const items = [...selected.paper]; const target = index + dir
    if (target < 0 || target >= items.length || items[index].section !== items[target].section) return
    ;[items[index], items[target]] = [items[target], items[index]]
    await savePaper(items.map(item => item.question_id))
  }
  async function savePaper(question_ids: number[], edits: Record<number, string> = {}) {
    if (!selected) return
    setBusy(true); setError('')
    try { const row = await request<Assessment>(`/api/assessments/${selected.id}/paper`, { method: 'PUT', body: JSON.stringify({ question_ids, edits }) }); setAssessments(old => old.map(a => a.id === row.id ? row : a)); setEditingQuestion(null); setNotice(row.validation.valid ? 'Paper edit saved and validated.' : 'Paper edit saved; validation reports the errors below.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Paper edit was rejected.') } finally { setBusy(false) }
  }
  async function action(path: string, body: unknown, success: string) {
    if (!selected) return
    setBusy(true); setError('')
    try { await request(path, { method: 'POST', body: JSON.stringify(body) }); await refresh(); setNotice(success) }
    catch (e) { setError(e instanceof Error ? e.message : 'The action failed.') } finally { setBusy(false) }
  }
  async function downloadPdf() {
    if (!selected) return
    setBusy(true); setError('')
    try { const res = await fetch(apiUrl(`/api/assessments/${selected.id}/pdf`), { headers: { 'X-Demo-User': user.username } }); if (!res.ok) throw new Error((await res.json()).detail || `Download failed (${res.status})`); const url = URL.createObjectURL(await res.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `assessment-${selected.id}.pdf`; anchor.click(); URL.revokeObjectURL(url); setNotice('Approved assessment PDF downloaded.') }
    catch (e) { setError(e instanceof Error ? e.message : 'PDF download failed.') } finally { setBusy(false) }
  }
  async function loadVersions() {
    if (!selected) return
    setBusy(true)
    try { setVersions(await request(`/api/assessments/${selected.id}/versions`)); setShowVersions(true) }
    catch (e) { setError(e instanceof Error ? e.message : 'Version history could not be loaded.') }
    finally { setBusy(false) }
  }
  const chosenSubjectChapters = academic.chapters.filter(c => c.subject_id === form.subject_id)
  const count = (selected?.paper || []).length

  return <div className="module-workspace"><Notice text={error || notice} error={Boolean(error)} onClose={() => { setError(''); setNotice('') }}/>
    <div className="module-toolbar"><div><b>Assessment Studio</b><span>Deterministic blueprint selection, review and approved paper export.</span></div><button className="light-button" onClick={() => void refresh()}><RefreshCw size={14}/> Refresh</button></div>
    {loading ? <Busy text="Loading assessment data…"/> : <>
      <div className="split-workspace"><div className="module-column">
        <Panel title="Create assessment" detail="Choose a class, examination type and configured blueprint.">
          {canWrite ? <form className="module-form-grid" onSubmit={createAssessment}>
            <Field label="Assessment title"><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Unit 1 Mathematics"/></Field>
            <Field label="Class"><select value={form.class_id} onChange={e => setForm({ ...form, class_id: Number(e.target.value) })}>{academic.classes.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Examination type"><select value={form.examination_type} onChange={e => setForm({ ...form, examination_type: e.target.value })}><option>Unit test</option><option>Midterm</option><option>Final examination</option></select></Field>
            <Field label="Blueprint"><select value={form.blueprint_id} onChange={e => setForm({ ...form, blueprint_id: Number(e.target.value) })}>{blueprints.map(b => <option value={b.id} key={b.id}>{b.name} · {b.total_marks} marks</option>)}</select></Field>
            <Field label="Total marks"><input type="number" min={1} value={form.total_marks} readOnly/></Field>
            <Field label="Duration (minutes)"><input type="number" min={1} max={360} value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: Number(e.target.value) })}/></Field>
            <div className="module-full"><span className="field-caption">Chapters covered</span><div className="check-grid">{chosenSubjectChapters.map(chapter => <label key={chapter.id}><input type="checkbox" checked={form.chapters.includes(chapter.id)} onChange={e => setForm(v => ({ ...v, chapters: e.target.checked ? [...v.chapters, chapter.id] : v.chapters.filter(id => id !== chapter.id) }))}/>{chapter.name}</label>)}</div></div>
            <div className="module-full form-action-row"><span>{chosenSubjectChapters.length ? `${form.chapters.length} chapter(s) selected` : 'No chapters configured for the subject.'}</span><button className="primary-button" disabled={busy || !form.title || !form.blueprint_id}>{busy && <LoaderCircle size={14} className="spin"/>}<Sparkles size={14}/> Create & generate</button></div>
          </form> : <div className="empty-state">This account can review submitted papers but cannot create assessments.</div>}
          {canWrite && <div className="inline-actions">{canConfigure && <button className="text-button" onClick={() => setShowBlueprint(v => !v)}><Plus size={13}/> Configure a blueprint</button>}<button className="text-button" onClick={() => setShowChapter(v => !v)}><Plus size={13}/> Add a chapter</button><button className="text-button" onClick={() => setShowQuestion(v => !v)}><Plus size={13}/> Add a question</button></div>}
        </Panel>
        {showBlueprint && canConfigure && <Panel title="New blueprint" detail="Section counts, marks, chapter coverage and difficulty distribution must match the total."><form className="module-form-grid" onSubmit={saveBlueprint}><Field label="Blueprint name"><input required value={bpForm.name} onChange={e => setBpForm(v => ({ ...v, name: e.target.value }))}/></Field><Field label="Subject"><select value={bpForm.subject_id} onChange={e => setBpForm(v => ({ ...v, subject_id: Number(e.target.value), required_chapters: [] }))}>{academic.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="Total marks"><input type="number" min={1} value={bpForm.total_marks} onChange={e => setBpForm(v => ({ ...v, total_marks: Number(e.target.value) }))}/></Field><div className="module-full blueprint-sections"><span className="field-caption">Section requirements (E / M / H counts are optional; if entered, they must equal question count)</span>{bpForm.sections.map((section, index) => <div className="section-requirement" key={index}><input aria-label="Section name" value={section.name} onChange={e => setBpForm(v => ({ ...v, sections: v.sections.map((s, i) => i === index ? { ...s, name: e.target.value } : s) }))}/><select value={section.question_type} onChange={e => setBpForm(v => ({ ...v, sections: v.sections.map((s, i) => i === index ? { ...s, question_type: e.target.value } : s) }))}><option value="multiple_choice">Multiple choice</option><option value="short_answer">Short answer</option><option value="long_answer">Long answer</option></select><input title="Question count" type="number" min={1} value={section.count} onChange={e => setBpForm(v => ({ ...v, sections: v.sections.map((s, i) => i === index ? { ...s, count: Number(e.target.value) } : s) }))}/><input aria-label="Marks each" title="Marks each" type="number" min={1} value={section.marks_each} onChange={e => setBpForm(v => ({ ...v, sections: v.sections.map((s, i) => i === index ? { ...s, marks_each: Number(e.target.value) } : s) }))}/><input aria-label="Easy count" title="Easy questions" type="number" min={0} value={section.difficulty_counts.easy} onChange={e => setBpForm(v => ({ ...v, sections: v.sections.map((s, i) => i === index ? { ...s, difficulty_counts: { ...s.difficulty_counts, easy: Number(e.target.value) } } : s) }))}/><input aria-label="Medium count" title="Medium questions" type="number" min={0} value={section.difficulty_counts.medium} onChange={e => setBpForm(v => ({ ...v, sections: v.sections.map((s, i) => i === index ? { ...s, difficulty_counts: { ...s.difficulty_counts, medium: Number(e.target.value) } } : s) }))}/><input aria-label="Hard count" title="Hard questions" type="number" min={0} value={section.difficulty_counts.hard} onChange={e => setBpForm(v => ({ ...v, sections: v.sections.map((s, i) => i === index ? { ...s, difficulty_counts: { ...s.difficulty_counts, hard: Number(e.target.value) } } : s) }))}/><button type="button" className="icon-button" onClick={() => setBpForm(v => ({ ...v, sections: [...v.sections, { name: `Section ${String.fromCharCode(65 + v.sections.length)}`, question_type: 'short_answer', count: 1, marks_each: 1, difficulty_counts: { easy: 0, medium: 0, hard: 0 } }] }))}><Plus size={13}/></button></div>)}</div><div className="module-full"><span className="field-caption">Required chapter coverage</span><div className="check-grid">{academic.chapters.filter(chapter => chapter.subject_id === bpForm.subject_id).map(chapter => <label key={chapter.id}><input type="checkbox" checked={bpForm.required_chapters.includes(chapter.id)} onChange={e => setBpForm(v => ({ ...v, required_chapters: e.target.checked ? [...v.required_chapters, chapter.id] : v.required_chapters.filter(id => id !== chapter.id) }))}/>{chapter.name}</label>)}</div></div><div className="module-full form-action-row"><span>Internal choice: not supported.</span><button className="primary-button" disabled={busy}>Save blueprint</button></div></form></Panel>}
        {showChapter && <Panel title="Add chapter" detail="Chapters are shared with assessment blueprints and questions."><form className="setup-form-row" onSubmit={saveChapter}><input required placeholder="Chapter name" value={chapterName} onChange={e => setChapterName(e.target.value)}/><button className="small-primary" disabled={busy}><Plus size={12}/> Save chapter</button></form></Panel>}
        {showQuestion && <Panel title="Add a question" detail="Questions enter the shared, selectable question bank."><form className="module-form-grid" onSubmit={saveQuestion}><Field label="Subject"><select value={qform.subject_id} onChange={e => { const id = Number(e.target.value); setQform(v => ({ ...v, subject_id: id, chapter_ids: academic.chapters.filter(c => c.subject_id === id).slice(0, 1).map(c => c.id) })) }}>{academic.subjects.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></Field><Field label="Question type"><select value={qform.question_type} onChange={e => setQform({ ...qform, question_type: e.target.value })}><option value="multiple_choice">Multiple choice</option><option value="short_answer">Short answer</option><option value="long_answer">Long answer</option></select></Field><Field label="Marks"><input type="number" min={1} value={qform.marks} onChange={e => setQform({ ...qform, marks: Number(e.target.value) })}/></Field><Field label="Difficulty"><select value={qform.difficulty} onChange={e => setQform({ ...qform, difficulty: e.target.value })}><option>easy</option><option>medium</option><option>hard</option></select></Field><div className="module-full"><Field label="Question"><textarea required rows={3} value={qform.prompt} onChange={e => setQform({ ...qform, prompt: e.target.value })}/></Field></div><div className="module-full"><Field label="Teacher reference"><textarea rows={2} value={qform.answer_reference} onChange={e => setQform({ ...qform, answer_reference: e.target.value })}/></Field></div><div className="module-full"><span className="field-caption">Chapter</span><div className="check-grid">{academic.chapters.filter(c => c.subject_id === qform.subject_id).map(c => <label key={c.id}><input type="checkbox" checked={qform.chapter_ids.includes(c.id)} onChange={e => setQform(v => ({ ...v, chapter_ids: e.target.checked ? [...v.chapter_ids, c.id] : v.chapter_ids.filter(id => id !== c.id) }))}/>{c.name}</label>)}</div></div><div className="module-full form-action-row"><span>Question bank entries are persisted in the school database.</span><button className="primary-button" disabled={busy || !qform.chapter_ids.length}>Save question</button></div></form></Panel>}
        <Panel title="Question bank" detail={`${questions.length} approved question(s) with academic metadata.`}>
          <div className="question-bank-list">{questions.slice(0, 7).map(q => <div className="bank-question" key={q.id}><div><b>{q.prompt}</b><span>{academic.subjects.find(s => s.id === q.subject_id)?.name} · {q.question_type.replaceAll('_', ' ')} · {q.marks} marks · {q.difficulty}</span></div><span className="bank-id">Q{q.id}</span></div>)}</div>
        </Panel>
      </div>
      <div className="module-column">
        <Panel title="Assessment workflow" detail="Select a paper to preview, edit, submit or review it." action={<span className="module-count">{assessments.length} PAPERS</span>}>
          {assessments.length ? <div className="assessment-list">{assessments.map(row => <button key={row.id} className={`assessment-list-row ${selectedId === row.id ? 'selected' : ''}`} onClick={() => setSelectedId(row.id)}><div><b>{row.title}</b><span>{academic.classes.find(c => c.id === row.class_id)?.name} · {academic.subjects.find(s => s.id === row.subject_id)?.name}</span></div><Status value={row.status}/></button>)}</div> : <div className="empty-state">No assessments created yet. Start with the form.</div>}
        </Panel>
        {selected && <Panel title={selected.title} detail={`${selected.total_marks} marks · ${selected.duration_minutes} minutes · Version ${selected.current_version}`} action={<Status value={selected.status}/> }>
          <div className="assessment-meta"><span>{academic.classes.find(c => c.id === selected.class_id)?.name}</span><span>{academic.subjects.find(s => s.id === selected.subject_id)?.name}</span><span>{selected.examination_type}</span></div>
          {selected.validation?.errors?.length > 0 && <div className={`validation-box ${selected.validation.valid ? 'valid' : 'invalid'}`}><b>{selected.validation.valid ? 'Blueprint validation passed' : 'Validation found issues'}</b>{selected.validation.errors.map((text, index) => <span key={index}><CircleAlert size={12}/>{text}</span>)}</div>}
          <div className="paper-preview"><div className="paper-title"><b>Paper preview</b><span>{count} selected questions</span></div>{selected.paper.length ? selected.paper.map((item, index) => { const candidates = questions.filter(q => q.subject_id === selected.subject_id && q.question_type === item.question_type && q.marks === item.marks); const editable = canWrite && ['draft', 'changes_requested'].includes(selected.status); return <div className="paper-item" key={`${item.question_id}-${index}`}><div className="paper-order"><b>{index + 1}</b><div><button disabled={busy || !canWrite} title="Move up in section" onClick={() => void shiftQuestion(index, -1)}><ArrowUp size={12}/></button><button disabled={busy || !canWrite} title="Move down in section" onClick={() => void shiftQuestion(index, 1)}><ArrowDown size={12}/></button></div></div><div className="paper-question"><span>{item.section} · {item.marks} marks · {item.difficulty}</span><b>{item.prompt}</b>{editable && editingQuestion === index && <div className="prompt-edit"><textarea rows={2} value={promptDraft} onChange={e => setPromptDraft(e.target.value)}/><button className="small-primary" disabled={busy || !promptDraft.trim()} onClick={() => void savePaper(selected.paper.map(p => p.question_id), { [item.question_id]: promptDraft })}><Save size={12}/> Save text edit</button></div>}{editable && editingQuestion !== index && <button className="small-text-button" onClick={() => { setEditingQuestion(index); setPromptDraft(item.prompt) }}>Edit question text</button>}{editable && <select aria-label="Replace question" value={item.question_id} onChange={e => void replaceQuestion(index, Number(e.target.value))}>{candidates.map(q => <option key={q.id} value={q.id}>Replace with Q{q.id}: {q.prompt.slice(0, 52)}</option>)}</select>}</div></div>}) : <div className="empty-state">No questions selected. Generate from the configured blueprint.</div>}</div>
          <div className="module-action-row">
            {canWrite && ['draft', 'changes_requested'].includes(selected.status) && <button className="light-button" disabled={busy} onClick={() => void refreshPaper()}><WandSparkles size={14}/> Generate / validate</button>}
            {canWrite && selected.status === 'draft' && selected.validation?.valid && <button className="primary-button" disabled={busy} onClick={() => void action(`/api/assessments/${selected.id}/submit`, {}, 'Paper submitted for reviewer approval.')}>Submit for review</button>}
            {canReview && selected.status === 'submitted' && <><button className="light-button" disabled={busy} onClick={() => void action(`/api/assessments/${selected.id}/review`, { action: 'request_changes', comment: 'Please revise the paper.' }, 'Changes requested.')}>Request changes</button><button className="danger-button" disabled={busy} onClick={() => void action(`/api/assessments/${selected.id}/review`, { action: 'reject', comment: 'Paper rejected during review.' }, 'Paper rejected.')}>Reject</button><button className="primary-button" disabled={busy || !selected.validation?.valid} onClick={() => void action(`/api/assessments/${selected.id}/review`, { action: 'approve', comment: '' }, 'Paper approved.')}>Approve</button></>}
            {selected.status === 'approved' && <button className="primary-button" disabled={busy} onClick={() => void downloadPdf()}><FileDown size={14}/> Download approved PDF</button>}
          </div>
          <button className="small-text-button history-toggle" onClick={() => showVersions ? setShowVersions(false) : void loadVersions()}>{showVersions ? 'Hide version history' : 'View version history'}</button>
          {showVersions && <div className="history-list">{versions.map(version => <div key={version.version}><b>v{version.version} · {version.action.replaceAll('_', ' ')}</b><span>{version.comment || 'No comment'} · {new Date(version.created_at).toLocaleString()}</span></div>)}</div>}
          {selected.review_comment && <div className="review-comment"><b>Reviewer note</b><span>{selected.review_comment}</span></div>}
        </Panel>}
      </div></div>
    </>}
  </div>
}

function TimetableWorkspace({ user, request }: Props) {
  const [inputs, setInputs] = useState<{ school: { working_days: string[]; periods_per_day: number }; classes: ClassRow[]; subjects: SubjectRow[]; teachers: { id: number; display_name: string }[]; assignments: { id: number; class_id: number; subject_id: number; teacher_id: number; weekly_lessons: number; unavailable_slots: { day: string; period: number }[] }[] } | null>(null)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [scheduleVersions, setScheduleVersions] = useState<{ version: number; action: string; comment: string; created_at: string }[]>([])
  const [showScheduleVersions, setShowScheduleVersions] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [constraintKind, setConstraintKind] = useState('none')
  const [constraintSubject, setConstraintSubject] = useState(0)
  const [constraintDay, setConstraintDay] = useState('Monday')
  const [constraintPeriod, setConstraintPeriod] = useState(1)
  const [natural, setNatural] = useState('')
  const [classForm, setClassForm] = useState({ name: '', grade: 8, section: 'C' })
  const [subjectName, setSubjectName] = useState('')
  const [assignForm, setAssignForm] = useState({ class_id: 0, subject_id: 0, teacher_id: 0, weekly_lessons: 2 })
  const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true)
  const selected = schedules.find(row => row.id === selectedId) || null
  const canWrite = user.capabilities.includes('timetable:write'), canReview = user.capabilities.includes('timetable:review'), canPublish = user.capabilities.includes('timetable:publish')
  async function refresh() {
    setLoading(true); setError('')
    try { const [data, rows] = await Promise.all([request<typeof inputs>('/api/timetable/inputs'), request<Schedule[]>('/api/timetables')]); setInputs(data); setSchedules(rows); if (!selectedId && rows.length) setSelectedId(rows[0].id); setConstraintSubject(v => v || data?.subjects[0]?.id || 0); setAssignForm(v => ({ ...v, class_id: v.class_id || data?.classes[0]?.id || 0, subject_id: v.subject_id || data?.subjects[0]?.id || 0, teacher_id: v.teacher_id || data?.teachers[0]?.id || 0 })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Timetable data could not be loaded.') } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  async function generate() {
    if (!inputs) return
    setBusy(true); setError(''); setNotice('')
    const constraints = constraintKind === 'none' ? [] : constraintKind === 'avoid_subject_day' ? [{ kind: constraintKind, subject_id: constraintSubject, day: constraintDay, hard: true }] : [{ kind: constraintKind, subject_id: constraintSubject, period: constraintPeriod, weight: 1 }]
    try { const result = await request<Schedule & { unsupported_instructions?: { source_text: string; reason: string }[]; errors?: string[] }>('/api/timetables/generate', { method: 'POST', body: JSON.stringify({ constraints, natural_language: natural.split('\n').map(v => v.trim()).filter(Boolean) }) }); if (!result.id) { setError(result.errors?.join(' ') || result.unsupported_instructions?.map(v => `${v.source_text}: ${v.reason}`).join(' ') || 'Generation did not produce a schedule.'); return } setSchedules(rows => [result, ...rows.filter(row => row.id !== result.id)]); setSelectedId(result.id); setNotice(`${result.solver_status}: ${result.validation.valid ? 'schedule generated and independently validated.' : result.validation.errors.join(' ')}`) }
    catch (e) { setError(e instanceof Error ? e.message : 'Timetable generation failed.') } finally { setBusy(false) }
  }
  async function editAssignment(index: number, key: string, value: string | number) {
    if (!selected) return
    const assignments = selected.assignments.map((a, i) => i === index ? { ...a, [key]: value } : a)
    await mutate(`/api/timetables/${selected.id}/assignments`, 'PUT', { assignments }, 'Manual change saved. Revalidation has run.')
  }
  async function mutate(path: string, method: string, body: unknown, success: string) {
    setBusy(true); setError('')
    try { const init: RequestInit = { method }; if (method !== 'GET') init.body = JSON.stringify(body); const row = await request<Schedule>(path, init); if (Array.isArray(row.assignments)) { setSchedules(old => old.map(item => item.id === row.id ? row : item)); setSelectedId(row.id) } else await refresh(); setNotice(success) }
    catch (e) { setError(e instanceof Error ? e.message : 'The timetable action failed.') } finally { setBusy(false) }
  }
  async function loadScheduleVersions() {
    if (!selected) return
    setBusy(true)
    try { setScheduleVersions(await request(`/api/timetables/${selected.id}/versions`)); setShowScheduleVersions(true) }
    catch (e) { setError(e instanceof Error ? e.message : 'Timetable history could not be loaded.') }
    finally { setBusy(false) }
  }
  async function createRecord(path: string, body: unknown, text: string) { setBusy(true); setError(''); try { await request(path, { method: 'POST', body: JSON.stringify(body) }); setNotice(text); await refresh() } catch (e) { setError(e instanceof Error ? e.message : 'Record could not be created.') } finally { setBusy(false) } }
  const nameForClass = (id: number) => inputs?.classes.find(c => c.id === id)?.name || `Class ${id}`
  const nameForSubject = (id: number) => inputs?.subjects.find(s => s.id === id)?.name || `Subject ${id}`
  const nameForTeacher = (id: number) => inputs?.teachers.find(t => t.id === id)?.display_name || `Teacher ${id}`
  const grouped = useMemo(() => inputs ? inputs.classes.map(c => ({ classroom: c, lessons: selected?.assignments.filter(a => a.class_id === c.id) || [] })) : [], [inputs, selected])
  return <div className="module-workspace"><Notice text={error || notice} error={Boolean(error)} onClose={() => { setError(''); setNotice('') }}/><div className="module-toolbar"><div><b>Timetable generation</b><span>OR-Tools CP-SAT with hard-constraint validation and a review workflow.</span></div><button className="light-button" onClick={() => void refresh()}><RefreshCw size={14}/> Refresh</button></div>
    {loading ? <Busy text="Loading timetable inputs…"/> : inputs && <>
      <div className="split-workspace timetable-split"><div className="module-column">
        <Panel title="Scheduling inputs" detail={`${inputs.school.working_days.join(', ')} · ${inputs.school.periods_per_day} periods each day`}>
          <div className="input-subheading">Classes and subjects</div><div className="input-summary-grid"><div><b>{inputs.classes.length}</b><span>Classes</span></div><div><b>{inputs.subjects.length}</b><span>Subjects</span></div><div><b>{inputs.assignments.length}</b><span>Teacher assignments</span></div></div>
          {canWrite && <div className="setup-forms"><form className="setup-form-row" onSubmit={e => { e.preventDefault(); void createRecord('/api/academic-classes', classForm, 'Class added.') }}><input required placeholder="Class name" value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })}/><input type="number" min={1} max={12} aria-label="Grade" value={classForm.grade} onChange={e => setClassForm({ ...classForm, grade: Number(e.target.value) })}/><input aria-label="Section" value={classForm.section} onChange={e => setClassForm({ ...classForm, section: e.target.value })}/><button className="small-primary"><Plus size={12}/> Class</button></form><form className="setup-form-row" onSubmit={e => { e.preventDefault(); void createRecord('/api/subjects', { name: subjectName }, 'Subject added.'); setSubjectName('') }}><input required placeholder="New subject" value={subjectName} onChange={e => setSubjectName(e.target.value)}/><button className="small-primary"><Plus size={12}/> Subject</button></form><form className="setup-form-row" onSubmit={e => { e.preventDefault(); void createRecord('/api/teacher-assignments', assignForm, 'Teacher assignment saved.') }}><select value={assignForm.class_id} onChange={e => setAssignForm({ ...assignForm, class_id: Number(e.target.value) })}>{inputs.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><select value={assignForm.subject_id} onChange={e => setAssignForm({ ...assignForm, subject_id: Number(e.target.value) })}>{inputs.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><select value={assignForm.teacher_id} onChange={e => setAssignForm({ ...assignForm, teacher_id: Number(e.target.value) })}>{inputs.teachers.map(t => <option key={t.id} value={t.id}>{t.display_name}</option>)}</select><input type="number" min={0} max={20} aria-label="Weekly lesson count" value={assignForm.weekly_lessons} onChange={e => setAssignForm({ ...assignForm, weekly_lessons: Number(e.target.value) })}/><button className="small-primary"><Plus size={12}/> Assign</button></form></div>}
          <div className="assignment-config-list">{inputs.assignments.map(a => <AvailabilityEditor key={a.id} row={a} inputs={inputs} nameForClass={nameForClass} nameForSubject={nameForSubject} request={request} onSaved={refresh} canEdit={canWrite}/>)}</div>
        </Panel>
        <Panel title="Structured constraints" detail="Supported rules are reviewable and deterministic.">
          <div className="module-form-grid"><Field label="Rule type"><select value={constraintKind} onChange={e => setConstraintKind(e.target.value)}><option value="none">No additional constraint</option><option value="avoid_subject_day">Avoid subject on day · hard</option><option value="prefer_subject_period">Prefer subject in period · soft</option></select></Field>{constraintKind !== 'none' && <Field label="Subject"><select value={constraintSubject} onChange={e => setConstraintSubject(Number(e.target.value))}>{inputs.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}{constraintKind === 'avoid_subject_day' ? <Field label="Day"><select value={constraintDay} onChange={e => setConstraintDay(e.target.value)}>{inputs.school.working_days.map(day => <option key={day}>{day}</option>)}</select></Field> : constraintKind === 'prefer_subject_period' ? <Field label="Preferred period"><select value={constraintPeriod} onChange={e => setConstraintPeriod(Number(e.target.value))}>{Array.from({ length: inputs.school.periods_per_day }, (_, i) => i + 1).map(period => <option key={period} value={period}>Period {period}</option>)}</select></Field> : null}</div>
          <div className="module-full nl-row"><Field label="Supported natural-language instructions (one per line)"><textarea rows={2} placeholder="e.g. avoid Mathematics on Monday" value={natural} onChange={e => setNatural(e.target.value)}/></Field><span>Supported formats: “avoid &lt;subject&gt; on &lt;weekday&gt;” and “prefer &lt;subject&gt; in period &lt;number&gt;”. Other instructions will be flagged.</span></div>
          {canWrite && <div className="form-action-row"><span>Hard rules are never weakened to satisfy preferences.</span><button className="primary-button" disabled={busy} onClick={() => void generate()}>{busy && <LoaderCircle size={14} className="spin"/>}<Sparkles size={14}/> Generate draft</button></div>}
        </Panel>
      </div><div className="module-column">
        <Panel title="Generated schedules" detail="Drafts, approvals and published versions are preserved." action={<span className="module-count">{schedules.length} VERSIONS</span>}>{schedules.length ? <div className="assessment-list">{schedules.map(row => <button key={row.id} className={`assessment-list-row ${selectedId === row.id ? 'selected' : ''}`} onClick={() => setSelectedId(row.id)}><div><b>Timetable v{row.version}</b><span>{row.solver_status} · {row.assignments.length} assignments</span></div><Status value={row.status}/></button>)}</div> : <div className="empty-state">No timetable draft yet.</div>}</Panel>
        {selected && <Panel title={`Timetable v${selected.version}`} detail={`Solver status: ${selected.solver_status}`} action={<Status value={selected.status}/> }>
          <div className={`validation-box ${selected.validation?.valid ? 'valid' : 'invalid'}`}><b>{selected.validation?.valid ? 'Hard constraints passed' : 'Schedule needs correction'}</b>{selected.validation?.errors?.map((text, i) => <span key={i}><CircleAlert size={12}/>{text}</span>)}</div>
          {grouped.map(({ classroom, lessons }) => <div className="class-timetable" key={classroom.id}><div className="class-timetable-heading">{classroom.name}</div><div className="class-grid-scroll"><table className="class-schedule-grid"><thead><tr><th>Period</th>{inputs.school.working_days.map(day => <th key={day}>{day.slice(0, 3)}</th>)}</tr></thead><tbody>{Array.from({ length: inputs.school.periods_per_day }, (_, index) => index + 1).map(period => <tr key={period}><th>P{period}</th>{inputs.school.working_days.map(day => { const item = lessons.find(a => a.day === day && a.period === period); return <td key={day}>{item ? <><b>{nameForSubject(item.subject_id)}</b><small>{nameForTeacher(item.teacher_id)}</small></> : <span>—</span>}</td> })}</tr>)}</tbody></table></div><div className="timetable-lesson-grid">{lessons.map((item, i) => <div className="timetable-lesson" key={`${classroom.id}-${item.subject_id}-${i}`}><div><b>{nameForSubject(item.subject_id)}</b><span>{item.day} · Period {item.period}</span><small>{nameForTeacher(item.teacher_id)}</small></div>{canWrite && ['draft', 'changes_requested'].includes(selected.status) && <div className="lesson-edit"><select value={item.day} onChange={e => void editAssignment(selected.assignments.indexOf(item), 'day', e.target.value)}>{inputs.school.working_days.map(day => <option key={day}>{day}</option>)}</select><select value={item.period} onChange={e => void editAssignment(selected.assignments.indexOf(item), 'period', Number(e.target.value))}>{Array.from({ length: inputs.school.periods_per_day }, (_, j) => j + 1).map(period => <option key={period} value={period}>P{period}</option>)}</select></div>}</div>)}</div></div>)}
          <div className="module-action-row">{canWrite && ['draft', 'changes_requested'].includes(selected.status) && <button className="light-button" disabled={busy} onClick={() => void mutate(`/api/timetables/${selected.id}/validate`, 'GET', {}, 'Schedule revalidated.')}>Revalidate</button>}{canWrite && selected.status === 'draft' && <button className="primary-button" disabled={busy || !selected.validation?.valid} onClick={() => void mutate(`/api/timetables/${selected.id}/submit`, 'POST', {}, 'Schedule sent for review.')}>Submit for review</button>}{canReview && selected.status === 'submitted' && <><button className="light-button" onClick={() => void mutate(`/api/timetables/${selected.id}/review`, 'POST', { action: 'request_changes', comment: 'Please correct the timetable.' }, 'Changes requested.')}>Request changes</button><button className="danger-button" onClick={() => void mutate(`/api/timetables/${selected.id}/review`, 'POST', { action: 'reject', comment: 'Rejected in review.' }, 'Schedule rejected.')}>Reject</button><button className="primary-button" onClick={() => void mutate(`/api/timetables/${selected.id}/review`, 'POST', { action: 'approve', comment: '' }, 'Schedule approved.')}>Approve</button></>}{canPublish && selected.status === 'approved' && <button className="primary-button" onClick={() => void mutate(`/api/timetables/${selected.id}/publish`, 'POST', {}, 'Schedule published.')}>Publish</button>}</div>
          <button className="small-text-button history-toggle" onClick={() => showScheduleVersions ? setShowScheduleVersions(false) : void loadScheduleVersions()}>{showScheduleVersions ? 'Hide revision history' : 'View revision history'}</button>
          {showScheduleVersions && <div className="history-list">{scheduleVersions.map(version => <div key={version.version}><b>Revision {version.version} · {version.action.replaceAll('_', ' ')}</b><span>{version.comment || 'No comment'} · {new Date(version.created_at).toLocaleString()}</span></div>)}</div>}
        </Panel>}
      </div></div>
    </>}
  </div>
}

function AvailabilityEditor({ row, inputs, nameForClass, nameForSubject, request, onSaved, canEdit }: { row: TeacherAssignment; inputs: { school: { working_days: string[]; periods_per_day: number }; teachers: { id: number; display_name: string }[] }; nameForClass: (id: number) => string; nameForSubject: (id: number) => string; request: ApiRequest; onSaved: () => void; canEdit: boolean }) {
  const [open, setOpen] = useState(false)
  const [lessons, setLessons] = useState(row.weekly_lessons)
  const [unavailable, setUnavailable] = useState(row.unavailable_slots || [])
  const [day, setDay] = useState(inputs.school.working_days[0] || 'Monday')
  const [period, setPeriod] = useState(1)
  const [error, setError] = useState('')
  async function save() { try { await request(`/api/teacher-assignments/${row.id}`, { method: 'PUT', body: JSON.stringify({ weekly_lessons: lessons, unavailable_slots: unavailable }) }); setError(''); setOpen(false); onSaved() } catch (e) { setError(e instanceof Error ? e.message : 'Availability could not be saved.') } }
  return <div className="availability-row"><div><b>{nameForClass(row.class_id)} · {nameForSubject(row.subject_id)}</b><span>{inputs.teachers.find(t => t.id === row.teacher_id)?.display_name} · {row.weekly_lessons} lessons/week · {row.unavailable_slots.length} unavailable slots</span></div>{canEdit && <button className="small-text-button" onClick={() => setOpen(v => !v)}>{open ? 'Close' : 'Configure'}</button>}{open && <div className="availability-editor"><div className="unavailable-add"><select value={day} onChange={e => setDay(e.target.value)}>{inputs.school.working_days.map(d => <option key={d}>{d}</option>)}</select><select value={period} onChange={e => setPeriod(Number(e.target.value))}>{Array.from({ length: inputs.school.periods_per_day }, (_, i) => i + 1).map(i => <option key={i} value={i}>Period {i}</option>)}</select><button className="small-text-button" onClick={() => setUnavailable(v => v.some(x => x.day === day && x.period === period) ? v : [...v, { day, period }])}>Add unavailable</button></div><label>Weekly lessons <input type="number" min={0} max={20} value={lessons} onChange={e => setLessons(Number(e.target.value))}/></label><div className="slot-chips">{unavailable.map((slot, i) => <button key={`${slot.day}-${slot.period}-${i}`} onClick={() => setUnavailable(v => v.filter((_, index) => index !== i))}>{slot.day} P{slot.period} ×</button>)}</div>{error && <span className="inline-error">{error}</span>}<button className="small-primary" onClick={() => void save()}><Save size={12}/> Save</button></div>}</div>
}

function PlannerWorkspace({ user, request }: Props) {
  type Requirement = { id: number; category: string; source_text: string; status: string; structured_data: Record<string, unknown>; created_by: number; review_comment: string }
  const [rows, setRows] = useState<Requirement[]>([]); const [category, setCategory] = useState('timetable_instruction'); const [source, setSource] = useState(''); const [structured, setStructured] = useState('{}'); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [drafts, setDrafts] = useState<Record<number, string>>({})
  const canWrite = user.capabilities.includes('planner:write'), canReview = user.capabilities.includes('planner:review')
  async function refresh() { setLoading(true); try { setRows(await request<Requirement[]>('/api/planner/requirements')); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Requirements unavailable.') } finally { setLoading(false) } }
  useEffect(() => { void refresh() }, [])
  async function create(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { const data = category === 'timetable_instruction' ? {} : JSON.parse(structured); const row = await request<Requirement>('/api/planner/requirements', { method: 'POST', body: JSON.stringify({ category, source_text: source, structured_data: data }) }); setRows(v => [row, ...v]); setSource(''); setNotice(row.status === 'unsupported' ? `Instruction flagged: ${String(row.structured_data.reason || 'unsupported')}` : 'Requirement submitted for review.') } catch (e) { setError(e instanceof Error ? e.message : 'Requirement could not be submitted. Check structured data JSON.') } finally { setBusy(false) } }
  async function review(row: Requirement, action: string) { setBusy(true); setError(''); try { const updated = await request<Requirement>(`/api/planner/requirements/${row.id}/review`, { method: 'POST', body: JSON.stringify({ action, comment: '' }) }); setRows(old => old.map(r => r.id === updated.id ? updated : r)); setNotice(`Requirement ${action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'returned for changes'}.`) } catch (e) { setError(e instanceof Error ? e.message : 'Review action failed.') } finally { setBusy(false) } }
  async function updateRequirement(row: Requirement) { setBusy(true); setError(''); try { const updated = await request<Requirement>(`/api/planner/requirements/${row.id}`, { method: 'PUT', body: JSON.stringify({ source_text: drafts[row.id] || row.source_text, structured_data: row.structured_data }) }); setRows(old => old.map(r => r.id === updated.id ? updated : r)); setNotice(updated.status === 'unsupported' ? 'Updated text remains unsupported and needs another revision.' : 'Requirement corrected and resubmitted for review.') } catch (e) { setError(e instanceof Error ? e.message : 'Requirement could not be updated.') } finally { setBusy(false) } }
  return <div className="module-workspace"><Notice text={error || notice} error={Boolean(error)} onClose={() => { setError(''); setNotice('') }}/><div className="module-toolbar"><div><b>Academic Planner</b><span>Collect and review documented academic requirements. Supported timetable instructions feed generation.</span></div><button className="light-button" onClick={() => void refresh()}><RefreshCw size={14}/> Refresh</button></div><div className="split-workspace"><div className="module-column"><Panel title="Collect a requirement" detail="Planner keeps school structure and documented requirements in shared records.">{canWrite ? <form className="module-form-grid" onSubmit={create}><Field label="Requirement category"><select value={category} onChange={e => setCategory(e.target.value)}><option value="timetable_instruction">Timetable instruction</option><option value="syllabus">Syllabus requirement</option><option value="teaching_periods">Teaching periods</option><option value="teacher_availability">Teacher availability</option><option value="holiday">Holiday</option><option value="examination_date">Examination date</option></select></Field><div className="module-full"><Field label={category === 'timetable_instruction' ? 'Instruction' : 'Source / requirement'}><textarea required rows={3} value={source} onChange={e => setSource(e.target.value)} placeholder={category === 'timetable_instruction' ? 'e.g. avoid Mathematics on Monday' : 'Enter the documented requirement'}/></Field></div>{category !== 'timetable_instruction' && <div className="module-full"><Field label="Structured data (JSON)"><textarea rows={3} value={structured} onChange={e => setStructured(e.target.value)}/></Field></div>}<div className="module-full form-action-row"><span>Unsupported or ambiguous natural language will be flagged for correction.</span><button className="primary-button" disabled={busy || !source.trim()}>Submit requirement</button></div></form> : <div className="empty-state">This account can review requirements but cannot submit them.</div>}</Panel><Panel title="Scope note" detail="Academic planning requirements from the project prompt."><div className="scope-note"><Check size={14}/> Configuration, requirement collection and review are supported.<br/><CircleAlert size={14}/> No syllabus-completion algorithm, progress dashboard or automated tracking has been added.</div></Panel></div><div className="module-column"><Panel title="Requirements and review" detail="Review structured requirements before they feed related workflows." action={<span className="module-count">{rows.length} ITEMS</span>}>{loading ? <Busy text="Loading requirements…"/> : rows.length ? <div className="planner-list">{rows.map(row => <div className="planner-row" key={row.id}><div className="planner-row-top"><span className="category-tag">{row.category.replaceAll('_', ' ')}</span><Status value={row.status}/></div><b>{row.source_text}</b>{row.structured_data && <code>{JSON.stringify(row.structured_data)}</code>}{row.review_comment && <span className="review-comment">{row.review_comment}</span>}{canWrite && ['changes_requested', 'unsupported'].includes(row.status) && <div className="requirement-edit"><textarea rows={2} value={drafts[row.id] ?? row.source_text} onChange={e => setDrafts(old => ({ ...old, [row.id]: e.target.value }))}/><button className="small-primary" disabled={busy || !(drafts[row.id] ?? row.source_text).trim()} onClick={() => void updateRequirement(row)}><Save size={12}/> Correct and resubmit</button></div>}{canReview && ['submitted', 'unsupported'].includes(row.status) && <div className="module-action-row"><button className="light-button" disabled={busy || row.status === 'unsupported'} onClick={() => void review(row, 'request_changes')}>Request changes</button><button className="danger-button" disabled={busy} onClick={() => void review(row, 'reject')}>Reject</button><button className="primary-button" disabled={busy || row.status === 'unsupported'} onClick={() => void review(row, 'accept')}>Accept</button></div>}</div>)}</div> : <div className="empty-state">No academic requirements recorded yet.</div>}</Panel></div></div></div>
}

function CoordinationWorkspace({ user, request }: Props) {
  type Task = { id: number; title: string; description: string; workflow_type: string; workflow_id: number; status: string; responsible_user_id: number | null; updates: { id: number; body: string; actor_id: number; created_at: string }[] }
  type Link = { id: number; title: string; status: string }
  const [tasks, setTasks] = useState<Task[]>([]); const [assessments, setAssessments] = useState<Link[]>([]); const [schedules, setSchedules] = useState<Link[]>([]); const [requirements, setRequirements] = useState<Link[]>([])
  const [form, setForm] = useState({ title: '', description: '', workflow_type: 'assessment', workflow_id: 0 }); const [updateText, setUpdateText] = useState<Record<number, string>>({}); const [taskStatuses, setTaskStatuses] = useState<Record<number, string>>({}); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const canRead = user.capabilities.includes('tasks:read'), canWrite = user.capabilities.includes('tasks:write')
  async function refresh() { setLoading(true); try { const [t, a, s, p] = await Promise.all([request<Task[]>('/api/tasks'), request<Link[]>('/api/assessments'), request<Link[]>('/api/timetables'), request<Link[]>('/api/planner/requirements')]); setTasks(t); setAssessments(a); setSchedules(s); setRequirements(p); setForm(v => ({ ...v, workflow_id: v.workflow_id || a[0]?.id || s[0]?.id || p[0]?.id || 0 })) } catch (e) { setError(e instanceof Error ? e.message : 'Tasks could not be loaded.') } finally { setLoading(false) } }
  useEffect(() => { if (canRead) void refresh(); else setLoading(false) }, [])
  const linkedItems = form.workflow_type === 'assessment' ? assessments : form.workflow_type === 'timetable' ? schedules : requirements
  useEffect(() => { if (linkedItems.length && !linkedItems.some(item => item.id === form.workflow_id)) setForm(v => ({ ...v, workflow_id: linkedItems[0].id })) }, [form.workflow_type, linkedItems])
  async function create(e: FormEvent) { e.preventDefault(); setBusy(true); try { await request('/api/tasks', { method: 'POST', body: JSON.stringify(form) }); setNotice('Task linked to the selected academic workflow.'); setForm(v => ({ ...v, title: '', description: '' })); await refresh() } catch (e) { setError(e instanceof Error ? e.message : 'Task could not be created.') } finally { setBusy(false) } }
  async function update(task: Task) { setBusy(true); try { await request(`/api/tasks/${task.id}/updates`, { method: 'POST', body: JSON.stringify({ body: updateText[task.id] || 'Status updated.', status: taskStatuses[task.id] || task.status }) }); setNotice('Task update recorded in the shared audit trail.'); await refresh() } catch (e) { setError(e instanceof Error ? e.message : 'Task could not be updated.') } finally { setBusy(false) } }
  if (!canRead) return <div className="module-workspace"><Panel title="Access restricted"><div className="empty-state">This account does not have tasks:read capability.</div></Panel></div>
  return <div className="module-workspace"><Notice text={error || notice} error={Boolean(error)} onClose={() => { setError(''); setNotice('') }}/><div className="module-toolbar"><div><b>Academic coordination</b><span>Shared tasks connected to real academic workflow records.</span></div><button className="light-button" onClick={() => void refresh()}><RefreshCw size={14}/> Refresh</button></div><div className="split-workspace"><div className="module-column">{canWrite && <Panel title="Create linked task" detail="Tasks stay connected to assessment, timetable or planner records."><form className="module-form-grid" onSubmit={create}><Field label="Task title"><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/></Field><Field label="Workflow"><select value={form.workflow_type} onChange={e => setForm({ ...form, workflow_type: e.target.value, workflow_id: 0 })}><option value="assessment">Assessment</option><option value="timetable">Timetable</option><option value="planner">Academic requirement</option></select></Field><Field label="Linked record"><select required value={form.workflow_id} onChange={e => setForm({ ...form, workflow_id: Number(e.target.value) })}>{linkedItems.map(item => <option key={item.id} value={item.id}>#{item.id} · {item.title || item.status}</option>)}</select></Field><div className="module-full"><Field label="Description"><textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></Field></div><div className="module-full form-action-row"><span>Task events are kept in the audit history.</span><button className="primary-button" disabled={busy || !form.workflow_id}>Create task</button></div></form></Panel>}<Panel title="Shared workflow states" detail="Current status values used by this task workspace."><div className="status-legend"><Status value="awaiting_preparation"/><Status value="awaiting_review"/><Status value="changes_requested"/><Status value="completed"/></div></Panel></div><div className="module-column"><Panel title="Task workspace" detail="Review pending items and post workflow-relevant updates." action={<span className="module-count">{tasks.length} TASKS</span>}>{loading ? <Busy text="Loading tasks…"/> : tasks.length ? <div className="coordination-list">{tasks.map(task => <div className="coordination-card" key={task.id}><div className="coordination-card-heading"><div><b>{task.title}</b><span>{task.workflow_type} #{task.workflow_id} · {task.description || 'No additional details'}</span></div><Status value={task.status}/></div>{task.updates.length > 0 && <div className="task-updates">{task.updates.map(item => <div key={item.id}><span>{item.body}</span><small>{new Date(item.created_at).toLocaleString()}</small></div>)}</div>}{canWrite && <div className="task-update-form"><input placeholder="Add relevant update" value={updateText[task.id] || ''} onChange={e => setUpdateText(v => ({ ...v, [task.id]: e.target.value }))}/><select value={taskStatuses[task.id] || task.status} onChange={e => setTaskStatuses(v => ({ ...v, [task.id]: e.target.value }))}><option value="awaiting_preparation">Awaiting preparation</option><option value="awaiting_review">Awaiting review</option><option value="changes_requested">Changes requested</option><option value="completed">Completed</option></select><button className="small-primary" disabled={busy} onClick={() => void update(task)}><Save size={12}/> Update</button></div>}</div>)}</div> : <div className="empty-state">No shared tasks yet. Create one linked to a workflow.</div>}</Panel></div></div></div>
}
