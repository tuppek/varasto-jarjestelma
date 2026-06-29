import secrets
from datetime import datetime, timedelta
from typing import Dict, Optional

from sqlalchemy.orm import Session

from models import Employee

SESSIONS: Dict[str, dict] = {}
SESSION_HOURS = 12


def create_session(employee: Employee) -> str:
    token = secrets.token_urlsafe(32)
    SESSIONS[token] = {
        "employee_id": employee.id,
        "expires": datetime.utcnow() + timedelta(hours=SESSION_HOURS),
    }
    return token


def get_employee_by_token(db: Session, token: str) -> Optional[Employee]:
    session = SESSIONS.get(token)
    if not session:
        return None
    if session["expires"] < datetime.utcnow():
        SESSIONS.pop(token, None)
        return None
    return db.get(Employee, session["employee_id"])


def logout(token: str) -> None:
    SESSIONS.pop(token, None)
