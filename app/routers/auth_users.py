### Auth Users API ###

import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pymongo.errors import DuplicateKeyError

from app.db.database import db
from app.db.schemas.task import ErrorResponse
from app.models.user import TokenResponse, UserCreate, UserPublic

load_dotenv()

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
SECRET = os.environ["JWT_SECRET"]

password_crypt = CryptContext(schemes=["bcrypt"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
DUMMY_HASH = password_crypt.hash("dummy-password")


router = APIRouter(
    prefix="/auth", tags=["auth"], responses={404: {"message": "Not found"}}
)


async def get_user(db, username: str):
    user = await db.users.find_one({"username": username})
    if user is None:
        return None
    return user


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return password_crypt.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return password_crypt.hash(password)


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    expires = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=15))
    to_encode = data.copy()
    to_encode.update({"exp": expires})
    encoded_jwt = jwt.encode(to_encode, SECRET, algorithm=ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str):
    try:
        payload = jwt.decode(token, SECRET, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


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
    user = await get_user(db, form.username.lower().strip())

    # Verificar siempre, exista o no el usuario (evita timing attack)
    hashed = user["hashed_password"] if user else DUMMY_HASH
    valid = verify_password(form.password, hashed)

    if not user or not valid or user.get("disabled"):
        raise unauthorized("Incorrect username or password")

    token = create_access_token(
        data={"sub": user["username"]},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": token, "token_type": "bearer"}


def unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=ErrorResponse(error=detail).model_dump(),
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = decode_access_token(token)
    if payload is None:
        raise unauthorized("Invalid authentication token")

    username = payload.get("sub")
    if not username:
        raise unauthorized("Token payload missing subject")

    user = await get_user(db, username)
    if user is None or user.get("disabled"):
        raise unauthorized("User not found or disabled")
    return user


@router.get("/users/me")
async def me(user=Depends(get_current_user)):
    return {
        "id": str(user.get("_id", "")),
        "username": user["username"],
        "email": user.get("email"),
    }
