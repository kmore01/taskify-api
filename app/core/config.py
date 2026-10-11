### Application settings ###

import os

from dotenv import load_dotenv

# Load environment variables from the single .env file
load_dotenv(".env")

# Security settings
JWT_SECRET = os.environ["JWT_SECRET"]
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# MongoDB settings
MONGODB_URI = os.getenv("MONGODB_URI")
DATABASE_NAME = os.getenv("DATABASE_NAME", "taskify_db")
