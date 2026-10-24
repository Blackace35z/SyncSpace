from pathlib import Path
import tempfile
import unittest

from sqlalchemy import create_engine, text
from sqlmodel import Session

import database
from models import Membership, User, Workspace


class LegacyTaskMigrationTests(unittest.TestCase):
    def test_additive_migration_preserves_legacy_task_data(self):
        with tempfile.TemporaryDirectory(prefix="syncspace-migration-tests-") as directory:
            migration_engine = create_engine(
                f"sqlite:///{(Path(directory) / 'legacy.db').as_posix()}",
                connect_args={"check_same_thread": False},
            )
            original_engine = database.engine
            try:
                with migration_engine.begin() as connection:
                    connection.execute(
                        text(
                            """
                            CREATE TABLE task (
                                id INTEGER PRIMARY KEY,
                                title VARCHAR NOT NULL,
                                description VARCHAR NOT NULL,
                                status VARCHAR NOT NULL,
                                priority VARCHAR NOT NULL,
                                assignee VARCHAR NOT NULL,
                                project VARCHAR DEFAULT 'Website Redesign',
                                due_date VARCHAR,
                                tags JSON NOT NULL DEFAULT '[]'
                            )
                            """
                        )
                    )
                    connection.execute(
                        text(
                            """
                            INSERT INTO task
                                (id, title, description, status, priority, assignee, project, due_date, tags)
                            VALUES
                                (7, 'Legacy title', 'Keep this data', 'todo', 'high',
                                 'Legacy Member', 'Legacy Project', '2026-11-05', '["kept"]')
                            """
                        )
                    )

                database.engine = migration_engine
                database.create_db_and_tables()
                with Session(migration_engine) as session:
                    user = User(
                        email="legacy-member@example.com",
                        full_name="Legacy Member",
                        password_hash="test-hash",
                    )
                    workspace = Workspace(name="Legacy Workspace")
                    session.add(user)
                    session.add(workspace)
                    session.flush()
                    user_id = user.id
                    session.add(
                        Membership(
                            user_id=user.id,
                            workspace_id=workspace.id,
                            role="owner",
                        )
                    )
                    session.commit()
                    with migration_engine.begin() as connection:
                        connection.execute(
                            text(
                                "UPDATE task SET workspace_id = :workspace_id WHERE id = 7"
                            ),
                            {"workspace_id": workspace.id},
                        )

                database.migrate_legacy_task_table()
                with migration_engine.connect() as connection:
                    task = connection.execute(
                        text(
                            """
                            SELECT title, description, status, priority, assignee,
                                   project, due_date, tags, assignee_user_id
                            FROM task WHERE id = 7
                            """
                        )
                    ).mappings().one()
                    self.assertEqual(task["title"], "Legacy title")
                    self.assertEqual(task["description"], "Keep this data")
                    self.assertEqual(task["status"], "todo")
                    self.assertEqual(task["priority"], "high")
                    self.assertEqual(task["assignee"], "Legacy Member")
                    self.assertEqual(task["project"], "Legacy Project")
                    self.assertEqual(task["due_date"], "2026-11-05")
                    self.assertEqual(task["tags"], '["kept"]')
                    self.assertEqual(task["assignee_user_id"], user_id)
                    self.assertEqual(
                        connection.execute(text("SELECT count(*) FROM task")).scalar(),
                        1,
                    )
            finally:
                database.engine = original_engine
                migration_engine.dispose()


if __name__ == "__main__":
    unittest.main()
