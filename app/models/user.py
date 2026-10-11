from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    email: str | None = None
    password: str


class UserPublic(BaseModel):
    id: str
    username: str
    email: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
