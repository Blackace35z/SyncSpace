import { useMemo, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCheck,
  Clock3,
  FolderKanban,
  ListTodo,
  Search,
  Shield,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react'
import type {
  Project,
  ReportsSummary,
  UserNotification,
  UserPreferences,
  WorkspaceMember,
} from '../services/api'

export type WorkspaceTask = {
  id: number
  projectId: number | null
  title: string
  description: string
  status: 'To Do' | 'In Progress' | 'Done'
  priority: 'High' | 'Medium' | 'Low'
  project: string
  dueDateISO: string | null
  assignee: { userId: number | null; name: string; initials: string; color: string }
  tags: string[]
}

type DashboardProps = {
  name: string
  assignedCount: number
  completedCount: number
  overdueCount: number
  projects: Project[]
  upcomingTasks: WorkspaceTask[]
  onCreateTask: () => void
  onCreateProject: () => void
  onOpenProject: (projectId: number) => void
  onOpenTask: (task: WorkspaceTask) => void
}

function formatDueDate(value: string | null): string {
  if (!value) return 'No due date'
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function pageTitle(eyebrow: string, title: string, description: string) {
  return (
    <header className="workspace-page-heading">
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="workspace-empty-state">
      <span><FolderKanban size={18} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  )
}

export function DashboardPage({
  name,
  assignedCount,
  completedCount,
  overdueCount,
  projects,
  upcomingTasks,
  onCreateTask,
  onCreateProject,
  onOpenProject,
  onOpenTask,
}: DashboardProps) {
  const completion = assignedCount ? Math.round(completedCount / assignedCount * 100) : 0
  const activeProjects = projects.filter((project) => !project.archived)
  const statusGroups = [
    { name: 'To Do', count: upcomingTasks.filter((task) => task.status === 'To Do').length },
    { name: 'In Progress', count: upcomingTasks.filter((task) => task.status === 'In Progress').length },
    { name: 'Done', count: upcomingTasks.filter((task) => task.status === 'Done').length },
  ]

  return (
    <div className="workspace-page dashboard-page">
      <section className="dashboard-welcome">
        <div>
          <span className="page-kicker">YOUR WORKSPACE, IN FOCUS</span>
          <h1>Good to have you here, {name.split(' ')[0]}.</h1>
          <p>A clear view of your work today and what is coming into focus next.</p>
        </div>
        <div className="dashboard-quick-actions">
          <button className="button button-secondary" type="button" onClick={onCreateProject}>
            <FolderKanban size={15} /> New project
          </button>
          <button className="button button-primary" type="button" onClick={onCreateTask}>
            <ListTodo size={15} /> New task
          </button>
        </div>
      </section>

      <section className="page-metrics" aria-label="Personal work summary">
        <article className="page-metric">
          <span><ListTodo size={17} /></span>
          <small>Assigned to me</small>
          <strong>{assignedCount}</strong>
          <em>Across this workspace</em>
        </article>
        <article className="page-metric">
          <span><CheckCheck size={17} /></span>
          <small>Completed</small>
          <strong>{completedCount}</strong>
          <em>{completion}% of your assigned tasks</em>
        </article>
        <article className="page-metric">
          <span><Clock3 size={17} /></span>
          <small>Overdue</small>
          <strong>{overdueCount}</strong>
          <em>Open tasks past their due date</em>
        </article>
        <article className="page-metric">
          <span><FolderKanban size={17} /></span>
          <small>Active projects</small>
          <strong>{activeProjects.length}</strong>
          <em>In your current workspace</em>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="page-panel dashboard-progress-panel">
          <div className="page-panel-heading">
            <div><span className="panel-kicker">PERSONAL PROGRESS</span><h2>Work at a glance</h2></div>
            <span className="progress-ring-label">{completion}%</span>
          </div>
          <div className="dashboard-progress-track" role="progressbar" aria-label="Personal task completion" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${completion}%` }} />
          </div>
          <div className="dashboard-status-breakdown">
            {statusGroups.map((group) => (
              <div key={group.name}><span>{group.name}</span><strong>{group.count}</strong></div>
            ))}
          </div>
          <p className="panel-footnote">Counts are based on tasks assigned to you.</p>
        </article>

        <article className="page-panel">
          <div className="page-panel-heading">
            <div><span className="panel-kicker">NEXT UP</span><h2>Upcoming tasks</h2></div>
            <CalendarDays size={18} aria-hidden="true" />
          </div>
          {upcomingTasks.length ? (
            <ul className="upcoming-task-list">
              {upcomingTasks.slice(0, 5).map((task) => (
                <li key={task.id}>
                  <button type="button" onClick={() => onOpenTask(task)}>
                    <span className="upcoming-task-copy"><strong>{task.title}</strong><small>{task.project}</small></span>
                    <span className="upcoming-task-date">{formatDueDate(task.dueDateISO)}</span>
                    <ArrowRight size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No upcoming deadlines" description="Tasks assigned to you with upcoming due dates will appear here." />
          )}
        </article>

        <article className="page-panel dashboard-project-panel">
          <div className="page-panel-heading">
            <div><span className="panel-kicker">WORKSPACE</span><h2>Recently created projects</h2></div>
          </div>
          {activeProjects.length ? (
            <div className="recent-project-list">
              {activeProjects.slice(0, 4).map((project) => (
                <button type="button" key={project.id} onClick={() => onOpenProject(project.id)}>
                  <span className="project-dot" style={{ backgroundColor: project.color }} />
                  <span><strong>{project.name}</strong><small>{project.description || 'No description yet'}</small></span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-inline"><span>No active projects yet.</span><button type="button" onClick={onCreateProject}>Create a project</button></div>
          )}
        </article>
      </section>
    </div>
  )
}

export function ProjectsPage({
  projects,
  tasks,
  search,
  onSearch,
  onCreate,
  onOpen,
}: {
  projects: Project[]
  tasks: WorkspaceTask[]
  search: string
  onSearch: (value: string) => void
  onCreate: () => void
  onOpen: (projectId: number) => void
}) {
  const visibleProjects = projects.filter((project) =>
    `${project.name} ${project.description}`.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <div className="workspace-page projects-page">
      <div className="page-heading-row">
        {pageTitle('PROJECT DIRECTORY', 'Projects', 'A dedicated view of the workspaces and projects you can access.')}
        <button className="button button-primary" type="button" onClick={onCreate}><FolderKanban size={15} /> Create project</button>
      </div>
      <div className="directory-toolbar">
        <label className="directory-search"><Search size={16} /><input aria-label="Search projects" placeholder="Search projects" value={search} onChange={(event) => onSearch(event.target.value)} /></label>
        <span>{visibleProjects.length} {visibleProjects.length === 1 ? 'project' : 'projects'}</span>
      </div>
      {visibleProjects.length ? (
        <div className="project-directory-grid">
          {visibleProjects.map((project) => {
            const projectTasks = tasks.filter((task) => task.projectId === project.id || (!task.projectId && task.project === project.name))
            const done = projectTasks.filter((task) => task.status === 'Done').length
            const percent = projectTasks.length ? Math.round(done / projectTasks.length * 100) : 0
            return (
              <button className="directory-project-card" type="button" key={project.id} onClick={() => onOpen(project.id)}>
                <span className="directory-project-mark" style={{ backgroundColor: project.color }}><FolderKanban size={18} /></span>
                <span className="directory-project-state">{project.archived ? 'Archived' : 'Active'}</span>
                <strong>{project.name}</strong>
                <span className="directory-project-description">{project.description || 'No project description has been added.'}</span>
                <span className="directory-project-stats"><span>{projectTasks.length} {projectTasks.length === 1 ? 'task' : 'tasks'}</span><span>{percent}% complete</span></span>
                <span className="directory-progress"><i style={{ width: `${percent}%` }} /></span>
              </button>
            )
          })}
        </div>
      ) : (
        <EmptyState title={search ? 'No matching projects' : 'No projects yet'} description={search ? 'Try a different project name.' : 'Create a project to give related tasks a dedicated home.'} />
      )}
    </div>
  )
}

export function CalendarPage({
  tasks,
  onOpenTask,
}: {
  tasks: WorkspaceTask[]
  onOpenTask: (task: WorkspaceTask) => void
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [projectFilter, setProjectFilter] = useState('all')
  const projects = [...new Set(tasks.map((task) => task.project))]
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(firstDay)
  start.setDate(1 - firstDay.getDay())
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
  const tasksByDay = useMemo(() => {
    const groups = new Map<string, WorkspaceTask[]>()
    tasks
      .filter((task) => task.dueDateISO && (projectFilter === 'all' || task.project === projectFilter))
      .forEach((task) => {
        const group = groups.get(task.dueDateISO!) ?? []
        group.push(task)
        groups.set(task.dueDateISO!, group)
      })
    return groups
  }, [projectFilter, tasks])
  const monthTasks = tasks.filter((task) => task.dueDateISO?.startsWith(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`))
  const monthName = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="workspace-page calendar-page">
      <div className="page-heading-row">
        {pageTitle('SCHEDULE', 'Calendar', 'Plan around real task due dates across this workspace.')}
        <label className="calendar-project-filter"><SlidersHorizontal size={15} /><span>Project</span><select aria-label="Filter calendar by project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">All projects</option>{projects.map((project) => <option key={project} value={project}>{project}</option>)}</select></label>
      </div>
      <div className="calendar-layout">
        <section className="page-panel calendar-panel" aria-label={monthName}>
          <div className="calendar-toolbar">
            <div><span className="panel-kicker">MONTH VIEW</span><h2>{monthName}</h2></div>
            <div className="calendar-nav"><button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><button type="button" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button><button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div>
          </div>
          <div className="calendar-grid">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
            {days.map((day) => {
              const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
              const dayTasks = tasksByDay.get(iso) ?? []
              const isToday = iso === new Date().toISOString().slice(0, 10)
              return (
                <div className={`calendar-day ${day.getMonth() !== month.getMonth() ? 'outside-month' : ''} ${isToday ? 'today' : ''}`} key={iso}>
                  <span>{day.getDate()}</span>
                  <div className="calendar-day-tasks">
                    {dayTasks.slice(0, 2).map((task) => <button key={task.id} type="button" title={`${task.title} · ${task.project}`} onClick={() => onOpenTask(task)}>{task.title}</button>)}
                    {dayTasks.length > 2 && <small>+{dayTasks.length - 2} more</small>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
        <aside className="page-panel calendar-agenda">
          <span className="panel-kicker">THIS MONTH</span>
          <h2>Due dates</h2>
          {monthTasks.length ? (
            <ul className="agenda-list">{[...monthTasks].sort((a, b) => (a.dueDateISO ?? '').localeCompare(b.dueDateISO ?? '')).map((task) => <li key={task.id}><button type="button" onClick={() => onOpenTask(task)}><span className="agenda-date">{formatDueDate(task.dueDateISO)}</span><strong>{task.title}</strong><small>{task.project} · {task.status}</small></button></li>)}</ul>
          ) : <EmptyState title="Nothing scheduled" description="Tasks with a due date in this month will appear here." />}
        </aside>
      </div>
      <p className="calendar-no-date-note">{tasks.filter((task) => !task.dueDateISO).length} tasks have no due date and are not placed on the calendar.</p>
    </div>
  )
}

export function TeamPage({
  members,
  tasks,
}: {
  members: WorkspaceMember[]
  tasks: WorkspaceTask[]
}) {
  const [query, setQuery] = useState('')
  const filtered = members.filter((member) => `${member.full_name} ${member.email}`.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="workspace-page team-page">
      {pageTitle('COLLABORATION', 'Team', 'People with membership in the currently selected workspace.')}
      <div className="directory-toolbar"><label className="directory-search"><Search size={16} /><input aria-label="Search team" placeholder="Search members" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span>{filtered.length} {filtered.length === 1 ? 'member' : 'members'}</span></div>
      <section className="page-panel team-table-panel">
        {filtered.length ? <div className="team-table-wrap"><table className="team-table"><thead><tr><th>Member</th><th>Role</th><th>Assigned tasks</th><th>In progress</th><th>Completed</th></tr></thead><tbody>{filtered.map((member) => {
          const assigned = tasks.filter((task) => task.assignee.userId === member.id)
          return <tr key={member.id}><td><span className="team-member-cell"><span className="avatar avatar-lavender">{member.full_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span><span><strong>{member.full_name}</strong><small>{member.email}</small></span></span></td><td><span className="role-pill">{member.role}</span></td><td>{assigned.length}</td><td>{assigned.filter((task) => task.status === 'In Progress').length}</td><td>{assigned.filter((task) => task.status === 'Done').length}</td></tr>
        })}</tbody></table></div> : <EmptyState title="No team members found" description="Workspace membership will appear here when people join." />}
      </section>
      <p className="page-note"><UserRound size={14} /> Membership and role changes are restricted to existing authorized workspace controls.</p>
    </div>
  )
}

export function ReportsPage({ data }: { data: ReportsSummary | null }) {
  const statusLabels: Record<string, string> = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' }
  const priorityLabels: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }
  if (!data) return <div className="workspace-page">{pageTitle('ANALYTICS', 'Reports', 'Workspace task and project totals, calculated from saved records.')}<EmptyState title="Reports unavailable" description="The report data could not be loaded. Refresh and try again." /></div>
  const highestStatus = Math.max(1, ...Object.values(data.by_status))
  const highestPriority = Math.max(1, ...Object.values(data.by_priority))
  return (
    <div className="workspace-page reports-page">
      {pageTitle('ANALYTICS', 'Reports', 'Workspace task distribution and project progress from persisted data.')}
      <section className="page-metrics report-metrics" aria-label="Workspace task metrics">
        <article className="page-metric"><span><ListTodo size={17} /></span><small>Total tasks</small><strong>{data.total_tasks}</strong><em>All workflow states</em></article>
        <article className="page-metric"><span><CheckCheck size={17} /></span><small>Completed</small><strong>{data.completed_tasks}</strong><em>Marked done</em></article>
        <article className="page-metric"><span><Clock3 size={17} /></span><small>Open tasks</small><strong>{data.open_tasks}</strong><em>Not yet completed</em></article>
        <article className="page-metric"><span><CalendarDays size={17} /></span><small>Overdue</small><strong>{data.overdue_tasks}</strong><em>Open and past due date</em></article>
      </section>
      <div className="reports-grid">
        <section className="page-panel report-chart-panel"><span className="panel-kicker">WORKFLOW</span><h2>Tasks by status</h2>{Object.entries(data.by_status).map(([key, value]) => <div className="report-bar-row" key={key}><span>{statusLabels[key] ?? key}</span><div className="report-bar"><i style={{ width: `${value / highestStatus * 100}%` }} /></div><strong>{value}</strong></div>)}</section>
        <section className="page-panel report-chart-panel"><span className="panel-kicker">PRIORITY</span><h2>Tasks by priority</h2>{Object.entries(data.by_priority).map(([key, value]) => <div className="report-bar-row" key={key}><span>{priorityLabels[key] ?? key}</span><div className="report-bar priority-report-bar"><i className={`priority-${key}`} style={{ width: `${value / highestPriority * 100}%` }} /></div><strong>{value}</strong></div>)}</section>
      </div>
      <section className="page-panel project-report-panel"><span className="panel-kicker">PROJECTS</span><h2>Progress by project</h2>{data.projects.length ? <div className="project-report-list">{data.projects.map((project) => {
        const percentage = project.total_tasks ? Math.round(project.completed_tasks / project.total_tasks * 100) : 0
        return <div className="project-report-row" key={project.id}><span><strong>{project.name}</strong><small>{project.completed_tasks} of {project.total_tasks} complete</small></span><div className="directory-progress"><i style={{ width: `${percentage}%` }} /></div><b>{percentage}%</b></div>
      })}</div> : <EmptyState title="No project data" description="Create projects and tasks to see progress reports." />}</section>
      <p className="page-note"><Clock3 size={14} /> Completion-over-time analytics are unavailable because the current task records do not store completion timestamps.</p>
    </div>
  )
}

export function NotificationsPage({
  notifications,
  inboxOnly,
  onRead,
  onReadAll,
  onOpen,
}: {
  notifications: UserNotification[]
  inboxOnly: boolean
  onRead: (notification: UserNotification, isRead: boolean) => void
  onReadAll: () => void
  onOpen: (notification: UserNotification) => void
}) {
  const unreadCount = notifications.filter((notification) => !notification.read_at).length
  return (
    <div className="workspace-page notifications-page">
      <div className="page-heading-row">
        {pageTitle(inboxOnly ? 'ACTION REQUIRED' : 'WORKSPACE UPDATES', inboxOnly ? 'Inbox' : 'Notifications', inboxOnly ? 'Review unread task assignments that need your attention.' : 'A history of task assignment notifications for your account.')}
        {!inboxOnly && unreadCount > 0 && <button className="button button-secondary" type="button" onClick={onReadAll}>Mark all read</button>}
      </div>
      <div className="feed-toolbar"><span>{inboxOnly ? `${unreadCount} unread` : `${notifications.length} notifications`}</span>{inboxOnly && unreadCount > 0 && <button type="button" onClick={onReadAll}>Mark all read</button>}</div>
      {notifications.length ? <div className="notification-feed">{notifications.map((notification) => <article className={`notification-item ${notification.read_at ? 'read' : 'unread'}`} key={notification.id}><span className="notification-mark"><ListTodo size={17} /></span><button className="notification-copy" type="button" onClick={() => onOpen(notification)}><strong>{notification.title}</strong><span>{notification.body}</span><small>{new Date(notification.created_at).toLocaleString()}</small></button><button className="notification-read-action" type="button" onClick={() => onRead(notification, !notification.read_at)}>{notification.read_at ? 'Mark unread' : 'Mark read'}</button></article>)}</div> : <EmptyState title={inboxOnly ? 'Your inbox is clear' : 'No notifications yet'} description={inboxOnly ? 'Unread task assignments will appear here.' : 'You will see an update when a task is assigned to you.'} />}
    </div>
  )
}

type SettingsProps = {
  fullName: string
  email: string
  preferences: UserPreferences | null
  onSaveProfile: (event: FormEvent<HTMLFormElement>, name: string, email: string) => Promise<void>
  onSavePreferences: (preferences: Pick<UserPreferences, 'theme' | 'email_notifications'>) => Promise<void>
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>
}

export function SettingsPage({
  fullName,
  email,
  preferences,
  onSaveProfile,
  onSavePreferences,
  onChangePassword,
}: SettingsProps) {
  const [name, setName] = useState(fullName)
  const [emailValue, setEmailValue] = useState(email)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingPreferences, setSavingPreferences] = useState(false)

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError('')
    setPasswordMessage('')
    setSavingPassword(true)
    try {
      await onChangePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setPasswordMessage('Password updated. Other active sessions have been signed out.')
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Could not update password.')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="workspace-page settings-page">
      {pageTitle('PREFERENCES', 'Settings', 'Manage your account, security, and SyncSpace appearance.')}
      <div className="settings-grid">
        <section className="page-panel settings-section">
          <div className="settings-section-heading"><span><UserRound size={17} /></span><div><h2>Profile</h2><p>Your account identity and contact email.</p></div></div>
          <form className="settings-form" onSubmit={(event) => void onSaveProfile(event, name, emailValue)}>
            <label className="form-field"><span>Full name</span><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="form-field"><span>Email address</span><input type="email" required maxLength={320} value={emailValue} onChange={(event) => setEmailValue(event.target.value)} /></label>
            <button className="button button-primary" type="submit">Save profile</button>
          </form>
        </section>
        <section className="page-panel settings-section">
          <div className="settings-section-heading"><span><SlidersHorizontal size={17} /></span><div><h2>Preferences</h2><p>These preferences are saved to your account.</p></div></div>
          {preferences ? <form className="settings-form" onSubmit={async (event) => {
            event.preventDefault()
            setSavingPreferences(true)
            try { await onSavePreferences(preferences) } finally { setSavingPreferences(false) }
          }}>
            <label className="form-field"><span>Appearance</span><select value={preferences.theme} onChange={(event) => void onSavePreferences({ ...preferences, theme: event.target.value as UserPreferences['theme'] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
            <label className="settings-toggle"><span><strong>Email notifications</strong><small>Preference is stored; delivery requires an email service.</small></span><input type="checkbox" checked={preferences.email_notifications} onChange={(event) => void onSavePreferences({ ...preferences, email_notifications: event.target.checked })} /></label>
            <button className="button button-secondary" type="submit" disabled={savingPreferences}>{savingPreferences ? 'Saving…' : 'Save preferences'}</button>
          </form> : <EmptyState title="Preferences unavailable" description="Reload the page to retrieve your saved preferences." />}
        </section>
        <section className="page-panel settings-section">
          <div className="settings-section-heading"><span><Shield size={17} /></span><div><h2>Security</h2><p>Change your password. Other sessions will be revoked after the update.</p></div></div>
          <form className="settings-form" onSubmit={(event) => void submitPassword(event)}>
            <label className="form-field"><span>Current password</span><input type="password" required maxLength={128} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
            <label className="form-field"><span>New password</span><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><small>Use at least 12 characters.</small></label>
            {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
            {passwordMessage && <p className="settings-success" role="status"><Check size={15} />{passwordMessage}</p>}
            <button className="button button-primary" type="submit" disabled={savingPassword}>{savingPassword ? 'Updating…' : 'Update password'}</button>
          </form>
        </section>
      </div>
    </div>
  )
}
