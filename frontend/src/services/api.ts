const configuredApiUrl = import.meta.env.VITE_API_BASE_URL?.trim()
const apiUrl = new URL(
  configuredApiUrl || `${window.location.protocol}//${window.location.hostname}:8000`,
)
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
if (localHosts.has(apiUrl.hostname) && localHosts.has(window.location.hostname)) {
  apiUrl.hostname = window.location.hostname
}
const API_BASE_URL = apiUrl.origin
let activeWorkspaceId: number | null = Number(localStorage.getItem('syncspace_workspace_id')) || null

export function setActiveWorkspaceId(workspaceId: number | null): void {
  activeWorkspaceId = workspaceId
  if (workspaceId === null) {
    localStorage.removeItem('syncspace_workspace_id')
  } else {
    localStorage.setItem('syncspace_workspace_id', String(workspaceId))
  }
}

export function getActiveWorkspaceId(): number | null {
  return activeWorkspaceId
}

export interface HealthResponse {
  status: string
}

export interface Workspace {
  id: number
  name: string
  role: string
}

export interface WorkspaceMember {
  id: number
  full_name: string
  email: string
  role: string
}

export interface UserPreferences {
  theme: 'system' | 'light' | 'dark'
  email_notifications: boolean
  updated_at: string
}

export interface UserNotification {
  id: number
  workspace_id: number
  kind: string
  title: string
  body: string
  task_id: number | null
  project_id: number | null
  read_at: string | null
  created_at: string
}

export interface DashboardSummary {
  assigned_tasks: number
  completed_tasks: number
  overdue_tasks: number
  active_projects: number
  upcoming_tasks: Task[]
  recent_projects: Project[]
}

export interface ReportsSummary {
  total_tasks: number
  completed_tasks: number
  open_tasks: number
  overdue_tasks: number
  by_status: Record<string, number>
  by_priority: Record<string, number>
  projects: { id: number; name: string; total_tasks: number; completed_tasks: number }[]
}

export interface AuthUser {
  id: number
  email: string
  full_name: string
  created_at: string
  workspace: Workspace
}

export interface Project {
  id: number
  workspace_id: number
  name: string
  description: string
  color: string
  archived: boolean
  created_at: string
}

export interface Task {
  id: number
  title: string
  description: string
  status: string
  priority: string
  assignee: string
  project: string
  due_date: string | null
  tags: string[]
  workspace_id: number | null
  project_id: number | null
  assignee_user_id: number | null
}

export interface TaskData {
  title: string
  description?: string
  status?: string
  priority?: string
  assignee?: string
  project?: string
  due_date?: string | null
  tags?: string[]
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(activeWorkspaceId ? { 'X-Workspace-ID': String(activeWorkspaceId) } : {}),
      ...init.headers,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    let message = body || `Request failed with status ${response.status}`
    try {
      const parsed = JSON.parse(body) as {
        detail?: string | { loc?: (string | number)[]; msg?: string }[]
      }
      if (typeof parsed.detail === 'string') {
        message = parsed.detail
      } else if (Array.isArray(parsed.detail)) {
        message = parsed.detail
          .map((issue) => {
            const location = issue.loc?.filter((part) => part !== 'body').join('.')
            return location && issue.msg ? `${location}: ${issue.msg}` : issue.msg
          })
          .filter((issue): issue is string => Boolean(issue))
          .join('; ') || message
      }
    } catch {
      // Keep the response text when the server did not return JSON.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function checkBackendHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health')
}

export async function getCurrentUser(): Promise<AuthUser> {
  return request<AuthUser>('/auth/me')
}

export async function updateProfile(data: {
  full_name: string
  email: string
}): Promise<Omit<AuthUser, 'workspace'>> {
  return request<Omit<AuthUser, 'workspace'>>('/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function changePassword(data: {
  current_password: string
  new_password: string
}): Promise<void> {
  return request<void>('/auth/password', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function getUserPreferences(): Promise<UserPreferences> {
  return request<UserPreferences>('/settings/preferences')
}

export async function updateUserPreferences(
  data: Pick<UserPreferences, 'theme' | 'email_notifications'>,
): Promise<UserPreferences> {
  return request<UserPreferences>('/settings/preferences', {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function getWorkspaces(): Promise<Workspace[]> {
  return request<Workspace[]>('/workspaces')
}

export async function getWorkspaceMembers(): Promise<WorkspaceMember[]> {
  return request<WorkspaceMember[]>('/workspaces/members')
}

export async function createWorkspace(name: string): Promise<Workspace> {
  return request<Workspace>('/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function login(email: string, password: string): Promise<void> {
  await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function register(data: {
  email: string
  full_name: string
  password: string
  workspace_name: string
}): Promise<void> {
  await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function logout(): Promise<void> {
  await request<void>('/auth/logout', { method: 'POST' })
}

export async function getProjects(): Promise<Project[]> {
  return request<Project[]>('/projects')
}

export async function getProject(projectId: number): Promise<Project> {
  return request<Project>(`/projects/${projectId}`)
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  return request<DashboardSummary>('/dashboard/summary')
}

export async function getReportsSummary(): Promise<ReportsSummary> {
  return request<ReportsSummary>('/reports/summary')
}

export async function getNotifications(
  unreadOnly = false,
): Promise<UserNotification[]> {
  return request<UserNotification[]>(`/notifications?unread_only=${unreadOnly}`)
}

export async function setNotificationRead(
  notificationId: number,
  isRead: boolean,
): Promise<UserNotification> {
  return request<UserNotification>(`/notifications/${notificationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_read: isRead }),
  })
}

export async function markAllNotificationsRead(): Promise<void> {
  return request<void>('/notifications/read-all', { method: 'POST' })
}

export async function createProject(
  name: string,
  description = '',
): Promise<Project> {
  return request<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  })
}

export async function updateProject(
  projectId: number,
  data: { name?: string; description?: string; color?: string; archived?: boolean },
): Promise<Project> {
  return request<Project>(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteProject(projectId: number): Promise<void> {
  return request<void>(`/projects/${projectId}`, { method: 'DELETE' })
}

export async function getTasks(filters: {
  assignedToMe?: boolean
  projectId?: number
  dueAfter?: string
  dueBefore?: string
} = {}): Promise<Task[]> {
  const query = new URLSearchParams()
  if (filters.assignedToMe) query.set('assigned_to_me', 'true')
  if (filters.projectId) query.set('project_id', String(filters.projectId))
  if (filters.dueAfter) query.set('due_after', filters.dueAfter)
  if (filters.dueBefore) query.set('due_before', filters.dueBefore)
  return request<Task[]>(`/tasks${query.size ? `?${query.toString()}` : ''}`)
}

export async function createTask(data: TaskData): Promise<Task> {
  return request<Task>('/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateTask(taskId: number, data: TaskData): Promise<Task> {
  return request<Task>(`/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteTask(taskId: number): Promise<void> {
  return request<void>(`/tasks/${taskId}`, { method: 'DELETE' })
}
