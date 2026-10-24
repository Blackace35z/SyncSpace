import os
from pathlib import Path

from sqlalchemy import event, inspect, text
from sqlmodel import SQLModel, create_engine
from dotenv import load_dotenv

import models


load_dotenv()
DEFAULT_DATABASE_URL = f"sqlite:///{Path(__file__).with_name('syncspace.db').as_posix()}"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, echo=False)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(connection, _connection_record) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)
    migrate_legacy_task_table()


def migrate_legacy_task_table() -> None:
    inspector = inspect(engine)
    if "task" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("task")}
    migrations = {
        "project": "ALTER TABLE task ADD COLUMN project VARCHAR DEFAULT 'Website Redesign'",
        "due_date": "ALTER TABLE task ADD COLUMN due_date VARCHAR",
        "tags": "ALTER TABLE task ADD COLUMN tags JSON NOT NULL DEFAULT '[]'",
        "workspace_id": "ALTER TABLE task ADD COLUMN workspace_id INTEGER REFERENCES workspace(id)",
        "project_id": "ALTER TABLE task ADD COLUMN project_id INTEGER REFERENCES project(id)",
        "assignee_user_id": "ALTER TABLE task ADD COLUMN assignee_user_id INTEGER REFERENCES user(id)",
    }

    with engine.begin() as connection:
        for column_name, statement in migrations.items():
            if column_name not in existing_columns:
                connection.execute(text(statement))
        connection.execute(
            text("CREATE INDEX IF NOT EXISTS ix_task_workspace_id ON task (workspace_id)")
        )
        connection.execute(
            text(
                """
                UPDATE task
                SET assignee_user_id = (
                    SELECT user.id
                    FROM user
                    JOIN membership ON membership.user_id = user.id
                    WHERE membership.workspace_id = task.workspace_id
                      AND lower(user.full_name) = lower(task.assignee)
                    GROUP BY user.id
                    HAVING count(*) = 1
                )
                WHERE assignee_user_id IS NULL
                  AND workspace_id IS NOT NULL
                  AND trim(assignee) != ''
                  AND (
                    SELECT count(*)
                    FROM user
                    JOIN membership ON membership.user_id = user.id
                    WHERE membership.workspace_id = task.workspace_id
                      AND lower(user.full_name) = lower(task.assignee)
                  ) = 1
                """
            )
        )
