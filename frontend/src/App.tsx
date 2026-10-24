
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarDays,
  CalendarRange,
  Check,
  CheckCheck,
  ChartNoAxesCombined,
  CircleHelp,
  Clock3,
  Command,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  ListTodo,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Search,
  Settings2,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import {
  ApiError,
  changePassword as changePasswordApi,
  checkBackendHealth,
  deleteProject as deleteProjectApi,
  createProject as createProjectApi,
  createTask as createTaskApi,
  createWorkspace as createWorkspaceApi,
  deleteTask as deleteTaskApi,
  getActiveWorkspaceId,
  getCurrentUser,
  getDashboardSummary,
  getNotifications,
  getProject,
  getProjects,
  getReportsSummary,
  getTasks,
  getUserPreferences,
  getWorkspaces,
  getWorkspaceMembers,
  login as loginApi,
  logout as logoutApi,
  markAllNotificationsRead,
  register as registerApi,
  setNotificationRead,
  setActiveWorkspaceId,
  updateProject as updateProjectApi,
  updateProfile as updateProfileApi,
  updateTask as updateTaskApi,
  updateUserPreferences,
  type DashboardSummary,
  type AuthUser,
  type ReportsSummary,
  type UserNotification,
  type UserPreferences,
  type Project,
  type Task as ApiTask,
  type TaskData,
  type Workspace,
  type WorkspaceMember,
} from './services/api'
import AuthScreen from './AuthScreen'
import {
  CalendarPage,
  DashboardPage,
  NotificationsPage,
  ProjectsPage,
  ReportsPage,
  SettingsPage,
  TeamPage,
  type WorkspaceTask,
} from './pages/WorkspacePages'
import './App.css'

type Priority = 'High' | 'Medium' | 'Low'
type TaskStatus = 'To Do' | 'In Progress' | 'Done'
type TaskSort = 'created' | 'title' | 'due_date' | 'priority'
type BackendStatus = 'checking' | 'connected' | 'disconnected'

type Task = {
  id: number
  projectId: number | null
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  project: string
  dueDate: string
  dueDateISO: string | null
  assignee: {
    userId: number | null
    name: string
    initials: string
    color: string
  }
  tags: string[]
}

const columns: { title: TaskStatus; description: string }[] = [
  { title: 'To Do', description: 'Ready to get started' },
  { title: 'In Progress', description: 'Work underway' },
  { title: 'Done', description: 'Completed tasks' },
]

// Convert the backend's database format into the format used by the Kanban UI.
function mapApiTask(apiTask: ApiTask): Task {
  const statusMap: Record<string, TaskStatus> = {
    todo: 'To Do',
    'in_progress': 'In Progress',
    done: 'Done',
  }

  const priorityMap: Record<string, Priority> = {
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  }

  const assigneeName = apiTask.assignee?.trim() || 'Unassigned'
  const initials = assigneeName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return {
    id: apiTask.id,
    projectId: apiTask.project_id,
    title: apiTask.title,
    description: apiTask.description || '',
    status: statusMap[apiTask.status.toLowerCase()] ?? 'To Do',
    priority: priorityMap[apiTask.priority.toLowerCase()] ?? 'Medium',
    project: apiTask.project || 'Website Redesign',
    dueDate: apiTask.due_date
      ? new Date(`${apiTask.due_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'No date',
    dueDateISO: apiTask.due_date,
    assignee: {
      userId: apiTask.assignee_user_id,
      name: assigneeName,
      initials: initials || 'UN',
      color: 'lavender',
    },
    tags: apiTask.tags ?? [],
  }
}

function mapUiStatusToApi(status: TaskStatus): string {
  const statusMap: Record<TaskStatus, string> = {
    'To Do': 'todo',
    'In Progress': 'in_progress',
    Done: 'done',
  }

  return statusMap[status]
}

function normalizePath(path: string): string {
  const absolutePath = path.startsWith('/') ? path : `/${path}`
  return absolutePath.length > 1 ? absolutePath.replace(/\/+$/, '') : absolutePath
}

function App() {
  const [currentPath, setCurrentPath] = useState(() =>
    normalizePath(window.location.pathname === '/' ? '/dashboard' : window.location.pathname),
  )
  const [tasks, setTasks] = useState<Task[]>([])
  const [assignedTasks, setAssignedTasks] = useState<Task[]>([])
  const [projectDetailTasks, setProjectDetailTasks] = useState<Task[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null)
  const [reportsSummary, setReportsSummary] = useState<ReportsSummary | null>(null)
  const [notifications, setNotifications] = useState<UserNotification[]>([])
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking')
  const [tasksLoading, setTasksLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [activeNavState, setActiveNavState] = useState('Overview')
  const [projectsSearch, setProjectsSearch] = useState('')
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null)
  const [openTaskMenuId, setOpenTaskMenuId] = useState<number | null>(null)
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState<number | null>(null)
  const [isSavingTask, setIsSavingTask] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showProfileSettings, setShowProfileSettings] = useState(false)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [profileEmail, setProfileEmail] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [projectFormMode, setProjectFormMode] = useState<'create' | 'edit' | null>(null)
  const [projectFormName, setProjectFormName] = useState('')
  const [projectFormDescription, setProjectFormDescription] = useState('')
  const [projectFormError, setProjectFormError] = useState('')
  const [isSavingProject, setIsSavingProject] = useState(false)
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false)
  const [workspaceFormName, setWorkspaceFormName] = useState('')
  const [workspaceFormError, setWorkspaceFormError] = useState('')
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false)
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<number | null>(null)
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false)
  const [showProjectMenu, setShowProjectMenu] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'All'>('All')
  const [taskSort, setTaskSort] = useState<TaskSort>('created')
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus>('To Do')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('A new task for the team.')
  const [newTaskPriority, setNewTaskPriority] = useState<Priority>('Medium')
  const [newTaskDueDate, setNewTaskDueDate] = useState('')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')
  const [newTaskTags, setNewTaskTags] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null)

  const activeNav = activeNavState
  const routeProjectId = currentPath.match(/^\/projects\/(\d+)\/?$/)?.[1]
    ? Number(currentPath.match(/^\/projects\/(\d+)\/?$/)?.[1])
    : null
  const selectedProjectRecord = routeProjectId
    ? projects.find((project) => project.id === routeProjectId)
    : projects.find((project) => project.name === selectedProject)
  const isTaskBoardPage = currentPath === '/my-tasks' || routeProjectId !== null
  const isProjectDirectory = currentPath === '/projects'
  const isDashboard = currentPath === '/dashboard'
  const isKnownPage = isDashboard
    || isProjectDirectory
    || isTaskBoardPage
    || ['/calendar', '/team', '/reports', '/inbox', '/notifications', '/settings'].includes(currentPath)

  function navigateTo(path: string) {
    const normalizedPath = normalizePath(path)
    const previousPath = normalizePath(window.location.pathname)
    if (previousPath !== normalizedPath) {
      window.history.pushState({}, '', normalizedPath)
    }
    setCurrentPath(normalizedPath)
    setActiveNavState(
      normalizedPath === '/dashboard'
        ? 'Overview'
        : normalizedPath === '/my-tasks'
          ? 'My Tasks'
          : normalizedPath.startsWith('/projects')
            ? 'My Projects'
            : normalizedPath.slice(1).split('/')[0],
    )
    setShowWorkspaceMenu(false)
    setShowProjectMenu(false)
    setShowAccountMenu(false)
    setSearch('')
    if (previousPath !== normalizedPath
      || !normalizedPath.match(/^\/projects\/\d+\/?$/)) {
      setProjectDetailTasks(null)
    }
  }

  function setActiveNav(page: string) {
    const routes: Record<string, string> = {
      Overview: '/dashboard',
      'My Tasks': '/my-tasks',
      'My Projects': '/projects',
    }
    navigateTo(routes[page] ?? '/dashboard')
  }

  const loadAuthenticatedWorkspace = useCallback(async (preferredWorkspaceId?: number) => {
    const availableWorkspaces = await getWorkspaces()
    const requestedId = preferredWorkspaceId ?? getActiveWorkspaceId()
    const selectedWorkspace = availableWorkspaces.find((workspace) => workspace.id === requestedId)
      ?? availableWorkspaces[0]
    if (!selectedWorkspace) {
      throw new Error('No workspace is available for this account.')
    }
    setActiveWorkspaceId(selectedWorkspace.id)
    const currentUser = await getCurrentUser()
    const [apiTasks, apiAssignedTasks, apiProjects, workspaceMembers] = await Promise.all([
      getTasks(),
      getTasks({ assignedToMe: true }),
      getProjects(),
      getWorkspaceMembers(),
    ])
    setUser(currentUser)
    setWorkspaces(availableWorkspaces)
    setMembers(workspaceMembers)
    setTasks(apiTasks.map(mapApiTask))
    setAssignedTasks(apiAssignedTasks.map(mapApiTask))
    setProjects(apiProjects)
    const requestedProjectId = window.location.pathname.match(/^\/projects\/(\d+)\/?$/)?.[1]
    const routedProject = requestedProjectId
      ? apiProjects.find((project) => project.id === Number(requestedProjectId))
      : undefined
    setSelectedProject(routedProject?.name
      ?? apiProjects.find((project) => !project.archived)?.name
      ?? '')
    setTasksLoading(false)
    if (normalizePath(window.location.pathname) === '/login') {
      window.history.replaceState({}, '', '/dashboard')
      setCurrentPath('/dashboard')
      setActiveNavState('Overview')
    }
  }, [])

  useEffect(() => {
    function handlePopState() {
      const path = normalizePath(window.location.pathname === '/' ? '/dashboard' : window.location.pathname)
      setCurrentPath(path)
      setProjectDetailTasks(null)
      setActiveNavState(
        path === '/dashboard'
          ? 'Overview'
          : path === '/my-tasks'
            ? 'My Tasks'
            : path.startsWith('/projects')
              ? 'My Projects'
              : path.slice(1).split('/')[0],
      )
    }
    if (window.location.pathname === '/') {
      window.history.replaceState({}, '', '/dashboard')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (confirmDeleteTaskId !== null) setConfirmDeleteTaskId(null)
      else if (confirmDeleteProjectId !== null) setConfirmDeleteProjectId(null)
      else if (showTaskForm) setShowTaskForm(false)
      else if (projectFormMode !== null) setProjectFormMode(null)
      else if (showWorkspaceForm) setShowWorkspaceForm(false)
      else if (showProfileSettings) setShowProfileSettings(false)
      else if (showHelp) setShowHelp(false)
      else {
        setOpenTaskMenuId(null)
        setShowProjectMenu(false)
        setShowWorkspaceMenu(false)
        setShowAccountMenu(false)
      }
    }

    function handleOutsideMenuClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) return
      const target = event.target
      if (!target.closest('.workspace-switcher, .workspace-popover')) setShowWorkspaceMenu(false)
      if (!target.closest('.account-menu-wrap')) setShowAccountMenu(false)
      if (!target.closest('.project-menu-wrap')) setShowProjectMenu(false)
      if (!target.closest('.task-actions-wrap')) setOpenTaskMenuId(null)
    }

    document.addEventListener('keydown', handleEscape)
    document.addEventListener('mousedown', handleOutsideMenuClick)
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.removeEventListener('mousedown', handleOutsideMenuClick)
    }
  }, [
    confirmDeleteProjectId,
    confirmDeleteTaskId,
    projectFormMode,
    showHelp,
    showProfileSettings,
    showTaskForm,
    showWorkspaceForm,
  ])

  useEffect(() => {
    let isMounted = true

    checkBackendHealth()
      .then((data) => {
        if (!isMounted) return

        setBackendStatus(
          data.status === 'healthy' ? 'connected' : 'disconnected',
        )
      })
      .catch(() => {
        if (isMounted) {
          setBackendStatus('disconnected')
        }
      })

    Promise.resolve()
      .then(() => loadAuthenticatedWorkspace())
      .catch((error: unknown) => {
        if (!isMounted) return
        if (!(error instanceof ApiError && error.status === 401)) {
          console.error('Failed to load workspace:', error)
          setNotice('Could not load your workspace. Please try again.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setAuthLoading(false)
          setTasksLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [loadAuthenticatedWorkspace])

  const projectTasks = useMemo(
    () => tasks.filter((task) =>
      selectedProjectRecord
        ? task.projectId === selectedProjectRecord.id
          || (!task.projectId && task.project === selectedProjectRecord.name)
        : false,
    ),
    [selectedProjectRecord, tasks],
  )
  const boardTasks = useMemo(
    () => currentPath === '/my-tasks'
      ? assignedTasks
      : projectDetailTasks ?? projectTasks,
    [assignedTasks, currentPath, projectDetailTasks, projectTasks],
  )
  const myTaskCount = assignedTasks.length
  const activeProjectCount = projects.filter((project) => !project.archived).length
  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase()

    const matches = boardTasks.filter((task) => {
      const matchesPriority = priorityFilter === 'All' || task.priority === priorityFilter
      const matchesSearch = !query || [
        task.title,
        task.description,
        task.priority,
        task.project,
        task.status,
        task.assignee.name,
        ...task.tags,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
      return matchesPriority && matchesSearch
    })
    const priorityRank: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 }
    return matches.sort((left, right) => {
      if (taskSort === 'title') return left.title.localeCompare(right.title)
      if (taskSort === 'priority') return priorityRank[left.priority] - priorityRank[right.priority]
      if (taskSort === 'due_date') {
        return (left.dueDateISO ?? '9999-12-31').localeCompare(right.dueDateISO ?? '9999-12-31')
      }
      return left.id - right.id
    })
  }, [boardTasks, priorityFilter, search, taskSort])

  const completedCount = boardTasks.filter((task) => task.status === 'Done').length
  const progress = boardTasks.length
    ? Math.round((completedCount / boardTasks.length) * 100)
    : 0

  useEffect(() => {
    if (!user) return
    let isActive = true
    const loadRouteData = async () => {
      try {
        if (isDashboard) {
          const summary = await getDashboardSummary()
          if (isActive) setDashboardSummary(summary)
        } else if (currentPath === '/my-tasks') {
          const assigned = (await getTasks({ assignedToMe: true })).map(mapApiTask)
          if (isActive) setAssignedTasks(assigned)
        } else if (routeProjectId) {
          const [, projectTasksForPage] = await Promise.all([
            getProject(routeProjectId),
            getTasks({ projectId: routeProjectId }),
          ])
          if (isActive) setProjectDetailTasks(projectTasksForPage.map(mapApiTask))
        } else if (currentPath === '/reports') {
          const summary = await getReportsSummary()
          if (isActive) setReportsSummary(summary)
        } else if (currentPath === '/inbox' || currentPath === '/notifications') {
          const items = await getNotifications(currentPath === '/inbox')
          if (isActive) setNotifications(items)
        } else if (currentPath === '/settings') {
          const preferences = await getUserPreferences()
          if (isActive) {
            setUserPreferences(preferences)
            if (preferences.theme === 'system') {
              delete document.documentElement.dataset.theme
            } else {
              document.documentElement.dataset.theme = preferences.theme
            }
          }
        } else if (currentPath === '/projects') {
          const freshProjects = await getProjects()
          if (isActive) setProjects(freshProjects)
        }
      } catch (error) {
        console.error(`Failed to load ${currentPath}:`, error)
        if (isActive) {
          setNotice(error instanceof Error ? error.message : 'Could not load this page.')
        }
      }
    }
    void loadRouteData()
    return () => {
      isActive = false
    }
  }, [currentPath, isDashboard, routeProjectId, user])

  async function handleLogin(email: string, password: string) {
    await loginApi(email, password)
    await loadAuthenticatedWorkspace()
  }

  async function handleRegister(data: {
    email: string
    full_name: string
    password: string
    workspace_name: string
  }) {
    await registerApi(data)
    await loadAuthenticatedWorkspace()
  }

  async function handleLogout() {
    try {
      await logoutApi()
      navigateTo('/login')
      setUser(null)
      setTasks([])
      setAssignedTasks([])
      setProjectDetailTasks(null)
      setProjects([])
      setWorkspaces([])
      setMembers([])
    } catch (error) {
      console.error('Failed to log out:', error)
      setNotice('Could not end your session. Please try again.')
    }
  }

  async function handleSaveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profileName.trim() || !profileEmail.trim()) return
    setIsSavingProfile(true)
    try {
      const saved = await updateProfileApi({
        full_name: profileName.trim(),
        email: profileEmail.trim(),
      })
      setUser((current) => current ? { ...current, ...saved } : current)
      setTasks((current) => current.map((task) => {
        if (task.assignee.userId !== user?.id) return task
        const initials = saved.full_name
          .split(/\s+/)
          .map((part) => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()
        return {
          ...task,
          assignee: { ...task.assignee, name: saved.full_name, initials },
        }
      }))
      setShowProfileSettings(false)
      setNotice('Profile updated.')
    } catch (error) {
      console.error('Failed to update profile:', error)
      setNotice(error instanceof Error ? error.message : 'Could not update your profile.')
    } finally {
      setIsSavingProfile(false)
    }
  }

  async function saveProfileFromSettings(
    event: React.FormEvent<HTMLFormElement>,
    fullName: string,
    email: string,
  ) {
    event.preventDefault()
    try {
      const saved = await updateProfileApi({
        full_name: fullName.trim(),
        email: email.trim(),
      })
      setUser((current) => current ? { ...current, ...saved } : current)
      setTasks((current) => current.map((task) =>
        task.assignee.userId === user?.id
          ? { ...task, assignee: { ...task.assignee, name: saved.full_name } }
          : task,
      ))
      setAssignedTasks((current) => current.map((task) => ({
        ...task,
        assignee: { ...task.assignee, name: saved.full_name },
      })))
      setNotice('Profile updated.')
    } catch (error) {
      console.error('Failed to update profile:', error)
      setNotice(error instanceof Error ? error.message : 'Could not update your profile.')
    }
  }

  async function savePreferences(
    preferences: Pick<UserPreferences, 'theme' | 'email_notifications'>,
  ) {
    try {
      const saved = await updateUserPreferences(preferences)
      setUserPreferences(saved)
      if (saved.theme === 'system') {
        delete document.documentElement.dataset.theme
      } else {
        document.documentElement.dataset.theme = saved.theme
      }
      setNotice('Preferences saved.')
    } catch (error) {
      console.error('Failed to save preferences:', error)
      setNotice(error instanceof Error ? error.message : 'Could not save preferences.')
    }
  }

  async function handleChangePassword(currentPassword: string, newPassword: string) {
    await changePasswordApi({
      current_password: currentPassword,
      new_password: newPassword,
    })
  }

  async function handleNotificationRead(
    notification: UserNotification,
    isRead: boolean,
  ) {
    try {
      const updated = await setNotificationRead(notification.id, isRead)
      setNotifications((current) => current.map((item) =>
        item.id === updated.id ? updated : item,
      ))
    } catch (error) {
      console.error('Failed to update notification:', error)
      setNotice(error instanceof Error ? error.message : 'Could not update notification.')
    }
  }

  async function handleReadAllNotifications() {
    try {
      await markAllNotificationsRead()
      setNotifications((current) => current.map((item) => ({
        ...item,
        read_at: item.read_at ?? new Date().toISOString(),
      })))
      setNotice('All notifications marked as read.')
    } catch (error) {
      console.error('Failed to mark all notifications read:', error)
      setNotice(error instanceof Error ? error.message : 'Could not mark notifications as read.')
    }
  }

  function openNotification(notification: UserNotification) {
    if (notification.project_id) {
      const project = projects.find((item) => item.id === notification.project_id)
      if (project) {
        setSelectedProject(project.name)
        navigateTo(`/projects/${project.id}`)
      }
    }
    if (notification.task_id) {
      const task = tasks.find((item) => item.id === notification.task_id)
      if (task) {
        setSelectedProject(task.project)
        navigateTo(task.projectId ? `/projects/${task.projectId}` : '/my-tasks')
        openEditTask(task)
      }
    }
    void handleNotificationRead(notification, true)
  }

  function openProjectForm(project?: Project) {
    setProjectFormMode(project ? 'edit' : 'create')
    setProjectFormName(project?.name ?? '')
    setProjectFormDescription(project?.description ?? '')
    setProjectFormError('')
  }

  async function handleSaveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!projectFormName.trim()) {
      setProjectFormError('Enter a project name.')
      return
    }
    setIsSavingProject(true)
    try {
      const existing = projects.find((item) => item.name === selectedProject)
      const project = projectFormMode === 'edit' && existing
        ? await updateProjectApi(existing.id, {
          name: projectFormName.trim(),
          description: projectFormDescription.trim(),
        })
        : await createProjectApi(projectFormName.trim(), projectFormDescription.trim())
      setProjects((current) => projectFormMode === 'edit'
        ? current.map((item) => item.id === project.id ? project : item)
        : [...current, project])
      setSelectedProject(project.name)
      navigateTo(`/projects/${project.id}`)
      setProjectFormMode(null)
      setNotice(projectFormMode === 'edit' ? 'Project updated.' : 'Project created.')
    } catch (error) {
      console.error('Failed to save project:', error)
      setProjectFormError(error instanceof Error ? error.message : 'Could not save the project.')
    } finally {
      setIsSavingProject(false)
    }
  }

  async function handleSwitchWorkspace(workspace: Workspace) {
    try {
      setActiveWorkspaceId(workspace.id)
      setShowWorkspaceMenu(false)
      setSelectedProject('')
      setTasksLoading(true)
      await loadAuthenticatedWorkspace(workspace.id)
      navigateTo('/dashboard')
      setNotice(`Switched to ${workspace.name}.`)
    } catch (error) {
      console.error('Failed to switch workspace:', error)
      setNotice(error instanceof Error ? error.message : 'Could not switch workspaces.')
    } finally {
      setTasksLoading(false)
    }
  }

  function openWorkspaceForm() {
    setWorkspaceFormName('')
    setWorkspaceFormError('')
    setShowWorkspaceMenu(false)
    setShowWorkspaceForm(true)
  }

  async function handleCreateWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspaceFormName.trim()) {
      setWorkspaceFormError('Enter a workspace name.')
      return
    }
    setIsSavingWorkspace(true)
    try {
      const workspace = await createWorkspaceApi(workspaceFormName.trim())
      setActiveWorkspaceId(workspace.id)
      setSelectedProject('')
      setShowWorkspaceMenu(false)
      await loadAuthenticatedWorkspace(workspace.id)
      setShowWorkspaceForm(false)
      setNotice('Workspace created.')
    } catch (error) {
      console.error('Failed to create workspace:', error)
      setWorkspaceFormError(error instanceof Error ? error.message : 'Could not create workspace.')
    } finally {
      setIsSavingWorkspace(false)
    }
  }

  async function handleArchiveProject() {
    const project = projects.find((item) => item.name === selectedProject)
    if (!project) return
    try {
      const updatedProject = await updateProjectApi(project.id, {
        archived: !project.archived,
      })
      setProjects((current) => current.map((item) =>
        item.id === updatedProject.id ? updatedProject : item,
      ))
      setShowProjectMenu(false)
      setNotice(updatedProject.archived ? 'Project archived.' : 'Project restored.')
    } catch (error) {
      console.error('Failed to update project:', error)
      setNotice(error instanceof Error ? error.message : 'Could not update the project.')
    }
  }

  function handleRenameProject() {
    const project = projects.find((item) => item.name === selectedProject)
    if (!project) return
    setProjectFormMode('edit')
    setProjectFormName(project.name)
    setProjectFormDescription(project.description)
    setProjectFormError('')
    setShowProjectMenu(false)
  }

  async function handleDeleteProject(projectId: number) {
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    try {
      await deleteProjectApi(project.id)
      const remaining = projects.filter((item) => item.id !== project.id)
      setProjects(remaining)
      setSelectedProject(remaining.find((item) => !item.archived)?.name ?? '')
      setShowProjectMenu(false)
      setConfirmDeleteProjectId(null)
      setNotice('Project deleted.')
    } catch (error) {
      console.error('Failed to delete project:', error)
      setNotice(error instanceof Error ? error.message : 'Could not delete the project.')
    }
  }

  function openNewTask(status: TaskStatus = 'To Do') {
    setEditingTaskId(null)
    setSelectedStatus(status)
    setNewTaskTitle('')
    setNewTaskDescription('A new task for the team.')
    setNewTaskPriority('Medium')
    setNewTaskDueDate('')
    setNewTaskAssignee(user?.full_name ?? '')
    setNewTaskTags('')
    setFormError('')
    setOpenTaskMenuId(null)
    setShowTaskForm(true)
  }

  function openEditTask(task: WorkspaceTask) {
    setEditingTaskId(task.id)
    setSelectedStatus(task.status)
    setNewTaskTitle(task.title)
    setNewTaskDescription(task.description)
    setNewTaskPriority(task.priority)
    setNewTaskDueDate(task.dueDateISO ?? '')
    setNewTaskAssignee(task.assignee.name === 'Unassigned' ? '' : task.assignee.name)
    setNewTaskTags(task.tags.join(', '))
    setFormError('')
    setOpenTaskMenuId(null)
    setShowTaskForm(true)
  }

  function taskToApiData(task: Task, status: TaskStatus = task.status): TaskData {
    return {
      title: task.title,
      description: task.description,
      status: mapUiStatusToApi(status),
      priority: task.priority.toLowerCase(),
      assignee: task.assignee.name,
      project: task.project,
      due_date: task.dueDateISO,
      tags: task.tags,
    }
  }

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = newTaskTitle.trim()

    if (!title) {
      setFormError('Please enter a task title.')
      return
    }

    setFormError('')
    setIsSavingTask(true)
    const taskData: TaskData = {
      title,
      description: newTaskDescription.trim(),
      status: mapUiStatusToApi(selectedStatus),
      priority: newTaskPriority.toLowerCase(),
      assignee: newTaskAssignee,
      project: editingTaskId === null
        ? selectedProject
        : tasks.find((task) => task.id === editingTaskId)?.project ?? selectedProject,
      due_date: newTaskDueDate || null,
      tags: newTaskTags.split(',').map((tag) => tag.trim()).filter(Boolean),
    }

    try {
      if (editingTaskId !== null) {
        const savedApiTask = await updateTaskApi(editingTaskId, taskData)
        const savedTask = mapApiTask(savedApiTask)
        setTasks((currentTasks) => currentTasks.map((task) => task.id === editingTaskId ? savedTask : task))
        setAssignedTasks((currentTasks) => {
          const rest = currentTasks.filter((task) => task.id !== editingTaskId)
          return savedTask.assignee.userId === user?.id ? [...rest, savedTask] : rest
        })
        setProjectDetailTasks((currentTasks) => currentTasks?.map((task) => task.id === editingTaskId ? savedTask : task) ?? null)
        setNotice('Task changes saved successfully.')
      } else {
        const savedApiTask = await createTaskApi(taskData)
        const savedTask = mapApiTask(savedApiTask)
        setTasks((currentTasks) => [savedTask, ...currentTasks])
        if (savedTask.assignee.userId === user?.id) setAssignedTasks((currentTasks) => [savedTask, ...currentTasks])
        setProjectDetailTasks((currentTasks) => currentTasks ? [savedTask, ...currentTasks] : null)
        setNotice('Task created successfully.')
      }
      setShowTaskForm(false)
      setEditingTaskId(null)
    } catch (error) {
      console.error('Failed to save task:', error)
      setFormError(error instanceof Error ? error.message : 'Could not save the task.')
    } finally {
      setIsSavingTask(false)
    }
  }

  async function moveTask(taskId: number, status: TaskStatus) {
    const existingTask = tasks.find((task) => task.id === taskId)
    if (!existingTask || existingTask.status === status) {
      setDraggedTaskId(null)
      return
    }

    setDraggedTaskId(null)
    try {
      const updated = await updateTaskApi(taskId, taskToApiData(existingTask, status))
      const savedTask = mapApiTask(updated)
      setTasks((currentTasks) => currentTasks.map((task) => task.id === taskId ? savedTask : task))
      setAssignedTasks((currentTasks) => currentTasks.map((task) => task.id === taskId ? savedTask : task))
      setProjectDetailTasks((currentTasks) => currentTasks?.map((task) => task.id === taskId ? savedTask : task) ?? null)
      setNotice(`Task moved to ${status} and saved.`)
    } catch (error) {
      console.error('Failed to move task:', error)
      setNotice(error instanceof Error ? error.message : 'Could not save the task move.')
    }
  }

  async function deleteTask(taskId: number) {
    try {
      await deleteTaskApi(taskId)
      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId))
      setAssignedTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId))
      setProjectDetailTasks((currentTasks) => currentTasks?.filter((task) => task.id !== taskId) ?? null)
      setNotice('Task deleted from the database.')
      setConfirmDeleteTaskId(null)
      setOpenTaskMenuId(null)
    } catch (error) {
      console.error('Failed to delete task:', error)
      setNotice('Could not delete the task. Please try again.')
    }
  }

  if (authLoading) {
    return <main className="auth-loading" aria-label="Loading workspace">Loading SyncSpace…</main>
  }

  if (!user) {
    return (
      <AuthScreen
        backendOnline={backendStatus === 'connected'}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          type="button"
          onClick={() => {
            navigateTo('/dashboard')
          }}
          aria-label="SyncSpace home"
        >
          <span className="brand-mark">
            <Command size={21} strokeWidth={2.4} />
          </span>
          <span className="brand-name">
            sync<span>space</span>
          </span>
        </button>

        <button
          className="workspace-switcher"
          type="button"
          aria-expanded={showWorkspaceMenu}
          onClick={() => setShowWorkspaceMenu((open) => !open)}
        >
          <span className="workspace-avatar">S</span>
          <span className="workspace-details">
            <strong>{user.workspace.name}</strong>
            <span>{user.workspace.role}</span>
          </span>
          <span className="muted-icon">⌄</span>
        </button>
        {showWorkspaceMenu && (
          <div className="workspace-popover" role="menu" aria-label="Switch workspace">
            <strong>Workspaces</strong>
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                role="menuitem"
                disabled={workspace.id === user.workspace.id}
                onClick={() => void handleSwitchWorkspace(workspace)}
              >
                <FolderKanban size={15} />
                {workspace.name}
                {workspace.id === user.workspace.id && <span className="workspace-current-label">Current</span>}
              </button>
            ))}
            <button type="button" role="menuitem" onClick={openWorkspaceForm}>
              <Plus size={15} />
              Create workspace
            </button>
          </div>
        )}

        <div className="sidebar-section">
          <span className="sidebar-label">WORKSPACE</span>
          <nav className="main-navigation" aria-label="Main navigation">
            <button
              className={`nav-item ${currentPath === '/dashboard' ? 'active' : ''}`}
              type="button"
              aria-label="Overview"
              onClick={() => setActiveNav('Overview')}
            >
              <LayoutDashboard size={18} />
              <span>Overview</span>
            </button>
            <button
              className={`nav-item ${currentPath === '/projects' || routeProjectId !== null ? 'active' : ''}`}
              type="button"
              aria-label="Projects"
              onClick={() => navigateTo('/projects')}
            >
              <FolderKanban size={18} />
              <span>Projects</span>
              <span className="nav-count">{activeProjectCount}</span>
            </button>
            <button
              className={`nav-item ${currentPath === '/my-tasks' ? 'active' : ''}`}
              type="button"
              aria-label="My Tasks"
              onClick={() => navigateTo('/my-tasks')}
            >
              <ListTodo size={18} />
              <span>My Tasks</span>
              <span className="nav-count">{myTaskCount}</span>
            </button>
            <button className={`nav-item ${currentPath === '/calendar' ? 'active' : ''}`} type="button" aria-label="Calendar" onClick={() => navigateTo('/calendar')}>
              <CalendarRange size={18} />
              <span>Calendar</span>
            </button>
            <button className={`nav-item ${currentPath === '/inbox' ? 'active' : ''}`} type="button" aria-label="Inbox" onClick={() => navigateTo('/inbox')}>
              <Inbox size={18} />
              <span>Inbox</span>
              {notifications.filter((item) => !item.read_at).length > 0 && <span className="nav-count">{notifications.filter((item) => !item.read_at).length}</span>}
            </button>
            <button className={`nav-item ${currentPath === '/team' ? 'active' : ''}`} type="button" aria-label="Team" onClick={() => navigateTo('/team')}>
              <Users size={18} />
              <span>Team</span>
            </button>
            <button className={`nav-item ${currentPath === '/reports' ? 'active' : ''}`} type="button" aria-label="Reports" onClick={() => navigateTo('/reports')}>
              <ChartNoAxesCombined size={18} />
              <span>Reports</span>
            </button>
            <button className={`nav-item ${currentPath === '/notifications' ? 'active' : ''}`} type="button" aria-label="Notifications" onClick={() => navigateTo('/notifications')}>
              <Bell size={18} />
              <span>Notifications</span>
            </button>
            <button className={`nav-item ${currentPath === '/settings' ? 'active' : ''}`} type="button" aria-label="Settings" onClick={() => navigateTo('/settings')}>
              <Settings2 size={18} />
              <span>Settings</span>
            </button>
          </nav>
        </div>

        <div className="sidebar-section projects-section">
          <div className="sidebar-heading-row">
            <span className="sidebar-label">YOUR PROJECTS</span>
            <button
              className="icon-button small-icon-button"
              type="button"
              aria-label="Add project"
              onClick={() => openProjectForm()}
            >
              <Plus size={16} />
            </button>
          </div>

          {projects.map((project) => (
            <button
              className={`project-nav-item ${selectedProject === project.name ? 'selected-project' : ''}`}
              key={project.id}
              type="button"
              onClick={() => {
                setSelectedProject(project.name)
                navigateTo(`/projects/${project.id}`)
              }}
            >
              <span className="project-dot" style={{ backgroundColor: project.color }} />
              <span>{project.name}{project.archived ? ' (Archived)' : ''}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-spacer" />

        <div className="sidebar-bottom">
          <button
            className="nav-item"
            type="button"
            onClick={() => setShowHelp(true)}
          >
            <CircleHelp size={18} />
            <span>Help & support</span>
          </button>

          <div className="sidebar-user">
            <span className="avatar avatar-lavender">{user.full_name.slice(0, 2).toUpperCase()}</span>
            <span className="user-details">
              <strong>{user.full_name}</strong>
              <span>{user.email}</span>
            </span>
            <button
              className="icon-button user-menu-button"
              type="button"
              aria-label="Edit profile"
              onClick={() => {
                setProfileName(user.full_name)
                setProfileEmail(user.email)
                setShowProfileSettings(true)
              }}
            >
              <Pencil size={15} />
            </button>
            <button
              className="icon-button user-menu-button"
              type="button"
              aria-label="Sign out"
              onClick={() => void handleLogout()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{isDashboard ? 'Workspace' : currentPath === '/my-tasks' ? 'Personal' : 'Projects'}</span>
            <span className="breadcrumb-divider">/</span>
            <strong>
              {isDashboard
                ? 'Dashboard'
                : isProjectDirectory
                  ? 'Projects'
                  : currentPath === '/my-tasks'
                    ? 'My tasks'
                    : routeProjectId !== null
                      ? selectedProjectRecord?.name ?? 'Project'
                      : currentPath.slice(1).replaceAll('-', ' ')}
            </strong>
          </div>

          <div className="topbar-actions">
            {isTaskBoardPage && (
              <label className="search-box">
                <Search size={17} />
                <input
                  type="search"
                  placeholder="Search tasks..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search tasks"
                />
                {search ? (
                  <button
                    type="button"
                    className="search-clear"
                    aria-label="Clear search"
                    onClick={() => setSearch('')}
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <span className="search-shortcut">⌘ K</span>
                )}
              </label>
            )}

            <div className="account-menu-wrap">
              <button
                className="topbar-account-button"
                type="button"
                aria-label="Account menu"
                aria-expanded={showAccountMenu}
                onClick={() => setShowAccountMenu((open) => !open)}
              >
                <span className="topbar-avatar avatar avatar-lavender">{user.full_name.slice(0, 2).toUpperCase()}</span>
              </button>
              {showAccountMenu && (
                <div className="floating-popover account-popover" role="menu" aria-label="Account options">
                  <strong>{user.full_name}</strong>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProfileName(user.full_name)
                      setProfileEmail(user.email)
                      setShowProfileSettings(true)
                      setShowAccountMenu(false)
                    }}
                  >
                    <Pencil size={15} />
                    Edit profile
                  </button>
                  <button type="button" role="menuitem" onClick={() => void handleLogout()}>
                    <LogOut size={15} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="page-content">
          {!isKnownPage && (
            <section className="page-panel route-not-found">
              <h1>Page not found</h1>
              <p>This SyncSpace page does not exist.</p>
              <button className="button button-secondary" type="button" onClick={() => navigateTo('/dashboard')}>Back to dashboard</button>
            </section>
          )}
          {isDashboard && (
            <DashboardPage
              name={user.full_name}
              assignedCount={dashboardSummary?.assigned_tasks ?? assignedTasks.length}
              completedCount={dashboardSummary?.completed_tasks ?? assignedTasks.filter((task) => task.status === 'Done').length}
              overdueCount={dashboardSummary?.overdue_tasks ?? assignedTasks.filter((task) => task.dueDateISO && task.dueDateISO < new Date().toISOString().slice(0, 10) && task.status !== 'Done').length}
              projects={dashboardSummary?.recent_projects ?? projects}
              upcomingTasks={dashboardSummary?.upcoming_tasks.map(mapApiTask) ?? []}
              onCreateTask={() => openNewTask()}
              onCreateProject={() => openProjectForm()}
              onOpenProject={(projectId) => {
                const project = projects.find((item) => item.id === projectId)
                if (project) setSelectedProject(project.name)
                navigateTo(`/projects/${projectId}`)
              }}
              onOpenTask={openEditTask}
            />
          )}
          {isProjectDirectory && (
            <ProjectsPage
              projects={projects}
              tasks={tasks}
              search={projectsSearch}
              onSearch={setProjectsSearch}
              onCreate={() => openProjectForm()}
              onOpen={(projectId) => {
                const project = projects.find((item) => item.id === projectId)
                if (project) setSelectedProject(project.name)
                navigateTo(`/projects/${projectId}`)
              }}
            />
          )}
          {currentPath === '/calendar' && (
            <CalendarPage tasks={tasks} onOpenTask={openEditTask} />
          )}
          {currentPath === '/team' && <TeamPage members={members} tasks={tasks} />}
          {currentPath === '/reports' && <ReportsPage data={reportsSummary} />}
          {(currentPath === '/inbox' || currentPath === '/notifications') && (
            <NotificationsPage
              notifications={notifications}
              inboxOnly={currentPath === '/inbox'}
              onRead={(notification, isRead) => void handleNotificationRead(notification, isRead)}
              onReadAll={() => void handleReadAllNotifications()}
              onOpen={openNotification}
            />
          )}
          {currentPath === '/settings' && (
            <SettingsPage
              fullName={user.full_name}
              email={user.email}
              preferences={userPreferences}
              onSaveProfile={saveProfileFromSettings}
              onSavePreferences={savePreferences}
              onChangePassword={handleChangePassword}
            />
          )}
          {routeProjectId !== null && !selectedProjectRecord && (
            <section className="page-panel route-not-found">
              <h1>Project not found</h1>
              <p>This project is unavailable in the selected workspace.</p>
              <button className="button button-secondary" type="button" onClick={() => navigateTo('/projects')}>Back to projects</button>
            </section>
          )}
          {isTaskBoardPage && (selectedProjectRecord || currentPath === '/my-tasks') && (
          <>
          <section className="project-header">
            <div className="project-heading-main">
              <div className="project-icon">
                <FolderKanban size={23} />
              </div>
              <div className="project-heading-copy">
                <div className="project-eyebrow">
                  <span className="eyebrow-dot" />
                  {(currentPath === '/my-tasks' ? 'PERSONAL TASKS' : user.workspace.name.toUpperCase())}
                  <span className="eyebrow-separator">·</span>
                  <span>{currentPath === '/my-tasks' ? 'Assigned work' : 'Project workspace'}</span>
                </div>
                <h1>{currentPath === '/my-tasks' ? 'My tasks' : selectedProjectRecord?.name}</h1>
                <p>
                  {currentPath === '/my-tasks'
                    ? 'Tasks assigned to you across this workspace.'
                    : selectedProjectRecord?.description || 'Project tasks, priorities, and progress.'}
                </p>
              </div>
            </div>

            <div className="project-header-actions">
              <div className="avatar-stack" aria-label="Current workspace member">
                <span className="avatar avatar-lavender" title={user.full_name}>
                  {user.full_name.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="project-menu-wrap">
                <button
                  className="icon-button project-menu-button"
                  type="button"
                  aria-label="Project options"
                  aria-expanded={showProjectMenu}
                  disabled={!selectedProjectRecord}
                  onClick={() => setShowProjectMenu((open) => !open)}
                >
                  <MoreHorizontal size={20} />
                </button>
                {showProjectMenu && (
                  <div className="floating-popover project-options-popover">
                    <button type="button" onClick={() => void handleRenameProject()}>
                      <Pencil size={15} />
                      Edit project
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleArchiveProject()}
                    >
                      <FolderKanban size={15} />
                      {projects.find((project) => project.name === selectedProject)?.archived
                        ? 'Restore project'
                        : 'Archive project'}
                    </button>
                    <button
                      className="delete-menu-item"
                      type="button"
                      onClick={() => {
                        const project = projects.find((item) => item.name === selectedProject)
                        if (!project) return
                        setConfirmDeleteProjectId(project.id)
                        setShowProjectMenu(false)
                      }}
                    >
                      <Trash2 size={15} />
                      Delete project
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="stats-grid" aria-label={activeNav === 'Overview' ? 'Workspace statistics' : 'Project statistics'}>
            <article className="stat-card">
              <div className="stat-topline">
                <span className="stat-icon stat-icon-violet">
                  <ListTodo size={18} />
                </span>
                <span className="stat-label">Total tasks</span>
              </div>
              <div className="stat-value">{boardTasks.length}</div>
              <div className="stat-footnote">Across all workflow stages</div>
            </article>

            <article className="stat-card">
              <div className="stat-topline">
                <span className="stat-icon stat-icon-blue">
                  <Activity size={18} />
                </span>
                <span className="stat-label">In progress</span>
              </div>
              <div className="stat-value">
                {boardTasks.filter((task) => task.status === 'In Progress').length}
              </div>
              <div className="stat-footnote">Tasks currently underway</div>
            </article>

            <article className="stat-card">
              <div className="stat-topline">
                <span className="stat-icon stat-icon-green">
                  <CheckCheck size={18} />
                </span>
                <span className="stat-label">Completed</span>
              </div>
              <div className="stat-value">{completedCount}</div>
              <div className="stat-footnote">Tasks marked as done</div>
            </article>

            <article className="stat-card progress-stat-card">
              <div className="stat-topline">
                <span className="stat-icon stat-icon-orange">
                  <Sparkles size={18} />
                </span>
                <span className="stat-label">
                  {activeNav === 'Overview' ? 'Workspace progress' : activeNav === 'My Tasks' ? 'My task progress' : 'Project progress'}
                </span>
              </div>
              <div className="stat-value">
                {progress}<span className="stat-percent">%</span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label="Project completion"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </article>
          </section>

          <section className="board-section">
            <div className="board-toolbar">
              <div className="board-title-group">
                <h2>
                  {activeNav === 'Overview'
                    ? 'Workspace tasks'
                    : activeNav === 'My Tasks'
                      ? 'My task board'
                      : 'Project board'}
                </h2>
                <span className="board-count">{tasksLoading ? 'Loading tasks…' : `${filteredTasks.length} tasks`}</span>
              </div>
              <div className="board-actions">
                <label className="button button-secondary board-filter-button priority-filter">
                  <Settings2 size={16} />
                  <span>Priority</span>
                  <select
                    aria-label="Filter tasks by priority"
                    value={priorityFilter}
                    onChange={(event) => setPriorityFilter(event.target.value as Priority | 'All')}
                  >
                    <option value="All">All</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </label>
                <label className="button button-secondary board-filter-button priority-filter">
                  <span>Sort</span>
                  <select
                    aria-label="Sort tasks"
                    value={taskSort}
                    onChange={(event) => setTaskSort(event.target.value as TaskSort)}
                  >
                    <option value="created">Recent</option>
                    <option value="title">Title</option>
                    <option value="due_date">Due date</option>
                    <option value="priority">Priority</option>
                  </select>
                </label>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => openNewTask()}
                  disabled={!selectedProject}
                >
                  <Plus size={17} />
                  Add task
                </button>
              </div>
            </div>

            {search && (
              <div className="search-summary">
                Search results for <strong>“{search}”</strong>
                <button type="button" onClick={() => setSearch('')}>Clear search</button>
              </div>
            )}

            {!selectedProject && activeNav !== 'My Tasks' ? (
              <div className="project-empty-state">
                <span className="empty-column-icon"><FolderKanban size={18} /></span>
                <strong>No projects yet</strong>
                <span>Create a project to start organizing tasks and tracking progress.</span>
                <button className="button button-primary" type="button" onClick={() => openProjectForm()}>
                  <Plus size={16} />
                  Create your first project
                </button>
              </div>
            ) : (
            <div className="kanban-board">
              {columns.map((column) => {
                const columnTasks = filteredTasks.filter(
                  (task) => task.status === column.title,
                )

                return (
                  <section
                    className={`kanban-column column-${column.title.toLowerCase().replace(' ', '-')}`}
                    key={column.title}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (draggedTaskId !== null) {
                        moveTask(draggedTaskId, column.title)
                      }
                    }}
                    aria-label={`${column.title} tasks`}
                  >
                    <div className="column-header">
                      <div className="column-heading">
                        <span className={`column-status-dot status-${column.title.toLowerCase().replace(' ', '-')}`} />
                        <h3>{column.title}</h3>
                        <span className="column-count">{columnTasks.length}</span>
                      </div>
                      <div className="column-actions">
                        <button
                          className="icon-button small-icon-button"
                          type="button"
                          aria-label={`Add task to ${column.title}`}
                          disabled={!selectedProject}
                          onClick={() => openNewTask(column.title)}
                        >
                          <Plus size={17} />
                        </button>
                        <button
                          className="icon-button small-icon-button"
                          type="button"
                          aria-label={`${column.title} column options`}
                          onClick={() => setNotice(`${column.title}: ${column.description}.`)}
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </div>
                    </div>

                    <div className="column-description">{column.description}</div>

                    <div className="task-list">
                      {columnTasks.map((task) => (
                        <article
                          className="task-card"
                          key={task.id}
                          draggable
                          onDragStart={() => setDraggedTaskId(task.id)}
                          onDragEnd={() => setDraggedTaskId(null)}
                        >
                          <div className="task-card-top">
                            <span className={`priority-badge priority-${task.priority.toLowerCase()}`}>
                              {task.priority === 'High' ? (
                                <ArrowUp size={13} />
                              ) : task.priority === 'Low' ? (
                                <ArrowDown size={13} />
                              ) : (
                                <span className="priority-medium-dot" />
                              )}
                              {task.priority}
                            </span>
                            <div className="task-actions-wrap">
                              <button
                                className="icon-button task-menu-button"
                                type="button"
                                aria-label={`Options for ${task.title}`}
                                aria-expanded={openTaskMenuId === task.id}
                                aria-haspopup="menu"
                                onClick={() => setOpenTaskMenuId((current) => current === task.id ? null : task.id)}
                                title="Task options"
                              >
                                <MoreHorizontal size={18} />
                              </button>
                              {openTaskMenuId === task.id && (
                                <div className="task-actions-menu" role="menu" aria-label={`Actions for ${task.title}`}>
                                  <button type="button" role="menuitem" onClick={() => openEditTask(task)}>
                                    <Pencil size={15} />
                                    Edit task
                                  </button>
                                  <button className="delete-menu-item" type="button" role="menuitem" onClick={() => {
                                    setOpenTaskMenuId(null)
                                    setConfirmDeleteTaskId(task.id)
                                  }}>
                                    <Trash2 size={15} />
                                    Delete task
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          <h4>{task.title}</h4>
                          <p className="task-description">{task.description}</p>

                          <div className="task-tags">
                            {task.tags.map((tag) => (
                              <span className="task-tag" key={tag}>{tag}</span>
                            ))}
                          </div>

                          <div className="task-card-footer">
                            <div
                              className="task-assignee"
                              title={task.assignee.name}
                            >
                              <span className={`avatar avatar-${task.assignee.color}`}>
                                {task.assignee.initials}
                              </span>
                              <span className="assignee-name">
                                {task.assignee.name.split(' ')[0]}
                              </span>
                            </div>
                            <span className={`task-due-date ${task.dueDate === 'No date' ? 'no-date' : ''} ${task.dueDateISO && task.dueDateISO < new Date().toISOString().slice(0, 10) && task.status !== 'Done' ? 'overdue' : ''}`}>
                              <CalendarDays size={13} />
                              {task.dueDateISO && task.dueDateISO < new Date().toISOString().slice(0, 10) && task.status !== 'Done'
                                ? `Overdue · ${task.dueDate}`
                                : task.dueDate}
                            </span>
                          </div>

                          <div className="task-card-move">
                            <label htmlFor={`status-${task.id}`}>Move to</label>
                            <select
                              id={`status-${task.id}`}
                              aria-label={`Move ${task.title} to another column`}
                              value={task.status}
                              onChange={(event) =>
                                moveTask(task.id, event.target.value as TaskStatus)
                              }
                            >
                              {columns.map((option) => (
                                <option key={option.title} value={option.title}>
                                  {option.title}
                                </option>
                              ))}
                            </select>
                          </div>
                        </article>
                      ))}

                      {columnTasks.length === 0 && (
                        <div className="empty-column">
                          <span className="empty-column-icon">
                            <Check size={18} />
                          </span>
                          <strong>{search ? 'No matching tasks' : 'Nothing here yet'}</strong>
                          <span>
                            {search
                              ? 'Try a different search.'
                              : 'Add a task to get things moving.'}
                          </span>
                        </div>
                      )}
                    </div>

                    <button
                      className="add-task-inline"
                      type="button"
                    disabled={!selectedProject}
                    onClick={() => openNewTask(column.title)}
                    >
                      <Plus size={16} />
                      Add a task
                    </button>
                  </section>
                )
              })}
            </div>
            )}
          </section>

          <div
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '16px',
              fontSize: '13px',
              color:
                backendStatus === 'connected'
                  ? '#15803d'
                  : backendStatus === 'disconnected'
                    ? '#dc2626'
                    : '#64748b',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor:
                  backendStatus === 'connected'
                    ? '#22c55e'
                    : backendStatus === 'disconnected'
                      ? '#ef4444'
                      : '#94a3b8',
              }}
            />
            {backendStatus === 'checking'
              ? 'Connecting to backend...'
              : backendStatus === 'connected'
                ? 'Backend connected'
                : 'Backend unavailable'}
          </div>

          <footer className="page-footer">
            <span><Clock3 size={14} /> Last updated just now</span>
            <span>Made for teams that do great work <span className="footer-heart">✦</span></span>
          </footer>
          </>
          )}
        </div>
      </main>

      {projectFormMode !== null && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setProjectFormMode(null)
          }}
        >
          <section
            className="task-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-form-title"
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">{user.workspace.name.toUpperCase()}</span>
                <h2 id="project-form-title">{projectFormMode === 'edit' ? 'Edit project' : 'Create a project'}</h2>
                <p>Projects keep related tasks and progress together.</p>
              </div>
              <button className="icon-button" type="button" aria-label="Close project form" onClick={() => setProjectFormMode(null)}>
                <X size={19} />
              </button>
            </div>
            <form className="task-form" onSubmit={(event) => void handleSaveProject(event)}>
              <label className="form-field">
                <span>Project name</span>
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={projectFormName}
                  onChange={(event) => setProjectFormName(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Description</span>
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={projectFormDescription}
                  onChange={(event) => setProjectFormDescription(event.target.value)}
                />
              </label>
              {projectFormError && <p className="form-error" role="alert">{projectFormError}</p>}
              <div className="modal-footer">
                <button className="button button-secondary" type="button" onClick={() => setProjectFormMode(null)}>
                  Cancel
                </button>
                <button className="button button-primary" type="submit" disabled={isSavingProject}>
                  {isSavingProject ? 'Saving…' : projectFormMode === 'edit' ? 'Save changes' : 'Create project'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showWorkspaceForm && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowWorkspaceForm(false)
          }}
        >
          <section
            className="task-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-form-title"
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">SYNCSPACE</span>
                <h2 id="workspace-form-title">Create a workspace</h2>
                <p>A separate space for another team or area of work.</p>
              </div>
              <button className="icon-button" type="button" aria-label="Close workspace form" onClick={() => setShowWorkspaceForm(false)}>
                <X size={19} />
              </button>
            </div>
            <form className="task-form" onSubmit={(event) => void handleCreateWorkspace(event)}>
              <label className="form-field">
                <span>Workspace name</span>
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={workspaceFormName}
                  onChange={(event) => setWorkspaceFormName(event.target.value)}
                />
              </label>
              {workspaceFormError && <p className="form-error" role="alert">{workspaceFormError}</p>}
              <div className="modal-footer">
                <button className="button button-secondary" type="button" onClick={() => setShowWorkspaceForm(false)}>
                  Cancel
                </button>
                <button className="button button-primary" type="submit" disabled={isSavingWorkspace}>
                  {isSavingWorkspace ? 'Creating…' : 'Create workspace'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {confirmDeleteProjectId !== null && (
        <div
          className="modal-backdrop confirmation-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmDeleteProjectId(null)
          }}
        >
          <section className="task-modal delete-confirm-modal" role="alertdialog" aria-modal="true">
            <div className="delete-confirm-icon"><Trash2 size={22} /></div>
            <div className="delete-confirm-copy">
              <h2>Delete this project?</h2>
              <p>
                {projects.find((item) => item.id === confirmDeleteProjectId)?.name} will be removed.
                Projects containing tasks cannot be deleted; archive them instead.
              </p>
            </div>
            <div className="modal-footer delete-confirm-actions">
              <button className="button button-secondary" type="button" onClick={() => setConfirmDeleteProjectId(null)}>
                Cancel
              </button>
              <button className="button button-danger" type="button" onClick={() => void handleDeleteProject(confirmDeleteProjectId)}>
                <Trash2 size={16} />
                Delete project
              </button>
            </div>
          </section>
        </div>
      )}

      {showProfileSettings && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowProfileSettings(false)
          }}
        >
          <section
            className="task-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-modal-title"
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">ACCOUNT</span>
                <h2 id="profile-modal-title">Profile settings</h2>
                <p>Update the name and email associated with your account.</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close profile settings"
                onClick={() => setShowProfileSettings(false)}
              >
                <X size={19} />
              </button>
            </div>
            <form className="task-form" onSubmit={(event) => void handleSaveProfile(event)}>
              <label className="form-field">
                <span>Full name</span>
                <input
                  autoComplete="name"
                  required
                  maxLength={100}
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Email address</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={320}
                  value={profileEmail}
                  onChange={(event) => setProfileEmail(event.target.value)}
                />
              </label>
              <div className="modal-footer">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setShowProfileSettings(false)}
                >
                  Cancel
                </button>
                <button className="button button-primary" type="submit" disabled={isSavingProfile}>
                  {isSavingProfile ? 'Saving…' : 'Save profile'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showTaskForm && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowTaskForm(false)
            }
          }}
        >
          <section
            className="task-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-modal-title"
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">{selectedProject.toUpperCase()}</span>
                <h2 id="task-modal-title">{editingTaskId !== null ? 'Edit task' : 'Create a new task'}</h2>
                <p>{editingTaskId !== null ? 'Update the details and save your changes.' : "Add a task to your team's project board."}</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close dialog"
                onClick={() => setShowTaskForm(false)}
              >
                <X size={19} />
              </button>
            </div>

            <form className="task-form" onSubmit={createTask}>
              <label className="form-field">
                <span>Task title <span className="required-mark">*</span></span>
                <input
                  autoFocus
                  type="text"
                  placeholder="e.g. Design the landing page"
                  value={newTaskTitle}
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                  maxLength={120}
                />
              </label>

              <label className="form-field">
                <span>Description</span>
                <textarea
                  rows={3}
                  placeholder="What needs to be done?"
                  value={newTaskDescription}
                  onChange={(event) => setNewTaskDescription(event.target.value)}
                  maxLength={1000}
                />
              </label>

              <label className="form-field">
                <span>Status</span>
                <select
                  value={selectedStatus}
                  onChange={(event) =>
                    setSelectedStatus(event.target.value as TaskStatus)
                  }
                >
                  {columns.map((column) => (
                    <option key={column.title} value={column.title}>
                      {column.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>Assignee</span>
                <select
                  value={newTaskAssignee}
                  onChange={(event) => setNewTaskAssignee(event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {newTaskAssignee && !members.some((member) => member.full_name === newTaskAssignee) && (
                    <option value={newTaskAssignee}>{newTaskAssignee} (existing)</option>
                  )}
                  {members.map((member) => (
                    <option key={member.id} value={member.full_name}>
                      {member.full_name}{member.id === user.id ? ' (you)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div className="form-row">
                <label className="form-field">
                  <span>Priority</span>
                  <select
                    value={newTaskPriority}
                    onChange={(event) =>
                      setNewTaskPriority(event.target.value as Priority)
                    }
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </label>

                <label className="form-field">
                  <span>Due date</span>
                  <input
                    type="date"
                    value={newTaskDueDate}
                    onChange={(event) => setNewTaskDueDate(event.target.value)}
                  />
                </label>
              </div>

              <label className="form-field">
                <span>Tags</span>
                <input
                  type="text"
                  placeholder="e.g. Design, Frontend, Research"
                  value={newTaskTags}
                  onChange={(event) => setNewTaskTags(event.target.value)}
                />
                <small>Separate tags with commas.</small>
              </label>

              {formError && <p className="form-error">{formError}</p>}

              <div className="modal-footer">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setShowTaskForm(false)}
                >
                  Cancel
                </button>
                <button className="button button-primary" type="submit" disabled={isSavingTask}>
                  {isSavingTask ? <span className="button-spinner" aria-hidden="true" /> : editingTaskId !== null ? <Check size={16} /> : <Plus size={16} />}
                  {isSavingTask ? 'Saving...' : editingTaskId !== null ? 'Save changes' : 'Create task'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {confirmDeleteTaskId !== null && (
        <div
          className="modal-backdrop confirmation-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmDeleteTaskId(null)
          }}
        >
          <section
            className="task-modal delete-confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            aria-describedby="delete-confirm-description"
          >
            <div className="delete-confirm-icon"><Trash2 size={22} /></div>
            <div className="delete-confirm-copy">
              <h2 id="delete-confirm-title">Delete this task?</h2>
              <p id="delete-confirm-description">
                “{tasks.find((task) => task.id === confirmDeleteTaskId)?.title ?? 'This task'}” will be permanently removed from your workspace. This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer delete-confirm-actions">
              <button className="button button-secondary" type="button" onClick={() => setConfirmDeleteTaskId(null)}>
                Cancel
              </button>
              <button className="button button-danger" type="button" onClick={() => { if (confirmDeleteTaskId !== null) void deleteTask(confirmDeleteTaskId) }}>
                <Trash2 size={16} />
                Delete task
              </button>
            </div>
          </section>
        </div>
      )}

      {showHelp && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowHelp(false)
          }}
        >
          <section
            className="task-modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">SYNCSPACE SUPPORT</span>
                <h2 id="help-title">Welcome to your workspace</h2>
                <p>Your workspace data is stored in the SyncSpace database.</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close help"
                onClick={() => setShowHelp(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="help-content">
              <p>
                <strong>Create tasks</strong>
                <span>Use the Add task button to create a task and choose its status.</span>
              </p>
              <p>
                <strong>Move tasks</strong>
                <span>Drag a card to another column or use its Move to menu.</span>
              </p>
              <p>
                <strong>Find tasks</strong>
                <span>Search by title, description, project, priority, or assignee.</span>
              </p>
              <p>
                <strong>Keep in mind</strong>
                <span>Tasks, edits, status changes, due dates, tags, and deletions are saved to SQLite.</span>
              </p>
            </div>
            <div className="modal-footer">
              <button
                className="button button-primary"
                type="button"
                onClick={() => setShowHelp(false)}
              >
                Got it
              </button>
            </div>
          </section>
        </div>
      )}

      {notice && (
        <div className="toast-message" role="status">
          <Check size={17} />
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setNotice('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}

export default App
