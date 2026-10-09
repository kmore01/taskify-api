### Categories API ###

from fastapi import APIRouter

router = APIRouter(
    prefix="/categories",
    tags=["categories"],
    responses={404: {"message": "Not found"}},
)
