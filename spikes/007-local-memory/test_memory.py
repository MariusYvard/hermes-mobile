"""Disposable development tests: fictional fixtures only."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
import sqlite3
import memory

SCRATCH = Path(os.environ.get('HM_TEST_SCRATCH') or os.environ.get('TMPDIR') or
               (Path.home() / 'AppData/Local/hermes/cache/scratch' if os.name == 'nt'
                else Path.home() / '.cache/hermes-mobile-tests'))

class MemoryTests(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="hm007-", dir=SCRATCH)
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name) / "notes.sqlite"
        self.scope = ("local", "fixture-a")

    def test_persistence_fresh_process(self):
        memory.upsert(self.db, self.scope, "n1", "Fictional preference: short answers.", confirmed=True)
        code = "import memory,sys; rows=memory.list_notes(sys.argv[1],('local','fixture-a')); sys.exit(0 if rows == [('n1','Fictional preference: short answers.')] else 2)"
        result = subprocess.run([sys.executable, *(['-O'] if sys.flags.optimize else []), '-B', '-c', code, str(self.db)], cwd=Path(__file__).parent, capture_output=True)
        self.assertEqual(result.returncode, 0, 'fresh-process read failed (content suppressed)')

    def test_scope_edit_delete_purge(self):
        scopes = [('local','fixture-a'), ('cloud','fixture-a'), ('instance','fixture-a'), ('ssh','fixture-a'), ('local','fixture-b'), ('cloud','fixture-b'), ('instance','fixture-b'), ('ssh','fixture-b')]
        for scope in scopes:
            memory.upsert(self.db, scope, 'same', 'Fictional note.', confirmed=True)
        memory.upsert(self.db, scopes[0], 'same', "Fictional edited note '); DROP TABLE notes; --", confirmed=True)
        self.assertEqual(len(memory.list_notes(self.db, scopes[0])), 1)
        for scope in scopes[1:]:
            self.assertEqual(memory.list_notes(self.db, scope), [('same','Fictional note.')])
        self.assertEqual(memory.delete(self.db, scopes[0], 'same'), 1)
        self.assertEqual(memory.delete(self.db, scopes[0], 'same'), 0)
        self.assertEqual(memory.purge(self.db, scopes[1]), 1)
        self.assertEqual(memory.purge(self.db, scopes[1]), 0)
        self.assertEqual(memory.list_notes(self.db, scopes[0]), [])
        self.assertEqual(memory.list_notes(self.db, scopes[1]), [])
        for scope in scopes[2:]:
            self.assertEqual(memory.list_notes(self.db, scope), [('same','Fictional note.')])

    def test_invalid_inputs_do_not_mutate(self):
        memory.upsert(self.db, self.scope, 'n1', 'Fictional note.', confirmed=True)
        before = self.db.read_bytes()
        invalid_scopes = [None, ('local',), ('other','fixture-a'), ('local',''), ('local','x'*129), ('local','a/b'), ('local','a\x00b'), ['local','fixture-a']]
        for scope in invalid_scopes:
            for operation in [lambda: memory.upsert(self.db, scope, 'n2', 'Fictional note.', confirmed=True), lambda: memory.list_notes(self.db, scope), lambda: memory.delete(self.db, scope, 'n1'), lambda: memory.purge(self.db, scope)]:
                with self.assertRaises(ValueError):
                    operation()
        for key, text, confirmed in [('','ok',True), ('x'*129,'ok',True), ('a/b','ok',True), ('n2','',True), ('n2',' '*4,True), ('n2','x'*4097,True), ('n2','a\x00b',True), ('n2',123,True), ('n2','ok',False), ('n2','ok',1)]:
            with self.assertRaises(ValueError):
                memory.upsert(self.db, self.scope, key, text, confirmed=confirmed)
        with self.assertRaises(ValueError):
            memory.delete(self.db, self.scope, '')
        self.assertEqual(before, self.db.read_bytes())
        fresh = Path(self.temp.name) / 'must-not-exist.sqlite'
        with self.assertRaises(ValueError):
            memory.upsert(fresh, self.scope, 'n2', 'ok', confirmed=False)
        self.assertFalse(fresh.exists())

    def test_v0_to_v1_reopen_and_future_version_refused(self):
        memory.upsert(self.db, self.scope, 'n1', 'Fictional note.', confirmed=True)
        with closing(sqlite3.connect(self.db)) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 1)
        self.assertEqual(memory.list_notes(self.db, self.scope), [('n1','Fictional note.')])
        with closing(sqlite3.connect(self.db)) as db:
            db.execute('PRAGMA user_version=2')
        before = self.db.read_bytes()
        with self.assertRaises(memory.StorageError) as caught:
            memory.list_notes(self.db, self.scope)
        self.assertEqual(str(caught.exception), 'unsupported_schema')
        self.assertEqual(before, self.db.read_bytes())

    def test_malformed_database_safe_error(self):
        self.db.write_bytes(b'fictional non-database bytes')
        before = self.db.read_bytes()
        with self.assertRaises(memory.StorageError) as caught:
            memory.list_notes(self.db, self.scope)
        self.assertEqual(str(caught.exception), 'storage_unavailable')
        self.assertIsNone(caught.exception.__cause__)
        self.assertTrue(caught.exception.__suppress_context__)
        self.assertEqual(before, self.db.read_bytes())

    def test_failed_write_rolls_back_trigger_side_effect(self):
        memory.upsert(self.db, self.scope, 'n1', 'Fictional note.', confirmed=True)
        with closing(sqlite3.connect(self.db)) as db:
            with db:
                db.execute("CREATE TRIGGER reject_update BEFORE UPDATE ON notes BEGIN DELETE FROM notes; SELECT RAISE(ABORT, 'fictional suppressed diagnostic'); END")
        with self.assertRaises(memory.StorageError) as caught:
            memory.upsert(self.db, self.scope, 'n1', 'Fictional changed note.', confirmed=True)
        self.assertEqual(str(caught.exception), 'storage_unavailable')
        self.assertEqual(memory.list_notes(self.db, self.scope), [('n1','Fictional note.')])

    def test_limits_and_capacity(self):
        memory.upsert(self.db, self.scope, 'k'*128, 'x'*4096, confirmed=True)
        for i in range(127):
            memory.upsert(self.db, self.scope, 'n'+str(i), 'Fictional note.', confirmed=True)
        memory.upsert(self.db, self.scope, 'n0', 'Fictional edited note.', confirmed=True)
        with self.assertRaises(ValueError) as caught:
            memory.upsert(self.db, self.scope, 'overflow', 'Fictional note.', confirmed=True)
        self.assertEqual(str(caught.exception), 'scope_capacity')
        self.assertEqual(len(memory.list_notes(self.db, self.scope)), 128)
        memory.upsert(self.db, ('local','fixture-b'), 'n1', 'Fictional note.', confirmed=True)
        memory.delete(self.db, self.scope, 'n0')
        memory.upsert(self.db, self.scope, 'replacement', 'Fictional note.', confirmed=True)

    def test_failed_initial_migration_leaves_version_and_database_unchanged(self):
        with closing(sqlite3.connect(self.db)) as db:
            with db:
                db.execute('CREATE TABLE notes (unrelated TEXT)')
        before = self.db.read_bytes()
        with self.assertRaises(memory.StorageError):
            memory.list_notes(self.db, self.scope)
        self.assertEqual(before, self.db.read_bytes())
        with closing(sqlite3.connect(self.db)) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 0)

    def test_missing_storage_directory_safe_error(self):
        with self.assertRaises(memory.StorageError) as caught:
            memory.list_notes(Path(self.temp.name) / 'absent' / 'notes.sqlite', self.scope)
        self.assertEqual(str(caught.exception), 'storage_unavailable')

if __name__ == '__main__':
    unittest.main()
