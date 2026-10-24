from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
import hashlib
import hmac
import os
import re
import secrets
import threading
from typing import Annotated, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import EmailStr, field_validator
from sqlalchemy import func, text
from sqlmodel import Field, Session, SQLModel, select

from database import create_db_and_tables, engine
from models import (
    AuthSession,
    Membership,
    Notification,
    Project,
    Task,
    User,
    UserPreference,
    Workspace,
    utc_now,
)


SESSION_COOKIE = "syncspace_session"
SESSION_LIFETIME = timedelta(days=7)
PASSWORD_ITERATIONS = 310_000
AUTH_WINDOW = timedelta(minutes=10)
AUTH_REQUEST_LIMIT = 10
auth_attempts: dict[str, deque[datetime]] = defaultdict(deque)
auth_attempts_lock = threading.Lock()


class RegistrationInput(SQLModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=12, max_length=128)
    workspace_name: str = Field(min_length=1, max_length=100)

    @field_validator("full_name", "workspace_name")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be blank")
        return value


class LoginInput(SQLModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ProfileInput(SQLModel):
    full_name: str = Field(min_length=1, max_length=100)
    email: EmailStr

    @field_validator("full_name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be blank")
        return value


class PasswordChangeInput(SQLModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class PreferenceInput(SQLModel):
    theme: Literal["system", "light", "dark"] = "system"
    email_notifications: bool = True


class UserResponse(SQLModel):
    id: int
    email: str
    full_name: str
    created_at: datetime


class WorkspaceResponse(SQLModel):
    id: int
    name: str
    role: str


class WorkspaceMemberResponse(SQLModel):
    id: int
    full_name: str
    email: EmailStr
    role: str


class WorkspaceInput(SQLModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Workspace name cannot be blank")
        return value


class CurrentUserResponse(UserResponse):
    workspace: WorkspaceResponse


class TaskInput(SQLModel):
    model_config = {"extra": "forbid"}

    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    status: Literal["todo", "in_progress", "done"] = "todo"
    priority: Literal["high", "medium", "low"] = "medium"
    assignee: str = Field(default="", max_length=100)
    project: str = Field(default="Website Redesign", min_length=1, max_length=100)
    due_date: Optional[str] = None
    tags: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("title", "project", "assignee")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("title", "project")
    @classmethod
    def reject_blank_required_text(cls, value: str) -> str:
        if not value:
            raise ValueError("This field cannot be blank")
        return value

    @field_validator("due_date")
    @classmethod
    def validate_due_date(cls, value: Optional[str]) -> Optional[str]:
        if value is not None:
            try:
                date.fromisoformat(value)
            except ValueError as error:
                raise ValueError("Due date must use YYYY-MM-DD format") from error
        return value

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, value: list[str]) -> list[str]:
        cleaned = [tag.strip() for tag in value]
        if any(not tag or len(tag) > 30 for tag in cleaned):
            raise ValueError("Tags must contain 1 to 30 characters")
        return list(dict.fromkeys(cleaned))


class NotificationResponse(SQLModel):
    id: int
    workspace_id: int
    kind: str
    title: str
    body: str
    task_id: Optional[int]
    project_id: Optional[int]
    read_at: Optional[datetime]
    created_at: datetime


class UserPreferenceResponse(SQLModel):
    theme: str
    email_notifications: bool
    updated_at: datetime


class NotificationReadInput(SQLModel):
    is_read: bool


class ProjectInput(SQLModel):
    model_config = {"extra": "forbid"}

    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)
    color: str = Field(default="#6558d9", max_length=7)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Project name cannot be blank")
        return value

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str) -> str:
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise ValueError("Color must be a six-digit hexadecimal color")
        return value


class ProjectPatch(SQLModel):
    model_config = {"extra": "forbid"}

    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=1000)
    color: Optional[str] = Field(default=None, max_length=7)
    archived: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Project name cannot be blank")
        return value

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise ValueError("Color must be a six-digit hexadecimal color")
        return value


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    yield


app = FastAPI(
    title="SyncSpace API",
    description="Authenticated, workspace-scoped task and project API.",
    version="1.0.0",
    lifespan=lifespan,
)

configured_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Workspace-ID"],
)


@app.middleware("http")
async def validate_request_origin(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        if origin and origin not in configured_origins:
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "Request origin is not allowed"},
            )
    return await call_next(request)


def get_session():
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


def enforce_auth_rate_limit(request: Request, action: str) -> None:
    client_ip = request.client.host if request.client else "unknown"
    key = f"{action}:{client_ip}"
    current_time = utc_now()
    with auth_attempts_lock:
        attempts = auth_attempts[key]
        while attempts and current_time - attempts[0] > AUTH_WINDOW:
            attempts.popleft()
        if len(attempts) >= AUTH_REQUEST_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many authentication attempts. Try again later.",
            )
        attempts.append(current_time)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt.hex()}${derived.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, expected_hex = encoded.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt_hex),
            int(iterations),
        )
        return hmac.compare_digest(actual.hex(), expected_hex)
    except (ValueError, TypeError):
        return False


def create_session(user: User, response: Response, session: Session) -> None:
    raw_token = secrets.token_urlsafe(32)
    session.add(
        AuthSession(
            token_hash=hashlib.sha256(raw_token.encode("utf-8")).hexdigest(),
            user_id=user.id,
            expires_at=utc_now() + SESSION_LIFETIME,
        )
    )
    session.commit()
    response.set_cookie(
        key=SESSION_COOKIE,
        value=raw_token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        samesite="strict",
        path="/",
    )


def get_current_user(
    request: Request, session: SessionDep
) -> User:
    raw_token = request.cookies.get(SESSION_COOKIE)
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    auth_session = session.get(AuthSession, token_hash)
    if auth_session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if auth_session.expires_at <= utc_now():
        session.delete(auth_session)
        session.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

    user = session.get(User, auth_session.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


CurrentUserDep = Annotated[User, Depends(get_current_user)]


def get_current_membership(
    user: CurrentUserDep,
    session: SessionDep,
    workspace_id: Annotated[Optional[int], Header(alias="X-Workspace-ID")] = None,
) -> Membership:
    statement = select(Membership).where(Membership.user_id == user.id)
    if workspace_id is not None:
        statement = statement.where(Membership.workspace_id == workspace_id)
    membership = session.exec(statement.order_by(Membership.workspace_id)).first()
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return membership


MembershipDep = Annotated[Membership, Depends(get_current_membership)]


def get_project_for_workspace(
    project_id: int, workspace_id: int, session: Session
) -> Project:
    project = session.exec(
        select(Project).where(
            Project.id == project_id, Project.workspace_id == workspace_id
        )
    ).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def get_or_create_project(name: str, workspace_id: int, session: Session) -> Project:
    project = session.exec(
        select(Project).where(
            func.lower(Project.name) == name.lower(),
            Project.workspace_id == workspace_id,
        )
    ).first()
    if project is None:
        project = Project(workspace_id=workspace_id, name=name)
        session.add(project)
        session.flush()
    return project


def find_task_assignee(
    assignee: str, workspace_id: int, session: Session
) -> Optional[User]:
    if not assignee:
        return None
    member = session.exec(
        select(User, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.workspace_id == workspace_id,
            func.lower(User.full_name) == assignee.lower(),
        )
    ).first()
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Assignee must be a member of this workspace",
        )
    return member[0]


def notify_assignee(
    *,
    assignee_id: Optional[int],
    actor_id: int,
    workspace_id: int,
    task: Task,
    session: Session,
) -> None:
    if assignee_id is None or assignee_id == actor_id:
        return
    session.add(
        Notification(
            workspace_id=workspace_id,
            recipient_user_id=assignee_id,
            actor_user_id=actor_id,
            task_id=task.id,
            project_id=task.project_id,
            kind="task_assigned",
            title="A task was assigned to you",
            body=task.title,
        )
    )


@app.get("/")
def read_root():
    return {"message": "Welcome to the SyncSpace API!", "status": "running"}


@app.get("/health")
def health_check(session: SessionDep):
    session.execute(text("SELECT 1"))
    return {"status": "healthy"}


@app.post(
    "/auth/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    data: RegistrationInput,
    request: Request,
    response: Response,
    session: SessionDep,
):
    enforce_auth_rate_limit(request, "register")
    email = str(data.email).strip().lower()
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered")

    user = User(
        email=email,
        full_name=data.full_name,
        password_hash=hash_password(data.password),
    )
    session.add(user)
    session.flush()
    workspace = Workspace(name=data.workspace_name)
    session.add(workspace)
    session.flush()
    session.add(Membership(workspace_id=workspace.id, user_id=user.id, role="owner"))
    session.commit()
    session.refresh(user)
    create_session(user, response, session)
    return user


@app.post("/auth/login", response_model=UserResponse)
def login(
    data: LoginInput,
    request: Request,
    response: Response,
    session: SessionDep,
):
    enforce_auth_rate_limit(request, "login")
    email = str(data.email).strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email or password is incorrect",
        )
    create_session(user, response, session)
    return user


@app.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, session: SessionDep):
    raw_token = request.cookies.get(SESSION_COOKIE)
    if raw_token:
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        auth_session = session.get(AuthSession, token_hash)
        if auth_session:
            session.delete(auth_session)
            session.commit()
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        samesite="strict",
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@app.get("/auth/me", response_model=CurrentUserResponse)
def current_user(
    user: CurrentUserDep, membership: MembershipDep, session: SessionDep
):
    workspace = session.get(Workspace, membership.workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "created_at": user.created_at,
        "workspace": {
            "id": workspace.id,
            "name": workspace.name,
            "role": membership.role,
        },
    }


@app.patch("/auth/profile", response_model=UserResponse)
def update_profile(data: ProfileInput, user: CurrentUserDep, session: SessionDep):
    email = str(data.email).strip().lower()
    duplicate = session.exec(
        select(User).where(User.email == email, User.id != user.id)
    ).first()
    if duplicate:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered")
    user.email = email
    user.full_name = data.full_name
    session.add(user)
    assigned_tasks = session.exec(
        select(Task).where(Task.assignee_user_id == user.id)
    ).all()
    for task in assigned_tasks:
        task.assignee = data.full_name
        session.add(task)
    session.commit()
    session.refresh(user)
    return user


@app.patch("/auth/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    data: PasswordChangeInput,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    if data.current_password == data.new_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="New password must be different from the current password",
        )
    user.password_hash = hash_password(data.new_password)
    session.add(user)

    raw_token = request.cookies.get(SESSION_COOKIE)
    current_token_hash = (
        hashlib.sha256(raw_token.encode("utf-8")).hexdigest() if raw_token else None
    )
    for auth_session in session.exec(
        select(AuthSession).where(AuthSession.user_id == user.id)
    ).all():
        if auth_session.token_hash != current_token_hash:
            session.delete(auth_session)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/settings/preferences", response_model=UserPreferenceResponse)
def get_preferences(user: CurrentUserDep, session: SessionDep):
    preference = session.get(UserPreference, user.id)
    if preference is None:
        preference = UserPreference(user_id=user.id)
        session.add(preference)
        session.commit()
        session.refresh(preference)
    return preference


@app.put("/settings/preferences", response_model=UserPreferenceResponse)
def update_preferences(
    data: PreferenceInput, user: CurrentUserDep, session: SessionDep
):
    preference = session.get(UserPreference, user.id)
    if preference is None:
        preference = UserPreference(user_id=user.id)
    preference.theme = data.theme
    preference.email_notifications = data.email_notifications
    preference.updated_at = utc_now()
    session.add(preference)
    session.commit()
    session.refresh(preference)
    return preference


@app.get("/workspaces", response_model=list[WorkspaceResponse])
def list_workspaces(user: CurrentUserDep, session: SessionDep):
    memberships = session.exec(
        select(Membership)
        .where(Membership.user_id == user.id)
        .order_by(Membership.workspace_id)
    ).all()
    workspaces = []
    for membership in memberships:
        workspace = session.get(Workspace, membership.workspace_id)
        if workspace:
            workspaces.append(
                {"id": workspace.id, "name": workspace.name, "role": membership.role}
            )
    return workspaces


@app.post(
    "/workspaces",
    response_model=WorkspaceResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_workspace(
    data: WorkspaceInput,
    user: CurrentUserDep,
    session: SessionDep,
):
    workspace = Workspace(name=data.name)
    session.add(workspace)
    session.flush()
    membership = Membership(workspace_id=workspace.id, user_id=user.id, role="owner")
    session.add(membership)
    session.commit()
    return {"id": workspace.id, "name": workspace.name, "role": membership.role}


@app.get("/workspaces/members", response_model=list[WorkspaceMemberResponse])
def list_workspace_members(membership: MembershipDep, session: SessionDep):
    members = session.exec(
        select(User, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.workspace_id == membership.workspace_id)
        .order_by(User.full_name)
    ).all()
    return [
        {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": role,
        }
        for user, role in members
    ]


@app.get("/projects", response_model=list[Project])
def list_projects(membership: MembershipDep, session: SessionDep):
    return session.exec(
        select(Project)
        .where(Project.workspace_id == membership.workspace_id)
        .order_by(Project.archived, Project.name)
    ).all()


@app.get("/projects/{project_id}", response_model=Project)
def get_project(project_id: int, membership: MembershipDep, session: SessionDep):
    return get_project_for_workspace(project_id, membership.workspace_id, session)


@app.post(
    "/projects",
    response_model=Project,
    status_code=status.HTTP_201_CREATED,
)
def create_project(data: ProjectInput, membership: MembershipDep, session: SessionDep):
    existing = session.exec(
        select(Project).where(
            Project.workspace_id == membership.workspace_id,
            func.lower(Project.name) == data.name.lower(),
        )
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project name already exists")
    project = Project(workspace_id=membership.workspace_id, **data.model_dump())
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@app.patch("/projects/{project_id}", response_model=Project)
def update_project(
    project_id: int,
    data: ProjectPatch,
    membership: MembershipDep,
    session: SessionDep,
):
    project = get_project_for_workspace(project_id, membership.workspace_id, session)
    changes = data.model_dump(exclude_unset=True)
    if changes.get("name"):
        duplicate = session.exec(
            select(Project).where(
                Project.workspace_id == membership.workspace_id,
                Project.id != project.id,
                func.lower(Project.name) == changes["name"].lower(),
            )
        ).first()
        if duplicate:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Project name already exists")
    for field, value in changes.items():
        setattr(project, field, value)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@app.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    membership: MembershipDep,
    session: SessionDep,
):
    project = get_project_for_workspace(project_id, membership.workspace_id, session)
    tasks = session.exec(
        select(Task).where(
            Task.workspace_id == membership.workspace_id,
            (Task.project_id == project.id)
            | (
                (Task.project_id.is_(None))
                & (func.lower(Task.project) == project.name.lower())
            ),
        )
    ).first()
    if tasks is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Move or delete this project's tasks before deleting it",
        )
    for notification in session.exec(
        select(Notification).where(Notification.project_id == project.id)
    ).all():
        notification.project_id = None
        session.add(notification)
    session.delete(project)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/tasks", response_model=list[Task])
def get_tasks(
    membership: MembershipDep,
    session: SessionDep,
    user: CurrentUserDep,
    search: Optional[str] = None,
    task_status: Optional[Literal["todo", "in_progress", "done"]] = Query(
        default=None, alias="status"
    ),
    priority: Optional[Literal["high", "medium", "low"]] = None,
    project: Optional[str] = None,
    project_id: Optional[int] = Query(default=None, ge=1),
    assigned_to_me: bool = False,
    due_after: Optional[date] = None,
    due_before: Optional[date] = None,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    statement = select(Task).where(Task.workspace_id == membership.workspace_id)
    if task_status:
        statement = statement.where(Task.status == task_status)
    if priority:
        statement = statement.where(Task.priority == priority)
    if project:
        statement = statement.where(func.lower(Task.project) == project.lower())
    if project_id is not None:
        get_project_for_workspace(project_id, membership.workspace_id, session)
        statement = statement.where(Task.project_id == project_id)
    if assigned_to_me:
        statement = statement.where(Task.assignee_user_id == user.id)
    if due_after:
        statement = statement.where(Task.due_date >= due_after.isoformat())
    if due_before:
        statement = statement.where(Task.due_date <= due_before.isoformat())
    if search:
        pattern = f"%{search.strip()}%"
        statement = statement.where(
            Task.title.ilike(pattern)
            | Task.description.ilike(pattern)
            | Task.assignee.ilike(pattern)
        )
    return session.exec(statement.order_by(Task.id).offset(offset).limit(limit)).all()


@app.post("/tasks", response_model=Task, status_code=status.HTTP_201_CREATED)
def create_task(
    data: TaskInput,
    membership: MembershipDep,
    user: CurrentUserDep,
    session: SessionDep,
):
    assignee = find_task_assignee(
        data.assignee, membership.workspace_id, session
    )
    data.assignee = assignee.full_name if assignee else ""
    project = get_or_create_project(data.project, membership.workspace_id, session)
    task = Task(
        **data.model_dump(),
        workspace_id=membership.workspace_id,
        project_id=project.id,
        assignee_user_id=assignee.id if assignee else None,
    )
    session.add(task)
    session.flush()
    notify_assignee(
        assignee_id=task.assignee_user_id,
        actor_id=user.id,
        workspace_id=membership.workspace_id,
        task=task,
        session=session,
    )
    session.commit()
    session.refresh(task)
    return task


@app.put("/tasks/{task_id}", response_model=Task)
def update_task(
    task_id: int,
    data: TaskInput,
    membership: MembershipDep,
    user: CurrentUserDep,
    session: SessionDep,
):
    task = session.exec(
        select(Task).where(
            Task.id == task_id, Task.workspace_id == membership.workspace_id
        )
    ).first()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    previous_assignee_id = task.assignee_user_id
    assignee = session.get(User, task.assignee_user_id) if task.assignee_user_id else None
    if data.assignee != task.assignee:
        assignee = find_task_assignee(
            data.assignee, membership.workspace_id, session
        )
    data.assignee = assignee.full_name if assignee else ""
    project = get_or_create_project(data.project, membership.workspace_id, session)
    for field, value in data.model_dump().items():
        setattr(task, field, value)
    task.project_id = project.id
    task.assignee_user_id = assignee.id if assignee else None
    session.add(task)
    if task.assignee_user_id != previous_assignee_id:
        session.flush()
        notify_assignee(
            assignee_id=task.assignee_user_id,
            actor_id=user.id,
            workspace_id=membership.workspace_id,
            task=task,
            session=session,
        )
    session.commit()
    session.refresh(task)
    return task


@app.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, membership: MembershipDep, session: SessionDep):
    task = session.exec(
        select(Task).where(
            Task.id == task_id, Task.workspace_id == membership.workspace_id
        )
    ).first()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    notifications = session.exec(
        select(Notification).where(Notification.task_id == task.id)
    ).all()
    for notification in notifications:
        notification.task_id = None
        session.add(notification)
    session.delete(task)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/dashboard/summary")
def dashboard_summary(
    user: CurrentUserDep,
    membership: MembershipDep,
    session: SessionDep,
):
    tasks = session.exec(
        select(Task).where(Task.workspace_id == membership.workspace_id)
    ).all()
    today = date.today().isoformat()
    upcoming_cutoff = (date.today() + timedelta(days=14)).isoformat()
    projects = session.exec(
        select(Project)
        .where(Project.workspace_id == membership.workspace_id, Project.archived.is_(False))
        .order_by(Project.created_at.desc())
        .limit(5)
    ).all()
    assigned_tasks = [task for task in tasks if task.assignee_user_id == user.id]
    upcoming = [
        task for task in assigned_tasks
        if task.due_date and today <= task.due_date <= upcoming_cutoff and task.status != "done"
    ]
    return {
        "assigned_tasks": len(assigned_tasks),
        "completed_tasks": sum(task.status == "done" for task in assigned_tasks),
        "overdue_tasks": sum(
            task.due_date is not None and task.due_date < today and task.status != "done"
            for task in assigned_tasks
        ),
        "active_projects": len(projects),
        "upcoming_tasks": sorted(upcoming, key=lambda task: task.due_date or "")[:8],
        "recent_projects": projects,
    }


@app.get("/reports/summary")
def reports_summary(
    membership: MembershipDep,
    session: SessionDep,
):
    tasks = session.exec(
        select(Task).where(Task.workspace_id == membership.workspace_id)
    ).all()
    projects = session.exec(
        select(Project).where(Project.workspace_id == membership.workspace_id)
    ).all()
    today = date.today().isoformat()
    return {
        "total_tasks": len(tasks),
        "completed_tasks": sum(task.status == "done" for task in tasks),
        "open_tasks": sum(task.status != "done" for task in tasks),
        "overdue_tasks": sum(
            task.due_date is not None and task.due_date < today and task.status != "done"
            for task in tasks
        ),
        "by_status": {
            status_value: sum(task.status == status_value for task in tasks)
            for status_value in ("todo", "in_progress", "done")
        },
        "by_priority": {
            priority_value: sum(task.priority == priority_value for task in tasks)
            for priority_value in ("high", "medium", "low")
        },
        "projects": [
            {
                "id": project.id,
                "name": project.name,
                "total_tasks": sum(
                    task.project_id == project.id
                    or (
                        task.project_id is None
                        and task.project.lower() == project.name.lower()
                    )
                    for task in tasks
                ),
                "completed_tasks": sum(
                    task.status == "done"
                    and (
                        task.project_id == project.id
                        or (
                            task.project_id is None
                            and task.project.lower() == project.name.lower()
                        )
                    )
                    for task in tasks
                ),
            }
            for project in projects
        ],
    }


@app.get("/notifications", response_model=list[NotificationResponse])
def list_notifications(
    user: CurrentUserDep,
    membership: MembershipDep,
    session: SessionDep,
    unread_only: bool = False,
    limit: int = Query(default=100, ge=1, le=200),
):
    statement = select(Notification).where(
        Notification.workspace_id == membership.workspace_id,
        Notification.recipient_user_id == user.id,
    )
    if unread_only:
        statement = statement.where(Notification.read_at.is_(None))
    return session.exec(
        statement.order_by(Notification.created_at.desc()).limit(limit)
    ).all()


@app.post("/notifications/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_notifications_read(
    user: CurrentUserDep,
    membership: MembershipDep,
    session: SessionDep,
):
    notifications = session.exec(
        select(Notification).where(
            Notification.workspace_id == membership.workspace_id,
            Notification.recipient_user_id == user.id,
            Notification.read_at.is_(None),
        )
    ).all()
    for notification in notifications:
        notification.read_at = utc_now()
        session.add(notification)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.patch("/notifications/{notification_id}", response_model=NotificationResponse)
def update_notification_read_state(
    notification_id: int,
    data: NotificationReadInput,
    user: CurrentUserDep,
    membership: MembershipDep,
    session: SessionDep,
):
    notification = session.exec(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.workspace_id == membership.workspace_id,
            Notification.recipient_user_id == user.id,
        )
    ).first()
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.read_at = utc_now() if data.is_read else None
    session.add(notification)
    session.commit()
    session.refresh(notification)
    return notification
