### Auth Users API ###

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pymongo.errors import DuplicateKeyError

from app.core.config import ACCESS_TOKEN_EXPIRE_MINUTES
from app.core.security import (
    create_access_token,
    get_password_hash,
    verify_password,
)
from app.db.database import db
from app.deps import get_current_user, get_user, unauthorized
from app.models.error import ErrorResponse
from app.models.user import TokenResponse, UserCreate, UserPublic

router = APIRouter(
    prefix="/auth", tags=["auth"], responses={404: {"message": "Not found"}}
)

# Hashing a dummy password keeps login timing consistent whether the user
# exists or not (mitigates user-enumeration timing attacks).
DUMMY_HASH = get_password_hash("dummy-password")


@router.post("/register", response_model=UserPublic, status_code=201)
async def register(user: UserCreate):
    user_doc = {
        "username": user.username.lower().strip(),
        "email": user.email.lower().strip(),
        "hashed_password": get_password_hash(user.password),
        "disabled": False,
        "created_at": datetime.now(timezone.utc),
    }
    try:
        result = await db.users.insert_one(user_doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(
                error="Username or email already registered"
            ).model_dump(),
        )
    return {
        "id": str(result.inserted_id),
        "username": user_doc["username"],
        "email": user_doc["email"],
    }


@router.post("/login", response_model=TokenResponse)
async def login(form: OAuth2PasswordRequestForm = Depends()):
    user = await get_user(form.username.lower().strip())

    # Always verify, even if the user does not exist (avoids timing attacks)
    hashed = user["hashed_password"] if user else DUMMY_HASH
    valid = verify_password(form.password, hashed)

    if not user or not valid or user.get("disabled"):
        raise unauthorized("Incorrect username or password")

    token = create_access_token(
        data={"sub": user["username"]},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": token, "token_type": "bearer"}


@router.get("/users/me")
async def me(user=Depends(get_current_user)):
    return {
        "id": str(user.get("_id", "")),
        "username": user["username"],
        "email": user.get("email"),
    }
