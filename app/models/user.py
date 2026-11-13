from typing import Annotated

from pydantic import BaseModel, EmailStr, Field, StringConstraints

# bcrypt only reads the first 72 bytes, so longer passwords are refused.
Password = Annotated[str, Field(min_length=8, max_length=72)]


# Normalized before the length check, so "   " is not a three-character name.
Username = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_lower=True, min_length=3, max_length=40),
]


class UserCreate(BaseModel):
    username: Username
    email: EmailStr
    password: Password


class UserPublic(BaseModel):
    id: str
    username: str
    email: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class PasswordChange(BaseModel):
    current_password: str
    new_password: Password


class PasswordConfirm(BaseModel):
    password: str


class ForgotPassword(BaseModel):
    email: str


class ResetPassword(BaseModel):
    token: str
    new_password: Password
