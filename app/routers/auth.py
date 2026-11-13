import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from pymongo.errors import DuplicateKeyError

from app.core.config import APP_URL, RESET_TOKEN_EXPIRE_MINUTES
from app.core.mail import send_mail
from app.core.security import (
    create_access_token,
    decode_access_token,
    get_password_hash,
    verify_password,
)
from app.db.database import db
from app.deps import get_current_user, get_user, unauthorized
from app.models.error import ErrorResponse
from app.models.user import (
    ForgotPassword,
    PasswordChange,
    PasswordConfirm,
    ResetPassword,
    TokenResponse,
    UserCreate,
    UserPublic,
)

router = APIRouter(
    prefix="/auth", tags=["auth"], responses={404: {"message": "Not found"}}
)

# Hashing a dummy password keeps login timing consistent whether the user
# exists or not (mitigates user-enumeration timing attacks).
DUMMY_HASH = get_password_hash("dummy-password")

# shortcut: attempts live in this process's memory (lost on restart, not shared
# between workers); move them to Redis or Mongo when more than one worker runs.
ATTEMPTS: dict[str, list[float]] = {}
WINDOW_SECONDS = 15 * 60


def throttle(key: str, limit: int) -> None:
    """Allow `limit` attempts per key every 15 minutes, then answer 429."""
    now = time.monotonic()
    recent = [t for t in ATTEMPTS.get(key, []) if now - t < WINDOW_SECONDS]
    if len(recent) >= limit:
        raise HTTPException(
            status_code=429,
            detail=ErrorResponse(
                error="Too many attempts. Try again in a few minutes."
            ).model_dump(),
            headers={"Retry-After": str(int(WINDOW_SECONDS - (now - recent[0])) + 1)},
        )
    if len(ATTEMPTS) > 10_000:  # bound memory under a flood of distinct keys
        ATTEMPTS.clear()
    ATTEMPTS[key] = [*recent, now]


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def session_token(user) -> dict:
    token = create_access_token(
        data={"sub": user["username"], "ver": user.get("token_version", 0)}
    )
    return {"access_token": token, "token_type": "bearer"}


def wrong_password() -> HTTPException:
    return HTTPException(
        status_code=403,
        detail=ErrorResponse(error="Incorrect password").model_dump(),
    )


async def set_password(user, password: str) -> None:
    # Bumping token_version rejects every session token issued before now.
    user["token_version"] = user.get("token_version", 0) + 1
    await db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "hashed_password": get_password_hash(password),
                "token_version": user["token_version"],
            }
        },
    )


@router.post("/register", response_model=UserPublic, status_code=201)
async def register(user: UserCreate, request: Request):
    # Hashing is deliberately slow; unlimited sign-ups would be a cheap way to burn CPU.
    throttle(f"register:{client_ip(request)}", limit=10)
    user_doc = {
        "username": user.username,
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
async def login(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    username = form.username.lower().strip()
    attempt_key = f"login:{client_ip(request)}:{username}"
    throttle(attempt_key, limit=8)
    user = await get_user(username)

    # Always verify, even if the user does not exist (avoids timing attacks)
    hashed = user["hashed_password"] if user else DUMMY_HASH
    valid = verify_password(form.password, hashed)

    if not user or not valid or user.get("disabled"):
        raise unauthorized("Incorrect username or password")

    ATTEMPTS.pop(attempt_key, None)
    return session_token(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(user=Depends(get_current_user)):
    # Sliding session: a still-valid token is exchanged for a fresh one.
    return session_token(user)


@router.post("/password", response_model=TokenResponse)
async def change_password(body: PasswordChange, user=Depends(get_current_user)):
    # A stolen session must not be able to guess the password without limit.
    throttle(f"password:{user['username']}", limit=8)
    if not verify_password(body.current_password, user["hashed_password"]):
        raise wrong_password()
    await set_password(user, body.new_password)
    # Every older token is now rejected, so hand this client a new one.
    return session_token(user)


@router.post("/forgot", status_code=204)
async def forgot_password(
    body: ForgotPassword, request: Request, background: BackgroundTasks
):
    # Always 204: the answer never reveals whether the address has an account.
    throttle(f"forgot:{client_ip(request)}", limit=5)
    user = await db.users.find_one({"email": body.email.lower().strip()})
    if user is None or user.get("disabled"):
        return
    token = create_access_token(
        # The hash fingerprint makes the link single-use: it dies with the old password.
        data={
            "sub": user["username"],
            "purpose": "reset",
            "fp": user["hashed_password"][-16:],
        },
        expires_delta=timedelta(minutes=RESET_TOKEN_EXPIRE_MINUTES),
    )
    background.add_task(
        send_mail,
        user["email"],
        "Planifier: restablecer contraseña",
        "Abre este enlace para elegir una contraseña nueva "
        f"(caduca en {RESET_TOKEN_EXPIRE_MINUTES} minutos):\n\n"
        f"{APP_URL}/static/index.html?reset={token}\n\n"
        "Si no lo has pedido tú, ignora este mensaje.",
    )


@router.post("/reset", status_code=204)
async def reset_password(body: ResetPassword):
    payload = decode_access_token(body.token) or {}
    user = await get_user(payload["sub"]) if payload.get("purpose") == "reset" else None
    if user is None or payload.get("fp") != user["hashed_password"][-16:]:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(error="Invalid or expired reset link").model_dump(),
        )
    await set_password(user, body.new_password)


@router.get("/users/me")
async def me(user=Depends(get_current_user)):
    return {
        "id": str(user.get("_id", "")),
        "username": user["username"],
        "email": user.get("email"),
    }


@router.delete("/users/me", status_code=204)
async def delete_account(body: PasswordConfirm, user=Depends(get_current_user)):
    throttle(f"password:{user['username']}", limit=8)
    if not verify_password(body.password, user["hashed_password"]):
        raise wrong_password()
    await db.events.delete_many({"owner": user["_id"]})
    await db.users.delete_one({"_id": user["_id"]})
