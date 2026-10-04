import asyncio

import decky
import storage
from recorder import Recorder
from sync import Sync


class Plugin:
    recorder = Recorder()
    sync = Sync()

    # games / launches
    async def list_games(self):
        return storage.list_games()

    async def get_game(self, appid: str):
        return storage.get_game(appid)

    async def record_launch(self, appid: str, name: str):
        return storage.record_launch(appid, name)

    async def record_exit(self, appid: str):
        return storage.record_exit(appid)

    async def ensure_game(self, appid: str, name: str):
        return storage.ensure_game(appid, name)

    # notes / folders
    async def save_note(self, appid: str, note: dict):
        return storage.save_note(appid, note)

    async def delete_note(self, appid: str, note_id: str):
        return storage.delete_note(appid, note_id)

    async def get_note_history(self, appid: str, note_id: str):
        return storage.get_note_history(appid, note_id)

    async def list_deleted_notes(self, appid: str):
        return storage.list_deleted_notes(appid)

    async def restore_note(self, appid: str, note: dict):
        return storage.restore_note(appid, note)

    async def save_folder(self, appid: str, folder: dict):
        return storage.save_folder(appid, folder)

    async def delete_folder(self, appid: str, folder_id: str):
        return storage.delete_folder(appid, folder_id)

    async def set_left_off(self, appid: str, text: str):
        return storage.set_left_off(appid, text)

    # counters
    async def save_counter(self, appid: str, counter: dict):
        return storage.save_counter(appid, counter)

    async def bump_counter(self, appid: str, counter_id: str, delta: int):
        return storage.bump_counter(appid, counter_id, delta)

    async def delete_counter(self, appid: str, counter_id: str):
        return storage.delete_counter(appid, counter_id)

    # media
    async def find_new_screenshot(self, appid: str, after_ms: int):
        return storage.find_new_screenshot(appid, after_ms)

    async def list_steam_screenshots(self, appid: str, limit: int = 30):
        return storage.list_steam_screenshots(appid, limit)

    async def attach_screenshot(self, appid: str, path: str):
        return storage.attach_screenshot(appid, path)

    async def get_media(self, appid: str, filename: str):
        return storage.get_media(appid, filename)

    async def delete_media(self, appid: str, item: dict):
        return storage.delete_media(appid, item)

    async def start_recording(self, appid: str):
        return await self.recorder.start(appid)

    async def stop_recording(self):
        return await self.recorder.stop()

    # settings
    async def get_settings(self):
        return storage.get_settings()

    async def save_settings(self, settings: dict):
        return storage.save_settings(settings)

    # two-way sync with the server container
    async def sync_now(self):
        return await self.sync.sync()

    async def test_backup_server(self):
        return await self.sync.test()

    async def backup_status(self):
        return self.sync.status()

    async def _main(self):
        self.sync.task = asyncio.get_event_loop().create_task(self.sync.auto_loop())
        decky.logger.info("Session Notes plugin loaded")

    async def _unload(self):
        if self.sync.task:
            self.sync.task.cancel()
        await self.recorder.stop()
