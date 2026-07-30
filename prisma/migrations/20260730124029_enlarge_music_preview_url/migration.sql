-- Enlarge MusicSong.previewUrl from VARCHAR(191) to TEXT so long COS preview
-- URLs (object URL plus cache-busting revision) fit without truncation errors.
ALTER TABLE `MusicSong` MODIFY `previewUrl` TEXT NULL;
