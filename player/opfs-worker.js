const PLAYER_DIRECTORY_NAME = 'vanilla-player';
const LIBRARY_DIRECTORY_NAME = 'library';
const LIBRARY_MANIFEST_FILENAME = 'library-manifest.json';

function splitKey(key) {
  const pathSegments = key.split('/').filter(Boolean);
  const filename = pathSegments.pop();

  return {
    filename,
    pathSegments,
  };
}

async function getPlayerDirectoryHandle(create = false) {
  const rootHandle = await navigator.storage.getDirectory();
  return rootHandle.getDirectoryHandle(PLAYER_DIRECTORY_NAME, { create });
}

async function getLibraryDirectoryHandle(create = false) {
  const playerDirectoryHandle = await getPlayerDirectoryHandle(create);
  return playerDirectoryHandle.getDirectoryHandle(LIBRARY_DIRECTORY_NAME, {
    create,
  });
}

async function getManifestFileHandle(create = false) {
  const playerDirectoryHandle = await getPlayerDirectoryHandle(create);
  return playerDirectoryHandle.getFileHandle(LIBRARY_MANIFEST_FILENAME, {
    create,
  });
}

async function ensureParentDirectory(rootHandle, pathSegments) {
  let currentHandle = rootHandle;

  for (const segment of pathSegments) {
    currentHandle = await currentHandle.getDirectoryHandle(segment, {
      create: true,
    });
  }

  return currentHandle;
}

async function getLibraryFileHandle(key, create = false) {
  const libraryDirectoryHandle = await getLibraryDirectoryHandle(create);
  const { filename, pathSegments } = splitKey(key);

  if (!filename) {
    return null;
  }

  const parentDirectoryHandle = await ensureParentDirectory(
    libraryDirectoryHandle,
    pathSegments
  );

  return parentDirectoryHandle.getFileHandle(filename, { create });
}

async function writeBlobToFileHandle(fileHandle, blob) {
  if (typeof fileHandle.createWritable === 'function') {
    const writable = await fileHandle.createWritable();

    try {
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      try {
        await writable.abort();
      } catch (abortError) {
        console.error('Failed to abort OPFS writable stream:', abortError);
      }

      throw error;
    }
  }

  if (typeof fileHandle.createSyncAccessHandle === 'function') {
    const accessHandle = await fileHandle.createSyncAccessHandle();

    try {
      const buffer = new Uint8Array(await blob.arrayBuffer());
      await accessHandle.truncate(0);
      const bytesWritten = await accessHandle.write(buffer, { at: 0 });
      await accessHandle.truncate(bytesWritten);
      await accessHandle.flush();
      return;
    } finally {
      await accessHandle.close();
    }
  }

  throw new TypeError('No supported OPFS write API is available');
}

async function writeLibraryFile(key, file) {
  const fileHandle = await getLibraryFileHandle(key, true);

  if (!fileHandle) {
    throw new TypeError(`Invalid OPFS library key: "${key}"`);
  }

  await writeBlobToFileHandle(fileHandle, file);
}

async function writeManifest(manifestEntries) {
  const manifestHandle = await getManifestFileHandle(true);
  const manifestBlob = new Blob(
    [
      JSON.stringify({
        files: manifestEntries,
        version: 1,
      }),
    ],
    {
      type: 'application/json',
    }
  );

  await writeBlobToFileHandle(manifestHandle, manifestBlob);
}

async function removeLibraryFile(key) {
  const libraryDirectoryHandle = await getLibraryDirectoryHandle(false);
  const { filename, pathSegments } = splitKey(key);

  if (!filename) {
    return;
  }

  let parentDirectoryHandle = libraryDirectoryHandle;

  for (const segment of pathSegments) {
    parentDirectoryHandle = await parentDirectoryHandle.getDirectoryHandle(segment);
  }

  await parentDirectoryHandle.removeEntry(filename);
}

self.onmessage = async event => {
  const {
    files = [],
    key = null,
    manifestEntries = [],
    requestId,
    staleKeys = [],
    type,
  } = event.data ?? {};

  try {
    if (type === 'save-library') {
      for (const entry of files) {
        await writeLibraryFile(entry.key, entry.file);
        self.postMessage({
          key: entry.key,
          requestId,
          type: 'file-saved',
        });
      }

      await writeManifest(
        files.map(entry => ({
          key: entry.key,
          lastModified: entry.lastModified,
          type: entry.type,
        }))
      );

      for (const staleKey of staleKeys) {
        try {
          await removeLibraryFile(staleKey);
        } catch (error) {
          if (error?.name !== 'NotFoundError') {
            throw error;
          }
        }
      }
    } else if (type === 'delete-library-entry') {
      if (key) {
        try {
          await removeLibraryFile(key);
        } catch (error) {
          if (error?.name !== 'NotFoundError') {
            throw error;
          }
        }
      }

      await writeManifest(manifestEntries);
    } else {
      return;
    }

    self.postMessage({
      requestId,
      type: 'complete',
    });
  } catch (error) {
    self.postMessage({
      error: {
        message: error?.message ?? String(error),
        name: error?.name ?? 'Error',
      },
      requestId,
      type: 'error',
    });
  }
};
