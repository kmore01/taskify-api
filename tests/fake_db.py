"""In-memory stand-in for the Motor database, covering only what the app uses.

It keeps the API tests runnable without a MongoDB server. It is not MongoDB:
query semantics here are this file's reading of them.
"""

from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace

from bson import ObjectId
from pymongo.errors import DuplicateKeyError


def _stored(value):
    # MongoDB keeps datetimes as UTC and Motor returns them naive.
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    if isinstance(value, dict):
        return {key: _stored(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_stored(item) for item in value]
    return value


OPERATORS = {
    "$gte": lambda value, arg: value is not None and value >= arg,
    "$lte": lambda value, arg: value is not None and value <= arg,
    "$in": lambda value, arg: value in arg,
}


def matches(doc, query) -> bool:
    for key, cond in query.items():
        if key == "$or":
            if not any(matches(doc, option) for option in cond):
                return False
        elif isinstance(cond, dict) and all(op.startswith("$") for op in cond):
            for op, arg in cond.items():
                if op == "$exists":
                    if (key in doc) != arg:
                        return False
                elif not OPERATORS[op](doc.get(key), arg):
                    return False
        elif doc.get(key) != cond:
            return False
    return True


class Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction=1):
        for name, order in reversed(key if isinstance(key, list) else [(key, direction)]):
            self.docs.sort(key=lambda doc: doc.get(name), reverse=order < 0)
        return self

    def skip(self, count):
        self.docs = self.docs[count:]
        return self

    def limit(self, count):
        self.docs = self.docs[:count]
        return self

    async def to_list(self, length=None):
        return deepcopy(self.docs)


class Collection:
    def __init__(self):
        self.docs = []
        self.unique = []

    def _find(self, query):
        return [doc for doc in self.docs if matches(doc, query)]

    async def create_index(self, keys, unique=False):
        if unique:
            self.unique.append(keys)

    async def insert_one(self, doc):
        for field in self.unique:
            if any(other.get(field) == doc.get(field) for other in self.docs):
                raise DuplicateKeyError(f"duplicate {field}")
        doc.setdefault("_id", ObjectId())  # Motor adds the id to the caller's dict too
        self.docs.append(_stored(doc))
        return SimpleNamespace(inserted_id=doc["_id"])

    async def insert_many(self, docs):
        for doc in docs:
            await self.insert_one(doc)

    async def find_one(self, query, projection=None):
        found = self._find(query)
        return deepcopy(found[0]) if found else None

    def find(self, query):
        return Cursor(self._find(query))

    async def count_documents(self, query):
        return len(self._find(query))

    async def distinct(self, key, query):
        return list({doc.get(key) for doc in self._find(query)})

    async def update_one(self, query, update):
        for doc in self._find(query)[:1]:
            doc.update(_stored(update["$set"]))

    async def update_many(self, query, update):
        if self._find(query):  # only the startup migration, which finds nothing here
            raise NotImplementedError("update_many with matching documents")

    async def find_one_and_update(self, query, update, return_document=None):
        await self.update_one(query, update)
        return await self.find_one(query)

    async def find_one_and_delete(self, query):
        found = self._find(query)
        if found:
            self.docs.remove(found[0])
        return found[0] if found else None

    async def delete_one(self, query):
        await self.find_one_and_delete(query)

    async def delete_many(self, query):
        self.docs = [doc for doc in self.docs if not matches(doc, query)]


class FakeDatabase:
    def __init__(self):
        self.users = Collection()
        self.events = Collection()


class FakeClient:
    def __init__(self, *args, **kwargs):
        self.database = FakeDatabase()

    def __getitem__(self, name):
        return self.database
