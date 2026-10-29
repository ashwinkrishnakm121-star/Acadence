import { useEffect, useState } from 'react'
import { Activity, ArrowDownRight, ArrowUpRight, BookOpen, CalendarDays, CheckCircle2, ClipboardList, GraduationCap, LayoutDashboard, LoaderCircle, PanelLeftClose, PanelLeftOpen, Settings2, ShieldCheck, Users, Workflow } from 'lucide-react'
import ModuleWorkspace from './ModuleWorkspace'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const resolveApiPath = (path: string) => `${API_BASE}${path}` || path

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
    const response = await fetch(resolveApiPath(path), { ...init, headers: { 'Content-Type': 'application/json', 'X-Demo-User': identity, ...init.headers } })
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
        fetch(resolveApiPath('/api/health')).then(async r => { if (!r.ok) throw new Error('Backend health check failed'); return r.json() }),
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
    try { await request<User>(`/api/users/${user.id}/capabilities`, { method: 'PUT', body: JSON.stringify({ capabilities: user.capabilities, active: user.active }) }); setNotice(`Capabilities updated for ${user.username}.`) ; await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Capabilities could not be saved.') }
    finally { setSaving(false) }
  }

  async function createUser(payload: { username: string; display_name: string; role: string }) {
    setSaving(true); setNotice(''); setError('')
    try { await request<User>('/api/users', { method: 'POST', body: JSON.stringify({ ...payload, capabilities: [] }) }); setNotice(`Demo account ${payload.username} provisioned. Assign capabilities and sign in with it.`) ; await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Demo account could not be provisioned.') }
    finally { setSaving(false) }
  }

  const currentUser = users.find(user => user.username === userName)
  const can = (capability: string) => Boolean(currentUser?.capabilities.includes(capability))
  const canAccess = (capabilities: string[]) => capabilities.some(capability => can(capability))
  const availableModules = academicModules.filter(item => item.required.every(can) && canAccess(item.anyOf))
  const availableNavigation = navigation.filter(item => !item.capability || can(item.capability))
  const platformNavigation = availableNavigation.filter(item => item.label === 'Overview')
  const adminNavigation = availableNavigation.filter(item => item.label !== 'Overview')
  const sectionIsAvailable = (target: Section) => target === 'Overview'
    || availableNavigation.some(item => item.label === target)
    || availableModules.some(item => item.name === target)
  const visibleSection = sectionIsAvailable(section) ? section : 'Overview'
  const sectionTitle: Record<Section, string> = { Overview: 'Academic overview', 'School settings': 'School settings', 'Users & capabilities': 'Users & capabilities', Activity: 'Activity log', 'Timetable generation': 'Timetable generation', 'Assessment Studio': 'Assessment Studio', 'Academic Planner': 'Academic Planner', 'Examination evaluation': 'Examination evaluation', 'Academic coordination': 'Academic coordination' }
  const sectionDescription: Record<Section, string> = { Overview: 'Your school’s academic operations, at a glance.', 'School settings': 'Academic configuration shared across workflows.', 'Users & capabilities': 'Manage demo accounts, roles, and role-based permissions.', Activity: 'Track important actions recorded across the platform.', 'Timetable generation': 'Create and review timetables with validation and publication controls.', 'Assessment Studio': 'Configure assessments, questions, and approved exam blueprints.', 'Academic Planner': 'Track and coordinate academic plans and requirements.', 'Examination evaluation': 'Review answers and approved marks within the evaluation workflow.', 'Academic coordination': 'Manage task coordination and operational follow-ups.' }

  return <div className={`app-frame ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><GraduationCap size={22}/></div><div className="brand-copy"><strong>acadence</strong><span>ACADEMIC WORKFLOW</span></div><button type="button" className="collapse-button" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle sidebar">{sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button></div>
      <div className="school-switch" aria-label="Current school"><div className="school-avatar">{school?.name?.slice(0, 1) || 'A'}</div><div className="school-name"><b>{school?.name || 'Acadence'}</b><span>{school?.academic_year || 'Academic year'}</span></div></div>
      <div className="nav-caption">PLATFORM</div>
      <nav aria-label="Platform">{platformNavigation.map(item => <button key={item.label} title={item.label} aria-current={visibleSection === item.label ? 'page' : undefined} className={`nav-item ${visibleSection === item.label ? 'active' : ''}`} onClick={() => setSection(item.label)}><item.icon size={16} /> <span>{item.label}</span></button>)}</nav>
      {availableModules.length > 0 && <><div className="nav-caption modules-caption">WORKFLOWS</div><div className="module-list" aria-label="Workflows">{availableModules.map(item => <button key={item.name} title={item.name} aria-current={visibleSection === item.name ? 'page' : undefined} className={`module-item ${visibleSection === item.name ? 'active' : ''}`} onClick={() => setSection(item.name)}><item.icon size={15} /><span>{item.name}</span></button>)}</div></>}
      {adminNavigation.length > 0 && <><div className="nav-caption modules-caption">ADMIN</div><nav aria-label="Administration">{adminNavigation.map(item => <button key={item.label} title={item.label} aria-current={visibleSection === item.label ? 'page' : undefined} className={`nav-item ${visibleSection === item.label ? 'active' : ''}`} onClick={() => setSection(item.label)}><item.icon size={16} /><span>{item.label}</span></button>)}</nav></>}
      <div className="sidebar-bottom"><div className="user-mini"><div className="avatar">{currentUser?.display_name?.slice(0, 1) || '…'}</div><div><b>{currentUser?.display_name || 'Loading user'}</b><span>{currentUser?.role || 'Demo account'}</span></div></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">{visibleSection}</div><div className="topbar-right"><div className="school-top-context">{school && <><span className="school-top-name">{school.name}</span><span className="school-top-year">{school.academic_year}</span></>}</div><div className="user-selector"><label htmlFor="demo-user">User</label><select id="demo-user" value={userName} onChange={event => setUserName(event.target.value)}>{users.map(user => <option key={user.id} value={user.username}>{user.display_name}</option>)}</select></div></div></header>
      <div className="page-content">
        <div className="page-heading"><div><div className="eyebrow">{school?.academic_year || 'ACADEMIC YEAR'}</div><h1>{sectionTitle[visibleSection]}</h1><p>{sectionDescription[visibleSection]}</p></div></div>
        {(error || notice) && <div className={`feedback ${error ? 'feedback-error' : 'feedback-success'}`} role="status" aria-live="polite">{error || notice}<button onClick={() => { setError(''); setNotice('') }}>Dismiss</button></div>}
        {health === 'loading' && <div className="loading-line"><LoaderCircle className="spin" size={16}/> Connecting to the Acadence backend…</div>}
        {visibleSection === 'Overview' && <Overview school={school} users={users} events={events} health={health} workflows={workflowRecords} modules={availableModules} showSchool={can('school:read')} showUsers={can('users:read')} showAudit={can('audit:read')} onRefresh={() => void refresh()} onNavigate={setSection} />}
        {visibleSection === 'School settings' && school && <SchoolSettings school={school} canEdit={can('school:write')} saving={saving} onSave={saveSettings} />}
        {visibleSection === 'Users & capabilities' && <UserManagement users={users} canEdit={can('users:write')} saving={saving} onSave={saveUser} onCreate={createUser} />}
        {visibleSection === 'Activity' && <ActivityView events={events} allowed={can('audit:read')} />}
        {['Timetable generation', 'Assessment Studio', 'Academic Planner', 'Examination evaluation', 'Academic coordination'].includes(visibleSection) && currentUser && <ModuleWorkspace section={visibleSection} user={currentUser} request={request} onRefresh={() => void refresh()} />}
      </div>
    </main>
  </div>
}

function Overview({ school, users, events, health, workflows, modules, showSchool, showUsers, showAudit, onRefresh, onNavigate }: { school: School | null; users: User[]; events: AuditEvent[]; health: 'loading' | 'ok' | 'error'; workflows: { assessments: { status: string }[]; timetables: { status: string }[]; requirements: { status: string }[]; tasks: { status: string }[]; evaluations: { status: string }[] }; modules: { name: Section; icon: typeof CalendarDays; required: string[]; anyOf: string[] }[]; showSchool: boolean; showUsers: boolean; showAudit: boolean; onRefresh: () => void; onNavigate: (section: Section) => void }) {
  const days = school?.working_days.length || 0
  const workflowState: Record<string, { count: number; statuses: string[] }> = {
    'Timetable generation': { count: workflows.timetables.length, statuses: workflows.timetables.slice(0, 2).map(row => row.status.replaceAll('_', ' ')) },
    'Assessment Studio': { count: workflows.assessments.length, statuses: workflows.assessments.slice(0, 2).map(row => row.status.replaceAll('_', ' ')) },
    'Academic Planner': { count: workflows.requirements.length, statuses: workflows.requirements.slice(0, 2).map(row => row.status.replaceAll('_', ' ')) },
    'Academic coordination': { count: workflows.tasks.length, statuses: workflows.tasks.slice(0, 2).map(row => row.status.replaceAll('_', ' ')) },
    'Examination evaluation': { count: workflows.evaluations.length, statuses: workflows.evaluations.slice(0, 2).map(row => row.status.replaceAll('_', ' ')) },
  }
  return <>
    <div className="metric-grid" style={{ gridTemplateColumns: `repeat(${(showSchool ? 2 : 0) + (showUsers ? 1 : 0) + (showAudit ? 1 : 0)}, minmax(0, 1fr))` }}>{showSchool && <><Metric icon={CalendarDays} label="School calendar" value={`${days} days`} foot="Working days configured" tone="blue" /><Metric icon={Users} label="Demo users" value={`${users.length}`} foot="Accounts seeded" tone="purple" /></>}{showUsers && <Metric icon={Users} label="Active accounts" value={`${users.filter(user => user.active).length}`} foot="Users enabled" tone="green" />}{showAudit && <Metric icon={Activity} label="Audit trail" value={`${events.length}`} foot="Recent events" tone="amber" />}</div>
    <div className="overview-grid">{showSchool && <section className="panel config-panel"><div className="panel-heading"><div><h2>School configuration</h2><p>Shared academic settings for the demo environment.</p></div><button className="link-button" onClick={() => onNavigate('School settings')}>Open</button></div><div className="config-summary"><div><span>School</span><strong>{school?.name || 'Acadence'}</strong></div><div><span>Academic year</span><strong>{school?.academic_year || '—'}</strong></div><div><span>Periods / day</span><strong>{school?.periods_per_day ?? 0}</strong></div></div></section>}{showAudit && <section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Changes recorded in the shared audit trail.</p></div><button className="link-button" onClick={() => onNavigate('Activity')}>View log</button></div>{events.length ? <ul className="activity-list">{events.slice(0, 4).map(event => <li key={event.id}><strong>{event.action}</strong><span>{event.details || event.record_type}</span><time>{new Date(event.created_at).toLocaleString()}</time></li>)}</ul> : <EmptyState text="No audit records available for this account." />}</section>}{modules.length > 0 && <section className="panel modules-panel"><div className="panel-heading"><div><h2>Academic workflows</h2><p>Open a workflow to review its current records and status.</p></div></div><div className="workflow-list">{modules.map(module => <button key={module.name} className="workflow-row" onClick={() => onNavigate(module.name)}><div className="workflow-icon"><module.icon size={16} /></div><div><strong>{module.name}</strong><span>{workflowState[module.name]?.count ?? 0} items</span></div><ArrowUpRight size={15} /></button>)}</div></section>}</div>
    <div className="foundation-note"><div className="note-icon"><CheckCircle2 size={17}/></div><div><b>Shared foundation is ready</b><span>School settings, demo accounts and capability checks are synced with the backend.</span></div><button className="link-button" onClick={onRefresh}>Refresh</button></div>
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
  return <section className="panel form-panel"><div className="panel-heading"><div><h2>Academic configuration</h2><p>These settings are shared across Acadence workflows.</p></div>{canEdit && <button className="primary-button" disabled={saving} onClick={() => onSave(form)}>{saving ? 'Saving…' : 'Save changes'}</button>}</div><div className="two-col"><div className="field-group"><label>School name<input value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))} /></label><label>Academic year<input value={form.academic_year} onChange={event => setForm(value => ({ ...value, academic_year: event.target.value }))} /></label><label>Periods per day<input type="number" min={1} max={12} value={form.periods_per_day} onChange={event => setForm(value => ({ ...value, periods_per_day: Number(event.target.value) }))} /></label></div><div className="field-group"><span className="sub-label">Working days</span><div className="chip-grid">{weekdays.map(day => <button key={day} type="button" className={`chip ${form.working_days.includes(day) ? 'selected' : ''}`} onClick={() => toggleDay(day)} disabled={!canEdit}>{day}</button>)}</div></div></div></section>
}

function UserManagement({ users, canEdit, saving, onSave, onCreate }: { users: User[]; canEdit: boolean; saving: boolean; onSave: (user: User) => void; onCreate: (payload: { username: string; display_name: string; role: string }) => void }) {
  const [drafts, setDrafts] = useState<Record<number, User>>({})
  const [newUser, setNewUser] = useState({ username: '', display_name: '', role: 'Teacher' })
  useEffect(() => setDrafts(Object.fromEntries(users.map(user => [user.id, user]))), [users])
  function toggle(user: User, capability: string) { const next = drafts[user.id] || user; const capabilities = next.capabilities.includes(capability) ? next.capabilities.filter(c => c !== capability) : [...next.capabilities, capability]; setDrafts(value => ({ ...value, [user.id]: { ...next, capabilities: [...new Set(capabilities)] } })) }
  return <div className="user-cards">{canEdit && <section className="panel user-card provision-card"><div className="panel-heading"><div><h2>Provision demo account</h2><p>Create a shared account, then assign capabilities.</p></div></div><div className="inline-form"><input placeholder="Username" value={newUser.username} onChange={event => setNewUser(value => ({ ...value, username: event.target.value }))} /><input placeholder="Display name" value={newUser.display_name} onChange={event => setNewUser(value => ({ ...value, display_name: event.target.value }))} /><select value={newUser.role} onChange={event => setNewUser(value => ({ ...value, role: event.target.value }))}><option>Teacher</option><option>Department head</option><option>Admin</option></select><button className="primary-button" disabled={saving || !newUser.username || !newUser.display_name} onClick={() => onCreate(newUser)}>{saving ? 'Creating…' : 'Create account'}</button></div></section>}{users.map(user => <section key={user.id} className="panel user-card"><div className="panel-heading"><div><h2>{user.display_name}</h2><p>@{user.username} · {user.role}</p></div><label className="toggle"><input type="checkbox" checked={Boolean(drafts[user.id]?.active ?? user.active)} onChange={() => setDrafts(value => ({ ...value, [user.id]: { ...user, active: !user.active } }))} /><span>Active</span></label></div><div className="capability-list">{['school:read', 'school:write', 'users:read', 'users:write', 'audit:read', 'assessments:write', 'assessments:review', 'timetable:write', 'timetable:review', 'planner:write', 'planner:review', 'tasks:read'].map(capability => <label key={capability} className="capability-pill"><input type="checkbox" checked={(drafts[user.id]?.capabilities ?? user.capabilities).includes(capability)} onChange={() => toggle(user, capability)} disabled={!canEdit} /><span>{capability}</span></label>)}</div>{canEdit && <button className="primary-button" disabled={saving} onClick={() => onSave(drafts[user.id] ?? user)}>{saving ? 'Saving…' : 'Save user'}</button>}</section>)}</div>
}

function ActivityView({ events, allowed }: { events: AuditEvent[]; allowed: boolean }) {
  if (!allowed) return <section className="panel access-panel"><ShieldCheck size={22}/><h2>Activity is restricted</h2><p>The selected demo account does not have permission to view audit records.</p></section>
  return <section className="panel activity-table-panel"><div className="panel-heading"><div><h2>Audit records</h2><p>Important shared platform changes, recorded with an actor and timestamp.</p></div></div>{events.length ? <table className="audit-table"><thead><tr><th>Action</th><th>Record</th><th>Details</th><th>Time</th></tr></thead><tbody>{events.slice(0, 20).map(event => <tr key={event.id}><td>{event.action}</td><td>{event.record_type}:{event.record_id}</td><td>{event.details}</td><td>{new Date(event.created_at).toLocaleString()}</td></tr>)}</tbody></table> : <EmptyState text="No audit events found." />}</section>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }
function EmptyState({ text }: { text: string }) { return <div className="empty-state">{text}</div> }

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
const knownCapabilities = ['school:read', 'school:write', 'users:read', 'users:write', 'audit:read', 'assessments:write', 'assessments:review', 'timetable:write', 'timetable:review', 'planner:write', 'planner:review', 'tasks:read']
