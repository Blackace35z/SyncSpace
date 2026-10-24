from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, UniqueConstraint
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True, max_length=320)
    full_name: str = Field(max_length=100)
    password_hash: str
    created_at: datetime = Field(default_factory=utc_now)


class Workspace(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(max_length=100)
    created_at: datetime = Field(default_factory=utc_now)


class Membership(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("workspace_id", "user_id"),)

    workspace_id: int = Field(foreign_key="workspace.id", primary_key=True)
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    role: str = Field(default="owner", max_length=20)
    created_at: datetime = Field(default_factory=utc_now)


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    workspace_id: int = Field(foreign_key="workspace.id", index=True)
    name: str = Field(max_length=100)
    description: str = Field(default="", max_length=1000)
    color: str = Field(default="#6558d9", max_length=7)
    archived: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utc_now)


class AuthSession(SQLModel, table=True):
    token_hash: str = Field(primary_key=True, max_length=64)
    user_id: int = Field(foreign_key="user.id", index=True)
    expires_at: datetime = Field(index=True)
    created_at: datetime = Field(default_factory=utc_now)


class UserPreference(SQLModel, table=True):
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    theme: str = Field(default="system", max_length=10)
    email_notifications: bool = Field(default=True)
    updated_at: datetime = Field(default_factory=utc_now)


class Notification(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    workspace_id: int = Field(foreign_key="workspace.id", index=True)
    recipient_user_id: int = Field(foreign_key="user.id", index=True)
    actor_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    task_id: Optional[int] = Field(default=None, foreign_key="task.id")
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    kind: str = Field(max_length=30)
    title: str = Field(max_length=160)
    body: str = Field(default="", max_length=500)
    read_at: Optional[datetime] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utc_now, index=True)


class Task(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = Field(index=True, max_length=120)
    description: str = Field(default="", max_length=1000)
    status: str = Field(default="todo", index=True, max_length=20)
    priority: str = Field(default="medium", max_length=20)
    assignee: str = Field(default="", max_length=100)
    project: str = Field(default="Website Redesign", index=True, max_length=100)
    due_date: Optional[str] = Field(default=None, max_length=10)
    tags: list[str] = Field(default_factory=list, sa_type=JSON)
    workspace_id: Optional[int] = Field(
        default=None, foreign_key="workspace.id", index=True
    )
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    assignee_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
