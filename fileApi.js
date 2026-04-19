const dbName = "myDB";
const storeName = "handles"
const key = 'dirHandle'

const dirHandle = await window.showDirectoryPicker();

const openRequest = indexedDB.open(dbName);

openRequest.onupgradeneeded = function (event) {
    const db = event.target.result;
    const store = db.createObjectStore(storeName)
};

openRequest.onsuccess = async function (event) {
    const db = event.target.result;
    const tx = db.transaction(storeName, 'readwrite')
    const objectStore = tx.objectStore(storeName)
    await objectStore.put({ dirHandle }, key);
};



const openRequest = indexedDB.open(dbName);

openRequest.onsuccess = (e) => {
    const db = e.target.result;

    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);

    const getReq = store.get(key)

    getReq.onsuccess = () => {
        console.log(getReq.result)
    };
};
