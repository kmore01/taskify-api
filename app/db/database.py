import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Load variables
load_dotenv("atlas-credentials.env")

MONGODB_URL = os.getenv("MONGODB_URI")
# Gets the database name, defaulting to "taskify_db" if not found
DATABASE_NAME = os.getenv("DATABASE_NAME", "taskify_db")

# Creates an asynchronous connection to the MongoDB cluster
client = AsyncIOMotorClient(MONGODB_URL)

# Selects the specific database to use across your app routers
db = client[DATABASE_NAME]
