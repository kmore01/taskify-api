### Shared dependencies ###

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.security import decode_access_token
from app.db.database import db
from app.models.error import ErrorResponse

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=ErrorResponse(error=detail).model_dump(),
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_user(username: str):
    return await db.users.find_one({"username": username})


async def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = decode_access_token(token)
    if payload is None:
        raise unauthorized("Invalid authentication token")

    username = payload.get("sub")
    if not username:
        raise unauthorized("Token payload missing subject")

    user = await get_user(username)
    if user is None or user.get("disabled"):
        raise unauthorized("User not found or disabled")
    return user
