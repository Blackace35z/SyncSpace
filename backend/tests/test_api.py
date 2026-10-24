import os
import hashlib
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

test_data_dir = tempfile.TemporaryDirectory(prefix="syncspace-tests-")
os.environ["DATABASE_URL"] = (
    f"sqlite:///{(Path(test_data_dir.name) / 'test.db').as_posix()}"
)

from database import engine  # noqa: E402
from main import app  # noqa: E402
from models import AuthSession, Membership, User  # noqa: E402
from sqlmodel import Session, select  # noqa: E402
from datetime import date, timedelta


class AuthenticationAndWorkspaceTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        engine.dispose()
        test_data_dir.cleanup()

    def setUp(self):
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def test_authentication_and_workspace_isolation(self):
        with engine.connect() as connection:
            self.assertEqual(connection.exec_driver_sql("PRAGMA foreign_keys").scalar(), 1)
        health = self.client.get("/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["status"], "healthy")
        self.assertEqual(self.client.get("/tasks").status_code, 401)

        first_registration = {
            "email": "owner@example.com",
            "full_name": "Workspace Owner",
            "password": "a-secure-test-password",
            "workspace_name": "Owner Workspace",
        }
        response = self.client.post("/auth/register", json=first_registration)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertNotIn("password_hash", response.json())
        owner_id = response.json()["id"]
        session_cookie = self.client.cookies.get("syncspace_session")
        self.assertIsNotNone(session_cookie)
        self.assertIn("httponly", response.headers["set-cookie"].lower())
        self.assertIn("samesite=strict", response.headers["set-cookie"].lower())
        with Session(engine) as session:
            stored_user = session.get(User, owner_id)
            stored_session = session.exec(select(AuthSession)).first()
            self.assertTrue(stored_user.password_hash.startswith("pbkdf2_sha256$"))
            self.assertNotEqual(stored_session.token_hash, session_cookie)
            self.assertEqual(
                stored_session.token_hash,
                hashlib.sha256(session_cookie.encode()).hexdigest(),
            )

        rejected_origin = self.client.post(
            "/auth/login",
            headers={"Origin": "https://untrusted.invalid"},
            json={"email": first_registration["email"], "password": "anything"},
        )
        self.assertEqual(rejected_origin.status_code, 403)

        duplicate = self.client.post("/auth/register", json=first_registration)
        self.assertEqual(duplicate.status_code, 409)

        created_task = self.client.post(
            "/tasks",
            json={
                "title": "Private task",
                "description": "Only this workspace should read it.",
                "status": "todo",
                "priority": "high",
                "assignee": "Workspace Owner",
                "project": "Website Redesign",
                "tags": ["security"],
            },
        )
        self.assertEqual(created_task.status_code, 201, created_task.text)
        task_id = created_task.json()["id"]
        self.assertEqual(created_task.json()["assignee_user_id"], owner_id)
        owner_workspace_id = self.client.get("/auth/me").json()["workspace"]["id"]
        owner_project_id = self.client.get("/projects").json()[0]["id"]
        self.assertEqual(self.client.delete(f"/projects/{owner_project_id}").status_code, 409)
        self.assertEqual(len(self.client.get("/tasks").json()), 1)
        self.assertEqual(
            self.client.get("/tasks", params={"status": "todo"}).status_code, 200
        )
        self.assertEqual(
            self.client.get("/tasks", params={"search": "private"}).json()[0]["id"],
            task_id,
        )
        self.assertEqual(
            self.client.post(
                "/tasks",
                json={"title": "Invalid status", "status": "in review"},
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/tasks",
                json={
                    "title": "Invalid assignee",
                    "assignee": "Not a workspace member",
                    "project": "Website Redesign",
                },
            ).status_code,
            422,
        )
        workspace_members = self.client.get("/workspaces/members")
        self.assertEqual(workspace_members.status_code, 200)
        self.assertEqual(workspace_members.json()[0]["full_name"], "Workspace Owner")

        second_client = TestClient(app)
        second_client.__enter__()
        try:
            second_registration = {
                "email": "another@example.com",
                "full_name": "Another User",
                "password": "another-secure-test-password",
                "workspace_name": "Another Workspace",
            }
            self.assertEqual(
                second_client.post("/auth/register", json=second_registration).status_code,
                201,
            )
            self.assertEqual(second_client.get("/tasks").json(), [])
            self.assertEqual(
                second_client.get(
                    "/tasks", headers={"X-Workspace-ID": str(owner_workspace_id)}
                ).status_code,
                404,
            )
            self.assertEqual(
                second_client.patch(
                    f"/projects/{owner_project_id}", json={"name": "Stolen project"}
                ).status_code,
                404,
            )
            cross_workspace_update = second_client.put(
                f"/tasks/{task_id}",
                json={"title": "Attempted change"},
            )
            self.assertEqual(cross_workspace_update.status_code, 404)
            cross_workspace_delete = second_client.delete(f"/tasks/{task_id}")
            self.assertEqual(cross_workspace_delete.status_code, 404)
        finally:
            second_client.__exit__(None, None, None)

        created_project = self.client.post("/projects", json={"name": "Research"})
        self.assertEqual(created_project.status_code, 201, created_project.text)
        project_id = created_project.json()["id"]
        archive_response = self.client.patch(
            f"/projects/{project_id}", json={"archived": True}
        )
        self.assertEqual(archive_response.status_code, 200)
        self.assertTrue(archive_response.json()["archived"])
        self.assertEqual(self.client.delete(f"/projects/{project_id}").status_code, 204)

        new_workspace = self.client.post("/workspaces", json={"name": "Second Workspace"})
        self.assertEqual(new_workspace.status_code, 201, new_workspace.text)
        other_workspace_id = new_workspace.json()["id"]
        switched = self.client.get(
            "/auth/me", headers={"X-Workspace-ID": str(other_workspace_id)}
        )
        self.assertEqual(switched.status_code, 200)
        self.assertEqual(switched.json()["workspace"]["id"], other_workspace_id)
        self.assertEqual(
            self.client.get(
                "/tasks", headers={"X-Workspace-ID": str(other_workspace_id)}
            ).json(),
            [],
        )
        self.assertEqual(
            self.client.get(
                "/tasks", headers={"X-Workspace-ID": str(owner_workspace_id)}
            ).json()[0]["id"],
            task_id,
        )

        self.assertEqual(self.client.post("/auth/logout").status_code, 204)
        self.assertEqual(self.client.get("/tasks").status_code, 401)
        self.assertEqual(
            self.client.post(
                "/auth/login",
                json={
                    "email": first_registration["email"],
                    "password": first_registration["password"],
                },
            ).status_code,
            200,
        )
        self.assertEqual(self.client.get("/auth/me").json()["id"], owner_id)
        profile_update = self.client.patch(
            "/auth/profile",
            json={"email": "owner-renamed@example.com", "full_name": "Renamed Owner"},
        )
        self.assertEqual(profile_update.status_code, 200, profile_update.text)
        self.assertEqual(
            self.client.get("/tasks").json()[0]["assignee"],
            "Renamed Owner",
        )

    def test_dashboard_preferences_notifications_and_password_sessions(self):
        owner = self.client.post(
            "/auth/register",
            json={
                "email": "features-owner@example.com",
                "full_name": "Features Owner",
                "password": "a-secure-feature-password",
                "workspace_name": "Features Workspace",
            },
        )
        self.assertEqual(owner.status_code, 201, owner.text)
        workspace_id = self.client.get("/auth/me").json()["workspace"]["id"]

        project = self.client.post("/projects", json={"name": "Feature Project"})
        self.assertEqual(project.status_code, 201, project.text)
        project_id = project.json()["id"]
        self.assertEqual(self.client.get(f"/projects/{project_id}").status_code, 200)
        self.assertEqual(self.client.get("/projects/999999").status_code, 404)

        due_date = (date.today() + timedelta(days=3)).isoformat()
        task = self.client.post(
            "/tasks",
            json={
                "title": "Assigned feature task",
                "status": "in_progress",
                "priority": "high",
                "assignee": "Features Owner",
                "project": "Feature Project",
                "due_date": due_date,
            },
        )
        self.assertEqual(task.status_code, 201, task.text)
        task_id = task.json()["id"]
        self.assertEqual(
            [item["id"] for item in self.client.get(
                "/tasks", params={"assigned_to_me": True, "project_id": project_id}
            ).json()],
            [task_id],
        )
        self.assertEqual(
            self.client.get("/tasks", params={"project_id": 999999}).status_code,
            404,
        )

        dashboard = self.client.get("/dashboard/summary")
        self.assertEqual(dashboard.status_code, 200, dashboard.text)
        self.assertEqual(dashboard.json()["assigned_tasks"], 1)
        self.assertEqual(dashboard.json()["upcoming_tasks"][0]["id"], task_id)
        report = self.client.get("/reports/summary")
        self.assertEqual(report.status_code, 200, report.text)
        self.assertEqual(report.json()["total_tasks"], 1)
        self.assertEqual(report.json()["by_status"]["in_progress"], 1)

        preferences = self.client.put(
            "/settings/preferences",
            json={"theme": "dark", "email_notifications": False},
        )
        self.assertEqual(preferences.status_code, 200, preferences.text)
        self.assertEqual(
            self.client.get("/settings/preferences").json()["theme"], "dark"
        )
        self.assertFalse(self.client.get("/settings/preferences").json()["email_notifications"])

        recipient_client = TestClient(app)
        recipient_client.__enter__()
        owner_session_client = TestClient(app)
        owner_session_client.__enter__()
        try:
            recipient = recipient_client.post(
                "/auth/register",
                json={
                    "email": "features-recipient@example.com",
                    "full_name": "Feature Recipient",
                    "password": "a-secure-recipient-password",
                    "workspace_name": "Recipient Workspace",
                },
            )
            self.assertEqual(recipient.status_code, 201, recipient.text)
            recipient_id = recipient.json()["id"]
            with Session(engine) as session:
                session.add(
                    Membership(
                        workspace_id=workspace_id,
                        user_id=recipient_id,
                        role="member",
                    )
                )
                session.commit()

            recipient_client.headers.update({"X-Workspace-ID": str(workspace_id)})
            self.assertEqual(
                recipient_client.get("/projects").status_code,
                200,
            )
            self.assertEqual(
                recipient_client.get(f"/projects/{project_id}").status_code,
                200,
            )
            notification_task = self.client.post(
                "/tasks",
                json={
                    "title": "Notify the recipient",
                    "assignee": "Feature Recipient",
                    "project": "Feature Project",
                },
            )
            self.assertEqual(notification_task.status_code, 201, notification_task.text)
            notifications = recipient_client.get("/notifications?unread_only=true")
            self.assertEqual(notifications.status_code, 200, notifications.text)
            self.assertEqual(len(notifications.json()), 1)
            notification_id = notifications.json()[0]["id"]
            marked_read = recipient_client.patch(
                f"/notifications/{notification_id}",
                json={"is_read": True},
            )
            self.assertEqual(marked_read.status_code, 200, marked_read.text)
            self.assertIsNotNone(marked_read.json()["read_at"])
            self.assertEqual(
                recipient_client.get("/notifications?unread_only=true").json(), []
            )
            self.assertEqual(
                recipient_client.post("/notifications/read-all").status_code, 204
            )
            self.assertEqual(
                recipient_client.patch(
                    f"/notifications/{notification_id}",
                    json={"is_read": False},
                ).status_code,
                200,
            )
            self.assertEqual(
                recipient_client.patch(
                    f"/notifications/{notification_id + 9999}",
                    json={"is_read": True},
                ).status_code,
                404,
            )

            owner_session_client.post(
                "/auth/login",
                json={
                    "email": "features-owner@example.com",
                    "password": "a-secure-feature-password",
                },
            )
            self.assertEqual(owner_session_client.get("/auth/me").status_code, 200)
            wrong_password = self.client.patch(
                "/auth/password",
                json={
                    "current_password": "wrong-current-password",
                    "new_password": "a-different-secure-password",
                },
            )
            self.assertEqual(wrong_password.status_code, 400)
            same_password = self.client.patch(
                "/auth/password",
                json={
                    "current_password": "a-secure-feature-password",
                    "new_password": "a-secure-feature-password",
                },
            )
            self.assertEqual(same_password.status_code, 422)
            changed_password = self.client.patch(
                "/auth/password",
                json={
                    "current_password": "a-secure-feature-password",
                    "new_password": "a-different-secure-password",
                },
            )
            self.assertEqual(changed_password.status_code, 204, changed_password.text)
            self.assertEqual(self.client.get("/auth/me").status_code, 200)
            self.assertEqual(owner_session_client.get("/auth/me").status_code, 401)
            self.assertEqual(self.client.get("/notifications").json(), [])
        finally:
            recipient_client.__exit__(None, None, None)
            owner_session_client.__exit__(None, None, None)


if __name__ == "__main__":
    unittest.main()
