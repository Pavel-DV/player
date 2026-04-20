import { getFileKey, setFileKey } from './shared.js';

const PLAYER_DIRECTORY_NAME = 'vanilla-player';
const LIBRARY_DIRECTORY_NAME = 'library';
const LIBRARY_MANIFEST_FILENAME = 'library-manifest.json';
const AUDIO_MIME_TYPES_BY_EXTENSION = {
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

let opfsWorker = null;
let opfsWorkerRequestId = 0;
let opfsMutationQueue = Promise.resolve();
const opfsWorkerRequests = new Map();

function getMimeTypeFromKey(key) {
  const extension = key.split('.').pop()?.toLowerCase();
  return (extension && AUDIO_MIME_TYPES_BY_EXTENSION[extension]) || '';
}

function buildManifestEntry(file, key) {
  return {
    key,
    lastModified: Number.isFinite(file?.lastModified)
      ? file.lastModified
      : Date.now(),
    type: file?.type || getMimeTypeFromKey(key),
  };
}

function splitKey(key) {
  const pathSegments = key.split('/').filter(Boolean);
  const filename = pathSegments.pop();

  return {
    filename,
    pathSegments,
  };
}

function getOpfsWorker() {
  if (opfsWorker) {
    return opfsWorker;
  }

  opfsWorker = new Worker(new URL('./opfs-worker.js', import.meta.url), {
    type: 'module',
  });

  opfsWorker.addEventListener('message', event => {
    const { error, key, requestId, type } = event.data ?? {};
    const pendingRequest = opfsWorkerRequests.get(requestId);

    if (!pendingRequest) {
      return;
    }

    if (type === 'file-saved') {
      pendingRequest.onFileSaved?.(key);
      return;
    }

    opfsWorkerRequests.delete(requestId);

    if (type === 'complete') {
      pendingRequest.resolve(true);
      return;
    }

    if (type === 'error') {
      const workerError = new Error(error?.message || 'OPFS worker failed');
      workerError.name = error?.name || 'Error';
      pendingRequest.reject(workerError);
    }
  });

  return opfsWorker;
}

function enqueueOpfsMutation(operation) {
  const queuedOperation = opfsMutationQueue
    .catch(() => {})
    .then(operation);

  opfsMutationQueue = queuedOperation.catch(() => {});
  return queuedOperation;
}

async function getPlayerDirectoryHandle(create = false) {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return null;
  }

  const rootHandle = await navigator.storage.getDirectory();
  return rootHandle.getDirectoryHandle(PLAYER_DIRECTORY_NAME, { create });
}

async function getLibraryDirectoryHandle(create = false) {
  const playerDirectoryHandle = await getPlayerDirectoryHandle(create);

  if (!playerDirectoryHandle) {
    return null;
  }

  return playerDirectoryHandle.getDirectoryHandle(LIBRARY_DIRECTORY_NAME, {
    create,
  });
}

async function getManifestFileHandle(create = false) {
  const playerDirectoryHandle = await getPlayerDirectoryHandle(create);

  if (!playerDirectoryHandle) {
    return null;
  }

  return playerDirectoryHandle.getFileHandle(LIBRARY_MANIFEST_FILENAME, {
    create,
  });
}

async function getFileHandleByKey(libraryDirectoryHandle, key, create = false) {
  const { filename, pathSegments } = splitKey(key);

  if (!filename) {
    return null;
  }

  let parentDirectoryHandle = libraryDirectoryHandle;

  for (const segment of pathSegments) {
    parentDirectoryHandle = await parentDirectoryHandle.getDirectoryHandle(segment, {
      create,
    });
  }

  return parentDirectoryHandle.getFileHandle(filename, { create });
}

async function readLibraryManifest() {
  try {
    const manifestHandle = await getManifestFileHandle(false);

    if (!manifestHandle) {
      return null;
    }

    const manifestFile = await manifestHandle.getFile();
    const manifestText = await manifestFile.text();

    if (!manifestText.trim()) {
      return null;
    }

    const manifest = JSON.parse(manifestText);
    const files = Array.isArray(manifest?.files) ? manifest.files : [];

    return {
      files: files
        .filter(entry => typeof entry?.key === 'string' && entry.key)
        .map(entry => ({
          key: entry.key,
          lastModified: Number.isFinite(entry.lastModified)
            ? entry.lastModified
            : 0,
          type: typeof entry.type === 'string' ? entry.type : '',
        })),
    };
  } catch (error) {
    if (error?.name === 'NotFoundError') {
      return null;
    }

    if (error instanceof SyntaxError) {
      console.warn('Ignoring malformed OPFS library manifest:', error);
      return null;
    }

    console.error('Failed to read OPFS library manifest:', error);
    return null;
  }
}

async function removeMalformedManifestFile() {
  try {
    const playerDirectoryHandle = await getPlayerDirectoryHandle(false);

    if (!playerDirectoryHandle) {
      return;
    }

    await playerDirectoryHandle.removeEntry(LIBRARY_MANIFEST_FILENAME);
  } catch (error) {
    if (error?.name !== 'NotFoundError') {
      console.error('Failed to remove malformed OPFS manifest:', error);
    }
  }
}

async function collectLegacyFiles(directoryHandle, prefix = '') {
  const files = [];

  for await (const [entryName, entryHandle] of directoryHandle.entries()) {
    const nextKey = prefix ? `${prefix}/${entryName}` : entryName;

    if (entryHandle.kind === 'directory') {
      const nestedFiles = await collectLegacyFiles(entryHandle, nextKey);
      files.push(...nestedFiles);
      continue;
    }

    const storedFile = await entryHandle.getFile();
    const restoredFile = createPlayableFile(storedFile, {
      key: nextKey,
      lastModified: storedFile.lastModified,
      type: storedFile.type || getMimeTypeFromKey(nextKey),
    });
    files.push(setFileKey(restoredFile, nextKey));
  }

  return files;
}

function createPlayableFile(storedFile, entry) {
  return new File([storedFile], storedFile.name, {
    lastModified:
      entry.lastModified || storedFile.lastModified || Date.now(),
    type: entry.type || storedFile.type || getMimeTypeFromKey(entry.key),
  });
}

export function isOpfsLibrarySupported() {
  return Boolean(
    typeof navigator !== 'undefined' && navigator.storage?.getDirectory
  );
}

export async function saveLibraryToOpfs(files, getFileKey, { onFileSaved } = {}) {
  if (!isOpfsLibrarySupported()) {
    return false;
  }

  return enqueueOpfsMutation(async () => {
    const previousManifest = await readLibraryManifest();
    const manifestEntries = [];

    files.forEach(file => {
      const key = getFileKey(file);

      if (!key) {
        return;
      }

      manifestEntries.push({
        ...buildManifestEntry(file, key),
        file,
      });
    });

    const nextKeys = new Set(manifestEntries.map(entry => entry.key));
    const worker = getOpfsWorker();
    const requestId = ++opfsWorkerRequestId;

    return new Promise((resolve, reject) => {
      opfsWorkerRequests.set(requestId, {
        onFileSaved,
        reject,
        resolve,
      });

      worker.postMessage({
        files: manifestEntries,
        requestId,
        staleKeys: (previousManifest?.files ?? [])
          .map(entry => entry.key)
          .filter(key => !nextKeys.has(key)),
        type: 'save-library',
      });
    });
  });
}

export async function deleteLibraryTrackFromOpfs(trackKey) {
  if (!isOpfsLibrarySupported() || !trackKey) {
    return false;
  }

  return enqueueOpfsMutation(async () => {
    const manifest = await readLibraryManifest();
    const worker = getOpfsWorker();
    const requestId = ++opfsWorkerRequestId;

    return new Promise((resolve, reject) => {
      opfsWorkerRequests.set(requestId, {
        reject,
        resolve,
      });

      worker.postMessage({
        key: trackKey,
        manifestEntries: (manifest?.files ?? []).filter(
          entry => entry.key !== trackKey
        ),
        requestId,
        type: 'delete-library-entry',
      });
    });
  });
}

export async function loadLibraryFromOpfs() {
  if (!isOpfsLibrarySupported()) {
    return [];
  }

  try {
    const manifest = await readLibraryManifest();
    const libraryDirectoryHandle = await getLibraryDirectoryHandle(false);

    if (!libraryDirectoryHandle) {
      return [];
    }

    if (!manifest?.files?.length) {
      const legacyFiles = await collectLegacyFiles(libraryDirectoryHandle);

      if (legacyFiles.length === 0) {
        return [];
      }

      await removeMalformedManifestFile();
      try {
        await saveLibraryToOpfs(legacyFiles, getFileKey);
      } catch (error) {
        console.error('Failed to rebuild OPFS library manifest:', error);
      }
      return legacyFiles;
    }

    const files = [];

    for (const entry of manifest.files) {
      const fileHandle = await getFileHandleByKey(
        libraryDirectoryHandle,
        entry.key,
        false
      );

      if (!fileHandle) {
        console.warn(`Missing OPFS file for "${entry.key}"`);
        return [];
      }

      const storedFile = await fileHandle.getFile();
      files.push(setFileKey(createPlayableFile(storedFile, entry), entry.key));
    }

    return files;
  } catch (error) {
    if (error?.name === 'NotFoundError') {
      return [];
    }

    console.error('Failed to load library from OPFS:', error);
    return [];
  }
}
