from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import DATABASE_NAME, MONGODB_URI

client = AsyncIOMotorClient(MONGODB_URI)
db = client[DATABASE_NAME]
