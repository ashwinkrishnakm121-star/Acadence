import { useEffect, useState } from 'react'
import { Activity, ArrowDownRight, ArrowUpRight, BookOpen, CalendarDays, CheckCircle2, ClipboardList, GraduationCap, LayoutDashboard, LoaderCircle, PanelLeftClose, PanelLeftOpen, Settings2, ShieldCheck, Users, Workflow } from 'lucide-react'
import ModuleWorkspace from './ModuleWorkspace'

type User = { id: number; username: string; display_name: string; role: string; active: boolean; capabilities: string[] }
type School = { id: number; name: string; academic_year: string; working_days: string[]; periods_per_day: number; settings: Record<string, unknown> }
type AuditEvent = { id: number; action: string; record_type: string; record_id: string; details: string; created_at: string }
type Section = 'Overview' | 'School settings' | 'Users & capabilities' | 'Activity' | 'Timetable generation' | 'Assessment Studio' | 'Academic Planner' | 'Examination evaluation' | 'Academic coordination'

const navigation: { label: Section; icon: typeof LayoutDashboard; capability?: string }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'School settings', icon: Settings2, capability: 'school:read' },
  { label: 'Users & capabilities', icon: Users, capability: 'users:read' },
  { label: 'Activity', icon: Activity, capability: 'audit:read' },
]
const academicModules: { name: Section; icon: typeof CalendarDays; required: string[]; anyOf: string[] }[] = [
  { name: 'Timetable generation', icon: CalendarDays, required: ['school:read'], anyOf: ['timetable:write', 'timetable:review'] },
  { name: 'Assessment Studio', icon: ClipboardList, required: ['school:read'], anyOf: ['assessments:write', 'assessments:review'] },
  { name: 'Academic Planner', icon: BookOpen, required: [], anyOf: ['planner:write', 'planner:review'] },
  { name: 'Examination evaluation', icon: CheckCircle2, required: [], anyOf: ['assessments:write', 'assessments:review'] },
  { name: 'Academic coordination', icon: Workflow, required: ['tasks:read'], anyOf: ['tasks:read'] },
]
const knownCapabilities = ['school:read', 'school:write', 'users:read', 'users:write', 'audit:read', 'assessments:write', 'assessments:review', 'timetable:write', 'timetable:review', 'timetable:publish', 'planner:write', 'planner:review', 'tasks:read', 'tasks:write', 'tasks:manage_all']

export default function App() {
  const [users, setUsers] = useState<User[]>([])
  const [userName, setUserName] = useState(localStorage.getItem('acadence-demo-user') || 'admin')
  const [school, setSchool] = useState<School | null>(null)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [workflowRecords, setWorkflowRecords] = useState<{ assessments: { status: string }[]; timetables: { status: string }[]; requirements: { status: string }[]; tasks: { status: string }[]; evaluations: { status: string }[] }>({ assessments: [], timetables: [], requirements: [], tasks: [], evaluations: [] })
  const [section, setSection] = useState<Section>('Overview')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [health, setHealth] = useState<'loading' | 'ok' | 'error'>('loading')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  async function request<T>(path: string, init: RequestInit = {}, identity = userName): Promise<T> {
    const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Demo-User': identity, ...init.headers } })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(body?.detail || `Request failed (${response.status})`)
    }
    return response.json() as Promise<T>
  }

  async function refresh(identity = userName) {
    setError('')
    try {
      const [dbHealth, account, config] = await Promise.all([
        fetch('/api/health').then(async r => { if (!r.ok) throw new Error('Backend health check failed'); return r.json() }),
        request<User[]>('/api/users', {}, identity),
        request<School>('/api/school', {}, identity),
      ])
      setHealth(dbHealth.status === 'ok' ? 'ok' : 'error')
      setUsers(account); setSchool(config)
      const [assessmentRows, timetableRows, requirementRows, taskRows, evaluationRows] = await Promise.allSettled([
        request<{ status: string }[]>('/api/assessments', {}, identity), request<{ status: string }[]>('/api/timetables', {}, identity),
        request<{ status: string }[]>('/api/planner/requirements', {}, identity), request<{ status: string }[]>('/api/tasks', {}, identity),
        request<{ status: string }[]>('/api/evaluations', {}, identity),
      ])
      setWorkflowRecords({
        assessments: assessmentRows.status === 'fulfilled' ? assessmentRows.value : [],
        timetables: timetableRows.status === 'fulfilled' ? timetableRows.value : [],
        requirements: requirementRows.status === 'fulfilled' ? requirementRows.value : [],
        tasks: taskRows.status === 'fulfilled' ? taskRows.value : [],
        evaluations: evaluationRows.status === 'fulfilled' ? evaluationRows.value : [],
      })
      if (identity && account.some(user => user.username === identity && user.capabilities.includes('audit:read'))) {
        setEvents(await request<AuditEvent[]>('/api/audit', {}, identity))
      } else setEvents([])
    } catch (e) {
      setHealth('error')
      setError(e instanceof Error ? e.message : 'Could not connect to Acadence.')
    }
  }

  useEffect(() => { void refresh() }, [])
  useEffect(() => { localStorage.setItem('acadence-demo-user', userName); if (users.length) void refresh(userName) }, [userName])

  async function saveSettings(data: School) {
    setSaving(true); setNotice(''); setError('')
    try { const updated = await request<School>('/api/school', { method: 'PUT', body: JSON.stringify(data) }); setSchool(updated); setNotice('School settings saved.') ; await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Settings could not be saved.') }
    finally { setSaving(false) }
  }

  async function saveUser(user: User) {
    setSaving(true); setNotice(''); setError('')
    try { await request<User>(`/api/users/${user.id}/capabilities`, { method: 'PUT', body: JSON.stringify({ capabilities: user.capabilities, active: user.active }) }); setNotice(`Capabilities updated for ${user.display_name}.`); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Capabilities could not be saved.') }
    finally { setSaving(false) }
  }

  async function createUser(payload: { username: string; display_name: string; role: string }) {
    setSaving(true); setNotice(''); setError('')
    try { await request<User>('/api/users', { method: 'POST', body: JSON.stringify({ ...payload, capabilities: [] }) }); setNotice(`Demo account ${payload.username} provisioned. Assign capabilities before using protected features.`); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Demo account could not be provisioned.') }
    finally { setSaving(false) }
  }

  const currentUser = users.find(user => user.username === userName)
  const can = (capability: string) => Boolean(currentUser?.capabilities.includes(capability))
  const canAccess = (capabilities: string[]) => capabilities.some(capability => can(capability))
  const availableModules = academicModules.filter(item => item.required.every(can) && canAccess(item.anyOf))
  const availableNavigation = navigation.filter(item => !item.capability || can(item.capability))
  const sectionIsAvailable = (target: Section) => target === 'Overview'
    || availableNavigation.some(item => item.label === target)
    || availableModules.some(item => item.name === target)
  const visibleSection = sectionIsAvailable(section) ? section : 'Overview'
  const sectionTitle: Record<Section, string> = { Overview: 'Academic overview', 'School settings': 'School settings', 'Users & capabilities': 'Users & capabilities', Activity: 'Activity log', 'Timetable generation': 'Timetable generation', 'Assessment Studio': 'Assessment Studio', 'Academic Planner': 'Academic Planner', 'Examination evaluation': 'Examination evaluation', 'Academic coordination': 'Academic coordination' }
  const sectionDescription: Record<Section, string> = { Overview: 'Your school’s academic operations, at a glance.', 'School settings': 'Academic configuration shared across workflows.', 'Users & capabilities': 'Provision demo accounts and assign backend capabilities.', Activity: 'Audit events for important shared platform changes.', 'Timetable generation': 'Create, validate, review and publish class schedules.', 'Assessment Studio': 'Build and review examination papers from the question bank.', 'Academic Planner': 'Collect and review documented academic requirements.', 'Examination evaluation': 'Enter answers, review mark suggestions and confirm teacher marks.', 'Academic coordination': 'Manage tasks linked to academic workflows.' }

  return <div className={`app-frame ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><GraduationCap size={22}/></div><div className="brand-copy"><strong>acadence</strong><span>ACADEMIC WORKFLOW</span></div><button type="button" className="sidebar-toggle" aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(value => !value)} title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>{sidebarOpen ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}</button></div>
      <div className="school-switch" aria-label="Current school"><div className="school-avatar">{school?.name?.slice(0, 1) || 'A'}</div><div className="school-name"><b>{school?.name || 'Acadence School'}</b><small>{school?.academic_year || 'Academic year'}</small></div></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav aria-label="Workspace">{availableNavigation.map(item => <button title={item.label} aria-current={visibleSection === item.label ? 'page' : undefined} className={`nav-item ${visibleSection === item.label ? 'active' : ''}`} key={item.label} onClick={() => setSection(item.label)}><item.icon size={17}/><span>{item.label}</span>{visibleSection === item.label && <span className="active-dot"/>}</button>)}</nav>
      {availableModules.length > 0 && <><div className="nav-caption modules-caption">ACADEMIC MODULES</div>
      <div className="module-list" aria-label="Academic modules">{availableModules.map(item => <button title={item.name} aria-current={visibleSection === item.name ? 'page' : undefined} className={`module-item ${visibleSection === item.name ? 'selected' : ''}`} key={item.name} onClick={() => setSection(item.name)}><item.icon size={16}/><span>{item.name}</span></button>)}</div></>}
      <div className="sidebar-bottom"><div className="user-mini"><div className="avatar">{currentUser?.display_name?.slice(0, 1) || '…'}</div><div><b>{currentUser?.display_name || 'Loading user'}</b><small>{currentUser?.role || 'Demo account'}</small></div><ShieldCheck size={16}/></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">Acadence <span>/</span> {visibleSection}</div><div className="topbar-right"><div className={`system-pill ${health}`} role="status"><i aria-hidden="true"/>{health === 'ok' ? 'All systems operational' : health === 'loading' ? 'Connecting' : 'Backend unavailable'}</div><div className="topbar-divider"/><label className="user-select-label" htmlFor="demo-user">DEMO USER</label><select id="demo-user" value={userName} onChange={e => { setSection('Overview'); setUserName(e.target.value) }} aria-label="Select demo user">{users.map(user => <option key={user.id} value={user.username}>{user.display_name}</option>)}</select><div className="avatar top-avatar" aria-hidden="true">{currentUser?.display_name?.slice(0, 1) || 'A'}</div></div></header>
      <div className="page-content">
        <div className="page-heading"><div><div className="eyebrow">{school?.academic_year || 'ACADEMIC YEAR'}</div><h1>{sectionTitle[visibleSection]}</h1><p>{sectionDescription[visibleSection]}</p></div></div>
        {(error || notice) && <div className={`feedback ${error ? 'feedback-error' : 'feedback-success'}`} role="status" aria-live="polite">{error || notice}<button onClick={() => { setError(''); setNotice('') }}>Dismiss</button></div>}
        {health === 'loading' && <div className="loading-line"><LoaderCircle className="spin" size={16}/> Connecting to the Acadence backend…</div>}
        {visibleSection === 'Overview' && <Overview school={school} users={users} events={events} health={health} workflows={workflowRecords} modules={availableModules} showSchool={can('school:read')} showUsers={can('users:read')} showAudit={can('audit:read')} onRefresh={() => void refresh()} onNavigate={setSection}/>}
        {visibleSection === 'School settings' && school && <SchoolSettings school={school} canEdit={can('school:write')} saving={saving} onSave={saveSettings}/>}
        {visibleSection === 'Users & capabilities' && <UserManagement users={users} canEdit={can('users:write')} saving={saving} onSave={saveUser} onCreate={createUser}/>}
        {visibleSection === 'Activity' && <ActivityView events={events} allowed={can('audit:read')}/>}
        {['Timetable generation', 'Assessment Studio', 'Academic Planner', 'Examination evaluation', 'Academic coordination'].includes(visibleSection) && currentUser && <ModuleWorkspace section={visibleSection} user={currentUser} request={request} onRefresh={() => refresh()}/>}
      </div>
    </main>
  </div>
}

function Overview({ school, users, events, health, workflows, modules, showSchool, showUsers, showAudit, onRefresh, onNavigate }: { school: School | null; users: User[]; events: AuditEvent[]; health: string; workflows: { assessments: { status: string }[]; timetables: { status: string }[]; requirements: { status: string }[]; tasks: { status: string }[]; evaluations: { status: string }[] }; modules: typeof academicModules; showSchool: boolean; showUsers: boolean; showAudit: boolean; onRefresh: () => void; onNavigate: (section: Section) => void }) {
  const days = school?.working_days.length || 0
  const workflowState: Record<string, { count: number; statuses: string[] }> = {
    'Timetable generation': { count: workflows.timetables.length, statuses: workflows.timetables.slice(0, 2).map(row => row.status.replaceAll('_', ' ')) },
    'Assessment Studio': { count: workflows.assessments.length, statuses: workflows.assessments.slice(0, 2).map(row => row.status.replaceAll('_', ' ')) },
    'Academic Planner': { count: workflows.requirements.length, statuses: workflows.requirements.slice(0, 2).map(row => row.status.replaceAll('_', ' ')) },
    'Academic coordination': { count: workflows.tasks.length, statuses: workflows.tasks.slice(0, 2).map(row => row.status.replaceAll('_', ' ')) },
    'Examination evaluation': { count: workflows.evaluations.length, statuses: workflows.evaluations.slice(0, 2).map(row => row.status.replaceAll('_', ' ')) },
  }
  return <>
    <div className="metric-grid" style={{ gridTemplateColumns: `repeat(${(showSchool ? 2 : 0) + (showUsers ? 1 : 0) + (showAudit ? 1 : 0)}, minmax(0, 1fr))` }}>{showSchool && <><Metric icon={CalendarDays} label="Working days" value={`${days}`} foot="Configured for this school" tone="blue"/><Metric icon={ClipboardList} label="Periods per day" value={`${school?.periods_per_day ?? '—'}`} foot="Academic structure" tone="violet"/></>}{showUsers && <Metric icon={Users} label="Demo users" value={`${users.length}`} foot="Shared access model" tone="green"/>}{showAudit && <Metric icon={Activity} label="Audit records" value={`${events.length}`} foot="Recent tracked actions" tone="orange"/>}</div>
    <div className="overview-grid">{showSchool && <section className="panel config-panel"><div className="panel-heading"><div><h2>School configuration</h2><p>Shared academic settings for the demonstration school.</p></div><button className="text-button" onClick={onRefresh}>Refresh data <ArrowUpRight size={14}/></button></div>{school ? <div className="config-details"><div className="config-row"><span>School</span><b>{school.name}</b></div><div className="config-row"><span>Academic year</span><b>{school.academic_year}</b></div><div className="config-row"><span>Working days</span><b className="day-list">{school.working_days.join(' · ')}</b></div><div className="config-row"><span>Periods per day</span><b>{school.periods_per_day}</b></div></div> : <EmptyState text="School settings are unavailable."/>}</section>}
      {showAudit && <section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Changes recorded in the shared audit trail.</p></div><button className="icon-button" onClick={onRefresh} title="Refresh activity"><ArrowDownRight size={16}/></button></div>{events.length ? <div className="event-list">{events.slice(0, 4).map(event => <div className="event-row" key={event.id}><div className="event-icon"><Activity size={15}/></div><div className="event-text"><b>{event.action.replaceAll('.', ' ')}</b><span>{event.record_type} #{event.record_id}</span></div><time>{new Date(event.created_at).toLocaleDateString()}</time></div>)}</div> : <EmptyState text={health === 'ok' ? 'No recorded changes yet.' : 'Connect to the backend to load activity.'}/>}</section>}</div>
    {modules.length > 0 && <section className="panel modules-panel"><div className="panel-heading"><div><h2>Academic workflows</h2><p>Open a workflow to review its current records and status.</p></div><span className="module-count">{modules.length} AREAS</span></div><div className="workflow-grid">{modules.map(item => { const state = workflowState[item.name]; return <button className="workflow-card" key={item.name} onClick={() => onNavigate(item.name)}><div className="workflow-icon"><item.icon size={18}/></div><div className="workflow-copy"><b>{item.name}</b><span>{state.count ? `${state.count} record(s) · ${state.statuses.join(', ')}` : 'No records yet'}</span></div><span className="workflow-open">Open</span></button>})}</div></section>}
    <div className="foundation-note"><div className="note-icon"><CheckCircle2 size={17}/></div><div><b>Shared foundation is ready</b><span>School settings, demo accounts and capability checks are connected to the live database.</span></div><span className={`note-status ${health}`}>{health === 'ok' ? 'CONNECTED' : 'CHECK SERVER'}</span></div>
  </>
}

function Metric({ icon: Icon, label, value, foot, tone }: { icon: typeof Activity; label: string; value: string; foot: string; tone: string }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={17}/></div><span className="metric-label">{label}</span><strong>{value}</strong><small>{foot}</small></div>
}

function SchoolSettings({ school, canEdit, saving, onSave }: { school: School; canEdit: boolean; saving: boolean; onSave: (value: School) => void }) {
  const [form, setForm] = useState(school)
  useEffect(() => setForm(school), [school])
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  function toggleDay(day: string) { setForm(value => ({ ...value, working_days: value.working_days.includes(day) ? value.working_days.filter(d => d !== day) : weekdays.filter(d => value.working_days.includes(d) || d === day) })) }
  return <section className="panel form-panel"><div className="panel-heading"><div><h2>Academic configuration</h2><p>These settings are shared across Acadence workflows.</p></div><span className="permission-tag">{canEdit ? 'EDIT ACCESS' : 'READ ONLY'}</span></div><div className="form-grid"><Field label="School name"><input disabled={!canEdit} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field><Field label="Academic year"><input disabled={!canEdit} value={form.academic_year} onChange={e => setForm({ ...form, academic_year: e.target.value })}/></Field><Field label="Periods per day"><input type="number" min={1} max={12} disabled={!canEdit} value={form.periods_per_day} onChange={e => setForm({ ...form, periods_per_day: Number(e.target.value) })}/></Field><div className="field full-field"><label>Working days</label><div className="day-pills">{weekdays.map(day => <button type="button" disabled={!canEdit} className={form.working_days.includes(day) ? 'selected' : ''} key={day} onClick={() => toggleDay(day)}>{day.slice(0, 3)}</button>)}</div></div></div>{canEdit && <div className="form-actions"><span>Updates are saved to the shared school record.</span><button className="primary-button" disabled={saving || !form.name.trim() || !form.working_days.length || form.periods_per_day < 1 || form.periods_per_day > 12} onClick={() => onSave(form)}>{saving && <LoaderCircle size={15} className="spin"/>}{saving ? 'Saving…' : 'Save settings'}</button></div>}</section>
}

function UserManagement({ users, canEdit, saving, onSave, onCreate }: { users: User[]; canEdit: boolean; saving: boolean; onSave: (user: User) => void; onCreate: (payload: { username: string; display_name: string; role: string }) => void }) {
  const [drafts, setDrafts] = useState<Record<number, User>>({})
  const [newUser, setNewUser] = useState({ username: '', display_name: '', role: 'Teacher' })
  useEffect(() => setDrafts(Object.fromEntries(users.map(user => [user.id, user]))), [users])
  function toggle(user: User, capability: string) { const next = drafts[user.id] || user; const capabilities = next.capabilities.includes(capability) ? next.capabilities.filter(c => c !== capability) : [...next.capabilities, capability]; setDrafts({ ...drafts, [user.id]: { ...next, capabilities } }) }
  return <div className="user-cards">{canEdit && <section className="panel user-card provision-card"><div className="panel-heading"><div><h2>Provision demo account</h2><p>Create a shared account, then grant only its required capabilities.</p></div></div><form className="module-form-grid" onSubmit={e => { e.preventDefault(); onCreate(newUser); setNewUser({ username: '', display_name: '', role: 'Teacher' }) }}><Field label="Display name"><input required value={newUser.display_name} onChange={e => setNewUser({ ...newUser, display_name: e.target.value })}/></Field><Field label="Username"><input required pattern="[A-Za-z0-9._-]+" minLength={2} value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })}/></Field><Field label="Role"><select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}><option>Teacher</option><option>Academic Reviewer</option><option>Super Admin</option></select></Field><div className="module-full form-action-row"><span>New accounts start with no capabilities.</span><button className="primary-button" disabled={saving}>Create account</button></div></form></section>}{users.map(user => { const draft = drafts[user.id] || user; const dirty = JSON.stringify(draft.capabilities) !== JSON.stringify(user.capabilities) || draft.active !== user.active; return <section className="panel user-card" key={user.id}><div className="user-card-heading"><div className="avatar user-card-avatar">{user.display_name.slice(0, 1)}</div><div className="user-ident"><b>{user.display_name}</b><span>@{user.username}</span></div><span className="role-pill">{user.role}</span></div><div className="capability-title">CAPABILITIES</div><div className="capability-list">{knownCapabilities.map(cap => <label className={`capability-option ${draft.capabilities.includes(cap) ? 'checked' : ''}`} key={cap}><input type="checkbox" disabled={!canEdit} checked={draft.capabilities.includes(cap)} onChange={() => toggle(user, cap)}/><span>{cap}</span></label>)}</div>{!canEdit ? <div className="readonly-note">Your account has read-only access to demo capabilities.</div> : <div className="user-card-actions"><label className="active-toggle"><input type="checkbox" checked={draft.active} onChange={e => setDrafts({ ...drafts, [user.id]: { ...draft, active: e.target.checked } })}/> Account active</label><button className="small-primary" disabled={!dirty || saving} onClick={() => onSave(draft)}>{saving ? 'Saving…' : 'Save changes'}</button></div>}</section>})}</div>
}

function ActivityView({ events, allowed }: { events: AuditEvent[]; allowed: boolean }) {
  if (!allowed) return <section className="panel access-panel"><ShieldCheck size={22}/><h2>Activity is restricted</h2><p>The selected demo account does not have permission to view audit records.</p></section>
  return <section className="panel activity-table-panel"><div className="panel-heading"><div><h2>Audit records</h2><p>Important shared platform changes, recorded with an actor and timestamp.</p></div><span className="module-count">{events.length} RECORDS</span></div>{events.length ? <div className="table-wrap"><table><thead><tr><th>Action</th><th>Record</th><th>Details</th><th>Timestamp</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td><span className="action-pill">{event.action}</span></td><td>{event.record_type} #{event.record_id}</td><td>{event.details || '—'}</td><td>{new Date(event.created_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState text="No audit events have been recorded yet."/>}</section>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }
function EmptyState({ text }: { text: string }) { return <div className="empty-state">{text}</div> }
