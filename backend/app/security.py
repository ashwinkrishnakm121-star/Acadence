from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .database import get_db
from .models import User


def current_user(
    x_demo_user: str | None = Header(default=None), db: Session = Depends(get_db)
) -> User:
    if not x_demo_user:
        raise HTTPException(status_code=401, detail="Select a demo user to continue.")
    user = db.query(User).filter(User.username == x_demo_user, User.active.is_(True)).first()
    if user is None:
        raise HTTPException(status_code=401, detail="The selected demo user is unavailable.")
    return user


def require(capability: str):
    def check(user: User = Depends(current_user)) -> User:
        if capability not in user.capabilities:
            raise HTTPException(status_code=403, detail=f"Missing capability: {capability}")
        return user

    return check
