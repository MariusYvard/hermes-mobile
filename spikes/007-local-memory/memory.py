"""Disposable stdlib SQLite proof; never import into the mobile application."""
from contextlib import closing, contextmanager
import sqlite3
import re

def _identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value):
        raise ValueError('invalid_identifier')

def _scope(scope):
    if not isinstance(scope, tuple) or len(scope) != 2 or scope[0] not in ('local', 'cloud', 'instance', 'ssh'):
        raise ValueError('invalid_scope')
    _identifier(scope[1])

class StorageError(Exception):
    """Stable content-free error code; never expose SQLite diagnostics."""

@contextmanager
def _database(path):
    try:
        with closing(sqlite3.connect(path)) as db:
            with db:
                db.execute('BEGIN IMMEDIATE')
                version = db.execute('PRAGMA user_version').fetchone()[0]
                if version not in (0, 1):
                    raise StorageError('unsupported_schema')
                if version == 0:
                    db.execute('CREATE TABLE notes (mode TEXT NOT NULL, instance TEXT NOT NULL, id TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(mode, instance, id))')
                    db.execute('PRAGMA user_version=1')
                yield db
    except sqlite3.Error:
        raise StorageError('storage_unavailable') from None

def upsert(path, scope, note_id, text, *, confirmed):
    _scope(scope)
    _identifier(note_id)
    if confirmed is not True:
        raise ValueError('confirmation_required')
    if not isinstance(text, str) or not text.strip() or len(text) > 4096 or '\x00' in text:
        raise ValueError('invalid_note')
    with _database(path) as db:
        exists = db.execute('SELECT 1 FROM notes WHERE mode=? AND instance=? AND id=?', (*scope, note_id)).fetchone()
        count = db.execute('SELECT COUNT(*) FROM notes WHERE mode=? AND instance=?', scope).fetchone()[0]
        if exists is None and count >= 128:
            raise ValueError('scope_capacity')
        db.execute('INSERT INTO notes VALUES(?,?,?,?) ON CONFLICT(mode,instance,id) DO UPDATE SET text=excluded.text', (*scope, note_id, text))

def list_notes(path, scope):
    _scope(scope)
    with _database(path) as db:
        return db.execute('SELECT id,text FROM notes WHERE mode=? AND instance=? ORDER BY id', scope).fetchall()

def delete(path, scope, note_id):
    _scope(scope)
    _identifier(note_id)
    with _database(path) as db:
        return db.execute('DELETE FROM notes WHERE mode=? AND instance=? AND id=?', (*scope, note_id)).rowcount

def purge(path, scope):
    _scope(scope)
    with _database(path) as db:
        return db.execute('DELETE FROM notes WHERE mode=? AND instance=?', scope).rowcount
