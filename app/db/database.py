from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import DATABASE_NAME, MONGODB_URI

# Creates an asynchronous connection to the MongoDB cluster
client = AsyncIOMotorClient(MONGODB_URI)

# Selects the specific database to use across your app routers
db = client[DATABASE_NAME]
