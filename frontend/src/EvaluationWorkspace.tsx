import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, CheckCircle2, ClipboardCheck, LoaderCircle, Plus, RefreshCw, Save } from 'lucide-react'
import './module.css'

type User = { username: string; capabilities: string[] }
type ApiRequest = <T>(path: string, init?: RequestInit, identity?: string) => Promise<T>
type Props = { user: User; request: ApiRequest }
type PaperItem = { question_id: number; prompt: string; marks: number; question_type: string }
type Assessment = { id: number; title: string; status: string; total_marks: number; paper: PaperItem[] }
type Question = { id: number; question_type: string; answer_reference: string; marks: number; expected_points: string[]; accepted_variants: Record<string, string[]>; marking_notes: string }
type EvaluationQuestion = {
  question_id: number; question_number: number; question_text: string; question_type: string; max_marks: number; answer: string
  answer_key: { answer_reference: string; expected_points: string[]; accepted_variants: Record<string, string[]>; marking_notes: string }
  suggested_marks: number | null; suggestion_method: string | null; suggestion_justification: Record<string, unknown>; requires_teacher_review: boolean
  teacher_edited_marks: number | null; final_marks: number | null
}
type Evaluation = { id: number; assessment_id: number; assessment_title: string; status: 'answers_review' | 'suggestions_ready' | 'confirmed'; final_total: number | null; questions: EvaluationQuestion[] }
type EvaluationSummary = { id: number; assessment_id: number; assessment_title: string; status: string; final_total: number | null; created_at: string }
type CriteriaRow = { point: string; variants: string }

function errorText(error: unknown) { return error instanceof Error ? error.message : 'The evaluation request failed.' }

export default function EvaluationWorkspace({ user, request }: Props) {
  const canWrite = user.capabilities.includes('assessments:write')
  const canRead = canWrite || user.capabilities.includes('assessments:review')
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([])
  const [assessmentId, setAssessmentId] = useState<number | null>(null)
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [markDraft, setMarkDraft] = useState<Record<number, string>>({})
  const [suggestionDraft, setSuggestionDraft] = useState<Record<number, string>>({})
  const [marksSaved, setMarksSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const assessment = assessments.find(row => row.id === assessmentId) || null
  const paper = useMemo(() => (assessment?.paper || []).map(item => ({ ...item, question: questions.find(row => row.id === item.question_id) })), [assessment, questions])

  function applyEvaluation(row: Evaluation) {
    setEvaluation(row)
    setAssessmentId(row.assessment_id)
    setAnswers(Object.fromEntries(row.questions.map(item => [item.question_id, item.answer])) as Record<number, string>)
    setMarkDraft(Object.fromEntries(row.questions.map(item => [item.question_id, item.teacher_edited_marks == null ? (item.suggested_marks == null ? '' : String(item.suggested_marks)) : String(item.teacher_edited_marks)])) as Record<number, string>)
    setSuggestionDraft(Object.fromEntries(row.questions.map(item => [item.question_id, item.suggested_marks == null ? '' : String(item.suggested_marks)])) as Record<number, string>)
    setMarksSaved(row.questions.every(item => item.teacher_edited_marks != null))
  }

  async function refresh() {
    setLoading(true); setError('')
    try {
      if (!canRead) { setAssessments([]); setQuestions([]); setEvaluations([]); return }
      const [assessmentRows, questionRows, evaluationRows] = await Promise.all([
        request<Assessment[]>('/api/assessments'), request<Question[]>('/api/questions'), request<EvaluationSummary[]>('/api/evaluations'),
      ])
      setAssessments(assessmentRows); setQuestions(questionRows); setEvaluations(evaluationRows)
      setAssessmentId(current => current && assessmentRows.some(row => row.id === current) ? current : assessmentRows[0]?.id ?? null)
    } catch (e) { setError(errorText(e)) } finally { setLoading(false) }
  }

  useEffect(() => {
    setEvaluation(null); setAnswers({}); setMarkDraft({}); setSuggestionDraft({}); setMarksSaved(false)
    void refresh()
  }, [user.username])

  function startNew(id = assessmentId) {
    setAssessmentId(id); setEvaluation(null); setMarksSaved(false); setMarkDraft({}); setSuggestionDraft({}); setError(''); setNotice('')
    const chosen = assessments.find(row => row.id === id)
    setAnswers(Object.fromEntries((chosen?.paper || []).map(item => [item.question_id, ''])))
  }

  async function loadEvaluation(id: number) {
    setBusy(true); setError('')
    try { applyEvaluation(await request<Evaluation>(`/api/evaluations/${id}`)); setNotice('Saved evaluation loaded.') }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  async function create(e: FormEvent) {
    e.preventDefault(); if (!assessment) return
    setBusy(true); setError(''); setNotice('')
    try {
      const row = await request<Evaluation>('/api/evaluations', { method: 'POST', body: JSON.stringify({ assessment_id: assessment.id, answers: paper.map(item => ({ question_id: item.question_id, answer: answers[item.question_id] ?? '' })) }) })
      applyEvaluation(row); setEvaluations(rows => [{ id: row.id, assessment_id: row.assessment_id, assessment_title: row.assessment_title, status: row.status, final_total: row.final_total, created_at: new Date().toISOString() }, ...rows]); setNotice('Answers saved. Review them below before generating suggestions.')
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }

  async function generateSuggestions() {
    if (!evaluation) return
    setBusy(true); setError('')
    try {
      await request<Evaluation>(`/api/evaluations/${evaluation.id}/review-answers`, { method: 'POST' })
      const row = await request<Evaluation>(`/api/evaluations/${evaluation.id}/suggestions`, { method: 'POST' })
      applyEvaluation(row); setNotice('Suggestions are ready. Review each one and enter teacher marks before confirmation.'); void refreshSummaries()
    }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  async function refreshSummaries() {
    try { setEvaluations(await request<EvaluationSummary[]>('/api/evaluations')) } catch { /* current evaluation remains available */ }
  }

  async function saveTeacherSuggestion(questionId: number) {
    if (!evaluation) return
    const marks = Number(suggestionDraft[questionId])
    if (!Number.isFinite(marks)) { setError('Enter a numeric teacher suggestion.'); return }
    setBusy(true); setError('')
    try {
      const row = await request<Evaluation>(`/api/evaluations/${evaluation.id}/questions/${questionId}/suggestion`, { method: 'PUT', body: JSON.stringify({ question_id: questionId, marks }) })
      applyEvaluation(row); setNotice('Teacher-entered suggestion saved; it is not a confirmed mark.')
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  function editedValues() {
    if (!evaluation) return null
    const output: { question_id: number; marks: number }[] = []
    for (const question of evaluation.questions) {
      const raw = markDraft[question.question_id]
      if (raw == null || raw.trim() === '') { setError(`Enter teacher-reviewed marks for question ${question.question_number}.`); return null }
      const marks = Number(raw)
      if (!Number.isFinite(marks) || marks < 0 || marks > question.max_marks) { setError(`Question ${question.question_number} marks must be between 0 and ${question.max_marks}.`); return null }
      output.push({ question_id: question.question_id, marks })
    }
    return output
  }

  async function saveTeacherMarks() {
    if (!evaluation) return
    const marks = editedValues(); if (!marks) return
    setBusy(true); setError('')
    try {
      const row = await request<Evaluation>(`/api/evaluations/${evaluation.id}/teacher-marks`, { method: 'PUT', body: JSON.stringify({ marks }) })
      applyEvaluation(row); setMarksSaved(true); setNotice('Teacher-reviewed marks saved separately from the suggestions.')
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  async function confirm() {
    if (!evaluation || !marksSaved) return
    const marks = editedValues(); if (!marks) return
    setBusy(true); setError('')
    try {
      const row = await request<Evaluation>(`/api/evaluations/${evaluation.id}/confirm`, { method: 'POST', body: JSON.stringify({ marks }) })
      applyEvaluation(row); setNotice(`Evaluation confirmed and saved. Final total: ${row.final_total} marks.`); void refreshSummaries()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  if (!canRead) return <div className="module-workspace"><div className="module-toolbar"><div><b>Examination evaluation</b><span>Typed answers with teacher-controlled marks.</span></div></div><section className="panel module-panel"><div className="scope-note"><AlertTriangle size={16}/> This account needs assessment access to read evaluation records.</div></section></div>

  return <div className="module-workspace">
    <div className={`module-notice ${error ? 'error' : 'success'}`} hidden={!error && !notice}><span>{error || notice}</span><button onClick={() => { setError(''); setNotice('') }}>Dismiss</button></div>
    <div className="module-toolbar"><div><b>Examination evaluation</b><span>Typed answers · deterministic suggestions · teacher confirmation</span></div><button className="light-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14}/> Refresh</button></div>
    {!canWrite && <section className="panel module-panel"><div className="scope-note"><AlertTriangle size={16}/> This account can review assessment data but cannot create or confirm evaluations.</div></section>}
    {loading ? <div className="module-loading"><LoaderCircle size={16} className="spin"/>Loading assessments…</div> : <div className="evaluation-layout">
      <aside className="module-column">
        <section className="panel module-panel"><div className="module-panel-heading"><div><h2>Assessment</h2><p>Choose a paper from Assessment Studio.</p></div></div>
          <label className="module-field"><span>Existing assessment</span><select value={assessmentId ?? ''} onChange={e => startNew(Number(e.target.value))}><option value="" disabled>Select an assessment</option>{assessments.map(row => <option key={row.id} value={row.id}>{row.title} · {row.status}</option>)}</select></label>
          {assessment && <div className="assessment-meta evaluation-meta"><span>{paper.length} questions</span><span>{assessment.total_marks} paper marks</span><span>{assessment.status}</span></div>}
          {canWrite && <button className="light-button evaluation-new" onClick={() => startNew()} disabled={!assessment}><Plus size={13}/> New evaluation</button>}
        </section>
        <section className="panel module-panel"><div className="module-panel-heading"><div><h2>Saved evaluations</h2><p>Drafts remain separate from confirmed results.</p></div><span className="module-count">{evaluations.length}</span></div>
          {evaluations.length ? <div className="assessment-list">{evaluations.map(row => <button key={row.id} className={`assessment-list-row ${evaluation?.id === row.id ? 'selected' : ''}`} onClick={() => void loadEvaluation(row.id)} disabled={busy}><div><b>{row.assessment_title}</b><span>Evaluation #{row.id} · {row.final_total == null ? row.status.replaceAll('_', ' ') : `${row.final_total} marks · ${row.status}`}</span></div></button>)}</div> : <div className="empty-state">No saved evaluations yet.</div>}
        </section>
      </aside>

      <div className="module-column">
        {!assessment ? <section className="panel module-panel"><div className="empty-state">Select an assessment with a generated paper to begin.</div></section> : !evaluation ? <form className="panel module-panel" onSubmit={create}>
          <div className="module-panel-heading"><div><h2>Enter answers for {assessment.title}</h2><p>Each response is saved against its assessment question ID. Leave an answer blank only when it was unanswered.</p></div></div>
          {!paper.length ? <div className="empty-state">This assessment has no generated paper.</div> : <div className="evaluation-question-list">{paper.map((item, index) => <div className="evaluation-question-card" key={item.question_id}>
            <div className="evaluation-question-heading"><b>Question {index + 1}</b><span>Q{item.question_id} · {item.question?.marks ?? item.marks} marks · {item.question_type.replaceAll('_', ' ')}</span></div>
            <p className="evaluation-question-prompt">{item.prompt}</p>
            <label className="module-field"><span>Typed answer</span><textarea rows={3} maxLength={10000} disabled={!canWrite} value={answers[item.question_id] ?? ''} onChange={e => setAnswers(prev => ({ ...prev, [item.question_id]: e.target.value }))} placeholder="Enter the student's answer"/></label>
            {item.question?.question_type === 'multiple_choice' && <p className="evaluation-explanation">Exact option matching is available when the answer reference is a single label such as B or Option B. Other references are flagged for teacher review.</p>}
            {canWrite && item.question && <CriteriaEditor key={item.question_id} question={item.question} request={request} onSaved={updated => setQuestions(rows => rows.map(q => q.id === updated.id ? updated : q))}/>}
          </div>)}</div>}
          {canWrite && <div className="module-action-row"><span>Typed text only. No scans or OCR are processed.</span><button className="primary-button" disabled={busy || !paper.length}><ClipboardCheck size={14}/> Save answers for review</button></div>}
        </form> : <>
          <section className="panel module-panel"><div className="module-panel-heading"><div><h2>{evaluation.assessment_title}</h2><p>Evaluation #{evaluation.id} · status: {evaluation.status.replaceAll('_', ' ')}</p></div>{evaluation.status === 'confirmed' && <span className="status-badge status-confirmed">CONFIRMED</span>}</div>
            {evaluation.status === 'answers_review' && <><div className="scope-note evaluation-caution"><AlertTriangle size={15}/> Review the saved typed answers before generating any mark suggestions.</div><div className="evaluation-question-list">{evaluation.questions.map(q => <article className="evaluation-question-card" key={q.question_id}><div className="evaluation-question-heading"><b>Question {q.question_number}</b><span>Q{q.question_id} · {q.max_marks} marks</span></div><p className="evaluation-question-prompt">{q.question_text}</p><div className="evaluation-answer-review">{q.answer.trim() || <em>Unanswered</em>}</div></article>)}</div>{canWrite && <div className="module-action-row"><span>Suggestions are not final marks.</span><button className="primary-button" onClick={() => void generateSuggestions()} disabled={busy}><Check size={14}/> Generate suggestions</button></div>}</>}
            {evaluation.status === 'suggestions_ready' && <><div className="scope-note evaluation-caution"><AlertTriangle size={15}/> Suggestions are review aids. Keyword matches do not establish academic correctness. Final marks require a separate teacher save and confirmation.</div>
              <div className="evaluation-question-list">{evaluation.questions.map(q => <article className="evaluation-question-card" key={q.question_id}>
                <div className="evaluation-question-heading"><b>Question {q.question_number}</b><span>Q{q.question_id} · maximum {q.max_marks}</span></div><p className="evaluation-question-prompt">{q.question_text}</p><div className="evaluation-answer-review">{q.answer.trim() || <em>Unanswered</em>}</div>
                <div className="evaluation-key"><b>Answer reference</b><span>{q.answer_key.answer_reference || 'No reference answer is configured.'}</span>{q.answer_key.expected_points?.length > 0 && <><b>Expected points</b><ul>{q.answer_key.expected_points.map(point => <li key={point}>{point}{q.answer_key.accepted_variants?.[point]?.length ? ` (accepted: ${q.answer_key.accepted_variants[point].join(', ')})` : ''}</li>)}</ul></>}{q.answer_key.marking_notes && <><b>Marking notes</b><span>{q.answer_key.marking_notes}</span></>}</div>
                <div className="evaluation-suggestion"><div><b>Suggested marks</b><span>{q.suggested_marks == null ? 'Unavailable; teacher review required' : `${q.suggested_marks} / ${q.max_marks}`}</span><small>{q.suggestion_method === 'teacher_entered' ? 'Teacher-entered suggestion' : q.suggestion_method?.replaceAll('_', ' ') || 'Not generated'}</small></div>{q.requires_teacher_review && <span className="review-flag"><AlertTriangle size={12}/> Teacher review required</span>}</div>
                {typeof q.suggestion_justification.message === 'string' && <p className="evaluation-explanation">{q.suggestion_justification.message}</p>}
                {Array.isArray(q.suggestion_justification.matched_points) && q.suggestion_justification.matched_points.length > 0 && <div className="evaluation-point-results"><div><b>Matched</b><span>{(q.suggestion_justification.matched_points as string[]).join('; ')}</span></div><div><b>Not detected</b><span>{((q.suggestion_justification.missing_points as string[]) || []).join('; ') || 'None'}</span></div></div>}
                {q.question_type === 'multiple_choice' && q.suggestion_method === 'exact_option_label' && <p className="evaluation-explanation">Submitted option: {String(q.suggestion_justification.submitted_option || 'Unanswered')} · Correct option: {String(q.suggestion_justification.correct_option)}</p>}
                {q.question_type === 'long_answer' && canWrite && <div className="teacher-suggestion-entry"><label className="module-field"><span>Teacher-entered suggestion (optional)</span><input type="number" min={0} max={q.max_marks} step="0.01" value={suggestionDraft[q.question_id] ?? ''} onChange={e => setSuggestionDraft(prev => ({ ...prev, [q.question_id]: e.target.value }))}/></label><button className="light-button" onClick={() => void saveTeacherSuggestion(q.question_id)} disabled={busy || !suggestionDraft[q.question_id]?.trim()}><Save size={12}/> Save suggestion</button></div>}
                <label className="module-field evaluation-teacher-mark"><span>{canWrite ? 'Teacher-reviewed marks' : 'Teacher-reviewed marks'}</span><input type="number" min={0} max={q.max_marks} step="0.01" value={markDraft[q.question_id] ?? ''} disabled={!canWrite} onChange={e => { setMarkDraft(prev => ({ ...prev, [q.question_id]: e.target.value })); setMarksSaved(false) }} placeholder={`0 to ${q.max_marks}`}/></label>
              </article>)}</div>
              {canWrite && <div className="module-action-row"><span>{evaluation.questions.length ? 'Save teacher marks first, then confirm them.' : ''}</span><button className="light-button" onClick={() => void saveTeacherMarks()} disabled={busy}><Save size={13}/> Save teacher marks</button><button className="primary-button" onClick={() => void confirm()} disabled={busy || !marksSaved}><CheckCircle2 size={14}/> Confirm final marks</button></div>}
            </>}
            {evaluation.status === 'confirmed' && <><div className="evaluation-total"><span>Confirmed total</span><b>{evaluation.final_total} / {evaluation.questions.reduce((sum, q) => sum + q.max_marks, 0)}</b></div><div className="evaluation-question-list">{evaluation.questions.map(q => <article className="evaluation-question-card" key={q.question_id}><div className="evaluation-question-heading"><b>Question {q.question_number}</b><span>Q{q.question_id} · {q.final_marks} / {q.max_marks}</span></div><p className="evaluation-question-prompt">{q.question_text}</p><div className="evaluation-answer-review">{q.answer.trim() || <em>Unanswered</em>}</div><div className="evaluation-explanation">Suggested: {q.suggested_marks ?? 'none'} · Teacher-reviewed: {q.teacher_edited_marks} · Confirmed: {q.final_marks}</div></article>)}</div></>}
          </section>
        </>}
      </div>
    </div>}
  </div>
}

function CriteriaEditor({ question, request, onSaved }: { question: Question; request: ApiRequest; onSaved: (question: Question) => void }) {
  const [rows, setRows] = useState<CriteriaRow[]>([])
  const [notes, setNotes] = useState(question.marking_notes || '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    setRows(question.expected_points?.length ? question.expected_points.map(point => ({ point, variants: (question.accepted_variants?.[point] || []).join(' | ') })) : [{ point: '', variants: '' }])
    setNotes(question.marking_notes || '')
  }, [question.id, question.expected_points, question.accepted_variants, question.marking_notes])
  async function save() {
    setBusy(true); setMessage('')
    try {
      const expected_points = rows.map(row => row.point.trim()).filter(Boolean)
      const accepted_variants = Object.fromEntries(rows.filter(row => row.point.trim()).map(row => [row.point.trim(), row.variants.split('|').map(value => value.trim()).filter(Boolean)]).filter(([, variants]) => (variants as string[]).length))
      const updated = await request<Question>(`/api/questions/${question.id}/marking-criteria`, { method: 'PUT', body: JSON.stringify({ expected_points, accepted_variants, marking_notes: notes }) })
      onSaved(updated); setMessage('Criteria saved.')
    } catch (error) { setMessage(errorText(error)) } finally { setBusy(false) }
  }
  return <details className="criteria-editor"><summary>Marking criteria {question.expected_points?.length ? 'configured' : 'not configured'}</summary><div className="criteria-editor-body">
    {rows.map((row, index) => <div className="criteria-row" key={index}><input aria-label={`Expected point ${index + 1}`} value={row.point} onChange={e => setRows(current => current.map((value, i) => i === index ? { ...value, point: e.target.value } : value))} placeholder="Expected point"/><input aria-label={`Accepted variants ${index + 1}`} value={row.variants} onChange={e => setRows(current => current.map((value, i) => i === index ? { ...value, variants: e.target.value } : value))} placeholder="Accepted variants separated by |"/><button type="button" className="text-button" onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Remove</button></div>)}
    <button type="button" className="text-button" onClick={() => setRows(current => [...current, { point: '', variants: '' }])}><Plus size={12}/> Add expected point</button>
    <label className="module-field"><span>Marking notes</span><textarea rows={2} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)}/></label>
    <div className="criteria-save"><span>{message}</span><button type="button" className="small-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save criteria'}</button></div>
  </div></details>
}
